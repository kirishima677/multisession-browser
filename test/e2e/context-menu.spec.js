const { test, expect, command } = require("../helpers/electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  captureContextMenus,
  contextClick,
} = require("../helpers/context-menu");

test("right-click menus target the originating page and open links in its session", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL } = testServer;

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

test("selected-text search stays in session and plain-text paste targets the clicked editable area", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL } = testServer;

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
