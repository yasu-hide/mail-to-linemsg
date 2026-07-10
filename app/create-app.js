const path = require('path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { doubleCsrf } = require('csrf-csrf');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const LINEMsgSdk = require('@line/bot-sdk');
const logger = require('../lib/logger');
const { AppError, createErrorMiddleware } = require('../lib/errors');
const { createWebhookRoutes } = require('../routes/webhook-routes');
const { createPageRoutes } = require('../routes/page-routes');
const { createApiRoutes } = require('../routes/api-routes');

const createSafeLogId = (value) => logger.createLogCorrelationId(value);

const createHelpers = ({
  db,
  msgbot,
}) => {
  const isLoggedIn = async (extUserId) => {
    if(!extUserId) {
      logger.logInfo('isLoggedIn', { extUserKey: createSafeLogId(extUserId) });
      return false;
    }
    const existUser = await db.getUserByExtUserId(extUserId);
    if(!existUser) {
      logger.logInfo('isLoggedIn:userNotFound', { extUserKey: createSafeLogId(extUserId) });
      return false;
    }
    logger.logInfo('isLoggedIn:userFound', {
      extUserKey: createSafeLogId(extUserId),
      existingExtUserKey: createSafeLogId(existUser.ext_user_id),
    });
    return (extUserId === existUser.ext_user_id);
  };

  const requireAuthenticatedUser = async (req) => {
    const extUserId = req.session.userId;
    if (!await isLoggedIn(extUserId)) {
      req.session.destroy();
      throw new AppError('AUTH_FAILED', 'Auth failed.', 401);
    }

    return extUserId;
  };

  const getAvailableRecipient = async (extUserId) => {
    const user = await db.getUserByExtUserId(extUserId);
    const recipientAll = await db.getRecipientAll();

    const recipientUser = recipientAll.filter(rcpt => rcpt.line_recipient_id != '' && rcpt.recipient_type === 0 && rcpt.ext_recipient_id === extUserId);
    const recipientGroup = await Promise.all(
      recipientAll.filter(rcpt => rcpt.line_recipient_id != '' && rcpt.recipient_type === 1)
        .map(rcpt => msgbot.getGroupMemberProfile(rcpt.line_recipient_id, user.line_user_id)
          .then(() => { return Promise.resolve(rcpt) }))
    );
    return [ ...recipientUser, ...recipientGroup ];
  };

  return {
    getAvailableRecipient,
    isLoggedIn,
    requireAuthenticatedUser,
  };
};

const createSessionOptions = ({ sessionOptions }) => ({
  ...sessionOptions,
  cookie: {
    ...(sessionOptions.cookie || {}),
    secure: true,
  },
});

const createApp = ({
  rootDir,
  config,
  db,
  msgbot,
  mqttPublish,
  lineWebhookMiddleware,
  verifyInboundParseWebhookSignature,
}) => {
  const app = express();
  const isProduction = app.get('env') === 'production';
  const sessionOptions = createSessionOptions({
    sessionOptions: config.sessionOptions,
  });
  const secureSessionMiddleware = session({
    ...sessionOptions,
    cookie: {
      ...sessionOptions.cookie,
      secure: true,
    },
  });
  const csrf = doubleCsrf({
    getSecret: () => process.env.CSRF_SECRET || sessionOptions.secret,
    getSessionIdentifier: (req) => req.sessionID || '',
    getTokenFromRequest: (req) => req.headers['x-csrf-token'],
    cookieName: isProduction
      ? '__Host-mail-to-linemsg.x-csrf-token'
      : 'mail-to-linemsg.x-csrf-token',
    cookieOptions: {
      sameSite: 'lax',
      secure: isProduction,
      httpOnly: true,
      path: '/',
    },
  });
  const helpers = createHelpers({ db, msgbot });
  const resolvedLineWebhookMiddleware = lineWebhookMiddleware
    || LINEMsgSdk.middleware(config.msgbotConfig);

  if (isProduction) {
    app.set('trust proxy', 1);
  }
  if (isProduction && !process.env.SESSION_STORE) {
    logger.logWarn('session.store.default_memory', {
      message: 'MemoryStore is active in production. Configure a persistent session store.',
    });
  }

  app
    .use(logger.createRequestLogger())
    .use(secureSessionMiddleware)
    // NOTE: signed cookies are not used anywhere in this app (req.signedCookies
    // is never read), so this secret reuse is currently inactive. If signed
    // cookies are introduced later, use a dedicated secret instead of reusing
    // the session secret.
    .use(cookieParser(sessionOptions.secret))
    .use(helmet(config.helmetOption))
    .use(createWebhookRoutes({
      db,
      msgbot,
      mqttPublish,
      lineWebhookMiddleware: resolvedLineWebhookMiddleware,
      verifyInboundParseWebhookSignature,
      mailWebhookRateLimit: config.mailWebhookRateLimit,
      logger,
    }))
    .use(express.static(path.join(rootDir, 'public')))
    .use(bodyParser.urlencoded({
      extended: true,
    }))
    .use(bodyParser.json())
    .set('view engine', 'ejs')
    .use(createPageRoutes({
      rootDir,
      db,
      msgbot,
      lineLoginConfig: config.lineLoginConfig,
      helpers,
      logger,
      createRequestId: logger.createRequestId,
      authRateLimit: config.authRateLimit,
    }))
    .use(createApiRoutes({
      db,
      helpers,
      csrf,
      apiRateLimit: config.apiRateLimit,
    }))
    .use(createErrorMiddleware({
      invalidCsrfTokenError: csrf.invalidCsrfTokenError,
    }));

  return app;
};

module.exports = {
  createApp,
  createHelpers,
  createSessionOptions,
};
