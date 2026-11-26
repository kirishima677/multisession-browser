const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { defaults } = require("../../src/model");
const {
  createBrowserLibrary,
  validateLibrary,
  pageURL,
} = require("../../src/browser-library");

function libraryCrypto() {
  const crypto = require("node:crypto"),
    key = crypto.randomBytes(32);
  return {
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
}

test("browser library rejects executable and credential-bearing URLs", () => {
  assert.equal(
    pageURL("https://example.test/path#section"),
    "https://example.test/path#section",
  );
  for (const url of [
    "file:///tmp/a",
    "javascript:alert(1)",
    "https://user:secret@example.test",
  ])
    assert.throws(() => pageURL(url));
  assert.deepEqual(
    validateLibrary({ version: 1, history: [], bookmarks: [] }),
    { version: 1, history: [], bookmarks: [] },
  );
});

test("browser library persists encrypted saved-session history and explicit bookmarks, keeping temporary visits in memory", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-library-unit-")),
    profiles = [
      {
        id: require("node:crypto").randomUUID(),
        name: "Saved",
        persistent: true,
      },
      {
        id: require("node:crypto").randomUUID(),
        name: "Temporary",
        persistent: false,
      },
    ],
    safeStorage = libraryCrypto();
  const options = {
    directory,
    safeStorage,
    canPersist: () => true,
    getSessions: () => profiles,
    publish: () => {},
  };
  let first, second;
  try {
    first = createBrowserLibrary(options);
    await first.init();
    first.record(
      profiles[0].id,
      "https://a.test/secret-location",
      "Saved visit",
      1,
    );
    first.record(
      profiles[1].id,
      "https://b.test/private-visit",
      "Private visit",
      2,
    );
    const saved = await first.saveBookmark({
      sessionId: profiles[1].id,
      url: "https://b.test/explicit",
      title: "Explicit bookmark",
    });
    assert.equal(saved.persisted, true);
    await first.flush();
    const file = path.join(directory, "browser-library.enc.json");
    assert.ok(!fs.readFileSync(file, "utf8").includes("secret-location"));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    second = createBrowserLibrary(options);
    await second.init();
    assert.equal(second.list({ kind: "history" }).total, 1);
    assert.equal(
      second.list({ kind: "history", sessionId: profiles[1].id }).total,
      0,
    );
    assert.equal(second.list({ kind: "bookmarks" }).total, 1);
    assert.equal(first.list({ kind: "history", query: "PRIVATE" }).total, 1);
  } finally {
    await first?.stop();
    await second?.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("bookmarks deduplicate within a session, support editing and undo, and are removed with their session", async () => {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "msb-bookmark-unit-"),
    ),
    profiles = defaults().sessions;
  const library = createBrowserLibrary({
    directory,
    safeStorage: libraryCrypto(),
    canPersist: () => true,
    getSessions: () => profiles,
    publish: () => {},
  });
  try {
    await library.init();
    const a = await library.saveBookmark({
      sessionId: profiles[0].id,
      url: "https://example.test/",
      title: "one",
    });
    const updated = await library.saveBookmark({
      sessionId: profiles[0].id,
      url: a.url,
      title: "two",
    });
    assert.equal(a.id, updated.id);
    assert.equal(library.list({ kind: "bookmarks" }).total, 1);
    const b = await library.saveBookmark({
      sessionId: profiles[1].id,
      url: a.url,
      title: "other account",
    });
    assert.notEqual(a.id, b.id);
    assert.equal(library.list({ kind: "bookmarks" }).total, 2);
    await library.removeBookmark(a.id);
    assert.equal(library.summary().undoAvailable, true);
    await library.undoBookmark();
    assert.equal(library.find(profiles[0].id, a.url).title, "two");
    await library.removeSession(profiles[0].id, true);
    assert.equal(library.list({ kind: "bookmarks" }).total, 1);
  } finally {
    await library.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("undo cannot exceed the bookmark limit or corrupt the next restart", async () => {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "msb-bookmark-limit-"),
    ),
    profiles = defaults().sessions,
    safeStorage = libraryCrypto(),
    file = path.join(directory, "browser-library.enc.json"),
    bookmarks = Array.from({ length: 2000 }, (_, i) => ({
      id: require("node:crypto").randomUUID(),
      sessionId: profiles[0].id,
      url: `https://example.test/${i}`,
      title: `Bookmark ${i}`,
      updatedAt: new Date().toISOString(),
    })),
    options = {
      directory,
      safeStorage,
      canPersist: () => true,
      getSessions: () => profiles,
      publish: () => {},
    };
  let library, reopened;
  try {
    const encrypted = await safeStorage.encryptStringAsync(
      JSON.stringify({ version: 1, history: [], bookmarks }),
    );
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, data: encrypted.toString("base64") }),
    );
    library = createBrowserLibrary(options);
    await library.init();
    await library.removeBookmark(bookmarks[0].id);
    await library.saveBookmark({
      sessionId: profiles[0].id,
      url: "https://example.test/new",
      title: "New",
    });
    const before = fs.readFileSync(file);
    await assert.rejects(() => library.undoBookmark(), /2000/);
    assert.equal(library.summary().bookmarkCount, 2000);
    assert.equal(library.summary().undoAvailable, true);
    assert.deepEqual(fs.readFileSync(file), before);
    reopened = createBrowserLibrary(options);
    await reopened.init();
    assert.equal(reopened.summary().writable, true);
    assert.equal(reopened.summary().bookmarkCount, 2000);
  } finally {
    await library?.stop();
    await reopened?.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("browser library preserves unreadable ciphertext and uses memory-only changes when encryption is unavailable", async () => {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "msb-library-locked-"),
    ),
    file = path.join(directory, "browser-library.enc.json"),
    original = '{"version":1,"data":"unreadable"}',
    profiles = defaults().sessions;
  fs.writeFileSync(file, original);
  const library = createBrowserLibrary({
    directory,
    safeStorage: libraryCrypto(),
    canPersist: () => false,
    getSessions: () => profiles,
    publish: () => {},
  });
  try {
    await library.init();
    const result = await library.saveBookmark({
      sessionId: profiles[0].id,
      url: "https://memory.test",
      title: "Memory",
    });
    assert.equal(result.persisted, false);
    assert.equal(library.list({ kind: "bookmarks" }).total, 1);
    assert.equal(fs.readFileSync(file, "utf8"), original);
  } finally {
    await library.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
