const assert = require('assert');
const bodyParser = require('body-parser');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { doubleCsrf } = require('csrf-csrf');
const request = require('supertest');
const { createApiRoutes } = require('../routes/api-routes');
const { AppError, createErrorMiddleware } = require('../lib/errors');
const { createBaseApp } = require('./helpers/route-test-app');

// 各ケースで fresh な app と db/helpers スタブを生成する（ケース間汚染を防ぐ）。
// createApp は cookie.secure=true を強制し supertest(HTTP) では cookie が届かないため、
// スタンドアロンの express アプリに createApiRoutes を直接マウントする。
const createTestApp = (overrides = {}) => {
  const app = createBaseApp();
  const csrf = doubleCsrf({
    getSecret: () => 'csrf-test-secret',
    getSessionIdentifier: (req) => req.sessionID || '',
    getTokenFromRequest: (req) => req.headers['x-csrf-token'],
    cookieName: '__Host-mail-to-linemsg.test-csrf-token',
    cookieOptions: {
      sameSite: 'lax',
      secure: false,
      httpOnly: true,
      path: '/',
    },
  });

  const db = {
    getUserByExtUserId: async () => null,
    getRegisteredAddrByExtUserId: async () => [],
    getAddrByEmail: async () => null,
    addAddr: async () => ({ ext_addr_id: 'ext-addr-id', addr_mail: 'inbox' }),
    getAddrByExtAddrId: async () => null,
    delAddr: async () => {},
    ...(overrides.db || {}),
  };

  const helpers = {
    requireAuthenticatedUser: async () => 'ext-user-id',
    getAvailableRecipient: async () => [],
    ...(overrides.helpers || {}),
  };

  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: true,
  }));
  app.use(cookieParser('test-secret'));
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(bodyParser.json());
  app.use(createApiRoutes({
    db,
    helpers,
    csrf,
    apiRateLimit: overrides.apiRateLimit,
  }));
  app.use(createErrorMiddleware({ invalidCsrfTokenError: csrf.invalidCsrfTokenError }));

  return { app, db, helpers };
};

// CSRF が必要な POST/DELETE 用: セッションを保持した agent で token を取得して返す。
const authorizedAgent = async (app) => {
  const agent = request.agent(app);
  const tokenRes = await agent.get('/api/csrf-token');
  assert.strictEqual(tokenRes.status, 200);
  const csrfToken = tokenRes.body.result.csrfToken;
  assert.ok(csrfToken);
  return { agent, csrfToken };
};

const run = async () => {
  // ---- GET /api/user ----
  {
    // 200: user 取得成功。result は ext_user_id / line_user_id のみ（余計なフィールドを漏らさない）
    const { app } = createTestApp({
      db: {
        getUserByExtUserId: async () => ({
          ext_user_id: 'ext-user-id',
          line_user_id: 'line-user-id',
          secret_column: 'should-not-leak',
        }),
      },
    });
    const res = await request(app).get('/api/user');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.msg, 'Success');
    assert.deepStrictEqual(res.body.result, {
      ext_user_id: 'ext-user-id',
      line_user_id: 'line-user-id',
    });
  }

  {
    // 404: user が存在しない
    const { app } = createTestApp();
    const res = await request(app).get('/api/user');
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error.code, 'USER_NOT_FOUND');
  }

  {
    // 401: 認証失敗（requireAuthenticatedUser が throw）。全ハンドラ共通の catch→next を確認
    const { app } = createTestApp({
      helpers: {
        requireAuthenticatedUser: async () => {
          throw new AppError('AUTH_FAILED', 'Auth failed.', 401);
        },
      },
    });
    const res = await request(app).get('/api/user');
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error.code, 'AUTH_FAILED');
  }

  // ---- GET /api/recipient ----
  {
    // 200: 指定6フィールドのみに整形される
    const { app } = createTestApp({
      helpers: {
        getAvailableRecipient: async () => ([{
          ext_recipient_id: 'r1',
          recipient_type: 0,
          line_recipient_id: 'line-r1',
          recipient_description: 'desc',
          ext_addr_id: 'ea1',
          addr_mail: 'mail1',
          secret_column: 'should-not-leak',
        }]),
      },
    });
    const res = await request(app).get('/api/recipient');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.result, [{
      ext_recipient_id: 'r1',
      recipient_type: 0,
      line_recipient_id: 'line-r1',
      recipient_description: 'desc',
      ext_addr_id: 'ea1',
      addr_mail: 'mail1',
    }]);
  }

  {
    // 500: getAvailableRecipient が reject（success-only GET の catch カバー）
    const { app } = createTestApp({
      helpers: {
        getAvailableRecipient: async () => { throw new Error('boom'); },
      },
    });
    const res = await request(app).get('/api/recipient');
    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error.code, 'INTERNAL_ERROR');
  }

  // ---- GET /api/addr ----
  {
    // 200: ext_addr_id / addr_mail のみに整形される
    const { app } = createTestApp({
      db: {
        getRegisteredAddrByExtUserId: async () => ([{
          ext_addr_id: 'ea1',
          addr_mail: 'mail1',
          secret_column: 'should-not-leak',
        }]),
      },
    });
    const res = await request(app).get('/api/addr');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.result, [{ ext_addr_id: 'ea1', addr_mail: 'mail1' }]);
  }

  {
    // 500: getRegisteredAddrByExtUserId が reject（catch カバー）
    const { app } = createTestApp({
      db: {
        getRegisteredAddrByExtUserId: async () => { throw new Error('boom'); },
      },
    });
    const res = await request(app).get('/api/addr');
    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error.code, 'INTERNAL_ERROR');
  }

  // ---- GET /api/csrf-token ----
  {
    // 200: token が返る
    const { app } = createTestApp();
    const res = await request(app).get('/api/csrf-token');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.result.csrfToken);
  }

  {
    // 401: 認証失敗（csrf-token ハンドラの catch カバー）
    const { app } = createTestApp({
      helpers: {
        requireAuthenticatedUser: async () => {
          throw new AppError('AUTH_FAILED', 'Auth failed.', 401);
        },
      },
    });
    const res = await request(app).get('/api/csrf-token');
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error.code, 'AUTH_FAILED');
  }

  // ---- POST /api/addr ----
  {
    // 400: email 未指定
    const { app } = createTestApp();
    const { agent, csrfToken } = await authorizedAgent(app);
    const res = await agent.post('/api/addr').set('X-CSRF-Token', csrfToken)
      .send({ formInputRecipient: 'r1' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'EMAIL_REQUIRED');
  }

  {
    // 400: recipient 未指定
    const { app } = createTestApp();
    const { agent, csrfToken } = await authorizedAgent(app);
    const res = await agent.post('/api/addr').set('X-CSRF-Token', csrfToken)
      .send({ formInputEmail: 'inbox@example.com' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'RECIPIENT_REQUIRED');
  }

  {
    // 400: パース不能な不正形式
    const { app } = createTestApp();
    const { agent, csrfToken } = await authorizedAgent(app);
    const res = await agent.post('/api/addr').set('X-CSRF-Token', csrfToken)
      .send({ formInputEmail: '@example.com', formInputRecipient: 'r1' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'EMAIL_INVALID');
  }

  {
    // 400: local 部が4文字未満
    const { app } = createTestApp();
    const { agent, csrfToken } = await authorizedAgent(app);
    const res = await agent.post('/api/addr').set('X-CSRF-Token', csrfToken)
      .send({ formInputEmail: 'ab@example.com', formInputRecipient: 'r1' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'EMAIL_TOO_SHORT');
  }

  {
    // 400: 既に存在するメール
    const { app } = createTestApp({
      db: {
        getAddrByEmail: async () => ({ ext_addr_id: 'existing' }),
      },
    });
    const { agent, csrfToken } = await authorizedAgent(app);
    const res = await agent.post('/api/addr').set('X-CSRF-Token', csrfToken)
      .send({ formInputEmail: 'inbox@example.com', formInputRecipient: 'r1' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'EMAIL_ALREADY_EXISTS');
  }

  {
    // 400: recipient が利用可能一覧にない
    const { app } = createTestApp({
      helpers: {
        getAvailableRecipient: async () => ([{ ext_recipient_id: 'other' }]),
      },
    });
    const { agent, csrfToken } = await authorizedAgent(app);
    const res = await agent.post('/api/addr').set('X-CSRF-Token', csrfToken)
      .send({ formInputEmail: 'inbox@example.com', formInputRecipient: 'r1' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'RECIPIENT_NOT_FOUND');
  }

  {
    // 200: 正常登録。addAddr に渡った正規化後メール/extUserId/extRecipientId を assert
    let addAddrArgs = null;
    let getByEmailCalls = 0;
    const { app } = createTestApp({
      db: {
        // 106行=重複チェック→null、120行=登録後取得→addr（逐次戻り値）
        getAddrByEmail: async () => {
          getByEmailCalls += 1;
          return getByEmailCalls === 1
            ? null
            : { ext_addr_id: 'ext-addr-id', addr_mail: 'inbox' };
        },
        addAddr: async (...args) => { addAddrArgs = args; },
      },
      helpers: {
        getAvailableRecipient: async () => ([{ ext_recipient_id: 'r1' }]),
      },
    });
    const { agent, csrfToken } = await authorizedAgent(app);
    const res = await agent.post('/api/addr').set('X-CSRF-Token', csrfToken)
      .send({ formInputEmail: 'INBOX@example.com', formInputRecipient: 'r1' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.result, { ext_addr_id: 'ext-addr-id', addr_mail: 'inbox' });
    // 正規化: local 部の小文字化、extUserId、extRecipientId
    assert.deepStrictEqual(addAddrArgs, ['inbox', 'ext-user-id', 'r1']);
  }

  {
    // 200: '@' 無し入力の @local 補完経路（95-97行）。addAddr 第1引数が 'inbox' であることを確認
    let addAddrArgs = null;
    let getByEmailCalls = 0;
    const { app } = createTestApp({
      db: {
        getAddrByEmail: async () => {
          getByEmailCalls += 1;
          return getByEmailCalls === 1 ? null : { ext_addr_id: 'ext-addr-id', addr_mail: 'inbox' };
        },
        addAddr: async (...args) => { addAddrArgs = args; },
      },
      helpers: {
        getAvailableRecipient: async () => ([{ ext_recipient_id: 'r1' }]),
      },
    });
    const { agent, csrfToken } = await authorizedAgent(app);
    const res = await agent.post('/api/addr').set('X-CSRF-Token', csrfToken)
      .send({ formInputEmail: 'inbox', formInputRecipient: 'r1' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(addAddrArgs[0], 'inbox');
  }

  {
    // 500: addAddr が reject（DB失敗の実運用経路）
    let getByEmailCalls = 0;
    const { app } = createTestApp({
      db: {
        getAddrByEmail: async () => {
          getByEmailCalls += 1;
          return getByEmailCalls === 1 ? null : { ext_addr_id: 'x', addr_mail: 'inbox' };
        },
        addAddr: async () => { throw new Error('db write failed'); },
      },
      helpers: {
        getAvailableRecipient: async () => ([{ ext_recipient_id: 'r1' }]),
      },
    });
    const { agent, csrfToken } = await authorizedAgent(app);
    const res = await agent.post('/api/addr').set('X-CSRF-Token', csrfToken)
      .send({ formInputEmail: 'inbox@example.com', formInputRecipient: 'r1' });
    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error.code, 'INTERNAL_ERROR');
  }

  {
    // 403: CSRF トークン無し（doubleCsrfProtection の発火確認）
    const { app } = createTestApp();
    const res = await request(app).post('/api/addr')
      .send({ formInputEmail: 'inbox@example.com', formInputRecipient: 'r1' });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error.code, 'CSRF_TOKEN_INVALID');
  }

  // ---- DELETE /api/addr/:extAddrId ----
  {
    // 404: addr が存在しない。delAddr は呼ばれない
    let delCalls = 0;
    const { app } = createTestApp({
      db: {
        getAddrByExtAddrId: async () => null,
        delAddr: async () => { delCalls += 1; },
      },
    });
    const { agent, csrfToken } = await authorizedAgent(app);
    const res = await agent.delete('/api/addr/ea1').set('X-CSRF-Token', csrfToken);
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error.code, 'ADDRESS_NOT_FOUND');
    assert.strictEqual(delCalls, 0);
  }

  {
    // 404: 所有していない addr。delAddr は呼ばれない
    let delCalls = 0;
    const { app } = createTestApp({
      db: {
        getAddrByExtAddrId: async () => ({ addr_id: 1, ext_addr_id: 'ea1' }),
        getRegisteredAddrByExtUserId: async () => ([]),
        delAddr: async () => { delCalls += 1; },
      },
    });
    const { agent, csrfToken } = await authorizedAgent(app);
    const res = await agent.delete('/api/addr/ea1').set('X-CSRF-Token', csrfToken);
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error.code, 'ADDRESS_NOT_OWNED');
    assert.strictEqual(delCalls, 0);
  }

  {
    // 200: 正常削除。delAddr が正しい extAddrId で1回だけ呼ばれる
    let delArgs = null;
    let delCalls = 0;
    const { app } = createTestApp({
      db: {
        getAddrByExtAddrId: async () => ({ addr_id: 1, ext_addr_id: 'ea1' }),
        getRegisteredAddrByExtUserId: async () => ([{ addr_id: 1, ext_addr_id: 'ea1' }]),
        delAddr: async (...args) => { delCalls += 1; delArgs = args; },
      },
    });
    const { agent, csrfToken } = await authorizedAgent(app);
    const res = await agent.delete('/api/addr/ea1').set('X-CSRF-Token', csrfToken);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.result, ['ea1']);
    assert.strictEqual(delCalls, 1);
    assert.deepStrictEqual(delArgs, ['ea1']);
  }

  console.log('api-routes tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
