const debug = require('debug')('mqtt-publish:module');
const mqtt = require('async-mqtt');

class Mqtt {
  constructor(options) {
    const requiredParams = ['uri', 'username', 'password', 'topic'];
    requiredParams.forEach((param) => {
      if (options[param] == null) {
        // null or undefined
        throw new Error(`Required parameter ${param} is missing.`);
      }
    });
    this.uri = String(options.uri);
    this.username = String(options.username);
    this.password = String(options.password);
    this.topic = String(options.topic);
    this.client = null;
  }

  connect() {
    if (this.client) {
      // 接続中（CONNACK 前）でも client を共有し、同時 publish による
      // 二重 connect / client 上書きを防ぐ。
      return;
    }
    debug(`Connecting to ${this.uri} username=${this.username}`);
    const client = mqtt.connect(this.uri, {
      username: this.username,
      password: this.password,
      connectTimeout: 2000,
      reconnectPeriod: 0,
    });
    client.setMaxListeners(50);
    // error イベントにリスナーが無いと未処理 error でプロセスが落ちるため必ず張る。
    client.on('error', (err) => {
      debug(`MQTT client error: ${err && err.message}`);
    });
    // reconnectPeriod:0 では自動再接続しないため、切断時に参照を捨て、
    // 次回 publish で新しい接続を張れるようにする。
    client.on('close', () => {
      if (this.client === client) {
        this.client = null;
      }
    });
    this.client = client;
  }

  async disconnect() {
    if (this.client && this.client.connected) {
      debug(`Disconnect from ${this.uri}`);
      await this.client.end();
    }
    this.client = null;
  }

  async publish(message = 'message') {
    if (!this.uri) {
      throw new Error('MQTT_URI is not defined.');
    }
    if (!this.uri.startsWith('mqtt://') && !this.uri.startsWith('mqtts://')) {
      throw new Error('MQTT_URI must start with mqtt:// or mqtts://');
    }
    if (!this.username) {
      throw new Error('MQTT_USERNAME is not defined.');
    }
    if (!this.topic) {
      throw new Error('MQTT_TOPIC is not defined.');
    }
    const payload = JSON.stringify({ data: `${message}の通知があります` });
    this.connect();
    // this.client は close ハンドラで null になりうるため、この publish が対象とする
    // client をローカルに固定してからリスナーを張る/外す。
    const { client } = this;
    debug(`Publish to ${this.topic} payload=${payload}`);

    // QoS0のpublishは未接続時mqtt.jsのオフラインキューに積まれるだけで、接続失敗時に
    // flushされずコールバックが永久に呼ばれない。接続断イベントとraceし、実際の
    // エラーで即rejectする(でなければ呼び出し元のdeadlineまでハングし続ける)。
    let failPublish;
    const connectionFailed = new Promise((_, reject) => { failPublish = reject; });
    connectionFailed.catch(() => {}); // client.publish が同期throwしrace未成立でも未処理rejection化しない保険
    const onError = (err) => {
      failPublish(err instanceof Error ? err : new Error(`MQTT client error: ${err}`));
    };
    const onClose = () => {
      failPublish(new Error('MQTT connection closed before publish completed.'));
    };
    client.once('error', onError);
    client.once('close', onClose);

    try {
      await Promise.race([client.publish(this.topic, payload), connectionFailed]);
    } finally {
      client.removeListener('error', onError);
      client.removeListener('close', onClose);
    }
    // await this.disconnect();
  }
}
module.exports = Mqtt;
