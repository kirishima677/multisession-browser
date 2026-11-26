const { randomUUID } = require("node:crypto");
const { label, normalizeURL } = require("./model");

function createWorksets({
  getConfig,
  workspace,
  sessions,
  getApiTabs,
  getTerminalTabs,
  persist,
  confirm,
}) {
  async function save(p) {
    const config = getConfig();
    const name = label(p.name);
    const definition = {
      id: p.id || randomUUID(),
      name,
      tabs: [...workspace.tabs.values()].map((t) =>
        t.kind === "api"
          ? getApiTabs().serialize(t)
          : t.kind === "terminal"
            ? getTerminalTabs().serialize(t)
            : {
                sessionId: t.sessionId,
                url: normalizeURL(t.view.webContents.getURL()),
              },
      ),
    };
    if (p.id) {
      const index = config.worksets.findIndex((w) => w.id === p.id);
      if (index < 0) throw new Error("上書きする構成が見つかりません。");
      if (
        !(await confirm(
          `「${config.worksets[index].name}」を上書きしますか？`,
          "保存済みのタブ構成を現在の構成に置き換えます。",
        ))
      )
        return;
      config.worksets[index] = definition;
    } else config.worksets.push(definition);
    persist();
  }
  async function restore(p) {
    const config = getConfig();
    const w = config.worksets.find((w) => w.id === p.id);
    if (!w?.tabs.length) throw new Error("復元するタブがありません。");
    if (
      !(await confirm(
        `「${w.name}」を開きますか？`,
        "現在のタブを閉じ、保存した構成を開きます。入力途中の内容は失われます。ターミナルのプロセスも終了します。ログイン状態は初期化しません。一時セッションは新しい状態で開きます。",
      ))
    )
      return;
    workspace.closeAll();
    for (const id of new Set(w.tabs.map((t) => t.sessionId)))
      await sessions.resetTemporary(id);
    for (const t of w.tabs) {
      if (t.kind === "api") getApiTabs().create(t.sessionId, t.request);
      else if (t.kind === "terminal")
        getTerminalTabs().create(t.sessionId, t.terminal, false);
      else workspace.createTab(t.sessionId, t.url);
    }
    workspace.selectFirst();
  }
  async function remove(id) {
    const config = getConfig();
    if (
      !(await confirm(
        "作業セットを削除しますか？",
        "セッションや現在のタブは削除されません。",
      ))
    )
      return;
    config.worksets = config.worksets.filter((w) => w.id !== id);
    persist();
  }
  return { save, restore, remove };
}

module.exports = { createWorksets };
