const { expect } = require("./electron");

async function libraryPage(application) {
  await expect
    .poll(() =>
      application.windows().some((p) => p.url().endsWith("/src/library.html")),
    )
    .toBe(true);
  const page = application
    .windows()
    .find((p) => p.url().endsWith("/src/library.html"));
  await page.waitForLoadState();
  await page.waitForFunction(() => Boolean(window.libraryAPI));
  return page;
}

async function libraryCommand(page, action, payload = {}) {
  const result = await page.evaluate(
    ([action, payload]) => libraryAPI.invoke(action, payload),
    [action, payload],
  );
  expect(result.error).toBeUndefined();
  return result;
}

module.exports = { libraryPage, libraryCommand };
