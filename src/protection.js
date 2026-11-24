const fs = require("node:fs");
const path = require("node:path");
const SENTINEL = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");
function withDeadline(work, timeoutMs = 5000) {
  let timer;
  return Promise.race([
    Promise.resolve().then(() => (typeof work === "function" ? work() : work)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("OS_KEY_TIMEOUT")), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}
function cookieFuse(
  executable = process.execPath,
  platform = process.platform,
) {
  const file =
    platform === "darwin"
      ? path.resolve(
          executable,
          "../../Frameworks/Electron Framework.framework/Electron Framework",
        )
      : executable;
  let fd;
  try {
    fd = fs.openSync(file, "r");
    let tail = Buffer.alloc(0);
    const chunk = Buffer.alloc(128 * 1024);
    for (;;) {
      const size = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!size) return false;
      const data = Buffer.concat([tail, chunk.subarray(0, size)]),
        at = data.indexOf(SENTINEL);
      if (at >= 0 && data.length > at + SENTINEL.length + 3)
        return (
          data[at + SENTINEL.length] === 1 &&
          data[at + SENTINEL.length + 3] === 49
        );
      tail = data.subarray(Math.max(0, data.length - SENTINEL.length - 16));
    }
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
function atomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}
function cookieDetails(cookie) {
  const host = cookie.domain?.replace(/^\./, "");
  if (!host) throw new Error("Cookieのドメインを確認できません。");
  return {
    url: `${cookie.secure ? "https" : "http"}://${host}${cookie.path || "/"}`,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || "/",
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: cookie.sameSite,
    ...(!cookie.hostOnly ? { domain: cookie.domain } : {}),
    ...(cookie.expirationDate !== undefined
      ? { expirationDate: cookie.expirationDate }
      : {}),
  };
}
function createProtection({
  safeStorage,
  directory,
  encryptedCookies = cookieFuse(),
  timeoutMs = 5000,
}) {
  const file = path.join(directory, "tokens.enc.json"),
    migrationFile = path.join(directory, "security-state.json");
  let entries = new Map(),
    queue = Promise.resolve(),
    migrations = { version: 1, profiles: [] };
  const state = {
    available: false,
    cookieEncryption: encryptedCookies,
    persistentAllowed: false,
    vaultLocked: false,
    message: "暗号化を確認中…",
    migratedCookies: 0,
  };
  async function init() {
    try {
      state.available = await withDeadline(
        () => safeStorage.isAsyncEncryptionAvailable(),
        timeoutMs,
      );
      if (
        process.platform === "linux" &&
        safeStorage.getSelectedStorageBackend?.() === "basic_text"
      )
        state.available = false;
      state.persistentAllowed = state.available && encryptedCookies;
      state.message = state.persistentAllowed
        ? "Cookieと保存トークンをOSの鍵で暗号化します。"
        : "暗号化が利用できないため、ブラウザの保存を停止し一時セッションで動作します。";
      if (fs.existsSync(migrationFile)) {
        const stored = JSON.parse(fs.readFileSync(migrationFile, "utf8"));
        if (stored.version !== 1 || !Array.isArray(stored.profiles))
          throw new Error("保護設定の形式が不正です。");
        migrations = stored;
      }
      if (fs.existsSync(file)) {
        if (!state.available) {
          state.vaultLocked = true;
          return;
        }
        const stat = fs.statSync(file);
        if (stat.size > 2 * 1024 * 1024)
          throw new Error("保存トークンのファイルが大きすぎます。");
        const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
        if (envelope.version !== 1 || typeof envelope.data !== "string")
          throw new Error("保存トークンの形式が不正です。");
        const decrypted = await withDeadline(
          () =>
            safeStorage.decryptStringAsync(
              Buffer.from(envelope.data, "base64"),
            ),
          timeoutMs,
        );
        const parsed = JSON.parse(decrypted.result);
        if (
          !Array.isArray(parsed) ||
          parsed.some(
            (e) =>
              !Array.isArray(e) ||
              typeof e[0] !== "string" ||
              typeof e[1]?.value !== "string" ||
              e[1].value.length > 16384,
          )
        )
          throw new Error("保存トークンの形式が不正です。");
        entries = new Map(parsed);
        if (decrypted.shouldReEncrypt) await change(() => {});
      }
    } catch (error) {
      state.persistentAllowed = false;
      state.vaultLocked = fs.existsSync(file);
      if (error.message === "OS_KEY_TIMEOUT") {
        state.available = false;
        state.message =
          "OSの鍵管理への確認待ちのため、一時セッションで起動しました。既存データは維持しています。Macの確認を完了してからアプリを再起動してください。";
      } else
        state.message =
          "保存トークンまたは保護設定を読み込めませんでした。元のファイルを維持し、一時セッションで動作します。";
    }
  }
  function change(transform) {
    const next = queue
      .catch(() => {})
      .then(async () => {
        if (!state.available || state.vaultLocked)
          throw new Error(
            "暗号化ストレージを利用できません。トークンは一時利用にしてください。",
          );
        const updated = new Map(entries);
        transform(updated);
        const plain = JSON.stringify([...updated]);
        if (Buffer.byteLength(plain) > 1024 * 1024)
          throw new Error("保存トークンの容量上限に達しました。");
        const encrypted = await withDeadline(
          () => safeStorage.encryptStringAsync(plain),
          timeoutMs,
        );
        atomic(
          file,
          JSON.stringify({ version: 1, data: encrypted.toString("base64") }),
        );
        entries = updated;
      });
    queue = next;
    return next;
  }
  return {
    init,
    status: () => ({ ...state }),
    get: (key) => entries.get(key),
    set: (key, value) => change((map) => map.set(key, value)),
    remove: (key) =>
      entries.has(key) ? change((map) => map.delete(key)) : Promise.resolve(),
    removeSession: (id) =>
      state.vaultLocked ||
      ![...entries.keys()].some((k) => k.startsWith(`${id}|`))
        ? Promise.resolve()
        : change((map) => {
            for (const key of map.keys())
              if (key.startsWith(`${id}|`)) map.delete(key);
          }),
    async migrateCookies(ses, id) {
      if (!state.persistentAllowed || migrations.profiles.includes(id)) return;
      try {
        const cookies = await withDeadline(
          () => ses.cookies.get({}),
          timeoutMs,
        );
        for (const cookie of cookies)
          await withDeadline(
            () => ses.cookies.set(cookieDetails(cookie)),
            timeoutMs,
          );
        await withDeadline(() => ses.cookies.flushStore(), timeoutMs);
        migrations.profiles.push(id);
        atomic(migrationFile, JSON.stringify(migrations));
        state.migratedCookies += cookies.length;
      } catch {
        state.available = false;
        state.persistentAllowed = false;
        state.message =
          "Cookieの暗号化を確認できないため、一時セッションで起動しました。既存データは維持しています。OSの鍵管理へのアクセスを許可してから再起動してください。";
      }
    },
  };
}
module.exports = {
  cookieFuse,
  cookieDetails,
  atomic,
  createProtection,
  withDeadline,
};
