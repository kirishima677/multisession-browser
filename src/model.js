const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { draft: apiDraft, storedDraft } = require("./api-request");
const { preferences, terminalDefinition } = require("./runtime-model");

const COLORS = [
  "#6478ff",
  "#24a88a",
  "#d78a36",
  "#c166bd",
  "#db626a",
  "#428fce",
];
function label(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80)
    throw new Error("名前は1〜80文字で入力してください。");
  return value.trim();
}
function normalizeURL(value) {
  if (typeof value !== "string" || value.length > 16384)
    throw new Error("URLを入力してください。");
  let input = value.trim();
  if (!input || input === "about:blank") return "about:blank";
  if (!/^[a-z][a-z\d+.-]*:/i.test(input) || /^[^/:]+:\d+(?:\/|$)/.test(input))
    input = `https://${input}`;
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("http / https のURLを指定してください。");
  if (url.username || url.password)
    throw new Error("認証情報を含むURLは保存・表示できません。");
  return url.href;
}
function resolveAddressInput(value) {
  if (typeof value !== "string" || value.length > 16384)
    throw new Error("URLまたは検索キーワードを入力してください。");
  const input = value.trim();
  if (!input || input === "about:blank") return "about:blank";
  const hostWithPort =
    /^(?:localhost|[^\s/:]+\.[^\s/:]+|\[[a-f\d:]+\]):\d+(?:[/?#]|$)/i.test(
      input,
    );
  const explicitURL =
    /^(?:https?|file|data|javascript|vbscript|about|blob|mailto|tel|ftp|chrome|chrome-extension):/i.test(
      input,
    ) || /^[a-z][a-z\d+.-]*:\/\//i.test(input);
  if (explicitURL && !hostWithPort) return normalizeURL(input);
  if (!/\s/.test(input)) {
    try {
      const url = new URL(`https://${input}`);
      const hostname = url.hostname;
      const local =
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.startsWith("[") ||
        /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname);
      if (local || hostname.includes(".")) {
        if (local) url.protocol = "http:";
        return normalizeURL(url.href);
      }
    } catch {
      /* Plain text is a search query. */
    }
  }
  const search = new URL("https://www.google.com/search");
  search.searchParams.set("q", input);
  return search.href;
}
function allowedNavigation(value) {
  try {
    return (
      value === "about:blank" ||
      ["http:", "https:"].includes(new URL(value).protocol)
    );
  } catch {
    return false;
  }
}
function makeSession(name, persistent = true, color = COLORS[0]) {
  if (typeof persistent !== "boolean" || !COLORS.includes(color))
    throw new Error("セッションの設定が不正です。");
  return { id: randomUUID(), name: label(name), persistent, color };
}
function partitionFor(profile, runId) {
  return profile.persistent
    ? `persist:msb-${profile.id}`
    : `msb-${runId}-${profile.id}`;
}
function defaults() {
  return {
    version: 1,
    sessions: ["A社 a1", "A社 a2", "B社 b", "運営 u"].map((name, i) =>
      makeSession(name, true, COLORS[i]),
    ),
    worksets: [],
    apiRequests: [],
    preferences: preferences(),
  };
}
function validateConfig(data) {
  const idOK = (id) => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id);
  if (
    data?.version !== 1 ||
    !Array.isArray(data.sessions) ||
    !Array.isArray(data.worksets) ||
    !data.sessions.length
  )
    throw new Error("設定ファイルの形式が不正です。");
  data.preferences = preferences(data.preferences);
  const ids = new Set();
  for (const s of data.sessions) {
    if (
      !idOK(s.id) ||
      ids.has(s.id) ||
      typeof s.persistent !== "boolean" ||
      !COLORS.includes(s.color)
    )
      throw new Error("セッション設定が不正です。");
    label(s.name);
    ids.add(s.id);
  }
  const worksetIds = new Set();
  for (const w of data.worksets) {
    if (!idOK(w.id) || worksetIds.has(w.id) || !Array.isArray(w.tabs))
      throw new Error("作業セットが不正です。");
    label(w.name);
    worksetIds.add(w.id);
    for (const t of w.tabs) {
      if (!ids.has(t.sessionId))
        throw new Error("作業セットのセッションが見つかりません。");
      if (t.kind && !["web", "api", "terminal"].includes(t.kind))
        throw new Error("タブの種類が不正です。");
      if (t.kind === "api") {
        apiDraft(t.request);
        if (
          t.request.bearer ||
          storedDraft(t.request).headers !== t.request.headers
        )
          throw new Error("APIの保存設定に認証情報は含められません。");
      } else if (t.kind === "terminal") terminalDefinition(t.terminal);
      else normalizeURL(t.url);
    }
  }
  if (data.apiRequests === undefined) data.apiRequests = [];
  if (!Array.isArray(data.apiRequests))
    throw new Error("APIリクエストの保存形式が不正です。");
  const requestIds = new Set();
  for (const r of data.apiRequests) {
    if (!idOK(r.id) || requestIds.has(r.id) || !ids.has(r.sessionId))
      throw new Error("APIリクエストの保存設定が不正です。");
    label(r.name);
    apiDraft(r.request);
    if (
      r.request.bearer ||
      storedDraft(r.request).headers !== r.request.headers
    )
      throw new Error("APIの保存設定に認証情報は含められません。");
    requestIds.add(r.id);
  }
  return data;
}
class ConfigStore {
  constructor(directory) {
    this.file = path.join(directory, "workspace.json");
  }
  load() {
    if (!fs.existsSync(this.file)) return defaults();
    return validateConfig(JSON.parse(fs.readFileSync(this.file, "utf8")));
  }
  save(config) {
    validateConfig(config);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
module.exports = {
  COLORS,
  label,
  normalizeURL,
  resolveAddressInput,
  allowedNavigation,
  makeSession,
  partitionFor,
  defaults,
  validateConfig,
  ConfigStore,
};
