# 構成と開発上の注意

```text
BrowserWindow（管理UI / ローカルHTML）
  ├─ preload.js → 入力と送信元を検証するIPC → main.js
  └─ WebContentsView（タブごとの任意サイト / 管理APIなし）
       └─ Session（セッションIDから生成するpartition）
            ├─ 保存：persist:msb-<UUID>
            └─ 一時：msb-<起動ID>-<世代>-<UUID>
```

- `src/main.js`：ウィンドウ・タブ・Session・IPC・ネイティブメニュー。
- `src/preload.js`：管理UIだけに公開するIPCブリッジ。
- `src/tab-layout.js`：タブ順序・分割配置・選択時のペイン置き換え。
- `src/context-menu.js`：クリック元のWebContentsに対する右クリックメニューと保存対象URLの検証。
- `src/page-actions.js`：元タブでのダウンロード、Webアーカイブ保存、印刷、ページ内検索窓の管理。
- `src/find.html` / `find.css` / `find.js` / `find-preload.js`：管理APIを公開しない検索専用ウィンドウ。
- `src/site-preload.js`：非対応のWebAuthn要求を速やかに終了するサイト用preload。管理APIは公開しない。
- `src/model.js`：URLと設定の検証、partition識別子、原子的な設定保存。
- `src/index.html` / `styles.css` / `renderer.js`：ビルド不要の管理画面。
- `test/unit.test.js`：URL・partition・設定ファイルの検証。
- `test/browser.spec.js`：実Electronとローカルサーバーでの統合テスト。

## 画面レイアウト

左236pxはセッション一覧、上152pxはタイトル・タブ・URLバー、下28pxは状態表示。残りを通常表示では選択中のWebContentsViewに、分割表示では指定した2つのWebContentsViewに割り当てる。表示対象外のタブはビューを非表示にし、ページは存続させる。ダイアログ表示中はWebContentsViewをすべて隠し、ネイティブビューがHTMLダイアログを覆わないようにする。

HTMLとメイン側のレイアウト寸法を変更する場合、両方を更新すること。

## タブのドラッグと分割

タブ順序はMapの挿入順で管理し、並び替え時は同じタブオブジェクトを再配置する。作業セット保存もこの順を使う。分割状態は `{left: tabId, right: tabId}` としてウィンドウ単位で保持し、永続化しない。

分割表示ではWebContentsViewを2つ同時表示し、上34pxをペイン見出し、中央8pxを間隔とする。残りの幅を整数で等分する。表示中のWebContentsのfocusイベントを管理画面に反映し、URL欄等の対象を更新する。

HTMLのドラッグ領域がネイティブのWebContentsViewに隠されるため、Pointer Eventsでタブ移動を検出し、ドラッグ中だけサイトのビューを非表示にする。HTML側はpointer captureで追跡し、ドロップ先とタブのゴーストを表示する。タブとペイン見出しはIDごとにDOMを再利用し、クリック・キーボードフォーカス・pointer captureを維持したまま、移動中も選択状態を更新する。完了・キャンセル後は同じWebContentsを再表示する。

選択状態はメイン側のactiveIdを基準とする。状態スナップショットにはプロセス内で単調増加するrevisionを付け、rendererは現在より古いrevisionを無視する。同じ状態をドラッグ後に再描画することは許可する。タブ選択時はネイティブWebContentsのフォーカスも合わせ、可視性が変わらないビューにはsetVisibleを繰り返さない。

ドラッグ完了に伴うクリックだけを抑制し、次のpointerdownで抑制を解除する。時間指定で後続のユーザークリックを捨てない。ドラッグ用の一時クラスは終了・取消時に明示的に除く。

IPCは管理UI専用の既存経路を使用し、タブIDとドロップ先をメイン側で検証する。

## 認証案内

認証案内があるタブは上部に52pxのバナーを確保し、その下にWebContentsViewを配置する。閉じる操作や別ページへのナビゲーションで解除する。

サイト用preloadはcontextIsolationを維持したまま `contextBridge.executeInMainWorld` でWebAuthnの非対応ポリシーを適用する。`navigator.credentials.get/create` の `publicKey` 要求のみ `NotAllowedError` で拒否し、他の資格情報要求は元の実装に渡す。プラットフォーム認証・conditional autofillの対応可否はfalseを返す。トップレベルのページと認証ポップアップを対象とする。

案内の通知にはデータを持たないイベントを使用し、署名・チャレンジ・RP情報・パスキー情報をIPCに送らない。メインは管理下のタブ・ポップアップからの通知だけを、その元タブの表示に反映する。ページによる通知の再現は案内表示にしか作用しない。パスキー本対応時は、この制限を外すことと、ネイティブ認証の実装・権限検証を一緒に行う。

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

## 保存・印刷・ページ内検索

画像等の保存には、クリック元の `webContents.downloadURL` を使う。session.downloadURLや独自のHTTPクライアントに切り替えず、ブラウザのセッションとオリジンに基づくダウンロード処理を使う。保存先選択はSessionのwill-downloadで設定し、interrupted終了時にはエラーを表示する。

ページ保存はネイティブの保存先ダイアログでパスを選んでから `savePage(..., 'MHTML')` を実行する。処理中に元ページが閉じられた場合は保存を開始しない。印刷は `silent: false` を指定してMacのダイアログを表示し、キャンセルをエラー扱いにしない。

検索窓はWebContentsごとに1つ。専用のローカルHTMLと限定したIPCを使用し、呼び出し元のウィンドウ・メインフレーム・URLを確認する。検索先WebContentsは作成時に固定し、検索窓から任意のタブIDやJavaScriptを指定できない。found-in-pageのrequestIdを照合して件数を反映し、元タブの破棄と連動して検索窓・リスナーを解放する。

## アプリアイコン

`assets/icon.png` をアプリ内に同梱し、macOSのready後にapp.dock.setIconで設定する。パッケージ版の起動前・Finder表示にはelectron-builderのmac.iconに指定した `assets/icon.icns` を使う。

`scripts/build-icon.sh` は生成元PNGをsipsで1024pxの基準画像と各標準サイズへ変換し、iconutilでICNSを作成する。画像のデザイン変更は生成元を更新し、派生PNG/ICNSを再生成してからビルドする。

## 配布

electron-builderでmacOS向け `.app` / ZIP / DMGを作成する。ローカル開発ビルドはDeveloper ID署名・公証なし。正式配布では自分のApple Developerアカウントによる署名と公証を設定する。

`minimatch` はビルド依存の脆弱性を回避するため11.0.9にoverrideしている。ビルドツール更新時に依存関係を見直すこと。

## 参照

- [Electron Session](https://www.electronjs.org/docs/latest/api/session)
- [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [WebContents](https://www.electronjs.org/docs/latest/api/web-contents)
- [Electronのセキュリティ](https://www.electronjs.org/docs/latest/tutorial/security)

## APIタブ

APIタブもWebContentsViewとして既存のMap・タブ配置・分割処理で管理する。`kind: "api"` とセッションIDを持ち、管理画面にはローカルファイルのURLを出さず、リクエストURLを表示する。管理画面のURL欄はAPIタブでは読み取り専用、Cmd+LはAPIタブ内のURL入力へフォーカスする。

- `api-request.js`：入力検証、HTTPリクエストへの変換、認証情報を除いた保存定義の生成。
- `api-http.js`：固定Sessionを渡すElectronのnet.request、受信制限、タイムアウト、中止、手動リダイレクト。
- `api-tabs.js`：専用ビュー・専用IPC、実行状態、保存・履歴・複製・作業セットの連携。
- `api.html` / `api.css` / `api.js` / `api-preload.js`：API専用画面。browserAPI・Node.jsは公開せず、API操作のみ許可。

APIビューには任意サイト用のpartitionやpreloadを使わない。ローカル画面から直接fetchせず、メイン側がタブに固定されたセッションIDからSessionを取得し、net.requestに渡す。Cookieモードはcredentials:include、認証なし・Bearerはomitとする。Webタブ切り替えはリクエストのSessionや応答先に影響しない。ネットワーク待機を管理画面全体の操作ロックに入れず、タブごとにAbortControllerを保持する。

専用IPCは管理下APIビューのメインフレーム・正確なローカルURLだけを認可し、呼び出し側の任意のセッションIDで送信させない。セッションIDは新規タブ作成・複製先だけに使用する。API画面のトップレベル遷移、ウィンドウ生成、webviewを拒否し、CSPで直接の通信を禁止する。結果はtextContentで表示し、HTML・スクリプト・外部画像として描画しない。

応答・履歴はメモリ内のみ。履歴はタブごとに直近20件。永続化前・複製前・履歴への投入前にstoredDraftを通し、Bearer・認証系ヘッダーを除く。URL・クエリ・本文は利用者が明示保存した定義としてworkspace.jsonへ保存する。API定義の読み込みから送信は行わない。既存のschemaVersion 1はapiRequestsがない場合に空配列として読み込み、既存Web作業セットとの互換性を保つ。

状態通知にrevisionを付け、入力はdraftRevisionが変化した時だけ置き換える。応答の本文・ヘッダーは初回取得と実行完了時だけ送り、普段の状態通知で5 MiBの内容を繰り返しコピーしない。タブを閉じた際は通信を中止し、遅延応答は削除済みタブへ反映しない。

## Ver 0.5.0：CLI・実行状況・更新確認

- `terminal-tabs.js` / `terminal-preload.js` / `terminal.html` / `terminal.js` / `terminal.css`：CLI専用のローカルビューとIPC。管理下のビュー・メインフレーム・正確なローカルURLを検証してから、本人のPTYだけに入力・リサイズ・ACKを許可する。
- node-ptyはメインプロセス側でログインシェルを起動する。レンダラーにNode.jsは公開せず、xterm.jsのスクリプトとCSSは同梱したnpm依存から読み込む。外部のCDN・WebSocketサーバーは使用しない。
- PTY出力にはepochとseqを付け、初回バッファとライブ通知の重複を除く。未処理出力が256 KiBを超えたらpause、64 KiB未満でresumeする。再表示用のバッファは128000 UTF-16コード単位、スクロールバックは3000行。
- `process-tree.js`：Macのps出力からPID・PPID・RSSのみを読み、CLIの子孫を列挙する。停止時は対象ツリーを終了する。シェルから切り離されたプロセスまで追跡する機能ではない。
- `memory-monitor.js`：Electron app.getAppMetricsのworkingSetSize（KiB）とCLI子孫のRSSを合計し、既出PIDは除く。3秒ごとの非同期計測。共有物理ページの重複は残るため、画面ではRSSの目安と明示する。
- `runtime-model.js`：設定・CLIの起動フォルダ・安定版の数値比較。旧workspace.jsonには既定設定を補完し、schemaVersion 1の既存Web/APIセットを維持する。
- `updates.js`：ブラウザSessionを使わないNode HTTP(S)で固定のGitHub Releases APIを確認。10秒タイムアウト・128 KiB上限・自動リダイレクトなし。安定版のx.y.zのみ比較し、外部で開くURLは対象リポジトリのGitHub Releasesだけを許可する。取得結果のコード実行・自動インストールはない。

定期的なメモリ・更新状態はbrowser:runtimeで専用通知する。タブ列・セッション一覧のDOMを定期的に作り直さない。版数はapp.getVersionとprocess.versionsから取得し、表示用の版数を別途ハードコードしない。

node-pty 1.1.0に同梱されたMac用N-APIバイナリを利用するため、electron-builderのnpmRebuildは無効にしている。scripts/prepare-terminal.jsでspawn-helperの実行権限を設定し、node-pty一式はASARの外へ展開する。npm install / start / pack:mac / dist:macで準備する。将来ネイティブ依存を追加・更新する際は、このビルド方針とElectronとの互換性を再検証する。

## Ver 0.6.0：JWT・応答検索・暗号化

- `jwt.js`：JWT/JWEの候補判定、未検証claimの表示用情報、Cookie候補のハッシュ、対象URLと保存メタデータの検証。値の形式で候補を判定し、Cookie名を固定しない。
- `auth-manager.js`：セッション・origin単位の選択、Cookieの再取得、直接入力、保存選択、Cookie変更イベントに合わせた識別情報更新。トークン値は管理画面の状態通知に入れない。
- `protection.js`：実行中バイナリのCookie暗号化fuseを小さいバッファで読み、非同期safeStorageの可用性を確認する。安全な保存が利用できなければ、既存persistent partitionを開かず、同名ラベルのメモリpartitionで動作する。
- 手入力値はtokens.enc.jsonにOS暗号文として原子的に保存する。変更を直列化し、暗号化・復号に失敗した場合は既存ファイルを維持する。workspace.jsonには選択候補のハッシュ・対象URL等の非秘密メタデータだけを保存する。
- 初回のpersistent partition読み込み時にCookieを取得・再設定・flushし、security-state.jsonに移行済みIDを記録する。暗号化を無効にした旧版との同一プロファイル共有は非対応。
- `network-capture.js`：管理下のWebタブ/ポップアップへCDP Networkを接続する。XHR/fetch完了後にbodyを取得し、リクエスト内容やルーティングは変更しない。APIタブは完了コールバックから直接収集し、二重記録を避ける。
- `response-store.js`：整形テキストの容量制限、古い記録の破棄、本文の文字列検索と抜粋。検索元のtabId/contentsId/sessionIdを保持し、元のタブへ戻せるようにする。応答はファイルへ書かない。
- `test-tools.js` / `test-tools-preload.js` / `test-tools.html` / `test-tools-ui.js` / `test-tools.css`：別ウィンドウの専用UI。管理下の正確なローカルURL・メインフレームだけをIPC認可し、ブラウザ管理API・Node.js・CLIのAPIは渡さない。
- 候補・対象サイト変更後に遅れた応答が到着しても、以前のトークンを表示しない。検索結果も応答IDごとにDOMを再利用し、記録更新中のクリック・選択を保持する。
- 応答はtextarea/textContentで表示し、HTML・スクリプト・画像として実行しない。クリップボードは利用者の明示操作でだけ更新する。

scripts/secure-build.jsをafterPackで呼び、Cookie暗号化fuseを有効化する。Macでは変更後にad-hoc署名を再設定する。scripts/secure-dev.jsは開発用Electronの同じ設定を行い、prestartから呼ぶ。Developer ID署名・公証と、Windows/Linuxの実機確認は別途必要。

## Ver 0.7.0：ブラウザメニュー・履歴・ブックマーク

- `browser-menu.js`は状態と操作コールバックからElectron Menuのテンプレートを生成する。管理画面の「⋮」からメインプロセスへ位置だけ渡し、ネイティブpopupを表示する。WebContentsViewより上に表示し、API/CLIではページ用の操作を無効にする。
- `browser-library.js`はWebContentsのdid-navigate / did-navigate-in-page / page-title-updatedを監視する。トップレベルのHTTP(S) URLだけを記録し、同じビューの直近3秒以内の同一URLをまとめる。管理用・API・CLIのビューには接続しない。
- 履歴とブックマークのsessionIdは登録元のプロファイルID。項目を開く時に存在を検証し、そのプロファイルの新しいWebタブを作る。CookieやAPIリクエスト本文はライブラリに含めない。
- `browser-library.enc.json`はsafeStorageの非同期APIと待機上限を使い、暗号化したJSONを0600で原子的に書き込む。書き込みは直列化し、通常の履歴更新は500msまとめ、終了時にflushする。一時セッションの履歴を永続化前に除く。ブックマークは明示保存として残す。
- 履歴・ブックマークは各2000件、復号後4 MiB、ファイル8 MiBの上限を検証する。上限超過では古い履歴を削除する。安全な保存不可・破損・復号失敗・書き込み失敗は画面へ通知し、メモリ内動作に切り替え、既存ファイルを維持する。
- `library-window.js` / `library-preload.js` / `library.html` / `library.js` / `library.css`は専用の一覧・編集画面。IPCは管理下の正確なローカルURLとメインフレームだけ認可し、browserAPI・Node・CLIのAPIは渡さない。外部遷移・直接通信をCSPとイベントで拒否する。
- 状態通知にrevision、検索応答に呼び出し番号を使って古い結果を無視する。行DOMを項目IDごとに再利用し、更新通知中のクリック先を保持する。名前とURLはtextContentで表示する。
- 管理画面のブックマークダイアログは最新のメイン側pageDetailsを取得する。現在のWebタブと登録セッションを確認して保存し、アドレス欄の「☆/★」は選択中タブの状態から更新する。

## Ver 0.7.2：PDF保存

`page-actions.js` の `savePDF` を、ブラウザメニューとサイト用コンテキストメニューから呼ぶ。両方ともクリック元のWebContentsを渡し、保存ダイアログ後に選択中タブを取り直さない。API/CLI・管理用ビューには保存経路を公開しない。

HTTP(S)のURLを確認してからネイティブ保存ダイアログを開く。ダイアログ後とPDF生成後に、元のWebContentsの生存とURLの一致を確認する。生成はChromiumの `printToPDF`（A4、背景あり、CSS用紙指定優先）で行い、外部からページを取り直さない。

完成したBufferを保存先と同じディレクトリのUUID付き一時ファイルへ0600・排他的作成で書き込み、renameで置き換える。短い一時ファイル名を使い、長い保存名にも対応する。一時ファイルと同一ページの多重実行フラグはfinallyで解放する。
