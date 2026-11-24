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

const {
  inspectToken,
  cookieKey,
  mask,
  validateBindings,
  targetURL,
} = require("../src/jwt");
const { createResponseStore } = require("../src/response-store");
const {
  createProtection,
  cookieDetails,
  cookieFuse,
} = require("../src/protection");
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
