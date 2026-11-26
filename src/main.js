const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  nativeImage,
  safeStorage,
  shell,
} = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { COLORS, ConfigStore } = require("./model");
const { createBrowserWorkspace } = require("./browser-workspace");
const { createBrowserSessions } = require("./browser-sessions");
const { createWorksets } = require("./worksets");
const { createBrowserControls } = require("./browser-controls");
const { createBrowserCommands } = require("./browser-commands");
const { installBrowserIPC } = require("./browser-ipc");
const { createPageActions } = require("./page-actions");
const { createApiTabs } = require("./api-tabs");
const { createTerminalTabs } = require("./terminal-tabs");
const { createMemoryMonitor } = require("./memory-monitor");
const { createUpdateChecker } = require("./updates");
const { createProtection } = require("./protection");
const { createAuthManager } = require("./auth-manager");
const { createNetworkCapture } = require("./network-capture");
const { createTestTools } = require("./test-tools");
const { createBrowserLibrary } = require("./browser-library");
const { createLibraryWindow } = require("./library-window");

if (process.env.MSB_USER_DATA)
  app.setPath("userData", path.resolve(process.env.MSB_USER_DATA));
app.setName("Multisession Browser");
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
const appIconPath = path.join(__dirname, "..", "assets", "icon.png");
const shellURL = pathToFileURL(path.join(__dirname, "index.html")).href;
const securePreferences = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
};
let win,
  config,
  store,
  stateRevision = 0;
let pageActions, apiTabs, terminalTabs, memoryMonitor, updateChecker;
let protection, authManager, capture, testTools, browserLibrary, libraryWindow;
const getWindow = () => win,
  getConfig = () => config;
const persist = () => store.save(config);
const refreshTabs = () => {
  apiTabs.refresh();
  terminalTabs.refresh();
};
const workspace = createBrowserWorkspace({
  getWindow,
  getConfig,
  securePreferences,
  publish,
  profileFor: (id) => sessions.profileFor(id),
  getSession: (profile) => sessions.get(profile),
  getApiTabs: () => apiTabs,
  getTerminalTabs: () => terminalTabs,
  getCapture: () => capture,
  getLibrary: () => browserLibrary,
  installKeyboard: (contents) => controls.installKeyboard(contents),
  installContextMenu: (contents, profile) =>
    controls.installContextMenu(contents, profile),
});
const sessions = createBrowserSessions({
  getConfig,
  getWindow,
  workspace,
  persist,
  refreshTabs,
  confirm,
  getProtection: () => protection,
  getAuthManager: () => authManager,
  getPageActions: () => pageActions,
  getLibrary: () => browserLibrary,
  getCapture: () => capture,
});
const controls = createBrowserControls({
  getWindow,
  createWindow,
  workspace,
  sessions,
  publish,
  getLibrary: () => browserLibrary,
  getLibraryWindow: () => libraryWindow,
  getPageActions: () => pageActions,
  getUpdateChecker: () => updateChecker,
  runCommand: (action, p) => command(action, p),
});
const worksets = createWorksets({
  getConfig,
  workspace,
  sessions,
  persist,
  confirm,
  getApiTabs: () => apiTabs,
  getTerminalTabs: () => terminalTabs,
});
const command = createBrowserCommands({
  getConfig,
  workspace,
  sessions,
  worksets,
  persist,
  publish,
  state,
  getControls: () => controls,
  getLibraryWindow: () => libraryWindow,
  getBrowserLibrary: () => browserLibrary,
  getApiTabs: () => apiTabs,
  getTerminalTabs: () => terminalTabs,
  getTestTools: () => testTools,
  getMemoryMonitor: () => memoryMonitor,
  getUpdateChecker: () => updateChecker,
  openExternal: (url) => shell.openExternal(url),
});
function state() {
  return {
    revision: ++stateRevision,
    sessions: config.sessions,
    worksets: config.worksets,
    colors: COLORS,
    ...runtime(),
    pageDetails: controls.currentPage(),
    ...workspace.snapshot(),
  };
}
function runtime() {
  return {
    appInfo: {
      version: app.getVersion(),
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      arch: process.arch,
    },
    preferences: config.preferences,
    memory: memoryMonitor?.get() || null,
    update: updateChecker?.get() || null,
    protection: protection?.status() || null,
    auth: authManager?.summaries() || [],
    browserLibrary: browserLibrary?.summary() || null,
    pageBookmark: controls.currentPage(),
  };
}
function publishRuntime() {
  if (win && !win.isDestroyed())
    win.webContents.send("browser:runtime", runtime());
}
function publish() {
  if (win && !win.isDestroyed()) win.webContents.send("browser:state", state());
  testTools?.publish();
  libraryWindow?.publish();
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
function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: app.name,
    icon: appIconPath,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 20 },
    backgroundColor: "#f5f6fa",
    webPreferences: {
      ...securePreferences,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  controls.installKeyboard(win.webContents);
  controls.installContextMenu(win.webContents);
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.on("resize", workspace.layout);
  win.on("closed", () => {
    workspace.windowClosed();
    win = null;
  });
  win.loadFile(path.join(__dirname, "index.html"));
  workspace.createTab(config.sessions[0].id);
}
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } else if (config) createWindow();
});
app.whenReady().then(async () => {
  if (!primaryInstance) return;
  if (process.platform === "darwin") {
    const icon = nativeImage.createFromPath(appIconPath);
    if (!icon.isEmpty()) app.dock?.setIcon(icon);
  }
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
    workspace.passkeyUnavailable(event.sender);
  });
  installBrowserIPC({ ipcMain, getWindow, shellURL, command, publish });
  protection = createProtection({
    safeStorage,
    directory: app.getPath("userData"),
  });
  await protection.init();
  const describe = (contents) => {
    const t = workspace.originatingTab(contents);
    return {
      tabId: t?.id || "",
      contentsId: contents.id,
      title: contents.isDestroyed()
        ? "閉じたタブ"
        : contents.getTitle() || t?.title || "タブ",
    };
  };
  capture = createNetworkCapture({
    describe,
    publish: () => testTools?.publish(),
  });
  authManager = createAuthManager({
    getConfig: () => config,
    profileFor: sessions.profileFor,
    getSession: sessions.get,
    protection,
    persist,
    publish: () => {
      publishRuntime();
      testTools?.publish();
    },
  });
  testTools = createTestTools({
    getConfig: () => config,
    getTabs: () =>
      [...workspace.tabs.values()].map((t) => ({
        id: t.id,
        title: t.title || "新しいタブ",
        sessionId: t.sessionId,
      })),
    auth: authManager,
    capture,
    protection,
    securePreferences,
    installContextMenu: controls.installContextMenu,
    activateSource: workspace.activateSource,
  });
  try {
    for (const profile of config.sessions)
      if (profile.persistent)
        await protection.migrateCookies(sessions.get(profile), profile.id);
  } catch {
    dialog.showErrorBox(
      "Cookieの暗号化に失敗しました",
      "既存データの読み書きを中止しました。OSの鍵管理へのアクセスを確認して再起動してください。",
    );
    app.quit();
    return;
  }
  browserLibrary = createBrowserLibrary({
    directory: app.getPath("userData"),
    safeStorage,
    canPersist: () => protection.status().persistentAllowed,
    getSessions: () => config.sessions,
    publish: () => {
      publishRuntime();
      libraryWindow?.publish();
    },
  });
  await browserLibrary.init();
  libraryWindow = createLibraryWindow({
    library: browserLibrary,
    getSessions: () => config.sessions,
    openEntry: controls.openLibraryEntry,
    securePreferences,
    installContextMenu: controls.installContextMenu,
  });
  pageActions = createPageActions(() => win);
  apiTabs = createApiTabs({
    tabs: workspace.tabs,
    window: () => win,
    getConfig: () => config,
    profileFor: sessions.profileFor,
    getSession: sessions.get,
    onResult: (t, result, createdAt) => capture.apiResult(t, result, createdAt),
    persist,
    activate: workspace.activate,
    layout: workspace.layout,
    publish,
    installKeyboard: controls.installKeyboard,
    installContextMenu: controls.installContextMenu,
    securePreferences,
  });
  terminalTabs = createTerminalTabs({
    tabs: workspace.tabs,
    window: () => win,
    profileFor: sessions.profileFor,
    activate: workspace.activate,
    layout: workspace.layout,
    publish,
    installKeyboard: controls.installKeyboard,
    installContextMenu: controls.installContextMenu,
    securePreferences,
  });
  memoryMonitor = createMemoryMonitor({
    app,
    terminalPids: terminalTabs.pids,
    threshold: () => config.preferences.memoryWarningMiB,
    publish: publishRuntime,
  });
  updateChecker = createUpdateChecker({
    version: app.getVersion(),
    publish: publishRuntime,
    url: process.env.MSB_UPDATE_URL || undefined,
  });
  controls.installMenu();
  createWindow();
  authManager.init();
  memoryMonitor.start();
  if (config.preferences.checkUpdatesOnStartup) updateChecker.check();
  app.on("activate", () => {
    if (!win) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let quitReady = false,
  quitting = false;
app.on("before-quit", (event) => {
  terminalTabs?.shutdown();
  memoryMonitor?.stop();
  capture?.stop();
  testTools?.close();
  libraryWindow?.close();
  if (!quitReady && browserLibrary) {
    event.preventDefault();
    if (!quitting) {
      quitting = true;
      browserLibrary.stop().finally(() => {
        quitReady = true;
        app.quit();
      });
    }
  }
});
