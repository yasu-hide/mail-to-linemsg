const { AppError } = require('./errors');

const defaultRateLimits = {
  api: {
    windowMs: 60 * 1000,
    limit: 300,
  },
  auth: {
    windowMs: 60 * 1000,
    limit: 60,
  },
  mailWebhook: {
    windowMs: 60 * 1000,
    limit: 300,
  },
};

const createRateLimitOptions = ({
  options = {},
  defaults,
  code,
  message,
}) => ({
  windowMs: options.windowMs || defaults.windowMs,
  limit: options.limit || defaults.limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res, next) => next(new AppError(code, message, 429)),
});

module.exports = {
  createRateLimitOptions,
  defaultRateLimits,
};
