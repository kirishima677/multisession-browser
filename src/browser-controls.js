const {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  nativeImage,
  shell,
  safeStorage,
} = require("electron");
const { pageURL } = require("./browser-library");
const { browserMenuTemplate } = require("./browser-menu");
const { contextMenuTemplate } = require("./context-menu");

function createBrowserControls({
  getWindow,
  createWindow,
  workspace,
  sessions,
  getLibrary,
  getLibraryWindow,
  getPageActions,
  getUpdateChecker,
  runCommand,
  publish,
}) {
  function currentPage() {
    const t = workspace.current();
    if (!t || (t.kind && t.kind !== "web") || t.view.webContents.isDestroyed())
      return null;
    try {
      const url = pageURL(t.view.webContents.getURL());
      return {
        tabId: t.id,
        sessionId: t.sessionId,
        url,
        title: (t.view.webContents.getTitle() || new URL(url).hostname).slice(
          0,
          200,
        ),
        bookmark: getLibrary()?.find(t.sessionId, url) || null,
      };
    } catch {
      return null;
    }
  }
  async function openLibraryEntry(kind, id) {
    if (!["history", "bookmarks"].includes(kind))
      throw new Error("一覧の種類が不正です。");
    const entry = getLibrary().get(kind, id);
    if (!entry) throw new Error("項目が見つかりません。");
    sessions.profileFor(entry.sessionId);
    if (workspace.overlay)
      throw new Error("構成・設定の画面を閉じてから開いてください。");
    if (!getWindow() || getWindow().isDestroyed()) createWindow();
    const t = workspace.createTab(entry.sessionId, entry.url);
    getWindow().show();
    getWindow().focus();
    t.view.webContents.focus();
  }
  function zoomPage(direction) {
    const t = workspace.current();
    if (!t || t.kind === "terminal")
      throw new Error("このタブではズームできません。");
    const levels = [
        0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5,
        3, 4, 5,
      ],
      old = t.view.webContents.getZoomFactor();
    const value =
      direction === "reset"
        ? 1
        : direction === "in"
          ? levels.find((v) => v > old + 0.001) || 5
          : direction === "out"
            ? [...levels].reverse().find((v) => v < old - 0.001) || 0.25
            : null;
    if (!value) throw new Error("ズームの指定が不正です。");
    t.view.webContents.setZoomFactor(value);
    publish();
  }
  function showBrowserMenu(p = {}) {
    const t = workspace.current(),
      contents = t?.view.webContents,
      page = currentPage();
    const decorate = (entries) =>
      entries.map((entry) => ({
        ...entry,
        sessionName: sessions.profileFor(entry.sessionId).name,
      }));
    const safe = (fn) => () =>
      Promise.resolve()
        .then(fn)
        .catch((error) =>
          getPageActions().report(contents, "操作できませんでした", error),
        );
    const template = browserMenuTemplate(
      {
        history: decorate(getLibrary().recent("history")),
        bookmarks: decorate(getLibrary().recent("bookmarks")),
        bookmarked: Boolean(page?.bookmark),
        canBookmark: Boolean(page),
        zoom: contents?.getZoomFactor() || 1,
        canZoom: Boolean(
          t && t.kind !== "terminal" && (page || t.kind === "api"),
        ),
        webPage: Boolean(page),
        hasTab: Boolean(t),
      },
      {
        shortcut,
        openLibrary: (page) => getLibraryWindow().open(page),
        openEntry: (kind, id) => safe(() => openLibraryEntry(kind, id))(),
        zoom: (direction) => safe(() => zoomPage(direction))(),
        find: safe(() => getPageActions().openFind(contents)),
        save: safe(() => getPageActions().savePage(contents)),
        savePDF: safe(() => getPageActions().savePDF(contents)),
        print: safe(() => getPageActions().printPage(contents)),
        fullscreen: () =>
          getWindow().setFullScreen(!getWindow().isFullScreen()),
        tools: (page) => safe(() => runCommand("open-test-tools", { page }))(),
        devtools,
        checkUpdates: () => {
          shortcut("app-info");
          getUpdateChecker().check();
        },
        quit: () => app.quit(),
      },
    );
    const options = { window: getWindow() };
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
      const [width, height] = getWindow().getContentSize();
      options.x = Math.max(0, Math.min(width, Math.round(p.x)));
      options.y = Math.max(0, Math.min(height, Math.round(p.y)));
    }
    Menu.buildFromTemplate(template).popup(options);
  }
  function openDevtools(contents, profile) {
    if (contents.isDestroyed()) return;
    if (contents.isDevToolsOpened()) {
      contents.devToolsWebContents?.focus();
      return;
    }
    contents.once("devtools-opened", () => {
      const toolWindow = BrowserWindow.fromWebContents(
        contents.devToolsWebContents,
      );
      toolWindow?.setTitle(`${profile.name} — DevTools`);
    });
    contents.openDevTools({
      mode: "detach",
      title: `${profile.name} — DevTools`,
    });
  }
  function devtools() {
    const t = workspace.current();
    if (t) openDevtools(t.view.webContents, sessions.profileFor(t.sessionId));
  }
  function installContextMenu(contents, profile) {
    contents.on("context-menu", (_event, params) => {
      const template = contextMenuTemplate(contents, params, {
        clipboard,
        nativeImage,
        shell,
        safeStorage,
        browserPage: Boolean(profile),
        openTab: profile
          ? (url) => workspace.createTab(profile.id, url)
          : undefined,
        download: profile
          ? (url, kind) => getPageActions().download(contents, url, kind)
          : undefined,
        savePage: profile
          ? () => getPageActions().savePage(contents)
          : undefined,
        savePDF: profile ? () => getPageActions().savePDF(contents) : undefined,
        printPage: profile
          ? () => getPageActions().printPage(contents)
          : undefined,
        findPage: profile
          ? (query) => getPageActions().openFind(contents, query)
          : undefined,
        onError: (error) =>
          getPageActions().report(contents, "操作できませんでした", error),
        inspect: (target, x, y) => {
          openDevtools(target, profile);
          target.inspectElement(x, y);
        },
      });
      if (!template.length) return;
      const owner = BrowserWindow.fromWebContents(contents) || getWindow();
      Menu.buildFromTemplate(template).popup({
        window: owner,
        frame: params.frame || undefined,
      });
    });
  }
  function shortcut(name) {
    if (!getWindow() || getWindow().isDestroyed()) return;
    getWindow().show();
    getWindow().focus();
    if (name === "address" && workspace.current()?.kind === "terminal") {
      workspace.current().view.webContents.focus();
      return;
    }
    if (name === "address" && workspace.current()?.kind === "api") {
      workspace.current().view.webContents.focus();
      workspace.current().view.webContents.send("api-client:focus-url");
      return;
    }
    getWindow().webContents.focus();
    getWindow().webContents.send("browser:shortcut", name);
  }
  function installKeyboard(contents) {
    contents.on("before-input-event", (event, input) => {
      if (
        input.type !== "keyDown" ||
        !(process.platform === "darwin" ? input.meta : input.control)
      )
        return;
      const key = input.key.toLowerCase();
      let action;
      if (!input.alt && !input.shift && key === "f")
        action = () =>
          getPageActions().openFind(
            contents === getWindow()?.webContents
              ? workspace.current()?.view.webContents
              : contents,
          );
      if (!input.alt && !input.shift && key === "p")
        action = () => {
          const target =
            contents === getWindow()?.webContents
              ? workspace.current()?.view.webContents
              : contents;
          if (target) getPageActions().printPage(target);
        };
      if (!input.alt && !input.shift && key === "l")
        action = () => shortcut("address");
      if (!input.alt && !input.shift && key === "d")
        action = () => shortcut("bookmark-page");
      if (
        !input.alt &&
        !input.shift &&
        ((process.platform === "darwin" && key === "y") ||
          (process.platform !== "darwin" && key === "h"))
      )
        action = () => getLibraryWindow().open("history");
      if (!input.alt && input.shift && key === "o")
        action = () => getLibraryWindow().open("bookmarks");
      if (!input.alt && ["+", "=", "-", "0"].includes(key))
        action = () => {
          if (workspace.current()?.kind !== "terminal")
            zoomPage(key === "0" ? "reset" : key === "-" ? "out" : "in");
        };
      if (!input.alt && !input.shift && key === "t")
        action = () => shortcut("new-tab");
      if (!input.alt && input.shift && key === "s")
        action = () => shortcut("save-workset");
      if (input.alt && !input.shift && key === "i") action = devtools;
      if (!input.alt && !input.shift && key === "r")
        action = () => {
          if (workspace.current()?.kind !== "terminal")
            workspace.current()?.view.webContents.reload();
        };
      if (!input.alt && !input.shift && key === "w")
        action = () => {
          const child = BrowserWindow.fromWebContents(contents);
          if (child && child !== getWindow()) child.close();
          else if (!workspace.overlay) runCommand("close-tab");
        };
      if (action) {
        event.preventDefault();
        action();
      }
    });
  }
  function installMenu() {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { label: "アプリ情報・設定…", click: () => shortcut("app-info") },
            {
              label: "アップデートを確認…",
              click: () => {
                shortcut("app-info");
                getUpdateChecker().check();
              },
            },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        },
        {
          label: "ファイル",
          submenu: [
            {
              label: "新しいターミナルタブ",
              accelerator: "CmdOrCtrl+Alt+J",
              click: () => shortcut("new-terminal-tab"),
            },
            {
              label: "新しいAPIタブ",
              accelerator: "CmdOrCtrl+Alt+T",
              click: () => shortcut("new-api-tab"),
            },
            {
              label: "新しいタブ",
              accelerator: "CmdOrCtrl+T",
              click: () => shortcut("new-tab"),
            },
            {
              label: "タブを閉じる",
              accelerator: "CmdOrCtrl+W",
              click: () => {
                const focused = BrowserWindow.getFocusedWindow();
                if (focused && focused !== getWindow()) focused.close();
                else if (!workspace.overlay) runCommand("close-tab");
              },
            },
            {
              label: "印刷…",
              accelerator: "CmdOrCtrl+P",
              click: () => {
                const target = getPageActions().focusedContents(
                  workspace.current()?.view.webContents,
                );
                if (target) getPageActions().printPage(target);
              },
            },
            {
              label: "作業セットを保存",
              accelerator: "CmdOrCtrl+Shift+S",
              click: () => shortcut("save-workset"),
            },
          ],
        },
        {
          label: "編集",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "pasteAndMatchStyle" },
            { role: "selectAll" },
          ],
        },
        {
          label: "履歴",
          submenu: [
            {
              label: "履歴をすべて表示…",
              accelerator: process.platform === "darwin" ? "Cmd+Y" : "Ctrl+H",
              click: () => getLibraryWindow().open("history"),
            },
          ],
        },
        {
          label: "ブックマーク",
          submenu: [
            {
              label: "このページをブックマーク…",
              accelerator: "CmdOrCtrl+D",
              click: () => shortcut("bookmark-page"),
            },
            {
              label: "ブックマークを管理…",
              accelerator: "CmdOrCtrl+Shift+O",
              click: () => getLibraryWindow().open("bookmarks"),
            },
          ],
        },
        {
          label: "表示",
          submenu: [
            {
              label: "JWT・トークンを確認…",
              click: () => runCommand("open-test-tools", { page: "auth" }),
            },
            {
              label: "応答を横断検索…",
              click: () => runCommand("open-test-tools", { page: "network" }),
            },
            { type: "separator" },
            {
              label: "ページ内を検索…",
              accelerator: "CmdOrCtrl+F",
              click: () =>
                getPageActions().openFind(
                  getPageActions().focusedContents(
                    workspace.current()?.view.webContents,
                  ),
                ),
            },
            {
              label: "URLを入力",
              accelerator: "CmdOrCtrl+L",
              click: () => shortcut("address"),
            },
            {
              label: "再読み込み",
              accelerator: "CmdOrCtrl+R",
              click: () => {
                if (workspace.current()?.kind !== "terminal")
                  workspace.current()?.view.webContents.reload();
              },
            },
            {
              label: "DevTools",
              accelerator: "CmdOrCtrl+Alt+I",
              click: devtools,
            },
            { type: "separator" },
            { role: "togglefullscreen" },
          ],
        },
        { role: "windowMenu" },
      ]),
    );
  }
  return {
    currentPage,
    openLibraryEntry,
    zoomPage,
    showBrowserMenu,
    devtools,
    installContextMenu,
    shortcut,
    installKeyboard,
    installMenu,
  };
}

module.exports = { createBrowserControls };
