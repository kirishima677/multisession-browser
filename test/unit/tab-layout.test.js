const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  reorderIds,
  splitForDrop,
  selectInSplit,
} = require("../../src/tab-layout");

test("moving tabs preserves all IDs and handles both directions and invalid targets", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(reorderIds(ids, "a", null), ["b", "c", "a"]);
  assert.deepEqual(reorderIds(ids, "c", "a"), ["c", "a", "b"]);
  assert.deepEqual(reorderIds(ids, "b", "b"), ids);
  assert.throws(() => reorderIds(ids, "missing", "a"));
  assert.throws(() => reorderIds(ids, "a", "missing"));
  assert.deepEqual(ids, ["a", "b", "c"]);
});

test("split drops preserve the opposite pane, swap existing panes and require two tabs", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(splitForDrop(ids, "a", null, "b", "right"), {
    left: "a",
    right: "b",
  });
  assert.deepEqual(splitForDrop(ids, "a", null, "a", "left"), {
    left: "a",
    right: "b",
  });
  assert.deepEqual(
    splitForDrop(ids, "a", { left: "a", right: "b" }, "b", "left"),
    { left: "b", right: "a" },
  );
  assert.deepEqual(
    splitForDrop(ids, "a", { left: "a", right: "b" }, "c", "right"),
    { left: "a", right: "c" },
  );
  assert.throws(() => splitForDrop(["a"], "a", null, "a", "left"));
  assert.throws(() => splitForDrop(ids, "a", null, "b", "top"));
});

test("selecting a hidden tab replaces only the active pane", () => {
  const split = { left: "a", right: "b" };
  assert.deepEqual(selectInSplit(split, "a", "c"), { left: "c", right: "b" });
  assert.deepEqual(selectInSplit(split, "b", "c"), { left: "a", right: "c" });
  assert.deepEqual(selectInSplit(split, "a", "b"), split);
  assert.equal(selectInSplit(null, "a", "c"), null);
});
