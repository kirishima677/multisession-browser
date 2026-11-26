import { $, el, button, field } from "./dom.mjs";

export function createDialogs({
  getState,
  activeTab,
  invoke,
  modal,
  renderRuntime,
  setError,
}) {
  let selectedColor;
  function sessionSelect(parent, currentId) {
    const caption = el("label", "", "使用するセッション");
    caption.htmlFor = "session-choice";
    const select = el("select");
    select.id = "session-choice";
    for (const s of getState().sessions) {
      const option = el(
        "option",
        "",
        `${s.name}（${s.persistent ? "保存" : "一時"}）`,
      );
      option.value = s.id;
      select.append(option);
    }
    select.value = currentId || getState().sessions[0].id;
    parent.append(caption, select);
    return select;
  }
  function sessionModal(profile) {
    let name, persistent;
    selectedColor =
      profile?.color ||
      getState().colors[getState().sessions.length % getState().colors.length];
    modal.show(
      profile ? "セッションの設定" : "新しいセッション",
      profile ? "変更を保存" : "作成して開く",
      (body) => {
        name = field(
          body,
          "セッション名",
          profile?.name || "",
          "例：A社 a1、運営、未ログイン",
        );
        body.append(el("label", "", "識別色"));
        const colors = el("div", "colors");
        colors.setAttribute("role", "radiogroup");
        colors.setAttribute("aria-label", "識別色");
        for (const color of getState().colors) {
          const option = button(
            "",
            "color-option",
            () => {
              selectedColor = color;
              for (const child of colors.children)
                child.setAttribute("aria-checked", String(child === option));
            },
            color,
          );
          option.style.setProperty("--color", color);
          option.setAttribute("role", "radio");
          option.setAttribute("aria-checked", String(color === selectedColor));
          colors.append(option);
        }
        body.append(colors);
        if (!profile) {
          const check = el("label", "check-label");
          persistent = el("input");
          persistent.type = "checkbox";
          persistent.checked = true;
          check.append(
            persistent,
            document.createTextNode("終了後もログイン状態を保存する"),
          );
          body.append(check);
          body.append(
            el(
              "p",
              "help",
              "チェックを外すと一時セッションになります。アプリを終了すると状態がリセットされます。",
            ),
          );
        } else {
          body.append(
            el(
              "p",
              "help",
              `${profile.persistent ? "保存" : "一時"}セッションです。種類を変える場合は新しく作成してください。`,
            ),
          );
          const actions = el("div", "danger-actions");
          actions.append(
            button("保存データを初期化", "", async () => {
              const result = await invoke("reset-session", { id: profile.id });
              if (result) modal.close();
            }),
            button("セッションを削除", "", async () => {
              const result = await invoke("delete-session", { id: profile.id });
              if (result) modal.close();
            }),
          );
          body.append(actions);
        }
      },
      async () =>
        invoke(profile ? "edit-session" : "create-session", {
          id: profile?.id,
          name: name.value,
          persistent: persistent?.checked,
          color: selectedColor,
        }),
    );
  }
  function newTabModal(copyURL = false, initialKind = "web") {
    let select, kindSelect;
    const source = activeTab();
    const url = copyURL ? activeTab()?.url : "about:blank";
    modal.show(
      copyURL
        ? source?.kind === "api"
          ? "APIを別セッションに複製"
          : "別セッションで開く"
        : "新しいタブ",
      "タブを開く",
      (body) => {
        select = sessionSelect(body, activeTab()?.sessionId);
        if (!copyURL) {
          const caption = el("label", "", "タブの種類");
          caption.htmlFor = "tab-kind";
          kindSelect = el("select");
          kindSelect.id = "tab-kind";
          for (const [value, text] of [
            ["web", "Webページ"],
            ["api", "APIクライアント"],
            ["terminal", "CLI・ターミナル"],
          ]) {
            const option = el("option", "", text);
            option.value = value;
            kindSelect.append(option);
          }
          kindSelect.value = initialKind;
          body.append(caption, kindSelect);
        }
        body.append(
          el(
            "p",
            "help",
            copyURL
              ? source?.kind === "api"
                ? "選択したセッションへ定義を複製します。Bearerと認証系ヘッダーは引き継ぎません。"
                : "選択したセッションで現在のURLを開きます。入力内容は引き継ぎません。"
              : "同じセッションのタブはログイン状態を共有します。",
          ),
        );
      },
      () =>
        copyURL && source?.kind === "api"
          ? invoke("duplicate-api-tab", {
              id: source.id,
              sessionId: select.value,
            })
          : invoke(
              !copyURL && kindSelect.value === "terminal"
                ? "create-terminal-tab"
                : !copyURL && kindSelect.value === "api"
                  ? "create-api-tab"
                  : "create-tab",
              {
                sessionId: select.value,
                ...(!copyURL && ["api", "terminal"].includes(kindSelect.value)
                  ? {}
                  : { url }),
              },
            ),
    );
  }
  function saveWorksetModal() {
    let name, mode, existing;
    modal.show(
      "タブ構成を保存",
      "作業セットを保存",
      (body) => {
        const caption = el("label", "", "保存方法");
        caption.htmlFor = "save-mode";
        mode = el("select");
        mode.id = "save-mode";
        for (const [value, text] of [
          ["new", "新規追加"],
          ["overwrite", "既存の構成を上書き"],
        ]) {
          const option = el("option", "", text);
          option.value = value;
          option.disabled =
            value === "overwrite" && !getState().worksets.length;
          mode.append(option);
        }
        const targetLabel = el("label", "", "上書きする構成");
        targetLabel.htmlFor = "save-target";
        existing = el("select");
        existing.id = "save-target";
        for (const w of getState().worksets) {
          const option = el("option", "", w.name);
          option.value = w.id;
          existing.append(option);
        }
        body.append(caption, mode, targetLabel, existing);
        name = field(body, "作業セット名", "", "例：メッセージ機能テスト");
        const update = () => {
          const overwrite = mode.value === "overwrite";
          targetLabel.hidden = existing.hidden = !overwrite;
          if (overwrite)
            name.value =
              getState().worksets.find((w) => w.id === existing.value)?.name ||
              "";
        };
        mode.addEventListener("change", update);
        existing.addEventListener("change", update);
        update();
        body.append(
          el(
            "p",
            "help",
            `${getState().tabs.length}個のタブの順番・セッション・WebのURL・API定義・CLIの起動フォルダを保存します。Bearerと認証系ヘッダーは除外します。URLや本文の機密値は保存対象です。CLIの入力・出力は保存せず、復元後の起動は手動です。`,
          ),
        );
      },
      () =>
        invoke("save-workset", {
          name: name.value,
          ...(mode.value === "overwrite" ? { id: existing.value } : {}),
        }),
    );
  }
  function appInfoModal() {
    let memory, startup;
    modal.show(
      "アプリ情報・設定",
      "設定を保存",
      (body) => {
        body.append(
          el(
            "p",
            "app-version",
            `Multisession Browser v${getState().appInfo.version}`,
          ),
          el(
            "p",
            "help",
            `Electron ${getState().appInfo.electron} / Chromium ${getState().appInfo.chromium} / macOS ${getState().appInfo.arch}`,
          ),
        );
        const measured = el("p", "help");
        measured.id = "runtime-memory";
        const protectedInfo = el("p", "help");
        protectedInfo.id = "storage-protection";
        body.append(measured, protectedInfo);
        memory = field(
          body,
          "メモリ警告（MiB、0で無効）",
          String(getState().preferences.memoryWarningMiB),
        );
        memory.type = "number";
        memory.min = "0";
        memory.max = "65536";
        const caption = el("label", "checkbox-label");
        startup = el("input");
        startup.type = "checkbox";
        startup.checked = getState().preferences.checkUpdatesOnStartup;
        startup.id = "startup-update";
        caption.append(
          startup,
          document.createTextNode("起動時にアップデートを確認する"),
        );
        body.append(caption);
        const message = el("p", "help");
        message.id = "update-message";
        const check = button("今すぐ更新を確認", "", () =>
          invoke("check-updates"),
        );
        check.id = "check-updates";
        const open = button("リリースを開く", "", () => invoke("open-update"));
        open.id = "settings-open-update";
        body.append(
          message,
          check,
          open,
          el(
            "p",
            "help",
            "GitHub Releasesの安定版と比較します。更新のダウンロード・置き換えは手動です。",
          ),
        );
        renderRuntime();
      },
      () =>
        invoke("set-preferences", {
          memoryWarningMiB: Number(memory.value),
          checkUpdatesOnStartup: startup.checked,
        }),
    );
  }
  async function bookmarkModal() {
    const snapshot = await invoke("state"),
      page = snapshot?.pageDetails;
    if (!page) {
      const message = "Webページを開いてからブックマークしてください。";
      setError(message);
      $("#error").textContent = message;
      return;
    }
    const existing = page.bookmark;
    let name, url, profile;
    modal.show(
      existing ? "ブックマークを編集" : "ブックマークを追加",
      "保存",
      (body) => {
        name = field(body, "ブックマーク名", existing?.title || page.title);
        name.maxLength = 200;
        url = field(body, "ブックマークURL", existing?.url || page.url);
        url.maxLength = 16384;
        url.type = "url";
        profile = sessionSelect(body, existing?.sessionId || page.sessionId);
        body.append(
          el(
            "p",
            "help",
            getState().browserLibrary?.writable
              ? "登録したセッションの新しいタブで開きます。ブックマークは暗号化して保存します。"
              : "暗号化した保存が利用できないため、この起動中のみ保持します。",
          ),
        );
      },
      () =>
        invoke("save-bookmark", {
          id: existing?.id,
          title: name.value,
          url: url.value,
          sessionId: profile.value,
        }),
    );
  }
  return {
    sessionModal,
    newTabModal,
    saveWorksetModal,
    appInfoModal,
    bookmarkModal,
  };
}
