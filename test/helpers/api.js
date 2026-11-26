const { expect, command } = require("./electron");

async function apiPage(application) {
  const shell = application
    .windows()
    .find((p) => p.url().endsWith("/src/index.html"));
  const expected = (await command(shell, "state")).tabs
    .filter((t) => t.kind === "api")
    .at(-1).id;
  let matched;
  await expect
    .poll(async () => {
      for (const page of application
        .windows()
        .filter((p) => p.url().endsWith("/src/api.html"))) {
        try {
          const id = await page.evaluate(
            async () => (await window.apiClient.invoke("state")).id,
          );
          if (id === expected) {
            matched = page;
            return true;
          }
        } catch {
          /* A newly-created editor may still be loading its preload. */
        }
      }
      return false;
    })
    .toBe(true);
  await expect(
    matched.getByRole("heading", { name: "APIリクエスト", exact: true }),
  ).toBeVisible();
  return matched;
}

async function apiCommand(page, action, payload = {}) {
  const result = await page.evaluate(
    ([action, payload]) => window.apiClient.invoke(action, payload),
    [action, payload],
  );
  expect(result.error && !result.id ? result.error : undefined).toBeUndefined();
  return result;
}

async function response(page) {
  await expect
    .poll(async () => Boolean((await apiCommand(page, "state")).response))
    .toBe(true);
  const state = await apiCommand(page, "state");
  expect(state.running).toBe(false);
  expect(state.error).toBe("");
  return state.response;
}

module.exports = { apiPage, apiCommand, response };
