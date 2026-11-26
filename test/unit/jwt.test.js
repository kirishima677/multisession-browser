const { test } = require("node:test");
const assert = require("node:assert/strict");
const { defaults } = require("../../src/model");
const {
  inspectToken,
  cookieKey,
  mask,
  validateBindings,
  targetURL,
} = require("../../src/jwt");

function syntheticToken(claims, header = { alg: "HS256" }) {
  return [
    Buffer.from(JSON.stringify(header)).toString("base64url"),
    Buffer.from(JSON.stringify(claims)).toString("base64url"),
    "testsignature",
  ].join(".");
}

test("JWT candidates are detected by contents, permit missing exp, and keep claims unverified", () => {
  const value = syntheticToken({ alumni_id: 7, exp: 0 });
  assert.equal(inspectToken(value).claims.alumni_id, 7);
  assert.equal(inspectToken(value).expiresAt, "1970-01-01T00:00:00.000Z");
  assert.equal(inspectToken(syntheticToken({ sub: "user" })).expiresAt, null);
  assert.equal(inspectToken("not.a.jwt"), null);
  assert.equal(inspectToken("opaque-token"), null);
  assert.equal(inspectToken(syntheticToken({ exp: 1e30 })).expiresAt, null);
  const encrypted = `${Buffer.from(JSON.stringify({ alg: "RSA-OAEP", enc: "A256GCM" })).toString("base64url")}.a.b.c.d`;
  assert.equal(inspectToken(encrypted).format, "JWE");
  assert.equal(inspectToken(encrypted).claims, null);
  assert.notEqual(
    cookieKey({ name: "jwt", domain: "a.test", path: "/" }),
    cookieKey({ name: "jwt", domain: "b.test", path: "/" }),
  );
  assert.notEqual(mask(value), value);
  assert.equal(
    targetURL("https://test.example/api?secret=one#x"),
    "https://test.example/api",
  );
});

test("auth binding metadata never permits persisted token values", () => {
  const config = defaults(),
    id = config.sessions[0].id;
  assert.deepEqual(validateBindings(undefined, new Set([id])), []);
  const entry = {
    sessionId: id,
    url: "https://example.test/",
    kind: "cookie",
    cookieKey: cookieKey({ name: "jwt", domain: "example.test", path: "/" }),
  };
  assert.equal(validateBindings([entry], new Set([id])).length, 1);
  assert.throws(() =>
    validateBindings([{ ...entry, value: "secret" }], new Set([id])),
  );
  assert.throws(() => validateBindings([entry, entry], new Set([id])));
  assert.throws(() => targetURL("file:///tmp/token"));
});
