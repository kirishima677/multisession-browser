# 検証記録

## Ver 0.1.1（2026-11-24）

同じmacOS / Apple Silicon環境で実施。

- `npm run check`：成功。
- `npm test`：5件成功。
- 開発版E2E：5件成功。
- `dist/v0.1.1/mac-arm64/Multisession Browser.app` の生成：成功。
- 生成したアプリのE2E：5件成功。
- `git diff --check`：成功。

追加で確認した内容：

- 実際の右クリックイベントからネイティブメニューが表示される。
- リンクのコピー、同じセッションのタブで開く、クリック元ページのDevTools検証、ページとURL欄の編集メニュー。
- クリップボードの書き込みだけはテスト内で置き換え、ユーザーのクリップボードに触れない。
- パスキーのget/create要求が速やかに `NotAllowedError` で終了し、案内を表示する。
- conditional autofillの要求では案内を表示しない。
- 通常のCredentials APIは元の処理へ委譲し、認証ポップアップにも同じ非対応処理を適用する。
- URL入力はページ遷移し、検索語はGoogle検索URLへ変換される。検索E2Eは通信をローカルの固定応答に置き換えるため、Googleに検索語を送信しない。
- 以前のセッション分離・保存・復元・初期化・Macショートカットの回帰テストも成功。

Gmailの実アカウントでのログイン完了と、パスキー認証そのものは未検証・未対応。iframe内だけで始まるWebAuthnも対象外。

## Ver 0.1.0


実施日：2026-11-24（日本時間）

## 環境

- macOS 26.6.2 / Apple Silicon（arm64）
- Node.js 26.12.0 / npm 11.20.0
- Electron 45.4.1 / Playwright 1.65.1
- ローカルHTTPサーバーと専用の一時データ保存先を使用

## 結果

| チェック | 結果 |
|---|---|
| `npm run check` | 成功 |
| `npm test` | 4件成功 |
| 開発版の `npm run test:e2e` | 2件成功 |
| `npm run pack:mac` | arm64の `.app` 生成成功 |
| 生成した `.app` のE2E | 2件成功 |
| `npm audit` | 既知の脆弱性0件（依存導入時点） |
| `git diff --check` | 成功 |

## 実Electronで確認したこと

- 4つのセッションで同じサイトのCookie・Local Storageが分離される。
- 1セッションのCookie削除が他のセッションに影響しない。
- 同じセッションの複数タブはCookie・Local Storageを共有する。
- ポップアップが元のセッションを引き継ぐ。
- 対象サイトとポップアップには管理用IPC APIやNode.jsのrequireが公開されない。
- 選択中のタブのDevToolsが開く。
- UIから一時セッションと作業セットを作成できる。
- 作業セットのタブ構成を復元でき、一時セッションは初期化される。
- 通常終了・再起動後に保存セッションのCookie・Local Storageが保持され、一時セッションは引き継がれない。
- 初期化で対象セッションのデータだけが消去される。
- セッション削除時に作業セットの該当タブも除かれる。
- fileスキームのURL入力を拒否する。
- ウィンドウを閉じるとWebContentsを解放し、Macのactivateイベントで再表示できる。
- Electronのネイティブ入力イベントで `⌘L` がURL欄を選択し、`⌘T` がタブ作成画面を開く。

確認ダイアログの応答のみテストで置き換え、ブラウザ・Cookie・ストレージ・ウィンドウは実物で検証した。

## 未検証の範囲

- 実際の業務サイトの認証・SSO・権限・メッセージ送受信。
- ダウンロードの保存先選択、カメラ・マイク等の権限ダイアログ。
- IndexedDB等、Cookie・Local Storage以外の保存領域の個別E2E。
- Intel Mac、macOS 13など別バージョンでの実機動作。
- ZIP / DMG生成、Developer ID署名、公証、別端末への配布。
