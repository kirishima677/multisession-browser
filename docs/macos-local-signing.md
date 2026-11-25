# Multisession Browser のローカル署名とキーチェーン継続許可

更新日：2026年11月26日

対象：自分のMacで使う、ビルド済みの Multisession Browser

同じ証明書とアプリIDで署名し、再ビルド後もキーチェーンから同じアプリとして識別される構成にする手順です。自己署名証明書を使うため、他の人への配布・公証は別途設定します。

この手順書の追加だけでは設定は切り替わりません。証明書作成・信頼設定・署名・許可の継承確認は、以下の手順を実施した時点で行います。

## 1. 現在の状態と変更方針

| 項目 | 現在の設定 |
|---|---|
| リポジトリ | `/Users/nishiokahiroki/code/multisession-browser` |
| 確認したアプリの版数 | 0.7.1 |
| ビルドツール | electron-builder 26.18.0 |
| アプリID | `local.multisession-browser.app` |
| 証明書による署名 | `build.mac.identity: null` で無効 |
| 生成済みアプリの識別条件 | `cdhash H"…"` によるアドホック署名 |

現在はアプリの内容に結び付いたハッシュで識別されるため、ビルドが変わると確認を求められます。固定した署名証明書とアプリIDからなる識別条件（Designated Requirement、以下DR）を使い、継続して識別できる状態にします。キーチェーンはDRを使ってアクセスを追跡します。[Appleの署名仕様](https://developer.apple.com/library/archive/technotes/tn2206/)

既存の `package.json` は維持し、ローカル署名用の設定ファイルを明示指定する方式にします。以下の例はelectron-builder **v26** 用です。

## 2. 作業前の準備

1. 現在のアプリで「構成を保存」を実行し、`⌘Q` で終了します。
2. 必要に応じて、終了後に `~/Library/Application Support/Multisession Browser/` を別の安全な場所へバックアップします。
3. 既存のキーチェーンの暗号化キーは残します。削除すると、保存済みCookie・トークン・履歴等を復号できなくなる可能性があります。
4. 次を同じターミナルで実行します。

```sh
cd /Users/nishiokahiroki/code/multisession-browser
node --version
npm --version
xcode-select -p
command -v codesign
```

Node.js 22以降と、Command Line Toolsの `codesign` を使います。依存が未導入の場合のみ `npm ci` を実行します。

## 3. 専用のコード署名証明書を作る

1. Spotlightなどから「キーチェーンアクセス」を開きます。
2. アプリのメニューから「証明書アシスタント」→「証明書を作成」を選びます。
3. 次の内容を指定します。OSの表示言語によって名称は多少異なります。

   | 項目 | 値 |
   |---|---|
   | 名前 | `Multisession Browser Local Signing` |
   | 固有名のタイプ／Identity Type | 自己署名ルート／Self Signed Root |
   | 証明書のタイプ／Certificate Type | コード署名／Code Signing |
   | キーチェーン | ログイン |

4. 必要なら「デフォルトを無効にする／Let me override defaults」を選び、有効期間を設定します。コード署名用の用途は維持します。
5. 作成後、「自分の証明書」で証明書を展開し、対応する秘密鍵があることを確認します。
6. 証明書の情報の「信頼」で、必要に応じて**コード署名の用途だけ**を「常に信頼」にします。SSL等の他用途は既定のままにします。Macが認証を求めたらMac上で操作します。

Appleは内部開発用の自己署名証明書を証明書アシスタントで作る方法を案内しています。[Appleの証明書作成手順](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html)

署名に使える状態か、次で確認します。

```sh
security find-identity -v -p codesigning
```

出力に `Multisession Browser Local Signing` があることを確認します。表示されない場合は先に証明書の用途・秘密鍵・有効期間・コード署名の信頼設定を確認します。同名の証明書が複数ある場合は、名前の代わりに出力された対象証明書の40桁のSHA-1を、後述の `MSB_SIGNING_IDENTITY` に指定できます。

## 4. ローカル署名専用のビルド設定を用意する

以下の2ファイルを、手順2で移動したリポジトリに作成します。証明書や秘密鍵そのものを入れるファイルではありません。

### 4.1 Entitlements

`build/entitlements.local-signing.plist` として保存します。`build` フォルダがなければ作成してください。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
  </dict>
</plist>
```

`allow-jit` はElectronの実行用、`disable-library-validation` はApple Team IDを持たないローカル署名で同梱コードを読み込むための設定です。Hardened Runtimeは有効のまま、このアプリに限定して適用します。配布版ではDeveloper ID署名と合わせて権限を再確認します。[electron-builder v26の署名説明](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/)

### 4.2 ビルド設定

リポジトリ直下の `electron-builder.local-signing.cjs` として保存します。

```javascript
const { build: base } = require("./package.json");
const identity = process.env.MSB_SIGNING_IDENTITY?.trim();

if (!identity || identity === "-") {
  throw new Error("MSB_SIGNING_IDENTITYに固定の署名証明書を指定してください。");
}

module.exports = {
  ...base,
  forceCodeSigning: true,
  directories: {
    ...base.directories,
    output: "dist/local-signed",
  },
  mac: {
    ...base.mac,
    identity,
    entitlements: "build/entitlements.local-signing.plist",
    entitlementsInherit: "build/entitlements.local-signing.plist",
    notarize: false,
  },
};
```

この設定は、既存の `mac.identity: null` を証明書指定で上書きします。署名できない時は `forceCodeSigning` で失敗させ、アドホック署名への意図しない後戻りを防ぎます。`appId`、同梱ファイル、CLIの梱包設定、`afterPack` は既存設定を引き継ぎます。

既存の `afterPack` でCookie暗号化のfuseを設定し、その後にelectron-builderが証明書で最終署名します。最終署名後にfuseやアプリの中身を変更しないでください。[ビルドの実行順序](https://www.electron.build/v26/docs/features/build-lifecycle/)

## 5. 1回目をビルドして署名を確認する

まず2つの設定ファイルを確認します。

```sh
plutil -lint build/entitlements.local-signing.plist
node --check electron-builder.local-signing.cjs
```

証明書名を指定してビルドします。`buildVersion=1` は後の比較用で、`package.json` の公開バージョンは変更しません。

```sh
MSB_SIGNING_IDENTITY='Multisession Browser Local Signing' \
  npm run pack:mac -- \
  --config electron-builder.local-signing.cjs \
  --config.buildVersion=1
```

ビルド中に `codesign` が署名用秘密鍵の利用確認を出した場合は、対象が手順3で作った秘密鍵であることを確認して許可します。これは次の「アプリが暗号化キーを使う許可」とは別の確認です。

Apple Siliconの場合、以降は次のパスを使います。Intel Macでは実際の出力先（通常 `dist/local-signed/mac/`）へ読み替えます。

```sh
MSB_LOCAL_APP="$PWD/dist/local-signed/mac-arm64/Multisession Browser.app"

codesign --verify --deep --strict "$MSB_LOCAL_APP"
codesign -dv --verbose=4 "$MSB_LOCAL_APP" 2>&1
codesign -d -r- "$MSB_LOCAL_APP" 2>&1
```

次を確認できたら進みます。

- 署名の検証が成功する。
- `Authority` に対象の証明書名、`Identifier` に `local.multisession-browser.app` がある。
- `Signature=adhoc` ではない。自己署名では `TeamIdentifier=not set` でも、それだけで失敗ではない。
- DRが `cdhash H"…"` だけではなく、アプリIDと証明書の条件（`anchor` または `certificate`）を含む。

アプリIDだけを条件にしたDRへ緩めず、証明書の条件も維持します。

## 6. テスト用データで初回の許可を行う

同じターミナルで、専用の一時フォルダを一度だけ作ります。この変数とフォルダは、2回目のビルド確認まで維持します。

```sh
MSB_SIGNING_CHECK_DIR="$(mktemp -d /private/tmp/msb-signing-check.XXXXXX)"

codesign -d -r- "$MSB_LOCAL_APP" 2>&1 \
  | sed -n '/designated =>/p' \
  > "$MSB_SIGNING_CHECK_DIR/requirement-before.txt"

test -s "$MSB_SIGNING_CHECK_DIR/requirement-before.txt"
```

最後のコマンドが失敗する、または記録したDRが空の場合は進まず、手順5へ戻ります。

次はテスト用データだけで起動します。通常利用のプロファイルは使いません。

```sh
MSB_USER_DATA="$MSB_SIGNING_CHECK_DIR/profile" \
  "$MSB_LOCAL_APP/Contents/MacOS/Multisession Browser"
```

1. 「Multisession Browser」が自身の暗号化キーを使うキーチェーン確認が出たら、対象を確認して「常に許可」を選びます。認証情報はMacの画面で入力します。
2. 確認待ちが長引いて「一時セッションで起動」「保存停止中」の案内が出ていた場合は、許可後に `⌘Q` で終了し、**同じコマンドで再起動**します。現在のアプリはOS確認に待ち時間の上限を設けているためです。
3. 保存停止の案内がなく、保存セッションを利用できることを確認します。
4. `https://example.com/` を開き、テスト用のブックマークを1件登録します。終了・再起動して残ることを確認します。
5. `⌘Q` で終了し、ターミナルに戻ります。

許可は対象のアプリとキーチェーン項目に対して行います。「すべてのアプリケーションにアクセスを許可」へ広げる設定は使いません。

## 7. 内容の変わったビルドでも許可が継承されるか確認する

同じ証明書・同じアプリIDを使い、比較用のビルド番号だけを変えます。アプリが終了した状態で実行してください。

```sh
MSB_SIGNING_IDENTITY='Multisession Browser Local Signing' \
  npm run pack:mac -- \
  --config electron-builder.local-signing.cjs \
  --config.buildVersion=2

codesign --verify --deep --strict "$MSB_LOCAL_APP"

codesign -d -r- "$MSB_LOCAL_APP" 2>&1 \
  | sed -n '/designated =>/p' \
  > "$MSB_SIGNING_CHECK_DIR/requirement-after.txt"

test -s "$MSB_SIGNING_CHECK_DIR/requirement-after.txt"
diff -u \
  "$MSB_SIGNING_CHECK_DIR/requirement-before.txt" \
  "$MSB_SIGNING_CHECK_DIR/requirement-after.txt"
```

`diff` に差分が出ず、署名の検証が成功することを確認します。アプリ本体の `CDHash` はビルド内容によって変わって構いません。継続して照合するDRが同じであることが重要です。

同じテスト用データで起動します。

```sh
MSB_USER_DATA="$MSB_SIGNING_CHECK_DIR/profile" \
  "$MSB_LOCAL_APP/Contents/MacOS/Multisession Browser"
```

次の3つが揃えば、ローカル署名の継続利用を確認できています。

- 再ビルドを理由にしたキーチェーン確認が繰り返されない。
- 保存セッションが利用できる。
- 手順6のブックマークを読み込める。

キーチェーンのロックや証明書の変更など、再ビルド以外の理由で認証を求められる場合はあります。DRの一致だけで許可の継承まで確認済みとせず、実際の起動で判断します。

## 8. 日常の起動と npm start の違い

確認後、テスト用のアプリを `⌘Q` で終了します。通常利用は `MSB_USER_DATA` を付けずに開きます。

```sh
open "$MSB_LOCAL_APP"
```

この起動では従来の `~/Library/Application Support/Multisession Browser/` を利用します。既存キーへの許可確認が出た場合は、その署名済みアプリに対して承認します。

コードを更新したら、アプリを終了してから次でビルドし直します。導入試験用の `buildVersion=1` / `2` は普段は指定不要です。

```sh
MSB_SIGNING_IDENTITY='Multisession Browser Local Signing' \
  npm run pack:mac -- --config electron-builder.local-signing.cjs

open "$MSB_LOCAL_APP"
```

通常の `npm run pack:mac` だけでは専用設定を使わないため、現在のアドホック署名方式になります。

`npm start` はリポジトリ内の **Electron.app** でソースを実行します。この手順で署名するビルド済みアプリとは別の実行主体です。今回の設定は `npm start` のElectron本体には適用されません。Electron本体の更新やfuseの書き換えで、開発起動にも再確認が必要になる場合があります。

継続許可を確認した構成で普段使いする場合は、固定証明書でビルドした `.app` を起動します。署名の一貫性がキーチェーン利用に影響することは、Electron公式でも説明されています。[Electronの署名とキーチェーン](https://www.electronjs.org/docs/latest/tutorial/code-signing#macos-apis-that-require-code-signing)

## 9. 証明書の保管と困ったときの確認

証明書はビルドごとに作り直さず、同じ秘密鍵とともに保持します。「自分の証明書」から秘密鍵を含む暗号化した `.p12` を書き出して安全な場所に保管すると、移行時に同じ署名を使えます。`.p12`、秘密鍵、書き出し用パスワードはリポジトリへ保存しません。

| 症状 | 確認すること |
|---|---|
| `0 valid identities found` | コード署名用途、秘密鍵の存在、有効期限、ログインキーチェーンと信頼設定 |
| `Signature=adhoc`／署名スキップ | 専用の `--config` を指定しているか、`MSB_SIGNING_IDENTITY` が正しいか |
| 再ビルド後にDRが変わる | アプリID、証明書のSHA-1、実際に起動したアプリのパス。同名でも作り直した証明書は別物 |
| アプリの署名検証が失敗する | 最終署名後にfuse・Info.plist・同梱ファイルを書き換えていないか。ビルドからやり直す |
| 許可したのに保存停止の案内が残る | OS確認後に同じ署名済みアプリを `⌘Q` で終了し、再起動したか |
| `npm start` だけ確認が出る | 開発用Electronと署名済みアプリの違い。手順8を確認 |

専用設定の使用をやめる場合は、通常の `npm run pack:mac` へ戻せます。その場合は署名の識別方法が変わり、確認が再び必要になり得ます。既存の暗号化キーを削除して戻す操作は不要です。

将来、他のMacへ配布する場合はDeveloper ID署名と公証を設定します。その移行時にも、実際のアプリでキーチェーン許可の継承・再承認を確認します。

## 参照

- [Apple Code Signing In Depth](https://developer.apple.com/library/archive/technotes/tn2206/) — DRとキーチェーンの識別
- [Apple Code Signing Tasks](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html) — 証明書・秘密鍵の作成と管理
- [electron-builder v26のmacOS署名](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/) — `mac.identity` と署名設定
- [electron-builder v26のビルド順序](https://www.electron.build/v26/docs/features/build-lifecycle/) — fuse設定と最終署名の順序
- [Electron Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing) — `safeStorage`・Cookie暗号化と署名

手順書内のJavaScript・plist・シェル構文と、electron-builder 26.18.0の設定読込・スキーマを確認しています。証明書作成、署名実行、キーチェーンの継承はこの手順書の作成時には実施していません。
