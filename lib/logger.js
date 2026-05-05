const { randomUUID } = require('crypto');
const debug = require('debug')('index');

const createRequestId = () => randomUUID();

const createLogEntry = (level, event, details = {}) => JSON.stringify({
  level,
  event,
  timestamp: new Date().toISOString(),
  ...details,
});

const logInfo = (event, details) => debug(createLogEntry('info', event, details));
const logWarn = (event, details) => debug(createLogEntry('warn', event, details));
const logError = (event, details) => debug(createLogEntry('error', event, details));

const getRequestCompletionLogger = (statusCode) => {
  if (statusCode >= 500) {
    return logError;
  }
  if (statusCode >= 400) {
    return logWarn;
  }
  return logInfo;
};

const createRequestLogger = () => (req, res, next) => {
  req.requestId = createRequestId();
  req.requestStartedAt = Date.now();
  res.setHeader('x-request-id', req.requestId);
  logInfo('request.started', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
  });
  res.on('finish', () => {
    getRequestCompletionLogger(res.statusCode)('request.completed', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - req.requestStartedAt,
    });
  });
  next();
};

module.exports = {
  createLogEntry,
  createRequestId,
  createRequestLogger,
  getRequestCompletionLogger,
  logError,
  logInfo,
  logWarn,
};
