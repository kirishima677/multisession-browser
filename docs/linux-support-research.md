# Linux対応の調査結果

調査日：2026年11月26日  
対象：Multisession Browser 0.7.4、コミット `f612801`  
範囲：コード・依存部品・配布方式の調査と、Linuxコンテナでの単体テスト。アプリの実装変更は含まない。

## 結論と最初の対応範囲

Linux対応は実現可能。セッション分離、Web/APIタブ、応答検索、ワークセットなどの共通部分を利用し、配布処理、CLI、鍵管理、デスクトップ操作のOS差分を整える方針が適している。

最初は **Ubuntu LTSのGNOMEデスクトップ、deb形式** を対象とする。2026年11月時点の候補はUbuntu 26.04 LTSを主対象、24.04 LTSを互換性確認対象とする。CPUはx64を先行候補とし、arm64は別成果物として検証する。この範囲は提案で、利用予定の実機が決まった時点で絞り込める。[Ubuntuのサポート対象](https://ubuntu.com/about/release-cycle)

Linuxコンテナで既存の単体テスト36件が成功した。一方、Ubuntuの画面操作、実際の鍵管理、CLIのネイティブ部品、配布アプリの起動は未検証であり、現時点ではLinux対応済みとは扱わない。

## 必要な変更

| 優先度 | 対象 | 現状と必要な対応 |
| --- | --- | --- |
| 高 | ビルド後処理 | Linuxの実行ファイル名と、Cookie暗号化設定を適用する対象パスが一致していない。実際の実行ファイルを参照するよう修正する。 |
| 高 | CLIのネイティブ部品 | 現在のnode-ptyにはLinux用バイナリが同梱されていない。Linux・対象CPU向けにビルドし、配布物に含める。 |
| 高 | CLIのキー操作 | LinuxのCtrl操作がブラウザのショートカットと衝突する。ターミナルに渡す操作とアプリ操作を整理する。 |
| 高 | 暗号化保存 | Linuxの鍵管理サービスと非同期safeStorageの判定を検証する。安全な鍵管理を確認できない場合は、一時利用に切り替える条件を整える。 |
| 中 | シェルとプロセス管理 | zsh固定のフォールバックを見直す。psの実行環境と、CLI終了時の子プロセス停止を確認する。 |
| 中 | ウィンドウとメニュー | Mac向けのタイトルバー設定・余白・メニューをOS別にする。Linuxでウィンドウ操作ボタンを利用できる構成にする。 |
| 中 | 表示と日本語入力 | ⌘表記、macOS固定表記、鍵管理の案内をOSに合わせる。日本語入力とPDFのフォントも確認する。 |
| 中 | テストと配布設定 | Linux用のビルド設定とテスト環境を追加する。Mac固有のテスト条件を分ける。 |

### ビルド後処理の実行ファイル名

[`scripts/secure-build.js`](../scripts/secure-build.js) は、Mac以外では `appInfo.productFilename` を実行ファイル名として使用している。現在の設定では `Multisession Browser` になる。

インストール済みelectron-builder 26.18.0の `LinuxPackager` は、明示指定がない場合、パッケージ名からLinux実行ファイル名を決定する。このリポジトリでは `multisession-browser` になるため、後処理の対象がずれる。

実際の後処理を、ファイルを書き換えないモックで呼び出した結果は次のとおり。

```text
後処理の対象：/tmp/msb-linux-unpacked/Multisession Browser
想定される実体：/tmp/msb-linux-unpacked/multisession-browser
一致：false
```

Linuxではpackagerの実行ファイル名を参照するなどして一致させ、生成物のCookie暗号化設定が有効であることまで確認する。Mac向けの処理は維持する。

### node-ptyの準備

使用中のnode-pty 1.1.0の `prebuilds/` にはdarwin・win32向けがあり、Linux向けはない。インストール処理は該当バイナリがなければnode-gypによるビルドへ進む。Linuxのコンパイラ、make、Pythonなどの準備が必要になる。[node-pty 1.1.0のビルド条件](https://github.com/microsoft/node-pty/blob/v1.1.0/README.md#dependencies)

[`package.json`](../package.json) の `npmRebuild: false` はLinux向けの依存部品を用意する手順と合わせて見直す。N-API対応でも、OS・CPU・共有ライブラリの違いは残る。Macの `node_modules` をLinux用として流用せず、Linuxで依存部品を用意して生成・実行する。[electron-builderの複数OS向けビルド](https://www.electron.build/v26/docs/features/multi-platform-build/)

`asarUnpack` には既にnode-ptyが含まれる。Linux版では、展開先のネイティブ部品を実際に読み込めることと、シェル起動までを確認する。24.04と26.04を対象にするなら、ネイティブ部品のビルド基準は古い24.04側に合わせる方針がよい。

### CLIとCtrlキーの衝突

[`src/browser-controls.js`](../src/browser-controls.js) は、Mac以外でControlキーをアプリ操作の修飾キーとして使う。ターミナルでも次のキーがブラウザ側へ渡るコードになっている。

| キー | シェルでの代表的な用途 | 現在のアプリ側の扱い |
| --- | --- | --- |
| Ctrl+R | 履歴の逆方向検索 | 再読み込みの処理として消費し、ターミナルでは何もしない |
| Ctrl+L | 画面のクリア | URL欄への移動処理として消費する |
| Ctrl+D | EOF・シェル終了 | ブックマーク操作として消費する |
| Ctrl+P | 直前の履歴 | 印刷操作として消費する |
| Ctrl+F | カーソルを前へ移動 | ページ内検索として消費する |

ターミナル入力中は必要なCtrl操作をシェルへ渡し、アプリ操作には別の組み合わせを用意する。`before-input-event` だけでなく、アプリメニューの `CmdOrCtrl` アクセラレーターも同時に調整する。ブラウザ側の処理を止めるだけではメニューに奪われる可能性が残る。

[`src/terminal-tabs.js`](../src/terminal-tabs.js) のシェル選択は `SHELL` がなければ `/bin/zsh` になる。Linuxでは、環境変数の値が実行可能なシェルか確認し、bash・shなどへフォールバックできる構成を検討する。デスクトップのランチャーから起動した場合も確認する。

### Linuxの鍵管理と暗号化保存

[`src/protection.js`](../src/protection.js) は非同期safeStorageの利用可否を確認し、Linuxで `getSelectedStorageBackend()` が `basic_text` の場合は保存を許可しない。

ただし、Electron 45.4.1では、非同期APIにSecret Portal、Secret Service、フォールバックの複数の鍵供給経路がある。`isAsyncEncryptionAvailable()` の成功と、OSの安全な鍵保管先の利用確認を同一視できない。[Electron 45.4.1 safeStorageの説明](https://github.com/electron/electron/blob/v45.4.1/docs/api/safe-storage.md)

同版の実装では非同期初期化完了時に利用可能がtrueとなり、Linuxの鍵供給候補には低い優先度のPosixフォールバックも登録される。`getSelectedStorageBackend()` が返す情報と、実際の非同期暗号化で選ばれた経路の対応を確認する必要がある。これはソースからの判断で、実際のUbuntuで弱い経路が選ばれたと確認したものではない。[非同期初期化の実装](https://github.com/electron/electron/blob/v45.4.1/shell/browser/api/electron_api_safe_storage.cc)、[鍵供給経路の登録](https://github.com/electron/electron/blob/v45.4.1/shell/browser/browser_process_impl.cc)

既存の保存可否判定をLinuxコンテナ内のモックで確認した。いずれも非同期APIがtrueを返す条件で、実際のOS鍵管理には接続していない。

| モックのbackend | 現在のpersistentAllowed |
| --- | --- |
| basic_text | false |
| unknown | true |
| gnome_libsecret | true |

未知のbackendも許可する現在の条件は、Linux版の出荷前に見直しが必要。単に暗号化・復号が成功するだけでは鍵の保護を証明できない。鍵管理が利用可能・ロック中・不在の場合と、D-Busに接続できない場合を用意し、Cookie、手入力トークン、履歴・ブックマークをそれぞれ検証する。

安全な保存を確認できない時は一時利用にし、既存の暗号化ファイルを維持する現在の方針を引き継ぐ。Macで作った暗号化ファイルをLinuxへコピーしてログイン状態を引き継ぐ用途は対象にせず、Linux側でログインし直す。

この対応は保存先の保護に関するもの。別途保留中の「平文の保持期間を短くする」変更は含めない。

### プロセス管理とメモリ表示

[`src/process-tree.js`](../src/process-tree.js) は `/bin/ps -axo pid=,ppid=,rss=` を使い、CLIのメモリ集計と終了処理を行う。Ubuntu実機でpsの配置・出力と子プロセスの停止を確認する。最小構成ではprocps等の追加が必要になる場合がある。

psによるプロセス一覧の取得に失敗すると、終了処理は直接のシェルだけを対象にする。そのため、タブを閉じた後に実行中の子プロセスが残らないことを確認項目に含める。

Electronのメモリ指標とCLIのRSSを集計する既存の仕組みは再利用候補。Linuxで表示値、警告の閾値、タブ終了後の変化を確認する。今回の単体テストは、実際のLinuxデスクトップでのメモリ使用量を測ったものではない。

### ウィンドウと表示

[`src/main.js`](../src/main.js) はMac用の `hiddenInset` と `trafficLightPosition` を常に指定し、[`src/styles.css`](../src/styles.css) のタイトルバーにはMacの操作ボタン用の余白がある。Mac用オプションをOS別にし、Linuxではまず標準のウィンドウ枠で閉じる・最小化・最大化を利用できる構成が扱いやすい。[Electronのタイトルバー設定](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)

Mac専用のメニュー項目を分岐し、画面内の⌘表記、アプリ情報のmacOS固定表記、鍵管理の「Macの確認」という文言もOSに合わせる。既存のPNGアイコンはLinux向けにも利用候補になる。

WaylandとX11/XWaylandでは、フォーカス、ドラッグ、ウィンドウ配置などの差を検証する。Electronは38以降、WaylandセッションでネイティブWaylandを自動選択するため、両経路の確認が必要。[ElectronのWayland関連変更](https://www.electronjs.org/docs/latest/breaking-changes#removed-electron_ozone_platform_hint-environment-variable)

## 配布方式

| 方式 | 位置付け | 確認事項 |
| --- | --- | --- |
| deb | Ubuntu向けの初回配布候補 | 依存パッケージ、ランチャー、アイコン、通常ユーザーでの起動、更新時のデータ維持 |
| AppImage | debの検証後に追加する候補 | FUSE、実行権限、sandboxとAppArmor、鍵管理への接続 |
| Flatpak・Snap | 初回対応後に検討 | CLIの実行・作業フォルダへのアクセス、Portal、権限と配布方式の設計 |

AppImageは追加のFUSE準備が必要な環境がある。Ubuntu 24.04では関連パッケージ名の変更もあるため、配布時の案内を対象環境で確認する。[AppImageのFUSE案内](https://docs.appimage.org/user-guide/troubleshooting/fuse.html)

UbuntuのAppArmorによるuser namespaceの制限と、Chromiumのsandboxが両立する配布方法を選ぶ。通常起動のために `--no-sandbox` やOS全体の保護無効化を求める方式は採用しない。[UbuntuのAppArmor説明](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/)

[`src/updates.js`](../src/updates.js) の更新確認は共通コードを利用できる見込み。ただし、Linux用成果物を公開し、対象OS・CPU向けのダウンロードへ案内できることを確認する。現在の更新確認は自動インストール機能ではない。

## 実施した検証

| 項目 | 結果 |
| --- | --- |
| 調査時のソース | 0.7.4 / f612801 |
| Linux環境 | DockerのLinux arm64、Debian 12 bookworm |
| 実行イメージ | node:24-bookworm-slim、Node v24.22.3 |
| イメージのdigest | sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 |
| 単体テスト | 36成功、失敗0、スキップ0 |
| テスト実行 | node --test --test-concurrency=1 test/unit/*.test.js |
| 配布後処理の対象パス | モックで不一致を確認 |
| 保存可否判定 | モックでbasic_text拒否、unknown許可を確認 |
| コンテナ内のコマンド | bashあり、zshなし、psなし |

コンテナは非root、ネットワークなし、ソースと単体テストを読み取り専用で接続して実行した。アプリのユーザーデータには接続していない。コンテナは実行後に削除され、取得したNodeイメージはDockerのキャッシュに残る。

この結果が示すのは共通ロジックの単体テストの成立まで。DebianコンテナにはUbuntuデスクトップ、Electronの画面、実際の鍵管理サービス、Linux用node-ptyを用意していない。Ubuntuへのインストールや、操作テストの成功を示す結果ではない。

## テスト環境の対応

既存の操作テストには次のMac依存がある。

- [`test/helpers/electron.js`](../test/helpers/electron.js) がシェルを `/bin/zsh` に固定している。
- キー操作のテストがMac用のMetaキーを前提としている。
- 最後のウィンドウを閉じた後、Macではアプリが残り再表示するというライフサイクルを検証している。Linuxでは終了する現行仕様に合わせる必要がある。
- [`test/e2e/authentication.spec.js`](../test/e2e/authentication.spec.js) の旧版移行テストが、Macのローカル実行ファイルのパスに依存している。Linuxで移行を保証する場合はLinux用の検証元データ・旧版が必要になる。

Linux向けのCI設定は現時点でない。Ubuntuのビルド・単体テスト・操作テストを追加する際は、D-Busと鍵管理サービスの条件も明示する。Xvfbは基本操作の自動検証には使えるが、実際のWayland、日本語入力、鍵管理ダイアログの確認はデスクトップ環境で行う。

## 実装する場合の順序と完了条件

1. **生成と起動を整える。** Linux用のビルド指定、実行ファイル名、node-pty、シェル選択を対応し、通常ユーザーでdebのインストール・起動・CLI操作まで確認する。
2. **鍵管理と保存を固める。** 実際のLinux鍵管理を確認し、安全に保存できる条件を決める。利用不可時の一時利用、既存ファイル維持、再起動後の復元まで検証する。
3. **操作を整える。** CLIのCtrlキー、メニュー、タイトルバー、OS表示、日本語入力を対応する。
4. **回帰テストと配布を整える。** Ubuntu 24.04で生成した部品の26.04での動作、WaylandとXWayland、更新時のデータ維持を確認する。x64とarm64の成果物はそれぞれ実行する。

初回Linux版の確認項目は次のとおり。

- 複数アカウントのセッション分離と、同一セッション内の共有。
- タブの並べ替え、分割、切り替え、選択表示とフォーカス。
- API送信、認証情報の利用、応答検索、DevToolsの同時利用。
- CLIのCtrl操作、日本語入力、リサイズ、タブ終了時の子プロセス停止。
- 鍵管理が利用可能・ロック中・不在の各状態での保存可否と既存データ維持。
- アプリ再起動後のCookie、手入力トークン、履歴・ブックマークの復元。
- メモリ表示と警告、PDF保存、日本語フォント、通常の印刷。
- メニューやランチャーからの起動、全ウィンドウ終了、更新通知。
- インストール・更新後もsandboxを有効にした通常起動が成立すること。

パスキーは現行版でも非対応のため、Linux移植だけでは利用可能にならない。その他のディストリビューション、KDE、Flatpak・Snap、Windowsは初回Ubuntu対応の後に範囲を決める。
