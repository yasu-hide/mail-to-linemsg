const assert = require('assert');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../app/create-app');

const rootDir = path.join(__dirname, '..');

const createTestApp = (overrides = {}) => createApp({
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
    ...(overrides.config || {}),
  },
  db: {
    getUserByExtUserId: async () => null,
    getRecipientAll: async () => [],
    ...(overrides.db || {}),
  },
  msgbot: {
    getGroupMemberProfile: async () => ({}),
    getGroupSummary: async () => ({ groupName: 'group' }),
    getProfile: async () => ({ displayName: 'self' }),
    pushMessage: async () => ({}),
    ...(overrides.msgbot || {}),
  },
  mqttPublish: Object.prototype.hasOwnProperty.call(overrides, 'mqttPublish')
    ? overrides.mqttPublish
    : null,
  lineWebhookMiddleware: overrides.lineWebhookMiddleware || ((req, res, next) => {
    req.body = { events: [] };
    next();
  }),
  verifyInboundParseWebhookSignature: overrides.verifyInboundParseWebhookSignature || (() => {}),
});

const run = async () => {
  {
    const app = createTestApp();
    const res = await request(app).get('/login');
    assert.strictEqual(res.status, 200);
    assert.match(res.text, /LINE Web Login/);
  }

  {
    const app = createTestApp();
    const res = await request(app).get('/main.js');
    assert.strictEqual(res.status, 200);
    assert.match(res.text, /fetch/);
  }

  console.log('app-wiring tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
