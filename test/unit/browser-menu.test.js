const { test } = require("node:test");
const assert = require("node:assert/strict");
const { browserMenuTemplate } = require("../../src/browser-menu");

test("browser menu exposes history and bookmarks and disables page-only actions for local tool tabs", () => {
  const noOp = () => {};
  const actions = new Proxy({}, { get: () => noOp });
  const items = browserMenuTemplate(
    {
      history: [],
      bookmarks: [],
      bookmarked: false,
      canBookmark: false,
      zoom: 1,
      canZoom: false,
      webPage: false,
      hasTab: true,
    },
    actions,
  );
  assert.ok(items.find((i) => i.id === "history-menu"));
  assert.ok(items.find((i) => i.id === "bookmarks-menu"));
  assert.equal(
    items
      .find((i) => i.id === "bookmarks-menu")
      .submenu.find((i) => i.id === "bookmark-current").enabled,
    false,
  );
  assert.equal(items.find((i) => i.id === "save-page").enabled, false);
  assert.equal(items.find((i) => i.id === "save-pdf").enabled, false);
  assert.equal(
    items.find((i) => i.id === "page-zoom").submenu[0].enabled,
    false,
  );
});
