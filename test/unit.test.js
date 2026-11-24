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
