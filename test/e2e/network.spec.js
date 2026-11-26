const { test, expect, command } = require("../helpers/electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { apiPage, apiCommand, response } = require("../helpers/api");
const {
  toolsPage,
  toolCommand,
  interceptClipboard,
} = require("../helpers/test-tools");

test("response tools search Web and API bodies across tabs without replay, coexist with DevTools and copy selected text", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL } = testServer;

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
    const hitCount = testServer.responseHits;
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
    expect(testServer.responseHits).toBe(hitCount);
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
