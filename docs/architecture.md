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

## 配布

electron-builderでmacOS向け `.app` / ZIP / DMGを作成する。ローカル開発ビルドはDeveloper ID署名・公証なし。正式配布では自分のApple Developerアカウントによる署名と公証を設定する。

`minimatch` はビルド依存の脆弱性を回避するため11.0.9にoverrideしている。ビルドツール更新時に依存関係を見直すこと。

## 参照

- [Electron Session](https://www.electronjs.org/docs/latest/api/session)
- [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [WebContents](https://www.electronjs.org/docs/latest/api/web-contents)
- [Electronのセキュリティ](https://www.electronjs.org/docs/latest/tutorial/security)
