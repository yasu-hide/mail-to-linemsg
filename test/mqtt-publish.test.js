const assert = require('assert');
const asyncMqtt = require('async-mqtt');
const Mqtt = require('../mqtt-publish');

const originalConnect = asyncMqtt.connect;

const createFakeClient = () => {
  const listeners = {};
  const client = {
    connected: true,
    on: (event, handler) => {
      listeners[event] = handler;
      return client;
    },
    publish: async () => {},
    end: async () => {},
    trigger: (event, ...args) => {
      if (listeners[event]) {
        listeners[event](...args);
      }
    },
  };
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

  console.log('mqtt-publish tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
