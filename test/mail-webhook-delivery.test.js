const assert = require('assert');
const express = require('express');
const request = require('supertest');
const { createErrorMiddleware } = require('../lib/errors');
const { createLogCorrelationId } = require('../lib/logger');
const { createWebhookRoutes } = require('../routes/webhook-routes');

const createCaptureLogger = () => {
  const entries = [];
  const capture = (level) => (event, details = {}) => {
    entries.push({
      level,
      event,
      ...details,
    });
  };

  return {
    entries,
    createLogCorrelationId,
    logError: capture('error'),
    logInfo: capture('info'),
    logWarn: capture('warn'),
  };
};

const createWebhookTestApp = ({
  logger,
  pushMessage = async () => ({}),
  mqttPublish = null,
  mqttPublishDeadlineMs,
  verifyInboundParseWebhookSignature = () => {},
} = {}) => {
  const app = express();
  const resolvedLogger = logger || createCaptureLogger();

  app.use((req, res, next) => {
    req.requestId = 'test-request-id';
    next();
  });
  app.use(createWebhookRoutes({
    db: {
      getEnabledRecipientByEmail: async () => ({
        line_recipient_id: 'U1234567890abcdef',
      }),
    },
    msgbot: {
      pushMessage,
    },
    mqttPublish,
    mqttPublishDeadlineMs,
    logger: resolvedLogger,
    verifyInboundParseWebhookSignature,
    mailWebhookRateLimit: {
      windowMs: 60 * 1000,
      limit: 300,
    },
    lineWebhookMiddleware: (req, res, next) => {
      req.body = { events: [] };
      next();
    },
  }));
  app.use(createErrorMiddleware());

  return {
    app,
    logger: resolvedLogger,
  };
};

const postMailWebhook = (app, fields = {}) => request(app)
  .post('/mail-webhook')
  .field('to', fields.to || 'notify@example.test')
  .field('from', fields.from || 'sender-secret@example.test')
  .field('subject', fields.subject || 'private subject')
  .field('text', fields.text || 'private body');

const getEvents = (logger) => logger.entries.map((entry) => entry.event);

const failingPush = () => {
  const error = new Error('LINE API failed');
  error.statusCode = 503;
  error.headers = new Map([['x-line-request-id', 'line-request-id']]);
  throw error;
};

const assertNoSensitiveContent = (res, logger) => {
  const serialized = JSON.stringify({ body: res.body, entries: logger.entries });
  assert.doesNotMatch(serialized, /sender-secret@example\.test/);
  assert.doesNotMatch(serialized, /private subject/);
  assert.doesNotMatch(serialized, /private body/);
  assert.doesNotMatch(serialized, /U1234567890abcdef/);
  assert.doesNotMatch(serialized, /notify/);
};

const run = async () => {
  // 1. LINE ok + MQTT ok => 200
  {
    const logger = createCaptureLogger();
    let published;
    const { app } = createWebhookTestApp({
      logger,
      mqttPublish: { topic: 'test/topic', publish: async (subject) => { published = subject; } },
    });
    const res = await postMailWebhook(app);
    const events = getEvents(logger);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(published, 'private subject');
    assert.ok(events.includes('line.push.succeeded'));
    assert.ok(events.includes('mqtt.publish.succeeded'));
    const succeededLog = logger.entries.find((entry) => entry.event === 'mqtt.publish.succeeded');
    assert.strictEqual(typeof succeededLog.elapsedMs, 'number');
  }

  // 2. LINE ok + MQTT fail => 207
  {
    const logger = createCaptureLogger();
    const { app } = createWebhookTestApp({
      logger,
      mqttPublish: { topic: 'test/topic', publish: async () => { throw new Error('mqtt down'); } },
    });
    const res = await postMailWebhook(app);
    const events = getEvents(logger);

    assert.strictEqual(res.status, 207);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.requestId, 'test-request-id');
    assert.deepStrictEqual(res.body.delivered, ['line']);
    assert.deepStrictEqual(res.body.failed, ['mqtt']);
    assert.ok(events.includes('mqtt.publish.failed'));
    assert.ok(events.includes('mail_webhook.partial_success'));
    assertNoSensitiveContent(res, logger);
  }

  // 3. LINE fail + MQTT ok => 207 (MQTT runs even though LINE failed)
  {
    const logger = createCaptureLogger();
    let published = false;
    const { app } = createWebhookTestApp({
      logger,
      pushMessage: async () => failingPush(),
      mqttPublish: { topic: 'test/topic', publish: async () => { published = true; } },
    });
    const res = await postMailWebhook(app);
    const events = getEvents(logger);

    assert.strictEqual(res.status, 207);
    assert.strictEqual(published, true);
    assert.deepStrictEqual(res.body.delivered, ['mqtt']);
    assert.deepStrictEqual(res.body.failed, ['line']);
    assert.ok(events.includes('mqtt.publish.succeeded'));
    assert.ok(events.includes('line.push.failed'));
    assertNoSensitiveContent(res, logger);
  }

  // 4. LINE fail + MQTT fail => 502 (LINE_PUSH_FAILED preserved)
  {
    const logger = createCaptureLogger();
    const { app } = createWebhookTestApp({
      logger,
      pushMessage: async () => failingPush(),
      mqttPublish: { topic: 'test/topic', publish: async () => { throw new Error('mqtt down'); } },
    });
    const res = await postMailWebhook(app);
    const events = getEvents(logger);

    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.error.code, 'LINE_PUSH_FAILED');
    assert.ok(events.includes('line.push.failed'));
    assert.ok(events.includes('mqtt.publish.failed'));
    assertNoSensitiveContent(res, logger);
  }

  // 4b. Both fail, LINE error without headers and using `status` (not statusCode)
  //     => 502 LINE_PUSH_FAILED (covers the no-headers / status-fallback branches)
  {
    const logger = createCaptureLogger();
    const { app } = createWebhookTestApp({
      logger,
      pushMessage: async () => {
        const error = new Error('LINE unavailable');
        error.status = 503;
        throw error;
      },
      mqttPublish: { topic: 'test/topic', publish: async () => { throw new Error('mqtt down'); } },
    });
    const res = await postMailWebhook(app);
    const events = getEvents(logger);

    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.error.code, 'LINE_PUSH_FAILED');
    assert.strictEqual(res.body.error.details.statusCode, 503);
    assert.strictEqual(res.body.error.details.lineRequestId, undefined);
    assert.ok(events.includes('line.push.retry'));
    assert.ok(events.includes('mqtt.publish.failed'));
  }

  // 5. mqttPublish null + LINE ok => 200 (single channel never 207)
  {
    const logger = createCaptureLogger();
    const { app } = createWebhookTestApp({ logger, mqttPublish: null });
    const res = await postMailWebhook(app);

    assert.strictEqual(res.status, 200);
    assert.ok(getEvents(logger).includes('line.push.succeeded'));
  }

  // 6. mqttPublish null + LINE fail => 502 LINE_PUSH_FAILED
  {
    const logger = createCaptureLogger();
    const { app } = createWebhookTestApp({
      logger,
      pushMessage: async () => failingPush(),
      mqttPublish: null,
    });
    const res = await postMailWebhook(app);

    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.error.code, 'LINE_PUSH_FAILED');
  }

  // 7. MQTT is not retried in-request: a single failure => 207, publish called once.
  {
    const logger = createCaptureLogger();
    let attempts = 0;
    const { app } = createWebhookTestApp({
      logger,
      mqttPublish: {
        topic: 'test/topic',
        publish: async () => {
          attempts += 1;
          throw new Error('transient');
        },
      },
    });
    const res = await postMailWebhook(app);
    const events = getEvents(logger);

    assert.strictEqual(res.status, 207);
    assert.strictEqual(attempts, 1);
    assert.ok(!events.includes('mqtt.publish.retry'));
    assert.ok(events.includes('mqtt.publish.failed'));
  }

  // 8. MQTT hangs => channel deadline fails it => 207 (no hang).
  //    Inject a small deadline so the test stays fast.
  {
    const logger = createCaptureLogger();
    const { app } = createWebhookTestApp({
      logger,
      mqttPublish: { topic: 'test/topic', publish: () => new Promise(() => {}) },
      mqttPublishDeadlineMs: 150,
    });
    const res = await postMailWebhook(app);
    const failedLog = logger.entries.find((entry) => entry.event === 'mqtt.publish.failed');

    assert.strictEqual(res.status, 207);
    assert.deepStrictEqual(res.body.delivered, ['line']);
    assert.deepStrictEqual(res.body.failed, ['mqtt']);
    assert.strictEqual(failedLog.message, 'MQTT publish deadline exceeded.');
    assert.strictEqual(typeof failedLog.elapsedMs, 'number');
    assert.strictEqual(failedLog.deadlineMs, 150);
  }

  console.log('mail webhook delivery tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
