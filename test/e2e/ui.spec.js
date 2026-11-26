const { test, expect, command } = require("../helpers/electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("address focus selects the URL while later clicks and dragging allow editing", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL } = testServer;

  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "msb-address-focus-"),
  );
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
    const selection = () =>
      address.evaluate((input) => ({
        start: input.selectionStart,
        end: input.selectionEnd,
      }));
    const position = { x: 100, y: (await address.boundingBox()).height / 2 };
    await address.evaluate((input) => input.blur());
    await address.click({ position });
    expect(await selection()).toEqual({ start: 0, end: url.length });
    await address.click({ position });
    const caret = await selection();
    expect(caret.start).toBe(caret.end);
    await expect(address).toHaveValue(url);

    await address.evaluate((input) => input.blur());
    const bounds = await address.boundingBox();
    await shell.mouse.move(bounds.x + 70, bounds.y + bounds.height / 2);
    await shell.mouse.down();
    await shell.mouse.move(bounds.x + 150, bounds.y + bounds.height / 2, {
      steps: 10,
    });
    await shell.mouse.up();
    const range = await selection();
    expect(range.end - range.start).toBeGreaterThan(0);
    expect(range.end - range.start).toBeLessThan(url.length);

    await shell.locator("#reload").focus();
    await shell.keyboard.press("Tab");
    await expect(address).toBeFocused();
    expect(await selection()).toEqual({ start: 0, end: url.length });
    await application.evaluate(({ webContents }) => {
      const host = webContents
        .getAllWebContents()
        .find((c) => c.getURL().endsWith("/src/index.html"));
      host.focus();
      host.sendInputEvent({
        type: "keyDown",
        keyCode: "L",
        modifiers: ["meta"],
      });
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

test("address input searches text and navigates URLs without external requests in the test", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL } = testServer;

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

test("renderer modules keep dialog drafts across page and runtime updates and recover from validation errors", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL } = testServer;

  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "msb-renderer-dialogs-"),
  );
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    const errors = [];
    shell.on("pageerror", (error) => errors.push(error.message));
    await command(shell, "navigate", { url: `${baseURL}/dialog-background` });
    const page = await site(application, "/dialog-background");
    const initial = await command(shell, "state");
    await shell.locator("#app-info").click();
    const memory = shell.getByLabel("メモリ警告（MiB、0で無効）", {
      exact: true,
    });
    await memory.fill("1234");
    await page.evaluate(() => {
      document.title = "Background update while editing";
    });
    await expect(shell.locator("#tabs")).toContainText(
      "Background update while editing",
    );
    await application.evaluate(({ app }) => {
      app.getAppMetrics = () => [
        { pid: process.pid, memory: { workingSetSize: 123 * 1024 } },
      ];
    });
    await command(shell, "sample-memory");
    await expect(shell.locator("#runtime-memory")).toContainText("123 MiB");
    await expect(memory).toHaveValue("1234");
    await expect(shell.locator("#modal")).toBeVisible();
    await shell
      .locator("#modal")
      .screenshot({ path: "test-results/renderer-settings-dialog.png" });
    await shell.locator("#modal-cancel").click();
    await expect(shell.locator("#modal")).not.toBeVisible();
    expect((await command(shell, "state")).preferences).toEqual(
      initial.preferences,
    );

    await shell.locator("#add-session").click();
    const name = shell.getByLabel("セッション名", { exact: true });
    await name.fill("  ");
    await shell.locator("#modal-submit").click();
    await expect(shell.locator("#modal-error")).toContainText(
      "名前は1〜80文字",
    );
    await expect(shell.locator("#modal-submit")).toBeEnabled();
    await expect(shell.locator("#modal")).toBeVisible();
    await name.fill("Draft survives state updates");
    await shell.locator(".color-option").nth(1).click();
    await command(shell, "sample-memory");
    await expect(name).toHaveValue("Draft survives state updates");
    await expect(shell.locator(".color-option").nth(1)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await shell.locator("#modal-submit").click();
    await expect(shell.locator("#modal")).not.toBeVisible();
    const state = await command(shell, "state");
    const created = state.sessions.find(
      (s) => s.name === "Draft survives state updates",
    );
    expect(created.color).toBe(state.colors[1]);
    expect(state.tabs.find((t) => t.id === state.activeId).sessionId).toBe(
      created.id,
    );
    expect(state.sessions).toHaveLength(initial.sessions.length + 1);
    expect(errors).toEqual([]);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
