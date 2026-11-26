const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installBrowserIPC } = require("../../src/browser-ipc");

function browserIPCFixture(command) {
  let handler;
  const frame = { url: "file:///fixture/index.html" };
  const contents = { mainFrame: frame };
  let window = { webContents: contents };
  let publications = 0;
  installBrowserIPC({
    ipcMain: {
      handle: (channel, fn) => {
        assert.equal(channel, "browser:command");
        handler = fn;
      },
    },
    getWindow: () => window,
    shellURL: frame.url,
    command,
    publish: () => publications++,
  });
  return {
    invoke: (event, action, payload) => handler(event, action, payload),
    event: { sender: contents, senderFrame: frame },
    setWindow: (value) => {
      window = value;
    },
    publications: () => publications,
  };
}

test("browser IPC rejects other windows, child frames, changed URLs and stale windows before dispatch", async () => {
  let calls = 0;
  const f = browserIPCFixture(async () => {
    calls++;
    return { ok: true };
  });
  await assert.rejects(
    () => f.invoke({ ...f.event, sender: {} }, "state"),
    /許可/,
  );
  await assert.rejects(
    () =>
      f.invoke(
        { ...f.event, senderFrame: { url: f.event.senderFrame.url } },
        "state",
      ),
    /許可/,
  );
  const url = f.event.senderFrame.url;
  f.event.senderFrame.url = "https://untrusted.invalid/";
  await assert.rejects(() => f.invoke(f.event, "state"), /許可/);
  f.event.senderFrame.url = url;
  assert.equal(calls, 0);
  assert.deepEqual(await f.invoke(f.event, "state"), { ok: true });
  f.setWindow({ webContents: { mainFrame: { url } } });
  await assert.rejects(() => f.invoke(f.event, "state"), /許可/);
  f.setWindow(null);
  await assert.rejects(() => f.invoke(f.event, "state"), /許可/);
  assert.equal(calls, 1);
});

test("browser IPC allows snapshots during a mutation, rejects concurrent mutations and releases the lock after failure", async () => {
  let release;
  const calls = [];
  const f = browserIPCFixture(async (action) => {
    calls.push(action);
    if (action === "wait")
      await new Promise((resolve) => {
        release = resolve;
      });
    if (action === "fail") throw new Error("fixture failure");
    return { action };
  });
  const pending = f.invoke(f.event, "wait");
  assert.deepEqual(await f.invoke(f.event, "state"), { action: "state" });
  assert.match((await f.invoke(f.event, "second")).error, /処理中/);
  release();
  assert.deepEqual(await pending, { action: "wait" });
  assert.deepEqual(await f.invoke(f.event, "fail"), {
    error: "fixture failure",
  });
  assert.equal(f.publications(), 1);
  assert.deepEqual(await f.invoke(f.event, "next"), { action: "next" });
  assert.deepEqual(calls, ["wait", "state", "fail", "next"]);
});
