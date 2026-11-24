function browserMenuTemplate(state, actions) {
  const item = (id, label, run, enabled = true) => ({
    id,
    label,
    enabled,
    click: run,
  });
  const history = state.history.map((entry, i) =>
    item(
      `recent-history-${i}`,
      `${entry.sessionName} / ${entry.title.slice(0, 60)}`,
      () => actions.openEntry("history", entry.id),
    ),
  );
  const bookmarks = state.bookmarks.map((entry, i) =>
    item(
      `recent-bookmark-${i}`,
      `${entry.sessionName} / ${entry.title.slice(0, 60)}`,
      () => actions.openEntry("bookmarks", entry.id),
    ),
  );
  return [
    item("new-web-tab", "新しいタブ", () => actions.shortcut("new-tab")),
    item("new-api-tab", "新しいAPIタブ", () => actions.shortcut("new-api-tab")),
    item("new-cli-tab", "新しいCLIタブ", () =>
      actions.shortcut("new-terminal-tab"),
    ),
    { type: "separator" },
    {
      id: "history-menu",
      label: "履歴",
      submenu: [
        item("show-history", "履歴をすべて表示…", () =>
          actions.openLibrary("history"),
        ),
        { type: "separator" },
        ...(history.length
          ? history
          : [item("empty-history", "履歴はありません", () => {}, false)]),
      ],
    },
    {
      id: "bookmarks-menu",
      label: "ブックマーク",
      submenu: [
        item(
          "bookmark-current",
          state.bookmarked
            ? "このページのブックマークを編集…"
            : "このページをブックマーク…",
          () => actions.shortcut("bookmark-page"),
          state.canBookmark,
        ),
        item("show-bookmarks", "ブックマークを管理…", () =>
          actions.openLibrary("bookmarks"),
        ),
        { type: "separator" },
        ...(bookmarks.length
          ? bookmarks
          : [
              item(
                "empty-bookmarks",
                "ブックマークはありません",
                () => {},
                false,
              ),
            ]),
      ],
    },
    { type: "separator" },
    {
      id: "page-zoom",
      label: `ページのズーム（${Math.round(state.zoom * 100)}%）`,
      submenu: [
        item(
          "zoom-out",
          "縮小",
          () => actions.zoom("out"),
          state.canZoom && state.zoom > 0.25,
        ),
        item(
          "zoom-reset",
          "標準サイズ（100%）",
          () => actions.zoom("reset"),
          state.canZoom,
        ),
        item(
          "zoom-in",
          "拡大",
          () => actions.zoom("in"),
          state.canZoom && state.zoom < 5,
        ),
      ],
    },
    item("find-page", "ページ内を検索…", actions.find, state.webPage),
    item("save-page", "ページを保存…", actions.save, state.webPage),
    item("print-page", "印刷…", actions.print, state.webPage),
    item("fullscreen", "全画面表示を切り替え", actions.fullscreen),
    { type: "separator" },
    {
      id: "testing-tools",
      label: "テスト用ツール",
      submenu: [
        item("auth-tools", "JWT・トークン…", () => actions.tools("auth")),
        item("response-tools", "応答検索…", () => actions.tools("network")),
        item("devtools", "DevTools", actions.devtools, state.hasTab),
      ],
    },
    item("save-workset", "構成を保存…", () => actions.shortcut("save-workset")),
    item("app-settings", "アプリ情報・設定…", () =>
      actions.shortcut("app-info"),
    ),
    item("check-updates", "アップデートを確認…", actions.checkUpdates),
    { type: "separator" },
    item("quit-app", "Multisession Browserを終了", actions.quit),
  ];
}
module.exports = { browserMenuTemplate };
