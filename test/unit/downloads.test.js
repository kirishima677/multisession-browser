const { test } = require("node:test");
const assert = require("node:assert/strict");
const { downloadableURL } = require("../../src/context-menu");

test("downloads reject privileged protocols and restrict inline resources to media", () => {
  assert.equal(
    downloadableURL("https://example.com/picture.png", "image"),
    true,
  );
  assert.equal(downloadableURL("data:image/png;base64,AA==", "image"), true);
  assert.equal(downloadableURL("blob:https://example.com/id", "image"), true);
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:secret@example.com/image",
    "data:text/html,<script>x</script>",
  ])
    assert.equal(downloadableURL(url, "image"), false);
  assert.equal(downloadableURL("blob:https://example.com/id", "link"), false);
});
