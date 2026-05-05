const {
  InboundParseWebhookSignatureError,
} = require('./inbound-parse-webhook-signature');
const { logError } = require('./logger');

class AppError extends Error {
  constructor(code, message, httpStatus = 500, details = undefined) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

const normalizeAppError = (error, options = {}) => {
  if (error instanceof AppError) {
    return error;
  }

  if (
    error === options.invalidCsrfTokenError
    || (error && error.code === 'EBADCSRFTOKEN')
  ) {
    return new AppError('CSRF_TOKEN_INVALID', 'Invalid CSRF token.', 403);
  }

  if (error instanceof InboundParseWebhookSignatureError) {
    return new AppError(error.code, error.message, error.httpStatus);
  }

  const message = error && error.message;
  if (message === 'Multipart boundary is missing.') {
    return new AppError('INVALID_MULTIPART_REQUEST', message, 400);
  }
  if (message === 'Mail webhook payload is too large.') {
    return new AppError('MAIL_PAYLOAD_TOO_LARGE', message, 413);
  }
  if (message === 'Mail webhook request was aborted.') {
    return new AppError('MAIL_REQUEST_ABORTED', message, 400);
  }
  if (message === 'Invalid charsets payload.') {
    return new AppError('INVALID_CHARSETS_PAYLOAD', message, 400);
  }

  return new AppError('INTERNAL_ERROR', 'Internal server error.', 500);
};

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

const isApiLikeRequest = (req) => req.path.startsWith('/api/') || req.path.includes('webhook');

const createErrorMiddleware = ({ invalidCsrfTokenError } = {}) => (err, req, res, next) => {
  const appError = normalizeAppError(err, { invalidCsrfTokenError });
  logError('request.failed', {
    path: req.path,
    requestId: req.requestId,
    code: appError.code,
    httpStatus: appError.httpStatus,
    message: err && err.message,
    stack: err && err.stack,
  });

  if (res.headersSent) {
    return next(err);
  }

  if (isApiLikeRequest(req)) {
    return res.status(appError.httpStatus).json(createApiErrorResponse(appError, req));
  }

  return res.status(appError.httpStatus).send(appError.message);
};

module.exports = {
  AppError,
  createApiErrorResponse,
  createErrorMiddleware,
  isApiLikeRequest,
  normalizeAppError,
};
