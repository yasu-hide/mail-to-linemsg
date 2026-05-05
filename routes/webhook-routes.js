const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { AppError } = require('../lib/errors');
const { createMailWebhookHandler } = require('../lib/mail-webhook');

const defaultMailWebhookRateLimit = {
  windowMs: 60 * 1000,
  limit: 300,
};

const createMailWebhookRateLimiter = (options = {}) => rateLimit({
  windowMs: options.windowMs || defaultMailWebhookRateLimit.windowMs,
  limit: options.limit || defaultMailWebhookRateLimit.limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res, next) => next(new AppError(
    'WEBHOOK_RATE_LIMIT_EXCEEDED',
    'Webhook rate limit exceeded.',
    429,
  )),
});

const createWebhookRoutes = ({
  db,
  msgbot,
  mqttPublish,
  lineWebhookMiddleware,
  verifyInboundParseWebhookSignature,
  mailWebhookRateLimit,
  logger,
}) => {
  const router = express.Router();

  router.post('/msg-webhook', lineWebhookMiddleware, async (req, res, next) => {
    try {
      const event = req.body.events[0];
      if(event && event.type === 'join' && event.source.type === 'group') {
        logger.logInfo('line.group_join.received', { requestId: req.requestId });
        const lineGroupId = event.source.groupId;
        const lineGroupSummary = await msgbot.getGroupSummary(lineGroupId);
        logger.logInfo('line.group_join.recipient_sync', {
          requestId: req.requestId,
          lineGroupId,
        });
        await db.addRecipient(lineGroupId, 1, lineGroupSummary.groupName.substring(0, 63));
      }
      return res.sendStatus(200);
    } catch (e) {
      next(e);
    }
  });

  router.post(
    '/mail-webhook',
    createMailWebhookRateLimiter(mailWebhookRateLimit),
    createMailWebhookHandler({
      db,
      msgbot,
      mqttPublish,
      logger,
      verifyInboundParseWebhookSignature,
    }),
  );

  return router;
};

module.exports = {
  createWebhookRoutes,
};
