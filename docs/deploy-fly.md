# Fly.io deploy guide (GitHub Actions)

このドキュメントは、GitHub Actions から Fly.io へデプロイするための手順をまとめたものです。
機密情報はリポジトリに保存しません。`fly.toml` は CI 実行時にテンプレートから生成します。

ビルドは `Dockerfile` を使います。

## Actions で設定不要なパラメータ

以下は Fly.io 側で管理し、GitHub Actions からは設定しません。

- `DATABASE_URL`
- `LINECORP_PLATFORM_LOGIN_CHANNEL_ID`
- `LINECORP_PLATFORM_LOGIN_CHANNEL_SECRET`
- `LINECORP_PLATFORM_MESSAGING_CHANNEL_ACCESSTOKEN`
- `LINECORP_PLATFORM_MESSAGING_CHANNEL_SECRET`
- `MQTT_URI`
- `MQTT_USER`
- `MQTT_PASS`
- `MQTT_TOPIC`

## fly.toml で変数化する最小項目

`fly.toml` テンプレートでは次の 3 項目だけを置換対象にします。

テンプレートファイルの配置先:

- `.github/deploy-fly/fly.template.toml`

- `app`
- `primary_region`
- `LINECORP_PLATFORM_LOGIN_CHANNEL_CALLBACKURL`

## 追加で指定を推奨する項目

- `NODE_ENV`
  - 本番挙動を安定化するため
- `internal_port`
  - アプリと Fly 設定の不一致を防ぐため
- `processes.app`
  - `node /app/index.js` のように実行コマンドを明示して起動失敗を避けるため

## GitHub Secrets（Actions 実行用）

設定する Secrets は次の 1 つだけです。

- `FLY_API_TOKEN`

## GitHub Variables（Actions 実行用）

以下の Variables を設定します。

- `FLY_APP`
- `FLY_PRIMARY_REGION`
- `LINE_LOGIN_CALLBACK_URL`

## Secret のサンプル値（ダミー）

実運用の値は絶対に貼り付けないでください。以下はダミーです。

- `FLY_API_TOKEN`
  - `flyv1_dummy_token_replace_this_value`
- `FLY_APP` (Variable)
  - `example-fly-app`
- `FLY_PRIMARY_REGION` (Variable)
  - `nrt`
- `LINE_LOGIN_CALLBACK_URL` (Variable)
  - `https://example-fly-app.example.com/callback`

## fly auth login の扱い

GitHub Actions では対話ログインを行いません。
`FLY_API_TOKEN` を設定して認証します。

## デプロイ手順

1. Secrets を登録する
2. Variables を登録する
3. `.github/workflows/deploy-fly.yml` を `master` へマージする
4. `master` への push か `workflow_dispatch` でデプロイを実行する
5. Actions ログで deploy 成功を確認する

## 検証項目

- ログにトークンや URL の実値が出ていない
- Fly アプリが正常起動している
- Login callback URL が期待どおり反映されている

## トラブル時

- `Missing required secret` または `Missing required variable` が出たら、Secrets / Variables を確認する
- 誤って機密を出力した場合は、該当 Secret を即時ローテーションする
