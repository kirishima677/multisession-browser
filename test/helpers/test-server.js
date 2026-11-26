const http = require("node:http");

const { sampleJWT } = require("./tokens");

// Fake accounts, HTTP replies and counters belong to one test only.
async function startTestServer() {
  let server, baseURL;
  const testPNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
    "base64",
  );
  const imageCookies = [];
  let redirectHits = 0;
  let updateHits = 0;
  let releaseFixture = { status: 404, body: {} };
  const tokenA = sampleJWT({
    alumni_id: 101,
    company_name: "テストA社",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const tokenB = sampleJWT({
    alumni_id: 202,
    company_name: "テストB社",
    exp: Math.floor(Date.now() / 1000) + 7200,
  });
  let responseHits = 0;
  const pdfRequestCookies = [];
  server = http.createServer((req, res) => {
    if (req.url.startsWith("/pdf-page")) {
      pdfRequestCookies.push(req.headers.cookie || "");
      const account = req.headers.cookie?.includes("pdf_user=account-a")
        ? "ACCOUNT_A"
        : req.headers.cookie?.includes("pdf_user=account-b")
          ? "ACCOUNT_B"
          : "ANONYMOUS";
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html><html lang="ja"><title>PDF / ${account}:確認?</title>
        <style>@page{size:A4;margin:18mm}body{font:16px -apple-system,BlinkMacSystemFont,sans-serif;color:#20334b}
        h1{color:#375ac5}.banner{padding:20px;background:#edf2ff;border:1px solid #cbd7ff}
        .next{break-before:page}</style>
        <h1>PDF Export ${account}</h1><p class="banner">日本語のPDF出力確認</p>
        <p>First page: ${account}</p><p>ログイン中のページをそのまま保存します。</p>
        <section class="next"><h2>Second Page ${account}</h2><p>2ページ目の内容です。</p></section></html>`);
      return;
    }
    if (req.url.startsWith("/tokens/")) {
      const which = req.url.includes("refresh") ? tokenB : tokenA;
      res.setHeader("Set-Cookie", [
        `access_token=${which}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
        `opaque=opaque-fixture; Path=/; Max-Age=86400`,
      ]);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end("<title>Token fixture</title><h1>Cookie fixture</h1>");
      return;
    }
    if (req.url.startsWith("/response-data")) {
      responseHits++;
      const url = new URL(req.url, "http://localhost");
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          messages: [
            {
              id: 12345,
              body: url.searchParams.get("text") || "横断検索メッセージ",
              thread_id: 987,
            },
          ],
          untrusted: "<script>window.responseExecuted=true</script>",
        }),
      );
      return;
    }
    if (req.url === "/test-update/latest") {
      updateHits++;
      res.writeHead(releaseFixture.status, {
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify(releaseFixture.body));
      return;
    }
    if (req.url.startsWith("/test-api/")) {
      const url = new URL(req.url, "http://localhost");
      if (
        url.pathname === "/test-api/login-a" ||
        url.pathname === "/test-api/login-b"
      ) {
        const role = url.pathname.endsWith("-a") ? "role-a" : "role-b";
        res.setHeader(
          "Set-Cookie",
          `jwt=${role}; Path=/; HttpOnly; SameSite=Lax`,
        );
        res.end(
          "<!doctype html><title>API test login</title><h1>Logged in</h1>",
        );
        return;
      }
      if (url.pathname === "/test-api/redirect") {
        res.writeHead(302, { Location: "/test-api/redirect-target" });
        res.end("redirect");
        return;
      }
      if (url.pathname === "/test-api/redirect-target") redirectHits++;
      if (url.pathname === "/test-api/html") {
        res.setHeader("Content-Type", "text/html");
        res.end(
          "<script>window.evilExecuted=true</script><h1>Untrusted response</h1>",
        );
        return;
      }
      if (url.pathname === "/test-api/large") {
        res.setHeader("Content-Type", "text/plain");
        res.end("x".repeat(5 * 1024 * 1024 + 100));
        return;
      }
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const send = () => {
          if (res.destroyed) return;
          if (url.searchParams.has("setCookie"))
            res.setHeader(
              "Set-Cookie",
              `${url.searchParams.get("setCookie") === "omit" ? "anonUpdated" : "apiUpdated"}=yes; Path=/; HttpOnly; SameSite=Lax`,
            );
          if (
            url.pathname === "/test-api/restricted" &&
            req.headers.cookie?.includes("role-b")
          )
            res.statusCode = 403;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("X-Reply", "fixture");
          res.end(
            JSON.stringify({
              method: req.method,
              cookies: req.headers.cookie || "",
              authorization: req.headers.authorization || "",
              csrf: req.headers["x-csrf-token"] || "",
              query: [...url.searchParams],
              body,
            }),
          );
        };
        if (url.pathname === "/test-api/delay") {
          const timer = setTimeout(
            send,
            Number(url.searchParams.get("ms") || 500),
          );
          res.on("close", () => clearTimeout(timer));
        } else send();
      });
      return;
    }
    if (req.url === "/protected-image.png") {
      imageCookies.push(req.headers.cookie || "");
      if (!req.headers.cookie?.includes("jwt=image-user")) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      });
      res.end(testPNG);
      return;
    }
    if (req.url === "/rich-menu") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        '<!doctype html><title>Rich menu fixture</title><h1>Image browser</h1><p>Needle alpha Needle beta Needle gamma</p><a href="/protected-image.png" id="image-link">Save this link</a><img alt="Private image" src="/protected-image.png" width="80" height="80"><textarea aria-label="Paste area"></textarea>',
      );
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      '<!doctype html><title>Session fixture</title><h1>Local test site</h1><a href="/next">Next</a><input aria-label="Edit me" value="fixture">',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;

  return {
    server,
    baseURL,
    testPNG,
    imageCookies,
    pdfRequestCookies,
    tokenA,
    tokenB,
    get redirectHits() {
      return redirectHits;
    },
    get updateHits() {
      return updateHits;
    },
    get responseHits() {
      return responseHits;
    },
    get releaseFixture() {
      return releaseFixture;
    },
    set releaseFixture(value) {
      releaseFixture = value;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
module.exports = { startTestServer };
