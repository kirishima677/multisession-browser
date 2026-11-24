const { normalizeURL } = require("./model");

function pageURL(value) {
  try {
    const url = normalizeURL(value);
    return url === "about:blank" ? null : url;
  } catch {
    return null;
  }
}
function downloadableURL(value, kind = "link") {
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol))
      return !url.username && !url.password;
    if (kind !== "link" && url.protocol === "blob:") return true;
    return kind === "image" && /^data:image\//i.test(value);
  } catch {
    return false;
  }
}

// Actions always target the WebContents that emitted the context-menu event.
function contextMenuTemplate(
  contents,
  params,
  {
    clipboard,
    openTab,
    inspect,
    download,
    savePage,
    printPage,
    findPage,
    onError = () => {},
    browserPage = true,
  },
) {
  const items = [];
  const alive = (action) => () => {
    if (contents.isDestroyed()) return;
    contents.focus();
    try {
      return Promise.resolve(action()).catch(onError);
    } catch (error) {
      onError(error);
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
      "paste-plain",
      "書式なしで貼り付け",
      () => contents.pasteAndMatchStyle(),
      Boolean(flags.canPaste),
    );
    add("delete", "削除", () => contents.delete(), Boolean(flags.canDelete));
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
  const selection = params.selectionText?.trim();
  if (browserPage && openTab && selection) {
    const summary =
      selection.length > 24 ? `${selection.slice(0, 24)}…` : selection;
    add(
      "search-selection",
      `「${summary}」をGoogleで検索`,
      () => {
        const url = new URL("https://www.google.com/search");
        url.searchParams.set("q", selection);
        return openTab(url.href);
      },
      selection.length <= 2048,
    );
    separator();
  }
  if (params.linkURL) {
    const url = pageURL(params.linkURL);
    if (openTab && url)
      add("open-link", "リンクを同じセッションの新しいタブで開く", () =>
        openTab(url),
      );
    if (download && downloadableURL(params.linkURL))
      add("save-link", "リンク先を別名で保存…", () =>
        download(params.linkURL, "link"),
      );
    add("copy-link", "リンクのアドレスをコピー", () =>
      clipboard.writeText(params.linkURL),
    );
    separator();
  }
  if (params.mediaType === "image") {
    const url = pageURL(params.srcURL);
    if (openTab && url)
      add("open-image", "画像を同じセッションの新しいタブで開く", () =>
        openTab(url),
      );
    if (download && downloadableURL(params.srcURL, "image"))
      add("save-image", "画像を別名で保存…", () =>
        download(params.srcURL, "image"),
      );
    add(
      "copy-image",
      "画像をコピー",
      () => contents.copyImageAt(params.x, params.y),
      Boolean(params.hasImageContents),
    );
    if (params.srcURL)
      add("copy-image-url", "画像のアドレスをコピー", () =>
        clipboard.writeText(params.srcURL),
      );
    separator();
  }
  if (["video", "audio"].includes(params.mediaType) && params.srcURL) {
    const name = params.mediaType === "video" ? "動画" : "音声";
    if (
      download &&
      params.mediaFlags?.canSave &&
      downloadableURL(params.srcURL, params.mediaType)
    )
      add("save-media", `${name}を別名で保存…`, () =>
        download(params.srcURL, params.mediaType),
      );
    add("copy-media-url", `${name}のアドレスをコピー`, () =>
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
    if (findPage)
      add("find-page", "ページ内を検索…", () => findPage(selection || ""));
    if (savePage)
      add(
        "save-page",
        "ページを別名で保存…",
        savePage,
        Boolean(pageURL(contents.getURL())),
      );
    if (printPage) add("print-page", "印刷…", printPage);
    separator();
    add("inspect", "要素を検証", () => inspect(contents, params.x, params.y));
  }
  if (items.at(-1)?.type === "separator") items.pop();
  return items;
}
module.exports = { contextMenuTemplate, downloadableURL };
