const api = window.apiClient;
const $ = (selector) => document.querySelector(selector);
let state,
  appliedDraftRevision,
  editorMethod,
  responseMode = "pretty",
  requestPanel = "params";
const fieldNames = [
  "name",
  "method",
  "url",
  "params",
  "headers",
  "body",
  "bodyType",
  "auth",
  "bearer",
];
function readDraft() {
  const value = {};
  for (const name of fieldNames) value[name] = $(`#${name}`).value;
  value.timeoutMs = Number($("#timeout").value) * 1000;
  return value;
}
function fillDraft(value) {
  for (const name of fieldNames) $(`#${name}`).value = value[name] ?? "";
  $("#timeout").value = value.timeoutMs / 1000;
  updateEditor();
}
function showError(message) {
  $("#error").textContent = message || "";
  $("#error").hidden = !message;
}
async function invoke(action, payload = {}) {
  try {
    const result = await api.invoke(action, payload);
    if (result.error && !result.id) {
      showError(result.error);
      return null;
    }
    render(result);
    return result;
  } catch (error) {
    showError(error.message);
    return null;
  }
}
function option(value, text) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = text;
  return node;
}
function options(select, records, placeholder, describe) {
  const signature = JSON.stringify(
    records.map((item) => [item.id, describe(item)]),
  );
  if (select.dataset.signature === signature) return;
  select.dataset.signature = signature;
  const previous = select.value;
  select.replaceChildren(
    option("", placeholder),
    ...records.map((item) => option(item.id, describe(item))),
  );
  if (records.some((item) => item.id === previous)) select.value = previous;
}
function render(next) {
  if (state && next.revision < state.revision) return;
  const previous = state?.response;
  state = {
    ...next,
    response: Object.hasOwn(next, "response")
      ? next.response
      : previous?.id === next.result?.id
        ? previous
        : null,
  };
  if (appliedDraftRevision !== next.draftRevision) {
    fillDraft(next.draft);
    appliedDraftRevision = next.draftRevision;
  }
  document.documentElement.style.setProperty("--session", next.session.color);
  $("#session").textContent = next.session.name;
  $("#session").title = `固定セッション：${next.session.name}`;
  for (const name of [...fieldNames, "timeout"])
    $(`#${name}`).disabled = next.running;
  updateEditor();
  $("#send").disabled = next.running;
  $("#send").textContent = next.running ? "送信中…" : "送信 ↗";
  $("#cancel").hidden = !next.running;
  $("#format").disabled = next.running;
  $("#load-saved").disabled = next.running;
  $("#load-history").disabled = next.running;
  const dup = $("#duplicate-session");
  const signature = JSON.stringify(next.sessions);
  if (dup.dataset.signature !== signature) {
    const selected = dup.value;
    dup.dataset.signature = signature;
    dup.replaceChildren(...next.sessions.map((s) => option(s.id, s.name)));
    dup.value = next.sessions.some((s) => s.id === selected)
      ? selected
      : next.session.id;
  }
  options(
    $("#saved"),
    next.saved,
    "保存したリクエストを選択",
    (r) => `${r.name} / ${r.method}`,
  );
  options(
    $("#history"),
    next.history,
    "実行履歴を選択",
    (r) => `${r.status || "ERROR"} ${r.method} ${r.url}`,
  );
  $("#delete-saved").disabled = !next.saved.length;
  showError(next.error);
  const result = next.result;
  $("#result-meta").className = result
    ? result.status < 400
      ? "success"
      : "failure"
    : "";
  $("#result-meta").textContent = next.running
    ? "送信中…"
    : result
      ? `${result.status} ${result.statusText}  ·  ${result.durationMs} ms  ·  ${formatBytes(result.bytes)}`
      : next.error
        ? "送信できませんでした"
        : "まだ送信していません";
  $("#response-url").textContent = result
    ? `${result.method} ${result.url}`
    : "";
  $("#response-url").hidden = !result;
  const note = result?.truncated
    ? "表示上限の5 MiBまで受信しました。"
    : result?.redirectURL
      ? "リダイレクトは自動追跡しません。Locationヘッダーを確認してください。"
      : result?.binary
        ? "バイナリのため本文のテキスト表示は省略しています。"
        : "";
  $("#response-note").textContent = note;
  $("#response-note").hidden = !note;
  $("#copy-response").disabled =
    !state.response || Boolean(state.response.binary);
  renderResponse();
}
function formatBytes(bytes) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}
function selectRequestPanel(name) {
  requestPanel = name;
  for (const tab of document.querySelectorAll("[data-panel]"))
    tab.classList.toggle("selected", tab.dataset.panel === name);
  for (const panel of document.querySelectorAll(".editor-panel"))
    panel.hidden = panel.id !== `panel-${name}`;
}
function updateEditor() {
  const method = $("#method").value;
  const bodyless = ["GET", "HEAD"].includes(method);
  if (method !== editorMethod) {
    editorMethod = method;
    if (bodyless) selectRequestPanel("params");
    else if (method === "POST") selectRequestPanel("body");
  }
  $("[data-panel='body']").hidden = bodyless;
  if (bodyless && requestPanel === "body") selectRequestPanel("params");
  const noBody = bodyless || $("#bodyType").value === "none";
  $("#body").disabled = Boolean(state?.running) || noBody;
  $("#body-help").textContent = bodyless
    ? "GET / HEADでは本文を送信しません。"
    : "本文の上限は1 MiBです。JSONは送信前に形式を検証します。";
  $("#bearer-row").hidden = $("#auth").value !== "bearer";
  $("#auth-help").textContent =
    $("#auth").value === "session"
      ? "このセッションでログインしたCookieを使用します。Set-Cookieによる状態変更もブラウザと共有します。"
      : "ブラウザのCookie・自動認証は送信しません。Bearer値はこの起動中だけ保持します。";
}
function renderResponse() {
  const response = state?.response;
  const panel = $("#response");
  if (!response) {
    panel.textContent = state?.running
      ? "レスポンスを待っています…"
      : "ここにレスポンスが表示されます。";
    return;
  }
  if (responseMode === "headers") {
    panel.textContent = Object.entries(response.headers || {})
      .map(
        ([key, value]) =>
          `${key}: ${Array.isArray(value) ? value.join("\n") : value}`,
      )
      .join("\n");
    return;
  }
  let text = response.body;
  if (response.binary)
    text = `バイナリレスポンス（${formatBytes(response.bytes)}）`;
  else if (responseMode === "pretty" && text) {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* Plain text stays plain text. */
    }
  }
  panel.textContent = text || "(本文なし)";
}
for (const name of [...fieldNames, "timeout"])
  $(`#${name}`).addEventListener("input", () => {
    updateEditor();
    invoke("draft", { draft: readDraft() });
  });
for (const button of document.querySelectorAll("[data-panel]"))
  button.addEventListener("click", () => {
    selectRequestPanel(button.dataset.panel);
  });
for (const button of document.querySelectorAll("[data-response]"))
  button.addEventListener("click", () => {
    responseMode = button.dataset.response;
    for (const tab of document.querySelectorAll("[data-response]"))
      tab.classList.toggle("selected", tab === button);
    renderResponse();
  });
$("#request-form").addEventListener("submit", (event) => {
  event.preventDefault();
  invoke("send", { draft: readDraft() });
});
$("#cancel").addEventListener("click", () => invoke("cancel"));
$("#save").addEventListener("click", async () => {
  const result = await invoke("save", { draft: readDraft() });
  if (result) {
    $("#save").textContent = "保存済み";
    setTimeout(() => ($("#save").textContent = "保存"), 1200);
  }
});
$("#duplicate").addEventListener("click", () =>
  invoke("duplicate", {
    sessionId: $("#duplicate-session").value,
    draft: readDraft(),
  }),
);
$("#load-saved").addEventListener("click", () => {
  if ($("#saved").value) invoke("open-saved", { id: $("#saved").value });
});
$("#delete-saved").addEventListener("click", () => {
  if ($("#saved").value) invoke("delete-saved", { id: $("#saved").value });
});
$("#load-history").addEventListener("click", () => {
  if ($("#history").value) invoke("history", { id: $("#history").value });
});
$("#copy-response").addEventListener("click", () => invoke("copy-response"));
$("#format").addEventListener("click", () => {
  try {
    $("#body").value = JSON.stringify(JSON.parse($("#body").value), null, 2);
    invoke("draft", { draft: readDraft() });
  } catch {
    showError("JSON本文の形式を確認してください。");
  }
});
window.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    if (!state?.running) invoke("send", { draft: readDraft() });
  }
});
api.onState(render);
api.onFocusURL(() => {
  $("#url").focus();
  $("#url").select();
});
invoke("state");
