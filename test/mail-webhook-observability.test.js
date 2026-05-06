const assert = require('assert');
const express = require('express');
const { Iconv } = require('iconv');
const request = require('supertest');
const {
  createMailWebhookHandler,
  decodeAndConvertMailPart,
} = require('../lib/mail-webhook');
const { createErrorMiddleware } = require('../lib/errors');
const {
  createLogCorrelationId,
} = require('../lib/logger');

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
  verifyInboundParseWebhookSignature = () => {},
} = {}) => {
  const app = express();
  const resolvedLogger = logger || createCaptureLogger();

  app.use((req, res, next) => {
    req.requestId = 'test-request-id';
    next();
  });
  app.post('/mail-webhook', createMailWebhookHandler({
    db: {
      getEnabledRecipientByEmail: async () => ({
        line_recipient_id: 'U1234567890abcdef',
      }),
    },
    msgbot: {
      pushMessage,
    },
    mqttPublish: null,
    logger: resolvedLogger,
    verifyInboundParseWebhookSignature,
  }));
  app.use(createErrorMiddleware());

  return {
    app,
    logger: resolvedLogger,
  };
};

const postMailWebhook = (app, fields = {}) => {
  const req = request(app)
    .post('/mail-webhook')
    .field('to', fields.to || 'notify@example.test')
    .field('from', fields.from || 'sender-secret@example.test')
    .field('subject', fields.subject || 'private subject')
    .field('text', fields.text || 'private body');

  if (Object.prototype.hasOwnProperty.call(fields, 'charsets')) {
    req.field('charsets', fields.charsets);
  }

  return req;
};

const getEvents = (logger) => logger.entries.map(entry => entry.event);

const assertNoSensitiveLogContent = (logger) => {
  const serialized = JSON.stringify(logger.entries);

  assert.doesNotMatch(serialized, /sender-secret@example\.test/);
  assert.doesNotMatch(serialized, /private subject/);
  assert.doesNotMatch(serialized, /private body/);
  assert.doesNotMatch(serialized, /U1234567890abcdef/);
  assert.doesNotMatch(serialized, /notify/);
};

const run = async () => {
  {
    const logger = createCaptureLogger();
    const source = '日本語テスト123';
    const encoder = new Iconv('UTF-8', 'SHIFT_JIS//TRANSLIT//IGNORE');
    const sjisBuffer = encoder.convert(Buffer.from(source, 'utf8'));
    const result = decodeAndConvertMailPart({
      part: {
        headers: {
          'content-transfer-encoding': [''],
        },
        data: sjisBuffer,
      },
      charsetHint: 'windows-31j',
      partName: 'text',
      requestId: 'test-request-id',
      logger,
    });

    assert.strictEqual(result, source);
    assert.ok(getEvents(logger).includes('mail_webhook.part.charset_converted'));
  }

  {
    const logger = createCaptureLogger();
    const source = 'こんにちは世界';
    const encoder = new Iconv('UTF-8', 'ISO-2022-JP//TRANSLIT//IGNORE');
    const isoBuffer = encoder.convert(Buffer.from(source, 'utf8'));
    const result = decodeAndConvertMailPart({
      part: {
        headers: {
          'content-transfer-encoding': ['base64'],
        },
        data: Buffer.from(isoBuffer.toString('base64'), 'ascii'),
      },
      charsetHint: 'iso-2022-jp',
      partName: 'text',
      requestId: 'test-request-id',
      logger,
    });

    assert.strictEqual(result, source);
    assert.ok(getEvents(logger).includes('mail_webhook.part.transfer_decoded'));
    assert.ok(getEvents(logger).includes('mail_webhook.part.charset_converted'));
  }

  {
    const logger = createCaptureLogger();
    const result = decodeAndConvertMailPart({
      part: {
        headers: {
          'content-transfer-encoding': [''],
        },
        data: Buffer.from('fallback body', 'utf8'),
      },
      charsetHint: 'x-unsupported-charset',
      partName: 'text',
      requestId: 'test-request-id',
      logger,
    });

    assert.strictEqual(result, 'fallback body');
    assert.ok(getEvents(logger).includes('mail_webhook.part.charset_conversion_failed'));
  }

  {
    let pushedText = '';
    const logger = createCaptureLogger();
    const { app } = createWebhookTestApp({
      logger,
      pushMessage: async ({ messages }) => {
        pushedText = messages[0].text;
      },
    });

    const res = await postMailWebhook(app, {
      charsets: '{invalid-json}',
    });

    assert.strictEqual(res.status, 200);
    assert.match(pushedText, /private body/);
    assert.ok(getEvents(logger).includes('mail_webhook.invalid_charsets_ignored'));
    assert.ok(getEvents(logger).includes('line.push.succeeded'));
    assertNoSensitiveLogContent(logger);
  }

  {
    const logger = createCaptureLogger();
    const { app } = createWebhookTestApp({ logger });
    const res = await postMailWebhook(app);
    const events = getEvents(logger);
    const resolvedLog = logger.entries.find(entry => entry.event === 'mail_webhook.recipient.resolved');

    assert.strictEqual(res.status, 200);
    assert.ok(events.includes('mail_webhook.received'));
    assert.ok(events.includes('mail_webhook.signature.verified'));
    assert.ok(events.includes('mail_webhook.recipient.resolved'));
    assert.ok(events.includes('mail_webhook.body.selected'));
    assert.ok(events.includes('mail_webhook.message.prepared'));
    assert.ok(events.includes('line.push.started'));
    assert.ok(events.includes('line.push.succeeded'));
    assert.strictEqual(resolvedLog.lineRecipientKey.length, 12);
    assertNoSensitiveLogContent(logger);
  }

  {
    const logger = createCaptureLogger();
    const { app } = createWebhookTestApp({
      logger,
      pushMessage: async () => {
        const error = new Error('LINE API failed');
        error.statusCode = 503;
        error.headers = new Map([['x-line-request-id', 'line-request-id']]);
        throw error;
      },
    });

    const res = await postMailWebhook(app);

    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.error.code, 'LINE_PUSH_FAILED');
    assert.ok(getEvents(logger).includes('line.push.failed'));
    assertNoSensitiveLogContent(logger);
  }

  console.log('mail webhook observability tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
