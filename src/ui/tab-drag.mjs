import { $ } from "./dom.mjs";

export function createTabDrag({ getState, invoke, render, clearDragClasses }) {
  let tabDrag = null,
    suppressTabClick = false;
  function begin(event, id) {
    if (event.button !== 0 || event.target.closest("button") || tabDrag) return;
    tabDrag = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  }
  function dragTarget(x, y) {
    const rect = $("#tabs").getBoundingClientRect();
    if (
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    ) {
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
      getState().tabs.length > 1 &&
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
      $("#tab-drop-overlay").hidden = getState().tabs.length < 2;
      const tab = getState().tabs.find((t) => t.id === drag.id);
      const profile = getState().sessions.find((s) => s.id === tab.sessionId);
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
      clearDragClasses();
      document.body.classList.remove("dragging-tabs");
      $("#tab-drop-overlay").hidden = true;
      $("#tab-drag-ghost").hidden = true;
      render(getState());
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
  return {
    begin,
    isActive: () => Boolean(tabDrag?.active),
    isClickSuppressed: () => suppressTabClick,
  };
}
