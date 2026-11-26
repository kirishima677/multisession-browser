const { test, expect, command } = require("../helpers/electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  captureContextMenus,
  contextClick,
} = require("../helpers/context-menu");

test("image and link saving uses the originating session and preserves HTTP, Blob and Data bytes", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL, testPNG, imageCookies } = testServer;

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-images-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    let state = await command(shell, "state");
    const [a, b] = state.sessions;
    await command(shell, "navigate", { url: `${baseURL}/prepare-image` });
    const prep = await site(application, "/prepare-image");
    await prep.evaluate(() => {
      document.cookie = "jwt=image-user; Path=/";
    });
    await command(shell, "navigate", { url: `${baseURL}/rich-menu` });
    const page = await site(application, "/rich-menu");
    await expect(
      page.getByRole("img", { name: "Private image" }),
    ).toBeVisible();
    expect(
      await page
        .getByRole("img", { name: "Private image" })
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    ).toBe(true);
    state = await command(shell, "state");
    const original = state.tabs[0];
    await command(shell, "create-tab", {
      sessionId: b.id,
      url: `${baseURL}/other-download-session`,
    });
    const other = await site(application, "/other-download-session");
    await other.evaluate(() => {
      document.cookie = "jwt=wrong-session; Path=/";
    });
    state = await command(shell, "state");
    await command(shell, "split-tab", { id: state.activeId, side: "right" });
    await captureContextMenus(application);
    await application.evaluate(({ webContents }, directory) => {
      const contents = webContents
        .getAllWebContents()
        .find((c) => c.getURL().endsWith("/rich-menu"));
      global.__savedDownloads = [];
      let count = 0;
      contents.session.on("will-download", (_event, item) => {
        const file = `${directory}/download-${++count}.bin`;
        item.setSavePath(file);
        item.once("done", (_event, state) =>
          global.__savedDownloads.push({
            file,
            state,
            url: item.getURL(),
            mime: item.getMimeType(),
          }),
        );
      });
    }, directory);
    await contextClick(
      application,
      page,
      page.getByRole("img", { name: "Private image" }),
      "save-image",
    );
    await expect
      .poll(() => application.evaluate(() => global.__savedDownloads.length))
      .toBe(1);
    let saved = await application.evaluate(() => global.__savedDownloads[0]);
    expect(saved.state).toBe("completed");
    expect(fs.readFileSync(saved.file)).toEqual(testPNG);
    expect(imageCookies.at(-1)).toContain("jwt=image-user");
    await contextClick(
      application,
      page,
      page.getByRole("link", { name: "Save this link" }),
      "save-link",
    );
    await expect
      .poll(() => application.evaluate(() => global.__savedDownloads.length))
      .toBe(2);
    saved = await application.evaluate(() => global.__savedDownloads[1]);
    expect(fs.readFileSync(saved.file)).toEqual(testPNG);
    // Save inline resources without using a different session or clipboard.
    await page.evaluate(async (data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      for (const [name, src] of [
        ["Data image", `data:image/png;base64,${data}`],
        [
          "Blob image",
          URL.createObjectURL(new Blob([bytes], { type: "image/png" })),
        ],
      ]) {
        const image = document.createElement("img");
        image.alt = name;
        image.src = src;
        image.width = 80;
        image.height = 80;
        document.body.append(image);
        await image.decode();
      }
    }, testPNG.toString("base64"));
    for (const [index, name] of ["Data image", "Blob image"].entries()) {
      await contextClick(
        application,
        page,
        page.getByRole("img", { name }),
        "save-image",
      );
      await expect
        .poll(() => application.evaluate(() => global.__savedDownloads.length))
        .toBe(index + 3);
      saved = await application.evaluate(
        (_electron, index) => global.__savedDownloads[index + 2],
        index,
      );
      expect(saved.state).toBe("completed");
      expect(fs.readFileSync(saved.file)).toEqual(testPNG);
    }
    await contextClick(
      application,
      page,
      page.getByRole("img", { name: "Private image" }),
      "open-image",
    );
    const opened = await site(application, "/protected-image.png");
    expect(await opened.evaluate(() => document.cookie)).toContain(
      "jwt=image-user",
    );
    state = await command(shell, "state");
    expect(state.tabs.at(-1).sessionId).toBe(original.sessionId);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("page find navigates matches, saves a single web archive and requests non-silent printing", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL } = testServer;

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-page-actions-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    await command(shell, "navigate", { url: `${baseURL}/prepare-page` });
    const prep = await site(application, "/prepare-page");
    await prep.evaluate(() => {
      document.cookie = "jwt=image-user; Path=/";
    });
    await command(shell, "navigate", { url: `${baseURL}/rich-menu` });
    const page = await site(application, "/rich-menu");
    await captureContextMenus(application);
    await contextClick(
      application,
      page,
      page.getByRole("heading", { name: "Image browser" }),
      "find-page",
    );
    await expect
      .poll(() =>
        application.windows().some((p) => p.url().endsWith("/src/find.html")),
      )
      .toBe(true);
    let find = application
      .windows()
      .find((p) => p.url().endsWith("/src/find.html"));
    await find
      .getByRole("textbox", { name: "ページ内検索", exact: true })
      .fill("Needle");
    await expect(find.locator("#matches")).toHaveText("1 / 3 件");
    await find.getByRole("button", { name: "次の一致" }).click();
    await expect(find.locator("#matches")).toHaveText("2 / 3 件");
    await find.getByRole("button", { name: "前の一致" }).click();
    await expect(find.locator("#matches")).toHaveText("1 / 3 件");
    expect(await find.evaluate(() => typeof window.browserAPI)).toBe(
      "undefined",
    );
    await find.screenshot({ path: "test-results/find.png" });
    await find.keyboard.press("Escape").catch((error) => {
      if (!find.isClosed()) throw error;
    });
    await expect
      .poll(() =>
        application.windows().some((p) => p.url().endsWith("/src/find.html")),
      )
      .toBe(false);
    await application.evaluate(({ dialog, webContents }, directory) => {
      global.__saveOptions = null;
      dialog.showSaveDialog = async (_owner, options) => {
        global.__saveOptions = options;
        return { canceled: false, filePath: `${directory}/page.mhtml` };
      };
      const contents = webContents
        .getAllWebContents()
        .find((c) => c.getURL().endsWith("/rich-menu"));
      const save = contents.savePage.bind(contents);
      contents.savePage = async (...args) => {
        await save(...args);
        global.__pageSaveCompleted = true;
      };
      contents.print = (options, callback) => {
        global.__printOptions = options;
        callback(false, "cancelled");
      };
    }, directory);
    await contextClick(
      application,
      page,
      page.getByRole("heading", { name: "Image browser" }),
      "save-page",
    );
    await expect
      .poll(() => fs.existsSync(path.join(directory, "page.mhtml")))
      .toBe(true);
    await expect
      .poll(() => application.evaluate(() => global.__pageSaveCompleted))
      .toBe(true);
    fs.copyFileSync(
      path.join(directory, "page.mhtml"),
      "test-results/page.mhtml",
    );
    // Reopen the completed archive. Chromium disables page scripts in MHTML.
    const viewerID = await application.evaluate(
      async ({ BrowserWindow }, file) => {
        const viewer = new BrowserWindow({
          show: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        });
        await viewer.loadFile(file);
        return viewer.id;
      },
      path.join(directory, "page.mhtml"),
    );
    const archived = application
      .windows()
      .find((p) => p.url().endsWith("/page.mhtml"));
    await expect(
      archived.getByRole("heading", { name: "Image browser" }),
    ).toBeVisible();
    await application.evaluate(
      ({ BrowserWindow }, id) => BrowserWindow.fromId(id).destroy(),
      viewerID,
    );
    expect(
      await application.evaluate(
        () => global.__saveOptions.filters[0].extensions,
      ),
    ).toEqual(["mhtml"]);
    await contextClick(
      application,
      page,
      page.getByRole("heading", { name: "Image browser" }),
      "print-page",
    );
    expect(await application.evaluate(() => global.__printOptions)).toEqual({
      silent: false,
      printBackground: true,
    });
    // Cmd-F uses the same safe search UI.
    await application.evaluate(({ webContents }) => {
      const contents = webContents
        .getAllWebContents()
        .find((c) => c.getURL().endsWith("/rich-menu"));
      contents.focus();
      contents.sendInputEvent({
        type: "keyDown",
        keyCode: "F",
        modifiers: ["meta"],
      });
      contents.sendInputEvent({
        type: "keyUp",
        keyCode: "F",
        modifiers: ["meta"],
      });
    });
    await expect
      .poll(() =>
        application.windows().some((p) => p.url().endsWith("/src/find.html")),
      )
      .toBe(true);
    find = application
      .windows()
      .find((p) => p.url().endsWith("/src/find.html"));
    await find
      .getByRole("textbox", { name: "ページ内検索", exact: true })
      .fill("Not present");
    await expect(find.locator("#matches")).toHaveText("0 / 0 件");
    // Closing a page also tears down its search window.
    await command(shell, "close-tab");
    await expect
      .poll(() =>
        application.windows().some((p) => p.url().endsWith("/src/find.html")),
      )
      .toBe(false);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
