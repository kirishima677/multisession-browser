const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { atomic, withDeadline } = require("./protection");
const MAX_HISTORY = 2000,
  MAX_BOOKMARKS = 2000,
  MAX_BYTES = 4 * 1024 * 1024;
function pageURL(value) {
  if (typeof value !== "string" || value.length > 16384)
    throw new Error("URLは16384文字以内で入力してください。");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("認証情報を含まないhttp/httpsのURLを指定してください。");
  return url.href;
}
function title(value, url) {
  if (typeof value !== "string" || value.trim().length > 200)
    throw new Error("名前は200文字以内で入力してください。");
  return value.trim() || new URL(url).hostname;
}
function validateLibrary(data) {
  if (
    data?.version !== 1 ||
    !Array.isArray(data.history) ||
    !Array.isArray(data.bookmarks) ||
    data.history.length > MAX_HISTORY ||
    data.bookmarks.length > MAX_BOOKMARKS
  )
    throw new Error("履歴・ブックマークの形式が不正です。");
  for (const [kind, items] of [
    ["history", data.history],
    ["bookmarks", data.bookmarks],
  ]) {
    const ids = new Set();
    for (const item of items) {
      if (
        !item ||
        !/^[a-f0-9-]{36}$/.test(item.id) ||
        ids.has(item.id) ||
        !/^[a-f0-9-]{36}$/.test(item.sessionId) ||
        pageURL(item.url) !== item.url ||
        typeof item.title !== "string" ||
        item.title.length > 200 ||
        !Number.isFinite(
          Date.parse(kind === "history" ? item.visitedAt : item.updatedAt),
        )
      )
        throw new Error("履歴・ブックマークの項目が不正です。");
      ids.add(item.id);
    }
  }
  return data;
}
function createBrowserLibrary({
  directory,
  safeStorage,
  canPersist,
  getSessions,
  publish,
  timeoutMs = 5000,
}) {
  const file = path.join(directory, "browser-library.enc.json");
  let history = [],
    bookmarks = [],
    revision = 0,
    savedRevision = 0,
    pending = null,
    timer,
    stopped = false,
    lastDeleted = null;
  let locked = false,
    storageError = "";
  const visitIDs = new Map();
  const sessions = () => new Map(getSessions().map((s) => [s.id, s]));
  const writable = () => canPersist() && !locked;
  function persisted() {
    const profiles = sessions();
    return {
      version: 1,
      history: history.filter((h) => profiles.get(h.sessionId)?.persistent),
      bookmarks: bookmarks.filter((b) => profiles.has(b.sessionId)),
    };
  }
  function boundHistory() {
    while (history.length > MAX_HISTORY) history.shift();
    while (
      Buffer.byteLength(JSON.stringify(persisted())) > MAX_BYTES &&
      history.length
    )
      history.shift();
  }
  function checkBookmarkCapacity(items) {
    if (items.length > MAX_BOOKMARKS)
      throw new Error("ブックマークは2000件まで保存できます。");
    if (
      Buffer.byteLength(
        JSON.stringify({ version: 1, history: [], bookmarks: items }),
      ) > MAX_BYTES
    )
      throw new Error("ブックマークの保存容量の上限です。");
  }
  function changed() {
    revision++;
    publish();
    if (!stopped && writable()) {
      clearTimeout(timer);
      timer = setTimeout(() => flush(), 500);
      timer.unref();
    }
  }
  async function flush() {
    clearTimeout(timer);
    if (!writable() || savedRevision === revision) return;
    if (pending) {
      await pending;
      if (savedRevision !== revision && writable()) return flush();
      return;
    }
    const current = revision,
      plain = JSON.stringify(persisted());
    if (Buffer.byteLength(plain) > MAX_BYTES) {
      storageError = "履歴・ブックマークの保存容量の上限です。";
      publish();
      return;
    }
    pending = (async () => {
      try {
        const encrypted = await withDeadline(
          () => safeStorage.encryptStringAsync(plain),
          timeoutMs,
        );
        atomic(
          file,
          JSON.stringify({ version: 1, data: encrypted.toString("base64") }),
        );
        savedRevision = current;
      } catch {
        locked = true;
        storageError =
          "暗号化した保存ファイルを更新できません。変更はこの起動中のみ保持し、既存ファイルは維持します。OSの鍵管理を確認して再起動してください。";
      } finally {
        pending = null;
        publish();
        if (!stopped && writable() && savedRevision !== revision) {
          timer = setTimeout(() => flush(), 500);
          timer.unref();
        }
      }
    })();
    await pending;
  }
  async function init() {
    if (!fs.existsSync(file)) return;
    if (!writable()) {
      locked = true;
      storageError =
        "暗号化した履歴・ブックマークを読み込めません。既存ファイルを維持し、この起動中のデータのみ表示します。";
      return;
    }
    try {
      if (fs.statSync(file).size > 8 * 1024 * 1024) throw new Error("size");
      const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
      if (envelope.version !== 1 || typeof envelope.data !== "string")
        throw new Error("format");
      const decrypted = await withDeadline(
        () =>
          safeStorage.decryptStringAsync(Buffer.from(envelope.data, "base64")),
        timeoutMs,
      );
      if (Buffer.byteLength(decrypted.result) > MAX_BYTES)
        throw new Error("size");
      const data = validateLibrary(JSON.parse(decrypted.result)),
        profiles = sessions();
      history = data.history.filter(
        (h) => profiles.get(h.sessionId)?.persistent,
      );
      bookmarks = data.bookmarks.filter((b) => profiles.has(b.sessionId));
      if (decrypted.shouldReEncrypt) {
        revision++;
        await flush();
      }
    } catch {
      locked = true;
      storageError =
        "履歴・ブックマークを読み込めません。既存ファイルを維持し、この起動中のデータのみ表示します。";
    }
  }
  const get = (kind, id) =>
    (kind === "history" ? history : bookmarks).find((item) => item.id === id);
  function find(sessionId, url) {
    try {
      const canonical = pageURL(url);
      return bookmarks.find(
        (b) => b.sessionId === sessionId && b.url === canonical,
      );
    } catch {
      return undefined;
    }
  }
  function summary() {
    return {
      historyCount: history.length,
      bookmarkCount: bookmarks.length,
      writable: writable(),
      message:
        storageError ||
        (writable()
          ? "履歴・ブックマークはOSの鍵で暗号化して保存します。一時セッションの履歴は終了時に破棄します。"
          : "履歴・ブックマークの変更はこの起動中のみ保持します。"),
      undoAvailable: Boolean(lastDeleted),
      maxHistory: MAX_HISTORY,
    };
  }
  function record(sessionId, url, pageTitle, contentsId) {
    const profile = sessions().get(sessionId);
    if (!profile) return;
    let canonical;
    try {
      canonical = pageURL(url);
    } catch {
      return;
    }
    const previous = get("history", visitIDs.get(contentsId));
    const now = new Date().toISOString();
    if (
      previous &&
      previous.url === canonical &&
      Date.now() - Date.parse(previous.visitedAt) < 3000
    ) {
      previous.visitedAt = now;
      previous.title = String(pageTitle || canonical).slice(0, 200);
    } else {
      const entry = {
        id: randomUUID(),
        sessionId,
        url: canonical,
        title: String(pageTitle || canonical).slice(0, 200),
        visitedAt: now,
      };
      history.push(entry);
      visitIDs.set(contentsId, entry.id);
    }
    boundHistory();
    changed();
  }
  return {
    init,
    flush,
    summary,
    find,
    get,
    recent: (kind) =>
      [...(kind === "history" ? history : bookmarks)]
        .sort(
          (a, b) =>
            Date.parse(b.visitedAt || b.updatedAt) -
            Date.parse(a.visitedAt || a.updatedAt),
        )
        .slice(0, 20),
    list({ kind, query = "", sessionId = "", offset = 0 } = {}) {
      if (
        !["history", "bookmarks"].includes(kind) ||
        typeof query !== "string" ||
        query.length > 512 ||
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset > MAX_HISTORY
      )
        throw new Error("一覧の検索条件が不正です。");
      const needle = query.toLocaleLowerCase(),
        profiles = sessions();
      const items = [...(kind === "history" ? history : bookmarks)]
        .filter(
          (item) =>
            (!sessionId || item.sessionId === sessionId) &&
            (!needle ||
              `${item.title}\n${item.url}`
                .toLocaleLowerCase()
                .includes(needle)),
        )
        .sort(
          (a, b) =>
            Date.parse(b.visitedAt || b.updatedAt) -
            Date.parse(a.visitedAt || a.updatedAt),
        );
      return {
        items: items
          .slice(offset, offset + 100)
          .map((item) => ({
            ...item,
            sessionName:
              profiles.get(item.sessionId)?.name || "削除済みセッション",
            temporary: !profiles.get(item.sessionId)?.persistent,
          })),
        total: items.length,
        offset,
        hasMore: items.length > offset + 100,
        ...summary(),
      };
    },
    record,
    track(contents, sessionId) {
      contents.on("did-navigate", (_event, url) =>
        record(sessionId, url, contents.getTitle(), contents.id),
      );
      contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
        if (isMainFrame)
          record(sessionId, url, contents.getTitle(), contents.id);
      });
      contents.on("page-title-updated", (_event, pageTitle) => {
        const entry = get("history", visitIDs.get(contents.id));
        if (entry && entry.url === contents.getURL()) {
          entry.title = String(pageTitle).slice(0, 200);
          changed();
        }
      });
      contents.once("destroyed", () => visitIDs.delete(contents.id));
    },
    async saveBookmark(input) {
      if (!sessions().has(input.sessionId))
        throw new Error("セッションが見つかりません。");
      const url = pageURL(input.url),
        name = title(input.title, url),
        duplicate = find(input.sessionId, url);
      let entry = input.id ? get("bookmarks", input.id) : duplicate;
      if (input.id && !entry) throw new Error("ブックマークが見つかりません。");
      if (duplicate && entry && duplicate.id !== entry.id)
        throw new Error("このセッションに同じURLのブックマークがあります。");
      const next = {
        id: entry?.id || randomUUID(),
        sessionId: input.sessionId,
        url,
        title: name,
        updatedAt: new Date().toISOString(),
      };
      const updated = bookmarks.filter((b) => b.id !== next.id).concat(next);
      checkBookmarkCapacity(updated);
      bookmarks = updated;
      boundHistory();
      changed();
      await flush();
      return { ...next, persisted: writable() && savedRevision === revision };
    },
    async removeBookmark(id) {
      const entry = get("bookmarks", id);
      if (!entry) throw new Error("ブックマークが見つかりません。");
      lastDeleted = { ...entry };
      bookmarks = bookmarks.filter((b) => b.id !== id);
      changed();
      await flush();
    },
    async undoBookmark() {
      if (!lastDeleted) return;
      if (!sessions().has(lastDeleted.sessionId))
        throw new Error("元のセッションがありません。");
      if (find(lastDeleted.sessionId, lastDeleted.url))
        throw new Error("同じURLのブックマークがあります。");
      checkBookmarkCapacity([...bookmarks, lastDeleted]);
      bookmarks.push(lastDeleted);
      lastDeleted = null;
      boundHistory();
      changed();
      await flush();
    },
    async clearHistory(sessionId = "") {
      if (sessionId && !sessions().has(sessionId))
        throw new Error("セッションが見つかりません。");
      history = sessionId
        ? history.filter((h) => h.sessionId !== sessionId)
        : [];
      changed();
      await flush();
    },
    async removeSession(id, remove) {
      history = history.filter((h) => h.sessionId !== id);
      if (remove) bookmarks = bookmarks.filter((b) => b.sessionId !== id);
      if (lastDeleted?.sessionId === id) lastDeleted = null;
      changed();
      await flush();
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await flush();
    },
  };
}
module.exports = {
  createBrowserLibrary,
  validateLibrary,
  pageURL,
  MAX_HISTORY,
  MAX_BOOKMARKS,
  MAX_BYTES,
};
