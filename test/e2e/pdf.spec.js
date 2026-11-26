const { test, expect, command } = require("../helpers/electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  captureContextMenus,
  contextClick,
} = require("../helpers/context-menu");

test("PDF export from context and browser menus preserves the originating page and generates complete private files", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL, pdfRequestCookies } = testServer;

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-pdf-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    const initial = await command(shell, "state");
    await command(shell, "navigate", { url: `${baseURL}/prepare-pdf` });
    let pageA = await site(application, "/prepare-pdf");
    await pageA.evaluate(() => {
      document.cookie = "pdf_user=account-a; Path=/";
    });
    await command(shell, "navigate", { url: `${baseURL}/pdf-page?a` });
    pageA = await site(application, "/pdf-page?a");
    const aId = (await command(shell, "state")).activeId;
    await command(shell, "create-tab", {
      sessionId: initial.sessions[1].id,
      url: `${baseURL}/prepare-pdf-b`,
    });
    let pageB = await site(application, "/prepare-pdf-b");
    await pageB.evaluate(() => {
      document.cookie = "pdf_user=account-b; Path=/";
    });
    await command(shell, "navigate", { url: `${baseURL}/pdf-page?b` });
    pageB = await site(application, "/pdf-page?b");
    const bId = (await command(shell, "state")).activeId;
    await command(shell, "split-tab", { id: bId, side: "right" });
    const hits = pdfRequestCookies.length;
    const fileA = path.join(directory, "account-a.pdf");
    const fileB = path.join(directory, `${"b".repeat(240)}.pdf`);
    await captureContextMenus(application);
    await application.evaluate(({ dialog, webContents }) => {
      global.__pdfDialogEntered = false;
      global.__pdfCalls = [];
      global.__pdfErrors = [];
      dialog.showSaveDialog = async (_owner, options) => {
        global.__pdfDialogOptions = options;
        global.__pdfDialogEntered = true;
        return new Promise((resolve) => {
          global.__pdfResolve = resolve;
        });
      };
      dialog.showMessageBox = async (_owner, options) => {
        global.__pdfErrors.push(options.detail);
        return { response: 0 };
      };
      for (const contents of webContents
        .getAllWebContents()
        .filter((c) => c.getURL().includes("/pdf-page?"))) {
        const print = contents.printToPDF.bind(contents);
        contents.printToPDF = (options) => {
          global.__pdfCalls.push({
            id: contents.id,
            url: contents.getURL(),
            options,
          });
          return print(options);
        };
      }
    });
    await contextClick(application, pageA, pageA.locator("h1"), "save-pdf");
    await expect
      .poll(() => application.evaluate(() => global.__pdfDialogEntered))
      .toBe(true);
    await command(shell, "select-tab", { id: bId });
    await application.evaluate((_electron, filePath) => {
      global.__pdfResolve({ canceled: false, filePath });
    }, fileA);
    await expect.poll(() => fs.existsSync(fileA)).toBe(true);
    expect((await command(shell, "state")).activeId).toBe(bId);

    await application.evaluate(({ dialog }, filePath) => {
      global.__actionMenu = null;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, fileB);
    await shell.locator("#browser-menu").click();
    await expect
      .poll(() =>
        application.evaluate(() =>
          Boolean(global.__actionMenu?.getMenuItemById("history-menu")),
        ),
      )
      .toBe(true);
    await application.evaluate(() => {
      const menu = global.__actionMenu;
      menu.closePopup();
      menu.getMenuItemById("save-pdf").click();
    });
    await expect.poll(() => fs.existsSync(fileB)).toBe(true);
    for (const [file, name] of [
      [fileA, "pdf-origin-a.pdf"],
      [fileB, "pdf-origin-b.pdf"],
    ]) {
      const bytes = fs.readFileSync(file);
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      expect(bytes.toString("latin1")).toMatch(/%%EOF\s*$/);
      expect(bytes.length).toBeGreaterThan(1000);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      fs.copyFileSync(file, path.join("test-results", name));
    }
    const calls = await application.evaluate(() => global.__pdfCalls);
    expect(calls.map((c) => c.url)).toEqual([
      `${baseURL}/pdf-page?a`,
      `${baseURL}/pdf-page?b`,
    ]);
    expect(calls[0].options).toEqual({
      pageSize: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    const options = await application.evaluate(() => global.__pdfDialogOptions);
    expect(path.basename(options.defaultPath)).toBe(
      "PDF _ ACCOUNT_A_確認_.pdf",
    );
    expect(options.filters[0].extensions).toEqual(["pdf"]);
    expect(options.properties).toContain("showOverwriteConfirmation");
    expect(await application.evaluate(() => global.__pdfErrors)).toEqual([]);
    expect(pdfRequestCookies.length).toBe(hits);
    expect((await command(shell, "state")).tabs.some((t) => t.id === aId)).toBe(
      true,
    );
    expect(
      fs.readdirSync(directory).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("PDF cancellation, navigation, closed tabs and failures do not overwrite files or leave partial output", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL } = testServer;

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-pdf-errors-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    await command(shell, "navigate", { url: `${baseURL}/pdf-page?errors` });
    let page = await site(application, "/pdf-page?errors");
    const existing = path.join(directory, "existing.pdf");
    fs.writeFileSync(existing, "original file");
    await captureContextMenus(application);
    await application.evaluate(({ dialog, webContents }, filePath) => {
      global.__pdfErrors = [];
      global.__pdfDialogs = 0;
      global.__pdfPrints = 0;
      dialog.showMessageBox = async (_owner, options) => {
        global.__pdfErrors.push(options.detail);
        return { response: 0 };
      };
      dialog.showSaveDialog = async () => {
        global.__pdfDialogs++;
        return { canceled: true, filePath };
      };
      const contents = webContents
        .getAllWebContents()
        .find((c) => c.getURL().endsWith("/pdf-page?errors"));
      const print = contents.printToPDF.bind(contents);
      contents.printToPDF = (options) => {
        global.__pdfPrints++;
        if (global.__pdfFail)
          return Promise.reject(new Error("Synthetic PDF failure"));
        return print(options);
      };
    }, existing);
    await contextClick(application, page, page.locator("h1"), "save-pdf");
    await expect
      .poll(() => application.evaluate(() => global.__pdfDialogs))
      .toBe(1);
    expect(await application.evaluate(() => global.__pdfPrints)).toBe(0);
    expect(fs.readFileSync(existing, "utf8")).toBe("original file");

    await application.evaluate(({ dialog }) => {
      global.__actionMenu = null;
      dialog.showSaveDialog = () =>
        new Promise((resolve) => {
          global.__pdfResolve = resolve;
        });
    });
    await contextClick(application, page, page.locator("h1"), "save-pdf");
    await expect
      .poll(() => application.evaluate(() => typeof global.__pdfResolve))
      .toBe("function");
    await command(shell, "navigate", { url: `${baseURL}/pdf-page?changed` });
    page = await site(application, "/pdf-page?changed");
    await application.evaluate(
      (_electron, filePath) =>
        global.__pdfResolve({ canceled: false, filePath }),
      existing,
    );
    await expect
      .poll(() => application.evaluate(() => global.__pdfErrors.length))
      .toBe(1);
    expect(await application.evaluate(() => global.__pdfPrints)).toBe(0);
    expect(fs.readFileSync(existing, "utf8")).toBe("original file");

    await application.evaluate(({ dialog }, filePath) => {
      global.__actionMenu = null;
      global.__pdfFail = true;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, existing);
    await contextClick(application, page, page.locator("h1"), "save-pdf");
    await expect
      .poll(() => application.evaluate(() => global.__pdfErrors.length))
      .toBe(2);
    expect(fs.readFileSync(existing, "utf8")).toBe("original file");
    await application.evaluate(
      ({ dialog }, filePath) => {
        global.__actionMenu = null;
        global.__pdfFail = false;
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      },
      path.join(directory, "missing", "unwritable.pdf"),
    );
    await contextClick(application, page, page.locator("h1"), "save-pdf");
    await expect
      .poll(() => application.evaluate(() => global.__pdfErrors.length))
      .toBe(3);
    expect(fs.existsSync(path.join(directory, "missing"))).toBe(false);

    await application.evaluate(({ dialog }) => {
      global.__actionMenu = null;
      global.__pdfResolve = null;
      dialog.showSaveDialog = () =>
        new Promise((resolve) => {
          global.__pdfResolve = resolve;
        });
    });
    await contextClick(application, page, page.locator("h1"), "save-pdf");
    await expect
      .poll(() => application.evaluate(() => typeof global.__pdfResolve))
      .toBe("function");
    const printed = await application.evaluate(() => global.__pdfPrints);
    await command(shell, "close-tab");
    await application.evaluate(
      (_electron, filePath) =>
        global.__pdfResolve({ canceled: false, filePath }),
      existing,
    );
    expect(await application.evaluate(() => global.__pdfPrints)).toBe(printed);
    expect(fs.readFileSync(existing, "utf8")).toBe("original file");
    expect(
      fs.readdirSync(directory).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
