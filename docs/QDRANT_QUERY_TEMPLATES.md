# Qdrant Query Templates

このファイルは qdrant-find 用の検索テンプレ集。
目的は「毎回ゼロからクエリを考えない」こと。

## 1. アプリ全体仕様

- `mail-to-linemsg webhook line messaging mqtt flow`
- `sendgrid inbound parse webhook contract required fields`
- `mail routing local part recipient mapping postgres`

## 2. メール解析

- `mail webhook multipart parser transfer-encoding decode`
- `charset fallback utf8 iso-2022-jp windows-31j`
- `html to text normalization line message body`

## 3. Webhook 署名

- `inbound parse webhook signature ecdsa p256 verify`
- `X-Twilio-Email-Event-Webhook-Signature verification`
- `public key pem verify timestamp payload`

## 4. LINE/MQTT 送信

- `line messaging push api recipient id mapping`
- `mqtt publish payload subject json`
- `mail text summary formatting for line`

## 5. テスト探索

- `mail-webhook rate limit test cases`
- `multipart parse e2e mail samples test`
- `signature verification unit test`

## 6. 運用・デプロイ

- `fly deploy required env vars`
- `session security csrf cookie settings`
- `postgres schema recipient mapping`

## 7. 差分追跡クエリ

- `recent changes in lib routes app`
- `new tests for mail webhook parsing`
- `qdrant diff targets summary`

## 8. 擬似グラフ2段検索テンプレ

1段目で機能を引き、2段目で links 語彙を使って辿る。

- 解析系
- 1段目: `mail webhook multipart parse transfer-encoding charset fallback`
- 2段目: `belongs_to:file:lib/mail-webhook.js tested_by:file:test/e2e-mail-samples.test.js related_doc:file:docs/system-overview.md`
- 署名系
- 1段目: `inbound parse webhook signature ecdsa p256 verification`
- 2段目: `belongs_to:file:lib/inbound-parse-webhook-signature.js tested_by:file:test/inbound-parse-webhook-signature.test.js related_doc:file:docs/api-reference.md`
- payload系
- 1段目: `mail text normalization html to text line message payload`
- 2段目: `belongs_to:file:lib/mail-text.js tested_by:file:test/mail-text.test.js related_doc:file:README.md`

### links 語彙リファレンス

- `imports:file:<path>`
- `tested_by:file:<path>`
- `related_doc:file:<path>`
- `belongs_to:file:<path>`

## クエリ作成ルール

- 1クエリは「機能 + 制約 + 文脈」の3要素を入れる。
- シンボル名が分かっているときは必ず含める。
- エラー調査は `error message + symbol + expected behavior` で作る。

## 自動運用コマンド

- 差分抽出 + 投入バッチ生成
- `pnpm run qdrant:refresh`
- 同一 path は最新1件だけ残す（path-latest dedupe）
- 出力: `artifacts/qdrant/diff-targets.json`, `artifacts/qdrant/store-batch.json`
- 2段検索Gate検証
- 事前に 2段目の検索結果を以下に保存する
- `artifacts/qdrant/query-results/parse-hop2.txt`
- `artifacts/qdrant/query-results/signature-hop2.txt`
- `artifacts/qdrant/query-results/payload-hop2.txt`
- 実行: `pnpm run qdrant:two-hop-validate`
- Gate付き実行: `QDRANT_TWO_HOP_GATE=1 pnpm run qdrant:two-hop-validate`
- 出力: `artifacts/qdrant/two-hop-validation.md`, `artifacts/qdrant/two-hop-validation.json`
