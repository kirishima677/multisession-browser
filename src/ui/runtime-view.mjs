import { $ } from "./dom.mjs";

export function createRuntimeView({ getState }) {
  function formatMemory(bytes) {
    return bytes >= 1024 ** 3
      ? `${(bytes / 1024 ** 3).toFixed(2)} GiB`
      : `${Math.round(bytes / 1024 ** 2)} MiB`;
  }
  function renderRuntime() {
    if (!getState()?.appInfo) return;
    $("#app-info").textContent = `v${getState().appInfo.version}`;
    const m = getState().memory,
      limit = getState().preferences.memoryWarningMiB;
    $("#memory-usage").textContent = m?.sampledAt
      ? `${m.warning ? "⚠ " : ""}メモリ ${formatMemory(m.bytes)}`
      : "メモリ計測中…";
    $("#memory-usage").classList.toggle("over-limit", Boolean(m?.warning));
    $("#memory-usage").title =
      m?.error ||
      `アプリ＋CLIの子プロセスのRSS合計（共有メモリの重複を含む目安）。警告：${limit ? limit + " MiB" : "無効"}。クリックで設定`;
    $("#memory-warning").hidden = !m?.warning || m.dismissed;
    $("#memory-warning-text").textContent = m?.sampledAt
      ? `${formatMemory(m.bytes)} / 警告値 ${limit} MiB。不要なタブやCLIのプロセスを閉じるか、設定を変更できます。`
      : "";
    $("#protection-notice").hidden = Boolean(
      getState().protection?.persistentAllowed,
    );
    $("#protection-notice").textContent = getState().protection?.message || "";
    for (const label of document.querySelectorAll(".session-auth-status")) {
      const entries = (getState().auth || []).filter(
        (a) => a.sessionId === label.dataset.sessionId,
      );
      label.textContent = entries.length
        ? entries
            .map(
              (a) =>
                `${new URL(a.origin).hostname} / ${a.missing ? "候補なし" : a.summary}${a.expired ? " / 期限切れ" : ""}`,
            )
            .join(" · ")
        : "";
      label.title = entries
        .map(
          (a) =>
            `${a.origin}\n${a.summary}${a.expiresAt ? "\nJWT期限: " + new Date(a.expiresAt).toLocaleString() : ""}\nJWTの内容は未検証です。`,
        )
        .join("\n");
    }
    if ($("#storage-protection"))
      $("#storage-protection").textContent =
        getState().protection?.message || "";
    const page = getState().pageBookmark;
    $("#bookmark-page").disabled = !page;
    $("#bookmark-page").textContent = page?.bookmark ? "★" : "☆";
    $("#bookmark-page").classList.toggle("saved", Boolean(page?.bookmark));
    $("#bookmark-page").setAttribute(
      "aria-label",
      page?.bookmark
        ? "このページのブックマークを編集"
        : "このページをブックマーク",
    );
    $("#bookmark-page").title = page?.bookmark
      ? "ブックマークを編集 ⌘D"
      : "このページをブックマーク ⌘D";
    const update = getState().update;
    $("#update-notice").hidden = update?.status !== "available";
    $("#update-notice-text").textContent = update?.message || "";
    $("#app-info").classList.toggle(
      "has-update",
      update?.status === "available",
    );
    if ($("#runtime-memory"))
      $("#runtime-memory").textContent = m?.sampledAt
        ? `RSS合計の目安：${formatMemory(m.bytes)} / ${m.processes}プロセス（CLI ${m.cliProcesses}）。約3秒ごとに更新。共有メモリの重複を含むため、アクティビティモニタの表示とは異なります。${m.error}`
        : "計測中…";
    if ($("#update-message"))
      $("#update-message").textContent =
        `${update?.message || ""}${update?.checkedAt ? " 最終確認：" + new Date(update.checkedAt).toLocaleString() : ""}`;
    if ($("#check-updates"))
      $("#check-updates").disabled = update?.status === "checking";
    if ($("#settings-open-update"))
      $("#settings-open-update").hidden = !update?.url;
  }
  return { render: renderRuntime };
}
