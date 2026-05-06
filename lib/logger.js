const {
  createHash,
  randomUUID,
} = require('crypto');

const createRequestId = () => randomUUID();

const reservedLogFields = new Set(['level', 'event', 'timestamp']);

const sanitizeLogDetails = (details = {}) => {
  if (!details || typeof details !== 'object') {
    return { detailValue: details };
  }

  return Object.keys(details).reduce((acc, key) => {
    if (reservedLogFields.has(key)) {
      acc[`detail_${key}`] = details[key];
      return acc;
    }

    acc[key] = details[key];
    return acc;
  }, {});
};

const createLogEntry = (level, event, details = {}) => {
  const entry = {
    ...sanitizeLogDetails(details),
    level,
    event,
    timestamp: new Date().toISOString(),
  };

  try {
    return JSON.stringify(entry);
  } catch (error) {
    return JSON.stringify({
      level,
      event: 'logger.stringify_failed',
      timestamp: new Date().toISOString(),
      originalEvent: event,
      message: error && error.message,
    });
  }
};

const writeLogEntry = (stream, level, event, details) => {
  stream.write(`${createLogEntry(level, event, details)}\n`);
};

const logInfo = (event, details) => writeLogEntry(process.stdout, 'info', event, details);
const logWarn = (event, details) => writeLogEntry(process.stderr, 'warn', event, details);
const logError = (event, details) => writeLogEntry(process.stderr, 'error', event, details);

const createLogCorrelationId = (value) => {
  if (!value) {
    return undefined;
  }

  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
};

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
  createLogCorrelationId,
  createRequestId,
  createRequestLogger,
  getRequestCompletionLogger,
  logError,
  logInfo,
  logWarn,
};
