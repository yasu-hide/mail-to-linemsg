const assert = require('assert');
const express = require('express');
const path = require('path');
const request = require('supertest');
const { createApp, createSessionOptions } = require('../app/create-app');
const { createErrorMiddleware } = require('../lib/errors');
const { createPageRoutes } = require('../routes/page-routes');

const rootDir = path.join(__dirname, '..');

const createLogger = () => ({
  logError: () => {},
  logInfo: () => {},
  logWarn: () => {},
});

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
      cookie: {
        secure: false,
      },
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
  mqttPublish: null,
  lineWebhookMiddleware: (req, res, next) => {
    req.body = { events: [] };
    next();
  },
  verifyInboundParseWebhookSignature: () => {},
});

const createPageErrorTestApp = () => {
  const app = express();
  const logger = createLogger();

  app.set('view engine', 'ejs');
  app.use((req, res, next) => {
    req.requestId = 'test-request-id';
    req.session = {
      userId: 'ext-user-id',
      destroy: () => {},
    };
    next();
  });
  app.use(createPageRoutes({
    rootDir,
    db: {
      getRegisteredAddrByExtUserId: async () => {
        throw new Error('database password leaked in stack');
      },
    },
    msgbot: {},
    lineLoginConfig: {
      channelId: 'login-channel',
      channelSecret: 'login-secret',
      callbackUrl: 'http://example.test/callback',
    },
    helpers: {
      isLoggedIn: async () => true,
    },
    logger,
    createRequestId: () => 'request-id',
  }));
  app.use(createErrorMiddleware());

  return app;
};

const run = async () => {
  {
    const secureOptions = createSessionOptions({
      sessionOptions: {
        secret: 'test-session-secret',
        cookie: {
          secure: false,
        },
      },
    });
    assert.strictEqual(secureOptions.cookie.secure, true);

    const defaultCookieOptions = createSessionOptions({
      sessionOptions: {
        secret: 'test-session-secret',
      },
    });
    assert.strictEqual(defaultCookieOptions.cookie.secure, true);
  }

  {
    const app = createTestApp({
      config: {
        apiRateLimit: {
          windowMs: 60 * 1000,
          limit: 1,
        },
      },
    });

    const firstRes = await request(app).get('/api/user');
    assert.strictEqual(firstRes.status, 401);

    const limitedRes = await request(app).get('/api/user');
    assert.strictEqual(limitedRes.status, 429);
    assert.strictEqual(limitedRes.body.error.code, 'API_RATE_LIMIT_EXCEEDED');
    assert.strictEqual(limitedRes.body.error.message, 'API rate limit exceeded.');
  }

  {
    const app = createTestApp({
      config: {
        authRateLimit: {
          windowMs: 60 * 1000,
          limit: 1,
        },
      },
    });

    const firstRes = await request(app).get('/auth');
    assert.strictEqual(firstRes.status, 302);

    const limitedRes = await request(app).get('/auth');
    assert.strictEqual(limitedRes.status, 429);
    assert.match(limitedRes.text, /Auth rate limit exceeded\./);
  }

  {
    const app = createTestApp({
      config: {
        authRateLimit: {
          windowMs: 60 * 1000,
          limit: 1,
        },
      },
    });

    const firstRes = await request(app).get('/callback');
    assert.strictEqual(firstRes.status, 302);

    const limitedRes = await request(app).get('/callback');
    assert.strictEqual(limitedRes.status, 429);
    assert.match(limitedRes.text, /Auth rate limit exceeded\./);
  }

  {
    const app = createPageErrorTestApp();
    const res = await request(app).get('/');
    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.text, 'Internal server error.');
    assert.doesNotMatch(res.text, /database password leaked/);
    assert.doesNotMatch(res.text, /Error:/);
  }

  console.log('codeql-fixes tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
