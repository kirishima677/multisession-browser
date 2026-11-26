const { test, expect, command } = require("../helpers/electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  beginTabDrag,
  endTabDrag,
  nativeViews,
  assertSelection,
  twoSelectionTabs,
} = require("../helpers/tabs");

test("drag reorder keeps page state and saves the resulting tab order", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL } = testServer;

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-reorder-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    let state = await command(shell, "state");
    const profile = state.sessions[0];
    await command(shell, "navigate", { url: `${baseURL}/order-a` });
    const pageA = await site(application, "/order-a");
    await pageA
      .getByRole("textbox", { name: "Edit me" })
      .fill("Keep this unsaved input");
    await pageA.evaluate(() => {
      window.keepAliveMarker = "a";
    });
    await command(shell, "create-tab", {
      sessionId: profile.id,
      url: `${baseURL}/order-b`,
    });
    await site(application, "/order-b");
    await command(shell, "create-tab", {
      sessionId: profile.id,
      url: `${baseURL}/order-c`,
    });
    await site(application, "/order-c");
    state = await command(shell, "state");
    const ids = state.tabs.map((t) => t.id);
    const active = state.activeId;
    const viewIds = (await nativeViews(application)).views
      .map((v) => v.id)
      .sort();
    const last = await shell.locator(`[data-tab-id="${ids[2]}"]`).boundingBox();
    await beginTabDrag(shell, ids[0]);
    await endTabDrag(shell, last.x + last.width - 8, last.y + last.height / 2);
    await expect
      .poll(async () => (await command(shell, "state")).tabs.map((t) => t.id))
      .toEqual([ids[1], ids[2], ids[0]]);
    expect((await command(shell, "state")).activeId).toBe(active);
    expect(
      (await nativeViews(application)).views.map((v) => v.id).sort(),
    ).toEqual(viewIds);
    expect(await pageA.evaluate(() => window.keepAliveMarker)).toBe("a");
    expect(
      await pageA.getByRole("textbox", { name: "Edit me" }).inputValue(),
    ).toBe("Keep this unsaved input");
    await command(shell, "save-workset", { name: "Reordered" });
    state = await command(shell, "state");
    expect(state.worksets[0].tabs.map((t) => new URL(t.url).pathname)).toEqual([
      "/order-b",
      "/order-c",
      "/order-a",
    ]);
    // Escape restores the native pages and leaves order intact.
    await beginTabDrag(shell, ids[1]);
    await shell.keyboard.press("Escape");
    await shell.mouse.up();
    await expect
      .poll(async () => (await command(shell, "state")).draggingTab)
      .toBe(false);
    expect((await command(shell, "state")).tabs.map((t) => t.id)).toEqual([
      ids[1],
      ids[2],
      ids[0],
    ]);
    expect(
      (await nativeViews(application)).views.filter((v) => v.visible),
    ).toHaveLength(1);
    // Restore must respect the saved order, not the original creation order.
    await command(shell, "restore-workset", { id: state.worksets[0].id });
    await expect
      .poll(async () =>
        (await command(shell, "state")).tabs.map(
          (t) => new URL(t.url).pathname,
        ),
      )
      .toEqual(["/order-b", "/order-c", "/order-a"]);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("dropping tabs into left or right creates live split panes with isolated sessions", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL } = testServer;

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-split-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    let state = await command(shell, "state");
    const [a, b] = state.sessions;
    await command(shell, "navigate", { url: `${baseURL}/split-a` });
    const pageA = await site(application, "/split-a");
    await pageA.evaluate(() => {
      document.cookie = "jwt=left-account; Path=/";
      window.keepAliveMarker = "left";
      document.querySelector("h1").textContent = "A社 a1 / 送信するユーザー";
      document.body.style.background = "#f0f4ff";
    });
    await pageA.getByRole("textbox", { name: "Edit me" }).fill("Left draft");
    await command(shell, "create-tab", {
      sessionId: b.id,
      url: `${baseURL}/split-b`,
    });
    const pageB = await site(application, "/split-b");
    await pageB.evaluate(() => {
      document.cookie = "jwt=right-account; Path=/";
      window.keepAliveMarker = "right";
      document.querySelector("h1").textContent = "A社 a2 / 受信するユーザー";
      document.body.style.background = "#edf9f5";
    });
    state = await command(shell, "state");
    const [left, right] = state.tabs;
    const before = (await nativeViews(application)).views
      .map((v) => v.id)
      .sort();
    await command(shell, "select-tab", { id: left.id });
    const area = await shell.locator("#content").boundingBox();
    await beginTabDrag(shell, right.id);
    await endTabDrag(shell, area.x + area.width * 0.75, area.y + 120);
    state = await command(shell, "state");
    expect(state.split).toEqual({ left: left.id, right: right.id });
    let native = await nativeViews(application);
    const views = native.views
      .filter((v) => v.visible)
      .sort((a, b) => a.bounds.x - b.bounds.x);
    expect(views).toHaveLength(2);
    expect(views[0].bounds.x).toBe(236);
    expect(views[0].bounds.y).toBe(186);
    expect(views[0].bounds.x + views[0].bounds.width + 8).toBe(
      views[1].bounds.x,
    );
    expect(views[1].bounds.x + views[1].bounds.width).toBe(native.size[0]);
    expect(views[0].bounds.height).toBe(views[1].bounds.height);
    expect(native.views.map((v) => v.id).sort()).toEqual(before);
    expect(
      await pageA.getByRole("textbox", { name: "Edit me" }).inputValue(),
    ).toBe("Left draft");
    expect(await pageA.evaluate(() => document.cookie)).toBe(
      "jwt=left-account",
    );
    expect(await pageB.evaluate(() => document.cookie)).toBe(
      "jwt=right-account",
    );
    await shell
      .getByRole("button", { name: "左ペインを選択", exact: true })
      .click();
    await expect
      .poll(async () => (await command(shell, "state")).activeId)
      .toBe(left.id);
    await expect(
      shell.getByRole("textbox", {
        name: "URLまたは検索キーワード",
        exact: true,
      }),
    ).toHaveValue(`${baseURL}/split-a`);
    await shell.getByRole("button", { name: /DevTools/ }).click();
    await expect
      .poll(() =>
        application.evaluate(({ webContents }) =>
          webContents
            .getAllWebContents()
            .some(
              (c) => c.getURL().endsWith("/split-a") && c.isDevToolsOpened(),
            ),
        ),
      )
      .toBe(true);
    await application.evaluate(({ webContents }) => {
      for (const c of webContents.getAllWebContents())
        if (c.isDevToolsOpened()) c.closeDevTools();
    });
    // Clicking/focusing either native page updates the host toolbar's target.
    await application.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .find((c) => c.getURL().endsWith("/split-b"))
        .focus(),
    );
    await expect
      .poll(async () => (await command(shell, "state")).activeId)
      .toBe(right.id);
    await expect(
      shell.getByRole("textbox", {
        name: "URLまたは検索キーワード",
        exact: true,
      }),
    ).toHaveValue(`${baseURL}/split-b`);
    const png = await application.evaluate(async ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith("/src/index.html"))
        .capturePage()
        .then((image) => image.toDataURL()),
    );
    fs.writeFileSync(
      "test-results/split.png",
      Buffer.from(png.split(",")[1], "base64"),
    );
    // Drop a visible tab on the opposite side to swap the panes.
    await beginTabDrag(shell, right.id);
    await endTabDrag(shell, area.x + area.width * 0.25, area.y + 120);
    expect((await command(shell, "state")).split).toEqual({
      left: right.id,
      right: left.id,
    });
    // Opening a third tab replaces the active pane while retaining the other page.
    await command(shell, "create-tab", {
      sessionId: a.id,
      url: `${baseURL}/split-c`,
    });
    await site(application, "/split-c");
    state = await command(shell, "state");
    expect(state.split.right).toBe(left.id);
    expect(state.split.left).toBe(state.activeId);
    await command(shell, "close-tab", { id: state.activeId });
    state = await command(shell, "state");
    expect(state.split).toBeNull();
    expect(state.activeId).toBe(left.id);
    expect(
      (await nativeViews(application)).views.filter((v) => v.visible),
    ).toHaveLength(1);
    expect(await pageA.evaluate(() => window.keepAliveMarker)).toBe("left");
    // The button is an alternative to drag-and-drop and can leave split mode.
    await shell.getByRole("button", { name: "左右分割", exact: true }).click();
    await expect
      .poll(async () => Boolean((await command(shell, "state")).split))
      .toBe(true);
    await shell
      .getByRole("button", { name: "分割を解除", exact: true })
      .click();
    expect((await command(shell, "state")).split).toBeNull();
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("selection stays current during and after a cancelled drag candidate", async ({
  browserHarness,
}) => {
  const { launch } = browserHarness;

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-selection-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    const { left, right, pageB } = await twoSelectionTabs(
      application,
      shell,
      browserHarness,
    );
    await command(shell, "split-tab", { id: right.id, side: "right" });
    await command(shell, "select-tab", { id: left.id });
    await assertSelection(shell, left.id);
    const box = await shell.locator(`[data-tab-id="${left.id}"]`).boundingBox();
    await shell.mouse.move(box.x + 30, box.y + 15);
    await shell.mouse.down();
    // Native focus/title can change while a tab press is still below the drag threshold.
    await command(shell, "select-tab", { id: right.id });
    await pageB.evaluate(() => {
      document.title = "Title changed during tab press";
    });
    await expect
      .poll(async () => (await command(shell, "state")).tabs[1].title)
      .toBe("Title changed during tab press");
    await expect(shell.locator("#address")).toHaveValue(right.url);
    await expect(shell.locator("#tabs .tab.active")).toHaveAttribute(
      "data-tab-id",
      right.id,
    );
    await shell.evaluate(() =>
      window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 })),
    );
    await assertSelection(shell, right.id);
    await shell.mouse.move(250, 130);
    await shell.mouse.up();
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a fresh tab click immediately after dragging is accepted and tab nodes survive page updates", async ({
  browserHarness,
}) => {
  const { launch } = browserHarness;

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-click-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    const { left, right, pageB } = await twoSelectionTabs(
      application,
      shell,
      browserHarness,
    );
    const target = await shell
      .locator(`[data-tab-id="${right.id}"]`)
      .boundingBox();
    await beginTabDrag(shell, left.id);
    await endTabDrag(
      shell,
      target.x + target.width - 5,
      target.y + target.height / 2,
    );
    await shell.locator(`[data-tab-id="${left.id}"]`).click();
    await assertSelection(shell, left.id);
    await shell.evaluate((id) => {
      window.savedTabNode = document.querySelector(`[data-tab-id="${id}"]`);
    }, left.id);
    await pageB.evaluate(() => {
      document.title = "Background title update";
    });
    await expect
      .poll(
        async () =>
          (await command(shell, "state")).tabs.find((t) => t.id === right.id)
            .title,
      )
      .toBe("Background title update");
    expect(
      await shell.evaluate(
        (id) =>
          window.savedTabNode ===
          document.querySelector(`[data-tab-id="${id}"]`),
        left.id,
      ),
    ).toBe(true);
    await assertSelection(shell, left.id);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("an older IPC snapshot cannot roll back tab, pane or address selection", async ({
  browserHarness,
}) => {
  const { launch } = browserHarness;

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-state-order-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    const { left, right } = await twoSelectionTabs(
      application,
      shell,
      browserHarness,
    );
    await command(shell, "split-tab", { id: right.id, side: "right" });
    const old = await command(shell, "select-tab", { id: left.id });
    await command(shell, "select-tab", { id: right.id });
    await assertSelection(shell, right.id);
    // Simulate a delayed invoke response arriving after a newer focus notification.
    await application.evaluate(({ BrowserWindow }, old) => {
      const owner = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith("/src/index.html"),
      );
      owner.webContents.send("browser:state", old);
    }, old);
    // Wait for IPC delivery and rendering before checking for a rollback.
    await shell.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const after = await shell.evaluate(() => ({
      active: document.querySelector("#tabs .tab.active")?.dataset.tabId,
      address: document.querySelector("#address").value,
    }));
    expect(after.active).toBe(right.id);
    expect(after.address).toBe(right.url);
    await assertSelection(shell, right.id);
    await shell
      .locator("#tabs")
      .screenshot({ path: "test-results/selection-tabs.png" });
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
