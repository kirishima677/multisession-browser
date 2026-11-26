const { test, expect, command, appVersion } = require("../helpers/electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("running version, memory totals, warning dismissal and preferences are visible and persist", async ({
  browserHarness,
  testServer,
}) => {
  const { launch } = browserHarness;

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
    const previousHits = testServer.updateHits;
    launched = await launch(directory);
    application = launched.application;
    shell = launched.shell;
    const restored = await command(shell, "state");
    expect(restored.preferences).toEqual({
      memoryWarningMiB: 0,
      checkUpdatesOnStartup: false,
    });
    expect(restored.update.status).toBe("idle");
    expect(testServer.updateHits).toBe(previousHits);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("startup and manual updates compare GitHub releases and show failures without blocking browsing", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL } = testServer;

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-update-"));
  let application;
  const url =
    "https://github.com/kirishima677/multisession-browser/releases/tag/v0.8.0";
  testServer.releaseFixture = {
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
    testServer.releaseFixture.body.tag_name = `v${appVersion}`;
    await shell
      .getByRole("button", { name: "今すぐ更新を確認", exact: true })
      .click();
    await expect(shell.locator("#update-message")).toContainText(
      "起動中のバージョンは最新",
    );
    testServer.releaseFixture = { status: 503, body: {} };
    await shell
      .getByRole("button", { name: "今すぐ更新を確認", exact: true })
      .click();
    await expect(shell.locator("#update-message")).toContainText(
      "更新を確認できませんでした",
    );
    testServer.releaseFixture = { status: 404, body: {} };
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
    testServer.releaseFixture = { status: 404, body: {} };
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
