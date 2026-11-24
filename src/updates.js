const https = require("node:https");
const http = require("node:http");
const { compareVersions } = require("./runtime-model");
const RELEASES =
  "https://github.com/kirishima677/multisession-browser/releases";
const FEED =
  "https://api.github.com/repos/kirishima677/multisession-browser/releases/latest";
function releaseURL(value) {
  try {
    const url = new URL(value);
    return url.origin === "https://github.com" &&
      url.pathname.startsWith("/kirishima677/multisession-browser/releases/") &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function readRelease(url) {
  const target = new URL(url);
  if (
    target.protocol !== "https:" &&
    !(
      target.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
    )
  )
    return Promise.reject(new Error("更新情報にはHTTPSを使用してください。"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const request = (target.protocol === "https:" ? https : http).get(
      target,
      {
        headers: {
          "User-Agent": "Multisession-Browser-Update-Check",
          Accept: "application/vnd.github+json",
        },
      },
      (response) => {
        if (response.statusCode === 404) {
          done(null, null);
          request.destroy();
          return;
        }
        if (response.statusCode !== 200) {
          done(new Error(`更新サーバーの応答：HTTP ${response.statusCode}`));
          request.destroy();
          return;
        }
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 128 * 1024) {
            done(new Error("更新情報が大きすぎます。"));
            request.destroy();
          } else chunks.push(chunk);
        });
        response.on("end", () => {
          if (settled) return;
          try {
            done(null, JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            done(new Error("更新情報のJSONを読み取れません。"));
          }
        });
        response.on("error", (error) => done(error));
        response.on("aborted", () =>
          done(new Error("更新情報の受信が中断されました。")),
        );
      },
    );
    const timer = setTimeout(() => {
      done(new Error("更新確認がタイムアウトしました。"));
      request.destroy();
    }, 10000);
    request.on("error", (error) => done(error));
  });
}
function createUpdateChecker({ version, publish, url = FEED }) {
  let state = {
      status: "idle",
      current: version,
      latest: "",
      url: "",
      checkedAt: null,
      message: "まだ更新を確認していません。",
    },
    pending;
  function check() {
    if (pending) return pending;
    state = { ...state, status: "checking", message: "更新を確認しています…" };
    publish();
    pending = readRelease(url)
      .then((release) => {
        if (!release)
          state = {
            ...state,
            status: "no-release",
            latest: "",
            url: RELEASES + "/latest",
            message: "公開済みのリリースがありません。",
          };
        else {
          if (release.draft || release.prerelease)
            throw new Error("安定版リリースを確認できません。");
          const latest = release.tag_name;
          const available = compareVersions(latest, version) > 0;
          const link = releaseURL(release.html_url);
          if (!link) throw new Error("リリースの公開先を確認できません。");
          state = {
            ...state,
            latest,
            url: link,
            status: available ? "available" : "current",
            message: available
              ? `${latest} に更新できます。`
              : "起動中のバージョンは最新です。",
          };
        }
      })
      .catch((error) => {
        state = {
          ...state,
          status: "error",
          url: "",
          message: `更新を確認できませんでした：${error.message}`,
        };
      })
      .finally(() => {
        state.checkedAt = new Date().toISOString();
        pending = null;
        publish();
      });
    return pending;
  }
  return {
    get: () => ({ ...state }),
    check,
    openURL: () => state.url && releaseURL(state.url),
  };
}
module.exports = {
  createUpdateChecker,
  compareVersions,
  readRelease,
  releaseURL,
  RELEASES,
};
