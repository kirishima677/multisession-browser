const { BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
function createLibraryWindow({
  library,
  getSessions,
  openEntry,
  securePreferences,
  installContextMenu,
}) {
  const file = path.join(__dirname, "library.html"),
    url = pathToFileURL(file).href;
  let window,
    revision = 0,
    context = { page: "history", epoch: 0 };
  function state() {
    return {
      revision: ++revision,
      context,
      sessions: getSessions().map(({ id, name, color }) => ({
        id,
        name,
        color,
      })),
      storage: library.summary(),
    };
  }
  function publish() {
    if (window && !window.isDestroyed())
      window.webContents.send("library:state", state());
  }
  function open(page) {
    if (!["history", "bookmarks"].includes(page))
      throw new Error("一覧の種類が不正です。");
    context = { page, epoch: context.epoch + 1 };
    if (window && !window.isDestroyed()) {
      window.show();
      window.focus();
      publish();
      return;
    }
    window = new BrowserWindow({
      width: 1020,
      height: 780,
      minWidth: 720,
      minHeight: 540,
      title: "履歴・ブックマーク — Multisession Browser",
      backgroundColor: "#f6f8fc",
      webPreferences: {
        ...securePreferences,
        preload: path.join(__dirname, "library-preload.js"),
      },
    });
    window.webContents.on("will-navigate", (e) => e.preventDefault());
    window.webContents.on("will-redirect", (e) => e.preventDefault());
    window.webContents.on("will-attach-webview", (e) => e.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    installContextMenu(window.webContents);
    window.webContents.on("did-finish-load", publish);
    window.on("closed", () => {
      window = null;
    });
    window.loadFile(file);
  }
  ipcMain.handle("library:command", async (event, action, p = {}) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== url
    )
      throw new Error("許可されていない履歴・ブックマーク操作です。");
    try {
      if (!p || typeof p !== "object")
        throw new Error("操作の形式が不正です。");
      if (action === "state") return state();
      if (action === "list") return library.list(p);
      if (action === "save-bookmark") {
        const item = await library.saveBookmark(p);
        publish();
        return { item, ...state() };
      }
      if (action === "remove-bookmark") await library.removeBookmark(p.id);
      else if (action === "undo-bookmark") await library.undoBookmark();
      else if (action === "clear-history") {
        const profile = p.sessionId
          ? getSessions().find((s) => s.id === p.sessionId)
          : null;
        if (p.sessionId && !profile)
          throw new Error("セッションが見つかりません。");
        const result = await dialog.showMessageBox(window, {
          type: "question",
          message: profile
            ? `${profile.name}の閲覧履歴を削除しますか？`
            : "すべての閲覧履歴を削除しますか？",
          detail: "Cookie、ログイン状態、ブックマークは維持します。",
          buttons: ["キャンセル", "履歴を削除"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response === 1)
          await library.clearHistory(p.sessionId || "");
      } else if (action === "open-entry") {
        if (!["history", "bookmarks"].includes(p.kind))
          throw new Error("一覧の種類が不正です。");
        await openEntry(p.kind, p.id);
        return { opened: true };
      } else throw new Error("未対応の履歴・ブックマーク操作です。");
      publish();
      return state();
    } catch (error) {
      return { error: error.message };
    }
  });
  return { open, publish, close: () => window?.close() };
}
module.exports = { createLibraryWindow };
