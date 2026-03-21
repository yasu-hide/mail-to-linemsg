# 設定と起動

## 必須環境変数

### LINE Login

- LINECORP_PLATFORM_LOGIN_CHANNEL_ID
- LINECORP_PLATFORM_LOGIN_CHANNEL_SECRET
- LINECORP_PLATFORM_LOGIN_CHANNEL_CALLBACKURL

### LINE Messaging API

- LINECORP_PLATFORM_MESSAGING_CHANNEL_ACCESSTOKEN
- LINECORP_PLATFORM_MESSAGING_CHANNEL_SECRET

### データベース

- DATABASE_URL

## 任意環境変数

### MQTT

4 つ全部そろうと MQTT 連携を初期化できる。

- MQTT_URI
- MQTT_USER
- MQTT_PASS
- MQTT_TOPIC

補足:

- MQTT_PASS は未設定なら空文字になる
- 初期化に失敗した場合、アプリは MQTT 無効で継続する
- publish 時には MQTT_URI が mqtt:// で始まることを要求する

### 実行ポート

- PORT

未設定時は 3000。

## 起動方法

### ローカル起動

```bash
npm install
node index.js
```

### package.json の script

```bash
npm start
```

実体は node index.js。

## ミドルウェア構成

- express-session
- helmet
- Dicer による multipart ストリーム解析 for /mail-webhook
- express.static for public
- bodyParser.urlencoded
- bodyParser.json

### 本番時の挙動

- app.get('env') が production のとき trust proxy を有効化
- session cookie.secure を true に設定

## ビューと静的ファイル

- view engine: ejs
- テンプレート: pages/
- 静的配信: public/

## Docker 関連

### Dockerfile

- base image: node:latest
- /app にソースを配置
- npm install 実行
- EXPOSE 3000

### Dockerfile.nodemon

- nodemon をグローバルインストールして ENTRYPOINT に設定

## Fly.io 設定

fly.toml では次を定義している。

- internal_port=3000
- force_https=true
- primary_region=nrt
- process command=/app/index.js

また、LINECORP_PLATFORM_LOGIN_CHANNEL_CALLBACKURL を Fly の URL に設定している。

## Procfile

```text
web: node index.js
```

## 初期セットアップの流れ

1. PostgreSQL を用意する
2. [dbtable-pgsql.sql](../dbtable-pgsql.sql) を適用する
3. LINE Login と LINE Messaging API のチャネル情報を設定する
4. SendGrid Inbound Parse Webhook の POST 先を /mail-webhook に向ける
5. LINE Messaging API の Webhook を /msg-webhook に向ける
6. 必要なら MQTT を設定する

## Webhook 設定先

- LINE Messaging API: /msg-webhook
- SendGrid Inbound Mail: /mail-webhook
- LINE Login callback: /callback
