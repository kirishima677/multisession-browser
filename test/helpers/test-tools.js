const { expect } = require("./electron");
const fs = require("node:fs");
const path = require("node:path");

async function toolsPage(application) {
  await expect
    .poll(() =>
      application
        .windows()
        .some((p) => p.url().endsWith("/src/test-tools.html")),
    )
    .toBe(true);
  const page = application
    .windows()
    .find((p) => p.url().endsWith("/src/test-tools.html"));
  await page.waitForFunction(() => Boolean(window.testTools));
  await page.waitForLoadState();
  return page;
}

async function toolCommand(page, action, payload = {}) {
  const result = await page.evaluate(
    ([action, payload]) => testTools.invoke(action, payload),
    [action, payload],
  );
  expect(result.error).toBeUndefined();
  return result;
}

async function interceptClipboard(application) {
  await application.evaluate(({ clipboard }) => {
    globalThis.testClipboard = "";
    clipboard.writeText = (value) => {
      globalThis.testClipboard = value;
    };
  });
}

function cookieDB(directory, id) {
  return fs
    .readdirSync(directory, { recursive: true })
    .map((p) => path.join(directory, p))
    .find((p) => p.includes(id) && path.basename(p) === "Cookies");
}

function storedCookie(file, name) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db
      .prepare(
        "select name, value, length(encrypted_value) as encryptedBytes from cookies where name=?",
      )
      .get(name);
  } finally {
    db.close();
  }
}

module.exports = {
  toolsPage,
  toolCommand,
  interceptClipboard,
  cookieDB,
  storedCookie,
};
