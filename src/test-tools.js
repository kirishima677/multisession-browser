const { BrowserWindow, ipcMain, clipboard } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
function createTestTools({
  getConfig,
  getTabs,
  auth,
  capture,
  protection,
  activateSource,
  securePreferences,
  installContextMenu,
}) {
  const file = path.join(__dirname, "test-tools.html"),
    url = pathToFileURL(file).href;
  let window,
    context = { page: "auth", sessionId: "", url: "", epoch: 0 },
    revision = 0,
    queue = Promise.resolve();
  function snapshot() {
    return {
      revision: ++revision,
      context,
      sessions: getConfig().sessions.map(({ id, name, color }) => ({
        id,
        name,
        color,
      })),
      tabs: getTabs(),
      capture: capture.status(),
      protection: protection.status(),
    };
  }
  function publish() {
    if (window && !window.isDestroyed())
      window.webContents.send("test-tools:state", snapshot());
  }
  function open(input) {
    context = { ...context, ...input, epoch: context.epoch + 1 };
    if (window && !window.isDestroyed()) {
      window.show();
      window.focus();
      publish();
      return;
    }
    window = new BrowserWindow({
      width: 1180,
      height: 850,
      minWidth: 800,
      minHeight: 600,
      title: "認証・応答検索 — Multisession Browser",
      backgroundColor: "#f5f7fb",
      webPreferences: {
        ...securePreferences,
        preload: path.join(__dirname, "test-tools-preload.js"),
      },
    });
    window.webContents.on("will-navigate", (e) => e.preventDefault());
    window.webContents.on("will-redirect", (e) => e.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-attach-webview", (e) => e.preventDefault());
    installContextMenu(window.webContents);
    window.webContents.on("did-finish-load", publish);
    window.on("closed", () => {
      window = null;
    });
    window.loadFile(file);
  }
  function authorize(event) {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== url
    )
      throw new Error("許可されていないテストツール操作です。");
  }
  const decorate = (record) => ({
    ...record,
    sessionName:
      getConfig().sessions.find((s) => s.id === record.sessionId)?.name ||
      "削除済みセッション",
    sourceOpen: getTabs().some((t) => t.id === record.tabId),
  });
  ipcMain.handle("test-tools:command", async (event, action, p = {}) => {
    authorize(event);
    try {
      if (!p || typeof p !== "object")
        throw new Error("操作の形式が不正です。");
      if (action === "state") return snapshot();
      if (action === "auth-list") return await auth.list(p);
      if (action === "auth-select" || action === "auth-manual") {
        const task = queue
          .catch(() => {})
          .then(() =>
            action === "auth-select" ? auth.select(p) : auth.manual(p),
          );
        queue = task;
        return await task;
      }
      if (action === "auth-copy" || action === "auth-reveal") {
        const token = await auth.value(p);
        if (action === "auth-reveal") return { value: token.value };
        if (!["value", "cookie"].includes(p.format))
          throw new Error("コピー形式が不正です。");
        clipboard.writeText(
          p.format === "cookie" ? `${token.name}=${token.value}` : token.value,
        );
        return { copied: true };
      }
      if (action === "recording") {
        await capture.setRecording(p.enabled);
        return snapshot();
      }
      if (action === "clear-responses") {
        capture.clear();
        return snapshot();
      }
      if (action === "search") {
        const result = capture.store.search(p);
        return { ...result, results: result.results.map(decorate) };
      }
      const record = capture.store.get(p.id);
      if (!record)
        throw new Error(
          "応答が見つかりません。保持上限やクリアにより削除された可能性があります。",
        );
      if (action === "response") return decorate(record);
      if (action === "activate-source") {
        activateSource(record);
        return { activated: true };
      }
      if (action === "copy-selection") {
        if (
          !Number.isInteger(p.start) ||
          !Number.isInteger(p.end) ||
          p.start < 0 ||
          p.end > record.body.length ||
          p.start >= p.end
        )
          throw new Error("応答本文でコピーする範囲を選択してください。");
        clipboard.writeText(record.body.slice(p.start, p.end));
        return { copied: true };
      }
      throw new Error("未対応のテストツール操作です。");
    } catch (error) {
      return { error: error.message };
    }
  });
  return { open, publish, close: () => window?.close() };
}
module.exports = { createTestTools };
