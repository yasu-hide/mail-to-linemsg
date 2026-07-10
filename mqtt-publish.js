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
    debug(`Publish to ${this.topic} payload=${payload}`);
    await this.client.publish(this.topic, payload);
    // await this.disconnect();
  }
}
module.exports = Mqtt;
