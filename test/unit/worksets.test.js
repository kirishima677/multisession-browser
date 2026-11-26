const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createWorksets } = require("../../src/worksets");

function worksetFixture(allowed) {
  const events = [];
  const config = {
    worksets: [
      {
        id: "existing",
        name: "Saved",
        tabs: [
          { sessionId: "a", url: "https://example.test/" },
          {
            kind: "api",
            sessionId: "a",
            request: { url: "https://example.test/api" },
          },
          { kind: "terminal", sessionId: "b", terminal: { cwd: "/tmp" } },
        ],
      },
    ],
  };
  const service = createWorksets({
    getConfig: () => config,
    workspace: {
      tabs: new Map([
        [
          "web",
          {
            sessionId: "a",
            view: {
              webContents: { getURL: () => "https://example.test/current" },
            },
          },
        ],
      ]),
      closeAll: () => events.push(["close"]),
      createTab: (...args) => events.push(["web", ...args]),
      selectFirst: () => events.push(["select-first"]),
    },
    sessions: { resetTemporary: async (id) => events.push(["fresh", id]) },
    getApiTabs: () => ({ create: (...args) => events.push(["api", ...args]) }),
    getTerminalTabs: () => ({
      create: (...args) => events.push(["terminal", ...args]),
    }),
    persist: () => events.push(["persist"]),
    confirm: async () => allowed,
  });
  return { service, config, events };
}

test("cancelled workset overwrite, restore and removal leave saved data and live tabs untouched", async () => {
  const f = worksetFixture(false),
    original = structuredClone(f.config);
  await f.service.save({ id: "existing", name: "Replacement" });
  await f.service.restore({ id: "existing" });
  await f.service.remove("existing");
  assert.deepEqual(f.config, original);
  assert.deepEqual(f.events, []);
});

test("workset restore closes existing views before resetting each session and preserves mixed tab order without starting the CLI", async () => {
  const f = worksetFixture(true),
    original = structuredClone(f.config);
  await f.service.restore({ id: "existing" });
  assert.deepEqual(f.events, [
    ["close"],
    ["fresh", "a"],
    ["fresh", "b"],
    ["web", "a", "https://example.test/"],
    ["api", "a", { url: "https://example.test/api" }],
    ["terminal", "b", { cwd: "/tmp" }, false],
    ["select-first"],
  ]);
  assert.deepEqual(f.config, original);
  await assert.rejects(
    () => f.service.restore({ id: "missing" }),
    /復元するタブ/,
  );
  await assert.rejects(
    () => f.service.save({ id: "missing", name: "Missing" }),
    /上書きする構成/,
  );
  assert.deepEqual(f.config, original);
});
