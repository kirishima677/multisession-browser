const { app, dialog, session } = require("electron");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { COLORS, label, makeSession, partitionFor } = require("./model");

function createBrowserSessions({
  getConfig,
  getWindow,
  getProtection,
  getAuthManager,
  getPageActions,
  getLibrary,
  getCapture,
  workspace,
  persist,
  refreshTabs,
  confirm,
}) {
  const runId = randomUUID(),
    configured = new Set(),
    tempEpochs = new Map();
  function profileFor(id) {
    const profile = getConfig().sessions.find((s) => s.id === id);
    if (!profile) throw new Error("セッションが見つかりません。");
    return profile;
  }

  function configuredSession(profile) {
    const partition = partitionFor(
      {
        ...profile,
        persistent:
          profile.persistent &&
          Boolean(getProtection()?.status().persistentAllowed),
      },
      `${runId}-${tempEpochs.get(profile.id) || 0}`,
    );
    const ses = session.fromPartition(partition);
    if (configured.has(partition)) return ses;
    configured.add(partition);
    getAuthManager()?.watch(ses, profile.id);
    ses.setPermissionCheckHandler(() => false);
    ses.setPermissionRequestHandler(
      (contents, permission, callback, details) => {
        let origin = details.requestingUrl || contents?.getURL() || "";
        try {
          origin = new URL(origin).origin;
        } catch {
          origin = "不明なサイト";
        }
        const ask =
          getWindow() &&
          !getWindow().isDestroyed() &&
          [
            "media",
            "geolocation",
            "notifications",
            "clipboard-sanitized-write",
            "fullscreen",
          ].includes(permission);
        if (!ask) return callback(false);
        dialog
          .showMessageBox(getWindow(), {
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
      },
    );
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
          getPageActions().report(
            contents,
            "ダウンロードできませんでした",
            "接続やアクセス権を確認して、もう一度お試しください。",
          );
      });
    });
    return ses;
  }
  async function resetSession(id, remove) {
    const config = getConfig();
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
    workspace.closeSessionTabs(id);
    const ses = configuredSession(profile);
    await ses.closeAllConnections();
    // clearData also removes service workers, caches and network credentials.
    await ses.clearData();
    await ses.clearAuthCache();
    await getAuthManager().clearSession(id);
    await getLibrary().removeSession(id, remove);
    getCapture().clear(id);
    if (remove) {
      config.sessions = config.sessions.filter((s) => s.id !== id);
      config.apiRequests = config.apiRequests.filter((r) => r.sessionId !== id);
      for (const w of config.worksets)
        w.tabs = w.tabs.filter((t) => t.sessionId !== id);
    }
    persist();
    refreshTabs();
    if (!workspace.tabs.size)
      workspace.createTab((remove ? config.sessions[0] : profile).id);
  }

  function create(p) {
    const s = makeSession(p.name, p.persistent, p.color);
    getConfig().sessions.push(s);
    persist();
    refreshTabs();
    workspace.createTab(s.id);
  }
  function edit(p) {
    const s = profileFor(p.id),
      name = label(p.name);
    if (!COLORS.includes(p.color)) throw new Error("色が不正です。");
    s.name = name;
    s.color = p.color;
    persist();
    refreshTabs();
  }
  async function resetTemporary(id) {
    const profile = profileFor(id);
    if (!profile.persistent) {
      const oldSession = configuredSession(profile);
      await oldSession.closeAllConnections();
      await oldSession.clearData();
      await oldSession.clearAuthCache();
      tempEpochs.set(id, (tempEpochs.get(id) || 0) + 1);
    }
  }
  return {
    profileFor,
    get: configuredSession,
    create,
    edit,
    reset: resetSession,
    resetTemporary,
  };
}

module.exports = { createBrowserSessions };
