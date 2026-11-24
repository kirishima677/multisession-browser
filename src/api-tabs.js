const { WebContentsView, ipcMain, clipboard } = require("electron");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { draft, storedDraft, prepare } = require("./api-request");
const { execute } = require("./api-http");
const { label } = require("./model");

function createApiTabs({
  tabs,
  window,
  getConfig,
  profileFor,
  getSession,
  onResult,
  persist,
  activate,
  layout,
  publish,
  installKeyboard,
  installContextMenu,
  securePreferences,
}) {
  const apiURL = pathToFileURL(path.join(__dirname, "api.html")).href;
  function snapshot(t, includeResponse = false) {
    const profile = profileFor(t.sessionId);
    const result = t.response
      ? { ...t.response, body: undefined, headers: undefined }
      : null;
    return {
      revision: ++t.apiRevision,
      draftRevision: t.draftRevision,
      id: t.id,
      session: { id: profile.id, name: profile.name, color: profile.color },
      sessions: getConfig().sessions.map((s) => ({ id: s.id, name: s.name })),
      draft: t.request,
      running: Boolean(t.apiJob),
      result,
      error: t.apiError || "",
      savedId: t.savedId || null,
      history: t.history.map(({ request, ...entry }) => entry),
      saved: getConfig()
        .apiRequests.filter((r) => r.sessionId === t.sessionId)
        .map((r) => ({
          id: r.id,
          name: r.name,
          method: r.request.method,
          url: r.request.url,
        })),
      ...(includeResponse ? { response: t.response } : {}),
    };
  }
  function notify(t, includeResponse = false) {
    if (tabs.get(t.id) !== t || t.view.webContents.isDestroyed()) return;
    t.view.webContents.send("api-client:state", snapshot(t, includeResponse));
  }
  function title(t) {
    t.title = `API / ${t.request.name.trim() || `${t.request.method} ${t.request.url || "新しいリクエスト"}`}`;
  }
  function setDraft(t, input, replace = false) {
    t.request = draft(input);
    title(t);
    if (replace) t.draftRevision++;
  }
  function create(sessionId, input = {}) {
    profileFor(sessionId);
    const request = draft(input);
    const view = new WebContentsView({
      webPreferences: {
        ...securePreferences,
        preload: path.join(__dirname, "api-preload.js"),
      },
    });
    const t = {
      id: randomUUID(),
      kind: "api",
      sessionId,
      view,
      request,
      apiRevision: 0,
      draftRevision: 1,
      history: [],
      response: null,
      apiError: "",
      apiJob: null,
    };
    title(t);
    tabs.set(t.id, t);
    window().contentView.addChildView(view);
    view.setBackgroundColor("#f7f9fd");
    installKeyboard(view.webContents);
    installContextMenu(view.webContents);
    view.webContents.on("will-navigate", (event) => event.preventDefault());
    view.webContents.on("will-redirect", (event) => event.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    view.webContents.on("focus", () => {
      if (tabs.has(t.id) && view.getVisible()) {
        activate(t.id);
        layout();
        publish();
      }
    });
    view.webContents.on("did-finish-load", () => notify(t, true));
    view.webContents.once("destroyed", () => t.apiJob?.controller.abort());
    activate(t.id);
    view.webContents.loadFile(path.join(__dirname, "api.html"));
    layout();
    publish();
    return t;
  }
  function start(t, input) {
    if (t.apiJob)
      throw new Error("送信中です。完了またはキャンセル後に再送してください。");
    const request = draft(input);
    prepare(request);
    setDraft(t, request);
    const controller = new AbortController();
    const job = { controller };
    t.apiJob = job;
    t.apiError = "";
    t.response = null;
    // Capture both the tab and its fixed Session before yielding to the network.
    const session = getSession(profileFor(t.sessionId));
    const sent = storedDraft(request);
    const createdAt = new Date().toISOString();
    execute(session, request, controller.signal)
      .then((result) => {
        if (tabs.get(t.id) !== t || t.apiJob !== job) return;
        t.response = { id: randomUUID(), ...result };
        onResult?.(t, result, createdAt);
        t.history.unshift({
          id: randomUUID(),
          createdAt,
          method: request.method,
          url: result.url,
          status: result.status,
          request: sent,
        });
      })
      .catch((error) => {
        if (tabs.get(t.id) !== t || t.apiJob !== job) return;
        t.apiError = error.message;
        t.history.unshift({
          id: randomUUID(),
          createdAt,
          method: request.method,
          url: request.url,
          status: 0,
          error: error.message,
          request: sent,
        });
      })
      .finally(() => {
        if (tabs.get(t.id) !== t || t.apiJob !== job) return;
        t.apiJob = null;
        t.history = t.history.slice(0, 20);
        notify(t, true);
        publish();
      });
    notify(t, true);
    publish();
  }
  function authorize(event) {
    const t = [...tabs.values()].find(
      (t) => t.kind === "api" && t.view.webContents === event.sender,
    );
    if (
      !t ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== apiURL
    )
      throw new Error("許可されていないAPIタブ操作です。");
    return t;
  }
  ipcMain.handle("api-client:command", (event, action, p = {}) => {
    const t = authorize(event);
    try {
      if (!p || typeof p !== "object")
        throw new Error("操作の形式が不正です。");
      if (action === "draft") {
        if (t.apiJob) throw new Error("送信中は編集できません。");
        setDraft(t, p.draft);
        publish();
      } else if (action === "send") start(t, p.draft);
      else if (action === "cancel") t.apiJob?.controller.abort();
      else if (action === "save") {
        setDraft(t, p.draft);
        const name = label(t.request.name);
        const config = getConfig();
        const id = p.id || t.savedId;
        if (id) {
          const saved = config.apiRequests.find(
            (r) => r.id === id && r.sessionId === t.sessionId,
          );
          if (!saved) throw new Error("保存リクエストが見つかりません。");
          saved.name = name;
          saved.request = storedDraft(t.request);
        } else {
          t.savedId = randomUUID();
          config.apiRequests.push({
            id: t.savedId,
            sessionId: t.sessionId,
            name,
            request: storedDraft(t.request),
          });
        }
        persist();
        for (const tab of tabs.values()) if (tab.kind === "api") notify(tab);
        publish();
      } else if (action === "open-saved" || action === "history") {
        if (t.apiJob)
          throw new Error("送信中はリクエストを切り替えられません。");
        const record =
          action === "open-saved"
            ? getConfig().apiRequests.find(
                (r) => r.id === p.id && r.sessionId === t.sessionId,
              )
            : t.history.find((r) => r.id === p.id);
        if (!record) throw new Error("リクエストが見つかりません。");
        t.savedId = action === "open-saved" ? record.id : null;
        setDraft(t, record.request, true);
        t.apiError = "";
        publish();
      } else if (action === "delete-saved") {
        const config = getConfig();
        config.apiRequests = config.apiRequests.filter(
          (r) => r.id !== p.id || r.sessionId !== t.sessionId,
        );
        persist();
        for (const tab of tabs.values())
          if (tab.kind === "api") {
            if (tab.savedId === p.id && tab.sessionId === t.sessionId)
              tab.savedId = null;
            notify(tab);
          }
        publish();
      } else if (action === "duplicate")
        create(p.sessionId, storedDraft(p.draft));
      else if (action === "copy-response") {
        if (t.response && !t.response.binary)
          clipboard.writeText(t.response.body);
      } else if (action !== "state") throw new Error("未対応のAPI操作です。");
      return snapshot(t, action === "state");
    } catch (error) {
      return { error: error.message };
    }
  });
  return {
    create,
    refresh: () => {
      for (const t of tabs.values()) if (t.kind === "api") notify(t);
    },
    cancel: (t) => t.apiJob?.controller.abort(),
    notify,
    serialize: (t) => ({
      kind: "api",
      sessionId: t.sessionId,
      url: "about:blank",
      request: storedDraft(t.request),
    }),
  };
}
module.exports = { createApiTabs };
