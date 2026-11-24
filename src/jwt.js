const { createHash } = require("node:crypto");
function objectPart(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) return null;
  try {
    const value = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}
function inspectToken(value) {
  if (typeof value !== "string" || !value || value.length > 16384) return null;
  let input = value.trim();
  try {
    input = decodeURIComponent(input);
  } catch {}
  const parts = input.split("."),
    header = objectPart(parts[0]);
  if (!header || typeof header.alg !== "string") return null;
  if (
    parts.length === 5 &&
    typeof header.enc === "string" &&
    parts.slice(1).every((p) => /^[A-Za-z0-9_-]*$/.test(p))
  )
    return { format: "JWE", header, claims: null, expiresAt: null };
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]*$/.test(parts[2])) return null;
  const claims = objectPart(parts[1]);
  if (!claims) return null;
  const ms = typeof claims.exp === "number" ? claims.exp * 1000 : NaN;
  return {
    format: "JWT",
    header,
    claims,
    expiresAt:
      Number.isFinite(ms) && Math.abs(ms) <= 8.64e15
        ? new Date(ms).toISOString()
        : null,
  };
}
function mask(value) {
  return value.length <= 14
    ? `${value.slice(0, 3)}…（${value.length}文字）`
    : `${value.slice(0, 7)}…${value.slice(-4)}（${value.length}文字）`;
}
function cookieKey(cookie) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        cookie.name,
        cookie.domain,
        cookie.path || "/",
        Boolean(cookie.secure),
      ]),
    )
    .digest("hex");
}
function targetURL(value) {
  if (typeof value !== "string" || value.length > 16384)
    throw new Error("対象サイトのURLを入力してください。");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "対象サイトは認証情報を含まないhttp/https URLで指定してください。",
    );
  url.search = "";
  url.hash = "";
  return url.href;
}
function tokenValue(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 16384 ||
    /[\r\n\x00]/.test(value)
  )
    throw new Error("トークンは改行を含まない1〜16384文字で入力してください。");
  return value.trim();
}
function cookieName(value = "jwt") {
  if (
    typeof value !== "string" ||
    !/^[!#$%&'*+.^_`|~0-9a-z-]{1,128}$/i.test(value)
  )
    throw new Error("Cookie名の形式を確認してください。");
  return value;
}
function claimSummary(info) {
  if (!info?.claims)
    return info?.format === "JWE"
      ? "暗号化JWT（内容の確認不可）"
      : "JWT形式の確認不可";
  const c = info.claims,
    fields = [
      "alumni_id",
      "company_name",
      "company_id",
      "tenant_id",
      "sub",
      "email",
    ];
  return (
    fields
      .filter((k) => ["string", "number"].includes(typeof c[k]))
      .slice(0, 3)
      .map((k) => `${k}=${String(c[k]).slice(0, 60)}`)
      .join(" / ") || "識別情報なし"
  );
}
function validateBindings(input, sessionIDs) {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error("認証候補の保存形式が不正です。");
  const keys = new Set();
  for (const entry of input) {
    if (
      !entry ||
      !sessionIDs.has(entry.sessionId) ||
      !["cookie", "manual"].includes(entry.kind) ||
      targetURL(entry.url) !== entry.url
    )
      throw new Error("認証候補の設定が不正です。");
    const key = `${entry.sessionId}|${new URL(entry.url).origin}`;
    if (keys.has(key)) throw new Error("認証候補の設定が重複しています。");
    keys.add(key);
    if (entry.kind === "cookie" && !/^[a-f0-9]{64}$/.test(entry.cookieKey))
      throw new Error("Cookie候補の設定が不正です。");
    if (entry.kind === "manual") cookieName(entry.cookieName);
    if (
      Object.keys(entry).some(
        (k) =>
          !["sessionId", "url", "kind", "cookieKey", "cookieName"].includes(k),
      )
    )
      throw new Error("認証設定にトークン値を保存できません。");
  }
  return input;
}
module.exports = {
  inspectToken,
  mask,
  cookieKey,
  targetURL,
  tokenValue,
  cookieName,
  claimSummary,
  validateBindings,
};
