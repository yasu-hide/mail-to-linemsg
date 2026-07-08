const express = require('express');

// logInfo/logWarn/logError の呼び出しを calls 配列にキャプチャするロガースタブ。
const createTestLogger = () => {
  const calls = [];
  const capture = (level) => (event, payload) => {
    calls.push({ level, event, payload });
  };

  return {
    calls,
    logInfo: capture('info'),
    logWarn: capture('warn'),
    logError: capture('error'),
    createLogCorrelationId: (value) => (value ? `test-correlation-${value}` : undefined),
  };
};

// req.requestId を付与するミドルウェアまで載せた express アプリを返す。
const createBaseApp = ({ requestId = 'test-request-id' } = {}) => {
  const app = express();
  app.use((req, res, next) => {
    req.requestId = requestId;
    next();
  });
  return app;
};

// req.session の代わりに渡せるフェイクセッション。regenerate/destroy はスパイとして呼び出し回数を記録する。
const createFakeSession = (initial = {}) => {
  const session = {
    ...initial,
    regenerateCalls: 0,
    destroyCalls: 0,
    regenerate(cb) {
      session.regenerateCalls += 1;
      cb();
    },
    destroy() {
      session.destroyCalls += 1;
    },
  };
  return session;
};

// global.fetch を stub に差し替えて fn を実行し、finally で必ず元に戻す。
const withStubbedFetch = async (stub, fn) => {
  const original = global.fetch;
  global.fetch = stub;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
};

module.exports = {
  createTestLogger,
  createBaseApp,
  createFakeSession,
  withStubbedFetch,
};
