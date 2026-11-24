const { normalizeURL } = require("./model");

// Build actions for the originating WebContents, including background tabs/popups.
function contextMenuTemplate(
  contents,
  params,
  { clipboard, openTab, inspect, browserPage = true },
) {
  const items = [];
  const alive = (action) => () => {
    if (!contents.isDestroyed()) {
      contents.focus();
      action();
    }
  };
  const add = (id, label, action, enabled = true) =>
    items.push({ id, label, enabled, click: alive(action) });
  const separator = () => {
    if (items.length && items.at(-1).type !== "separator")
      items.push({ type: "separator" });
  };
  const flags = params.editFlags || {};
  if (params.isEditable) {
    add("undo", "元に戻す", () => contents.undo(), Boolean(flags.canUndo));
    add("redo", "やり直す", () => contents.redo(), Boolean(flags.canRedo));
    separator();
    add("cut", "切り取り", () => contents.cut(), Boolean(flags.canCut));
    add("copy", "コピー", () => contents.copy(), Boolean(flags.canCopy));
    add("paste", "貼り付け", () => contents.paste(), Boolean(flags.canPaste));
    add(
      "select-all",
      "すべて選択",
      () => contents.selectAll(),
      Boolean(flags.canSelectAll),
    );
    separator();
  } else if (params.selectionText) {
    add("copy", "コピー", () => contents.copy(), Boolean(flags.canCopy));
    separator();
  }
  if (params.linkURL) {
    let url;
    try {
      url = normalizeURL(params.linkURL);
    } catch {
      /* Copy non-HTTP links without executing them. */
    }
    if (openTab && url && url !== "about:blank")
      add("open-link", "リンクを同じセッションの新しいタブで開く", () =>
        openTab(url),
      );
    add("copy-link", "リンクのアドレスをコピー", () =>
      clipboard.writeText(params.linkURL),
    );
    separator();
  }
  if (params.mediaType === "image" && params.hasImageContents) {
    add("copy-image", "画像をコピー", () =>
      contents.copyImageAt(params.x, params.y),
    );
    if (params.srcURL)
      add("copy-image-url", "画像のアドレスをコピー", () =>
        clipboard.writeText(params.srcURL),
      );
    separator();
  }
  if (browserPage) {
    add(
      "back",
      "戻る",
      () => contents.navigationHistory.goBack(),
      contents.navigationHistory.canGoBack(),
    );
    add(
      "forward",
      "進む",
      () => contents.navigationHistory.goForward(),
      contents.navigationHistory.canGoForward(),
    );
    add("reload", "再読み込み", () => contents.reload());
    add("copy-page-url", "ページのURLをコピー", () =>
      clipboard.writeText(contents.getURL()),
    );
    separator();
    add("inspect", "要素を検証", () => inspect(contents, params.x, params.y));
  }
  if (items.at(-1)?.type === "separator") items.pop();
  return items;
}
module.exports = { contextMenuTemplate };
