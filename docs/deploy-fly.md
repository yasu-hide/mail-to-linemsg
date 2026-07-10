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

## MQTT 運用方針(mqtts:// 推奨)

`MQTT_URI` は `mqtt://`(平文)と `mqtts://`(TLS)の両方を受け付けます。

- 本番運用では `mqtts://` を推奨します。`mqtt://` は既存運用との後方互換のために許可している位置づけで、認証情報(username/password)と通知本文が平文で流れます。
- ブローカーへの経路が社内の閉域網など信頼できる範囲に限定される場合を除き、`mqtt://` の継続利用は避けてください。

### mqtt:// から mqtts:// への切替手順

1. Fly.io の Secret `MQTT_URI` を `mqtt://` から `mqtts://` に変更する(ホスト・ポートはブローカー側の TLS リスナーに合わせる)

   ```bash
   fly secrets set MQTT_URI=mqtts://<broker-host>:<tls-port> -a <fly-app-name>
   ```

2. `fly secrets set` はデプロイをトリガーするため、追加の再デプロイ操作は不要(反映後にアプリが再起動する)
3. 再起動後、下記の観察方法で接続を確認する

### 接続成功・失敗の観察方法

- メール webhook 経由の MQTT publish 結果は `mqtt.publish.started` / `mqtt.publish.succeeded` / `mqtt.publish.failed` の JSON ログイベントで記録される。切替直後はこれらのイベントで疎通を確認する。
- `mqtt.publish.failed` の詳細を見たい場合は、`DEBUG=mqtt-publish:module` を設定して再デプロイすると `mqtt-publish.js` 内の接続ログ(`Connecting to ...`、`MQTT client error: ...`)が標準エラーに出力される。
- TLS証明書検証エラー(自己署名証明書など)の場合、接続が確立できず `mqtt.publish.failed` が記録される。この修正では証明書オプションを追加していないため、ブローカー側が Node 標準の CA 信頼ストアで検証できる証明書を提示している必要がある。

## Fly Grafana での運用確認

Fly.io の managed Grafana では、Fly が自動で収集する HTTP レスポンス系の metrics を確認できます。
アプリ固有の切り分けは、標準出力・標準エラーに出る JSON ログと合わせて確認します。

Grafana を開く例:

```bash
fly dashboard metrics -a <fly-app-name> --grafana
```

HTTP 5xx を見る例:

```promql
sum(increase(fly_app_http_responses_count{app="<fly-app-name>",status=~"5.."}[10m]))
```

環境や見たい入口によっては、`fly_edge_http_responses_count` も確認します。`fly_app_http_responses_count` はアプリ側で返したレスポンス、`fly_edge_http_responses_count` は Fly edge 側で見えたレスポンスの確認に使います。

メール webhook の LINE push 最終失敗は、アプリでは `LINE_PUSH_FAILED` として HTTP 502 を返します。Fly Grafana では HTTP 5xx の増加を見て、該当時間帯の JSON ログで `line.push.failed` と `request.failed` を確認します。

文字コード変換失敗は `mail_webhook.part.charset_conversion_failed` の warning ログで確認します。この場合は可能な範囲で UTF-8 として本文復元を継続するため、HTTP 200 になることがあります。Fly の HTTP 5xx metrics だけでは検知できないため、文字化け調査では JSON ログを確認します。

## トラブル時

- `Missing required secret` または `Missing required variable` が出たら、Secrets / Variables を確認する
- 誤って機密を出力した場合は、該当 Secret を即時ローテーションする
