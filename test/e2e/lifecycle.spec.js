const { test, expect, command } = require("../helpers/electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { apiPage, apiCommand } = require("../helpers/api");
const { cliPage } = require("../helpers/terminal");

test("closing a mixed workspace cancels API traffic, stops its CLI and closes popups before macOS reactivation", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL, server } = testServer;

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-mixed-close-"));
  const route = "/test-api/delay?ms=30000&fixture=mixed-close";
  let application,
    requested = false,
    disconnected = false;
  const observe = (req, res) => {
    if (req.url !== route) return;
    requested = true;
    res.once("close", () => {
      disconnected = true;
    });
  };
  server.on("request", observe);
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    const sessionId = (await command(shell, "state")).sessions[0].id;
    await command(shell, "navigate", { url: `${baseURL}/mixed-origin` });
    const page = await site(application, "/mixed-origin");
    await page.evaluate(() => {
      document.cookie = "mixed_workspace=retained; Path=/";
      window.open("/mixed-popup");
    });
    await site(application, "/mixed-popup");
    await command(shell, "create-terminal-tab", {
      sessionId,
      terminal: { cwd: directory },
    });
    const cli = await cliPage(application);
    await expect
      .poll(() =>
        cli.evaluate(async () => (await terminalAPI.invoke("state")).phase),
      )
      .toBe("running");
    const pid = await cli.evaluate(
      async () => (await terminalAPI.invoke("state")).pid,
    );
    await command(shell, "create-api-tab", { sessionId });
    const api = await apiPage(application);
    await apiCommand(api, "send", { draft: { url: `${baseURL}${route}` } });
    await expect.poll(() => requested).toBe(true);
    expect((await apiCommand(api, "state")).running).toBe(true);
    await shell.close();
    await expect.poll(() => disconnected).toBe(true);
    await expect
      .poll(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch (error) {
          if (error.code === "ESRCH") return true;
          throw error;
        }
      })
      .toBe(true);
    await expect
      .poll(() =>
        application.evaluate(
          ({ webContents }) =>
            webContents
              .getAllWebContents()
              .filter((c) => ["window", "browserView"].includes(c.getType()))
              .length,
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
    await reopened.waitForFunction(() => Boolean(window.browserAPI));
    const state = await command(reopened, "state");
    expect(state.tabs).toHaveLength(1);
    expect(state.split).toBe(null);
    expect(state.draggingTab).toBe(false);
    await command(reopened, "navigate", { url: `${baseURL}/mixed-reopened` });
    const restored = await site(application, "/mixed-reopened");
    expect(await restored.evaluate(() => document.cookie)).toContain(
      "mixed_workspace=retained",
    );
  } finally {
    server.removeListener("request", observe);
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
