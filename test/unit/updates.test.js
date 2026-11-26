const { test } = require("node:test");
const assert = require("node:assert/strict");
const { compareVersions } = require("../../src/runtime-model");
const { releaseURL, createUpdateChecker } = require("../../src/updates");

test("release comparison uses numeric stable versions and trusted release links", () => {
  assert.equal(compareVersions("v0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("v0.5.0", "0.5.0"), 0);
  assert.equal(compareVersions("0.4.9", "0.5.0"), -1);
  for (const value of ["v1.0", "1.0.0-beta", "01.2.3", "garbage"])
    assert.throws(() => compareVersions(value, "0.5.0"));
  assert.ok(
    releaseURL(
      "https://github.com/kirishima677/multisession-browser/releases/tag/v0.5.0",
    ),
  );
  assert.equal(
    releaseURL(
      "https://github.com.evil.test/kirishima677/multisession-browser/releases/latest",
    ),
    null,
  );
  assert.equal(releaseURL("file:///tmp/update"), null);
});

test("update checks distinguish available, current, missing and invalid releases", async () => {
  const http = require("node:http");
  let status = 200,
    body = {
      tag_name: "v0.6.0",
      html_url:
        "https://github.com/kirishima677/multisession-browser/releases/tag/v0.6.0",
    };
  const server = http.createServer((_req, res) => {
    res.writeHead(status);
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const checker = createUpdateChecker({
      version: "0.5.0",
      url: `http://127.0.0.1:${server.address().port}`,
      publish: () => {},
    });
    await checker.check();
    assert.equal(checker.get().status, "available");
    body.tag_name = "v0.5.0";
    await checker.check();
    assert.equal(checker.get().status, "current");
    body.tag_name = "not-a-version";
    await checker.check();
    assert.equal(checker.get().status, "error");
    assert.equal(checker.openURL(), "");
    status = 404;
    await checker.check();
    assert.equal(checker.get().status, "no-release");
    status = 503;
    await checker.check();
    assert.equal(checker.get().status, "error");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
