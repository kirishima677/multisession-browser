const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { downloadableURL } = require("./context-menu");

function createPageActions(getMainWindow) {
  const finders = new Map();
  const findURL = pathToFileURL(path.join(__dirname, "find.html")).href;
  const owner = (contents) =>
    (contents && !contents.isDestroyed()
      ? BrowserWindow.fromWebContents(contents)
      : null) || getMainWindow();
  function report(contents, message, error) {
    const parent = owner(contents);
    if (!parent || parent.isDestroyed()) return;
    dialog
      .showMessageBox(parent, {
        type: "error",
        message,
        detail: error?.message || String(error || ""),
        buttons: ["OK"],
      })
      .catch(() => {});
  }
  function finderState(entry) {
    return { query: entry.query, matches: entry.matches, active: entry.active };
  }
  function notify(entry) {
    if (!entry.window.isDestroyed())
      entry.window.webContents.send("page-find:state", finderState(entry));
  }
  function runFind(entry, query, forward = true, next = false) {
    if (typeof query !== "string" || query.length > 2048)
      throw new Error("検索語は2048文字以内で入力してください。");
    if (entry.contents.isDestroyed())
      throw new Error("検索対象のページは閉じられました。");
    if (entry.query !== query) {
      entry.matches = 0;
      entry.active = 0;
    }
    entry.query = query;
    if (!query) {
      entry.requestId = null;
      entry.matches = 0;
      entry.active = 0;
      entry.contents.stopFindInPage("clearSelection");
      notify(entry);
      return;
    }
    entry.requestId = entry.contents.findInPage(query, {
      forward,
      findNext: next,
    });
  }
  function openFind(contents, initial = "") {
    if (!contents || contents.isDestroyed()) return;
    let entry = finders.get(contents.id);
    if (entry) {
      if (initial) runFind(entry, initial.slice(0, 2048));
      entry.window.show();
      entry.window.focus();
      entry.window.webContents.send("page-find:focus");
      return;
    }
    const parent = owner(contents);
    const panel = new BrowserWindow({
      parent,
      width: 450,
      height: 142,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: `ページ内検索 — ${contents.getTitle() || "ページ"}`,
      show: false,
      backgroundColor: "#f6f8fd",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, "find-preload.js"),
      },
    });
    entry = {
      id: contents.id,
      window: panel,
      contents,
      query: "",
      matches: 0,
      active: 0,
      requestId: null,
    };
    finders.set(contents.id, entry);
    const found = (_event, result) => {
      if (result.requestId !== entry.requestId) return;
      entry.matches = result.matches;
      entry.active = result.activeMatchOrdinal;
      notify(entry);
    };
    const reset = () => {
      entry.requestId = null;
      entry.matches = 0;
      entry.active = 0;
      notify(entry);
    };
    const loaded = () => {
      if (entry.query) runFind(entry, entry.query);
    };
    const destroyed = () => {
      if (!panel.isDestroyed()) panel.destroy();
    };
    contents.on("found-in-page", found);
    contents.on("did-start-loading", reset);
    contents.on("did-finish-load", loaded);
    contents.once("destroyed", destroyed);
    panel.webContents.on("will-navigate", (event) => event.preventDefault());
    panel.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    panel.once("ready-to-show", () => {
      panel.show();
      panel.focus();
    });
    panel.on("closed", () => {
      finders.delete(entry.id);
      if (!contents.isDestroyed()) {
        contents.removeListener("found-in-page", found);
        contents.removeListener("did-start-loading", reset);
        contents.removeListener("did-finish-load", loaded);
        contents.removeListener("destroyed", destroyed);
        contents.stopFindInPage("clearSelection");
      }
    });
    panel.loadFile(path.join(__dirname, "find.html"));
    if (initial) runFind(entry, initial.slice(0, 2048));
  }
  function authorized(event) {
    const entry = [...finders.values()].find(
      (item) =>
        !item.window.isDestroyed() && item.window.webContents === event.sender,
    );
    if (
      !entry ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== findURL
    )
      throw new Error("許可されていない検索操作です。");
    return entry;
  }
  ipcMain.handle("page-find:command", (event, action, payload = {}) => {
    const entry = authorized(event);
    try {
      if (action === "search") runFind(entry, payload.query);
      else if (action === "next" || action === "previous")
        runFind(entry, entry.query, action === "next", true);
      else if (action !== "state") throw new Error("未対応の検索操作です。");
      return finderState(entry);
    } catch (error) {
      return { error: error.message };
    }
  });
  ipcMain.on("page-find:close", (event) => {
    try {
      authorized(event).window.close();
    } catch {
      /* Ignore late close messages from a destroyed search window. */
    }
  });
  async function savePage(contents) {
    const title = (contents.getTitle() || "page")
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
      .slice(0, 100);
    const result = await dialog.showSaveDialog(owner(contents), {
      title: "ページを別名で保存",
      defaultPath: path.join(app.getPath("downloads"), `${title}.mhtml`),
      filters: [{ name: "Webアーカイブ", extensions: ["mhtml"] }],
      properties: ["showOverwriteConfirmation"],
    });
    if (result.canceled || !result.filePath || contents.isDestroyed()) return;
    await contents.savePage(result.filePath, "MHTML");
  }
  function printPage(contents) {
    contents.print(
      { silent: false, printBackground: true },
      (success, reason) => {
        if (!success && !/cancel/i.test(reason || ""))
          report(contents, "印刷できませんでした", reason);
      },
    );
  }
  function download(contents, url, kind) {
    if (!downloadableURL(url, kind))
      throw new Error("このリソースは保存できません。");
    contents.downloadURL(url);
  }
  function focusedContents(fallback) {
    const focused = BrowserWindow.getFocusedWindow();
    const finder = [...finders.values()].find(
      (entry) => entry.window === focused,
    );
    if (finder) return finder.contents;
    if (focused && focused !== getMainWindow()) return focused.webContents;
    return fallback;
  }
  return { openFind, savePage, printPage, download, report, focusedContents };
}
module.exports = { createPageActions };
