const { test } = require("node:test");
const assert = require("node:assert/strict");

test("renderer state rejects stale snapshots while allowing equal-revision redraws after dragging", async () => {
  const { createUIState } = await import("../../src/ui/state.mjs");
  const ui = createUIState();
  const old = {
    revision: 1,
    activeId: "left",
    tabs: [{ id: "left" }, { id: "right" }],
    split: { left: "left", right: "right" },
  };
  const current = { ...old, revision: 2, activeId: "right" };
  assert.equal(ui.accept(old), true);
  assert.equal(ui.accept(current), true);
  assert.equal(ui.accept(old), false);
  assert.equal(ui.get(), current);
  assert.equal(ui.activeTab().id, "right");
  const redraw = { ...current };
  assert.equal(ui.accept(redraw), true);
  assert.equal(ui.get(), redraw);
  assert.deepEqual(old, {
    revision: 1,
    activeId: "left",
    tabs: [{ id: "left" }, { id: "right" }],
    split: { left: "left", right: "right" },
  });
});

test("renderer runtime notifications preserve selection, tab references, revision and edit errors", async () => {
  const { createUIState } = await import("../../src/ui/state.mjs");
  const ui = createUIState();
  assert.equal(ui.mergeRuntime({ memory: { bytes: 1 } }), false);
  assert.equal(ui.get(), undefined);
  const initial = {
    revision: 5,
    activeId: "a",
    tabs: [{ id: "a", url: "https://example.test/" }],
    sessions: [{ id: "session" }],
    split: null,
    draggingTab: true,
    memory: { bytes: 10 },
  };
  ui.accept(initial);
  ui.setError("fixture edit error");
  const memory = { bytes: 20 };
  assert.equal(ui.mergeRuntime({ memory }), true);
  assert.equal(ui.get().tabs, initial.tabs);
  assert.equal(ui.get().sessions, initial.sessions);
  assert.equal(ui.get().activeId, "a");
  assert.equal(ui.get().revision, 5);
  assert.equal(ui.get().draggingTab, true);
  assert.equal(ui.get().memory, memory);
  assert.equal(initial.memory.bytes, 10);
  assert.equal(ui.getError(), "fixture edit error");
  assert.equal(ui.accept({ ...initial, revision: 4 }), false);
  assert.equal(ui.get().memory, memory);
});
