const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  dialog,
  Menu,
  clipboard,
} = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const { contextMenuTemplate } = require("./context-menu");
const { createPageActions } = require("./page-actions");
const { reorderIds, splitForDrop, selectInSplit } = require("./tab-layout");
const {
  COLORS,
  label,
  normalizeURL,
  resolveAddressInput,
  allowedNavigation,
  makeSession,
  partitionFor,
  ConfigStore,
} = require("./model");

if (process.env.MSB_USER_DATA)
  app.setPath("userData", path.resolve(process.env.MSB_USER_DATA));
app.setName("Multisession Browser");
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
const runId = randomUUID();
let stateRevision = 0;
let pageActions;
const chrome = { sidebar: 236, top: 152, bottom: 28 };
const sitePreload = path.join(__dirname, "site-preload.js");
const shellURL = pathToFileURL(path.join(__dirname, "index.html")).href;
let win,
  config,
  store,
  activeId,
  overlay = false,
  mutation = false,
  split = null,
  draggingTab = false;
const tabs = new Map();
const configured = new Set();
const popups = new Map();
const tempEpochs = new Map();
const securePreferences = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
};

function persist() {
  store.save(config);
}
function profileFor(id) {
  const profile = config.sessions.find((s) => s.id === id);
  if (!profile) throw new Error("セッションが見つかりません。");
  return profile;
}
function current() {
  return tabs.get(activeId);
}
function state() {
  return {
    revision: ++stateRevision,
    sessions: config.sessions,
    worksets: config.worksets,
    colors: COLORS,
    activeId,
    split,
    draggingTab,
    tabs: [...tabs.values()].map((t) => ({
      id: t.id,
      sessionId: t.sessionId,
      title: t.title || "新しいタブ",
      url: t.view.webContents.getURL() || "about:blank",
      loading: t.view.webContents.isLoading(),
      error: t.error || "",
      authNotice: Boolean(t.authNotice),
      canGoBack: t.view.webContents.navigationHistory.canGoBack(),
      canGoForward: t.view.webContents.navigationHistory.canGoForward(),
    })),
  };
}
function publish() {
  if (win && !win.isDestroyed()) win.webContents.send("browser:state", state());
}
function activateTab(id) {
  split = selectInSplit(split, activeId, id);
  activeId = id;
}
function layout() {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  const top = chrome.top + (current()?.authNotice ? 52 : 0) + (split ? 34 : 0);
  const available = Math.max(0, width - chrome.sidebar);
  const leftWidth = Math.floor((available - 8) / 2);
  for (const t of tabs.values()) {
    const isRight = split?.right === t.id;
    t.view.setBounds({
      x: chrome.sidebar + (isRight ? leftWidth + 8 : 0),
      y: top,
      width: split
        ? Math.max(0, isRight ? available - leftWidth - 8 : leftWidth)
        : available,
      height: Math.max(0, height - top - chrome.bottom),
    });
    const visible =
      (split ? Object.values(split).includes(t.id) : t.id === activeId) &&
      !overlay &&
      !draggingTab &&
      t.view.webContents.getURL() !== "about:blank";
    if (t.view.getVisible() !== visible) t.view.setVisible(visible);
  }
}
function configuredSession(profile) {
  const partition = partitionFor(
    profile,
    `${runId}-${tempEpochs.get(profile.id) || 0}`,
  );
  const ses = session.fromPartition(partition);
  if (configured.has(partition)) return ses;
  configured.add(partition);
  ses.setPermissionCheckHandler(() => false);
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    let origin = details.requestingUrl || contents?.getURL() || "";
    try {
      origin = new URL(origin).origin;
    } catch {
      origin = "不明なサイト";
    }
    const ask =
      win &&
      !win.isDestroyed() &&
      [
        "media",
        "geolocation",
        "notifications",
        "clipboard-sanitized-write",
        "fullscreen",
      ].includes(permission);
    if (!ask) return callback(false);
    dialog
      .showMessageBox(win, {
        type: "question",
        title: "サイトの権限",
        message: `${profileFor(profile.id).name}：${permission} を許可しますか？`,
        detail: origin,
        buttons: ["許可しない", "今回のみ許可"],
        defaultId: 0,
        cancelId: 0,
      })
      .then(
        (result) => callback(result.response === 1),
        () => callback(false),
      );
  });
  ses.on("will-download", (_event, item, contents) => {
    item.setSaveDialogOptions({
      title: `${profile.name} — ダウンロード`,
      defaultPath: path.join(
        app.getPath("downloads"),
        path.basename(item.getFilename()),
      ),
    });
    item.once("done", (_event, state) => {
      if (state === "interrupted" && contents && !contents.isDestroyed())
        pageActions.report(
          contents,
          "ダウンロードできませんでした",
          "接続やアクセス権を確認して、もう一度お試しください。",
        );
    });
  });
  return ses;
}
function guardContents(contents, profile) {
  installKeyboard(contents);
  installContextMenu(contents, profile);
  contents.on("will-navigate", (event, url) => {
    if (!allowedNavigation(url)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!allowedNavigation(url)) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler((details) => {
    if (!allowedNavigation(details.url)) return { action: "deny" };
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        parent: win,
        width: 1000,
        height: 760,
        autoHideMenuBar: true,
        webPreferences: {
          ...securePreferences,
          preload: sitePreload,
          session: configuredSession(profile),
        },
      },
    };
  });
  contents.on("did-create-window", (child) => {
    popups.set(child.id, {
      window: child,
      sessionId: profile.id,
      openerId: contents.id,
    });
    guardContents(child.webContents, profile);
    const title = () =>
      child.setTitle(
        `${profileFor(profile.id).name} — ${child.webContents.getTitle() || "Popup"}`,
      );
    child.webContents.on("page-title-updated", (event) => {
      event.preventDefault();
      title();
    });
    title();
    child.on("closed", () => popups.delete(child.id));
  });
}
function createTab(sessionId, value = "about:blank") {
  const profile = profileFor(sessionId);
  const url = normalizeURL(value);
  const view = new WebContentsView({
    webPreferences: {
      ...securePreferences,
      preload: sitePreload,
      session: configuredSession(profile),
    },
  });
  const t = {
    id: randomUUID(),
    sessionId,
    view,
    title: "新しいタブ",
    error: "",
  };
  tabs.set(t.id, t);
  win.contentView.addChildView(view);
  view.setBackgroundColor("#ffffff");
  guardContents(view.webContents, profile);
  view.webContents.on("focus", () => {
    if (
      split &&
      Object.values(split).includes(t.id) &&
      activeId !== t.id &&
      !overlay &&
      !draggingTab
    ) {
      activeId = t.id;
      layout();
      publish();
    }
  });
  const update = () => {
    layout();
    publish();
  };
  view.webContents.on("page-title-updated", (_event, title) => {
    t.title = title;
    publish();
  });
  view.webContents.on(
    "did-start-navigation",
    (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) {
        t.authNotice = false;
        update();
      }
    },
  );
  view.webContents.on("did-start-loading", () => {
    t.error = "";
    update();
  });
  for (const event of [
    "did-stop-loading",
    "did-navigate",
    "did-navigate-in-page",
  ])
    view.webContents.on(event, update);
  view.webContents.on(
    "did-fail-load",
    (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) {
        t.error = `読み込みに失敗しました：${description} (${code})`;
        update();
      }
    },
  );
  view.webContents.on("render-process-gone", () => {
    t.error = "ページが停止しました。再読み込みしてください。";
    update();
  });
  activateTab(t.id);
  view.webContents.loadURL(url).catch(() => {});
  layout();
  publish();
  return t;
}
function closeTab(id, ensure = true) {
  const t = tabs.get(id);
  if (!t) return;
  // Close dependent authentication windows before destroying their opener.
  for (const { window: child, openerId } of [...popups.values()]) {
    if (openerId === t.view.webContents.id) child.destroy();
  }
  if (split && Object.values(split).includes(id)) {
    activeId = split.left === id ? split.right : split.left;
    split = null;
  }
  win.contentView.removeChildView(t.view);
  tabs.delete(id);
  t.view.webContents.close({ waitForBeforeUnload: false });
  if (activeId === id) activeId = [...tabs.keys()].at(-1);
  if (ensure && !tabs.size) createTab(config.sessions[0].id);
  layout();
  publish();
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
  const t = current();
  if (t) openDevtools(t.view.webContents, profileFor(t.sessionId));
}
function installContextMenu(contents, profile) {
  contents.on("context-menu", (_event, params) => {
    const template = contextMenuTemplate(contents, params, {
      clipboard,
      browserPage: Boolean(profile),
      openTab: profile ? (url) => createTab(profile.id, url) : undefined,
      download: profile
        ? (url, kind) => pageActions.download(contents, url, kind)
        : undefined,
      savePage: profile ? () => pageActions.savePage(contents) : undefined,
      printPage: profile ? () => pageActions.printPage(contents) : undefined,
      findPage: profile
        ? (query) => pageActions.openFind(contents, query)
        : undefined,
      onError: (error) =>
        pageActions.report(contents, "操作できませんでした", error),
      inspect: (target, x, y) => {
        openDevtools(target, profile);
        target.inspectElement(x, y);
      },
    });
    if (!template.length) return;
    const owner = BrowserWindow.fromWebContents(contents) || win;
    Menu.buildFromTemplate(template).popup({
      window: owner,
      frame: params.frame || undefined,
    });
  });
}
function originatingTab(contents) {
  let id = contents.id;
  const visited = new Set();
  while (!visited.has(id)) {
    visited.add(id);
    const tab = [...tabs.values()].find((t) => t.view.webContents.id === id);
    if (tab) return tab;
    const popup = [...popups.values()].find(
      (p) => !p.window.isDestroyed() && p.window.webContents.id === id,
    );
    if (!popup) return;
    id = popup.openerId;
  }
}
async function confirm(message, detail) {
  const result = await dialog.showMessageBox(win, {
    type: "warning",
    message,
    detail,
    buttons: ["キャンセル", "実行"],
    defaultId: 0,
    cancelId: 0,
  });
  return result.response === 1;
}
async function resetSession(id, remove) {
  const profile = profileFor(id);
  if (remove && config.sessions.length === 1)
    throw new Error("最後のセッションは削除できません。");
  if (
    !(await confirm(
      `${profile.name} を${remove ? "削除" : "初期化"}しますか？`,
      "このセッションのタブとポップアップを閉じ、Cookie・ストレージ・キャッシュを削除します。サーバー上のデータは削除されません。",
    ))
  )
    return;
  for (const { window: child, sessionId } of [...popups.values()])
    if (sessionId === id) child.destroy();
  for (const t of [...tabs.values()])
    if (t.sessionId === id) closeTab(t.id, false);
  const ses = configuredSession(profile);
  await ses.closeAllConnections();
  // clearData also removes service workers, caches and network credentials.
  await ses.clearData();
  await ses.clearAuthCache();
  if (remove) {
    config.sessions = config.sessions.filter((s) => s.id !== id);
    for (const w of config.worksets)
      w.tabs = w.tabs.filter((t) => t.sessionId !== id);
  }
  persist();
  if (!tabs.size) createTab((remove ? config.sessions[0] : profile).id);
}
async function command(action, p = {}) {
  if (!p || typeof p !== "object") throw new Error("操作が不正です。");
  switch (action) {
    case "state":
      break;
    case "overlay":
      overlay = Boolean(p.open);
      if (overlay) draggingTab = false;
      layout();
      break;
    case "create-tab":
      createTab(
        p.sessionId || current()?.sessionId || config.sessions[0].id,
        p.url,
      );
      break;
    case "select-tab":
      if (!tabs.has(p.id)) throw new Error("タブが見つかりません。");
      activateTab(p.id);
      win.webContents.focus();
      layout();
      if (!overlay && !draggingTab && current().view.getVisible())
        current().view.webContents.focus();
      break;
    case "reorder-tab": {
      const ids = reorderIds([...tabs.keys()], p.id, p.beforeId ?? null);
      const entries = ids.map((id) => [id, tabs.get(id)]);
      tabs.clear();
      for (const [id, tab] of entries) tabs.set(id, tab);
      break;
    }
    case "split-tab":
      split = splitForDrop([...tabs.keys()], activeId, split, p.id, p.side);
      activeId = p.id;
      layout();
      break;
    case "end-split":
      split = null;
      layout();
      break;
    case "tab-drag":
      if (p.active && (!tabs.has(p.id) || overlay))
        throw new Error("タブをドラッグできません。");
      draggingTab = Boolean(p.active);
      if (draggingTab) win.webContents.focus();
      layout();
      break;
    case "close-tab":
      closeTab(p.id || activeId);
      break;
    case "navigate": {
      const t = current();
      const url = resolveAddressInput(p.url);
      if (t) {
        t.error = "";
        t.view.webContents.loadURL(url).catch(() => {});
      }
      break;
    }
    case "back":
      if (current()?.view.webContents.navigationHistory.canGoBack())
        current().view.webContents.navigationHistory.goBack();
      break;
    case "forward":
      if (current()?.view.webContents.navigationHistory.canGoForward())
        current().view.webContents.navigationHistory.goForward();
      break;
    case "reload":
      current()?.view.webContents.reload();
      break;
    case "dismiss-auth-notice":
      if (current()) current().authNotice = false;
      layout();
      break;
    case "devtools":
      devtools();
      break;
    case "create-session": {
      const s = makeSession(p.name, p.persistent, p.color);
      config.sessions.push(s);
      persist();
      createTab(s.id);
      break;
    }
    case "edit-session": {
      const s = profileFor(p.id);
      const name = label(p.name);
      if (!COLORS.includes(p.color)) throw new Error("色が不正です。");
      s.name = name;
      s.color = p.color;
      persist();
      break;
    }
    case "reset-session":
      await resetSession(p.id, false);
      break;
    case "delete-session":
      await resetSession(p.id, true);
      break;
    case "save-workset": {
      const name = label(p.name);
      config.worksets.push({
        id: randomUUID(),
        name,
        tabs: [...tabs.values()].map((t) => ({
          sessionId: t.sessionId,
          url: normalizeURL(t.view.webContents.getURL()),
        })),
      });
      persist();
      break;
    }
    case "restore-workset": {
      const w = config.worksets.find((w) => w.id === p.id);
      if (!w?.tabs.length) throw new Error("復元するタブがありません。");
      if (
        !(await confirm(
          `「${w.name}」を開きますか？`,
          "現在のタブを閉じ、保存した構成を開きます。入力途中の内容は失われます。ログイン状態は初期化しません。一時セッションは新しい状態で開きます。",
        ))
      )
        break;
      for (const { window: child } of [...popups.values()]) child.destroy();
      for (const t of [...tabs.values()]) closeTab(t.id, false);
      for (const id of new Set(w.tabs.map((t) => t.sessionId))) {
        const profile = profileFor(id);
        if (!profile.persistent) {
          const oldSession = configuredSession(profile);
          await oldSession.closeAllConnections();
          await oldSession.clearData();
          await oldSession.clearAuthCache();
          tempEpochs.set(id, (tempEpochs.get(id) || 0) + 1);
        }
      }
      for (const t of w.tabs) createTab(t.sessionId, t.url);
      activeId = [...tabs.keys()][0];
      layout();
      break;
    }
    case "delete-workset": {
      if (
        !(await confirm(
          "作業セットを削除しますか？",
          "セッションや現在のタブは削除されません。",
        ))
      )
        break;
      config.worksets = config.worksets.filter((w) => w.id !== p.id);
      persist();
      break;
    }
    default:
      throw new Error("未対応の操作です。");
  }
  publish();
  return state();
}
function shortcut(name) {
  if (!win || win.isDestroyed()) return;
  win.show();
  win.focus();
  win.webContents.focus();
  win.webContents.send("browser:shortcut", name);
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
        pageActions.openFind(
          contents === win?.webContents
            ? current()?.view.webContents
            : contents,
        );
    if (!input.alt && !input.shift && key === "p")
      action = () => {
        const target =
          contents === win?.webContents
            ? current()?.view.webContents
            : contents;
        if (target) pageActions.printPage(target);
      };
    if (!input.alt && !input.shift && key === "l")
      action = () => shortcut("address");
    if (!input.alt && !input.shift && key === "t")
      action = () => shortcut("new-tab");
    if (!input.alt && input.shift && key === "s")
      action = () => shortcut("save-workset");
    if (input.alt && !input.shift && key === "i") action = devtools;
    if (!input.alt && !input.shift && key === "r")
      action = () => current()?.view.webContents.reload();
    if (!input.alt && !input.shift && key === "w")
      action = () => {
        const child = BrowserWindow.fromWebContents(contents);
        if (child && child !== win) child.close();
        else if (!overlay) command("close-tab");
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
          { role: "about" },
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
            label: "新しいタブ",
            accelerator: "CmdOrCtrl+T",
            click: () => shortcut("new-tab"),
          },
          {
            label: "タブを閉じる",
            accelerator: "CmdOrCtrl+W",
            click: () => {
              const focused = BrowserWindow.getFocusedWindow();
              if (focused && focused !== win) focused.close();
              else if (!overlay) command("close-tab");
            },
          },
          {
            label: "印刷…",
            accelerator: "CmdOrCtrl+P",
            click: () => {
              const target = pageActions.focusedContents(
                current()?.view.webContents,
              );
              if (target) pageActions.printPage(target);
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
        label: "表示",
        submenu: [
          {
            label: "ページ内を検索…",
            accelerator: "CmdOrCtrl+F",
            click: () =>
              pageActions.openFind(
                pageActions.focusedContents(current()?.view.webContents),
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
            click: () => current()?.view.webContents.reload(),
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
function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: app.name,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 20 },
    backgroundColor: "#f5f6fa",
    webPreferences: {
      ...securePreferences,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  installKeyboard(win.webContents);
  installContextMenu(win.webContents);
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.on("resize", layout);
  win.on("closed", () => {
    for (const t of tabs.values())
      if (!t.view.webContents.isDestroyed())
        t.view.webContents.close({ waitForBeforeUnload: false });
    tabs.clear();
    activeId = undefined;
    split = null;
    draggingTab = false;
    overlay = false;
    win = null;
  });
  win.loadFile(path.join(__dirname, "index.html"));
  createTab(config.sessions[0].id);
}
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } else if (config) createWindow();
});
app.whenReady().then(() => {
  if (!primaryInstance) return;
  store = new ConfigStore(app.getPath("userData"));
  try {
    config = store.load();
    persist();
  } catch (error) {
    dialog.showErrorBox(
      "設定を読み込めません",
      `${error.message}\n設定ファイルを確認してください：${store.file}`,
    );
    app.quit();
    return;
  }
  ipcMain.on("browser:passkey-unavailable", (event) => {
    // Only managed site tabs/popups can set their own informational banner.
    const tab = originatingTab(event.sender);
    if (!tab || tab.authNotice) return;
    tab.authNotice = true;
    layout();
    publish();
  });
  ipcMain.handle("browser:command", async (event, action, p) => {
    if (
      !win ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame ||
      event.senderFrame.url !== shellURL
    )
      throw new Error("許可されていない操作です。");
    if (mutation && action !== "state")
      return { error: "処理中です。完了後にもう一度お試しください。" };
    if (action !== "state") mutation = true;
    try {
      return await command(action, p);
    } catch (error) {
      publish();
      return { error: error.message };
    } finally {
      if (action !== "state") mutation = false;
    }
  });
  pageActions = createPageActions(() => win);
  installMenu();
  createWindow();
  app.on("activate", () => {
    if (!win) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
