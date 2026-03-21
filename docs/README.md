# mail-to-linemsg ドキュメント

このディレクトリは、現在の実装を読み取って整理した開発者向けドキュメント。

## 何をするアプリか

このアプリは、SendGrid Inbound Parse Webhook で受けたメールを整形し、次の2系統へ通知する。

- LINE Messaging API
- MQTT

あわせて、LINE ログイン済みユーザーごとに以下を管理する。

- 自分宛て、または参加中グループ宛ての LINE 送信先候補
- メールアドレスのユーザーパートと LINE 送信先の対応
- その対応の追加、一覧取得、削除

## ドキュメント一覧

- [system-overview.md](./system-overview.md): 全体構成、主要フロー、画面の役割
- [api-reference.md](./api-reference.md): Webhook、OAuth、REST API の仕様
- [data-model.md](./data-model.md): PostgreSQL テーブルとアプリ内の関連
- [configuration.md](./configuration.md): 環境変数、起動方法、デプロイ周り

図を先に見たいなら、[system-overview.md](./system-overview.md) のシーケンス図と [data-model.md](./data-model.md) の ER 図から入るのが早い。

## 実装上の要点

- メールの配送先判定は、To ヘッダーの先頭アドレスのローカルパートだけを使う
- 保存されるメールアドレスは完全なアドレスではなくローカルパートのみ
- LINE 送信先は、ユーザー本人の 1:1 トークと、Bot が参加したグループを扱う
- グループ送信先は LINE の join イベントを受けたときに recipient_master へ登録される
- MQTT にはメール本文全体ではなく件名だけをもとにした JSON を publish する

## 推奨の読み順

1. [system-overview.md](./system-overview.md)
2. [api-reference.md](./api-reference.md)
3. [data-model.md](./data-model.md)
4. [configuration.md](./configuration.md)
