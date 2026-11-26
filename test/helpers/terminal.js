const { expect, command } = require("./electron");

async function cliPage(application) {
  const shell = application
    .windows()
    .find((p) => p.url().endsWith("/src/index.html"));
  const id = (await command(shell, "state")).tabs
    .filter((t) => t.kind === "terminal")
    .at(-1).id;
  let matched;
  await expect
    .poll(async () => {
      for (const page of application
        .windows()
        .filter((p) => p.url().endsWith("/src/terminal.html"))) {
        try {
          if (
            (await page.evaluate(() => terminalAPI.invoke("state"))).id === id
          ) {
            matched = page;
            return true;
          }
        } catch {}
      }
      return false;
    })
    .toBe(true);
  await matched.waitForFunction(
    () => typeof term !== "undefined" && initialized,
  );
  return matched;
}

async function terminalText(page) {
  return page.evaluate(() => {
    const buffer = term.buffer.active;
    return Array.from(
      { length: buffer.length },
      (_, i) => buffer.getLine(i)?.translateToString(true) || "",
    ).join("\n");
  });
}

async function typeCLI(page, value) {
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
}

module.exports = { cliPage, terminalText, typeCLI };
