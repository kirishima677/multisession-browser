const { preferences } = require("./runtime-model");
const { resolveAddressInput } = require("./model");

function createBrowserCommands({
  getConfig,
  workspace,
  sessions,
  worksets,
  getControls,
  getLibraryWindow,
  getBrowserLibrary,
  getApiTabs,
  getTerminalTabs,
  getTestTools,
  getMemoryMonitor,
  getUpdateChecker,
  openExternal,
  persist,
  publish,
  state,
}) {
  async function command(action, p = {}) {
    if (!p || typeof p !== "object") throw new Error("操作が不正です。");
    const config = getConfig();
    switch (action) {
      case "state":
        break;
      case "overlay":
        workspace.setOverlay(p.open);
        break;
      case "browser-menu":
        getControls().showBrowserMenu(p);
        break;
      case "open-library":
        getLibraryWindow().open(p.page || "history");
        break;
      case "save-bookmark":
        await getBrowserLibrary().saveBookmark(p);
        break;
      case "remove-bookmark":
        await getBrowserLibrary().removeBookmark(p.id);
        break;
      case "zoom":
        getControls().zoomPage(p.direction);
        break;
      case "open-test-tools": {
        const page = p.page || "auth";
        if (!["auth", "network"].includes(page))
          throw new Error("ツールの種類が不正です。");
        const id =
          p.sessionId ||
          workspace.current()?.sessionId ||
          config.sessions[0].id;
        sessions.profileFor(id);
        const t = [...workspace.tabs.values()]
          .reverse()
          .find((t) => t.sessionId === id && t.kind !== "terminal");
        const url =
          t?.kind === "api" ? t.request.url : t?.view.webContents.getURL();
        getTestTools().open({
          page,
          sessionId: id,
          url: /^https?:\/\//.test(url || "")
            ? url
            : config.authBindings.find((b) => b.sessionId === id)?.url || "",
        });
        break;
      }
      case "create-terminal-tab":
        getTerminalTabs().create(
          p.sessionId ||
            workspace.current()?.sessionId ||
            config.sessions[0].id,
          p.terminal,
        );
        break;
      case "set-preferences":
        config.preferences = preferences(p);
        persist();
        getMemoryMonitor().reset();
        break;
      case "dismiss-memory-warning":
        getMemoryMonitor().dismiss();
        break;
      case "sample-memory":
        await getMemoryMonitor().sample();
        break;
      case "check-updates":
        getUpdateChecker().check();
        break;
      case "open-update": {
        const url = getUpdateChecker().openURL();
        if (!url) throw new Error("公開リリースが見つかりません。");
        await openExternal(url);
        break;
      }
      case "create-api-tab":
        getApiTabs().create(
          p.sessionId ||
            workspace.current()?.sessionId ||
            config.sessions[0].id,
          p.request,
        );
        break;
      case "duplicate-api-tab": {
        const source = workspace.tabs.get(p.id);
        if (source?.kind !== "api")
          throw new Error("APIタブが見つかりません。");
        const { storedDraft } = require("./api-request");
        getApiTabs().create(p.sessionId, storedDraft(source.request));
        break;
      }
      case "create-tab":
        workspace.createTab(
          p.sessionId ||
            workspace.current()?.sessionId ||
            config.sessions[0].id,
          p.url,
        );
        break;
      case "select-tab":
        workspace.select(p.id);
        break;
      case "reorder-tab":
        workspace.reorder(p.id, p.beforeId ?? null);
        break;
      case "split-tab":
        workspace.setSplit(p.id, p.side);
        break;
      case "end-split":
        workspace.endSplit();
        break;
      case "tab-drag":
        workspace.setDragging(p.id, p.active);
        break;
      case "close-tab":
        workspace.closeTab(p.id || workspace.activeId);
        break;
      case "navigate": {
        const t = workspace.current();
        if (["api", "terminal"].includes(t?.kind))
          throw new Error("このタブでは上部のURL欄から移動できません。");
        const url = resolveAddressInput(p.url);
        if (t) {
          t.error = "";
          t.view.webContents.loadURL(url).catch(() => {});
        }
        break;
      }
      case "back":
        if (workspace.current()?.view.webContents.navigationHistory.canGoBack())
          workspace.current().view.webContents.navigationHistory.goBack();
        break;
      case "forward":
        if (
          workspace.current()?.view.webContents.navigationHistory.canGoForward()
        )
          workspace.current().view.webContents.navigationHistory.goForward();
        break;
      case "reload":
        if (workspace.current()?.kind !== "terminal")
          workspace.current()?.view.webContents.reload();
        break;
      case "dismiss-auth-notice":
        if (workspace.current()) workspace.current().authNotice = false;
        workspace.layout();
        break;
      case "devtools":
        getControls().devtools();
        break;
      case "create-session":
        sessions.create(p);
        break;
      case "edit-session":
        sessions.edit(p);
        break;
      case "reset-session":
        await sessions.reset(p.id, false);
        break;
      case "delete-session":
        await sessions.reset(p.id, true);
        break;
      case "save-workset":
        await worksets.save(p);
        break;
      case "restore-workset":
        await worksets.restore(p);
        break;
      case "delete-workset":
        await worksets.remove(p.id);
        break;
      default:
        throw new Error("未対応の操作です。");
    }
    publish();
    return state();
  }
  return command;
}

module.exports = { createBrowserCommands };
