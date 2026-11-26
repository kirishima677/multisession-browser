import { $, el, button, dot } from "./dom.mjs";

export function createTabView({
  getState,
  invoke,
  newTabModal,
  beginDrag,
  isClickSuppressed,
}) {
  const tabNodes = new Map(),
    paneNodes = new Map();
  let addTabButton;
  function makeTabNode(id) {
    const tab = el("div", "tab");
    tab.setAttribute("role", "tab");
    tab.tabIndex = 0;
    tab.dataset.tabId = id;
    tab.addEventListener("pointerdown", (event) => {
      beginDrag(event, id);
    });
    const select = () => invoke("select-tab", { id });
    tab.addEventListener("click", () => {
      if (!isClickSuppressed()) select();
    });
    tab.addEventListener("keydown", (event) => {
      if (event.target !== tab) return;
      if (
        event.altKey &&
        event.shiftKey &&
        ["ArrowLeft", "ArrowRight"].includes(event.key)
      ) {
        event.preventDefault();
        const ids = getState().tabs.map((t) => t.id),
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
    const ids = new Set(getState().tabs.map((t) => t.id));
    for (const [id, node] of tabNodes)
      if (!ids.has(id)) {
        node.remove();
        tabNodes.delete(id);
      }
    getState().tabs.forEach((t, index) => {
      let node = tabNodes.get(t.id);
      if (!node) {
        node = makeTabNode(t.id);
        tabNodes.set(t.id, node);
      }
      const profile = getState().sessions.find((s) => s.id === t.sessionId);
      const selected = t.id === getState().activeId;
      const side =
        getState().split?.left === t.id
          ? "LEFT"
          : getState().split?.right === t.id
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
  function renderSplit() {
    const split = getState().split;
    document.body.classList.toggle("is-split", Boolean(split));
    $("#pane-bar").hidden = !split;
    $("#split-placeholders").hidden = !split;
    $("#toggle-split").textContent = split ? "◫ 解除" : "◫ 分割";
    $("#toggle-split").setAttribute(
      "aria-label",
      split ? "分割を解除" : "左右分割",
    );
    $("#toggle-split").disabled = !split && getState().tabs.length < 2;
    $("#toggle-split").title = split
      ? "選択中のタブを全体表示に戻す"
      : getState().tabs.length < 2
        ? "分割表示には2つ以上のタブが必要です"
        : "別のタブと左右に並べる（タブのドラッグでも操作できます）";
    if (!split) return;
    for (const side of ["left", "right"]) {
      let nodes = paneNodes.get(side);
      if (!nodes) {
        const select = () => {
          const id = getState().split?.[side];
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
      const tab = getState().tabs.find((t) => t.id === split[side]);
      const profile = getState().sessions.find((s) => s.id === tab.sessionId);
      const selected = tab.id === getState().activeId;
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
    if (getState().split) invoke("end-split");
    else {
      const other = getState().tabs.find((t) => t.id !== getState().activeId);
      if (other) invoke("split-tab", { id: other.id, side: "right" });
    }
  });
  return {
    renderTabs,
    renderSplit,
    clearDragClasses() {
      for (const node of tabNodes.values())
        node.classList.remove("drag-source", "drop-before", "drop-after");
    },
  };
}
