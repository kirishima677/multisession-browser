const { test, expect, command } = require("../helpers/electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { nativeViews } = require("../helpers/tabs");
const { libraryPage, libraryCommand } = require("../helpers/library");

test("browser overflow menu and bookmarks work over page views, preserve sessions and survive encrypted restart", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL } = testServer;

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

test("history captures SPA visits, skips local tools and private-session persistence, and clearing keeps cookies and bookmarks", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL } = testServer;

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
