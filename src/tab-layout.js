function reorderIds(ids, id, beforeId = null) {
  if (!ids.includes(id) || (beforeId !== null && !ids.includes(beforeId)))
    throw new Error("タブが見つかりません。");
  if (id === beforeId) return [...ids];
  const next = ids.filter((value) => value !== id);
  next.splice(beforeId === null ? next.length : next.indexOf(beforeId), 0, id);
  return next;
}
function splitForDrop(ids, activeId, split, id, side) {
  if (!ids.includes(id) || !["left", "right"].includes(side))
    throw new Error("分割先が不正です。");
  if (ids.length < 2) throw new Error("分割表示には2つ以上のタブが必要です。");
  const opposite = side === "left" ? "right" : "left";
  if (split) {
    if (split[opposite] === id) return { left: split.right, right: split.left };
    return { ...split, [side]: id };
  }
  const other =
    activeId !== id && ids.includes(activeId)
      ? activeId
      : ids.find((value) => value !== id);
  return { [side]: id, [opposite]: other };
}
function selectInSplit(split, activeId, id) {
  if (!split || Object.values(split).includes(id)) return split;
  return { ...split, [activeId === split.left ? "left" : "right"]: id };
}
module.exports = { reorderIds, splitForDrop, selectInSplit };
