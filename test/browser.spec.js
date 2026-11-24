const { test, expect, _electron: electron } = require("@playwright/test");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let server, baseURL;
const testPNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
  "base64",
);
const imageCookies = [];
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
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
