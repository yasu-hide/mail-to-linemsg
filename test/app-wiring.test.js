const assert = require('assert');
const path = require('path');
const request = require('supertest');
const { createApp, createHelpers } = require('../app/create-app');

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

// process.stderr.write（logger.logWarn/logError の出力先）を一時的にスタブして書き込み内容を捕捉する。
const withStubbedStderr = async (fn) => {
  const original = process.stderr.write;
  const chunks = [];
  process.stderr.write = (chunk) => {
    chunks.push(chunk.toString());
    return true;
  };
  try {
    return await fn(chunks);
  } finally {
    process.stderr.write = original;
  }
};

// 指定した環境変数を一時的に上書きし、fn実行後に元の値へ復元する。
const withEnv = async (envOverrides, fn) => {
  const originals = {};
  for (const key of Object.keys(envOverrides)) {
    originals[key] = process.env[key];
    if (envOverrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = envOverrides[key];
    }
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(originals)) {
      if (originals[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originals[key];
      }
    }
  }
};

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

  // ---- createHelpers().isLoggedIn ----
  {
    // extUserId が falsy: db を呼ばずに false
    const helpers = createHelpers({
      db: { getUserByExtUserId: async () => { throw new Error('should not be called'); } },
      msgbot: {},
    });
    assert.strictEqual(await helpers.isLoggedIn(''), false);
  }

  {
    // db にユーザーが存在しない
    const helpers = createHelpers({
      db: { getUserByExtUserId: async () => null },
      msgbot: {},
    });
    assert.strictEqual(await helpers.isLoggedIn('ext-user-id'), false);
  }

  {
    // ユーザーは存在するが ext_user_id が不一致
    const helpers = createHelpers({
      db: { getUserByExtUserId: async () => ({ ext_user_id: 'other-id' }) },
      msgbot: {},
    });
    assert.strictEqual(await helpers.isLoggedIn('ext-user-id'), false);
  }

  {
    // ユーザーが存在し ext_user_id が一致
    const helpers = createHelpers({
      db: { getUserByExtUserId: async () => ({ ext_user_id: 'ext-user-id' }) },
      msgbot: {},
    });
    assert.strictEqual(await helpers.isLoggedIn('ext-user-id'), true);
  }

  // ---- createHelpers().requireAuthenticatedUser (成功系) ----
  {
    const helpers = createHelpers({
      db: { getUserByExtUserId: async () => ({ ext_user_id: 'ext-user-id' }) },
      msgbot: {},
    });
    const req = { session: { userId: 'ext-user-id' } };
    assert.strictEqual(await helpers.requireAuthenticatedUser(req), 'ext-user-id');
  }

  // ---- createHelpers().getAvailableRecipient ----
  {
    const groupProfileCalls = [];
    const recipientAll = [
      { ext_recipient_id: 'ext-user-id', recipient_type: 0, line_recipient_id: 'line-r-user' },
      { ext_recipient_id: 'other-ext-id', recipient_type: 0, line_recipient_id: 'line-r-other' },
      { ext_recipient_id: 'ext-user-id', recipient_type: 0, line_recipient_id: '' },
      { recipient_type: 1, line_recipient_id: 'line-r-group' },
      { recipient_type: 1, line_recipient_id: '' },
    ];
    const helpers = createHelpers({
      db: {
        getUserByExtUserId: async () => ({ line_user_id: 'line-user-id' }),
        getRecipientAll: async () => recipientAll,
      },
      msgbot: {
        getGroupMemberProfile: async (lineRecipientId, lineUserId) => {
          groupProfileCalls.push([lineRecipientId, lineUserId]);
          return {};
        },
      },
    });
    const result = await helpers.getAvailableRecipient('ext-user-id');
    // 個人受信者(一致・line_recipient_id あり)→グループ受信者(line_recipient_id あり)の順に連結される
    assert.deepStrictEqual(result, [recipientAll[0], recipientAll[3]]);
    assert.deepStrictEqual(groupProfileCalls, [['line-r-group', 'line-user-id']]);
  }

  // ---- createApp: 本番環境限定の分岐 ----
  {
    // trust proxy を設定し、SESSION_STORE 未設定なら警告ログを出す
    await withEnv({ NODE_ENV: 'production', SESSION_STORE: undefined }, () => withStubbedStderr((chunks) => {
      const app = createTestApp();
      assert.strictEqual(app.get('trust proxy'), 1);
      assert.ok(chunks.some((chunk) => chunk.includes('session.store.default_memory')));
    }));
  }

  {
    // SESSION_STORE 設定済みなら警告ログは出さない
    await withEnv({ NODE_ENV: 'production', SESSION_STORE: 'redis' }, () => withStubbedStderr((chunks) => {
      const app = createTestApp();
      assert.strictEqual(app.get('trust proxy'), 1);
      assert.strictEqual(chunks.some((chunk) => chunk.includes('session.store.default_memory')), false);
    }));
  }

  console.log('app-wiring tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
