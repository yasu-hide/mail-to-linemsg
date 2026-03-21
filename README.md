# mail-to-linemsg
メールをLINEメッセージに送信

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
- sendgridアカウント (Inbound Email Parse Webhook)

### TL;DR
1. __用意するもの__ を準備する
2. アプリの公開URLに合わせてLINEのCallback URLを設定する
3. アプリの環境変数にLINEの情報を設定する
4. データベースを用意する
5. sendgridのInbound Email Parse Webhookを設定する
6. Enjoy!

### 用意するものを準備する
- MXとCNAMEのレコードが編集できるドメイン
    - VALUEDOMAINでもGoogle Domainsでも何でも
- LINEログイン
    - https://developers.line.biz/ja/services/line-login/
    - `チャネルの種類` は `LINEログイン`、`プロバイダー` は `新規プロバイダー作成` で適当なプロバイダー名を入力します
    - 作成したら `LINEログイン設定` タブで `ウェブアプリ` を有効にします
    - `コールバックURL` に `https://{アプリのドメイン}/callback` を指定します
    - `チャネルID` と `チャネルシークレット` をメモしておきます
- LINE Notifyサービス登録
    - https://notify-bot.line.me/my/services/
    - `サービス名` はLINEメッセージに表示されます
    - `Callback URL` に `https://{アプリのドメイン}/notify-callback` を指定します
    - `Client ID` と `Client Secret`(表示ボタンを押すと可視) をメモしておきます
- sendgridアカウント
    - 直接取得でも日本国内代理店(KKE)経由でも
### アプリの環境変数にLINEの情報を登録する
- 次の6項目を設定する
```
LINECORP_PLATFORM_CHANNEL_CALLBACKURL=https://{アプリのドメイン}/callback

LINECORP_PLATFORM_CHANNEL_CHANNELID={LINEログインでメモしたチャネルID}

LINECORP_PLATFORM_CHANNEL_CHANNELSECRET={LINEログインでメモしたチャネルシークレット}

LINECORP_PLATFORM_NOTIFY_CALLBACKURL=https://{アプリのドメイン}/notify-callback

LINECORP_PLATFORM_NOTIFY_CLIENTID={LINE NotifyサービスのClient ID}

LINECORP_PLATFORM_NOTIFY_CLIENTSECRET={LINE NotifyサービスのClient Secret}
```
### データベースを用意する
```
psql "$DATABASE_URL" -f dbtable-pgsql.sql
```

### sendgridのInbound Email Parse Webhookを設定する
- https://sendgrid.kke.co.jp/docs/API_Reference/Webhooks/parse.html
- https://sendgrid.kke.co.jp/docs/User_Manual_JP/Settings/parse.html
- 手順1で用意したドメインに設定する

### Enjoy!
- `https://{アプリのドメイン}/` にアクセス
