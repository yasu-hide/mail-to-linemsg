const assert = require('assert');
const { createRequire } = require('module');
const {
  InboundParseWebhookSignatureError,
  verifyInboundParseWebhookSignature,
} = require('../lib/inbound-parse-webhook-signature');

const eventWebhookRequire = createRequire(require.resolve('@sendgrid/eventwebhook'));
const {
  Ecdsa,
  PrivateKey,
} = eventWebhookRequire('starkbank-ecdsa');

const timestamp = '1700000000';
const nowMs = Number(timestamp) * 1000;
const rawBody = Buffer.from([
  '--boundary',
  'Content-Disposition: form-data; name="text"',
  '',
  'hello',
  '--boundary--',
  '',
].join('\r\n'));

const privateKey = new PrivateKey();
const publicKey = privateKey.publicKey().toPem();
const escapedPublicKey = publicKey.replace(/\n/g, '\\n');

const sign = (body = rawBody, signedTimestamp = timestamp) => Ecdsa
  .sign(signedTimestamp + body.toString(), privateKey)
  .toBase64();

const validSignature = sign();

const verify = (overrides = {}) => verifyInboundParseWebhookSignature({
  rawBody,
  headers: {
    'x-email-event-webhook-signature': validSignature,
    'x-email-event-webhook-timestamp': timestamp,
  },
  publicKey,
  nowMs,
  ...overrides,
});

const assertSignatureError = (fn, code, httpStatus) => {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof InboundParseWebhookSignatureError);
    assert.strictEqual(error.code, code);
    assert.strictEqual(error.httpStatus, httpStatus);
    return true;
  });
};

const run = async () => {
  {
    verify();
  }

  {
    verify({
      headers: {
        'x-twilio-email-event-webhook-signature': validSignature,
        'x-twilio-email-event-webhook-timestamp': timestamp,
      },
    });
  }

  {
    verify({
      headers: {
        'x-email-event-webhook-signature': validSignature,
        'x-email-event-webhook-timestamp': timestamp,
        'x-twilio-email-event-webhook-signature': 'invalid-signature',
        'x-twilio-email-event-webhook-timestamp': timestamp,
      },
    });
    assertSignatureError(() => verify({
      headers: {
        'x-email-event-webhook-signature': 'invalid-signature',
        'x-email-event-webhook-timestamp': timestamp,
        'x-twilio-email-event-webhook-signature': validSignature,
        'x-twilio-email-event-webhook-timestamp': timestamp,
      },
    }), 'WEBHOOK_SIGNATURE_INVALID', 401);
  }

  {
    assertSignatureError(() => verify({
      headers: {
        'x-email-event-webhook-timestamp': timestamp,
      },
    }), 'WEBHOOK_SIGNATURE_INVALID', 401);
  }

  {
    assertSignatureError(() => verify({
      headers: {
        'x-email-event-webhook-signature': validSignature,
      },
    }), 'WEBHOOK_SIGNATURE_INVALID', 401);
  }

  {
    assertSignatureError(() => verify({
      headers: {
        'x-email-event-webhook-signature': 'invalid-signature',
        'x-email-event-webhook-timestamp': timestamp,
      },
    }), 'WEBHOOK_SIGNATURE_INVALID', 401);
  }

  {
    assertSignatureError(() => verify({
      rawBody: Buffer.from('modified-body'),
    }), 'WEBHOOK_SIGNATURE_INVALID', 401);
  }

  {
    assertSignatureError(() => verify({
      nowMs: nowMs + 301000,
    }), 'WEBHOOK_SIGNATURE_INVALID', 401);
  }

  {
    verify({
      publicKey,
    });
    verify({
      publicKey: escapedPublicKey,
    });
  }

  {
    assertSignatureError(() => verify({
      publicKey: '',
    }), 'WEBHOOK_SECURITY_MISCONFIGURED', 503);
    assertSignatureError(() => verify({
      headers: {},
      publicKey: '',
    }), 'WEBHOOK_SECURITY_MISCONFIGURED', 503);
  }

  {
    assertSignatureError(() => verify({
      publicKey: 'not-a-public-key',
    }), 'WEBHOOK_SECURITY_MISCONFIGURED', 503);
  }

  console.log('inbound-parse-webhook-signature tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
