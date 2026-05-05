const assert = require('assert');
const {
  InboundParseWebhookSignatureError,
} = require('../lib/inbound-parse-webhook-signature');
const {
  AppError,
  normalizeAppError,
} = require('../lib/errors');

const run = () => {
  {
    const source = new AppError('KNOWN', 'Known error.', 418, { value: 1 });
    const result = normalizeAppError(source);
    assert.strictEqual(result, source);
  }

  {
    const invalidCsrfTokenError = new Error('invalid csrf');
    const result = normalizeAppError(invalidCsrfTokenError, { invalidCsrfTokenError });
    assert.strictEqual(result.code, 'CSRF_TOKEN_INVALID');
    assert.strictEqual(result.httpStatus, 403);
  }

  {
    const result = normalizeAppError({ code: 'EBADCSRFTOKEN' });
    assert.strictEqual(result.code, 'CSRF_TOKEN_INVALID');
    assert.strictEqual(result.httpStatus, 403);
  }

  {
    const result = normalizeAppError(new InboundParseWebhookSignatureError(
      'WEBHOOK_SIGNATURE_INVALID',
      'Webhook signature is invalid.',
      401,
    ));
    assert.strictEqual(result.code, 'WEBHOOK_SIGNATURE_INVALID');
    assert.strictEqual(result.httpStatus, 401);
  }

  {
    const result = normalizeAppError(new Error('Multipart boundary is missing.'));
    assert.strictEqual(result.code, 'INVALID_MULTIPART_REQUEST');
    assert.strictEqual(result.httpStatus, 400);
  }

  {
    const result = normalizeAppError(new Error('Mail webhook payload is too large.'));
    assert.strictEqual(result.code, 'MAIL_PAYLOAD_TOO_LARGE');
    assert.strictEqual(result.httpStatus, 413);
  }

  {
    const result = normalizeAppError(new Error('unexpected'));
    assert.strictEqual(result.code, 'INTERNAL_ERROR');
    assert.strictEqual(result.httpStatus, 500);
  }

  console.log('errors tests passed');
};

run();
