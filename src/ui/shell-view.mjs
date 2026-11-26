import { $, el, button, dot } from "./dom.mjs";

export function createShellView({
  getState,
  activeTab,
  getError,
  invoke,
  render,
  sessionModal,
}) {
  let addressTabId;
  function renderSessions() {
    const active = activeTab();
    const profile = getState().sessions.find((s) => s.id === active?.sessionId);
    $("#sessions").replaceChildren(
      ...getState().sessions.map((s) => {
        const count = getState().tabs.filter(
          (t) => t.sessionId === s.id,
        ).length;
        const row = el(
          "div",
          `session-row${profile?.id === s.id ? " active" : ""}`,
        );
        const open = button(
          "",
          "session-open",
          () => invoke("create-tab", { sessionId: s.id }),
          `${s.name}でタブを開く`,
        );
        const description = el("span");
        description.append(
          el("span", "session-name", s.name),
          el(
            "span",
            "session-detail",
            `${s.persistent ? (getState().protection?.persistentAllowed ? "保存セッション" : "保存停止中") : "一時セッション"}${count ? ` · ${count} タブ` : ""}`,
          ),
        );
        const authStatus = el("span", "session-auth-status");
        authStatus.dataset.sessionId = s.id;
        description.append(authStatus);
        open.append(dot(s.color), description);
        const edit = button(
          "···",
          "session-edit",
          () => sessionModal(s),
          `${s.name}の設定`,
        );
        row.append(
          open,
          button(
            "JWT",
            "session-auth",
            () => invoke("open-test-tools", { page: "auth", sessionId: s.id }),
            `${s.name}の認証情報`,
          ),
          edit,
        );
        return row;
      }),
    );
  }
  function renderWorksets() {
    const worksets = getState().worksets.map((w) => {
      const row = el("div", "workset-item");
      const open = button(
        `▤  ${w.name}`,
        "workset-open",
        () => invoke("restore-workset", { id: w.id }),
        `${w.name}を開く（${w.tabs.length}タブ）`,
      );
      open.disabled = !w.tabs.length;
      row.append(
        open,
        button(
          "×",
          "workset-delete",
          () => invoke("delete-workset", { id: w.id }),
          `${w.name}を削除`,
        ),
      );
      return row;
    });
    $("#worksets").replaceChildren(
      ...(worksets.length
        ? worksets
        : [
            el(
              "p",
              "empty-note",
              "タブ構成を保存すると、\nここからまとめて開けます。",
            ),
          ]),
    );
  }
  function renderToolbar() {
    const active = activeTab();
    const profile = getState().sessions.find((s) => s.id === active?.sessionId);
    if (
      document.activeElement !== $("#address") ||
      addressTabId !== getState().activeId
    )
      $("#address").value =
        active?.url === "about:blank" ? "" : active?.url || "";
    addressTabId = getState().activeId;
    $("#address-dot").style.setProperty("--color", profile?.color || "#6478ff");
    $("#address").readOnly = ["api", "terminal"].includes(active?.kind);
    $("#open-as").disabled = active?.kind === "terminal";
    $("#reload").disabled = active?.kind === "terminal";
    $("#address").title =
      active?.kind === "api"
        ? "APIタブ内のURL欄で編集します（⌘L）"
        : active?.kind === "terminal"
          ? "ターミナルの起動フォルダ"
          : "";
    $("#back").disabled = !active?.canGoBack;
    $("#forward").disabled = !active?.canGoForward;
    $("#auth-notice").hidden = !active?.authNotice;
    document.body.classList.toggle(
      "has-auth-notice",
      Boolean(active?.authNotice),
    );
    $("#welcome").hidden = Boolean(
      getState().split || (active && active.url !== "about:blank"),
    );
    $("#status").textContent = profile
      ? `${profile.name}  /  ${profile.persistent ? "保存" : "一時"}${active?.loading ? "  · 読み込み中…" : ""}`
      : "";
    $("#error").textContent = getError() || active?.error || "";
  }
  function focusAddress() {
    $("#address").focus();
    $("#address").select();
  }
  const address = $("#address");
  let addressPress;
  address.addEventListener("pointerdown", (event) => {
    addressPress =
      event.button === 0 && document.activeElement !== address
        ? { x: event.clientX, y: event.clientY }
        : null;
  });
  address.addEventListener("focus", () => address.select());
  address.addEventListener("mouseup", (event) => {
    if (
      addressPress &&
      Math.hypot(
        event.clientX - addressPress.x,
        event.clientY - addressPress.y,
      ) < 4
    ) {
      // The first click's default caret placement follows focus selection.
      event.preventDefault();
      address.select();
    }
    addressPress = null;
  });
  for (const event of ["blur", "pointercancel"])
    address.addEventListener(event, () => {
      addressPress = null;
    });
  $("#address-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await invoke("navigate", { url: $("#address").value });
    if (result) {
      $("#address").blur();
      render(result);
    }
  });
  return { renderSessions, renderWorksets, renderToolbar, focusAddress };
}
