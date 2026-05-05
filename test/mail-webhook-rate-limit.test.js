const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const request = require('supertest');

class AppError extends Error {
  constructor(code, message, httpStatus = 500, details = undefined) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

const createApiErrorResponse = (appError, req) => ({
  success: false,
  msg: appError.message,
  requestId: req.requestId,
  error: {
    code: appError.code,
    message: appError.message,
    details: appError.details,
  },
});

const createTestApp = ({ limit }) => {
  const app = express();
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res, next) => next(new AppError(
      'WEBHOOK_RATE_LIMIT_EXCEEDED',
      'Webhook rate limit exceeded.',
      429,
    )),
  });

  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  });
  app.post('/mail-webhook', limiter, (req, res) => res.sendStatus(204));
  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }

    return res.status(err.httpStatus || 500).json(createApiErrorResponse(err, req));
  });

  return app;
};

const assertIndexWiring = () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(source, /const mailWebhookRateLimiter = rateLimit\(\{/);
  assert.match(source, /\.post\('\/mail-webhook', mailWebhookRateLimiter, async/);
};

const run = async () => {
  assertIndexWiring();

  {
    const app = createTestApp({ limit: 2 });
    const res = await request(app).post('/mail-webhook');
    assert.strictEqual(res.status, 204);
  }

  {
    const app = createTestApp({ limit: 1 });
    const firstRes = await request(app).post('/mail-webhook');
    assert.strictEqual(firstRes.status, 204);

    const limitedRes = await request(app).post('/mail-webhook');
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
