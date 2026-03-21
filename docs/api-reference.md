# API リファレンス

## 認証とセッション

- セッションミドルウェア: express-session
- セッション保存値: req.session.userId
- 格納値の実体: user_master.ext_user_id
- 未認証時の API 応答: 主に 401

## Webhook

### POST /msg-webhook

LINE Messaging API からのコールバックを受ける。

#### 用途

- Bot がグループに参加した join イベントを受けて、グループ送信先を登録する

#### 入力

- LINE SDK middleware で署名検証済みの JSON
- 実装上は req.body.events[0] のみ参照する

#### 処理

- event.type が join
- event.source.type が group
- source.groupId を取得
- getGroupSummary で groupName を取得
- recipient_type=1 の recipient として DB へ追加

#### 応答

- join イベント処理が成功すれば 200 OK
- 例外発生時は共通エラーハンドラ経由で JSON エラーを返す

### POST /mail-webhook

SendGrid Inbound Parse Webhook を受ける。

#### Content-Type

- multipart/form-data

#### 主な入力項目

- to
- from
- subject
- text
- html
- charsets

#### 受信メールの解釈ルール

- to の末尾に余分なカンマがあれば除去する
- 複数宛先があっても先頭アドレスだけを見る
- 宛先の local part を addr_master.addr_mail として検索する
- multipart/form-data をストリームで解析し、添付ファイルは保持せず読み捨てる
- text と html の part だけ raw bytes として収集し、`content-transfer-encoding`（base64 / quoted-printable）を先にデコードしてから、charsets の JSON を使って UTF-8 へ変換する
- from と subject は SendGrid が UTF-8 へ正規化した値をそのまま使う
- text があれば UTF-8 化してそのまま使い、なければ html を UTF-8 化してから html-to-text で平文化する
- transfer-encoding デコードや charset 変換に失敗した場合は警告ログを出し、可能な範囲で UTF-8 デコードへフォールバックする

#### LINE 送信フォーマット

以下の 1 メッセージを pushMessage する。

```text
From: {from}
Subject: {subject}

{body}
```

- LINE text message の上限 5000 文字を超える場合は、末尾に `（省略）` を付けて切り詰める

#### MQTT publish

MQTT が有効なら、件名から次の payload を作って publish する。

```json
{"data":"{件名}の通知があります"}
```

#### 応答

- 正常処理完了時は 200 OK
- 主な失敗時は次を返す
  - 400: multipart boundary 不正、payload 超過、request abort、charsets JSON 不正、To アドレス不正
  - 404: 宛先未登録
  - 502: LINE Messaging API push 失敗
- API/webhook 系のエラー応答には `x-request-id` ヘッダと `requestId` フィールドが含まれる

## 画面ルート

### GET /

ログイン済みユーザー向けの管理画面。

#### 処理

- 未ログインなら /login へ redirect
- ログイン済みなら pages/index.ejs を render

### GET /login

LINE ログイン画面を表示する。

#### 処理

- ログイン済みなら / へ redirect
- 未ログインなら pages/login.ejs を render

### GET /logout

セッションを破棄して /login?reason=logged_out へ redirect する。

### GET /auth

LINE Login の認可開始エンドポイント。

### GET /callback

LINE Login のコールバック。

#### 成功時の処理

- id token から LINE ユーザー ID を取得
- user_master へ addUser
- Messaging API の getProfile で displayName を取得
- 1:1 宛先を recipient_master へ addRecipient
- セッションへ userId を保存
- / へ redirect

#### 失敗時の処理

- セッション破棄
- /login?reason=login_failed へ redirect

## REST API

### GET /api/user

ログイン済みユーザー情報を返す。

#### 応答例

```json
{
  "msg": "Success",
  "result": {
    "ext_user_id": "uuid",
    "line_user_id": "Uxxxxxxxx"
  }
}
```

### GET /api/recipient

現在のユーザーが利用可能な送信先一覧を返す。

#### 含まれる項目

- ext_recipient_id
- recipient_type
- line_recipient_id
- recipient_description
- ext_addr_id
- addr_mail

#### 補足

- addr_master と LEFT JOIN した結果を返すため、未使用送信先では ext_addr_id と addr_mail が空になることがある
- 同じ ext_recipient_id が複数行に見える可能性があるため、フロント側で重複除去している

### GET /api/addr

ログイン済みユーザーに紐づくメールアドレス一覧を返す。

#### 応答項目

- ext_addr_id
- addr_mail

### POST /api/addr

メールアドレスと送信先の対応を新規登録する。

#### リクエスト JSON

```json
{
  "formInputEmail": "example",
  "formInputRecipient": "recipient-uuid"
}
```

#### 入力検証

- formInputEmail 必須
- formInputRecipient 必須
- @ がなければ local@local を仮補完して構文チェック
- local part の長さは 4 文字以上
- 登録時には local part を小文字化して保存
- 同一 addr_mail は登録不可
- 指定 recipient は、そのユーザーの利用可能送信先に含まれている必要がある

#### 成功応答

```json
{
  "msg": "Success",
  "result": {
    "ext_addr_id": "uuid",
    "addr_mail": "example"
  }
}
```

### DELETE /api/addr/:extAddrId

メールアドレス対応を削除する。

#### 挙動

- ログイン済みユーザーに紐づく一覧から対象確認を試みる
- 対象が見つかれば addr_master から削除する

#### 補足

- 実装上、削除候補の filter コールバックが return していないため、所有者確認が意図通り機能していない
- ドキュメントとしては現状実装のまま記載している

## エラー処理

- 多くのルートは try/catch して next(e) に流し、末尾の共通エラーハンドラで整形する
- API/webhook の失敗応答は概ね次の形式に統一されている

```json
{
  "success": false,
  "msg": "Auth failed.",
  "requestId": "uuid",
  "error": {
    "code": "AUTH_FAILED",
    "message": "Auth failed.",
    "details": null
  }
}
```

- request 単位で `x-request-id` を払い出す
- LINE push と MQTT publish は一時障害時に最小限の再試行を行う
