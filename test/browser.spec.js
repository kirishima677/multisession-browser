const { test, expect, _electron: electron } = require("@playwright/test");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let server, baseURL;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      '<!doctype html><title>Session fixture</title><h1>Local test site</h1><a href="/next">Next</a><input aria-label="Edit me" value="fixture">',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => new Promise((resolve) => server.close(resolve)));

async function launch(directory) {
  const application = await electron.launch({
    ...(process.env.MSB_EXECUTABLE
      ? { executablePath: process.env.MSB_EXECUTABLE, args: [] }
      : { args: [path.join(__dirname, "..")] }),
    env: { ...process.env, MSB_USER_DATA: directory },
  });
  try {
    await expect
      .poll(() =>
        application.windows().some((p) => p.url().endsWith("/src/index.html")),
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
