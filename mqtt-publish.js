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
