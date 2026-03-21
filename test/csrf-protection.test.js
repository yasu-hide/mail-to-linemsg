const assert = require('assert');
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { doubleCsrf } = require('csrf-csrf');
const request = require('supertest');

const createTestApp = () => {
  const app = express();
  const {
    generateCsrfToken,
    doubleCsrfProtection,
    invalidCsrfTokenError,
  } = doubleCsrf({
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

  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: true,
  }));
  app.use(cookieParser('test-secret'));
  app.use(bodyParser.json());

  app.get('/api/csrf-token', (req, res) => {
    res.status(200).json({
      result: {
        csrfToken: generateCsrfToken(req, res),
      },
    });
  });

  app.post('/api/protected', doubleCsrfProtection, (req, res) => {
    res.status(200).json({ msg: 'ok' });
  });

  app.use((err, req, res, next) => {
    if (err === invalidCsrfTokenError || (err && err.code === 'EBADCSRFTOKEN')) {
      return res.status(403).json({ code: 'CSRF_TOKEN_INVALID' });
    }

    return next(err);
  });

  return app;
};

const run = async () => {
  const app = createTestApp();
  const agent = request.agent(app);

  {
    const tokenRes = await agent.get('/api/csrf-token');
    assert.strictEqual(tokenRes.status, 200);
    const csrfToken = tokenRes.body
      && tokenRes.body.result
      && tokenRes.body.result.csrfToken;
    assert.ok(csrfToken);

    const protectedRes = await agent
      .post('/api/protected')
      .set('X-CSRF-Token', csrfToken)
      .send({ value: 1 });
    assert.strictEqual(protectedRes.status, 200);
    assert.strictEqual(protectedRes.body.msg, 'ok');
  }

  {
    await agent.get('/api/csrf-token');
    const resWithoutToken = await agent
      .post('/api/protected')
      .send({ value: 1 });
    assert.strictEqual(resWithoutToken.status, 403);
    assert.strictEqual(resWithoutToken.body.code, 'CSRF_TOKEN_INVALID');
  }

  console.log('csrf-protection tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
