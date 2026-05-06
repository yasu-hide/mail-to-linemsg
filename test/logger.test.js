const assert = require('assert');
const {
  createLogCorrelationId,
  createLogEntry,
  logError,
  logInfo,
  logWarn,
} = require('../lib/logger');

const captureStream = (stream) => {
  const originalWrite = stream.write;
  const chunks = [];

  stream.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };

  return {
    chunks,
    restore: () => {
      stream.write = originalWrite;
    },
  };
};

const run = () => {
  {
    const entry = JSON.parse(createLogEntry('info', 'test.event', {
      event: 'override',
      level: 'override',
      timestamp: 'override',
      requestId: 'request-id',
      value: 1,
    }));

    assert.strictEqual(entry.level, 'info');
    assert.strictEqual(entry.event, 'test.event');
    assert.notStrictEqual(entry.timestamp, 'override');
    assert.strictEqual(entry.detail_event, 'override');
    assert.strictEqual(entry.detail_level, 'override');
    assert.strictEqual(entry.detail_timestamp, 'override');
    assert.strictEqual(entry.requestId, 'request-id');
    assert.strictEqual(entry.value, 1);
  }

  {
    const details = {};
    details.self = details;
    const entry = JSON.parse(createLogEntry('info', 'circular.event', details));

    assert.strictEqual(entry.level, 'info');
    assert.strictEqual(entry.event, 'logger.stringify_failed');
    assert.strictEqual(entry.originalEvent, 'circular.event');
    assert.match(entry.message, /circular/i);
  }

  {
    const stdout = captureStream(process.stdout);
    const stderr = captureStream(process.stderr);
    try {
      logInfo('info.event', { requestId: 'info-request' });
      logWarn('warn.event', { requestId: 'warn-request' });
      logError('error.event', { requestId: 'error-request' });
    } finally {
      stdout.restore();
      stderr.restore();
    }

    assert.strictEqual(stdout.chunks.length, 1);
    assert.strictEqual(stderr.chunks.length, 2);
    assert.strictEqual(JSON.parse(stdout.chunks[0]).event, 'info.event');
    assert.strictEqual(JSON.parse(stderr.chunks[0]).event, 'warn.event');
    assert.strictEqual(JSON.parse(stderr.chunks[1]).event, 'error.event');
  }

  {
    const first = createLogCorrelationId('U1234567890abcdef');
    const second = createLogCorrelationId('U1234567890abcdef');

    assert.strictEqual(first, second);
    assert.strictEqual(first.length, 12);
    assert.notStrictEqual(first, 'U1234567890abcdef');
    assert.strictEqual(createLogCorrelationId(''), undefined);
  }

  console.log('logger tests passed');
};

run();
