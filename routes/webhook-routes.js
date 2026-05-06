const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createMailWebhookHandler } = require('../lib/mail-webhook');
const {
  createRateLimitOptions,
  defaultRateLimits,
} = require('../lib/rate-limit');

const createMailWebhookRateLimiter = (options = {}) => rateLimit(createRateLimitOptions({
  options,
  defaults: defaultRateLimits.mailWebhook,
  code: 'WEBHOOK_RATE_LIMIT_EXCEEDED',
  message: 'Webhook rate limit exceeded.',
}));

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
  const createSafeLogId = (value) => (
    logger && typeof logger.createLogCorrelationId === 'function'
      ? logger.createLogCorrelationId(value)
      : undefined
  );

  router.post('/msg-webhook', lineWebhookMiddleware, async (req, res, next) => {
    try {
      const event = req.body.events[0];
      if(event && event.type === 'join' && event.source.type === 'group') {
        logger.logInfo('line.group_join.received', { requestId: req.requestId });
        const lineGroupId = event.source.groupId;
        const lineGroupSummary = await msgbot.getGroupSummary(lineGroupId);
        logger.logInfo('line.group_join.recipient_sync', {
          requestId: req.requestId,
          lineGroupKey: createSafeLogId(lineGroupId),
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
