const { expect, command } = require("./electron");

async function beginTabDrag(shell, id) {
  const box = await shell.locator(`[data-tab-id="${id}"]`).boundingBox();
  await shell.mouse.move(box.x + 35, box.y + box.height / 2);
  await shell.mouse.down();
  await shell.mouse.move(box.x + 50, box.y + box.height / 2, { steps: 3 });
  await expect
    .poll(async () => (await command(shell, "state")).draggingTab)
    .toBe(true);
}

async function endTabDrag(shell, x, y) {
  await shell.mouse.move(x, y, { steps: 8 });
  await shell.mouse.up();
  await expect
    .poll(async () => (await command(shell, "state")).draggingTab)
    .toBe(false);
  await expect(shell.locator("#tab-drop-overlay")).not.toBeVisible();
  await expect(
    shell.locator("#tabs .drag-source, #tabs .drop-before, #tabs .drop-after"),
  ).toHaveCount(0);
}

async function nativeViews(application) {
  return application.evaluate(({ BrowserWindow }) => {
    const root = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith("/src/index.html"),
    );
    return {
      size: root.getContentSize(),
      views: root.contentView.children
        .filter((v) => v.webContents && !v.webContents.isDestroyed())
        .map((v) => ({
          id: v.webContents.id,
          url: v.webContents.getURL(),
          visible: v.getVisible(),
          bounds: v.getBounds(),
        })),
    };
  });
}

async function assertSelection(shell, id) {
  await expect(shell.locator('#tabs [aria-selected="true"]')).toHaveCount(1);
  await expect(shell.locator('#tabs [aria-selected="true"]')).toHaveAttribute(
    "data-tab-id",
    id,
  );
  await expect(shell.locator("#tabs .tab.active")).toHaveAttribute(
    "data-tab-id",
    id,
  );
  const state = await command(shell, "state");
  const selected = state.tabs.find((t) => t.id === id);
  await expect(shell.locator("#address")).toHaveValue(
    selected.url === "about:blank" ? "" : selected.url,
  );
  if (state.split) {
    const side = state.split.left === id ? "左" : "右";
    await expect(
      shell.getByRole("button", { name: `${side}ペインを選択`, exact: true }),
    ).toHaveClass(/selected/);
    await expect(shell.locator(".pane-heading.selected")).toHaveCount(1);
  }
}

async function twoSelectionTabs(application, shell, browserHarness) {
  const { baseURL, site } = browserHarness;
  const state = await command(shell, "state");
  const [a, b] = state.sessions;
  await command(shell, "navigate", { url: `${baseURL}/select-a` });
  const pageA = await site(application, "/select-a");
  await command(shell, "create-tab", {
    sessionId: b.id,
    url: `${baseURL}/select-b`,
  });
  const pageB = await site(application, "/select-b");
  const next = await command(shell, "state");
  return { left: next.tabs[0], right: next.tabs[1], pageA, pageB };
}

module.exports = {
  beginTabDrag,
  endTabDrag,
  nativeViews,
  assertSelection,
  twoSelectionTabs,
};
