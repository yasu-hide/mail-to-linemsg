const assert = require('assert');
const asyncMqtt = require('async-mqtt');
const { EventEmitter } = require('node:events');
const Mqtt = require('../mqtt-publish');

const originalConnect = asyncMqtt.connect;

const createFakeClient = () => {
  const client = new EventEmitter();
  client.connected = true;
  client.publish = async () => {};
  client.end = async () => {};
  client.trigger = (event, ...args) => client.emit(event, ...args);
  return client;
};

const withStubbedConnect = async (stub, fn) => {
  asyncMqtt.connect = stub;
  try {
    await fn();
  } finally {
    asyncMqtt.connect = originalConnect;
  }
};

const baseOptions = () => ({
  uri: 'mqtt://broker.example:1883',
  username: 'user',
  password: 'pass',
  topic: 'test/topic',
});

const run = async () => {
  // 1. constructor: missing required parameter throws.
  {
    ['uri', 'username', 'password', 'topic'].forEach((param) => {
      const options = baseOptions();
      options[param] = null;
      assert.throws(
        () => new Mqtt(options),
        new RegExp(`Required parameter ${param} is missing\\.`),
      );
    });
  }

  // 2. mqtt:// is allowed (regression).
  {
    const calls = [];
    await withStubbedConnect(
      (uri, opts) => {
        calls.push({ uri, opts, client: createFakeClient() });
        return calls[calls.length - 1].client;
      },
      async () => {
        const mqttClient = new Mqtt(baseOptions());
        await assert.doesNotReject(() => mqttClient.publish('subject'));
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].uri, 'mqtt://broker.example:1883');
      },
    );
  }

  // 3. mqtts:// is allowed (the fix) and no TLS cert options are added.
  {
    const calls = [];
    await withStubbedConnect(
      (uri, opts) => {
        calls.push({ uri, opts, client: createFakeClient() });
        return calls[calls.length - 1].client;
      },
      async () => {
        const mqttClient = new Mqtt({
          ...baseOptions(),
          uri: 'mqtts://broker.example:8883',
        });
        await assert.doesNotReject(() => mqttClient.publish('subject'));
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].uri, 'mqtts://broker.example:8883');
        ['rejectUnauthorized', 'ca', 'cert', 'key'].forEach((key) => {
          assert.strictEqual(
            Object.prototype.hasOwnProperty.call(calls[0].opts, key),
            false,
          );
        });
      },
    );
  }

  // 4. disallowed schemes are rejected and connect() is never called.
  {
    const calls = [];
    await withStubbedConnect(
      (uri, opts) => {
        calls.push({ uri, opts, client: createFakeClient() });
        return calls[calls.length - 1].client;
      },
      async () => {
        const disallowedUris = [
          'http://broker.example',
          'ws://broker.example',
          'broker.example:1883',
        ];
        for (const uri of disallowedUris) {
          const mqttClient = new Mqtt({ ...baseOptions(), uri });
          await assert.rejects(
            () => mqttClient.publish('subject'),
            /MQTT_URI must start with mqtt:\/\/ or mqtts:\/\//,
          );
        }
        assert.strictEqual(calls.length, 0);
      },
    );
  }

  // 5. publish() sends the correct topic and payload (regression).
  {
    const publishCalls = [];
    await withStubbedConnect(
      () => {
        const client = createFakeClient();
        client.publish = async (topic, payload) => {
          publishCalls.push({ topic, payload });
        };
        return client;
      },
      async () => {
        const mqttClient = new Mqtt(baseOptions());
        await mqttClient.publish('件名');
        assert.strictEqual(publishCalls.length, 1);
        assert.strictEqual(publishCalls[0].topic, 'test/topic');
        assert.deepStrictEqual(JSON.parse(publishCalls[0].payload), {
          data: '件名の通知があります',
        });
      },
    );
  }

  // 6. connect() dedup guard: a second publish() while still connected
  //    must not open a second connection.
  {
    const calls = [];
    await withStubbedConnect(
      (uri, opts) => {
        calls.push({ uri, opts, client: createFakeClient() });
        return calls[calls.length - 1].client;
      },
      async () => {
        const mqttClient = new Mqtt(baseOptions());
        await mqttClient.publish('subject');
        await mqttClient.publish('subject');
        assert.strictEqual(calls.length, 1);
      },
    );
  }

  // 7. close handler: when the current client closes, the reference is
  //    cleared so the next publish() reconnects.
  {
    const calls = [];
    await withStubbedConnect(
      (uri, opts) => {
        calls.push({ uri, opts, client: createFakeClient() });
        return calls[calls.length - 1].client;
      },
      async () => {
        const mqttClient = new Mqtt(baseOptions());
        await mqttClient.publish('subject');
        assert.strictEqual(calls.length, 1);

        calls[0].client.trigger('close');
        await mqttClient.publish('subject');
        assert.strictEqual(calls.length, 2);
      },
    );
  }

  // 8. close handler: a stale close from a superseded client must not
  //    clear the reference to the current client.
  {
    const calls = [];
    await withStubbedConnect(
      (uri, opts) => {
        calls.push({ uri, opts, client: createFakeClient() });
        return calls[calls.length - 1].client;
      },
      async () => {
        const mqttClient = new Mqtt(baseOptions());
        await mqttClient.publish('subject'); // client A
        calls[0].client.trigger('close'); // clears the reference
        await mqttClient.publish('subject'); // client B
        assert.strictEqual(calls.length, 2);

        calls[0].client.trigger('close'); // stale close from A, ignored
        await mqttClient.publish('subject'); // still connected via B
        assert.strictEqual(calls.length, 2);
      },
    );
  }

  // 9. disconnect(): ends a connected client and clears the reference;
  //    a no-op when there is no client.
  {
    const calls = [];
    const endCalls = [];
    await withStubbedConnect(
      () => {
        const client = createFakeClient();
        client.end = async () => {
          endCalls.push(true);
        };
        calls.push(client);
        return client;
      },
      async () => {
        const mqttClient = new Mqtt(baseOptions());
        await mqttClient.publish('subject');
        await mqttClient.disconnect();
        assert.strictEqual(endCalls.length, 1);

        await mqttClient.publish('subject');
        assert.strictEqual(calls.length, 2);
      },
    );

    const mqttClient = new Mqtt(baseOptions());
    await assert.doesNotReject(() => mqttClient.disconnect());
  }

  // 10. connection error while publish is pending: reject immediately with
  //     the real error instead of hanging forever, and remove the
  //     temporary listeners afterwards.
  {
    const calls = [];
    await withStubbedConnect(
      (uri, opts) => {
        const client = createFakeClient();
        client.publish = () => new Promise(() => {});
        calls.push({ uri, opts, client });
        return client;
      },
      async () => {
        const mqttClient = new Mqtt(baseOptions());
        const publishPromise = mqttClient.publish('subject');
        calls[0].client.trigger('error', new Error('connack timeout'));
        await assert.rejects(publishPromise, /connack timeout/);
        assert.strictEqual(calls[0].client.listenerCount('error'), 1);
        assert.strictEqual(calls[0].client.listenerCount('close'), 1);
      },
    );
  }

  // 11. connection close while publish is pending: reject immediately, and
  //     the next publish() reconnects with a new client.
  {
    const calls = [];
    await withStubbedConnect(
      (uri, opts) => {
        const client = createFakeClient();
        client.publish = () => new Promise(() => {});
        calls.push({ uri, opts, client });
        return client;
      },
      async () => {
        const mqttClient = new Mqtt(baseOptions());
        const publishPromise = mqttClient.publish('subject');
        calls[0].client.trigger('close');
        await assert.rejects(
          publishPromise,
          /MQTT connection closed before publish completed\./,
        );

        const secondPublishPromise = mqttClient.publish('subject');
        calls[1].client.trigger('close');
        await assert.rejects(
          secondPublishPromise,
          /MQTT connection closed before publish completed\./,
        );
        assert.strictEqual(calls.length, 2);
      },
    );
  }

  // 12. successful publishes do not leak error/close listeners.
  {
    const calls = [];
    await withStubbedConnect(
      (uri, opts) => {
        calls.push({ uri, opts, client: createFakeClient() });
        return calls[calls.length - 1].client;
      },
      async () => {
        const mqttClient = new Mqtt(baseOptions());
        await mqttClient.publish('subject');
        await mqttClient.publish('subject');
        await mqttClient.publish('subject');
        assert.strictEqual(calls[0].client.listenerCount('error'), 1);
        assert.strictEqual(calls[0].client.listenerCount('close'), 1);
      },
    );
  }

  // 13. concurrent in-flight publishes: both temporary listeners coexist,
  //     both reject on the same error, and listeners are cleaned up after.
  {
    const calls = [];
    await withStubbedConnect(
      (uri, opts) => {
        const client = createFakeClient();
        client.publish = () => new Promise(() => {});
        calls.push({ uri, opts, client });
        return client;
      },
      async () => {
        const mqttClient = new Mqtt(baseOptions());
        const firstPublishPromise = mqttClient.publish('subject');
        const secondPublishPromise = mqttClient.publish('subject');
        assert.strictEqual(calls[0].client.listenerCount('close'), 3);

        calls[0].client.trigger('error', new Error('connack timeout'));
        await assert.rejects(firstPublishPromise, /connack timeout/);
        await assert.rejects(secondPublishPromise, /connack timeout/);
        assert.strictEqual(calls[0].client.listenerCount('error'), 1);
        assert.strictEqual(calls[0].client.listenerCount('close'), 1);
      },
    );
  }

  console.log('mqtt-publish tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
