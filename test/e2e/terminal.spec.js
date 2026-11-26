const { test, expect, command } = require("../helpers/electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { nativeViews } = require("../helpers/tabs");
const { cliPage, terminalText, typeCLI } = require("../helpers/terminal");

test("CLI tabs run an interactive PTY, resize, split, restore without executing and stop child processes", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL } = testServer;

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-cli-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    await shell.getByRole("button", { name: "＋ CLI", exact: true }).click();
    await shell
      .getByRole("button", { name: "タブを開く", exact: true })
      .click();
    let cli = await cliPage(application);
    await expect
      .poll(
        async () =>
          (await cli.evaluate(() => terminalAPI.invoke("state"))).phase,
      )
      .toBe("running");
    expect(
      await cli.evaluate(() => [
        typeof require,
        typeof browserAPI,
        typeof apiClient,
      ]),
    ).toEqual(["undefined", "undefined", "undefined"]);
    await expect.poll(() => terminalText(cli)).toMatch(/%\s/);
    const sampled = await command(shell, "sample-memory");
    expect(sampled.memory.cliProcesses).toBeGreaterThan(0);
    await typeCLI(cli, 'printf "PTY_RESULT_%s\\n" "$((6*7))"');
    await expect.poll(() => terminalText(cli)).toContain("PTY_RESULT_42");
    await typeCLI(cli, 'printf "TTY_RESULT_%s\\n" "$(test -t 0 && echo yes)"');
    await expect.poll(() => terminalText(cli)).toContain("TTY_RESULT_yes");
    const shellPID = (await cli.evaluate(() => terminalAPI.invoke("state")))
      .pid;
    await typeCLI(cli, "sleep 30");
    const childPIDs = () =>
      require("node:child_process")
        .execFileSync("/bin/ps", ["-axo", "pid=,ppid="], { encoding: "utf8" })
        .trim()
        .split("\n")
        .map((line) => line.trim().split(/\s+/).map(Number))
        .filter(([, ppid]) => ppid === shellPID)
        .map(([pid]) => pid);
    await expect.poll(() => childPIDs().length).toBeGreaterThan(0);
    await cli.keyboard.press("Control+c");
    await expect.poll(() => childPIDs().length).toBe(0);
    await typeCLI(cli, 'printf "INTERRUPTED_%s\\n" ok');
    await expect.poll(() => terminalText(cli)).toContain("INTERRUPTED_ok");
    const state = await command(shell, "state");
    const cliID = state.tabs.find((t) => t.kind === "terminal").id;
    await command(shell, "create-tab", {
      sessionId: state.sessions[0].id,
      url: `${baseURL}/cli-split`,
    });
    await site(application, "/cli-split");
    await command(shell, "split-tab", { id: cliID, side: "right" });
    expect(
      (await nativeViews(application)).views.filter((v) => v.visible),
    ).toHaveLength(2);
    await expect.poll(() => cli.evaluate(() => term.cols)).toBeLessThan(100);
    const cols = await cli.evaluate(() => term.cols);
    await typeCLI(
      cli,
      'printf "COLS_RESULT_%s\\n" "$(stty size | awk \'{print $2}\')"',
    );
    await expect.poll(() => terminalText(cli)).toContain(`COLS_RESULT_${cols}`);
    await shell.getByRole("button", { name: /構成を保存/ }).click();
    await shell
      .getByLabel("作業セット名", { exact: true })
      .fill("CLI workspace");
    await shell
      .getByRole("button", { name: "作業セットを保存", exact: true })
      .click();
    let config = JSON.parse(
      fs.readFileSync(path.join(directory, "workspace.json"), "utf8"),
    );
    const id = config.worksets[0].id;
    expect(config.worksets[0].tabs.some((t) => t.kind === "terminal")).toBe(
      true,
    );
    expect(
      fs.readFileSync(path.join(directory, "workspace.json"), "utf8"),
    ).not.toContain("PTY_RESULT");
    await shell.getByRole("button", { name: /構成を保存/ }).click();
    await shell.getByLabel("保存方法").selectOption("overwrite");
    await shell.getByLabel("上書きする構成").selectOption(id);
    await shell
      .getByLabel("作業セット名", { exact: true })
      .fill("CLI workspace updated");
    await shell
      .getByRole("button", { name: "作業セットを保存", exact: true })
      .click();
    config = JSON.parse(
      fs.readFileSync(path.join(directory, "workspace.json"), "utf8"),
    );
    expect(config.worksets).toHaveLength(1);
    expect(config.worksets[0].id).toBe(id);
    expect(config.worksets[0].name).toBe("CLI workspace updated");
    await command(shell, "restore-workset", { id });
    cli = await cliPage(application);
    expect((await cli.evaluate(() => terminalAPI.invoke("state"))).phase).toBe(
      "idle",
    );
    await expect(
      cli.getByRole("button", { name: "シェルを起動", exact: true }),
    ).toBeVisible();
    await command(shell, "select-tab", {
      id: (await cli.evaluate(() => terminalAPI.invoke("state"))).id,
    });
    await cli
      .getByRole("button", { name: "シェルを起動", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await cli.evaluate(() => terminalAPI.invoke("state"))).phase,
      )
      .toBe("running");
    await expect.poll(() => terminalText(cli)).toMatch(/%\s/);
    await typeCLI(cli, "/bin/sleep 30 & echo CHILD_PID:$!");
    await expect.poll(() => terminalText(cli)).toMatch(/CHILD_PID:\d+/);
    const childPID = Number(
      (await terminalText(cli)).match(/CHILD_PID:(\d+)/)[1],
    );
    const live = await cli.evaluate(() => terminalAPI.invoke("state"));
    await cli.screenshot({ path: "test-results/terminal.png" });
    await command(shell, "close-tab", { id: live.id });
    await expect
      .poll(() => {
        try {
          process.kill(childPID, 0);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
