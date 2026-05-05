const assert = require('assert');
const path = require('path');
const request = require('supertest');
const {
  InboundParseWebhookSignatureError,
} = require('../lib/inbound-parse-webhook-signature');
const { createApp } = require('../app/create-app');

const rootDir = path.join(__dirname, '..');

const createTestApp = ({
  limit = 300,
  verifyInboundParseWebhookSignature = () => {},
  pushMessage = async () => ({}),
} = {}) => createApp({
  rootDir,
  config: {
    helmetOption: {
      contentSecurityPolicy: false,
    },
    lineLoginConfig: {
      channelId: 'login-channel',
      channelSecret: 'login-secret',
      callbackUrl: 'http://example.test/callback',
    },
    msgbotConfig: {
      channelAccessToken: 'messaging-token',
      channelSecret: 'messaging-secret',
    },
    sessionOptions: {
      secret: 'test-session-secret',
      resave: false,
      saveUninitialized: false,
    },
    mailWebhookRateLimit: {
      windowMs: 60 * 1000,
      limit,
    },
  },
  db: {
    getUserByExtUserId: async () => null,
    getRecipientAll: async () => [],
    getEnabledRecipientByEmail: async () => ({
      line_recipient_id: 'U1234567890',
    }),
  },
  msgbot: {
    getGroupSummary: async () => ({ groupName: 'group' }),
    getGroupMemberProfile: async () => ({}),
    getProfile: async () => ({ displayName: 'self' }),
    pushMessage,
  },
  mqttPublish: null,
  lineWebhookMiddleware: (req, res, next) => {
    req.body = { events: [] };
    next();
  },
  verifyInboundParseWebhookSignature,
});

const postMailWebhook = (app) => request(app)
  .post('/mail-webhook')
  .field('to', 'notify@example.test')
  .field('from', 'sender@example.test')
  .field('subject', 'subject')
  .field('text', 'body');

const run = async () => {
  {
    let verifiedRawBodyLength = 0;
    let pushedText = '';
    const app = createTestApp({
      verifyInboundParseWebhookSignature: ({ rawBody }) => {
        verifiedRawBodyLength = rawBody.length;
      },
      pushMessage: async ({ messages }) => {
        pushedText = messages[0].text;
      },
    });
    const res = await postMailWebhook(app);
    assert.strictEqual(res.status, 200);
    assert.ok(verifiedRawBodyLength > 0);
    assert.match(pushedText, /From: sender@example\.test/);
    assert.match(pushedText, /Subject: subject/);
  }

  {
    const app = createTestApp({
      verifyInboundParseWebhookSignature: () => {
        throw new InboundParseWebhookSignatureError(
          'WEBHOOK_SIGNATURE_INVALID',
          'Webhook signature is invalid.',
          401,
        );
      },
    });
    const res = await postMailWebhook(app);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error.code, 'WEBHOOK_SIGNATURE_INVALID');
  }

  {
    const app = createTestApp({ limit: 1 });
    const firstRes = await postMailWebhook(app);
    assert.strictEqual(firstRes.status, 200);

    const limitedRes = await postMailWebhook(app);
    assert.strictEqual(limitedRes.status, 429);
    assert.ok(limitedRes.headers['x-request-id']);
    assert.strictEqual(limitedRes.body.requestId, limitedRes.headers['x-request-id']);
    assert.strictEqual(limitedRes.body.error.code, 'WEBHOOK_RATE_LIMIT_EXCEEDED');
    assert.strictEqual(limitedRes.body.error.message, 'Webhook rate limit exceeded.');
  }

  console.log('mail-webhook-rate-limit tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
