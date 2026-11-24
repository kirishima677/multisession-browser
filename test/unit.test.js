const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  normalizeURL,
  resolveAddressInput,
  allowedNavigation,
  makeSession,
  partitionFor,
  defaults,
  validateConfig,
  ConfigStore,
} = require("../src/model");

test("URL normalization permits local development and blocks privileged protocols", () => {
  assert.equal(normalizeURL("localhost:3000/a"), "https://localhost:3000/a");
  assert.equal(normalizeURL("http://localhost:3000"), "http://localhost:3000/");
  assert.equal(normalizeURL("example.com"), "https://example.com/");
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hi",
    "https://user:secret@example.com",
  ])
    assert.throws(() => normalizeURL(url));
  assert.equal(allowedNavigation("file:///etc/passwd"), false);
  assert.equal(allowedNavigation("about:blank"), true);
});
test("persistent partitions are stable and temporary partitions change across runs", () => {
  const saved = makeSession("a1");
  const temp = makeSession("a2", false);
  assert.equal(partitionFor(saved, "run1"), partitionFor(saved, "run2"));
  assert.notEqual(partitionFor(temp, "run1"), partitionFor(temp, "run2"));
  assert.notEqual(
    partitionFor(saved, "run1"),
    partitionFor(makeSession("a1"), "run1"),
  );
});
test("invalid configuration and unresolved workset sessions are rejected", () => {
  const data = defaults();
  data.worksets.push({
    id: makeSession("id").id,
    name: "test",
    tabs: [{ sessionId: "unknown", url: "https://example.com" }],
  });
  assert.throws(() => validateConfig(data));
  assert.throws(() => makeSession("  "));
  assert.throws(() => makeSession("x", true, "red"));
});
test("configuration persists metadata with atomic replacement", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-unit-"));
  try {
    const store = new ConfigStore(directory);
    const data = store.load();
    store.save(data);
    assert.deepEqual(store.load(), data);
    assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(`${store.file}.tmp`), false);
    fs.writeFileSync(store.file, "{broken");
    assert.throws(() => store.load());
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("address input distinguishes websites, local development and search queries", () => {
  assert.equal(resolveAddressInput("example.com"), "https://example.com/");
  assert.equal(
    resolveAddressInput("example.com:8080/path?q=1"),
    "https://example.com:8080/path?q=1",
  );
  assert.equal(
    resolveAddressInput("http://localhost:3000/path"),
    "http://localhost:3000/path",
  );
  assert.equal(resolveAddressInput("localhost:3000"), "http://localhost:3000/");
  assert.equal(resolveAddressInput("127.0.0.1:8080"), "http://127.0.0.1:8080/");
  assert.equal(resolveAddressInput("[::1]:3000"), "http://[::1]:3000/");
  assert.equal(
    resolveAddressInput("example.com/path?q=a#part"),
    "https://example.com/path?q=a#part",
  );
  assert.equal(resolveAddressInput("日本語.jp"), "https://xn--wgv71a119e.jp/");
  for (const query of [
    "パスキー 認証",
    "electron",
    "C++ browser",
    "a & b #c ?",
    "what is node.js",
    "site:example.com passkey",
    "error:403",
  ]) {
    const url = new URL(resolveAddressInput(query));
    assert.equal(url.origin, "https://www.google.com");
    assert.equal(url.pathname, "/search");
    assert.equal(url.searchParams.get("q"), query);
  }
  for (const url of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,hi",
    "https://user:secret@example.com",
  ])
    assert.throws(() => resolveAddressInput(url));
});

const {
  reorderIds,
  splitForDrop,
  selectInSplit,
} = require("../src/tab-layout");
test("moving tabs preserves all IDs and handles both directions and invalid targets", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(reorderIds(ids, "a", null), ["b", "c", "a"]);
  assert.deepEqual(reorderIds(ids, "c", "a"), ["c", "a", "b"]);
  assert.deepEqual(reorderIds(ids, "b", "b"), ids);
  assert.throws(() => reorderIds(ids, "missing", "a"));
  assert.throws(() => reorderIds(ids, "a", "missing"));
  assert.deepEqual(ids, ["a", "b", "c"]);
});
test("split drops preserve the opposite pane, swap existing panes and require two tabs", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(splitForDrop(ids, "a", null, "b", "right"), {
    left: "a",
    right: "b",
  });
  assert.deepEqual(splitForDrop(ids, "a", null, "a", "left"), {
    left: "a",
    right: "b",
  });
  assert.deepEqual(
    splitForDrop(ids, "a", { left: "a", right: "b" }, "b", "left"),
    { left: "b", right: "a" },
  );
  assert.deepEqual(
    splitForDrop(ids, "a", { left: "a", right: "b" }, "c", "right"),
    { left: "a", right: "c" },
  );
  assert.throws(() => splitForDrop(["a"], "a", null, "a", "left"));
  assert.throws(() => splitForDrop(ids, "a", null, "b", "top"));
});
test("selecting a hidden tab replaces only the active pane", () => {
  const split = { left: "a", right: "b" };
  assert.deepEqual(selectInSplit(split, "a", "c"), { left: "c", right: "b" });
  assert.deepEqual(selectInSplit(split, "b", "c"), { left: "a", right: "c" });
  assert.deepEqual(selectInSplit(split, "a", "b"), split);
  assert.equal(selectInSplit(null, "a", "c"), null);
});

const { downloadableURL } = require("../src/context-menu");
test("downloads reject privileged protocols and restrict inline resources to media", () => {
  assert.equal(
    downloadableURL("https://example.com/picture.png", "image"),
    true,
  );
  assert.equal(downloadableURL("data:image/png;base64,AA==", "image"), true);
  assert.equal(downloadableURL("blob:https://example.com/id", "image"), true);
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:secret@example.com/image",
    "data:text/html,<script>x</script>",
  ])
    assert.equal(downloadableURL(url, "image"), false);
  assert.equal(downloadableURL("blob:https://example.com/id", "link"), false);
});

const {
  draft: apiDraft,
  prepare: prepareAPI,
  storedDraft,
} = require("../src/api-request");
test("API requests validate methods, protocols, JSON and managed authentication headers", () => {
  assert.equal(apiDraft().auth, "session");
  const request = prepareAPI({
    method: "POST",
    url: "http://localhost:3000/items?old=1",
    params: "q=日本語 & value\ntag=a\ntag=b",
    headers: "X-CSRF-Token: short-lived",
    body: '{"message":"hello"}',
    bodyType: "json",
    auth: "bearer",
    bearer: "token",
  });
  assert.deepEqual(new URL(request.url).searchParams.getAll("tag"), ["a", "b"]);
  assert.equal(new URL(request.url).searchParams.get("q"), "日本語 & value");
  assert.equal(request.credentials, "omit");
  assert.equal(new Map(request.headers).get("authorization"), "Bearer token");
  assert.equal(
    new Map(request.headers).get("content-type"),
    "application/json",
  );
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/plain,x",
    "http://user:secret@localhost/",
  ])
    assert.throws(() => prepareAPI({ url }));
  assert.throws(() => prepareAPI({ url: "http://localhost", method: "TRACE" }));
  assert.throws(() =>
    prepareAPI({ url: "http://localhost", headers: "Cookie: jwt=a" }),
  );
  assert.throws(() =>
    prepareAPI({ url: "http://localhost", headers: "Host: other.example" }),
  );
  assert.throws(() =>
    prepareAPI({ url: "http://localhost", method: "POST", body: "{bad JSON" }),
  );
  assert.throws(() =>
    prepareAPI({ url: "http://localhost", auth: "bearer", bearer: "" }),
  );
  assert.equal(
    prepareAPI({ url: "http://localhost", method: "GET", body: "draft text" })
      .body,
    undefined,
  );
});
test("API persistence strips bearer and credential headers while preserving request templates", () => {
  const saved = storedDraft({
    name: "example",
    method: "POST",
    url: "https://example.com/api",
    auth: "bearer",
    bearer: "do-not-save",
    headers:
      "Accept: application/json\nX-CSRF-Token: temporary\nX-API-Key: temporary-key\nX-Trace: trace",
    body: '{"hello":true}',
  });
  assert.equal(saved.bearer, "");
  assert.equal(saved.headers, "Accept: application/json\nX-Trace: trace");
  assert.equal(saved.body, '{"hello":true}');
  const config = defaults();
  delete config.apiRequests;
  assert.deepEqual(validateConfig(config).apiRequests, []);
  config.apiRequests.push({
    id: makeSession("id").id,
    sessionId: config.sessions[0].id,
    name: "example",
    request: saved,
  });
  assert.equal(validateConfig(config), config);
  config.apiRequests[0].request.bearer = "should-reject";
  assert.throws(() => validateConfig(config));
});

const {
  preferences,
  terminalDefinition,
  compareVersions,
} = require("../src/runtime-model");
const { parseTree, descendants } = require("../src/process-tree");
const { summarize, createMemoryMonitor } = require("../src/memory-monitor");
const { releaseURL, createUpdateChecker } = require("../src/updates");
test("runtime preferences and terminal definitions validate and migrate existing workspaces", () => {
  assert.deepEqual(preferences(), {
    memoryWarningMiB: 2048,
    checkUpdatesOnStartup: true,
  });
  assert.equal(preferences({ memoryWarningMiB: 0 }).memoryWarningMiB, 0);
  for (const memoryWarningMiB of [-1, 128, 70000, NaN])
    assert.throws(() => preferences({ memoryWarningMiB }));
  assert.throws(() => preferences({ checkUpdatesOnStartup: "yes" }));
  assert.equal(terminalDefinition({ cwd: "/tmp/a/../b" }).cwd, "/tmp/b");
  assert.throws(() => terminalDefinition({ cwd: "relative" }));
  const config = defaults();
  delete config.preferences;
  config.worksets.push({
    id: require("node:crypto").randomUUID(),
    name: "CLI",
    tabs: [
      {
        kind: "terminal",
        sessionId: config.sessions[0].id,
        terminal: { cwd: "/tmp" },
        url: "about:blank",
      },
    ],
  });
  assert.equal(validateConfig(config).preferences.memoryWarningMiB, 2048);
  config.worksets[0].tabs[0].terminal.cwd = "relative";
  assert.throws(() => validateConfig(config));
});
test("release comparison uses numeric stable versions and trusted release links", () => {
  assert.equal(compareVersions("v0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("v0.5.0", "0.5.0"), 0);
  assert.equal(compareVersions("0.4.9", "0.5.0"), -1);
  for (const value of ["v1.0", "1.0.0-beta", "01.2.3", "garbage"])
    assert.throws(() => compareVersions(value, "0.5.0"));
  assert.ok(
    releaseURL(
      "https://github.com/kirishima677/multisession-browser/releases/tag/v0.5.0",
    ),
  );
  assert.equal(
    releaseURL(
      "https://github.com.evil.test/kirishima677/multisession-browser/releases/latest",
    ),
    null,
  );
  assert.equal(releaseURL("file:///tmp/update"), null);
});
test("memory accounting includes CLI descendants without counting Electron processes twice", () => {
  const rows = parseTree("10 1 100\n20 10 50\n30 20 25\n40 1 200");
  assert.deepEqual(
    descendants(rows, [20]).map((p) => p.pid),
    [20, 30],
  );
  assert.deepEqual(
    summarize(
      [
        { pid: 10, memory: { workingSetSize: 100 } },
        { pid: 20, memory: { workingSetSize: 50 } },
      ],
      rows,
      [20],
    ),
    { bytes: 175 * 1024, processes: 3, cliProcesses: 1 },
  );
});
test("memory warning dismissal rearms below 90 percent and can be disabled", async () => {
  let kib = 3000 * 1024,
    limit = 2048;
  const monitor = createMemoryMonitor({
    app: { getAppMetrics: () => [{ pid: 1, memory: { workingSetSize: kib } }] },
    terminalPids: () => [],
    threshold: () => limit,
    publish: () => {},
  });
  assert.equal((await monitor.sample()).warning, true);
  monitor.dismiss();
  await monitor.sample();
  assert.equal(monitor.get().dismissed, true);
  kib = 1900 * 1024;
  await monitor.sample();
  assert.equal(monitor.get().dismissed, true);
  kib = 1000 * 1024;
  await monitor.sample();
  assert.equal(monitor.get().dismissed, false);
  kib = 3000 * 1024;
  await monitor.sample();
  assert.equal(monitor.get().warning, true);
  limit = 0;
  await monitor.sample();
  assert.equal(monitor.get().warning, false);
});
test("update checks distinguish available, current, missing and invalid releases", async () => {
  const http = require("node:http");
  let status = 200,
    body = {
      tag_name: "v0.6.0",
      html_url:
        "https://github.com/kirishima677/multisession-browser/releases/tag/v0.6.0",
    };
  const server = http.createServer((_req, res) => {
    res.writeHead(status);
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const checker = createUpdateChecker({
      version: "0.5.0",
      url: `http://127.0.0.1:${server.address().port}`,
      publish: () => {},
    });
    await checker.check();
    assert.equal(checker.get().status, "available");
    body.tag_name = "v0.5.0";
    await checker.check();
    assert.equal(checker.get().status, "current");
    body.tag_name = "not-a-version";
    await checker.check();
    assert.equal(checker.get().status, "error");
    assert.equal(checker.openURL(), "");
    status = 404;
    await checker.check();
    assert.equal(checker.get().status, "no-release");
    status = 503;
    await checker.check();
    assert.equal(checker.get().status, "error");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
