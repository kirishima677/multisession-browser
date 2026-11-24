# macOSでのパスキー対応

## Ver 0.1.1で行うこと

未署名のローカルビルドでは、パスキー要求に対応するネイティブ認証UIがないため、Gmail等の画面が待機状態になる。要求を速やかに `NotAllowedError` で終了し、サイトの「別の方法を試す」から代替認証を選べるよう案内する。

これはパスキー認証への対応ではなく、非対応時の停止を防ぐ修正である。パスキーが必須の場合、このビルドでのログインはできない。Gmail自体のエラー処理や認証方法の選択肢はGoogle・アカウントの設定に依存する。

トップレベルと認証ポップアップに制限用のpreloadを設定する。iframe内だけで開始されるWebAuthnは未対応・未検証。通常のパスワード等のCredentials APIは元の処理に委譲する。認証結果を偽造したり、資格情報を記録したりはしない。

## Electron標準のネイティブ認証

使用中のElectron 45.4.1には `app.configureWebAuthn` がある。ただし `platformPasskeys: true` を指定するだけでは利用できない。

公式ドキュメント上、Appleのシステム認証を使用するには、コード署名、Associated Domainsの権限、embedded provisioning profile、アプリID、RPドメイン側のAASAファイル等が必要になる。未署名・ad-hocビルドは条件を満たさない。Gmailのドメイン側にこのアプリを登録することも、アプリ側だけではできない。

また、システムのパスキーはCookieと異なり、Electronのセッションpartitionごとに分離された資格情報ではない。将来対応する場合も「選んだセッション名＝選ばれるパスキーのアカウント」ではないことを利用者に示す必要がある。

## 任意サイトに対応するブラウザとしての方法

Appleには任意のRP IDに対してパスキー・セキュリティキー要求を行うブラウザ向けの `com.apple.developer.web-browser.public-key-credential` 権限がある。Apple Developer組織アカウントのAccount Holderによる申請・Appleの審査が必要であり、plistに文字列を足すだけでは取得できない。

これを取得したうえで、ブラウザ向けAuthenticationServices APIとElectronのWebAuthn処理を統合する設計・実装が必要になる。現時点ではこのアプリの範囲外。

## 参照

- [Electron 45.4.1のWebAuthn設定と要件](https://github.com/electron/electron/blob/v45.4.1/docs/api/app.md#appconfigurewebauthnoptions-macos)
- [Apple：ブラウザ向けパスキー権限](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.web-browser.public-key-credential)
- [Apple：ブラウザでのパスキー利用](https://developer.apple.com/documentation/authenticationservices/passkey-use-in-web-browsers)
