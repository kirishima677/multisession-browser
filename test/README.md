# テストの構成と実行方法

このディレクトリは単体テスト、実Electronでの操作テスト、共通の準備処理に分けています。アプリ本体のコードと保存形式は変更せず、既存の単体36件・操作30件を保っています。

## ディレクトリ

```text
test/
  unit/       計算・検証・保存処理などの単体テスト
  e2e/        実際のアプリを操作する機能別のテスト
  helpers/    Electron起動、HTTPサーバー、画面操作等の共通処理
```

## 全体を実行する

リポジトリのルートで実行します。

```sh
npm run check
npm test
npm run secure:dev
npm run test:e2e
```

`npm test` は `unit/*.test.js` を、`npm run test:e2e` は `e2e/*.spec.js` を実行します。単体テストはファイル間を直列に実行し、従来の実行条件を保ちます。操作テストも `workers: 1` を維持します。ネイティブウィンドウのフォーカス、キーボード、CLI等を扱うため、今回の整理では並列化していません。

操作テストにはログイン中のmacOSデスクトップと、暗号化を利用できる開発用Electronが必要です。`secure:dev` はそのCookie暗号化設定を準備します。OSが鍵へのアクセス確認を求めた場合は、Mac上で確認します。

## 機能を指定して実行する

```sh
node --test test/unit/protection.test.js
node --test test/unit/ui-state.test.js
npm run test:e2e -- api.spec.js
npm run test:e2e -- pdf.spec.js
npm run test:e2e -- --grep 'JWT tools'
npm run test:e2e -- --list
```

| 調べたい内容 | 操作テスト |
|---|---|
| セッション分離、保存・初期化、複数ユーザー | `e2e/sessions.spec.js` |
| URL欄、検索、設定ダイアログ | `e2e/ui.spec.js` |
| タブの順番、分割、選択・ハイライト | `e2e/tabs.spec.js` |
| 右クリック、コピー、貼り付け | `e2e/context-menu.spec.js` |
| 画像保存、Webアーカイブ、印刷、ページ内検索 | `e2e/page-actions.spec.js` |
| PDF出力と失敗時のファイル保護 | `e2e/pdf.spec.js` |
| API送信、認証、メソッド切替、キャンセル | `e2e/api.spec.js` |
| CLI、PTY、終了時のプロセス停止 | `e2e/terminal.spec.js` |
| メモリ、アプリ情報、更新確認 | `e2e/runtime.spec.js` |
| パスキーの非対応処理、JWT、旧Cookieの暗号化移行 | `e2e/authentication.spec.js` |
| Web/API応答の横断検索 | `e2e/network.spec.js` |
| 履歴、ブックマーク | `e2e/browser-library.spec.js` |
| Web/API/CLI混在時の終了・再表示 | `e2e/lifecycle.spec.js` |

単体テストも `model`、`tab-layout`、`api-request`、`protection`、`jwt`、`browser-library`、`browser-ipc`、`worksets`、`ui-state` 等、検証対象に対応する名前のファイルに分けています。

## 共通の準備処理

`helpers/electron.js` のPlaywright fixtureを利用します。

- `testServer`：テストごとに起動するローカルHTTPサーバー。URL、固定応答、合成トークン、リクエストの記録・件数を提供します。
- `browserHarness`：そのテストのサーバーへ接続する `launch(directory, options)` と `site(application, route)` を提供します。
- `command(shell, action, payload)`：管理画面の既存IPC経路を呼び、操作エラーがないことを確認します。

各テストは自分の一時プロファイルを作り、`try/finally` でアプリ終了と削除を行います。再起動、旧版からの移行、ウィンドウだけの終了などを検証するため、起動・終了のタイミングは各シナリオ内に残しています。

HTTPサーバーのカウンターや更新応答はテストごとに新しくなり、別のテストから引き継ぎません。サーバーはfixtureの後処理で終了します。`testServer.releaseFixture` を変更する場合も、そのテストだけに作用します。

`helpers/api.js`、`terminal.js`、`library.js`、`test-tools.js`、`tabs.js`、`context-menu.js` は、繰り返し使う画面の取得・操作・照合をまとめています。`tokens.js` は架空のJWTの生成用です。単体テストでしか使わない小さなfixtureは、その機能のテストファイル内に置いています。

## 通信・データ・クリップボード

アプリデータには必ず専用の一時フォルダを `MSB_USER_DATA` として渡します。通常利用のプロファイルは使いません。更新確認先もローカルHTTPサーバーへ差し替えます。

実際の通信、Cookie、暗号化、WebContents、CLIは既存どおり実物で検証します。ダイアログの応答やクリップボード等の一部はテスト内で置き換え、業務データや利用者のクリップボードに触れないようにしています。テストを通すために送信元認可や暗号化を無効化する設定は加えません。

## スクリーンショットと失敗時の情報

共通の起動画面は、Playwrightがテストごとに用意する出力フォルダの `welcome.png` へ保存します。別のテストの起動画面を上書きしません。機能固有のスクリーンショットやPDF等は、既存の保存先を維持しています。

失敗時はPlaywrightのレポートに表示される `test-results` 内のエラー情報・traceを確認してください。今回の整理では、テスト結果や期待値のスナップショットは更新していません。

## 生成したアプリ・旧版を使う場合

生成したアプリを指定して、同じ操作テストを実行できます。

```sh
MSB_EXECUTABLE="$PWD/dist/v0.7.4/mac-arm64/Multisession Browser.app/Contents/MacOS/Multisession Browser" \
  npm run test:e2e
```

保存セッションを使う操作テストでは、その実行ファイルがOSの暗号化キーを使える状態である必要があります。開発用Electronでの成功と、別署名の生成アプリでの成功は区別します。

旧Cookieの暗号化移行テストは、実際のVer 0.5.0アプリで旧データを作成してから現行版で開きます。旧版が見つからない場合にその1件をスキップする既存条件は維持しています。別の場所に旧版を置いた場合は `MSB_LEGACY_EXECUTABLE` に実行ファイルの絶対パスを指定してください。
