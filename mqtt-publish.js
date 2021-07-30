const debug = require('debug')('mqtt-publish:module');
const mqtt = require('async-mqtt');

class Mqtt {
  constructor() {
    this.uri = String(process.env.MQTT_URI);
    this.username = String(process.env.MQTT_USERNAME);
    this.password = String(process.env.MQTT_PASSWORD || '');
    this.topic = String(process.env.MQTT_TOPIC);
    this.client = undefined;
  }

  connect() {
    if (!this.client || !this.client.connected) {
      debug(`Connecting to ${this.uri} username=${this.username} password=${this.password}`);
      this.client = mqtt.connect(this.uri, { username: this.username, password: this.password });
    }
  }

  async disconnect() {
    if (this.client && this.client.connected) {
      debug(`Disconnect from ${this.uri}`);
      await this.client.end();
    }
    this.client = undefined;
  }

  async publish(message = 'ライン') {
    if (!this.uri) {
      throw new Error('MQTT_URI is not defined.');
    }
    if (!this.uri.startsWith('mqtt://')) {
      throw new Error('MQTT_URI must start with mqtt://');
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
