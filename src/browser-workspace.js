const { WebContentsView } = require("electron");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { normalizeURL, allowedNavigation } = require("./model");
const { reorderIds, splitForDrop, selectInSplit } = require("./tab-layout");

function createBrowserWorkspace({
  getWindow,
  getConfig,
  profileFor,
  getSession,
  getApiTabs,
  getTerminalTabs,
  getCapture,
  getLibrary,
  installKeyboard,
  installContextMenu,
  securePreferences,
  publish,
}) {
  const tabs = new Map(),
    popups = new Map();
  const chrome = { sidebar: 236, top: 152, bottom: 28 };
  const sitePreload = path.join(__dirname, "site-preload.js");
  let activeId,
    split = null,
    overlay = false,
    draggingTab = false;
  const current = () => tabs.get(activeId);

  function activateTab(id) {
    split = selectInSplit(split, activeId, id);
    activeId = id;
  }
  function layout() {
    if (!getWindow() || getWindow().isDestroyed()) return;
    const [width, height] = getWindow().getContentSize();
    const top =
      chrome.top + (current()?.authNotice ? 52 : 0) + (split ? 34 : 0);
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
  function guardContents(contents, profile) {
    getCapture()?.track(contents, profile.id);
    getLibrary()?.track(contents, profile.id);
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
          parent: getWindow(),
          width: 1000,
          height: 760,
          autoHideMenuBar: true,
          webPreferences: {
            ...securePreferences,
            preload: sitePreload,
            session: getSession(profile),
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
        session: getSession(profile),
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
    getWindow().contentView.addChildView(view);
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
    getWindow().contentView.removeChildView(t.view);
    tabs.delete(id);
    if (t.kind === "api") getApiTabs().cancel(t);
    if (t.kind === "terminal") getTerminalTabs().stop(t);
    t.view.webContents.close({ waitForBeforeUnload: false });
    if (activeId === id) activeId = [...tabs.keys()].at(-1);
    if (ensure && !tabs.size) createTab(getConfig().sessions[0].id);
    layout();
    publish();
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

  function select(id) {
    if (!tabs.has(id)) throw new Error("タブが見つかりません。");
    activateTab(id);
    getWindow().webContents.focus();
    layout();
    if (!overlay && !draggingTab && current().view.getVisible())
      current().view.webContents.focus();
  }
  function reorder(id, beforeId = null) {
    const ids = reorderIds([...tabs.keys()], id, beforeId);
    const entries = ids.map((id) => [id, tabs.get(id)]);
    tabs.clear();
    for (const [id, tab] of entries) tabs.set(id, tab);
  }
  function setSplit(id, side) {
    split = splitForDrop([...tabs.keys()], activeId, split, id, side);
    activeId = id;
    layout();
  }
  function endSplit() {
    split = null;
    layout();
  }
  function setOverlay(open) {
    overlay = Boolean(open);
    if (overlay) draggingTab = false;
    layout();
  }
  function setDragging(id, active) {
    if (active && (!tabs.has(id) || overlay))
      throw new Error("タブをドラッグできません。");
    draggingTab = Boolean(active);
    if (draggingTab) getWindow().webContents.focus();
    layout();
  }
  function closeSessionTabs(id) {
    for (const { window: child, sessionId } of [...popups.values()])
      if (sessionId === id) child.destroy();
    for (const t of [...tabs.values()])
      if (t.sessionId === id) closeTab(t.id, false);
  }
  function closeAll() {
    for (const { window: child } of [...popups.values()]) child.destroy();
    for (const t of [...tabs.values()]) closeTab(t.id, false);
  }
  function windowClosed() {
    getTerminalTabs().shutdown();
    for (const t of tabs.values())
      if (!t.view.webContents.isDestroyed())
        t.view.webContents.close({ waitForBeforeUnload: false });
    tabs.clear();
    activeId = undefined;
    split = null;
    draggingTab = false;
    overlay = false;
  }
  function selectFirst() {
    activeId = [...tabs.keys()][0];
    layout();
  }
  function passkeyUnavailable(contents) {
    const tab = originatingTab(contents);
    if (!tab || tab.authNotice) return;
    tab.authNotice = true;
    layout();
    publish();
  }
  function activateSource(record) {
    if (overlay)
      throw new Error("設定・構成の画面を閉じてから移動してください。");
    const popup = [...popups.values()].find(
      (p) =>
        !p.window.isDestroyed() &&
        p.window.webContents.id === record.contentsId,
    );
    if (popup) {
      popup.window.show();
      popup.window.focus();
      return;
    }
    const t = tabs.get(record.tabId),
      win = getWindow();
    if (!t || !win) throw new Error("元のタブは閉じられています。");
    activateTab(t.id);
    win.show();
    win.focus();
    layout();
    if (t.view.getVisible()) t.view.webContents.focus();
    publish();
  }
  function snapshot() {
    return {
      activeId,
      split,
      draggingTab,
      tabs: [...tabs.values()].map((t) => ({
        id: t.id,
        sessionId: t.sessionId,
        kind: t.kind || "web",
        title: t.title || "新しいタブ",
        url:
          t.kind === "api"
            ? t.request.url || "about:blank"
            : t.kind === "terminal"
              ? t.terminal.cwd
              : t.view.webContents.getURL() || "about:blank",
        loading:
          t.kind === "api" ? Boolean(t.apiJob) : t.view.webContents.isLoading(),
        error: t.error || "",
        authNotice: Boolean(t.authNotice),
        canGoBack:
          !["api", "terminal"].includes(t.kind) &&
          t.view.webContents.navigationHistory.canGoBack(),
        canGoForward:
          !["api", "terminal"].includes(t.kind) &&
          t.view.webContents.navigationHistory.canGoForward(),
      })),
    };
  }
  return {
    tabs,
    current,
    activate: activateTab,
    select,
    reorder,
    setSplit,
    endSplit,
    setOverlay,
    setDragging,
    layout,
    createTab,
    closeTab,
    closeSessionTabs,
    closeAll,
    windowClosed,
    selectFirst,
    originatingTab,
    passkeyUnavailable,
    activateSource,
    snapshot,
    get activeId() {
      return activeId;
    },
    get overlay() {
      return overlay;
    },
  };
}

module.exports = { createBrowserWorkspace };
