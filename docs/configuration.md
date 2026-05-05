# 設定と起動

## 必須環境変数

### LINE Login

- LINECORP_PLATFORM_LOGIN_CHANNEL_ID
- LINECORP_PLATFORM_LOGIN_CHANNEL_SECRET
- LINECORP_PLATFORM_LOGIN_CHANNEL_CALLBACKURL

### セッション

- SESSION_SECRET

### LINE Messaging API

- LINECORP_PLATFORM_MESSAGING_CHANNEL_ACCESSTOKEN
- LINECORP_PLATFORM_MESSAGING_CHANNEL_SECRET

### データベース

- DATABASE_URL

### Inbound Parse Webhook

- INBOUND_PARSE_WEBHOOK_PUBLIC_KEY

受信側のこのアプリには公開鍵を設定する。送信側には対応する秘密鍵を設定する。

- 受信側: `INBOUND_PARSE_WEBHOOK_PUBLIC_KEY`
- 送信側: `INBOUND_PARSE_WEBHOOK_PRIVATE_KEY`

鍵ペアは ECDSA secp256k1 で作成する。

```bash
openssl ecparam -name secp256k1 -genkey -noout -out inbound-parse-webhook-private-key.pem
openssl ec -in inbound-parse-webhook-private-key.pem -pubout -out inbound-parse-webhook-public-key.pem
```

このアプリの `.env` には公開鍵を設定する。PEM をそのまま複数行で扱えない環境では、改行を `\n` に置き換えた1行文字列として設定する。

```bash
INBOUND_PARSE_WEBHOOK_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
```

送信側の `.env` には秘密鍵を設定する。

```bash
INBOUND_PARSE_WEBHOOK_PRIVATE_KEY="-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----\n"
```

PEM ファイルは `.gitignore` の除外対象ではない。鍵ファイルはリポジトリ外で作成するか、設定登録後に安全な場所へ移し、公開鍵・秘密鍵の PEM ファイルと秘密鍵を含む `.env` はコミットしない。

## 任意環境変数

### セッション

- SESSION_STORE

補足:

- `SESSION_SECRET` 未設定時は `LINECORP_PLATFORM_LOGIN_CHANNEL_SECRET` をフォールバックで使用する
- `SESSION_STORE` は本番で外部セッションストアを使う場合の運用フラグとして扱う
- `NODE_ENV=production` かつ `SESSION_STORE` 未設定の場合、起動時に MemoryStore 利用の警告を出力する

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

### ローカル起動（Docker）

```bash
docker build -t mail-to-linemsg:local .
docker run --rm -p 3000:3000 --env-file .env mail-to-linemsg:local
```

通常のローカル起動・検証は Docker コンテナ内で行う。

### ローカル直接実行（補助）

Docker を使わずに手元で直接実行する場合も、npm / yarn は使わず、mise で固定した pnpm を使う。

```bash
eval "$(~/.local/bin/mise activate bash)"
pnpm install --frozen-lockfile
pnpm start
```

`mise.toml` で Node.js と pnpm のバージョンを固定する。

## ミドルウェア構成

- express-session
- helmet
- csrf-csrf（`/api/csrf-token`、`POST /api/addr`、`DELETE /api/addr/:extAddrId` に適用）
- Dicer による multipart ストリーム解析 for /mail-webhook
- express.static for public
- bodyParser.urlencoded
- bodyParser.json

推奨順序:

- express-session
- bodyParser.urlencoded / bodyParser.json
- cookie-parser
- csrf-csrf（API の状態変更ルート）
- ルートハンドラ
- 共通エラーハンドラ

### 本番時の挙動

- app.get('env') が production のとき trust proxy を有効化
- session cookie.secure を true に設定
- session cookie は `mail_to_linemsg.sid` を利用し、`httpOnly=true`、`sameSite=lax` を固定

## ビューと静的ファイル

- view engine: ejs
- テンプレート: pages/
- 静的配信: public/

## Docker 関連

### Dockerfile

- base image: node:20-bookworm-slim
- /app にソースを配置
- @pnpm/exe で pnpm 11.0.4 を導入して pnpm install 実行
- EXPOSE 3000

### テスト用 Docker stage

```bash
docker build --target test -t mail-to-linemsg:test .
```

テスト用 stage では devDependencies を含めて依存を入れ、`pnpm test` を実行する。

### Dockerfile.nodemon

- nodemon をグローバルインストールして ENTRYPOINT に設定

## Procfile

```text
web: node index.js
```

## 初期セットアップの流れ

1. PostgreSQL を用意する
2. [dbtable-pgsql.sql](../dbtable-pgsql.sql) を適用する
3. LINE Login と LINE Messaging API のチャネル情報を設定する
4. Inbound Parse Webhook の公開鍵を `INBOUND_PARSE_WEBHOOK_PUBLIC_KEY` に設定する
5. SendGrid Inbound Parse Webhook の POST 先を /mail-webhook に向ける
6. LINE Messaging API の Webhook を /msg-webhook に向ける
7. 必要なら MQTT を設定する

## Webhook 設定先

- LINE Messaging API: /msg-webhook
- SendGrid Inbound Mail: /mail-webhook
- LINE Login callback: /callback

## 手動検証

Docker でローカル起動後、主要なエラーハンドリングを手で確認するときの最小手順。

### 事前準備

1. 必須環境変数を `.env` に設定して Docker コンテナを起動する
2. API の確認にはログイン済みブラウザのセッションを使うか、同じセッションの Cookie を用意する
3. エラーレスポンスでは `x-request-id` ヘッダが返ることを確認する

### API の検証

#### 未認証 API

```bash
curl -i http://localhost:3000/api/user
```

期待値:

- 401
- JSON に `error.code: AUTH_FAILED`
- `x-request-id` ヘッダあり

#### メールアドレス追加の入力検証

事前に CSRF トークンを取得してヘッダに設定する。

```bash
curl -i \
	-X GET http://localhost:3000/api/csrf-token \
	-H 'Cookie: mail_to_linemsg.sid=YOUR_SESSION_COOKIE'
```

期待値:

- 200
- JSON に `result.csrfToken` が含まれる

```bash
curl -i \
	-X POST http://localhost:3000/api/addr \
	-H 'Content-Type: application/json' \
	-H 'Cookie: mail_to_linemsg.sid=YOUR_SESSION_COOKIE' \
	-H 'X-CSRF-Token: YOUR_CSRF_TOKEN' \
	-d '{"formInputEmail":"a","formInputRecipient":"dummy"}'
```

期待値:

- 400 または 401
- 400 の場合は `error.code` が `EMAIL_TOO_SHORT` などの既知コードになる

トークン無しで状態変更 API を実行した場合の確認:

```bash
curl -i \
	-X DELETE http://localhost:3000/api/addr/00000000-0000-0000-0000-000000000000 \
	-H 'Cookie: mail_to_linemsg.sid=YOUR_SESSION_COOKIE'
```

期待値:

- 403
- JSON に `error.code: CSRF_TOKEN_INVALID`

### mail-webhook の検証

#### 不正な To アドレス

```bash
curl -i \
	-X POST http://localhost:3000/mail-webhook \
	-F 'to=invalid-address' \
	-F 'from=test@example.com' \
	-F 'subject=test' \
	-F 'charsets={"text":"utf-8"}' \
	-F 'text=hello'
```

期待値:

- 400
- JSON に `error.code: INVALID_TO_ADDRESS`
- `requestId` がレスポンスに含まれる

#### 未登録 recipient

```bash
curl -i \
	-X POST http://localhost:3000/mail-webhook \
	-F 'to=unknown@example.com' \
	-F 'from=test@example.com' \
	-F 'subject=test' \
	-F 'charsets={"text":"utf-8"}' \
	-F 'text=hello'
```

期待値:

- 404
- JSON に `error.code: UNKNOWN_RECIPIENT`

#### charsets JSON 不正

```bash
curl -i \
	-X POST http://localhost:3000/mail-webhook \
	-F 'to=known@example.com' \
	-F 'from=test@example.com' \
	-F 'subject=test' \
	-F 'charsets={invalid-json}' \
	-F 'text=hello'
```

期待値:

- 400
- JSON に `error.code: INVALID_CHARSETS_PAYLOAD`

### ログの検証

標準出力の debug ログで次を確認する。

- `request.started`
- `request.completed`
- LINE push の一時障害時は `line.push.retry`
- MQTT publish の一時障害時は `mqtt.publish.retry`
- 失敗時は `request.failed`
