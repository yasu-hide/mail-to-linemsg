const assert = require('assert');
const path = require('path');
const request = require('supertest');
const { createErrorMiddleware } = require('../lib/errors');
const { createPageRoutes } = require('../routes/page-routes');
const {
  createTestLogger,
  createBaseApp,
  createFakeSession,
  withStubbedFetch,
} = require('./helpers/route-test-app');

const rootDir = path.join(__dirname, '..');

const defaultLineLoginConfig = {
  channelId: 'login-channel',
  channelSecret: 'login-secret',
  callbackUrl: 'http://example.test/callback',
};

// createLogCorrelationId を持たないロガー（L76-80 の undefined 分岐を確認するため）。
const createBarebonesLogger = () => {
  const calls = [];
  return {
    calls,
    logInfo: (event, payload) => calls.push({ level: 'info', event, payload }),
    logWarn: (event, payload) => calls.push({ level: 'warn', event, payload }),
    logError: (event, payload) => calls.push({ level: 'error', event, payload }),
  };
};

// createRequestId のスタブ。呼び出しごとに異なる値を返す（state と nonce を区別するため）。
const createSequentialRequestId = () => {
  let n = 0;
  return () => {
    n += 1;
    return `req-id-${n}`;
  };
};

const okResponse = (payload) => ({ ok: true, status: 200, json: async () => payload });
const errorResponse = (status, payload = {}) => ({ ok: false, status, json: async () => payload });

// LINE API (token/verify) 向けの fetch スタブ。呼び出し履歴 (url, options) を calls に記録する。
const createLineFetchStub = ({ tokenResponse = okResponse({}), verifyResponse = okResponse({}) } = {}) => {
  const calls = [];
  const stub = async (url, options) => {
    calls.push({ url, options });
    if (String(url).includes('oauth2/v2.1/token')) {
      return tokenResponse;
    }
    if (String(url).includes('oauth2/v2.1/verify')) {
      return verifyResponse;
    }
    throw new Error(`unexpected fetch url: ${url}`);
  };
  stub.calls = calls;
  return stub;
};

// ケースごとに fresh な app を作る。view engine / fake session / createPageRoutes / error middleware をまとめて載せる。
const createTestApp = ({
  db: dbOverrides = {},
  msgbot: msgbotOverrides = {},
  helpers: helpersOverrides = {},
  lineLoginConfig = defaultLineLoginConfig,
  logger = createTestLogger(),
  createRequestId = createSequentialRequestId(),
  session: sessionOverrides = {},
} = {}) => {
  const app = createBaseApp();
  app.set('view engine', 'ejs');

  const session = createFakeSession(sessionOverrides);
  app.use((req, res, next) => {
    req.session = session;
    next();
  });

  const db = {
    getRegisteredAddrByExtUserId: async () => ({}),
    addUser: async () => ({ ext_user_id: 'default-ext-user-id' }),
    addRecipient: async () => {},
    ...dbOverrides,
  };
  const msgbot = {
    getProfile: async () => ({ displayName: 'self' }),
    ...msgbotOverrides,
  };
  const helpers = {
    isLoggedIn: async () => false,
    ...helpersOverrides,
  };

  app.use(createPageRoutes({
    rootDir,
    db,
    msgbot,
    lineLoginConfig,
    helpers,
    logger,
    createRequestId,
    authRateLimit: { windowMs: 60000, limit: 1000 },
  }));
  app.use(createErrorMiddleware());

  return { app, db, msgbot, helpers, logger, session };
};

// /callback 失敗系の共通アサーション: 302 login_failed + session.destroy + auth.callback.failed ログ。
const assertCallbackFailed = (res, session, logger) => {
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.location, '/login?reason=login_failed');
  assert.strictEqual(session.destroyCalls, 1);
  assert.ok(logger.calls.some((c) => c.event === 'auth.callback.failed'));
};

const run = async () => {
  // ---- GET / ----
  {
    // 1. 未ログイン → 302、Location は /login
    const { app } = createTestApp({
      helpers: { isLoggedIn: async () => false },
    });
    const res = await request(app).get('/');

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/login');
  }
  {
    // 2. ログイン済み → 200、getRegisteredAddrByExtUserId が session の userId で呼ばれる
    let getRegisteredAddrArgs = null;
    const { app } = createTestApp({
      session: { userId: 'ext-user-id' },
      helpers: { isLoggedIn: async () => true },
      db: {
        getRegisteredAddrByExtUserId: async (...args) => {
          getRegisteredAddrArgs = args;
          return {};
        },
      },
    });
    const res = await request(app).get('/');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(getRegisteredAddrArgs, ['ext-user-id']);
  }

  {
    // 2b. getRegisteredAddrByExtUserId が reject した場合、next(error) 経由でエラーミドルウェアに渡り 500 になる
    const { app } = createTestApp({
      session: { userId: 'ext-user-id' },
      helpers: { isLoggedIn: async () => true },
      db: {
        getRegisteredAddrByExtUserId: async () => { throw new Error('db error'); },
      },
    });
    const res = await request(app).get('/');

    assert.strictEqual(res.status, 500);
  }

  // ---- GET /login ----
  {
    // 3. ログイン済み → 302、Location は /
    const { app } = createTestApp({
      helpers: { isLoggedIn: async () => true },
    });
    const res = await request(app).get('/login');

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/');
  }
  {
    // 4. 未ログイン → 200
    const { app } = createTestApp({
      helpers: { isLoggedIn: async () => false },
    });
    const res = await request(app).get('/login');

    assert.strictEqual(res.status, 200);
  }

  // ---- GET /logout ----
  {
    // 5. session.destroy が呼ばれ、302 Location /login?reason=logged_out
    const { app, session } = createTestApp();
    const res = await request(app).get('/logout');

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/login?reason=logged_out');
    assert.strictEqual(session.destroyCalls, 1);
  }

  // ---- GET /auth ----
  {
    // 6. 設定不備（channelId欠落 / channelSecret欠落 / callbackUrl欠落）→ 500 JSON + auth.config.invalid ログ
    const invalidConfigs = [
      { channelSecret: 'login-secret', callbackUrl: 'http://example.test/callback' },
      { channelId: 'login-channel', callbackUrl: 'http://example.test/callback' },
      { channelId: 'login-channel', channelSecret: 'login-secret' },
    ];
    for (const lineLoginConfig of invalidConfigs) {
      const { app, logger } = createTestApp({ lineLoginConfig });
      const res = await request(app).get('/auth');

      assert.strictEqual(res.status, 500);
      assert.deepStrictEqual(res.body, { msg: 'LINE login configuration is invalid.' });
      assert.ok(logger.calls.some((c) => c.event === 'auth.config.invalid'));
    }
  }
  {
    // 7. 正常 → 302、authorize URL のクエリと session に保存された state/nonce が一致
    const { app, session } = createTestApp();
    const res = await request(app).get('/auth');

    assert.strictEqual(res.status, 302);
    const { location } = res.headers;
    assert.ok(location.startsWith('https://access.line.me/oauth2/v2.1/authorize?'));
    const url = new URL(location);
    assert.strictEqual(url.searchParams.get('response_type'), 'code');
    assert.strictEqual(url.searchParams.get('client_id'), 'login-channel');
    assert.strictEqual(url.searchParams.get('redirect_uri'), 'http://example.test/callback');
    assert.strictEqual(url.searchParams.get('scope'), 'profile openid');
    assert.strictEqual(url.searchParams.get('state'), session.line_login_state);
    assert.strictEqual(url.searchParams.get('nonce'), session.line_login_nonce);
    assert.notStrictEqual(url.searchParams.get('state'), url.searchParams.get('nonce'));
  }

  // ---- GET /callback 失敗系 ----
  {
    // 8. code欠落（state のみ）→ fetch は呼ばれない
    const fetchStub = createLineFetchStub();
    await withStubbedFetch(fetchStub, async () => {
      const { app, session, logger } = createTestApp({
        session: { line_login_state: 'state-1' },
      });
      const res = await request(app).get('/callback').query({ state: 'state-1' });

      assertCallbackFailed(res, session, logger);
      assert.strictEqual(fetchStub.calls.length, 0);
    });
  }
  {
    // 9. state欠落（code のみ）→ fetch は呼ばれない
    const fetchStub = createLineFetchStub();
    await withStubbedFetch(fetchStub, async () => {
      const { app, session, logger } = createTestApp({
        session: { line_login_state: 'state-1' },
      });
      const res = await request(app).get('/callback').query({ code: 'code-1' });

      assertCallbackFailed(res, session, logger);
      assert.strictEqual(fetchStub.calls.length, 0);
    });
  }
  {
    // 10. state不一致 → fetch は呼ばれない
    const fetchStub = createLineFetchStub();
    await withStubbedFetch(fetchStub, async () => {
      const { app, session, logger } = createTestApp({
        session: { line_login_state: 'state-1' },
      });
      const res = await request(app).get('/callback').query({ code: 'code-1', state: 'other-state' });

      assertCallbackFailed(res, session, logger);
      assert.strictEqual(fetchStub.calls.length, 0);
    });
  }
  {
    // 11. token API が non-ok → verify は呼ばれない
    const fetchStub = createLineFetchStub({
      tokenResponse: errorResponse(400, { error_description: 'invalid code' }),
    });
    await withStubbedFetch(fetchStub, async () => {
      const { app, session, logger } = createTestApp({
        session: { line_login_state: 'state-1' },
      });
      const res = await request(app).get('/callback').query({ code: 'code-1', state: 'state-1' });

      assertCallbackFailed(res, session, logger);
      assert.strictEqual(fetchStub.calls.length, 1);
    });
  }
  {
    // 11b. token API が non-ok（error_description なし）→ json.error フォールバック
    const fetchStub = createLineFetchStub({
      tokenResponse: errorResponse(400, { error: 'invalid_request' }),
    });
    await withStubbedFetch(fetchStub, async () => {
      const { app, session, logger } = createTestApp({
        session: { line_login_state: 'state-1' },
      });
      const res = await request(app).get('/callback').query({ code: 'code-1', state: 'state-1' });

      assertCallbackFailed(res, session, logger);
      assert.strictEqual(fetchStub.calls.length, 1);
    });
  }
  {
    // 11c. token API が non-ok（エラー情報なし）→ ステータス文言フォールバック
    const fetchStub = createLineFetchStub({
      tokenResponse: errorResponse(400, {}),
    });
    await withStubbedFetch(fetchStub, async () => {
      const { app, session, logger } = createTestApp({
        session: { line_login_state: 'state-1' },
      });
      const res = await request(app).get('/callback').query({ code: 'code-1', state: 'state-1' });

      assertCallbackFailed(res, session, logger);
      assert.strictEqual(fetchStub.calls.length, 1);
    });
  }
  {
    // 12a. token応答不正: expires_in が 0（id_token あり）
    const fetchStub = createLineFetchStub({
      tokenResponse: okResponse({ expires_in: 0, id_token: 'idtoken' }),
    });
    await withStubbedFetch(fetchStub, async () => {
      const { app, session, logger } = createTestApp({
        session: { line_login_state: 'state-1' },
      });
      const res = await request(app).get('/callback').query({ code: 'code-1', state: 'state-1' });

      assertCallbackFailed(res, session, logger);
      assert.strictEqual(fetchStub.calls.length, 1);
    });
  }
  {
    // 12b. token応答不正: id_token 欠落（expires_in > 0）
    const fetchStub = createLineFetchStub({
      tokenResponse: okResponse({ expires_in: 3600 }),
    });
    await withStubbedFetch(fetchStub, async () => {
      const { app, session, logger } = createTestApp({
        session: { line_login_state: 'state-1' },
      });
      const res = await request(app).get('/callback').query({ code: 'code-1', state: 'state-1' });

      assertCallbackFailed(res, session, logger);
      assert.strictEqual(fetchStub.calls.length, 1);
    });
  }
  {
    // 13. verify 応答で sub 欠落
    const fetchStub = createLineFetchStub({
      tokenResponse: okResponse({ expires_in: 3600, id_token: 'idtoken' }),
      verifyResponse: okResponse({ nonce: 'nonce-1' }),
    });
    await withStubbedFetch(fetchStub, async () => {
      const { app, session, logger } = createTestApp({
        session: { line_login_state: 'state-1', line_login_nonce: 'nonce-1' },
      });
      const res = await request(app).get('/callback').query({ code: 'code-1', state: 'state-1' });

      assertCallbackFailed(res, session, logger);
      assert.strictEqual(fetchStub.calls.length, 2);
    });
  }
  {
    // 14. verify 応答で nonce 不一致
    const fetchStub = createLineFetchStub({
      tokenResponse: okResponse({ expires_in: 3600, id_token: 'idtoken' }),
      verifyResponse: okResponse({ sub: 'U123', nonce: 'wrong-nonce' }),
    });
    await withStubbedFetch(fetchStub, async () => {
      const { app, session, logger } = createTestApp({
        session: { line_login_state: 'state-1', line_login_nonce: 'nonce-1' },
      });
      const res = await request(app).get('/callback').query({ code: 'code-1', state: 'state-1' });

      assertCallbackFailed(res, session, logger);
      assert.strictEqual(fetchStub.calls.length, 2);
    });
  }

  // ---- GET /callback 成功系 ----
  {
    // 15. 成功: addUser/addRecipient/regenerate/session クリア/リダイレクト/token リクエスト body を検証
    const fetchStub = createLineFetchStub({
      tokenResponse: okResponse({ expires_in: 3600, id_token: 'idtoken' }),
      verifyResponse: okResponse({ sub: 'U123', nonce: 'nonce-1' }),
    });
    let addUserArgs = null;
    let addRecipientArgs = null;
    await withStubbedFetch(fetchStub, async () => {
      const { app, session } = createTestApp({
        session: { line_login_state: 'state-1', line_login_nonce: 'nonce-1' },
        db: {
          addUser: async (...args) => {
            addUserArgs = args;
            return { ext_user_id: 'ext-1' };
          },
          addRecipient: async (...args) => { addRecipientArgs = args; },
        },
        msgbot: {
          getProfile: async () => ({ displayName: 'テストユーザー' }),
        },
      });
      const res = await request(app).get('/callback').query({ code: 'code-1', state: 'state-1' });

      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.location, '/');
      assert.deepStrictEqual(addUserArgs, ['U123']);
      assert.deepStrictEqual(addRecipientArgs, ['U123', 0, 'テストユーザー', 'ext-1']);
      assert.strictEqual(session.regenerateCalls, 1);
      assert.strictEqual(session.userId, 'ext-1');
      assert.strictEqual('line_login_state' in session, false);
      assert.strictEqual('line_login_nonce' in session, false);

      const tokenCall = fetchStub.calls.find((c) => String(c.url).includes('oauth2/v2.1/token'));
      assert.ok(tokenCall);
      assert.strictEqual(tokenCall.options.body.get('grant_type'), 'authorization_code');
      assert.strictEqual(tokenCall.options.body.get('client_secret'), 'login-secret');
    });
  }
  {
    // 16. msgbot.getProfile が reject → displayName フォールバック 'self' で addRecipient
    const fetchStub = createLineFetchStub({
      tokenResponse: okResponse({ expires_in: 3600, id_token: 'idtoken' }),
      verifyResponse: okResponse({ sub: 'U123', nonce: 'nonce-1' }),
    });
    let addRecipientArgs = null;
    await withStubbedFetch(fetchStub, async () => {
      const { app } = createTestApp({
        session: { line_login_state: 'state-1', line_login_nonce: 'nonce-1' },
        db: {
          addUser: async () => ({ ext_user_id: 'ext-1' }),
          addRecipient: async (...args) => { addRecipientArgs = args; },
        },
        msgbot: {
          getProfile: async () => { throw new Error('profile api down'); },
        },
      });
      const res = await request(app).get('/callback').query({ code: 'code-1', state: 'state-1' });

      assert.strictEqual(res.status, 302);
      assert.deepStrictEqual(addRecipientArgs, ['U123', 0, 'self', 'ext-1']);
    });
  }
  {
    // 17. displayName が64文字以上 → addRecipient の第3引数は先頭63文字
    const longDisplayName = 'あ'.repeat(70);
    const fetchStub = createLineFetchStub({
      tokenResponse: okResponse({ expires_in: 3600, id_token: 'idtoken' }),
      verifyResponse: okResponse({ sub: 'U123', nonce: 'nonce-1' }),
    });
    let addRecipientArgs = null;
    await withStubbedFetch(fetchStub, async () => {
      const { app } = createTestApp({
        session: { line_login_state: 'state-1', line_login_nonce: 'nonce-1' },
        db: {
          addUser: async () => ({ ext_user_id: 'ext-1' }),
          addRecipient: async (...args) => { addRecipientArgs = args; },
        },
        msgbot: {
          getProfile: async () => ({ displayName: longDisplayName }),
        },
      });
      const res = await request(app).get('/callback').query({ code: 'code-1', state: 'state-1' });

      assert.strictEqual(res.status, 302);
      assert.strictEqual(addRecipientArgs[2], longDisplayName.substring(0, 63));
      assert.strictEqual(addRecipientArgs[2].length, 63);
    });
  }

  // ---- logger 分岐 ----
  {
    // 18. logger が createLogCorrelationId を持たない（logInfo/logWarn/logError のみ）でも GET / が落ちない
    const barebonesLogger = createBarebonesLogger();
    const { app } = createTestApp({
      session: { userId: 'ext-user-id' },
      helpers: { isLoggedIn: async () => true },
      logger: barebonesLogger,
    });
    const res = await request(app).get('/');

    assert.strictEqual(res.status, 200);
    const renderCall = barebonesLogger.calls.find((c) => c.event === 'page.index.render');
    assert.ok(renderCall);
    assert.strictEqual(renderCall.payload.extUserKey, undefined);
  }

  console.log('page-routes tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
