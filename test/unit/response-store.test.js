const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createResponseStore } = require("../../src/response-store");

test("response search is text based, bounded, case insensitive and keeps source context", () => {
  const store = createResponseStore({
    maxRecords: 2,
    maxTotal: 400,
    maxBody: 100,
  });
  store.add({
    body: '{"message":"Needle 日本語","id":3}',
    sessionId: "a",
    tabId: "tab1",
    method: "GET",
    url: "https://a.test",
  });
  const id = store.add({
    body: '{"message":"needle 別タブ","id":4}',
    sessionId: "b",
    tabId: "tab2",
  });
  assert.equal(store.search({ query: "NEEDLE" }).total, 2);
  assert.equal(store.search({ query: "日本語", sessionId: "a" }).total, 1);
  assert.equal(
    store.search({ query: "needle", tabId: "tab2" }).results[0].id,
    id,
  );
  assert.ok(store.get(id).body.includes("\n"));
  store.add({ body: "x".repeat(200), sessionId: "a", tabId: "tab3" });
  assert.equal(store.stats().evicted, 1);
  assert.ok(store.stats().bytes <= 400);
  assert.equal(store.search({ query: "日本語" }).total, 0);
  const newest = store.search().results[0];
  assert.equal(newest.truncated, true);
  assert.ok(Buffer.byteLength(store.get(newest.id).body) <= 100);
  store.clear("a");
  assert.equal(store.stats().count, 1);
  store.clear();
  assert.equal(store.stats().count, 0);
});
