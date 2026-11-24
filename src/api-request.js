const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const AUTH = ["session", "none", "bearer"];
const MAX_BODY = 1024 * 1024;
const MAX_RESPONSE = 5 * 1024 * 1024;
function draft(input = {}) {
  const string = (key, fallback = "", max = 65536) => {
    const value = input[key] ?? fallback;
    if (typeof value !== "string" || value.length > max)
      throw new Error(`${key} の入力が長すぎるか、形式が不正です。`);
    return value;
  };
  const value = {
    name: string("name", "", 80),
    method: string("method", "GET", 10),
    url: string("url", "", 16384),
    params: string("params"),
    headers: string("headers"),
    body: string("body", "", MAX_BODY),
    bodyType: string("bodyType", "json", 10),
    auth: string("auth", "session", 10),
    bearer: string("bearer", "", 8192),
    timeoutMs: input.timeoutMs ?? 30000,
  };
  if (
    !METHODS.includes(value.method) ||
    !AUTH.includes(value.auth) ||
    !["json", "text", "none"].includes(value.bodyType)
  )
    throw new Error("リクエストの設定が不正です。");
  if (
    !Number.isInteger(value.timeoutMs) ||
    value.timeoutMs < 1000 ||
    value.timeoutMs > 120000
  )
    throw new Error("タイムアウトは1〜120秒で指定してください。");
  return value;
}
function storedDraft(input) {
  const value = draft(input);
  value.bearer = "";
  value.headers = value.headers
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/(?:authorization|cookie|token|secret|api[-_]?key)/i.test(
          line.split(":", 1)[0],
        ),
    )
    .join("\n");
  return value;
}
function prepare(input) {
  const value = draft(input);
  if (!/^https?:\/\//i.test(value.url.trim()))
    throw new Error("APIのURLは http:// または https:// で入力してください。");
  const url = new URL(value.url.trim());
  if (url.username || url.password)
    throw new Error("URLに認証情報を含めず、認証設定を使用してください。");
  for (const line of value.params.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const at = line.indexOf("=");
    if (at < 1 || !line.slice(0, at).trim())
      throw new Error("クエリは1行に key=value で入力してください。");
    url.searchParams.append(line.slice(0, at).trim(), line.slice(at + 1));
  }
  url.hash = "";
  if (url.href.length > 16384) throw new Error("クエリを含むURLが長すぎます。");
  const headers = new Map();
  for (const line of value.headers.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const at = line.indexOf(":");
    const name = line.slice(0, at).trim();
    const content = line.slice(at + 1).trim();
    if (
      at < 1 ||
      !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) ||
      /[\x00-\x1f\x7f]/.test(content)
    )
      throw new Error("ヘッダーは1行に Name: value で入力してください。");
    if (
      /^(cookie|authorization|proxy-authorization|host|content-length|connection|transfer-encoding|upgrade)$/i.test(
        name,
      )
    )
      throw new Error(
        `${name} は自動管理します。認証欄または通常のカスタムヘッダーを使用してください。`,
      );
    headers.set(name.toLowerCase(), content);
  }
  let body;
  if (
    !["GET", "HEAD"].includes(value.method) &&
    value.bodyType !== "none" &&
    value.body
  ) {
    if (Buffer.byteLength(value.body) > MAX_BODY)
      throw new Error("本文の上限は1 MiBです。");
    if (value.bodyType === "json") {
      try {
        JSON.parse(value.body);
      } catch {
        throw new Error("JSON本文の形式を確認してください。");
      }
      if (!headers.has("content-type"))
        headers.set("content-type", "application/json");
    }
    body = value.body;
  }
  if (value.auth === "bearer") {
    const token = value.bearer.trim();
    if (!token || /[\r\n\x00]/.test(token))
      throw new Error("Bearerトークンを入力してください。");
    headers.set("authorization", `Bearer ${token}`);
  }
  return {
    url: url.href,
    method: value.method,
    headers: [...headers],
    body,
    credentials: value.auth === "session" ? "include" : "omit",
    timeoutMs: value.timeoutMs,
  };
}
module.exports = {
  METHODS,
  AUTH,
  MAX_BODY,
  MAX_RESPONSE,
  draft,
  storedDraft,
  prepare,
};
