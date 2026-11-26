const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeSession, defaults, validateConfig } = require("../../src/model");
const {
  draft: apiDraft,
  prepare: prepareAPI,
  storedDraft,
} = require("../../src/api-request");

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
