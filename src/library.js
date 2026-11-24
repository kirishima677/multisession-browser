const api = window.libraryAPI,
  $ = (s) => document.querySelector(s);
let state,
  kind = "history",
  epoch = -1,
  request = 0,
  limit = 100,
  currentItems = [],
  editingId = null,
  refreshTimer;
const nodes = new Map();
function error(value = "") {
  $("#library-error").textContent = value;
  $("#library-error").hidden = !value;
}
function message(value = "") {
  $("#library-message").textContent = value;
  $("#library-message").hidden = !value;
}
async function call(action, payload = {}) {
  const result = await api.invoke(action, payload);
  if (result.error) throw new Error(result.error);
  return result;
}
function option(value, label) {
  const el = document.createElement("option");
  el.value = value;
  el.textContent = label;
  return el;
}
function fillSelect(select, entries) {
  const signature = JSON.stringify(entries);
  if (select.dataset.signature === signature) return;
  const old = select.value;
  select.replaceChildren(...entries.map(([v, l]) => option(v, l)));
  select.dataset.signature = signature;
  if (entries.some(([v]) => v === old)) select.value = old;
}
function render(next) {
  if (state && next.revision < state.revision) return;
  state = next;
  fillSelect($("#filter-session"), [
    ["", "すべてのセッション"],
    ...next.sessions.map((s) => [s.id, s.name]),
  ]);
  fillSelect(
    $("#edit-session"),
    next.sessions.map((s) => [s.id, s.name]),
  );
  $("#storage-status").textContent = next.storage.message;
  $("#storage-status").classList.toggle("warning", !next.storage.writable);
  $("#undo-bookmark").hidden =
    !next.storage.undoAvailable || kind !== "bookmarks";
  if (epoch !== next.context.epoch) {
    epoch = next.context.epoch;
    kind = next.context.page;
    $("#query").value = "";
    $("#filter-session").value = "";
    limit = 100;
    updatePage();
    load();
  } else {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(load, 150);
  }
}
function updatePage() {
  $("#history-tab").classList.toggle("selected", kind === "history");
  $("#bookmarks-tab").classList.toggle("selected", kind === "bookmarks");
  $("#clear-history").hidden = kind !== "history";
  $("#undo-bookmark").hidden =
    kind !== "bookmarks" || !state?.storage.undoAvailable;
}
async function load() {
  const run = ++request;
  try {
    const pages = [];
    let result;
    for (let offset = 0; offset < limit; offset += 100) {
      result = await call("list", {
        kind,
        query: $("#query").value,
        sessionId: $("#filter-session").value,
        offset,
      });
      if (run !== request) return;
      pages.push(...result.items);
      if (!result.hasMore) break;
    }
    currentItems = pages;
    $("#count").textContent =
      `${result.total}件${kind === "history" ? " / 最大2000件" : ""}`;
    $("#load-more").hidden = !result.hasMore;
    $("#storage-status").textContent = result.message;
    $("#storage-status").classList.toggle("warning", !result.writable);
    renderItems();
  } catch (e) {
    error(e.message);
  }
}
function actionButton(text, handler, cls = "") {
  const node = document.createElement("button");
  node.textContent = text;
  node.className = cls;
  node.addEventListener("click", handler);
  return node;
}
function renderItems() {
  const parent = $("#items"),
    ids = new Set(currentItems.map((i) => i.id));
  for (const [id, node] of nodes)
    if (!ids.has(id)) {
      node.remove();
      nodes.delete(id);
    }
  parent.querySelector(".empty")?.remove();
  if (!currentItems.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent =
      kind === "history"
        ? "履歴はありません。Webページを開くとここに記録します。"
        : "ブックマークはありません。ページの☆または⌘Dから追加できます。";
    parent.append(empty);
    return;
  }
  currentItems.forEach((item, index) => {
    let node = nodes.get(item.id);
    if (!node) {
      node = document.createElement("article");
      node.className = "item";
      node.dataset.entryId = item.id;
      const info = document.createElement("div");
      info.className = "item-info";
      for (const cls of ["item-title", "item-url", "item-meta"]) {
        const el = document.createElement("div");
        el.className = cls;
        info.append(el);
      }
      const actions = document.createElement("div");
      actions.className = "item-actions";
      node.append(info, actions);
      nodes.set(item.id, node);
    }
    node.querySelector(".item-title").textContent = item.title;
    node.querySelector(".item-url").textContent = item.url;
    const meta = node.querySelector(".item-meta");
    const tag = document.createElement("span");
    tag.className = "session-tag";
    tag.style.setProperty(
      "--session",
      state.sessions.find((s) => s.id === item.sessionId)?.color || "#7182dc",
    );
    tag.textContent = `${item.sessionName}${item.temporary ? "（一時）" : ""}`;
    meta.replaceChildren(
      tag,
      document.createTextNode(
        new Date(item.visitedAt || item.updatedAt).toLocaleString(),
      ),
    );
    const actions = node.querySelector(".item-actions");
    if (node.dataset.kind !== kind) {
      node.dataset.kind = kind;
      actions.replaceChildren(actionButton("開く", () => openItem(item.id)));
      if (kind === "bookmarks")
        actions.append(
          actionButton("編集", () => editItem(item.id)),
          actionButton("削除", () => removeItem(item.id), "danger"),
        );
    }
    if (parent.children[index] !== node)
      parent.insertBefore(node, parent.children[index] || null);
  });
}
async function openItem(id) {
  try {
    await call("open-entry", { kind, id });
    message("登録したセッションの新しいタブで開きました。");
    error();
  } catch (e) {
    error(e.message);
  }
}
function editItem(id) {
  const item = currentItems.find((i) => i.id === id);
  if (!item) return;
  editingId = id;
  $("#edit-title").value = item.title;
  $("#edit-url").value = item.url;
  $("#edit-session").value = item.sessionId;
  $("#editor-error").textContent = "";
  $("#editor").showModal();
  $("#edit-title").focus();
}
async function removeItem(id) {
  try {
    render(await call("remove-bookmark", { id }));
    message("ブックマークを削除しました。元に戻せます。");
    error();
    load();
  } catch (e) {
    error(e.message);
  }
}
$("#history-tab").addEventListener("click", () => {
  kind = "history";
  limit = 100;
  updatePage();
  load();
});
$("#bookmarks-tab").addEventListener("click", () => {
  kind = "bookmarks";
  limit = 100;
  updatePage();
  load();
});
$("#search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  limit = 100;
  load();
});
$("#filter-session").addEventListener("change", () => {
  limit = 100;
  load();
});
$("#load-more").addEventListener("click", () => {
  limit += 100;
  load();
});
$("#undo-bookmark").addEventListener("click", async () => {
  try {
    render(await call("undo-bookmark"));
    message("ブックマークを元に戻しました。");
    load();
  } catch (e) {
    error(e.message);
  }
});
$("#clear-history").addEventListener("click", async () => {
  try {
    render(
      await call("clear-history", { sessionId: $("#filter-session").value }),
    );
    load();
  } catch (e) {
    error(e.message);
  }
});
$("#editor-cancel").addEventListener("click", () => $("#editor").close());
$("#editor-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#editor-save").disabled = true;
  try {
    const result = await call("save-bookmark", {
      id: editingId,
      title: $("#edit-title").value,
      url: $("#edit-url").value,
      sessionId: $("#edit-session").value,
    });
    $("#editor").close();
    render(result);
    message(
      result.item.persisted
        ? "ブックマークを保存しました。"
        : "変更はこの起動中のみ保持します。",
    );
    error();
    load();
  } catch (e) {
    $("#editor-error").textContent = e.message;
  } finally {
    $("#editor-save").disabled = false;
  }
});
api.onState(render);
call("state")
  .then(render)
  .catch((e) => error(e.message));
