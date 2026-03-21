const assert = require('assert');
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const csurf = require('csurf');
const request = require('supertest');

const createTestApp = () => {
  const app = express();
  const csrfProtection = csurf();

  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false,
  }));
  app.use(bodyParser.json());

  app.get('/api/csrf-token', csrfProtection, (req, res) => {
    res.status(200).json({
      result: {
        csrfToken: req.csrfToken(),
      },
    });
  });

  app.post('/api/protected', csrfProtection, (req, res) => {
    res.status(200).json({ msg: 'ok' });
  });

  app.use((err, req, res, next) => {
    if (err && err.code === 'EBADCSRFTOKEN') {
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
    const resWithoutToken = await request(app)
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
