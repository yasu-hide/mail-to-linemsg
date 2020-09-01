# mail-to-linemsg
メールをLINEメッセージに送信

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)

- LINEアカウントで利用者を識別して、アカウントごとに任意のローカルパートのメールアドレスを作成できます
- 作成したメールアドレスと、送信先のLINEトークルームを自由に組み合わせできます
    - 他の利用者と重複がなければ、塾名 `kawai-juku@` や、 学校名 `chiyoda-chu@` などローカルパートを任意に設定できます
    - 送信先のLINEトークルームには、1対1のほかグループを指定できます
- 画面上のフォームからメールアドレスの作成・削除が行えます
    - DELボタンを押すと、LINE Notifyの連携が解除されてメールアドレスが削除されます

## USAGE
### TL;DR
1. LINEログインする
2. 受信したいメールアドレスのローカルパート(@の左側)を入力してAddボタンを押す
3. LINE Notifyログインして、メールをお知らせしたいトークルームと連携する
4. 手順2で設定したローカルパート@ドメイン宛にメールを送る
5. Enjoy!
### LINEログインする
![image](https://user-images.githubusercontent.com/5038337/91796225-9b018000-ec5a-11ea-83af-ed79a7f7cda6.png)
### 受信したいメールアドレスのローカルパート(@の左側)を入力してAddボタンを押す
![image](https://user-images.githubusercontent.com/5038337/91796316-cf753c00-ec5a-11ea-9477-89e04d8d6cf6.png)
- 入力に異常があるとAddできません
![image](https://user-images.githubusercontent.com/5038337/91796410-0d726000-ec5b-11ea-8ac0-6341c5633676.png)
### LINE Notifyでログインして、メールをお知らせしたいトークルームと連携する
<img src="https://user-images.githubusercontent.com/5038337/91797308-34319600-ec5d-11ea-9181-6f0e5a478da8.png" width="80%" />

### 手順2で設定したローカルパート@ドメイン宛にメールを送る
![image](https://user-images.githubusercontent.com/5038337/91797388-63480780-ec5d-11ea-81c9-91aa4982be2b.png)
### Enjoy!
![image](https://user-images.githubusercontent.com/5038337/91797539-c46fdb00-ec5d-11ea-98a7-d4a80f746104.png)

## SETUP
### 用意するもの
- MXとCNAMEのレコードが編集できるドメイン
- LINEログイン (ログイン認証)
- LINE Notifyサービス登録 (メッセージ送信)
- herokuアカウント (Webアプリ実行環境)
- sendgridアカウント (Inbound Email Parse Webhook)

### TL;DR
1. __用意するもの__ を準備する
2. heroku CLIを使えるようにする
3. herokuデプロイボタンを押す
4. heroku configにLINEの情報を設定する
5. データベースを用意する
6. sendgridのInbound Email Parse Webhookを設定する
7. Enjoy!

### 用意するものを準備する
- MXとCNAMEのレコードが編集できるドメイン
    - VALUEDOMAINでもGoogle Domainsでも何でも
- LINEログイン
    - https://developers.line.biz/ja/services/line-login/
    - `チャネルの種類` は `LINEログイン`、`プロバイダー` は `新規プロバイダー作成` で適当なプロバイダー名を入力します
    - 作成したら `LINEログイン設定` タブで `ウェブアプリ` を有効にします
    - `コールバックURL` に `https://{herokuのアプリ名}.herokuapp.com/callback` を指定します
    - `チャネルID` と `チャネルシークレット` をメモしておきます
- LINE Notifyサービス登録
    - https://notify-bot.line.me/my/services/
    - `サービス名` はLINEメッセージに表示されます
    - `Callback URL` に `https://{herokuのアプリ名}.herokuapp.com/notify-callback` を指定します
    - `Client ID` と `Client Secret`(表示ボタンを押すと可視) をメモしておきます
- herokuアカウント
    - https://jp.heroku.com/free を参考に取得します
- sendgridアカウント
    - 直接取得でも日本国内代理店(KKE)経由でも
### heroku CLIを使えるようにする
- https://devcenter.heroku.com/articles/heroku-cli
- OSに応じてインストールします
- `heroku login` コマンドで、手順1.herokuアカウントで取得したherokuアカウントにログインします
### herokuデプロイボタンを押す
[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)

### heroku configにLINEの情報を登録する
- 次の6項目を設定する
```
heroku config:set LINECORP_PLATFORM_CHANNEL_CALLBACKURL=https://{herokuのアプリ名}.herokuapp.com/callback

heroku config:set LINECORP_PLATFORM_CHANNEL_CHANNELID={LINEログインでメモしたチャネルID}

heroku config:set LINECORP_PLATFORM_CHANNEL_CHANNELSECRET={LINEログインでメモしたチャネルシークレット}

heroku config:set LINECORP_PLATFORM_NOTIFY_CALLBACKURL=https://{herokuのアプリ名}.herokuapp.com/notify-callback

heroku config:set LINECORP_PLATFORM_NOTIFY_CLIENTID={LINE NotifyサービスのClient ID}

heroku config:set LINECORP_PLATFORM_NOTIFY_CLIENTSECRET={LINE NotifyサービスのClient Secret}
```
- 確認 (表示は例)
```
heroku config
DATABASE_URL: postgres://xxxxxxxxxxxxxx:1234567890abcd...89abcdef@ec2-255-255-255-255.compute-1.amazonaws.com:5432/fedcba98765432
LINECORP_PLATFORM_CHANNEL_CALLBACKURL:   https://XXX.herokuapp.com/callback
LINECORP_PLATFORM_CHANNEL_CHANNELID:     123456789
LINECORP_PLATFORM_CHANNEL_CHANNELSECRET: 0123456789abcdef0123456789abcdef
LINECORP_PLATFORM_NOTIFY_CALLBACKURL:    https://XXX.herokuapp.com/notify-callback
LINECORP_PLATFORM_NOTIFY_CLIENTID:       abcdef1234567890ABCDEF
LINECORP_PLATFORM_NOTIFY_CLIENTSECRET:   ABCDEF01234567890abcdefABCDEF0123456789abcdef
```
### データベースを用意する
```
heroku pg:psql -c '\i dbtable.sql'
```

### sendgridのInbound Email Parse Webhookを設定する
- https://sendgrid.kke.co.jp/docs/API_Reference/Webhooks/parse.html
- https://sendgrid.kke.co.jp/docs/User_Manual_JP/Settings/parse.html
- 手順1.MXとCNAMEのレコードが編集できるドメインで用意したドメインに設定する

### Enjoy!
- `https://{herokuのアプリ名}.herokuapp.com/` にアクセス
