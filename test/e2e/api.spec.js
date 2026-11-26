const { test, expect, command } = require("../helpers/electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { nativeViews } = require("../helpers/tabs");
const { apiPage, apiCommand, response } = require("../helpers/api");

test("API tabs use fixed browser sessions for Cookie, no-auth and Bearer requests while switching tabs", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL } = testServer;

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

test("API method changes show the relevant editor and preserve drafts and POST query parameters", async ({
  browserHarness,
  testServer,
}) => {
  const { launch } = browserHarness;
  const { baseURL } = testServer;

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-api-editors-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    await command(shell, "create-api-tab", {
      sessionId: (await command(shell, "state")).sessions[0].id,
    });
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
    await expect
      .poll(async () => (await apiCommand(page, "state")).history.length)
      .toBe(1);
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
    await expect
      .poll(async () => (await apiCommand(page, "state")).history.length)
      .toBe(2);
    result = (await apiCommand(page, "state")).response;
    expect(result.method).toBe("POST");
    echo = JSON.parse(result.body);
    expect(JSON.parse(echo.body)).toEqual({ message: "preserved body" });
    expect(echo.query).toContainEqual(["q", "日本語 & test"]);
    await page.locator("#save").click();
    await expect
      .poll(async () => (await apiCommand(page, "state")).saved.length)
      .toBe(1);
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

test("API UI sends JSON, saves requests without credentials and restores API worksets after restart", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL } = testServer;

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

test("API cancellation, timeout, redirects, response caps and HTML responses stay confined to their tab", async ({
  browserHarness,
  testServer,
}) => {
  const { launch } = browserHarness;
  const { baseURL } = testServer;

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
    const hits = testServer.redirectHits;
    await apiCommand(api, "send", {
      draft: { url: `${baseURL}/test-api/redirect` },
    });
    let result = await response(api);
    expect(result.status).toBe(302);
    expect(testServer.redirectHits).toBe(hits);
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
