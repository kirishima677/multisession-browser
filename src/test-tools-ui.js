const api = window.testTools,
  $ = (selector) => document.querySelector(selector);
let state,
  contextEpoch = -1,
  authState,
  authRequest = 0,
  searchRequest = 0,
  currentResponse,
  currentQuery = "",
  latestResults = [],
  responseRequest = 0,
  searchTimer;
function error(message = "") {
  $("#tools-error").textContent = message;
  $("#tools-error").hidden = !message;
}
function message(text = "") {
  $("#tools-message").textContent = text;
  $("#tools-message").hidden = !text;
}
async function call(action, payload = {}) {
  const result = await api.invoke(action, payload);
  if (result.error) throw new Error(result.error);
  return result;
}
function option(value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}
function fillOptions(select, entries, initial) {
  const signature = JSON.stringify(entries);
  if (select.dataset.signature === signature) return;
  const previous = select.value;
  select.replaceChildren(...entries.map(([id, label]) => option(id, label)));
  select.dataset.signature = signature;
  select.value = entries.some(([id]) => id === previous)
    ? previous
    : (initial ?? entries[0]?.[0] ?? "");
}
function page(name) {
  $("#auth-panel").hidden = name !== "auth";
  $("#network-panel").hidden = name !== "network";
  $("#auth-tab").classList.toggle("selected", name === "auth");
  $("#network-tab").classList.toggle("selected", name === "network");
}
function render(next) {
  if (state && next.revision < state.revision) return;
  state = next;
  fillOptions(
    $("#auth-session"),
    next.sessions.map((s) => [s.id, s.name]),
    next.context.sessionId,
  );
  fillOptions(
    $("#search-session"),
    [["", "すべてのセッション"], ...next.sessions.map((s) => [s.id, s.name])],
    "",
  );
  fillOptions(
    $("#search-tab"),
    [["", "すべてのタブ"], ...next.tabs.map((t) => [t.id, t.title])],
    "",
  );
  $("#recording").textContent = next.capture.recording
    ? "記録を停止"
    : "記録を開始";
  $("#recording-state").textContent =
    `${next.capture.recording ? "● 記録中" : "停止中"} · ${next.capture.count}件 / 300件 · ${(next.capture.bytes / 1024 / 1024).toFixed(2)} / 20 MiB${next.capture.evicted ? ` · 古い${next.capture.evicted}件を削除済み` : ""}`;
  $("#capture-errors").textContent = next.capture.targets
    .map((t) => `${t.title || t.tabId}：${t.error}`)
    .join("\n");
  $("#capture-errors").hidden = !next.capture.targets.length;
  $("#protection").textContent = next.protection.message;
  $("#manual-save").disabled =
    !next.protection.available || next.protection.vaultLocked;
  if ($("#manual-save").disabled) $("#manual-save").checked = false;
  if (contextEpoch !== next.context.epoch) {
    contextEpoch = next.context.epoch;
    authRequest++;
    authState = null;
    clearAuth();
    $("#auth-session").value =
      next.context.sessionId || next.sessions[0]?.id || "";
    $("#auth-url").value = next.context.url || "";
    $("#manual-value").value = "";
    $("#manual-save").checked = false;
    page(next.context.page);
    error();
    message();
    if (next.context.page === "auth" && /^https?:\/\//.test(next.context.url))
      loadAuth();
    if (next.context.page === "network") search();
  } else if (!$("#network-panel").hidden) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(search, 200);
  }
}
function authContext() {
  return { sessionId: $("#auth-session").value, url: $("#auth-url").value };
}
function clearAuth() {
  $("#candidate").replaceChildren(option("", "候補を取得してください"));
  $("#candidate-meta").textContent = "";
  $("#claims").textContent = "候補を選択すると表示します。";
  $("#token-visible").value = "";
  $("#token-visible").hidden = true;
  for (const id of ["copy-token", "copy-cookie", "reveal-token"])
    $(`#${id}`).disabled = true;
}
function showAuth(value) {
  authState = value;
  if (value.warning) error(value.warning);
  $("#candidate").replaceChildren(
    option(
      "",
      value.candidates.length
        ? "使用する候補を選択"
        : "候補なし（直接入力もできます）",
    ),
    ...value.candidates.map((c) =>
      option(
        c.key,
        `${c.kind === "manual" ? "手入力" : c.name} / ${c.domain}${c.path} / ${c.preview}`,
      ),
    ),
  );
  $("#candidate").value = value.selected || "";
  showCandidate();
}
function showCandidate() {
  const c = authState?.candidates.find((c) => c.key === $("#candidate").value);
  $("#token-visible").value = "";
  $("#token-visible").hidden = true;
  for (const id of ["copy-token", "copy-cookie", "reveal-token"])
    $(`#${id}`).disabled = !c;
  const expiry = c?.info?.expiresAt;
  $("#candidate-meta").textContent = c
    ? `${c.kind === "manual" ? (c.saved ? "暗号化して保存済み" : "この起動中のみ") : `Cookie：${c.name} · ${c.httpOnly ? "HttpOnly" : "JavaScriptから参照可能"}`}\nJWT期限：${expiry ? new Date(expiry).toLocaleString() + (Date.parse(expiry) <= Date.now() ? "（期限切れ）" : "") : "取得できません"}${c.cookieExpiresAt ? "\nCookie期限：" + new Date(c.cookieExpiresAt).toLocaleString() : ""}`
    : "";
  $("#claims").textContent = c?.info
    ? JSON.stringify(
        {
          format: c.info.format,
          header: c.info.header,
          payload: c.info.claims,
        },
        null,
        2,
      )
    : "JWT形式として解読できません。値のコピーは可能です。";
}
async function loadAuth() {
  const run = ++authRequest;
  clearAuth();
  error();
  try {
    const result = await call("auth-list", {
      ...authContext(),
      all: $("#all-cookies").checked,
    });
    if (run === authRequest) showAuth(result);
  } catch (e) {
    if (run === authRequest) error(e.message);
  }
}
$("#auth-tab").addEventListener("click", () => page("auth"));
$("#network-tab").addEventListener("click", () => {
  page("network");
  search();
});
$("#auth-refresh").addEventListener("click", loadAuth);
$("#all-cookies").addEventListener("change", loadAuth);
$("#auth-session").addEventListener("change", () => {
  clearAuth();
  authState = null;
  loadAuth();
});
$("#auth-url").addEventListener("input", () => {
  authRequest++;
  authState = null;
  clearAuth();
});
$("#candidate").addEventListener("change", async () => {
  const key = $("#candidate").value;
  if (!key) {
    showCandidate();
    return;
  }
  const run = ++authRequest;
  for (const id of ["copy-token", "copy-cookie", "reveal-token"])
    $(`#${id}`).disabled = true;
  try {
    const result = await call("auth-select", {
      ...authContext(),
      key,
      all: $("#all-cookies").checked,
    });
    if (run === authRequest) {
      showAuth(result);
      message("使用する候補を選択しました。");
    }
  } catch (e) {
    error(e.message);
  }
});
async function copyToken(format) {
  if (!authState?.selected) return;
  try {
    await call("auth-copy", {
      sessionId: authState.sessionId,
      url: authState.url,
      format,
    });
    message("コピーしました。");
    error();
  } catch (e) {
    error(e.message);
  }
}
$("#copy-token").addEventListener("click", () => copyToken("value"));
$("#copy-cookie").addEventListener("click", () => copyToken("cookie"));
$("#reveal-token").addEventListener("click", async () => {
  const run = authRequest,
    selected = authState;
  if (!selected?.selected) return;
  try {
    const result = await call("auth-reveal", {
      sessionId: selected.sessionId,
      url: selected.url,
    });
    if (run !== authRequest || selected !== authState) return;
    $("#token-visible").value = result.value;
    $("#token-visible").hidden = false;
  } catch (e) {
    if (run === authRequest) error(e.message);
  }
});
$("#manual-apply").addEventListener("click", async () => {
  const run = ++authRequest;
  try {
    const result = await call("auth-manual", {
      ...authContext(),
      name: $("#manual-name").value,
      value: $("#manual-value").value,
      save: $("#manual-save").checked,
      all: $("#all-cookies").checked,
    });
    if (run === authRequest) {
      showAuth(result);
      $("#manual-value").value = "";
      message("手入力トークンを選択しました。");
      error();
    }
  } catch (e) {
    error(e.message);
  }
});
async function search() {
  const run = ++searchRequest,
    query = $("#query").value;
  try {
    const result = await call("search", {
      query,
      sessionId: $("#search-session").value,
      tabId: $("#search-tab").value,
    });
    if (run !== searchRequest) return;
    latestResults = result.results;
    currentQuery = query;
    $("#results-count").textContent =
      `${result.total}件${result.limited ? "（最新100件を表示）" : ""}`;
    renderResults();
  } catch (e) {
    error(e.message);
  }
}
function highlight(node, text, query) {
  const at = query
    ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
    : -1;
  if (at < 0) {
    node.textContent = text;
    return;
  }
  const mark = document.createElement("mark");
  mark.textContent = text.slice(at, at + query.length);
  node.append(
    document.createTextNode(text.slice(0, at)),
    mark,
    document.createTextNode(text.slice(at + query.length)),
  );
}
const resultNodes = new Map();
function renderResults() {
  const parent = $("#results"),
    ids = new Set(latestResults.map((r) => r.id));
  for (const [id, node] of resultNodes)
    if (!ids.has(id)) {
      node.remove();
      resultNodes.delete(id);
    }
  parent.querySelector(".empty-results")?.remove();
  if (!latestResults.length) {
    const empty = document.createElement("p");
    empty.className = "help empty-results";
    empty.textContent =
      "該当する応答はありません。記録を開始してから対象ページで操作してください。";
    parent.append(empty);
    return;
  }
  latestResults.forEach((r, index) => {
    let node = resultNodes.get(r.id);
    if (!node) {
      node = document.createElement("button");
      node.dataset.responseId = r.id;
      node.append(
        document.createElement("strong"),
        document.createElement("small"),
        document.createElement("span"),
      );
      node.lastChild.className = "snippet";
      node.addEventListener("click", () => openResponse(r.id));
      resultNodes.set(r.id, node);
    }
    node.className = `result${currentResponse?.id === r.id ? " selected" : ""}`;
    node.children[0].textContent = `${r.sessionName} / ${r.title || "タブ"}`;
    node.children[1].textContent = `${new Date(r.createdAt).toLocaleTimeString()} · ${r.status} ${r.method} ${r.url}`;
    node.children[2].replaceChildren();
    highlight(
      node.children[2],
      r.snippet || r.note || "(本文なし)",
      currentQuery,
    );
    if (parent.children[index] !== node)
      parent.insertBefore(node, parent.children[index] || null);
  });
}
async function openResponse(id) {
  const run = ++responseRequest;
  try {
    const record = await call("response", { id });
    if (run !== responseRequest) return;
    currentResponse = record;
    $("#response-meta").textContent =
      `${record.sessionName} / ${record.title}\n${new Date(record.createdAt).toLocaleString()} · ${record.status} ${record.method} ${record.url}`;
    $("#response-note").textContent = [
      record.note,
      record.truncated
        ? "本文の保持上限を超えているため、一部のみ表示しています。"
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    $("#response-note").hidden = !$("#response-note").textContent;
    const body = $("#response-body");
    body.value = record.body;
    $("#activate-source").disabled = !record.sourceOpen;
    $("#copy-selected").disabled = !record.body;
    $("#copy-body").disabled = !record.body;
    renderResults();
    const at = currentQuery
      ? record.body
          .toLocaleLowerCase()
          .indexOf(currentQuery.toLocaleLowerCase())
      : -1;
    if (at >= 0) {
      body.focus();
      body.setSelectionRange(at, at + currentQuery.length);
      body.scrollTop = Math.max(
        0,
        (record.body.slice(0, at).split("\n").length - 4) * 19.8,
      );
    }
    error();
  } catch (e) {
    error(e.message);
  }
}
$("#search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  search();
});
$("#search-session").addEventListener("change", search);
$("#search-tab").addEventListener("change", search);
$("#recording").addEventListener("click", async () => {
  try {
    render(await call("recording", { enabled: !state.capture.recording }));
    error();
  } catch (e) {
    error(e.message);
  }
});
$("#clear-responses").addEventListener("click", async () => {
  try {
    render(await call("clear-responses"));
    responseRequest++;
    currentResponse = null;
    $("#response-body").value = "";
    $("#response-meta").textContent = "検索結果を選択してください。";
    $("#response-note").hidden = true;
    for (const id of ["activate-source", "copy-selected", "copy-body"])
      $(`#${id}`).disabled = true;
    search();
  } catch (e) {
    error(e.message);
  }
});
$("#activate-source").addEventListener("click", async () => {
  try {
    await call("activate-source", { id: currentResponse.id });
    error();
  } catch (e) {
    error(e.message);
  }
});
async function copyResponse(all) {
  if (!currentResponse) return;
  const body = $("#response-body");
  try {
    await call("copy-selection", {
      id: currentResponse.id,
      start: all ? 0 : body.selectionStart,
      end: all ? body.value.length : body.selectionEnd,
    });
    message("コピーしました。");
    error();
  } catch (e) {
    error(e.message);
  }
}
$("#copy-selected").addEventListener("click", () => copyResponse(false));
$("#copy-body").addEventListener("click", () => copyResponse(true));
api.onState(render);
call("state")
  .then(render)
  .catch((e) => error(e.message));
