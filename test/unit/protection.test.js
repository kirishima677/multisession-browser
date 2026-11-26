const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createProtection,
  cookieDetails,
  cookieFuse,
} = require("../../src/protection");

test("encrypted vault stores no plaintext, serializes changes, and preserves ciphertext when locked", async () => {
  const crypto = require("node:crypto"),
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-vault-unit-"));
  const key = crypto.randomBytes(32);
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (plain) => {
      const iv = crypto.randomBytes(12),
        c = crypto.createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([c.update(plain), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]);
    },
    decryptStringAsync: async (value) => {
      const d = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        value.subarray(0, 12),
      );
      d.setAuthTag(value.subarray(12, 28));
      return {
        result: Buffer.concat([
          d.update(value.subarray(28)),
          d.final(),
        ]).toString(),
      };
    },
  };
  try {
    const vault = createProtection({
      safeStorage,
      directory,
      encryptedCookies: true,
    });
    await vault.init();
    await Promise.all([
      vault.set("a|https://a.test", { name: "jwt", value: "secret-token-a" }),
      vault.set("b|https://b.test", { name: "jwt", value: "secret-token-b" }),
    ]);
    const file = path.join(directory, "tokens.enc.json"),
      bytes = fs.readFileSync(file);
    assert.ok(!bytes.toString().includes("secret-token"));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const reopened = createProtection({
      safeStorage,
      directory,
      encryptedCookies: true,
    });
    await reopened.init();
    assert.equal(reopened.get("a|https://a.test").value, "secret-token-a");
    assert.equal(reopened.get("b|https://b.test").value, "secret-token-b");
    const locked = createProtection({
      safeStorage: {
        ...safeStorage,
        isAsyncEncryptionAvailable: async () => false,
      },
      directory,
      encryptedCookies: true,
    });
    await locked.init();
    assert.equal(locked.status().persistentAllowed, false);
    assert.equal(locked.status().vaultLocked, true);
    await assert.rejects(() => locked.set("c", { value: "no-plaintext" }));
    assert.deepEqual(fs.readFileSync(file), bytes);
    await reopened.removeSession("a");
    assert.equal(reopened.get("a|https://a.test"), undefined);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Cookie migration preserves host-only, expiry, secure, HttpOnly and SameSite attributes", async () => {
  const cookie = {
    name: "__Host-jwt",
    value: "fixture",
    domain: "example.test",
    hostOnly: true,
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "strict",
    expirationDate: 2000000000,
  };
  const details = cookieDetails(cookie);
  assert.equal(details.domain, undefined);
  assert.equal(details.url, "https://example.test/");
  assert.equal(details.value, cookie.value);
  assert.equal(details.expirationDate, cookie.expirationDate);
  assert.equal(details.httpOnly, true);
  assert.equal(details.sameSite, "strict");
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "msb-cookie-migration-"),
  );
  let writes = 0,
    flushes = 0;
  try {
    const protection = createProtection({
      safeStorage: { isAsyncEncryptionAvailable: async () => true },
      directory,
      encryptedCookies: true,
    });
    await protection.init();
    const ses = {
      cookies: {
        get: async () => [cookie],
        set: async (d) => {
          assert.deepEqual(d, details);
          writes++;
        },
        flushStore: async () => {
          flushes++;
        },
      },
    };
    await protection.migrateCookies(ses, "one");
    await protection.migrateCookies(ses, "one");
    assert.equal(writes, 1);
    assert.equal(flushes, 1);
    assert.equal(protection.status().migratedCookies, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime cookie fuse detection reads the encryption bit without modifying the binary", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-fuse-unit-")),
    file = path.join(directory, "runtime");
  try {
    const sentinel = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");
    fs.writeFileSync(
      file,
      Buffer.concat([
        Buffer.alloc(128 * 1024 - 10),
        sentinel,
        Buffer.from([1, 9, 49, 49, 49, 49]),
      ]),
    );
    assert.equal(cookieFuse(file, "linux"), true);
    fs.writeFileSync(
      file,
      Buffer.concat([sentinel, Buffer.from([1, 9, 49, 48, 49, 49])]),
    );
    assert.equal(cookieFuse(file, "linux"), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("OS key confirmation timeout starts memory-only mode without overwriting existing files", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-key-timeout-"));
  const file = path.join(directory, "tokens.enc.json");
  const original = '{"version":1,"data":"unchanged-ciphertext"}';
  fs.writeFileSync(file, original);
  try {
    const protection = createProtection({
      directory,
      encryptedCookies: true,
      timeoutMs: 15,
      safeStorage: { isAsyncEncryptionAvailable: () => new Promise(() => {}) },
    });
    await protection.init();
    assert.equal(protection.status().available, false);
    assert.equal(protection.status().persistentAllowed, false);
    assert.equal(protection.status().vaultLocked, true);
    assert.equal(fs.readFileSync(file, "utf8"), original);
    assert.match(protection.status().message, /確認待ち/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Cookie key access timeout preserves the migration marker and degrades to memory-only mode", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "msb-cookie-timeout-"),
  );
  try {
    const protection = createProtection({
      directory,
      encryptedCookies: true,
      timeoutMs: 15,
      safeStorage: { isAsyncEncryptionAvailable: async () => true },
    });
    await protection.init();
    await protection.migrateCookies(
      { cookies: { get: () => new Promise(() => {}) } },
      "profile",
    );
    assert.equal(protection.status().persistentAllowed, false);
    assert.equal(
      fs.existsSync(path.join(directory, "security-state.json")),
      false,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
