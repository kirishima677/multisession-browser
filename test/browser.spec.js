const { test, expect, _electron: electron } = require("@playwright/test");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const appVersion = require("../package.json").version;

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
function sampleJWT(claims) {
  return [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(JSON.stringify(claims)).toString("base64url"),
    Buffer.from("synthetic-test-signature").toString("base64url"),
  ].join(".");
}

test.beforeAll(async () => {
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
});
test.afterAll(() => new Promise((resolve) => server.close(resolve)));

async function launch(directory, options = {}) {
  const application = await electron.launch({
    ...(options.executablePath || process.env.MSB_EXECUTABLE
      ? {
          executablePath: options.executablePath || process.env.MSB_EXECUTABLE,
          args: [],
        }
      : { args: [path.join(__dirname, "..")] }),
    env: {
      ...process.env,
      MSB_USER_DATA: directory,
      MSB_UPDATE_URL: `${baseURL}/test-update/latest`,
      SHELL: "/bin/zsh",
      ZDOTDIR: directory,
    },
  });
  try {
    await expect
      .poll(
        () =>
          application
            .windows()
            .some((p) => p.url().endsWith("/src/index.html")),
        { timeout: 15000 },
      )
      .toBe(true);
    const shell = application
      .windows()
      .find((p) => p.url().endsWith("/src/index.html"));
    await shell.waitForFunction(() => Boolean(window.browserAPI));
    await expect(
      shell.getByRole("heading", { name: /それぞれのユーザーで/ }),
    ).toBeVisible();
    await shell.screenshot({ path: "test-results/welcome.png" });
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    return { application, shell };
  } catch (error) {
    await application.close();
    throw error;
  }
}
async function command(shell, action, payload = {}) {
  const result = await shell.evaluate(
    ([action, payload]) => window.browserAPI.invoke(action, payload),
    [action, payload],
  );
  expect(result.error).toBeUndefined();
  return result;
}
async function site(application, route = "/") {
  const url = `${baseURL}${route}`;
  await expect
    .poll(() => application.windows().some((p) => p.url() === url))
    .toBe(true);
  const page = application.windows().find((p) => p.url() === url);
  await page.waitForLoadState();
  return page;
}

test("macOS browser isolates sessions, shares tabs, persists logins, resets and restores worksets", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-e2e-"));
  let application;
  try {
    let launched = await launch(directory);
    application = launched.application;
    let shell = launched.shell;
    let state = await command(shell, "state");
    const [a, b] = state.sessions;
    await shell
      .getByRole("textbox", { name: "URLまたは検索キーワード", exact: true })
      .fill(baseURL);
    await shell
      .getByRole("textbox", { name: "URLまたは検索キーワード", exact: true })
      .press("Enter");
    const pageA = await site(application);
    await pageA.evaluate(() => {
      document.cookie = "jwt=account-a; Max-Age=3600; SameSite=Lax; Path=/";
      localStorage.setItem("account", "a");
    });
    expect(await pageA.evaluate(() => typeof window.browserAPI)).toBe(
      "undefined",
    );
    expect(await pageA.evaluate(() => typeof require)).toBe("undefined");
    await command(shell, "create-tab", {
      sessionId: b.id,
      url: `${baseURL}/b`,
    });
    const pageB = await site(application, "/b");
    expect(await pageB.evaluate(() => document.cookie)).toBe("");
    expect(
      await pageB.evaluate(() => localStorage.getItem("account")),
    ).toBeNull();
    await pageB.evaluate(() => {
      document.cookie = "jwt=account-b; Max-Age=3600; Path=/";
      localStorage.setItem("account", "b");
    });
    await command(shell, "create-tab", {
      sessionId: a.id,
      url: `${baseURL}/shared`,
    });
    const pageA2 = await site(application, "/shared");
    expect(await pageA2.evaluate(() => document.cookie)).toContain(
      "jwt=account-a",
    );
    expect(await pageA2.evaluate(() => localStorage.getItem("account"))).toBe(
      "a",
    );

    // Real Chromium popup inherits cookies and does not receive the host preload.
    const popupPromise = application.waitForEvent("window");
    await pageA2.evaluate(
      (url) => window.open(url, "auth", "width=500,height=500"),
      `${baseURL}/popup`,
    );
    const popup = await popupPromise;
    await popup.waitForLoadState();
    expect(await popup.evaluate(() => document.cookie)).toContain(
      "jwt=account-a",
    );
    expect(await popup.evaluate(() => typeof window.browserAPI)).toBe(
      "undefined",
    );
    await popup.close();

    // The selected tab gets a separate, real DevTools window.
    await shell.getByRole("button", { name: /DevTools/ }).click();
    await expect
      .poll(() =>
        application.evaluate(({ webContents }) =>
          webContents
            .getAllWebContents()
            .some((c) => c.getURL().startsWith("devtools://")),
        ),
      )
      .toBe(true);
    await application.evaluate(({ webContents }) => {
      for (const c of webContents.getAllWebContents())
        if (c.isDevToolsOpened()) c.closeDevTools();
    });

    // Session creation and configuration saving through the actual UI.
    await shell
      .getByRole("button", { name: "セッションを追加", exact: true })
      .click();
    await shell.getByLabel("セッション名", { exact: true }).fill("Temporary");
    await shell.getByLabel("終了後もログイン状態を保存する").uncheck();
    await shell.getByRole("button", { name: "作成して開く" }).click();
    await expect(shell.getByRole("dialog")).not.toBeVisible();
    state = await command(shell, "state");
    const temp = state.sessions.find((s) => s.name === "Temporary");
    await command(shell, "navigate", { url: `${baseURL}/temp` });
    const tempPage = await site(application, "/temp");
    await tempPage.evaluate(() => {
      document.cookie = "jwt=temporary; Max-Age=3600; Path=/";
      localStorage.setItem("account", "temp");
    });
    await shell.getByRole("button", { name: /構成を保存/ }).click();
    await shell.getByLabel("作業セット名", { exact: true }).fill("All roles");
    await shell
      .getByRole("button", { name: "作業セットを保存", exact: true })
      .click();
    await expect(shell.getByRole("dialog")).not.toBeVisible();
    state = await command(shell, "state");
    expect(state.worksets[0].tabs).toHaveLength(4);
    const savedId = state.worksets[0].id;
    await command(shell, "restore-workset", { id: savedId });
    state = await command(shell, "state");
    expect(state.tabs).toHaveLength(4);
    const restoredTemp = await site(application, "/temp");
    expect(
      await restoredTemp.evaluate(() => localStorage.getItem("account")),
    ).toBeNull();

    await application.close();
    application = null;
    launched = await launch(directory);
    application = launched.application;
    shell = launched.shell;
    await command(shell, "navigate", { url: baseURL });
    const persistedA = await site(application);
    expect(await persistedA.evaluate(() => document.cookie)).toContain(
      "jwt=account-a",
    );
    expect(
      await persistedA.evaluate(() => localStorage.getItem("account")),
    ).toBe("a");
    await command(shell, "create-tab", {
      sessionId: temp.id,
      url: `${baseURL}/temp`,
    });
    const freshTemp = await site(application, "/temp");
    expect(await freshTemp.evaluate(() => document.cookie)).toBe("");
    expect(
      await freshTemp.evaluate(() => localStorage.getItem("account")),
    ).toBeNull();
    await command(shell, "reset-session", { id: a.id });
    await command(shell, "create-tab", {
      sessionId: a.id,
      url: `${baseURL}/reset`,
    });
    const resetA = await site(application, "/reset");
    expect(await resetA.evaluate(() => document.cookie)).toBe("");
    expect(
      await resetA.evaluate(() => localStorage.getItem("account")),
    ).toBeNull();
    await command(shell, "create-tab", {
      sessionId: b.id,
      url: `${baseURL}/unaffected`,
    });
    const preservedB = await site(application, "/unaffected");
    expect(await preservedB.evaluate(() => document.cookie)).toContain(
      "jwt=account-b",
    );
    expect(
      await preservedB.evaluate(() => localStorage.getItem("account")),
    ).toBe("b");

    const blocked = await shell.evaluate(() =>
      window.browserAPI.invoke("navigate", { url: "file:///etc/passwd" }),
    );
    expect(blocked.error).toContain("http");
    await command(shell, "delete-session", { id: temp.id });
    state = await command(shell, "state");
    expect(state.sessions.some((s) => s.id === temp.id)).toBe(false);
    expect(state.worksets[0].tabs.some((t) => t.sessionId === temp.id)).toBe(
      false,
    );
    expect(state.worksets[0].tabs).toHaveLength(3);
    // Cmd-W/window close lifecycle must not leave invisible remote contents behind.
    await shell.close();
    await expect
      .poll(() =>
        application.evaluate(
          ({ webContents }) =>
            webContents
              .getAllWebContents()
              .filter(
                (c) =>
                  c.getType() === "window" || c.getType() === "browserView",
              ).length,
        ),
      )
      .toBe(0);
    await application.evaluate(({ app }) => app.emit("activate"));
    await expect
      .poll(() =>
        application.windows().some((p) => p.url().endsWith("/src/index.html")),
      )
      .toBe(true);
    const reopened = application
      .windows()
      .find((p) => p.url().endsWith("/src/index.html"));
    await expect(
      reopened.getByRole("heading", { name: /それぞれのユーザーで/ }),
    ).toBeVisible();
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("address focus selects the URL while later clicks and dragging allow editing", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-address-focus-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    const url = `${baseURL}/address-selection?value=keep-this-text`;
    await command(shell, "navigate", { url });
    await site(application, "/address-selection?value=keep-this-text");
    const address = shell.locator("#address");
    await expect(address).toHaveValue(url);
    const selection = () => address.evaluate(input => ({
      start: input.selectionStart, end: input.selectionEnd,
    }));
    const position = { x: 100, y: (await address.boundingBox()).height / 2 };
    await address.evaluate(input => input.blur());
    await address.click({ position });
    expect(await selection()).toEqual({ start: 0, end: url.length });
    await address.click({ position });
    const caret = await selection();
    expect(caret.start).toBe(caret.end);
    await expect(address).toHaveValue(url);

    await address.evaluate(input => input.blur());
    const bounds = await address.boundingBox();
    await shell.mouse.move(bounds.x + 70, bounds.y + bounds.height / 2);
    await shell.mouse.down();
    await shell.mouse.move(bounds.x + 150, bounds.y + bounds.height / 2, { steps: 10 });
    await shell.mouse.up();
    const range = await selection();
    expect(range.end - range.start).toBeGreaterThan(0);
    expect(range.end - range.start).toBeLessThan(url.length);

    await shell.locator("#reload").focus();
    await shell.keyboard.press("Tab");
    await expect(address).toBeFocused();
    expect(await selection()).toEqual({ start: 0, end: url.length });
    await application.evaluate(({ webContents }) => {
      const host = webContents.getAllWebContents().find(c => c.getURL().endsWith("/src/index.html"));
      host.focus();
      host.sendInputEvent({ type: "keyDown", keyCode: "L", modifiers: ["meta"] });
      host.sendInputEvent({ type: "keyUp", keyCode: "L", modifiers: ["meta"] });
    });
    await expect(address).toBeFocused();
    expect(await selection()).toEqual({ start: 0, end: url.length });
    await address.fill(`${url}&edited=yes`);
    await command(shell, "sample-memory");
    await expect(address).toHaveValue(`${url}&edited=yes`);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("four roles remain independent and macOS keyboard shortcuts control the host UI", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-roles-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    const state = await command(shell, "state");
    const pages = [];
    for (const [index, profile] of state.sessions.entries()) {
      await command(shell, "create-tab", {
        sessionId: profile.id,
        url: `${baseURL}/role-${index}`,
      });
      const page = await site(application, `/role-${index}`);
      expect(await page.evaluate(() => document.cookie)).toBe("");
      await page.evaluate((index) => {
        document.cookie = `jwt=role-${index}; Path=/`;
        localStorage.setItem("role", String(index));
      }, index);
      pages.push(page);
    }
    for (const [index, page] of pages.entries()) {
      expect(await page.evaluate(() => document.cookie)).toBe(
        `jwt=role-${index}`,
      );
      expect(await page.evaluate(() => localStorage.getItem("role"))).toBe(
        String(index),
      );
    }
    await pages[0].evaluate(() => {
      document.cookie = "jwt=; Max-Age=0; Path=/";
      localStorage.clear();
    });
    expect(await pages[1].evaluate(() => document.cookie)).toBe("jwt=role-1");
    await application.evaluate(({ webContents }) => {
      const contents = webContents
        .getAllWebContents()
        .find((c) => c.getURL().endsWith("/role-3"));
      contents.focus();
      contents.sendInputEvent({
        type: "keyDown",
        keyCode: "L",
        modifiers: ["meta"],
      });
      contents.sendInputEvent({
        type: "keyUp",
        keyCode: "L",
        modifiers: ["meta"],
      });
    });
    await expect(
      shell.getByRole("textbox", {
        name: "URLまたは検索キーワード",
        exact: true,
      }),
    ).toBeFocused();
    await application.evaluate(({ webContents }) => {
      const contents = webContents
        .getAllWebContents()
        .find((c) => c.getURL().endsWith("/src/index.html"));
      contents.focus();
      contents.sendInputEvent({
        type: "keyDown",
        keyCode: "T",
        modifiers: ["meta"],
      });
      contents.sendInputEvent({
        type: "keyUp",
        keyCode: "T",
        modifiers: ["meta"],
      });
    });
    await expect(shell.getByRole("dialog")).toBeVisible();
    await shell.keyboard.press("Escape");
    await expect(shell.getByRole("dialog")).not.toBeVisible();
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("right-click menus target the originating page and open links in its session", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-menu-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    await command(shell, "navigate", { url: `${baseURL}/menus` });
    const page = await site(application, "/menus");
    await page.evaluate(() => {
      document.cookie = "menu-session=a; Path=/";
    });
    await application.evaluate(({ Menu, clipboard }) => {
      const popup = Menu.prototype.popup;
      Menu.prototype.popup = function (options) {
        global.__contextMenu = this;
        this.once("menu-will-show", () => {
          global.__menuShown = true;
        });
        return popup.call(this, options);
      };
      // Do not touch the user's clipboard during automated tests.
      clipboard.writeText = (text) => {
        global.__copiedText = text;
      };
    });
    await page.getByRole("link", { name: "Next" }).click({ button: "right" });
    await expect
      .poll(() => application.evaluate(() => Boolean(global.__menuShown)))
      .toBe(true);
    const menu = await application.evaluate(() => {
      const menu = global.__contextMenu;
      const result = menu.items.map((item) => ({
        id: item.id,
        enabled: item.enabled,
      }));
      menu.closePopup();
      menu.getMenuItemById("copy-link").click();
      return { items: result, copied: global.__copiedText };
    });
    expect(menu.copied).toBe(`${baseURL}/next`);
    expect(menu.items.some((item) => item.id === "inspect")).toBe(true);
    await application.evaluate(() =>
      global.__contextMenu.getMenuItemById("open-link").click(),
    );
    const next = await site(application, "/next");
    expect(await next.evaluate(() => document.cookie)).toContain(
      "menu-session=a",
    );
    const state = await command(shell, "state");
    expect(new Set(state.tabs.map((t) => t.sessionId)).size).toBe(1);
    // Inspect the clicked page, even after another tab has become active.
    await application.evaluate(() =>
      global.__contextMenu.getMenuItemById("inspect").click(),
    );
    await expect
      .poll(() =>
        application.evaluate(({ webContents }) =>
          webContents
            .getAllWebContents()
            .some((c) => c.getURL().endsWith("/menus") && c.isDevToolsOpened()),
        ),
      )
      .toBe(true);
    await application.evaluate(({ webContents }) => {
      for (const c of webContents.getAllWebContents())
        if (c.isDevToolsOpened()) c.closeDevTools();
    });

    await next
      .getByRole("textbox", { name: "Edit me" })
      .click({ button: "right" });
    await expect
      .poll(() =>
        application.evaluate(() =>
          Boolean(global.__contextMenu?.getMenuItemById("paste")),
        ),
      )
      .toBe(true);
    expect(
      await application.evaluate(() => {
        const menu = global.__contextMenu;
        menu.closePopup();
        return ["cut", "copy", "paste", "select-all"].every((id) =>
          Boolean(menu.getMenuItemById(id)),
        );
      }),
    ).toBe(true);

    // URL input in the host gets editing actions too.
    await shell
      .getByRole("textbox", { name: "URLまたは検索キーワード", exact: true })
      .click({ button: "right" });
    await expect
      .poll(() =>
        application.evaluate(
          () => !global.__contextMenu?.getMenuItemById("inspect"),
        ),
      )
      .toBe(true);
    await application.evaluate(() => global.__contextMenu.closePopup());
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("unsupported WebAuthn settles promptly, reports its limitation and leaves other credentials untouched", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-passkey-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    await command(shell, "navigate", { url: `${baseURL}/passkeys` });
    const page = await site(application, "/passkeys");
    expect(
      await page.evaluate(() =>
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
      ),
    ).toBe(false);
    // Background conditional autofill must not interrupt the user with a banner.
    const conditional = await page.evaluate(async () => {
      try {
        await navigator.credentials.get({
          publicKey: { challenge: new Uint8Array(32) },
          mediation: "conditional",
        });
      } catch (error) {
        return error.name;
      }
    });
    expect(conditional).toBe("NotAllowedError");
    expect((await command(shell, "state")).tabs[0].authNotice).toBe(false);
    for (const method of ["get", "create"]) {
      const result = await page.evaluate(async (method) => {
        return Promise.race([
          navigator.credentials[method]({
            publicKey: { challenge: new Uint8Array(32) },
          }).then(
            () => ({ success: true }),
            (error) => ({ name: error.name, message: error.message }),
          ),
          new Promise((resolve) =>
            setTimeout(() => resolve({ name: "Hung" }), 1500),
          ),
        ]);
      }, method);
      expect(result.name).toBe("NotAllowedError");
      expect(result.message).toContain("Choose another sign-in method");
    }
    await expect(
      shell.getByText(/このビルドはパスキー非対応です/),
    ).toBeVisible();
    expect(await page.evaluate(() => typeof window.browserAPI)).toBe(
      "undefined",
    );
    const normal = await page.evaluate(async () => {
      try {
        return await navigator.credentials.get({ password: true });
      } catch (error) {
        return { name: error.name, message: error.message };
      }
    });
    expect(normal?.message || "").not.toContain("Multisession Browser");
    await shell.getByRole("button", { name: "パスキーの案内を閉じる" }).click();
    await expect(
      shell.getByText(/このビルドはパスキー非対応です/),
    ).not.toBeVisible();
    // OAuth child windows must receive the same fail-fast behavior.
    const popupPromise = application.waitForEvent("window");
    await page.evaluate(
      (url) => window.open(url, "auth"),
      `${baseURL}/passkey-popup`,
    );
    const popup = await popupPromise;
    await popup.waitForLoadState();
    expect(
      await popup.evaluate(async () => {
        try {
          await navigator.credentials.get({
            publicKey: { challenge: new Uint8Array(32) },
          });
        } catch (error) {
          return error.name;
        }
      }),
    ).toBe("NotAllowedError");
    await expect(
      shell.getByText(/このビルドはパスキー非対応です/),
    ).toBeVisible();
    await popup.close();
    await command(shell, "navigate", { url: `${baseURL}/after-auth` });
    await site(application, "/after-auth");
    await expect(
      shell.getByText(/このビルドはパスキー非対応です/),
    ).not.toBeVisible();
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("address input searches text and navigates URLs without external requests in the test", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-search-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    await application
      .context()
      .route("https://www.google.com/search?**", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><title>Search result</title><h1>Search fixture</h1>",
        }),
      );
    const address = shell.getByRole("textbox", {
      name: "URLまたは検索キーワード",
      exact: true,
    });
    await address.fill("Gmail パスキー & 認証");
    await address.press("Enter");
    await expect
      .poll(async () => (await command(shell, "state")).tabs[0].url)
      .toContain("https://www.google.com/search?");
    let state = await command(shell, "state");
    expect(new URL(state.tabs[0].url).searchParams.get("q")).toBe(
      "Gmail パスキー & 認証",
    );
    await address.fill(`${baseURL}/from-address`);
    await address.press("Enter");
    await site(application, "/from-address");
    state = await command(shell, "state");
    expect(state.tabs[0].url).toBe(`${baseURL}/from-address`);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function beginTabDrag(shell, id) {
  const box = await shell.locator(`[data-tab-id="${id}"]`).boundingBox();
  await shell.mouse.move(box.x + 35, box.y + box.height / 2);
  await shell.mouse.down();
  await shell.mouse.move(box.x + 50, box.y + box.height / 2, { steps: 3 });
  await expect
    .poll(async () => (await command(shell, "state")).draggingTab)
    .toBe(true);
}
async function endTabDrag(shell, x, y) {
  await shell.mouse.move(x, y, { steps: 8 });
  await shell.mouse.up();
  await expect
    .poll(async () => (await command(shell, "state")).draggingTab)
    .toBe(false);
  await expect(shell.locator("#tab-drop-overlay")).not.toBeVisible();
  await expect(
    shell.locator("#tabs .drag-source, #tabs .drop-before, #tabs .drop-after"),
  ).toHaveCount(0);
}
async function nativeViews(application) {
  return application.evaluate(({ BrowserWindow }) => {
    const root = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith("/src/index.html"),
    );
    return {
      size: root.getContentSize(),
      views: root.contentView.children
        .filter((v) => v.webContents && !v.webContents.isDestroyed())
        .map((v) => ({
          id: v.webContents.id,
          url: v.webContents.getURL(),
          visible: v.getVisible(),
          bounds: v.getBounds(),
        })),
    };
  });
}

test("drag reorder keeps page state and saves the resulting tab order", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-reorder-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    let state = await command(shell, "state");
    const profile = state.sessions[0];
    await command(shell, "navigate", { url: `${baseURL}/order-a` });
    const pageA = await site(application, "/order-a");
    await pageA
      .getByRole("textbox", { name: "Edit me" })
      .fill("Keep this unsaved input");
    await pageA.evaluate(() => {
      window.keepAliveMarker = "a";
    });
    await command(shell, "create-tab", {
      sessionId: profile.id,
      url: `${baseURL}/order-b`,
    });
    await site(application, "/order-b");
    await command(shell, "create-tab", {
      sessionId: profile.id,
      url: `${baseURL}/order-c`,
    });
    await site(application, "/order-c");
    state = await command(shell, "state");
    const ids = state.tabs.map((t) => t.id);
    const active = state.activeId;
    const viewIds = (await nativeViews(application)).views
      .map((v) => v.id)
      .sort();
    const last = await shell.locator(`[data-tab-id="${ids[2]}"]`).boundingBox();
    await beginTabDrag(shell, ids[0]);
    await endTabDrag(shell, last.x + last.width - 8, last.y + last.height / 2);
    await expect
      .poll(async () => (await command(shell, "state")).tabs.map((t) => t.id))
      .toEqual([ids[1], ids[2], ids[0]]);
    expect((await command(shell, "state")).activeId).toBe(active);
    expect(
      (await nativeViews(application)).views.map((v) => v.id).sort(),
    ).toEqual(viewIds);
    expect(await pageA.evaluate(() => window.keepAliveMarker)).toBe("a");
    expect(
      await pageA.getByRole("textbox", { name: "Edit me" }).inputValue(),
    ).toBe("Keep this unsaved input");
    await command(shell, "save-workset", { name: "Reordered" });
    state = await command(shell, "state");
    expect(state.worksets[0].tabs.map((t) => new URL(t.url).pathname)).toEqual([
      "/order-b",
      "/order-c",
      "/order-a",
    ]);
    // Escape restores the native pages and leaves order intact.
    await beginTabDrag(shell, ids[1]);
    await shell.keyboard.press("Escape");
    await shell.mouse.up();
    await expect
      .poll(async () => (await command(shell, "state")).draggingTab)
      .toBe(false);
    expect((await command(shell, "state")).tabs.map((t) => t.id)).toEqual([
      ids[1],
      ids[2],
      ids[0],
    ]);
    expect(
      (await nativeViews(application)).views.filter((v) => v.visible),
    ).toHaveLength(1);
    // Restore must respect the saved order, not the original creation order.
    await command(shell, "restore-workset", { id: state.worksets[0].id });
    await expect
      .poll(async () =>
        (await command(shell, "state")).tabs.map(
          (t) => new URL(t.url).pathname,
        ),
      )
      .toEqual(["/order-b", "/order-c", "/order-a"]);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("dropping tabs into left or right creates live split panes with isolated sessions", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-split-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    let state = await command(shell, "state");
    const [a, b] = state.sessions;
    await command(shell, "navigate", { url: `${baseURL}/split-a` });
    const pageA = await site(application, "/split-a");
    await pageA.evaluate(() => {
      document.cookie = "jwt=left-account; Path=/";
      window.keepAliveMarker = "left";
      document.querySelector("h1").textContent = "A社 a1 / 送信するユーザー";
      document.body.style.background = "#f0f4ff";
    });
    await pageA.getByRole("textbox", { name: "Edit me" }).fill("Left draft");
    await command(shell, "create-tab", {
      sessionId: b.id,
      url: `${baseURL}/split-b`,
    });
    const pageB = await site(application, "/split-b");
    await pageB.evaluate(() => {
      document.cookie = "jwt=right-account; Path=/";
      window.keepAliveMarker = "right";
      document.querySelector("h1").textContent = "A社 a2 / 受信するユーザー";
      document.body.style.background = "#edf9f5";
    });
    state = await command(shell, "state");
    const [left, right] = state.tabs;
    const before = (await nativeViews(application)).views
      .map((v) => v.id)
      .sort();
    await command(shell, "select-tab", { id: left.id });
    const area = await shell.locator("#content").boundingBox();
    await beginTabDrag(shell, right.id);
    await endTabDrag(shell, area.x + area.width * 0.75, area.y + 120);
    state = await command(shell, "state");
    expect(state.split).toEqual({ left: left.id, right: right.id });
    let native = await nativeViews(application);
    const views = native.views
      .filter((v) => v.visible)
      .sort((a, b) => a.bounds.x - b.bounds.x);
    expect(views).toHaveLength(2);
    expect(views[0].bounds.x).toBe(236);
    expect(views[0].bounds.y).toBe(186);
    expect(views[0].bounds.x + views[0].bounds.width + 8).toBe(
      views[1].bounds.x,
    );
    expect(views[1].bounds.x + views[1].bounds.width).toBe(native.size[0]);
    expect(views[0].bounds.height).toBe(views[1].bounds.height);
    expect(native.views.map((v) => v.id).sort()).toEqual(before);
    expect(
      await pageA.getByRole("textbox", { name: "Edit me" }).inputValue(),
    ).toBe("Left draft");
    expect(await pageA.evaluate(() => document.cookie)).toBe(
      "jwt=left-account",
    );
    expect(await pageB.evaluate(() => document.cookie)).toBe(
      "jwt=right-account",
    );
    await shell
      .getByRole("button", { name: "左ペインを選択", exact: true })
      .click();
    await expect
      .poll(async () => (await command(shell, "state")).activeId)
      .toBe(left.id);
    await expect(
      shell.getByRole("textbox", {
        name: "URLまたは検索キーワード",
        exact: true,
      }),
    ).toHaveValue(`${baseURL}/split-a`);
    await shell.getByRole("button", { name: /DevTools/ }).click();
    await expect
      .poll(() =>
        application.evaluate(({ webContents }) =>
          webContents
            .getAllWebContents()
            .some(
              (c) => c.getURL().endsWith("/split-a") && c.isDevToolsOpened(),
            ),
        ),
      )
      .toBe(true);
    await application.evaluate(({ webContents }) => {
      for (const c of webContents.getAllWebContents())
        if (c.isDevToolsOpened()) c.closeDevTools();
    });
    // Clicking/focusing either native page updates the host toolbar's target.
    await application.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .find((c) => c.getURL().endsWith("/split-b"))
        .focus(),
    );
    await expect
      .poll(async () => (await command(shell, "state")).activeId)
      .toBe(right.id);
    await expect(
      shell.getByRole("textbox", {
        name: "URLまたは検索キーワード",
        exact: true,
      }),
    ).toHaveValue(`${baseURL}/split-b`);
    const png = await application.evaluate(async ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith("/src/index.html"))
        .capturePage()
        .then((image) => image.toDataURL()),
    );
    fs.writeFileSync(
      "test-results/split.png",
      Buffer.from(png.split(",")[1], "base64"),
    );
    // Drop a visible tab on the opposite side to swap the panes.
    await beginTabDrag(shell, right.id);
    await endTabDrag(shell, area.x + area.width * 0.25, area.y + 120);
    expect((await command(shell, "state")).split).toEqual({
      left: right.id,
      right: left.id,
    });
    // Opening a third tab replaces the active pane while retaining the other page.
    await command(shell, "create-tab", {
      sessionId: a.id,
      url: `${baseURL}/split-c`,
    });
    await site(application, "/split-c");
    state = await command(shell, "state");
    expect(state.split.right).toBe(left.id);
    expect(state.split.left).toBe(state.activeId);
    await command(shell, "close-tab", { id: state.activeId });
    state = await command(shell, "state");
    expect(state.split).toBeNull();
    expect(state.activeId).toBe(left.id);
    expect(
      (await nativeViews(application)).views.filter((v) => v.visible),
    ).toHaveLength(1);
    expect(await pageA.evaluate(() => window.keepAliveMarker)).toBe("left");
    // The button is an alternative to drag-and-drop and can leave split mode.
    await shell.getByRole("button", { name: "左右分割", exact: true }).click();
    await expect
      .poll(async () => Boolean((await command(shell, "state")).split))
      .toBe(true);
    await shell
      .getByRole("button", { name: "分割を解除", exact: true })
      .click();
    expect((await command(shell, "state")).split).toBeNull();
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function assertSelection(shell, id) {
  await expect(shell.locator('#tabs [aria-selected="true"]')).toHaveCount(1);
  await expect(shell.locator('#tabs [aria-selected="true"]')).toHaveAttribute(
    "data-tab-id",
    id,
  );
  await expect(shell.locator("#tabs .tab.active")).toHaveAttribute(
    "data-tab-id",
    id,
  );
  const state = await command(shell, "state");
  const selected = state.tabs.find((t) => t.id === id);
  await expect(shell.locator("#address")).toHaveValue(
    selected.url === "about:blank" ? "" : selected.url,
  );
  if (state.split) {
    const side = state.split.left === id ? "左" : "右";
    await expect(
      shell.getByRole("button", { name: `${side}ペインを選択`, exact: true }),
    ).toHaveClass(/selected/);
    await expect(shell.locator(".pane-heading.selected")).toHaveCount(1);
  }
}
async function twoSelectionTabs(application, shell) {
  const state = await command(shell, "state");
  const [a, b] = state.sessions;
  await command(shell, "navigate", { url: `${baseURL}/select-a` });
  const pageA = await site(application, "/select-a");
  await command(shell, "create-tab", {
    sessionId: b.id,
    url: `${baseURL}/select-b`,
  });
  const pageB = await site(application, "/select-b");
  const next = await command(shell, "state");
  return { left: next.tabs[0], right: next.tabs[1], pageA, pageB };
}

test("selection stays current during and after a cancelled drag candidate", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-selection-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    const { left, right, pageB } = await twoSelectionTabs(application, shell);
    await command(shell, "split-tab", { id: right.id, side: "right" });
    await command(shell, "select-tab", { id: left.id });
    await assertSelection(shell, left.id);
    const box = await shell.locator(`[data-tab-id="${left.id}"]`).boundingBox();
    await shell.mouse.move(box.x + 30, box.y + 15);
    await shell.mouse.down();
    // Native focus/title can change while a tab press is still below the drag threshold.
    await command(shell, "select-tab", { id: right.id });
    await pageB.evaluate(() => {
      document.title = "Title changed during tab press";
    });
    await expect
      .poll(async () => (await command(shell, "state")).tabs[1].title)
      .toBe("Title changed during tab press");
    await expect(shell.locator("#address")).toHaveValue(right.url);
    await expect(shell.locator("#tabs .tab.active")).toHaveAttribute(
      "data-tab-id",
      right.id,
    );
    await shell.evaluate(() =>
      window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 })),
    );
    await assertSelection(shell, right.id);
    await shell.mouse.move(250, 130);
    await shell.mouse.up();
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a fresh tab click immediately after dragging is accepted and tab nodes survive page updates", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-click-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    const { left, right, pageB } = await twoSelectionTabs(application, shell);
    const target = await shell
      .locator(`[data-tab-id="${right.id}"]`)
      .boundingBox();
    await beginTabDrag(shell, left.id);
    await endTabDrag(
      shell,
      target.x + target.width - 5,
      target.y + target.height / 2,
    );
    await shell.locator(`[data-tab-id="${left.id}"]`).click();
    await assertSelection(shell, left.id);
    await shell.evaluate((id) => {
      window.savedTabNode = document.querySelector(`[data-tab-id="${id}"]`);
    }, left.id);
    await pageB.evaluate(() => {
      document.title = "Background title update";
    });
    await expect
      .poll(
        async () =>
          (await command(shell, "state")).tabs.find((t) => t.id === right.id)
            .title,
      )
      .toBe("Background title update");
    expect(
      await shell.evaluate(
        (id) =>
          window.savedTabNode ===
          document.querySelector(`[data-tab-id="${id}"]`),
        left.id,
      ),
    ).toBe(true);
    await assertSelection(shell, left.id);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("an older IPC snapshot cannot roll back tab, pane or address selection", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-state-order-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    const { left, right } = await twoSelectionTabs(application, shell);
    await command(shell, "split-tab", { id: right.id, side: "right" });
    const old = await command(shell, "select-tab", { id: left.id });
    await command(shell, "select-tab", { id: right.id });
    await assertSelection(shell, right.id);
    // Simulate a delayed invoke response arriving after a newer focus notification.
    const after = await shell.evaluate((old) => {
      render(old);
      return {
        active: document.querySelector("#tabs .tab.active")?.dataset.tabId,
        address: document.querySelector("#address").value,
      };
    }, old);
    expect(after.active).toBe(right.id);
    expect(after.address).toBe(right.url);
    await assertSelection(shell, right.id);
    await shell
      .locator("#tabs")
      .screenshot({ path: "test-results/selection-tabs.png" });
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function captureContextMenus(application) {
  await application.evaluate(({ Menu }) => {
    const popup = Menu.prototype.popup;
    Menu.prototype.popup = function (options) {
      global.__actionMenu = this;
      return popup.call(this, options);
    };
  });
}
async function contextClick(application, page, locator, id) {
  await locator.click({ button: "right" });
  await expect
    .poll(() =>
      application.evaluate(
        (_electron, id) => Boolean(global.__actionMenu?.getMenuItemById(id)),
        id,
      ),
    )
    .toBe(true);
  await application.evaluate((_electron, id) => {
    const menu = global.__actionMenu;
    menu.closePopup();
    menu.getMenuItemById(id).click();
  }, id);
}

test("image and link saving uses the originating session and preserves HTTP, Blob and Data bytes", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-images-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    let state = await command(shell, "state");
    const [a, b] = state.sessions;
    await command(shell, "navigate", { url: `${baseURL}/prepare-image` });
    const prep = await site(application, "/prepare-image");
    await prep.evaluate(() => {
      document.cookie = "jwt=image-user; Path=/";
    });
    await command(shell, "navigate", { url: `${baseURL}/rich-menu` });
    const page = await site(application, "/rich-menu");
    await expect(
      page.getByRole("img", { name: "Private image" }),
    ).toBeVisible();
    expect(
      await page
        .getByRole("img", { name: "Private image" })
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    ).toBe(true);
    state = await command(shell, "state");
    const original = state.tabs[0];
    await command(shell, "create-tab", {
      sessionId: b.id,
      url: `${baseURL}/other-download-session`,
    });
    const other = await site(application, "/other-download-session");
    await other.evaluate(() => {
      document.cookie = "jwt=wrong-session; Path=/";
    });
    state = await command(shell, "state");
    await command(shell, "split-tab", { id: state.activeId, side: "right" });
    await captureContextMenus(application);
    await application.evaluate(({ webContents }, directory) => {
      const contents = webContents
        .getAllWebContents()
        .find((c) => c.getURL().endsWith("/rich-menu"));
      global.__savedDownloads = [];
      let count = 0;
      contents.session.on("will-download", (_event, item) => {
        const file = `${directory}/download-${++count}.bin`;
        item.setSavePath(file);
        item.once("done", (_event, state) =>
          global.__savedDownloads.push({
            file,
            state,
            url: item.getURL(),
            mime: item.getMimeType(),
          }),
        );
      });
    }, directory);
    await contextClick(
      application,
      page,
      page.getByRole("img", { name: "Private image" }),
      "save-image",
    );
    await expect
      .poll(() => application.evaluate(() => global.__savedDownloads.length))
      .toBe(1);
    let saved = await application.evaluate(() => global.__savedDownloads[0]);
    expect(saved.state).toBe("completed");
    expect(fs.readFileSync(saved.file)).toEqual(testPNG);
    expect(imageCookies.at(-1)).toContain("jwt=image-user");
    await contextClick(
      application,
      page,
      page.getByRole("link", { name: "Save this link" }),
      "save-link",
    );
    await expect
      .poll(() => application.evaluate(() => global.__savedDownloads.length))
      .toBe(2);
    saved = await application.evaluate(() => global.__savedDownloads[1]);
    expect(fs.readFileSync(saved.file)).toEqual(testPNG);
    // Save inline resources without using a different session or clipboard.
    await page.evaluate(async (data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      for (const [name, src] of [
        ["Data image", `data:image/png;base64,${data}`],
        [
          "Blob image",
          URL.createObjectURL(new Blob([bytes], { type: "image/png" })),
        ],
      ]) {
        const image = document.createElement("img");
        image.alt = name;
        image.src = src;
        image.width = 80;
        image.height = 80;
        document.body.append(image);
        await image.decode();
      }
    }, testPNG.toString("base64"));
    for (const [index, name] of ["Data image", "Blob image"].entries()) {
      await contextClick(
        application,
        page,
        page.getByRole("img", { name }),
        "save-image",
      );
      await expect
        .poll(() => application.evaluate(() => global.__savedDownloads.length))
        .toBe(index + 3);
      saved = await application.evaluate(
        (_electron, index) => global.__savedDownloads[index + 2],
        index,
      );
      expect(saved.state).toBe("completed");
      expect(fs.readFileSync(saved.file)).toEqual(testPNG);
    }
    await contextClick(
      application,
      page,
      page.getByRole("img", { name: "Private image" }),
      "open-image",
    );
    const opened = await site(application, "/protected-image.png");
    expect(await opened.evaluate(() => document.cookie)).toContain(
      "jwt=image-user",
    );
    state = await command(shell, "state");
    expect(state.tabs.at(-1).sessionId).toBe(original.sessionId);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("page find navigates matches, saves a single web archive and requests non-silent printing", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-page-actions-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    await command(shell, "navigate", { url: `${baseURL}/prepare-page` });
    const prep = await site(application, "/prepare-page");
    await prep.evaluate(() => {
      document.cookie = "jwt=image-user; Path=/";
    });
    await command(shell, "navigate", { url: `${baseURL}/rich-menu` });
    const page = await site(application, "/rich-menu");
    await captureContextMenus(application);
    await contextClick(
      application,
      page,
      page.getByRole("heading", { name: "Image browser" }),
      "find-page",
    );
    await expect
      .poll(() =>
        application.windows().some((p) => p.url().endsWith("/src/find.html")),
      )
      .toBe(true);
    let find = application
      .windows()
      .find((p) => p.url().endsWith("/src/find.html"));
    await find
      .getByRole("textbox", { name: "ページ内検索", exact: true })
      .fill("Needle");
    await expect(find.locator("#matches")).toHaveText("1 / 3 件");
    await find.getByRole("button", { name: "次の一致" }).click();
    await expect(find.locator("#matches")).toHaveText("2 / 3 件");
    await find.getByRole("button", { name: "前の一致" }).click();
    await expect(find.locator("#matches")).toHaveText("1 / 3 件");
    expect(await find.evaluate(() => typeof window.browserAPI)).toBe(
      "undefined",
    );
    await find.screenshot({ path: "test-results/find.png" });
    await find.keyboard.press("Escape").catch((error) => {
      if (!find.isClosed()) throw error;
    });
    await expect
      .poll(() =>
        application.windows().some((p) => p.url().endsWith("/src/find.html")),
      )
      .toBe(false);
    await application.evaluate(({ dialog, webContents }, directory) => {
      global.__saveOptions = null;
      dialog.showSaveDialog = async (_owner, options) => {
        global.__saveOptions = options;
        return { canceled: false, filePath: `${directory}/page.mhtml` };
      };
      const contents = webContents
        .getAllWebContents()
        .find((c) => c.getURL().endsWith("/rich-menu"));
      const save = contents.savePage.bind(contents);
      contents.savePage = async (...args) => {
        await save(...args);
        global.__pageSaveCompleted = true;
      };
      contents.print = (options, callback) => {
        global.__printOptions = options;
        callback(false, "cancelled");
      };
    }, directory);
    await contextClick(
      application,
      page,
      page.getByRole("heading", { name: "Image browser" }),
      "save-page",
    );
    await expect
      .poll(() => fs.existsSync(path.join(directory, "page.mhtml")))
      .toBe(true);
    await expect
      .poll(() => application.evaluate(() => global.__pageSaveCompleted))
      .toBe(true);
    fs.copyFileSync(
      path.join(directory, "page.mhtml"),
      "test-results/page.mhtml",
    );
    // Reopen the completed archive. Chromium disables page scripts in MHTML.
    const viewerID = await application.evaluate(
      async ({ BrowserWindow }, file) => {
        const viewer = new BrowserWindow({
          show: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        });
        await viewer.loadFile(file);
        return viewer.id;
      },
      path.join(directory, "page.mhtml"),
    );
    const archived = application
      .windows()
      .find((p) => p.url().endsWith("/page.mhtml"));
    await expect(
      archived.getByRole("heading", { name: "Image browser" }),
    ).toBeVisible();
    await application.evaluate(
      ({ BrowserWindow }, id) => BrowserWindow.fromId(id).destroy(),
      viewerID,
    );
    expect(
      await application.evaluate(
        () => global.__saveOptions.filters[0].extensions,
      ),
    ).toEqual(["mhtml"]);
    await contextClick(
      application,
      page,
      page.getByRole("heading", { name: "Image browser" }),
      "print-page",
    );
    expect(await application.evaluate(() => global.__printOptions)).toEqual({
      silent: false,
      printBackground: true,
    });
    // Cmd-F uses the same safe search UI.
    await application.evaluate(({ webContents }) => {
      const contents = webContents
        .getAllWebContents()
        .find((c) => c.getURL().endsWith("/rich-menu"));
      contents.focus();
      contents.sendInputEvent({
        type: "keyDown",
        keyCode: "F",
        modifiers: ["meta"],
      });
      contents.sendInputEvent({
        type: "keyUp",
        keyCode: "F",
        modifiers: ["meta"],
      });
    });
    await expect
      .poll(() =>
        application.windows().some((p) => p.url().endsWith("/src/find.html")),
      )
      .toBe(true);
    find = application
      .windows()
      .find((p) => p.url().endsWith("/src/find.html"));
    await find
      .getByRole("textbox", { name: "ページ内検索", exact: true })
      .fill("Not present");
    await expect(find.locator("#matches")).toHaveText("0 / 0 件");
    // Closing a page also tears down its search window.
    await command(shell, "close-tab");
    await expect
      .poll(() =>
        application.windows().some((p) => p.url().endsWith("/src/find.html")),
      )
      .toBe(false);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("PDF export from context and browser menus preserves the originating page and generates complete private files", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-pdf-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    const initial = await command(shell, "state");
    await command(shell, "navigate", { url: `${baseURL}/prepare-pdf` });
    let pageA = await site(application, "/prepare-pdf");
    await pageA.evaluate(() => { document.cookie = "pdf_user=account-a; Path=/"; });
    await command(shell, "navigate", { url: `${baseURL}/pdf-page?a` });
    pageA = await site(application, "/pdf-page?a");
    const aId = (await command(shell, "state")).activeId;
    await command(shell, "create-tab", { sessionId: initial.sessions[1].id, url: `${baseURL}/prepare-pdf-b` });
    let pageB = await site(application, "/prepare-pdf-b");
    await pageB.evaluate(() => { document.cookie = "pdf_user=account-b; Path=/"; });
    await command(shell, "navigate", { url: `${baseURL}/pdf-page?b` });
    pageB = await site(application, "/pdf-page?b");
    const bId = (await command(shell, "state")).activeId;
    await command(shell, "split-tab", { id: bId, side: "right" });
    const hits = pdfRequestCookies.length;
    const fileA = path.join(directory, "account-a.pdf");
    const fileB = path.join(directory, `${"b".repeat(240)}.pdf`);
    await captureContextMenus(application);
    await application.evaluate(({ dialog, webContents }) => {
      global.__pdfDialogEntered = false;
      global.__pdfCalls = [];
      global.__pdfErrors = [];
      dialog.showSaveDialog = async (_owner, options) => {
        global.__pdfDialogOptions = options;
        global.__pdfDialogEntered = true;
        return new Promise(resolve => { global.__pdfResolve = resolve; });
      };
      dialog.showMessageBox = async (_owner, options) => {
        global.__pdfErrors.push(options.detail);
        return { response: 0 };
      };
      for (const contents of webContents.getAllWebContents().filter(c => c.getURL().includes("/pdf-page?"))) {
        const print = contents.printToPDF.bind(contents);
        contents.printToPDF = options => {
          global.__pdfCalls.push({ id: contents.id, url: contents.getURL(), options });
          return print(options);
        };
      }
    });
    await contextClick(application, pageA, pageA.locator("h1"), "save-pdf");
    await expect.poll(() => application.evaluate(() => global.__pdfDialogEntered)).toBe(true);
    await command(shell, "select-tab", { id: bId });
    await application.evaluate((_electron, filePath) => {
      global.__pdfResolve({ canceled: false, filePath });
    }, fileA);
    await expect.poll(() => fs.existsSync(fileA)).toBe(true);
    expect((await command(shell, "state")).activeId).toBe(bId);

    await application.evaluate(({ dialog }, filePath) => {
      global.__actionMenu = null;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, fileB);
    await shell.locator("#browser-menu").click();
    await expect.poll(() => application.evaluate(() => Boolean(global.__actionMenu?.getMenuItemById("history-menu")))).toBe(true);
    await application.evaluate(() => {
      const menu = global.__actionMenu;
      menu.closePopup();
      menu.getMenuItemById("save-pdf").click();
    });
    await expect.poll(() => fs.existsSync(fileB)).toBe(true);
    for (const [file, name] of [[fileA, "pdf-origin-a.pdf"], [fileB, "pdf-origin-b.pdf"]]) {
      const bytes = fs.readFileSync(file);
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      expect(bytes.toString("latin1")).toMatch(/%%EOF\s*$/);
      expect(bytes.length).toBeGreaterThan(1000);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      fs.copyFileSync(file, path.join("test-results", name));
    }
    const calls = await application.evaluate(() => global.__pdfCalls);
    expect(calls.map(c => c.url)).toEqual([`${baseURL}/pdf-page?a`, `${baseURL}/pdf-page?b`]);
    expect(calls[0].options).toEqual({ pageSize: "A4", printBackground: true, preferCSSPageSize: true });
    const options = await application.evaluate(() => global.__pdfDialogOptions);
    expect(path.basename(options.defaultPath)).toBe("PDF _ ACCOUNT_A_確認_.pdf");
    expect(options.filters[0].extensions).toEqual(["pdf"]);
    expect(options.properties).toContain("showOverwriteConfirmation");
    expect(await application.evaluate(() => global.__pdfErrors)).toEqual([]);
    expect(pdfRequestCookies.length).toBe(hits);
    expect((await command(shell, "state")).tabs.some(t => t.id === aId)).toBe(true);
    expect(fs.readdirSync(directory).filter(name => name.endsWith(".tmp"))).toEqual([]);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("PDF cancellation, navigation, closed tabs and failures do not overwrite files or leave partial output", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-pdf-errors-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    await command(shell, "navigate", { url: `${baseURL}/pdf-page?errors` });
    let page = await site(application, "/pdf-page?errors");
    const existing = path.join(directory, "existing.pdf");
    fs.writeFileSync(existing, "original file");
    await captureContextMenus(application);
    await application.evaluate(({ dialog, webContents }, filePath) => {
      global.__pdfErrors = [];
      global.__pdfDialogs = 0;
      global.__pdfPrints = 0;
      dialog.showMessageBox = async (_owner, options) => { global.__pdfErrors.push(options.detail); return { response: 0 }; };
      dialog.showSaveDialog = async () => { global.__pdfDialogs++; return { canceled: true, filePath }; };
      const contents = webContents.getAllWebContents().find(c => c.getURL().endsWith("/pdf-page?errors"));
      const print = contents.printToPDF.bind(contents);
      contents.printToPDF = options => {
        global.__pdfPrints++;
        if (global.__pdfFail) return Promise.reject(new Error("Synthetic PDF failure"));
        return print(options);
      };
    }, existing);
    await contextClick(application, page, page.locator("h1"), "save-pdf");
    await expect.poll(() => application.evaluate(() => global.__pdfDialogs)).toBe(1);
    expect(await application.evaluate(() => global.__pdfPrints)).toBe(0);
    expect(fs.readFileSync(existing, "utf8")).toBe("original file");

    await application.evaluate(({ dialog }) => {
      global.__actionMenu = null;
      dialog.showSaveDialog = () => new Promise(resolve => { global.__pdfResolve = resolve; });
    });
    await contextClick(application, page, page.locator("h1"), "save-pdf");
    await expect.poll(() => application.evaluate(() => typeof global.__pdfResolve)).toBe("function");
    await command(shell, "navigate", { url: `${baseURL}/pdf-page?changed` });
    page = await site(application, "/pdf-page?changed");
    await application.evaluate((_electron, filePath) => global.__pdfResolve({ canceled: false, filePath }), existing);
    await expect.poll(() => application.evaluate(() => global.__pdfErrors.length)).toBe(1);
    expect(await application.evaluate(() => global.__pdfPrints)).toBe(0);
    expect(fs.readFileSync(existing, "utf8")).toBe("original file");

    await application.evaluate(({ dialog }, filePath) => {
      global.__actionMenu = null;
      global.__pdfFail = true;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, existing);
    await contextClick(application, page, page.locator("h1"), "save-pdf");
    await expect.poll(() => application.evaluate(() => global.__pdfErrors.length)).toBe(2);
    expect(fs.readFileSync(existing, "utf8")).toBe("original file");
    await application.evaluate(({ dialog }, filePath) => {
      global.__actionMenu = null;
      global.__pdfFail = false;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, path.join(directory, "missing", "unwritable.pdf"));
    await contextClick(application, page, page.locator("h1"), "save-pdf");
    await expect.poll(() => application.evaluate(() => global.__pdfErrors.length)).toBe(3);
    expect(fs.existsSync(path.join(directory, "missing"))).toBe(false);

    await application.evaluate(({ dialog }) => {
      global.__actionMenu = null;
      global.__pdfResolve = null;
      dialog.showSaveDialog = () => new Promise(resolve => { global.__pdfResolve = resolve; });
    });
    await contextClick(application, page, page.locator("h1"), "save-pdf");
    await expect.poll(() => application.evaluate(() => typeof global.__pdfResolve)).toBe("function");
    const printed = await application.evaluate(() => global.__pdfPrints);
    await command(shell, "close-tab");
    await application.evaluate((_electron, filePath) => global.__pdfResolve({ canceled: false, filePath }), existing);
    expect(await application.evaluate(() => global.__pdfPrints)).toBe(printed);
    expect(fs.readFileSync(existing, "utf8")).toBe("original file");
    expect(fs.readdirSync(directory).filter(name => name.endsWith(".tmp"))).toEqual([]);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("selected-text search stays in session and plain-text paste targets the clicked editable area", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-text-menu-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    await command(shell, "navigate", { url: `${baseURL}/rich-menu` });
    const page = await site(application, "/rich-menu");
    const original = (await command(shell, "state")).tabs[0];
    await application
      .context()
      .route("https://www.google.com/search?**", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<h1>Search fixture</h1>",
        }),
      );
    await captureContextMenus(application);
    await page
      .getByRole("heading", { name: "Image browser" })
      .evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      });
    await contextClick(
      application,
      page,
      page.getByRole("heading", { name: "Image browser" }),
      "search-selection",
    );
    await expect
      .poll(async () => (await command(shell, "state")).tabs.at(-1).url)
      .toContain("https://www.google.com/search?");
    const state = await command(shell, "state");
    expect(new URL(state.tabs.at(-1).url).searchParams.get("q")).toBe(
      "Image browser",
    );
    expect(state.tabs.at(-1).sessionId).toBe(original.sessionId);
    await command(shell, "select-tab", { id: original.id });
    // Intercept this single native edit command to avoid changing the user's clipboard.
    await application.evaluate(({ webContents }) => {
      const c = webContents
        .getAllWebContents()
        .find((c) => c.getURL().endsWith("/rich-menu"));
      c.pasteAndMatchStyle = () => {
        global.__plainPasteTarget = c.getURL();
      };
    });
    await contextClick(
      application,
      page,
      page.getByRole("textbox", { name: "Paste area" }),
      "paste-plain",
    );
    expect(await application.evaluate(() => global.__plainPasteTarget)).toBe(
      `${baseURL}/rich-menu`,
    );
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function apiPage(application) {
  const shell = application
    .windows()
    .find((p) => p.url().endsWith("/src/index.html"));
  const expected = (await command(shell, "state")).tabs
    .filter((t) => t.kind === "api")
    .at(-1).id;
  let matched;
  await expect
    .poll(async () => {
      for (const page of application
        .windows()
        .filter((p) => p.url().endsWith("/src/api.html"))) {
        try {
          const id = await page.evaluate(
            async () => (await window.apiClient.invoke("state")).id,
          );
          if (id === expected) {
            matched = page;
            return true;
          }
        } catch {
          /* A newly-created editor may still be loading its preload. */
        }
      }
      return false;
    })
    .toBe(true);
  await expect(
    matched.getByRole("heading", { name: "APIリクエスト", exact: true }),
  ).toBeVisible();
  return matched;
}
async function apiCommand(page, action, payload = {}) {
  const result = await page.evaluate(
    ([action, payload]) => window.apiClient.invoke(action, payload),
    [action, payload],
  );
  expect(result.error && !result.id ? result.error : undefined).toBeUndefined();
  return result;
}
async function response(page) {
  await expect
    .poll(async () => Boolean((await apiCommand(page, "state")).response))
    .toBe(true);
  const state = await apiCommand(page, "state");
  expect(state.running).toBe(false);
  expect(state.error).toBe("");
  return state.response;
}

test("API tabs use fixed browser sessions for Cookie, no-auth and Bearer requests while switching tabs", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-api-session-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    let state = await command(shell, "state");
    const [a, b] = state.sessions;
    await command(shell, "navigate", { url: `${baseURL}/test-api/login-a` });
    const webA = await site(application, "/test-api/login-a");
    expect(await webA.evaluate(() => document.cookie)).toBe("");
    await command(shell, "create-tab", {
      sessionId: b.id,
      url: `${baseURL}/test-api/login-b`,
    });
    const webB = await site(application, "/test-api/login-b");
    await command(shell, "create-api-tab", { sessionId: a.id });
    const apiA = await apiPage(application);
    expect(await apiA.evaluate(() => typeof window.browserAPI)).toBe(
      "undefined",
    );
    expect(await apiA.evaluate(() => typeof require)).toBe("undefined");
    const apiAID = (await command(shell, "state")).activeId;
    await apiCommand(apiA, "send", {
      draft: { url: `${baseURL}/test-api/delay?ms=250`, auth: "session" },
      sessionId: b.id,
    });
    await command(shell, "select-tab", {
      id: (await command(shell, "state")).tabs.find((t) =>
        t.url.endsWith("/test-api/login-b"),
      ).id,
    });
    const cookiesA = JSON.parse((await response(apiA)).body).cookies;
    expect(cookiesA).toContain("jwt=role-a");
    expect(cookiesA).not.toContain("role-b");
    expect((await command(shell, "state")).activeId).not.toBe(apiAID);
    await command(shell, "create-api-tab", { sessionId: b.id });
    const apiB = await apiPage(application);
    await apiCommand(apiB, "send", {
      draft: { url: `${baseURL}/test-api/echo`, auth: "session" },
    });
    expect(JSON.parse((await response(apiB)).body).cookies).toContain(
      "jwt=role-b",
    );
    await apiCommand(apiA, "send", {
      draft: { url: `${baseURL}/test-api/echo?setCookie=1`, auth: "session" },
    });
    await response(apiA);
    expect(
      (
        await webA.evaluate(
          async () => await (await fetch("/test-api/echo")).json(),
        )
      ).cookies,
    ).toContain("apiUpdated=yes");
    expect(
      (
        await webB.evaluate(
          async () => await (await fetch("/test-api/echo")).json(),
        )
      ).cookies,
    ).not.toContain("apiUpdated=yes");
    await apiCommand(apiB, "send", {
      draft: { url: `${baseURL}/test-api/restricted`, auth: "session" },
    });
    expect((await response(apiB)).status).toBe(403);
    await apiCommand(apiA, "send", {
      draft: { url: `${baseURL}/test-api/echo?setCookie=omit`, auth: "none" },
    });
    let echo = JSON.parse((await response(apiA)).body);
    expect(echo.cookies).toBe("");
    expect(echo.authorization).toBe("");
    expect(
      (
        await webA.evaluate(
          async () => await (await fetch("/test-api/echo")).json(),
        )
      ).cookies,
    ).not.toContain("anonUpdated");
    await apiCommand(apiA, "send", {
      draft: {
        url: `${baseURL}/test-api/echo`,
        auth: "bearer",
        bearer: "runtime-secret",
        method: "POST",
        params: `tag=a\ntag=b\nq=日本語 & test`,
        headers: "X-CSRF-Token: runtime-csrf",
        body: '{"message":"test"}',
      },
    });
    echo = JSON.parse((await response(apiA)).body);
    expect(echo.cookies).toBe("");
    expect(echo.authorization).toBe("Bearer runtime-secret");
    expect(echo.csrf).toBe("runtime-csrf");
    expect(JSON.parse(echo.body)).toEqual({ message: "test" });
    expect(echo.query).toContainEqual(["q", "日本語 & test"]);
    // The request-definition copy does not carry Bearer/CSRF values into another account.
    await apiCommand(apiA, "duplicate", {
      sessionId: b.id,
      draft: {
        name: "Compare",
        url: `${baseURL}/test-api/echo`,
        auth: "bearer",
        bearer: "runtime-secret",
        headers: "X-CSRF-Token: runtime-csrf",
      },
    });
    const copy = await apiPage(application);
    const copied = await apiCommand(copy, "state");
    expect(copied.session.id).toBe(b.id);
    expect(copied.draft.bearer).toBe("");
    expect(copied.draft.headers).toBe("");
    const bad = await apiA.evaluate(() =>
      window.apiClient.invoke("send", { draft: { url: "file:///etc/passwd" } }),
    );
    expect(bad.error).toContain("http");
    const unsupported = await apiA.evaluate(() =>
      window.apiClient.invoke("create-tab"),
    );
    expect(unsupported.error).toBeTruthy();
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("API method changes show the relevant editor and preserve drafts and POST query parameters", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-api-editors-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    await command(shell, "create-api-tab", { sessionId: (await command(shell, "state")).sessions[0].id });
    const page = await apiPage(application);
    const method = page.locator("#method");
    const params = page.locator("#params");
    const body = page.locator("#body");
    await expect(method).toHaveValue("GET");
    await expect(params).toBeVisible();
    await expect(body).toBeHidden();
    await expect(page.locator("[data-panel='body']")).toBeHidden();
    await page.locator("#url").fill(`${baseURL}/test-api/echo`);
    await page.locator("#name").fill("Method editor fixture");
    await params.fill("q=日本語 & test\ntag=kept");

    await method.selectOption("POST");
    await expect(body).toBeVisible();
    await expect(params).toBeHidden();
    await expect(page.locator("[data-panel='body']")).toHaveClass("selected");
    await body.fill("{unfinished JSON");
    await method.selectOption("GET");
    await expect(params).toBeVisible();
    await expect(body).toBeHidden();
    await expect(body).toBeDisabled();
    await expect(params).toHaveValue("q=日本語 & test\ntag=kept");
    await page.locator("#send").click();
    await expect.poll(async () => (await apiCommand(page, "state")).history.length).toBe(1);
    let result = (await apiCommand(page, "state")).response;
    expect(result.method).toBe("GET");
    let echo = JSON.parse(result.body);
    expect(echo.body).toBe("");
    expect(echo.query).toContainEqual(["q", "日本語 & test"]);

    await method.selectOption("POST");
    await expect(body).toBeVisible();
    await expect(body).toHaveValue("{unfinished JSON");
    await body.fill('{"message":"preserved body"}');
    await page.locator("#bodyType").selectOption("text");
    await method.selectOption("GET");
    await expect(body).toBeHidden();
    await method.selectOption("POST");
    await expect(body).toHaveValue('{"message":"preserved body"}');
    await expect(page.locator("#bodyType")).toHaveValue("text");
    await page.locator("#bodyType").selectOption("json");
    await page.locator("[data-panel='params']").click();
    await expect(params).toBeVisible();
    await expect(body).toBeHidden();
    await expect(params).toHaveValue("q=日本語 & test\ntag=kept");
    await page.locator("[data-panel='headers']").click();
    await page.locator("#headers").fill("X-Editor-Test: kept");
    await expect(page.locator("#headers")).toBeVisible();
    await apiCommand(page, "state");
    await expect(page.locator("#headers")).toBeVisible();
    await page.locator("#send").click();
    await expect.poll(async () => (await apiCommand(page, "state")).history.length).toBe(2);
    result = (await apiCommand(page, "state")).response;
    expect(result.method).toBe("POST");
    echo = JSON.parse(result.body);
    expect(JSON.parse(echo.body)).toEqual({ message: "preserved body" });
    expect(echo.query).toContainEqual(["q", "日本語 & test"]);
    await page.locator("#save").click();
    await expect.poll(async () => (await apiCommand(page, "state")).saved.length).toBe(1);
    const saved = (await apiCommand(page, "state")).saved[0];
    await method.selectOption("HEAD");
    await expect(params).toBeVisible();
    await expect(body).toBeHidden();
    await page.locator("#saved").selectOption(saved.id);
    await page.locator("#load-saved").click();
    await expect(method).toHaveValue("POST");
    await expect(body).toBeVisible();
    await expect(body).toHaveValue('{"message":"preserved body"}');
    await expect(params).toHaveValue("q=日本語 & test\ntag=kept");
    expect((await apiCommand(page, "state")).history.length).toBe(2);
    await page.screenshot({ path: "test-results/api-method-editors.png" });
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("API UI sends JSON, saves requests without credentials and restores API worksets after restart", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-api-save-"));
  let application;
  try {
    let launched = await launch(directory);
    application = launched.application;
    let shell = launched.shell;
    await shell.getByRole("button", { name: "＋ API", exact: true }).click();
    await shell
      .getByRole("button", { name: "タブを開く", exact: true })
      .click();
    let api = await apiPage(application);
    await api
      .getByRole("textbox", { name: "リクエスト名", exact: true })
      .fill("Create message");
    await api
      .getByRole("combobox", { name: "HTTPメソッド" })
      .selectOption("POST");
    await api
      .getByRole("textbox", { name: "APIのURL", exact: true })
      .fill(`${baseURL}/test-api/echo`);
    await api.getByRole("button", { name: "本文", exact: true }).click();
    await api
      .getByRole("textbox", { name: "リクエスト本文", exact: true })
      .fill('{"message":"saved body"}');
    await api.getByRole("button", { name: "認証", exact: true }).click();
    await api
      .getByRole("combobox", { name: "認証方法" })
      .selectOption("bearer");
    await api
      .getByRole("textbox", { name: "Bearerトークン", exact: true })
      .fill("not-on-disk");
    await api.getByRole("button", { name: "送信 ↗", exact: true }).click();
    const result = await response(api);
    expect(result.status).toBe(200);
    expect(result.headers["x-reply"]).toBe("fixture");
    await expect(api.locator("#response")).toContainText("saved body");
    await api.getByRole("button", { name: "保存", exact: true }).click();
    await expect
      .poll(
        () =>
          JSON.parse(
            fs.readFileSync(path.join(directory, "workspace.json"), "utf8"),
          ).apiRequests.length,
      )
      .toBe(1);
    const savedID = JSON.parse(
      fs.readFileSync(path.join(directory, "workspace.json"), "utf8"),
    ).apiRequests[0].id;
    // Saving again updates the same named request, and opening templates never sends.
    await api.getByRole("button", { name: "本文", exact: true }).click();
    const bodyField = api.getByRole("textbox", {
      name: "リクエスト本文",
      exact: true,
    });
    await bodyField.fill('{"message":"updated body"}');
    await api.locator("#save").click();
    await expect
      .poll(
        () =>
          JSON.parse(
            fs.readFileSync(path.join(directory, "workspace.json"), "utf8"),
          ).apiRequests[0].request.body,
      )
      .toContain("updated body");
    expect(
      JSON.parse(
        fs.readFileSync(path.join(directory, "workspace.json"), "utf8"),
      ).apiRequests,
    ).toHaveLength(1);
    await bodyField.fill('{"message":"unsaved"}');
    await api.locator("#saved").selectOption(savedID);
    await api.locator("#load-saved").click();
    await expect(bodyField).toHaveValue('{"message":"updated body"}');
    const historyID = (await apiCommand(api, "state")).history[0].id;
    await api.locator("#history").selectOption(historyID);
    await api.locator("#load-history").click();
    await expect(bodyField).toHaveValue('{"message":"saved body"}');
    expect((await apiCommand(api, "state")).history).toHaveLength(1);
    expect((await apiCommand(api, "state")).draft.bearer).toBe("");
    await api.locator("#load-saved").click();
    await expect(bodyField).toHaveValue('{"message":"updated body"}');
    await command(shell, "save-workset", { name: "Web and API" });
    const serialized = fs.readFileSync(
      path.join(directory, "workspace.json"),
      "utf8",
    );
    expect(serialized).not.toContain("not-on-disk");
    const config = JSON.parse(serialized);
    expect(config.worksets[0].tabs[1].kind).toBe("api");
    expect(config.worksets[0].tabs[1].request.body).toContain("updated body");
    await application.close();
    application = null;
    launched = await launch(directory);
    application = launched.application;
    shell = launched.shell;
    await command(shell, "restore-workset", { id: config.worksets[0].id });
    api = await apiPage(application);
    const state = await apiCommand(api, "state");
    expect(state.saved[0].name).toBe("Create message");
    expect(state.draft.body).toContain("updated body");
    expect(state.draft.bearer).toBe("");
    expect(state.response).toBeNull();
    await expect(
      api.getByRole("textbox", { name: "リクエスト名", exact: true }),
    ).toHaveValue("Create message");
    // Restoring a request never sends it automatically.
    expect(state.history).toEqual([]);
    expect(state.running).toBe(false);
    const main = await command(shell, "state");
    const apiID = main.tabs.find((t) => t.kind === "api").id;
    await command(shell, "split-tab", { id: apiID, side: "right" });
    const native = await nativeViews(application);
    expect(native.views.filter((v) => v.visible)).toHaveLength(1); // Web side is still a blank tab.
    await command(shell, "create-tab", {
      sessionId: main.sessions[0].id,
      url: `${baseURL}/browser-with-api`,
    });
    await site(application, "/browser-with-api");
    await command(shell, "end-split");
    const browserID = (await command(shell, "state")).tabs.find((t) =>
      t.url.endsWith("/browser-with-api"),
    ).id;
    await command(shell, "select-tab", { id: browserID });
    await command(shell, "split-tab", { id: apiID, side: "right" });
    expect(
      (await nativeViews(application)).views.filter((v) => v.visible),
    ).toHaveLength(2);
    await api.screenshot({ path: "test-results/api-client.png" });
    await command(shell, "delete-session", { id: state.session.id });
    const after = JSON.parse(
      fs.readFileSync(path.join(directory, "workspace.json"), "utf8"),
    );
    expect(after.apiRequests).toEqual([]);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("API cancellation, timeout, redirects, response caps and HTML responses stay confined to their tab", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-api-control-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    const profile = (await command(shell, "state")).sessions[0];
    await command(shell, "create-api-tab", { sessionId: profile.id });
    const api = await apiPage(application);
    await apiCommand(api, "send", {
      draft: { url: `${baseURL}/test-api/delay?ms=3000` },
    });
    await apiCommand(api, "cancel");
    await expect
      .poll(async () => (await apiCommand(api, "state")).error)
      .toContain("キャンセル");
    await apiCommand(api, "send", {
      draft: { url: `${baseURL}/test-api/delay?ms=3000`, timeoutMs: 1000 },
    });
    await expect
      .poll(async () => (await apiCommand(api, "state")).error)
      .toContain("タイムアウト");
    const hits = redirectHits;
    await apiCommand(api, "send", {
      draft: { url: `${baseURL}/test-api/redirect` },
    });
    let result = await response(api);
    expect(result.status).toBe(302);
    expect(redirectHits).toBe(hits);
    await apiCommand(api, "send", {
      draft: { url: `${baseURL}/test-api/html` },
    });
    result = await response(api);
    expect(result.body).toContain("<script>");
    expect(await api.evaluate(() => window.evilExecuted)).toBeUndefined();
    expect(await api.locator("#response script").count()).toBe(0);
    await apiCommand(api, "send", {
      draft: { url: `${baseURL}/test-api/large` },
    });
    result = await response(api);
    expect(result.truncated).toBe(true);
    expect(result.bytes).toBe(5 * 1024 * 1024);
    await apiCommand(api, "send", {
      draft: { url: `${baseURL}/test-api/delay?ms=3000` },
    });
    await command(shell, "close-tab");
    await expect
      .poll(() =>
        application.windows().some((p) => p.url().endsWith("/src/api.html")),
      )
      .toBe(false);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function cliPage(application) {
  const shell = application
    .windows()
    .find((p) => p.url().endsWith("/src/index.html"));
  const id = (await command(shell, "state")).tabs
    .filter((t) => t.kind === "terminal")
    .at(-1).id;
  let matched;
  await expect
    .poll(async () => {
      for (const page of application
        .windows()
        .filter((p) => p.url().endsWith("/src/terminal.html"))) {
        try {
          if (
            (await page.evaluate(() => terminalAPI.invoke("state"))).id === id
          ) {
            matched = page;
            return true;
          }
        } catch {}
      }
      return false;
    })
    .toBe(true);
  await matched.waitForFunction(
    () => typeof term !== "undefined" && initialized,
  );
  return matched;
}
async function terminalText(page) {
  return page.evaluate(() => {
    const buffer = term.buffer.active;
    return Array.from(
      { length: buffer.length },
      (_, i) => buffer.getLine(i)?.translateToString(true) || "",
    ).join("\n");
  });
}
async function typeCLI(page, value) {
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
}
test("CLI tabs run an interactive PTY, resize, split, restore without executing and stop child processes", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-cli-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    await shell.getByRole("button", { name: "＋ CLI", exact: true }).click();
    await shell
      .getByRole("button", { name: "タブを開く", exact: true })
      .click();
    let cli = await cliPage(application);
    await expect
      .poll(
        async () =>
          (await cli.evaluate(() => terminalAPI.invoke("state"))).phase,
      )
      .toBe("running");
    expect(
      await cli.evaluate(() => [
        typeof require,
        typeof browserAPI,
        typeof apiClient,
      ]),
    ).toEqual(["undefined", "undefined", "undefined"]);
    await expect.poll(() => terminalText(cli)).toMatch(/%\s/);
    const sampled = await command(shell, "sample-memory");
    expect(sampled.memory.cliProcesses).toBeGreaterThan(0);
    await typeCLI(cli, 'printf "PTY_RESULT_%s\\n" "$((6*7))"');
    await expect.poll(() => terminalText(cli)).toContain("PTY_RESULT_42");
    await typeCLI(cli, 'printf "TTY_RESULT_%s\\n" "$(test -t 0 && echo yes)"');
    await expect.poll(() => terminalText(cli)).toContain("TTY_RESULT_yes");
    const shellPID = (await cli.evaluate(() => terminalAPI.invoke("state")))
      .pid;
    await typeCLI(cli, "sleep 30");
    const childPIDs = () =>
      require("node:child_process")
        .execFileSync("/bin/ps", ["-axo", "pid=,ppid="], { encoding: "utf8" })
        .trim()
        .split("\n")
        .map((line) => line.trim().split(/\s+/).map(Number))
        .filter(([, ppid]) => ppid === shellPID)
        .map(([pid]) => pid);
    await expect.poll(() => childPIDs().length).toBeGreaterThan(0);
    await cli.keyboard.press("Control+c");
    await expect.poll(() => childPIDs().length).toBe(0);
    await typeCLI(cli, 'printf "INTERRUPTED_%s\\n" ok');
    await expect.poll(() => terminalText(cli)).toContain("INTERRUPTED_ok");
    const state = await command(shell, "state");
    const cliID = state.tabs.find((t) => t.kind === "terminal").id;
    await command(shell, "create-tab", {
      sessionId: state.sessions[0].id,
      url: `${baseURL}/cli-split`,
    });
    await site(application, "/cli-split");
    await command(shell, "split-tab", { id: cliID, side: "right" });
    expect(
      (await nativeViews(application)).views.filter((v) => v.visible),
    ).toHaveLength(2);
    await expect.poll(() => cli.evaluate(() => term.cols)).toBeLessThan(100);
    const cols = await cli.evaluate(() => term.cols);
    await typeCLI(
      cli,
      'printf "COLS_RESULT_%s\\n" "$(stty size | awk \'{print $2}\')"',
    );
    await expect.poll(() => terminalText(cli)).toContain(`COLS_RESULT_${cols}`);
    await shell.getByRole("button", { name: /構成を保存/ }).click();
    await shell
      .getByLabel("作業セット名", { exact: true })
      .fill("CLI workspace");
    await shell
      .getByRole("button", { name: "作業セットを保存", exact: true })
      .click();
    let config = JSON.parse(
      fs.readFileSync(path.join(directory, "workspace.json"), "utf8"),
    );
    const id = config.worksets[0].id;
    expect(config.worksets[0].tabs.some((t) => t.kind === "terminal")).toBe(
      true,
    );
    expect(
      fs.readFileSync(path.join(directory, "workspace.json"), "utf8"),
    ).not.toContain("PTY_RESULT");
    await shell.getByRole("button", { name: /構成を保存/ }).click();
    await shell.getByLabel("保存方法").selectOption("overwrite");
    await shell.getByLabel("上書きする構成").selectOption(id);
    await shell
      .getByLabel("作業セット名", { exact: true })
      .fill("CLI workspace updated");
    await shell
      .getByRole("button", { name: "作業セットを保存", exact: true })
      .click();
    config = JSON.parse(
      fs.readFileSync(path.join(directory, "workspace.json"), "utf8"),
    );
    expect(config.worksets).toHaveLength(1);
    expect(config.worksets[0].id).toBe(id);
    expect(config.worksets[0].name).toBe("CLI workspace updated");
    await command(shell, "restore-workset", { id });
    cli = await cliPage(application);
    expect((await cli.evaluate(() => terminalAPI.invoke("state"))).phase).toBe(
      "idle",
    );
    await expect(
      cli.getByRole("button", { name: "シェルを起動", exact: true }),
    ).toBeVisible();
    await command(shell, "select-tab", {
      id: (await cli.evaluate(() => terminalAPI.invoke("state"))).id,
    });
    await cli
      .getByRole("button", { name: "シェルを起動", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await cli.evaluate(() => terminalAPI.invoke("state"))).phase,
      )
      .toBe("running");
    await expect.poll(() => terminalText(cli)).toMatch(/%\s/);
    await typeCLI(cli, "/bin/sleep 30 & echo CHILD_PID:$!");
    await expect.poll(() => terminalText(cli)).toMatch(/CHILD_PID:\d+/);
    const childPID = Number(
      (await terminalText(cli)).match(/CHILD_PID:(\d+)/)[1],
    );
    const live = await cli.evaluate(() => terminalAPI.invoke("state"));
    await cli.screenshot({ path: "test-results/terminal.png" });
    await command(shell, "close-tab", { id: live.id });
    await expect
      .poll(() => {
        try {
          process.kill(childPID, 0);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("running version, memory totals, warning dismissal and preferences are visible and persist", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-runtime-"));
  let application;
  try {
    let launched = await launch(directory);
    application = launched.application;
    let shell = launched.shell;
    const state = await command(shell, "sample-memory");
    expect(state.appInfo.version).toBe(appVersion);
    expect(state.memory.bytes).toBeGreaterThan(0);
    await expect(shell.locator("#app-info")).toHaveText(`v${appVersion}`);
    await application.evaluate(({ app }) => {
      app.getAppMetrics = () => [
        { pid: process.pid, memory: { workingSetSize: 3 * 1024 * 1024 } },
      ];
    });
    await command(shell, "sample-memory");
    await expect(shell.locator("#memory-warning")).toBeVisible();
    await expect(shell.locator("#memory-usage")).toContainText("3.00 GiB");
    await shell
      .getByRole("button", { name: "今回の警告を閉じる", exact: true })
      .click();
    await command(shell, "sample-memory");
    await expect(shell.locator("#memory-warning")).toBeHidden();
    await application.evaluate(({ app }) => {
      app.getAppMetrics = () => [
        { pid: process.pid, memory: { workingSetSize: 100 * 1024 } },
      ];
    });
    await command(shell, "sample-memory");
    await application.evaluate(({ app }) => {
      app.getAppMetrics = () => [
        { pid: process.pid, memory: { workingSetSize: 3 * 1024 * 1024 } },
      ];
    });
    await command(shell, "sample-memory");
    await expect(shell.locator("#memory-warning")).toBeVisible();
    await shell.locator("#app-info").click();
    await expect(
      shell.getByText(`Multisession Browser v${appVersion}`, { exact: true }),
    ).toBeVisible();
    await shell
      .getByLabel("メモリ警告（MiB、0で無効）", { exact: true })
      .fill("0");
    await shell
      .getByLabel("起動時にアップデートを確認する", { exact: true })
      .uncheck();
    await shell
      .getByRole("button", { name: "設定を保存", exact: true })
      .click();
    await command(shell, "sample-memory");
    await expect(shell.locator("#memory-warning")).toBeHidden();
    await application.close();
    application = null;
    const previousHits = updateHits;
    launched = await launch(directory);
    application = launched.application;
    shell = launched.shell;
    const restored = await command(shell, "state");
    expect(restored.preferences).toEqual({
      memoryWarningMiB: 0,
      checkUpdatesOnStartup: false,
    });
    expect(restored.update.status).toBe("idle");
    expect(updateHits).toBe(previousHits);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("startup and manual updates compare GitHub releases and show failures without blocking browsing", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-update-"));
  let application;
  const url =
    "https://github.com/kirishima677/multisession-browser/releases/tag/v0.8.0";
  releaseFixture = {
    status: 200,
    body: {
      tag_name: "v0.8.0",
      html_url: url,
      draft: false,
      prerelease: false,
    },
  };
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    await expect(shell.locator("#update-notice")).toBeVisible();
    await expect(shell.locator("#app-info")).toHaveText(`v${appVersion}`);
    await application.evaluate(({ shell }) => {
      globalThis.openedRelease = "";
      shell.openExternal = async (url) => {
        globalThis.openedRelease = url;
      };
    });
    await shell.locator("#open-update").click();
    expect(await application.evaluate(() => globalThis.openedRelease)).toBe(
      url,
    );
    await shell.locator("#app-info").click();
    releaseFixture.body.tag_name = `v${appVersion}`;
    await shell
      .getByRole("button", { name: "今すぐ更新を確認", exact: true })
      .click();
    await expect(shell.locator("#update-message")).toContainText(
      "起動中のバージョンは最新",
    );
    releaseFixture = { status: 503, body: {} };
    await shell
      .getByRole("button", { name: "今すぐ更新を確認", exact: true })
      .click();
    await expect(shell.locator("#update-message")).toContainText(
      "更新を確認できませんでした",
    );
    releaseFixture = { status: 404, body: {} };
    await shell
      .getByRole("button", { name: "今すぐ更新を確認", exact: true })
      .click();
    await expect(shell.locator("#update-message")).toContainText(
      "公開済みのリリースがありません",
    );
    await shell
      .getByRole("button", { name: "キャンセル", exact: true })
      .click();
    await command(shell, "navigate", { url: `${baseURL}/update-browsing` });
    await site(application, "/update-browsing");
  } finally {
    releaseFixture = { status: 404, body: {} };
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function toolsPage(application) {
  await expect
    .poll(() =>
      application
        .windows()
        .some((p) => p.url().endsWith("/src/test-tools.html")),
    )
    .toBe(true);
  const page = application
    .windows()
    .find((p) => p.url().endsWith("/src/test-tools.html"));
  await page.waitForFunction(() => Boolean(window.testTools));
  await page.waitForLoadState();
  return page;
}
async function toolCommand(page, action, payload = {}) {
  const result = await page.evaluate(
    ([action, payload]) => testTools.invoke(action, payload),
    [action, payload],
  );
  expect(result.error).toBeUndefined();
  return result;
}
async function interceptClipboard(application) {
  await application.evaluate(({ clipboard }) => {
    globalThis.testClipboard = "";
    clipboard.writeText = (value) => {
      globalThis.testClipboard = value;
    };
  });
}
function cookieDB(directory, id) {
  return fs
    .readdirSync(directory, { recursive: true })
    .map((p) => path.join(directory, p))
    .find((p) => p.includes(id) && path.basename(p) === "Cookies");
}
function storedCookie(file, name) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db
      .prepare(
        "select name, value, length(encrypted_value) as encryptedBytes from cookies where name=?",
      )
      .get(name);
  } finally {
    db.close();
  }
}
test("JWT tools select HttpOnly candidates by contents, copy the current value and encrypt manual tokens across restarts", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-auth-tools-"));
  let application;
  const manualToken = sampleJWT({
    alumni_id: 303,
    company_name: "手入力テナント",
    exp: Math.floor(Date.now() / 1000) - 60,
  });
  try {
    let launched = await launch(directory);
    application = launched.application;
    let shell = launched.shell;
    const initial = await command(shell, "state"),
      a = initial.sessions[0],
      b = initial.sessions[1];
    expect(initial.protection.persistentAllowed).toBe(true);
    await command(shell, "navigate", { url: `${baseURL}/tokens/login` });
    let browser = await site(application, "/tokens/login");
    expect(await browser.evaluate(() => document.cookie)).not.toContain(
      "access_token",
    );
    await shell.locator("#open-auth").click();
    let tools = await toolsPage(application);
    await expect
      .poll(
        async () =>
          (
            await toolCommand(tools, "auth-list", {
              sessionId: a.id,
              url: `${baseURL}/tokens/login`,
            })
          ).candidates.length,
      )
      .toBe(1);
    await expect(tools.locator("#candidate")).toContainText("access_token");
    const candidates = await toolCommand(tools, "auth-list", {
      sessionId: a.id,
      url: `${baseURL}/tokens/login`,
    });
    expect(candidates.candidates[0].info.claims.alumni_id).toBe(101);
    expect(candidates.candidates[0].preview).not.toBe(tokenA);
    await tools
      .locator("#candidate")
      .selectOption(candidates.candidates[0].key);
    await expect(tools.locator("#copy-token")).toBeEnabled();
    await interceptClipboard(application);
    await tools.locator("#copy-token").click();
    expect(await application.evaluate(() => globalThis.testClipboard)).toBe(
      tokenA,
    );
    await browser.evaluate(() => fetch("/tokens/refresh"));
    await tools.locator("#copy-token").click();
    expect(await application.evaluate(() => globalThis.testClipboard)).toBe(
      tokenB,
    );
    await tools.locator("#copy-cookie").click();
    expect(await application.evaluate(() => globalThis.testClipboard)).toBe(
      `access_token=${tokenB}`,
    );
    const other = await toolCommand(tools, "auth-list", {
      sessionId: b.id,
      url: `${baseURL}/tokens/login`,
    });
    expect(other.candidates).toEqual([]);
    await expect
      .poll(async () =>
        (await command(shell, "state")).auth.some((s) =>
          s.summary.includes("202"),
        ),
      )
      .toBe(true);
    await tools.locator("#manual-value").fill(manualToken);
    await tools.locator("#manual-save").check();
    await tools.locator("#manual-apply").click();
    await expect(tools.locator("#candidate-meta")).toContainText(
      "暗号化して保存済み",
    );
    await expect(tools.locator("#candidate-meta")).toContainText("期限切れ");
    await tools.locator("#reveal-token").click();
    await expect(tools.locator("#token-visible")).toHaveValue(manualToken);
    expect(
      fs.readFileSync(path.join(directory, "tokens.enc.json"), "utf8"),
    ).not.toContain(manualToken);
    expect(
      fs.readFileSync(path.join(directory, "workspace.json"), "utf8"),
    ).not.toContain(manualToken);
    expect(
      await tools.evaluate(() => [
        typeof require,
        typeof browserAPI,
        typeof apiClient,
        typeof terminalAPI,
      ]),
    ).toEqual(["undefined", "undefined", "undefined", "undefined"]);
    await tools.screenshot({ path: "test-results/jwt-tools.png" });
    await application.close();
    application = null;
    const db = storedCookie(cookieDB(directory, a.id), "access_token");
    expect(db.value).toBe("");
    expect(db.encryptedBytes).toBeGreaterThan(0);
    launched = await launch(directory);
    application = launched.application;
    shell = launched.shell;
    await command(shell, "open-test-tools", { page: "auth", sessionId: a.id });
    tools = await toolsPage(application);
    await expect(tools.locator("#candidate-meta")).toContainText(
      "暗号化して保存済み",
    );
    await tools.locator("#reveal-token").click();
    await expect(tools.locator("#token-visible")).toHaveValue(manualToken);
    await tools.locator("#manual-save").uncheck();
    await tools.locator("#manual-value").fill("opaque-manual-only");
    await tools.locator("#manual-apply").click();
    await expect(tools.locator("#candidate-meta")).toContainText(
      "この起動中のみ",
    );
    expect(
      fs.readFileSync(path.join(directory, "tokens.enc.json"), "utf8"),
    ).not.toContain("opaque-manual-only");
    const all = await toolCommand(tools, "auth-list", {
      sessionId: a.id,
      url: `${baseURL}/tokens/login`,
      all: true,
    });
    expect(all.candidates.some((c) => c.name === "opaque")).toBe(true);
    await command(shell, "edit-session", {
      id: b.id,
      name: "更新したセッションB",
      color: b.color,
    });
    await expect(tools.locator("#auth-session")).toContainText(
      "更新したセッションB",
    );
    await command(shell, "delete-session", { id: b.id });
    await expect(tools.locator("#auth-session")).not.toContainText(
      "更新したセッションB",
    );
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("response tools search Web and API bodies across tabs without replay, coexist with DevTools and copy selected text", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "msb-response-tools-"),
  );
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    const initial = await command(shell, "state"),
      a = initial.sessions[0],
      b = initial.sessions[1];
    await command(shell, "navigate", { url: `${baseURL}/response-page-a` });
    const pageA = await site(application, "/response-page-a");
    const aID = (await command(shell, "state")).activeId;
    await command(shell, "create-tab", {
      sessionId: b.id,
      url: `${baseURL}/response-page-b`,
    });
    const pageB = await site(application, "/response-page-b");
    await shell.locator("#open-network").click();
    const tools = await toolsPage(application);
    await tools.locator("#recording").click();
    await expect(tools.locator("#recording-state")).toContainText("記録中");
    await pageA.evaluate(() =>
      fetch("/response-data?text=横断検索_利用者A").then((r) => r.json()),
    );
    await pageB.evaluate(() =>
      fetch("/response-data?text=横断検索_利用者B").then((r) => r.json()),
    );
    await expect
      .poll(
        async () =>
          (await toolCommand(tools, "search", { query: "横断検索_利用者" }))
            .total,
      )
      .toBe(2);
    const found = await toolCommand(tools, "search", {
      query: "横断検索_利用者",
    });
    expect(new Set(found.results.map((r) => r.sessionId)).size).toBe(2);
    await command(shell, "select-tab", { id: aID });
    await command(shell, "devtools");
    await expect
      .poll(() =>
        application.evaluate(({ webContents }) =>
          webContents
            .getAllWebContents()
            .some(
              (c) =>
                c.getURL().includes("/response-page-a") && c.isDevToolsOpened(),
            ),
        ),
      )
      .toBe(true);
    await pageA.evaluate(() =>
      fetch("/response-data?text=DevTools併用検索").then((r) => r.json()),
    );
    await expect
      .poll(
        async () =>
          (await toolCommand(tools, "search", { query: "DevTools併用検索" }))
            .total,
      )
      .toBe(1);
    expect(
      await application.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .some(
            (c) =>
              c.getURL().includes("/response-page-a") && c.isDevToolsOpened(),
          ),
      ),
    ).toBe(true);
    await command(shell, "create-api-tab", {
      sessionId: a.id,
      request: { url: `${baseURL}/response-data?text=APIタブの検索結果` },
    });
    const api = await apiPage(application);
    await apiCommand(api, "send", {
      draft: { url: `${baseURL}/response-data?text=APIタブの検索結果` },
    });
    await response(api);
    await expect
      .poll(
        async () =>
          (await toolCommand(tools, "search", { query: "APIタブの検索結果" }))
            .total,
      )
      .toBe(1);
    const hitCount = responseHits;
    await tools.locator("#query").fill("横断検索_利用者A");
    await tools.getByRole("button", { name: "検索", exact: true }).click();
    await expect(tools.locator(".result")).toHaveCount(1);
    await tools.locator(".result").click();
    await expect(tools.locator("#response-body")).toHaveValue(/"id": 12345/);
    const body = tools.locator("#response-body");
    await body.evaluate((el) => {
      const start = el.value.indexOf("12345");
      el.setSelectionRange(start, start + 5);
    });
    await interceptClipboard(application);
    await tools.locator("#copy-selected").click();
    expect(await application.evaluate(() => globalThis.testClipboard)).toBe(
      "12345",
    );
    expect(await tools.evaluate(() => window.responseExecuted)).toBeUndefined();
    await tools.locator("#activate-source").click();
    expect((await command(shell, "state")).activeId).toBe(aID);
    expect(responseHits).toBe(hitCount);
    await tools.screenshot({ path: "test-results/response-search.png" });
    await tools.locator("#recording").click();
    await expect(tools.locator("#recording-state")).toContainText("停止中");
    await pageA.evaluate(() =>
      fetch("/response-data?text=停止後は未記録").then((r) => r.json()),
    );
    expect(
      (await toolCommand(tools, "search", { query: "停止後は未記録" })).total,
    ).toBe(0);
    await tools.locator("#clear-responses").click();
    expect((await toolCommand(tools, "state")).capture.count).toBe(0);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("existing plaintext Cookie sessions migrate to encrypted storage while retaining logins and site storage", async () => {
  const legacy =
    process.env.MSB_LEGACY_EXECUTABLE ||
    "/Users/nishiokahiroki/code/multisession-browser/dist/v0.5.0/mac-arm64/Multisession Browser.app/Contents/MacOS/Multisession Browser";
  test.skip(
    !fs.existsSync(legacy),
    "Ver 0.5.0 executable is required to create a genuine legacy profile.",
  );
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "msb-cookie-upgrade-"),
  );
  let application;
  try {
    let launched = await launch(directory, { executablePath: legacy });
    application = launched.application;
    let shell = launched.shell;
    const a = (await command(shell, "state")).sessions[0];
    await command(shell, "navigate", { url: `${baseURL}/tokens/login` });
    let browser = await site(application, "/tokens/login");
    await browser.evaluate(() =>
      localStorage.setItem("migration-data", "retain-this"),
    );
    await application.close();
    application = null;
    const file = cookieDB(directory, a.id),
      before = storedCookie(file, "access_token");
    expect(before.value).toBe(tokenA);
    expect(before.encryptedBytes).toBe(0);
    launched = await launch(directory);
    application = launched.application;
    shell = launched.shell;
    const security = (await command(shell, "state")).protection;
    expect(security.cookieEncryption).toBe(true);
    expect(security.persistentAllowed).toBe(true);
    expect(security.migratedCookies).toBeGreaterThan(0);
    await command(shell, "navigate", { url: `${baseURL}/migration-check` });
    browser = await site(application, "/migration-check");
    expect(
      await browser.evaluate(() => localStorage.getItem("migration-data")),
    ).toBe("retain-this");
    expect(
      await browser.evaluate(() =>
        fetch("/test-api/echo")
          .then((r) => r.json())
          .then((r) => r.cookies),
      ),
    ).toContain(`access_token=${tokenA}`);
    await application.close();
    application = null;
    const after = storedCookie(file, "access_token");
    expect(after.value).toBe("");
    expect(after.encryptedBytes).toBeGreaterThan(0);
    launched = await launch(directory);
    application = launched.application;
    shell = launched.shell;
    await command(shell, "navigate", { url: `${baseURL}/migration-restart` });
    browser = await site(application, "/migration-restart");
    expect(
      await browser.evaluate(() =>
        fetch("/test-api/echo")
          .then((r) => r.json())
          .then((r) => r.cookies),
      ),
    ).toContain(`access_token=${tokenA}`);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function libraryPage(application) {
  await expect
    .poll(() =>
      application.windows().some((p) => p.url().endsWith("/src/library.html")),
    )
    .toBe(true);
  const page = application
    .windows()
    .find((p) => p.url().endsWith("/src/library.html"));
  await page.waitForLoadState();
  await page.waitForFunction(() => Boolean(window.libraryAPI));
  return page;
}
async function libraryCommand(page, action, payload = {}) {
  const result = await page.evaluate(
    ([action, payload]) => libraryAPI.invoke(action, payload),
    [action, payload],
  );
  expect(result.error).toBeUndefined();
  return result;
}
test("browser overflow menu and bookmarks work over page views, preserve sessions and survive encrypted restart", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "msb-bookmarks-e2e-"),
  );
  let application;
  try {
    let launched = await launch(directory);
    application = launched.application;
    let shell = launched.shell;
    const initial = await command(shell, "state"),
      a = initial.sessions[0],
      b = initial.sessions[1];
    await command(shell, "navigate", { url: `${baseURL}/library-a` });
    const pageA = await site(application, "/library-a");
    await pageA.evaluate(() => {
      document.cookie = "library_role=account-a; Path=/";
    });
    await application.evaluate(({ Menu }) => {
      const popup = Menu.prototype.popup;
      Menu.prototype.popup = function (options) {
        globalThis.browserPopup = this;
        globalThis.popupShown = false;
        this.once("menu-will-show", () => {
          globalThis.popupShown = true;
        });
        return popup.call(this, options);
      };
    });
    await shell
      .getByRole("button", { name: "ブラウザメニュー", exact: true })
      .click();
    await expect
      .poll(() => application.evaluate(() => globalThis.popupShown))
      .toBe(true);
    const menu = await application.evaluate(() => {
      const menu = globalThis.browserPopup;
      const result = [
        "history-menu",
        "bookmarks-menu",
        "page-zoom",
        "find-page",
        "save-page",
        "print-page",
        "app-settings",
      ].every((id) => Boolean(menu.getMenuItemById(id)));
      menu.closePopup();
      menu.getMenuItemById("zoom-in").click();
      return result;
    });
    expect(menu).toBe(true);
    expect(
      (await nativeViews(application)).views.filter((v) => v.visible),
    ).toHaveLength(1);
    await expect
      .poll(() =>
        application.evaluate(({ webContents }) =>
          webContents
            .getAllWebContents()
            .find((c) => c.getURL().endsWith("/library-a"))
            .getZoomFactor(),
        ),
      )
      .toBeGreaterThan(1);
    await command(shell, "zoom", { direction: "reset" });
    await shell.locator("#bookmark-page").click();
    await expect(shell.locator("#modal-title")).toHaveText(
      "ブックマークを追加",
    );
    await shell
      .getByLabel("ブックマーク名", { exact: true })
      .fill("Bookmark account A");
    await shell.locator("#modal-submit").click();
    await expect(shell.locator("#bookmark-page")).toHaveText("★");
    await command(shell, "create-tab", {
      sessionId: b.id,
      url: `${baseURL}/library-b`,
    });
    const pageB = await site(application, "/library-b");
    await pageB.evaluate(() => {
      document.cookie = "library_role=account-b; Path=/";
    });
    await command(shell, "open-library", { page: "bookmarks" });
    let library = await libraryPage(application);
    await expect(library.locator(".item-title")).toHaveText(
      "Bookmark account A",
    );
    expect(
      await library.evaluate(() => [
        typeof browserAPI,
        typeof require,
        typeof testTools,
        typeof terminalAPI,
      ]),
    ).toEqual(["undefined", "undefined", "undefined", "undefined"]);
    await library
      .locator(".item")
      .getByRole("button", { name: "開く", exact: true })
      .click();
    await expect
      .poll(async () => {
        const state = await command(shell, "state");
        return state.tabs.find((t) => t.id === state.activeId)?.sessionId;
      })
      .toBe(a.id);
    await expect
      .poll(
        () =>
          application
            .windows()
            .filter((p) => p.url() === `${baseURL}/library-a`).length,
      )
      .toBe(2);
    const reopened = application
      .windows()
      .filter((p) => p.url() === `${baseURL}/library-a`)
      .at(-1);
    expect(await reopened.evaluate(() => document.cookie)).toContain(
      "library_role=account-a",
    );
    expect(await pageB.evaluate(() => document.cookie)).toContain(
      "library_role=account-b",
    );
    await library
      .locator(".item")
      .getByRole("button", { name: "編集", exact: true })
      .click();
    await library
      .getByLabel("ブックマークの名前", { exact: true })
      .fill("Renamed bookmark A");
    await library.locator("#editor-save").click();
    await expect(library.locator(".item-title")).toHaveText(
      "Renamed bookmark A",
    );
    await library
      .locator(".item")
      .getByRole("button", { name: "削除", exact: true })
      .click();
    await expect(library.locator(".item")).toHaveCount(0);
    await library
      .getByRole("button", { name: "削除を元に戻す", exact: true })
      .click();
    await expect(library.locator(".item-title")).toHaveText(
      "Renamed bookmark A",
    );
    await library.screenshot({ path: "test-results/bookmarks.png" });
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith("/src/index.html"))
        .setContentSize(960, 700);
    });
    await expect(shell.locator("#browser-menu")).toBeVisible();
    expect(
      await shell
        .locator("#browser-menu")
        .evaluate((el) => el.getBoundingClientRect().right <= innerWidth),
    ).toBe(true);
    await shell.screenshot({ path: "test-results/browser-menu-toolbar.png" });
    await application.close();
    application = null;
    const stored = fs.readFileSync(
      path.join(directory, "browser-library.enc.json"),
      "utf8",
    );
    expect(stored).not.toContain("Renamed bookmark A");
    expect(stored).not.toContain("/library-a");
    launched = await launch(directory);
    application = launched.application;
    shell = launched.shell;
    await command(shell, "open-library", { page: "bookmarks" });
    library = await libraryPage(application);
    await expect(library.locator(".item-title")).toHaveText(
      "Renamed bookmark A",
    );
    const history = await libraryCommand(library, "list", {
      kind: "history",
      query: "/library-a",
    });
    expect(history.total).toBeGreaterThan(0);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("history captures SPA visits, skips local tools and private-session persistence, and clearing keeps cookies and bookmarks", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-history-e2e-"));
  let application;
  try {
    let launched = await launch(directory);
    application = launched.application;
    let shell = launched.shell;
    const initial = await command(shell, "state"),
      a = initial.sessions[0];
    await command(shell, "navigate", { url: `${baseURL}/history-a` });
    const page = await site(application, "/history-a");
    await page.evaluate(() => {
      document.cookie = "history_auth=retain; Path=/";
    });
    await application.evaluate(({ webContents }) => {
      const contents = webContents
        .getAllWebContents()
        .find((c) => c.getURL().endsWith("/history-a"));
      contents.focus();
      contents.sendInputEvent({
        type: "keyDown",
        keyCode: "D",
        modifiers: ["meta"],
      });
      contents.sendInputEvent({
        type: "keyUp",
        keyCode: "D",
        modifiers: ["meta"],
      });
    });
    await expect(shell.locator("#modal-title")).toHaveText(
      "ブックマークを追加",
    );
    await shell
      .getByLabel("ブックマーク名", { exact: true })
      .fill("Keep this bookmark");
    await shell.locator("#modal-submit").click();
    await page.evaluate(() => {
      history.pushState({}, "", "/history-spa");
      document.title = "SPA history title";
    });
    await command(shell, "open-library", { page: "history" });
    let library = await libraryPage(application);
    await expect
      .poll(
        async () =>
          (
            await libraryCommand(library, "list", {
              kind: "history",
              query: "/history-spa",
            })
          ).total,
      )
      .toBe(1);
    const created = await command(shell, "create-session", {
      name: "Private history test",
      persistent: false,
      color: initial.colors[1],
    });
    const privateProfile = created.sessions.find(
      (s) => s.name === "Private history test",
    );
    await command(shell, "navigate", { url: `${baseURL}/history-private` });
    await site(application, "/history-private");
    await command(shell, "create-api-tab", {
      sessionId: a.id,
      request: { url: `${baseURL}/api-url-not-a-visit` },
    });
    expect(
      (
        await libraryCommand(library, "list", {
          kind: "history",
          query: "/api-url-not-a-visit",
        })
      ).total,
    ).toBe(0);
    expect(
      (
        await libraryCommand(library, "list", {
          kind: "history",
          sessionId: privateProfile.id,
        })
      ).total,
    ).toBe(1);
    await library.locator("#filter-session").selectOption(a.id);
    await library
      .getByRole("button", { name: "履歴を削除…", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await libraryCommand(library, "list", {
              kind: "history",
              sessionId: a.id,
            })
          ).total,
      )
      .toBe(0);
    expect(
      (
        await libraryCommand(library, "list", {
          kind: "bookmarks",
          sessionId: a.id,
        })
      ).total,
    ).toBe(1);
    expect(await page.evaluate(() => document.cookie)).toContain(
      "history_auth=retain",
    );
    expect(
      (
        await libraryCommand(library, "list", {
          kind: "history",
          sessionId: privateProfile.id,
        })
      ).total,
    ).toBe(1);
    await library.screenshot({ path: "test-results/history.png" });
    await application.close();
    application = null;
    launched = await launch(directory);
    application = launched.application;
    shell = launched.shell;
    await command(shell, "open-library", { page: "history" });
    library = await libraryPage(application);
    expect(
      (await libraryCommand(library, "list", { kind: "history" })).total,
    ).toBe(0);
    expect(
      (await libraryCommand(library, "list", { kind: "bookmarks" })).total,
    ).toBe(1);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
