const { test, expect, command } = require("../helpers/electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("macOS browser isolates sessions, shares tabs, persists logins, resets and restores worksets", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL } = testServer;

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

test("four roles remain independent and macOS keyboard shortcuts control the host UI", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL } = testServer;

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
