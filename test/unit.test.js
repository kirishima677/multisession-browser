const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  normalizeURL,
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
