const { test, expect, command } = require("../helpers/electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { sampleJWT } = require("../helpers/tokens");
const {
  toolsPage,
  toolCommand,
  interceptClipboard,
  cookieDB,
  storedCookie,
} = require("../helpers/test-tools");

test("unsupported WebAuthn settles promptly, reports its limitation and leaves other credentials untouched", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL } = testServer;

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-passkey-"));
  let application;
  try {
    const launched = await launch(directory);
    application = launched.application;
    const shell = launched.shell;
    await command(shell, "navigate", { url: `${baseURL}/passkeys` });
    const page = await site(application, "/passkeys");
    expect(
      await page.evaluate(() =>
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
      ),
    ).toBe(false);
    // Background conditional autofill must not interrupt the user with a banner.
    const conditional = await page.evaluate(async () => {
      try {
        await navigator.credentials.get({
          publicKey: { challenge: new Uint8Array(32) },
          mediation: "conditional",
        });
      } catch (error) {
        return error.name;
      }
    });
    expect(conditional).toBe("NotAllowedError");
    expect((await command(shell, "state")).tabs[0].authNotice).toBe(false);
    for (const method of ["get", "create"]) {
      const result = await page.evaluate(async (method) => {
        return Promise.race([
          navigator.credentials[method]({
            publicKey: { challenge: new Uint8Array(32) },
          }).then(
            () => ({ success: true }),
            (error) => ({ name: error.name, message: error.message }),
          ),
          new Promise((resolve) =>
            setTimeout(() => resolve({ name: "Hung" }), 1500),
          ),
        ]);
      }, method);
      expect(result.name).toBe("NotAllowedError");
      expect(result.message).toContain("Choose another sign-in method");
    }
    await expect(
      shell.getByText(/このビルドはパスキー非対応です/),
    ).toBeVisible();
    expect(await page.evaluate(() => typeof window.browserAPI)).toBe(
      "undefined",
    );
    const normal = await page.evaluate(async () => {
      try {
        return await navigator.credentials.get({ password: true });
      } catch (error) {
        return { name: error.name, message: error.message };
      }
    });
    expect(normal?.message || "").not.toContain("Multisession Browser");
    await shell.getByRole("button", { name: "パスキーの案内を閉じる" }).click();
    await expect(
      shell.getByText(/このビルドはパスキー非対応です/),
    ).not.toBeVisible();
    // OAuth child windows must receive the same fail-fast behavior.
    const popupPromise = application.waitForEvent("window");
    await page.evaluate(
      (url) => window.open(url, "auth"),
      `${baseURL}/passkey-popup`,
    );
    const popup = await popupPromise;
    await popup.waitForLoadState();
    expect(
      await popup.evaluate(async () => {
        try {
          await navigator.credentials.get({
            publicKey: { challenge: new Uint8Array(32) },
          });
        } catch (error) {
          return error.name;
        }
      }),
    ).toBe("NotAllowedError");
    await expect(
      shell.getByText(/このビルドはパスキー非対応です/),
    ).toBeVisible();
    await popup.close();
    await command(shell, "navigate", { url: `${baseURL}/after-auth` });
    await site(application, "/after-auth");
    await expect(
      shell.getByText(/このビルドはパスキー非対応です/),
    ).not.toBeVisible();
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("JWT tools select HttpOnly candidates by contents, copy the current value and encrypt manual tokens across restarts", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL, tokenA, tokenB } = testServer;

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "msb-auth-tools-"));
  let application;
  const manualToken = sampleJWT({
    alumni_id: 303,
    company_name: "手入力テナント",
    exp: Math.floor(Date.now() / 1000) - 60,
  });
  try {
    let launched = await launch(directory);
    application = launched.application;
    let shell = launched.shell;
    const initial = await command(shell, "state"),
      a = initial.sessions[0],
      b = initial.sessions[1];
    expect(initial.protection.persistentAllowed).toBe(true);
    await command(shell, "navigate", { url: `${baseURL}/tokens/login` });
    let browser = await site(application, "/tokens/login");
    expect(await browser.evaluate(() => document.cookie)).not.toContain(
      "access_token",
    );
    await shell.locator("#open-auth").click();
    let tools = await toolsPage(application);
    await expect
      .poll(
        async () =>
          (
            await toolCommand(tools, "auth-list", {
              sessionId: a.id,
              url: `${baseURL}/tokens/login`,
            })
          ).candidates.length,
      )
      .toBe(1);
    await expect(tools.locator("#candidate")).toContainText("access_token");
    const candidates = await toolCommand(tools, "auth-list", {
      sessionId: a.id,
      url: `${baseURL}/tokens/login`,
    });
    expect(candidates.candidates[0].info.claims.alumni_id).toBe(101);
    expect(candidates.candidates[0].preview).not.toBe(tokenA);
    await tools
      .locator("#candidate")
      .selectOption(candidates.candidates[0].key);
    await expect(tools.locator("#copy-token")).toBeEnabled();
    await interceptClipboard(application);
    await tools.locator("#copy-token").click();
    expect(await application.evaluate(() => globalThis.testClipboard)).toBe(
      tokenA,
    );
    await browser.evaluate(() => fetch("/tokens/refresh"));
    await tools.locator("#copy-token").click();
    expect(await application.evaluate(() => globalThis.testClipboard)).toBe(
      tokenB,
    );
    await tools.locator("#copy-cookie").click();
    expect(await application.evaluate(() => globalThis.testClipboard)).toBe(
      `access_token=${tokenB}`,
    );
    const other = await toolCommand(tools, "auth-list", {
      sessionId: b.id,
      url: `${baseURL}/tokens/login`,
    });
    expect(other.candidates).toEqual([]);
    await expect
      .poll(async () =>
        (await command(shell, "state")).auth.some((s) =>
          s.summary.includes("202"),
        ),
      )
      .toBe(true);
    await tools.locator("#manual-value").fill(manualToken);
    await tools.locator("#manual-save").check();
    await tools.locator("#manual-apply").click();
    await expect(tools.locator("#candidate-meta")).toContainText(
      "暗号化して保存済み",
    );
    await expect(tools.locator("#candidate-meta")).toContainText("期限切れ");
    await tools.locator("#reveal-token").click();
    await expect(tools.locator("#token-visible")).toHaveValue(manualToken);
    expect(
      fs.readFileSync(path.join(directory, "tokens.enc.json"), "utf8"),
    ).not.toContain(manualToken);
    expect(
      fs.readFileSync(path.join(directory, "workspace.json"), "utf8"),
    ).not.toContain(manualToken);
    expect(
      await tools.evaluate(() => [
        typeof require,
        typeof browserAPI,
        typeof apiClient,
        typeof terminalAPI,
      ]),
    ).toEqual(["undefined", "undefined", "undefined", "undefined"]);
    await tools.screenshot({ path: "test-results/jwt-tools.png" });
    await application.close();
    application = null;
    const db = storedCookie(cookieDB(directory, a.id), "access_token");
    expect(db.value).toBe("");
    expect(db.encryptedBytes).toBeGreaterThan(0);
    launched = await launch(directory);
    application = launched.application;
    shell = launched.shell;
    await command(shell, "open-test-tools", { page: "auth", sessionId: a.id });
    tools = await toolsPage(application);
    await expect(tools.locator("#candidate-meta")).toContainText(
      "暗号化して保存済み",
    );
    await tools.locator("#reveal-token").click();
    await expect(tools.locator("#token-visible")).toHaveValue(manualToken);
    await tools.locator("#manual-save").uncheck();
    await tools.locator("#manual-value").fill("opaque-manual-only");
    await tools.locator("#manual-apply").click();
    await expect(tools.locator("#candidate-meta")).toContainText(
      "この起動中のみ",
    );
    expect(
      fs.readFileSync(path.join(directory, "tokens.enc.json"), "utf8"),
    ).not.toContain("opaque-manual-only");
    const all = await toolCommand(tools, "auth-list", {
      sessionId: a.id,
      url: `${baseURL}/tokens/login`,
      all: true,
    });
    expect(all.candidates.some((c) => c.name === "opaque")).toBe(true);
    await command(shell, "edit-session", {
      id: b.id,
      name: "更新したセッションB",
      color: b.color,
    });
    await expect(tools.locator("#auth-session")).toContainText(
      "更新したセッションB",
    );
    await command(shell, "delete-session", { id: b.id });
    await expect(tools.locator("#auth-session")).not.toContainText(
      "更新したセッションB",
    );
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("existing plaintext Cookie sessions migrate to encrypted storage while retaining logins and site storage", async ({
  browserHarness,
  testServer,
}) => {
  const { launch, site } = browserHarness;
  const { baseURL, tokenA } = testServer;

  const legacy =
    process.env.MSB_LEGACY_EXECUTABLE ||
    "/Users/nishiokahiroki/code/multisession-browser/dist/v0.5.0/mac-arm64/Multisession Browser.app/Contents/MacOS/Multisession Browser";
  test.skip(
    !fs.existsSync(legacy),
    "Ver 0.5.0 executable is required to create a genuine legacy profile.",
  );
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "msb-cookie-upgrade-"),
  );
  let application;
  try {
    let launched = await launch(directory, { executablePath: legacy });
    application = launched.application;
    let shell = launched.shell;
    const a = (await command(shell, "state")).sessions[0];
    await command(shell, "navigate", { url: `${baseURL}/tokens/login` });
    let browser = await site(application, "/tokens/login");
    await browser.evaluate(() =>
      localStorage.setItem("migration-data", "retain-this"),
    );
    await application.close();
    application = null;
    const file = cookieDB(directory, a.id),
      before = storedCookie(file, "access_token");
    expect(before.value).toBe(tokenA);
    expect(before.encryptedBytes).toBe(0);
    launched = await launch(directory);
    application = launched.application;
    shell = launched.shell;
    const security = (await command(shell, "state")).protection;
    expect(security.cookieEncryption).toBe(true);
    expect(security.persistentAllowed).toBe(true);
    expect(security.migratedCookies).toBeGreaterThan(0);
    await command(shell, "navigate", { url: `${baseURL}/migration-check` });
    browser = await site(application, "/migration-check");
    expect(
      await browser.evaluate(() => localStorage.getItem("migration-data")),
    ).toBe("retain-this");
    expect(
      await browser.evaluate(() =>
        fetch("/test-api/echo")
          .then((r) => r.json())
          .then((r) => r.cookies),
      ),
    ).toContain(`access_token=${tokenA}`);
    await application.close();
    application = null;
    const after = storedCookie(file, "access_token");
    expect(after.value).toBe("");
    expect(after.encryptedBytes).toBeGreaterThan(0);
    launched = await launch(directory);
    application = launched.application;
    shell = launched.shell;
    await command(shell, "navigate", { url: `${baseURL}/migration-restart` });
    browser = await site(application, "/migration-restart");
    expect(
      await browser.evaluate(() =>
        fetch("/test-api/echo")
          .then((r) => r.json())
          .then((r) => r.cookies),
      ),
    ).toContain(`access_token=${tokenA}`);
  } finally {
    if (application) await application.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
