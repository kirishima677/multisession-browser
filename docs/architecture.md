# 構成と開発上の注意

```text
BrowserWindow（管理UI / ローカルHTML）
  ├─ preload.js → 入力と送信元を検証するIPC → main.js
  └─ WebContentsView（タブごとの任意サイト / preloadなし）
       └─ Session（セッションIDから生成するpartition）
            ├─ 保存：persist:msb-<UUID>
            └─ 一時：msb-<起動ID>-<世代>-<UUID>
```

- `src/main.js`：ウィンドウ・タブ・Session・IPC・ネイティブメニュー。
- `src/preload.js`：管理UIだけに公開するIPCブリッジ。
- `src/model.js`：URLと設定の検証、partition識別子、原子的な設定保存。
- `src/index.html` / `styles.css` / `renderer.js`：ビルド不要の管理画面。
- `test/unit.test.js`：URL・partition・設定ファイルの検証。
- `test/browser.spec.js`：実Electronとローカルサーバーでの統合テスト。

## 画面レイアウト

左236pxはセッション一覧、上152pxはタイトル・タブ・URLバー、下28pxは状態表示。残りを選択中のWebContentsViewに割り当てる。非選択タブはビューを非表示にし、ページは存続させる。ダイアログ表示中はWebContentsViewをすべて隠し、ネイティブビューがHTMLダイアログを覆わないようにする。

HTMLとメイン側のレイアウト寸法を変更する場合、両方を更新すること。

## macOSライフサイクル

ウィンドウを閉じる際は、WebContentsViewのWebContentsも明示的に閉じる。Macではアプリ自体は残り、activateイベントで新しいウィンドウを作る。終了するまでは一時セッションも存続し得る。作業セットの復元では一時データを明示的に消去し、世代を変えて再作成する。

## テスト方針

E2Eは一時ディレクトリを `MSB_USER_DATA` に指定する。通常利用のアプリデータには触れない。確認ダイアログだけをテストプロセスから承認するよう置き換え、HTTP通信、Cookie、ストレージ、ネイティブDevTools、ウィンドウは実物で検証する。

追加で実機確認する項目：

- 対象サイトのSSOと認証ポップアップ完了後の画面更新。
- ファイルダウンロード・保存先選択・キャンセル。
- カメラ・マイク等の許可・拒否。
- エラー証明書の拒否、通信断後の再読み込み。
- Intel Mac上での起動と表示。

## 配布

electron-builderでmacOS向け `.app` / ZIP / DMGを作成する。ローカル開発ビルドはDeveloper ID署名・公証なし。正式配布では自分のApple Developerアカウントによる署名と公証を設定する。

`minimatch` はビルド依存の脆弱性を回避するため11.0.9にoverrideしている。ビルドツール更新時に依存関係を見直すこと。

## 参照

- [Electron Session](https://www.electronjs.org/docs/latest/api/session)
- [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [WebContents](https://www.electronjs.org/docs/latest/api/web-contents)
- [Electronのセキュリティ](https://www.electronjs.org/docs/latest/tutorial/security)
