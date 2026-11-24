const {
  inspectToken,
  mask,
  cookieKey,
  targetURL,
  tokenValue,
  cookieName,
  claimSummary,
} = require("./jwt");
const { withDeadline } = require("./protection");
function createAuthManager({
  getConfig,
  profileFor,
  getSession,
  protection,
  persist,
  publish,
}) {
  const ephemeral = new Map(),
    manual = new Map(),
    summaries = new Map(),
    timers = new Map();
  function context(p) {
    const profile = profileFor(p.sessionId),
      url = targetURL(p.url),
      key = `${profile.id}|${new URL(url).origin}`;
    return { profile, url, key };
  }
  function binding(key) {
    return (
      ephemeral.get(key) ||
      getConfig().authBindings.find(
        (b) => `${b.sessionId}|${new URL(b.url).origin}` === key,
      )
    );
  }
  function manualFor(key) {
    return (
      manual.get(key) ||
      (binding(key)?.kind === "manual" ? protection.get(key) : null)
    );
  }
  async function list(p) {
    const { profile, url, key } = context(p),
      selected = binding(key),
      storedManual = manualFor(key);
    let cookies = [],
      warning = "";
    try {
      cookies = await withDeadline(() =>
        getSession(profile).cookies.get({ url }),
      );
    } catch {
      warning =
        "Cookie候補を取得できませんでした。OSの鍵管理を確認するか、トークンを直接入力してください。";
    }
    const candidates = cookies
      .filter(
        (c) =>
          p.all ||
          inspectToken(c.value) ||
          selected?.cookieKey === cookieKey(c),
      )
      .map((c) => ({
        key: cookieKey(c),
        kind: "cookie",
        name: c.name,
        domain: c.domain,
        path: c.path || "/",
        httpOnly: Boolean(c.httpOnly),
        preview: mask(c.value),
        info: inspectToken(c.value),
        cookieExpiresAt: c.expirationDate
          ? new Date(c.expirationDate * 1000).toISOString()
          : null,
      }));
    if (storedManual)
      candidates.push({
        key: "manual",
        kind: "manual",
        name: storedManual.name,
        domain: new URL(url).hostname,
        path: "/",
        preview: mask(storedManual.value),
        info: inspectToken(storedManual.value),
        saved: Boolean(protection.get(key) && !manual.get(key)?.temporary),
      });
    const chosen = candidates.find((c) =>
      selected?.kind === "manual"
        ? c.kind === "manual"
        : c.key === selected?.cookieKey,
    );
    if (selected)
      summaries.set(key, {
        sessionId: profile.id,
        origin: new URL(url).origin,
        name: chosen?.name || "",
        summary: chosen
          ? claimSummary(chosen.info)
          : "選択した候補が見つかりません",
        expiresAt: chosen?.info?.expiresAt || null,
        missing: !chosen,
      });
    return {
      sessionId: profile.id,
      url,
      candidates,
      selected: chosen?.key || "",
      protection: protection.status(),
      warning,
    };
  }
  function saveBinding(entry) {
    const config = getConfig();
    const origin = new URL(entry.url).origin;
    config.authBindings = config.authBindings.filter(
      (b) =>
        b.sessionId !== entry.sessionId || new URL(b.url).origin !== origin,
    );
    config.authBindings.push(entry);
    persist();
  }
  async function refresh(sessionId) {
    const entries = [...getConfig().authBindings, ...ephemeral.values()].filter(
      (b) => b.sessionId === sessionId,
    );
    await Promise.allSettled(entries.map((b) => list(b)));
    publish();
  }
  return {
    list,
    async select(p) {
      const { profile, url, key } = context(p);
      const state = await list({ ...p, all: true }),
        chosen = state.candidates.find((c) => c.key === p.key);
      if (!chosen)
        throw new Error("候補が見つかりません。再取得してください。");
      const entry = {
        sessionId: profile.id,
        url,
        kind: chosen.kind,
        ...(chosen.kind === "cookie"
          ? { cookieKey: chosen.key }
          : { cookieName: chosen.name }),
      };
      if (chosen.kind === "cookie" || chosen.saved) {
        ephemeral.delete(key);
        saveBinding(entry);
      } else ephemeral.set(key, entry);
      const result = await list(p);
      publish();
      return result;
    },
    async manual(p) {
      const { profile, url, key } = context(p),
        value = tokenValue(p.value),
        name = cookieName(p.name);
      if (p.save) {
        await protection.set(key, { value, name });
        manual.delete(key);
        ephemeral.delete(key);
        saveBinding({
          sessionId: profile.id,
          url,
          kind: "manual",
          cookieName: name,
        });
      } else {
        await protection.remove(key);
        manual.set(key, { value, name, temporary: true });
        ephemeral.set(key, {
          sessionId: profile.id,
          url,
          kind: "manual",
          cookieName: name,
        });
        getConfig().authBindings = getConfig().authBindings.filter(
          (b) => `${b.sessionId}|${new URL(b.url).origin}` !== key,
        );
        persist();
      }
      const result = await list(p);
      publish();
      return result;
    },
    async value(p) {
      const { profile, url, key } = context(p),
        selected = binding(key);
      if (!selected) throw new Error("使用する候補を選択してください。");
      if (selected.kind === "manual") {
        const m = manualFor(key);
        if (!m) throw new Error("手入力トークンを読み込めません。");
        return { name: m.name, value: m.value };
      }
      const cookies = await withDeadline(() =>
          getSession(profile).cookies.get({ url }),
        ),
        cookie = cookies.find((c) => cookieKey(c) === selected.cookieKey);
      if (!cookie)
        throw new Error(
          "選択したCookieがありません。再取得して選び直してください。",
        );
      return { name: cookie.name, value: cookie.value };
    },
    watch(ses, id) {
      ses.cookies.on("changed", () => {
        clearTimeout(timers.get(id));
        const timer = setTimeout(() => refresh(id), 150);
        timer.unref();
        timers.set(id, timer);
      });
    },
    init: () =>
      Promise.allSettled(
        getConfig().authBindings.map((b) => refresh(b.sessionId)),
      ),
    summaries: () =>
      [...summaries.values()].map((s) => ({
        ...s,
        expired: s.expiresAt ? Date.parse(s.expiresAt) <= Date.now() : false,
      })),
    async clearSession(id) {
      clearTimeout(timers.get(id));
      for (const map of [ephemeral, manual, summaries])
        for (const key of map.keys())
          if (key.startsWith(`${id}|`)) map.delete(key);
      await protection.removeSession(id);
      getConfig().authBindings = getConfig().authBindings.filter(
        (b) => b.sessionId !== id,
      );
      persist();
      publish();
    },
  };
}
module.exports = { createAuthManager };
