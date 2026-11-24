const api = window.browserAPI;
const $ = (selector) => document.querySelector(selector);
let state;
let modalSubmit;
let selectedColor;
let modalClosing = false;
let uiError = "";
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, cls, handler, title) {
  const node = el("button", cls, text);
  node.type = "button";
  if (title) {
    node.title = title;
    node.setAttribute("aria-label", title);
  }
  node.addEventListener("click", handler);
  return node;
}
function dot(color) {
  const node = el("span", "dot");
  node.style.setProperty("--color", color);
  return node;
}
function activeTab() {
  return state?.tabs.find((t) => t.id === state.activeId);
}
async function invoke(action, payload = {}) {
  try {
    const result = await api.invoke(action, payload);
    if (result.error) throw new Error(result.error);
    uiError = "";
    render(result);
    return result;
  } catch (error) {
    uiError = error.message;
    $("#error").textContent = uiError;
    if ($("#modal").open) $("#modal-error").textContent = uiError;
    return null;
  }
}
function render(next) {
  state = next;
  const active = activeTab();
  const profile = state.sessions.find((s) => s.id === active?.sessionId);
  $("#sessions").replaceChildren(
    ...state.sessions.map((s) => {
      const count = state.tabs.filter((t) => t.sessionId === s.id).length;
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
          `${s.persistent ? "保存セッション" : "一時セッション"}${count ? ` · ${count} タブ` : ""}`,
        ),
      );
      open.append(dot(s.color), description);
      const edit = button(
        "···",
        "session-edit",
        () => sessionModal(s),
        `${s.name}の設定`,
      );
      row.append(open, edit);
      return row;
    }),
  );
  $("#tabs").replaceChildren(
    ...state.tabs.map((t) => {
      const s = state.sessions.find((s) => s.id === t.sessionId);
      const tab = el("div", `tab${t.id === active?.id ? " active" : ""}`);
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(t.id === active?.id));
      tab.tabIndex = 0;
      tab.title = `${s.name} — ${t.title}`;
      const select = () => invoke("select-tab", { id: t.id });
      tab.addEventListener("click", select);
      tab.addEventListener("keydown", (event) => {
        if (event.target === tab && ["Enter", " "].includes(event.key)) {
          event.preventDefault();
          select();
        }
      });
      const indicator = dot(s.color);
      if (t.loading) indicator.classList.add("loading");
      tab.append(
        indicator,
        el("span", "tab-title", `${s.name} / ${t.title}`),
        button(
          "×",
          "tab-close",
          (event) => {
            event.stopPropagation();
            invoke("close-tab", { id: t.id });
          },
          `${s.name}のタブを閉じる`,
        ),
      );
      return tab;
    }),
    button("＋", "new-tab", () => newTabModal(), "新しいタブ"),
  );
  const worksets = state.worksets.map((w) => {
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
  if (document.activeElement !== $("#address"))
    $("#address").value =
      active?.url === "about:blank" ? "" : active?.url || "";
  $("#address-dot").style.setProperty("--color", profile?.color || "#6478ff");
  $("#back").disabled = !active?.canGoBack;
  $("#forward").disabled = !active?.canGoForward;
  $("#auth-notice").hidden = !active?.authNotice;
  document.body.classList.toggle(
    "has-auth-notice",
    Boolean(active?.authNotice),
  );
  $("#welcome").hidden = Boolean(active && active.url !== "about:blank");
  $("#status").textContent = profile
    ? `${profile.name}  /  ${profile.persistent ? "保存" : "一時"}${active?.loading ? "  · 読み込み中…" : ""}`
    : "";
  $("#error").textContent = uiError || active?.error || "";
}
async function showModal(title, submitText, build, submit) {
  if ($("#modal").open || modalClosing) return;
  const result = await invoke("overlay", { open: true });
  if (!result) return;
  $("#modal-title").textContent = title;
  $("#modal-submit").textContent = submitText;
  $("#modal-error").textContent = "";
  $("#modal-body").replaceChildren();
  build($("#modal-body"));
  modalSubmit = submit;
  $("#modal").showModal();
  $("#modal-body").querySelector("input, select, button")?.focus();
}
async function closeModal() {
  if (modalClosing) return;
  modalClosing = true;
  $("#modal").close();
  modalSubmit = null;
  await invoke("overlay", { open: false });
  modalClosing = false;
}
function field(parent, name, value = "", help) {
  const id = `field-${name}`;
  const caption = el("label", "", name);
  caption.htmlFor = id;
  const input = el("input");
  input.id = id;
  input.value = value;
  input.maxLength = 80;
  input.required = true;
  parent.append(caption, input);
  if (help) parent.append(el("p", "help", help));
  return input;
}
function sessionSelect(parent, currentId) {
  const caption = el("label", "", "使用するセッション");
  caption.htmlFor = "session-choice";
  const select = el("select");
  select.id = "session-choice";
  for (const s of state.sessions) {
    const option = el(
      "option",
      "",
      `${s.name}（${s.persistent ? "保存" : "一時"}）`,
    );
    option.value = s.id;
    select.append(option);
  }
  select.value = currentId || state.sessions[0].id;
  parent.append(caption, select);
  return select;
}
function sessionModal(profile) {
  let name, persistent;
  selectedColor =
    profile?.color || state.colors[state.sessions.length % state.colors.length];
  showModal(
    profile ? "セッションの設定" : "新しいセッション",
    profile ? "変更を保存" : "作成して開く",
    (body) => {
      name = field(
        body,
        "セッション名",
        profile?.name || "",
        "例：A社 a1、運営、未ログイン",
      );
      body.append(el("label", "", "識別色"));
      const colors = el("div", "colors");
      colors.setAttribute("role", "radiogroup");
      colors.setAttribute("aria-label", "識別色");
      for (const color of state.colors) {
        const option = button(
          "",
          "color-option",
          () => {
            selectedColor = color;
            for (const child of colors.children)
              child.setAttribute("aria-checked", String(child === option));
          },
          color,
        );
        option.style.setProperty("--color", color);
        option.setAttribute("role", "radio");
        option.setAttribute("aria-checked", String(color === selectedColor));
        colors.append(option);
      }
      body.append(colors);
      if (!profile) {
        const check = el("label", "check-label");
        persistent = el("input");
        persistent.type = "checkbox";
        persistent.checked = true;
        check.append(
          persistent,
          document.createTextNode("終了後もログイン状態を保存する"),
        );
        body.append(check);
        body.append(
          el(
            "p",
            "help",
            "チェックを外すと一時セッションになります。アプリを終了すると状態がリセットされます。",
          ),
        );
      } else {
        body.append(
          el(
            "p",
            "help",
            `${profile.persistent ? "保存" : "一時"}セッションです。種類を変える場合は新しく作成してください。`,
          ),
        );
        const actions = el("div", "danger-actions");
        actions.append(
          button("保存データを初期化", "", async () => {
            const result = await invoke("reset-session", { id: profile.id });
            if (result) closeModal();
          }),
          button("セッションを削除", "", async () => {
            const result = await invoke("delete-session", { id: profile.id });
            if (result) closeModal();
          }),
        );
        body.append(actions);
      }
    },
    async () =>
      invoke(profile ? "edit-session" : "create-session", {
        id: profile?.id,
        name: name.value,
        persistent: persistent?.checked,
        color: selectedColor,
      }),
  );
}
function newTabModal(copyURL = false) {
  let select;
  const url = copyURL ? activeTab()?.url : "about:blank";
  showModal(
    copyURL ? "別セッションで開く" : "新しいタブ",
    "タブを開く",
    (body) => {
      select = sessionSelect(body, activeTab()?.sessionId);
      body.append(
        el(
          "p",
          "help",
          copyURL
            ? "選択したセッションで現在のURLを開きます。入力内容は引き継ぎません。"
            : "同じセッションのタブはログイン状態を共有します。",
        ),
      );
    },
    () => invoke("create-tab", { sessionId: select.value, url }),
  );
}
function saveWorksetModal() {
  let name;
  showModal(
    "タブ構成を保存",
    "作業セットを保存",
    (body) => {
      name = field(body, "作業セット名", "", "例：メッセージ機能テスト");
      body.append(
        el(
          "p",
          "help",
          `${state.tabs.length}個のタブのURL・順番・セッションを保存します。入力途中の内容や通信履歴は保存しません。URLに含まれる機密情報に注意してください。`,
        ),
      );
    },
    () => invoke("save-workset", { name: name.value }),
  );
}
function focusAddress() {
  $("#address").focus();
  $("#address").select();
}
$("#address-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = await invoke("navigate", { url: $("#address").value });
  if (result) {
    $("#address").blur();
    render(result);
  }
});
$("#back").addEventListener("click", () => invoke("back"));
$("#forward").addEventListener("click", () => invoke("forward"));
$("#reload").addEventListener("click", () => invoke("reload"));
$("#devtools").addEventListener("click", () => invoke("devtools"));
$("#open-as").addEventListener("click", () => newTabModal(true));
$("#add-session").addEventListener("click", () => sessionModal());
$("#save-workset").addEventListener("click", saveWorksetModal);
$("#focus-address").addEventListener("click", focusAddress);
$("#modal-close").addEventListener("click", closeModal);
$("#modal-cancel").addEventListener("click", closeModal);
$("#modal").addEventListener("cancel", (event) => {
  event.preventDefault();
  closeModal();
});
$("#modal-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!modalSubmit) return;
  $("#modal-submit").disabled = true;
  try {
    const result = await modalSubmit();
    if (result) await closeModal();
  } finally {
    $("#modal-submit").disabled = false;
  }
});
api.subscribe(render);
api.onShortcut((name) => {
  if ($("#modal").open) return;
  if (name === "address") focusAddress();
  if (name === "new-tab") newTabModal();
  if (name === "save-workset") saveWorksetModal();
});
invoke("state");

$("#dismiss-auth-notice").addEventListener("click", () =>
  invoke("dismiss-auth-notice"),
);
