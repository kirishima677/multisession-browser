const api = window.browserAPI;
const $ = (selector) => document.querySelector(selector);
let state;
let modalSubmit;
let selectedColor;
let modalClosing = false;
let uiError = "";
let tabDrag = null;
let suppressTabClick = false;
const tabNodes = new Map();
const paneNodes = new Map();
let addTabButton;
let addressTabId;
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
function makeTabNode(id) {
  const tab = el("div", "tab");
  tab.setAttribute("role", "tab");
  tab.tabIndex = 0;
  tab.dataset.tabId = id;
  tab.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button") || tabDrag) return;
    tabDrag = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  });
  const select = () => invoke("select-tab", { id });
  tab.addEventListener("click", () => {
    if (!suppressTabClick) select();
  });
  tab.addEventListener("keydown", (event) => {
    if (event.target !== tab) return;
    if (
      event.altKey &&
      event.shiftKey &&
      ["ArrowLeft", "ArrowRight"].includes(event.key)
    ) {
      event.preventDefault();
      const ids = state.tabs.map((t) => t.id),
        at = ids.indexOf(id);
      const beforeId =
        event.key === "ArrowLeft"
          ? ids[Math.max(0, at - 1)]
          : ids[at + 2] || null;
      invoke("reorder-tab", { id, beforeId }).then(() =>
        tabNodes.get(id)?.focus(),
      );
    } else if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      select();
    }
  });
  tab.append(
    dot("#6478ff"),
    el("span", "tab-title"),
    el("span", "tab-pane"),
    button("×", "tab-close", (event) => {
      event.stopPropagation();
      invoke("close-tab", { id });
    }),
  );
  return tab;
}
function renderTabs() {
  const nav = $("#tabs");
  const ids = new Set(state.tabs.map((t) => t.id));
  for (const [id, node] of tabNodes)
    if (!ids.has(id)) {
      node.remove();
      tabNodes.delete(id);
    }
  state.tabs.forEach((t, index) => {
    let node = tabNodes.get(t.id);
    if (!node) {
      node = makeTabNode(t.id);
      tabNodes.set(t.id, node);
    }
    const profile = state.sessions.find((s) => s.id === t.sessionId);
    const selected = t.id === state.activeId;
    const side =
      state.split?.left === t.id
        ? "LEFT"
        : state.split?.right === t.id
          ? "RIGHT"
          : "";
    node.classList.toggle("active", selected);
    node.classList.toggle("in-split", Boolean(side));
    node.setAttribute("aria-selected", String(selected));
    node.title = `${profile.name} — ${t.title}\nドラッグで並び替え／画面の左右にドロップして分割`;
    const indicator = node.querySelector(".dot");
    indicator.style.setProperty("--color", profile.color);
    indicator.classList.toggle("loading", t.loading);
    node.querySelector(".tab-title").textContent =
      `${profile.name} / ${t.title}`;
    const badge = node.querySelector(".tab-pane");
    badge.textContent = side;
    badge.hidden = !side;
    const close = node.querySelector(".tab-close");
    close.title = `${profile.name}のタブを閉じる`;
    close.setAttribute("aria-label", close.title);
    // Keep the same DOM nodes through title/focus updates and pointer sequences.
    if (nav.children[index] !== node)
      nav.insertBefore(node, nav.children[index] || null);
  });
  if (!addTabButton)
    addTabButton = button("＋", "new-tab", () => newTabModal(), "新しいタブ");
  if (nav.lastElementChild !== addTabButton) nav.append(addTabButton);
}
function render(next) {
  if (state && next.revision < state.revision) return;
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
  renderTabs();
  renderSplit();
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
  if (
    document.activeElement !== $("#address") ||
    addressTabId !== state.activeId
  )
    $("#address").value =
      active?.url === "about:blank" ? "" : active?.url || "";
  addressTabId = state.activeId;
  $("#address-dot").style.setProperty("--color", profile?.color || "#6478ff");
  $("#back").disabled = !active?.canGoBack;
  $("#forward").disabled = !active?.canGoForward;
  $("#auth-notice").hidden = !active?.authNotice;
  document.body.classList.toggle(
    "has-auth-notice",
    Boolean(active?.authNotice),
  );
  $("#welcome").hidden = Boolean(
    state.split || (active && active.url !== "about:blank"),
  );
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
  if (tabDrag?.active) return;
  if ($("#modal").open) return;
  if (name === "address") focusAddress();
  if (name === "new-tab") newTabModal();
  if (name === "save-workset") saveWorksetModal();
});
invoke("state");

$("#dismiss-auth-notice").addEventListener("click", () =>
  invoke("dismiss-auth-notice"),
);

function renderSplit() {
  const split = state.split;
  document.body.classList.toggle("is-split", Boolean(split));
  $("#pane-bar").hidden = !split;
  $("#split-placeholders").hidden = !split;
  $("#toggle-split").textContent = split ? "◫ 解除" : "◫ 分割";
  $("#toggle-split").setAttribute(
    "aria-label",
    split ? "分割を解除" : "左右分割",
  );
  $("#toggle-split").disabled = !split && state.tabs.length < 2;
  $("#toggle-split").title = split
    ? "選択中のタブを全体表示に戻す"
    : state.tabs.length < 2
      ? "分割表示には2つ以上のタブが必要です"
      : "別のタブと左右に並べる（タブのドラッグでも操作できます）";
  if (!split) return;
  for (const side of ["left", "right"]) {
    let nodes = paneNodes.get(side);
    if (!nodes) {
      const select = () => {
        const id = state.split?.[side];
        if (id) invoke("select-tab", { id });
      };
      const heading = button(
        "",
        "pane-heading",
        select,
        `${side === "left" ? "左" : "右"}ペインを選択`,
      );
      heading.append(dot("#6478ff"), el("span", "pane-label"));
      const placeholder = button("", "pane-placeholder", select);
      placeholder.append(
        el("strong"),
        el("span", "", "このペインを選び、URLまたは検索キーワードを入力"),
      );
      nodes = { heading, placeholder };
      paneNodes.set(side, nodes);
      $("#pane-bar").append(heading);
      $("#split-placeholders").append(placeholder);
    }
    const tab = state.tabs.find((t) => t.id === split[side]);
    const profile = state.sessions.find((s) => s.id === tab.sessionId);
    const selected = tab.id === state.activeId;
    nodes.heading.classList.toggle("selected", selected);
    nodes.heading.setAttribute("aria-pressed", String(selected));
    nodes.heading.dataset.paneTabId = tab.id;
    nodes.heading
      .querySelector(".dot")
      .style.setProperty("--color", profile.color);
    nodes.heading.querySelector(".pane-label").textContent =
      `${side === "left" ? "LEFT" : "RIGHT"} / ${profile.name} — ${tab.title}`;
    nodes.placeholder.querySelector("strong").textContent = profile.name;
    nodes.placeholder.classList.toggle("empty", tab.url === "about:blank");
  }
}
$("#toggle-split").addEventListener("click", () => {
  if (state.split) invoke("end-split");
  else {
    const other = state.tabs.find((t) => t.id !== state.activeId);
    if (other) invoke("split-tab", { id: other.id, side: "right" });
  }
});
function dragTarget(x, y) {
  const rect = $("#tabs").getBoundingClientRect();
  if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
    const others = [...$("#tabs").querySelectorAll("[data-tab-id]")].filter(
      (node) => node.dataset.tabId !== tabDrag.id,
    );
    const before = others.find(
      (node) =>
        x <
        node.getBoundingClientRect().left +
          node.getBoundingClientRect().width / 2,
    );
    return { kind: "reorder", beforeId: before?.dataset.tabId || null };
  }
  const area = $("#content").getBoundingClientRect();
  if (
    state.tabs.length > 1 &&
    x >= area.left &&
    x <= area.right &&
    y >= area.top &&
    y <= area.bottom
  )
    return {
      kind: "split",
      side: x < (area.left + area.right) / 2 ? "left" : "right",
    };
  return null;
}
function updateDrag(event) {
  const drag = tabDrag;
  if (!drag || drag.finishing || event.pointerId !== drag.pointerId) return;
  if (!drag.active) {
    if (
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6
    )
      return;
    drag.active = true;
    suppressTabClick = true;
    $("#tabs").setPointerCapture(event.pointerId);
    document.body.classList.add("dragging-tabs");
    $("#tab-drop-overlay").hidden = state.tabs.length < 2;
    const tab = state.tabs.find((t) => t.id === drag.id);
    const profile = state.sessions.find((s) => s.id === tab.sessionId);
    $("#tab-drag-ghost").textContent = `${profile.name} / ${tab.title}`;
    $("#tab-drag-ghost").hidden = false;
    drag.ready = invoke("tab-drag", { active: true, id: drag.id });
  }
  event.preventDefault();
  drag.target = dragTarget(event.clientX, event.clientY);
  $("#tab-drag-ghost").style.left =
    `${Math.min(event.clientX + 12, window.innerWidth - 250)}px`;
  $("#tab-drag-ghost").style.top = `${Math.max(4, event.clientY - 44)}px`;
  for (const node of $("#tabs").querySelectorAll("[data-tab-id]")) {
    node.classList.toggle("drag-source", node.dataset.tabId === drag.id);
    node.classList.toggle(
      "drop-before",
      drag.target?.kind === "reorder" &&
        node.dataset.tabId === drag.target.beforeId,
    );
    node.classList.toggle(
      "drop-after",
      drag.target?.kind === "reorder" &&
        !drag.target.beforeId &&
        node === $("#tabs").querySelector("[data-tab-id]:last-of-type"),
    );
  }
  for (const zone of $("#tab-drop-overlay").children)
    zone.classList.toggle(
      "drop-active",
      drag.target?.kind === "split" &&
        zone.dataset.dropSide === drag.target.side,
    );
  // Scroll overflowing tab strips while holding a tab near either edge.
  const rect = $("#tabs").getBoundingClientRect();
  if (event.clientY < rect.bottom + 10) {
    if (event.clientX > rect.right - 35) $("#tabs").scrollLeft += 16;
    if (event.clientX < rect.left + 35) $("#tabs").scrollLeft -= 16;
  }
}
async function finishDrag(cancel = false) {
  const drag = tabDrag;
  if (!drag || drag.finishing) return;
  drag.finishing = true;
  if (!drag.active) {
    tabDrag = null;
    return;
  }

  try {
    await drag.ready;
    if (!cancel && drag.target?.kind === "reorder")
      await invoke("reorder-tab", {
        id: drag.id,
        beforeId: drag.target.beforeId,
      });
    if (!cancel && drag.target?.kind === "split")
      await invoke("split-tab", { id: drag.id, side: drag.target.side });
  } finally {
    await invoke("tab-drag", { active: false });
    if ($("#tabs").hasPointerCapture(drag.pointerId))
      $("#tabs").releasePointerCapture(drag.pointerId);
    tabDrag = null;
    for (const node of tabNodes.values())
      node.classList.remove("drag-source", "drop-before", "drop-after");
    document.body.classList.remove("dragging-tabs");
    $("#tab-drop-overlay").hidden = true;
    $("#tab-drag-ghost").hidden = true;
    render(state);
  }
}
window.addEventListener(
  "pointerdown",
  () => {
    suppressTabClick = false;
  },
  { capture: true },
);
window.addEventListener("pointermove", updateDrag, { passive: false });
window.addEventListener("pointerup", () => finishDrag());
window.addEventListener("pointercancel", () => finishDrag(true));
window.addEventListener("blur", () => finishDrag(true));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && tabDrag?.active) {
    event.preventDefault();
    finishDrag(true);
  }
});
