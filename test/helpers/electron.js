const { test: base, expect, _electron: electron } = require("@playwright/test");
const path = require("node:path");
const { startTestServer } = require("./test-server");
const repositoryRoot = path.resolve(__dirname, "../..");
const appVersion = require(path.join(repositoryRoot, "package.json")).version;

function createBrowserHarness(testServer, testInfo) {
  const { baseURL } = testServer;
  async function launch(directory, options = {}) {
    const application = await electron.launch({
      ...(options.executablePath || process.env.MSB_EXECUTABLE
        ? {
            executablePath:
              options.executablePath || process.env.MSB_EXECUTABLE,
            args: [],
          }
        : { args: [repositoryRoot] }),
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
      await shell.screenshot({ path: testInfo.outputPath("welcome.png") });
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
  async function site(application, route = "/") {
    const url = `${baseURL}${route}`;
    await expect
      .poll(() => application.windows().some((p) => p.url() === url))
      .toBe(true);
    const page = application.windows().find((p) => p.url() === url);
    await page.waitForLoadState();
    return page;
  }
  return { launch, site, baseURL };
}
async function command(shell, action, payload = {}) {
  const result = await shell.evaluate(
    ([action, payload]) => window.browserAPI.invoke(action, payload),
    [action, payload],
  );
  expect(result.error).toBeUndefined();
  return result;
}

const test = base.extend({
  testServer: async ({}, use) => {
    const server = await startTestServer();
    try {
      await use(server);
    } finally {
      await server.close();
    }
  },
  browserHarness: async ({ testServer }, use, testInfo) => {
    await use(createBrowserHarness(testServer, testInfo));
  },
});
module.exports = { test, expect, command, appVersion };
