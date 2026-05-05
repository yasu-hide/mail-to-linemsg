'use strict';

const { EventWebhook } = require('@sendgrid/eventwebhook');

const signatureHeaderNames = [
  'X-Email-Event-Webhook-Signature',
  'X-Twilio-Email-Event-Webhook-Signature',
];
const timestampHeaderNames = [
  'X-Email-Event-Webhook-Timestamp',
  'X-Twilio-Email-Event-Webhook-Timestamp',
];
const defaultMaxAgeSeconds = 300;

class InboundParseWebhookSignatureError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.name = 'InboundParseWebhookSignatureError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const createInvalidSignatureError = () => new InboundParseWebhookSignatureError(
  'WEBHOOK_SIGNATURE_INVALID',
  'Webhook signature is invalid.',
  401,
);

const createMisconfiguredError = () => new InboundParseWebhookSignatureError(
  'WEBHOOK_SECURITY_MISCONFIGURED',
  'Webhook signature verification is misconfigured.',
  503,
);

const normalizeHeaderValue = (value) => {
  if (Array.isArray(value)) {
    return normalizeHeaderValue(value[0]);
  }
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

const getHeaderValue = (headers, headerNames) => {
  const normalizedHeaders = Object.keys(headers || {}).reduce((acc, key) => ({
    ...acc,
    [key.toLowerCase()]: headers[key],
  }), {});

  const matchedHeaderName = headerNames.find((headerName) => (
    normalizeHeaderValue(normalizedHeaders[headerName.toLowerCase()])
  ));

  return matchedHeaderName
    ? normalizeHeaderValue(normalizedHeaders[matchedHeaderName.toLowerCase()])
    : '';
};

const getInboundParseWebhookSignatureHeaders = (headers) => ({
  signature: getHeaderValue(headers, signatureHeaderNames),
  timestamp: getHeaderValue(headers, timestampHeaderNames),
});

const normalizePublicKey = (publicKey) => {
  if (typeof publicKey !== 'string' || !publicKey.trim()) {
    throw createMisconfiguredError();
  }

  return publicKey.replace(/\\n/g, '\n');
};

const assertFreshTimestamp = ({ timestamp, nowMs, maxAgeSeconds }) => {
  if (!/^\d+$/.test(timestamp)) {
    throw createInvalidSignatureError();
  }

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(timestampMs)) {
    throw createInvalidSignatureError();
  }

  if (Math.abs(nowMs - timestampMs) > maxAgeSeconds * 1000) {
    throw createInvalidSignatureError();
  }
};

const verifyInboundParseWebhookSignature = ({
  rawBody,
  headers,
  publicKey = process.env.INBOUND_PARSE_WEBHOOK_PUBLIC_KEY,
  nowMs = Date.now(),
  maxAgeSeconds = defaultMaxAgeSeconds,
}) => {
  const eventWebhook = new EventWebhook();
  let ecdsaPublicKey;
  try {
    ecdsaPublicKey = eventWebhook.convertPublicKeyToECDSA(normalizePublicKey(publicKey));
  } catch (error) {
    throw createMisconfiguredError();
  }

  const { signature, timestamp } = getInboundParseWebhookSignatureHeaders(headers);
  if (!signature || !timestamp) {
    throw createInvalidSignatureError();
  }

  assertFreshTimestamp({ timestamp, nowMs, maxAgeSeconds });

  let isValid = false;
  try {
    isValid = eventWebhook.verifySignature(ecdsaPublicKey, rawBody, signature, timestamp);
  } catch (error) {
    throw createInvalidSignatureError();
  }

  if (!isValid) {
    throw createInvalidSignatureError();
  }
};

module.exports = {
  InboundParseWebhookSignatureError,
  getInboundParseWebhookSignatureHeaders,
  verifyInboundParseWebhookSignature,
};
