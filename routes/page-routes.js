const express = require('express');
const path = require('path');
const { rateLimit } = require('express-rate-limit');
const {
  regenerateSessionWithUser,
} = require('../lib/session-security');
const {
  createRateLimitOptions,
  defaultRateLimits,
} = require('../lib/rate-limit');

const buildLineAuthUrl = (req, lineLoginConfig, createRequestId) => {
  const state = createRequestId().replace(/-/g, '');
  const nonce = createRequestId().replace(/-/g, '');
  req.session.line_login_state = state;
  req.session.line_login_nonce = nonce;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: lineLoginConfig.channelId,
    redirect_uri: lineLoginConfig.callbackUrl,
    state,
    scope: 'profile openid',
    nonce,
  });
  return `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
};

const postUrlEncodedJson = async (url, payload) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(payload),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error_description || json.error || `LINE API request failed: ${response.status}`);
  }
  return json;
};

const issueLineAccessToken = async (code, lineLoginConfig) => postUrlEncodedJson(
  'https://api.line.me/oauth2/v2.1/token',
  {
    grant_type: 'authorization_code',
    code,
    redirect_uri: lineLoginConfig.callbackUrl,
    client_id: lineLoginConfig.channelId,
    client_secret: lineLoginConfig.channelSecret,
  },
);

const verifyLineIdToken = async (idToken, lineLoginConfig) => postUrlEncodedJson(
  'https://api.line.me/oauth2/v2.1/verify',
  {
    id_token: idToken,
    client_id: lineLoginConfig.channelId,
  },
);

const createPageRoutes = ({
  rootDir,
  db,
  msgbot,
  lineLoginConfig,
  helpers,
  logger,
  createRequestId,
  authRateLimit,
}) => {
  const router = express.Router();
  const indexTemplate = path.join(rootDir, 'pages/index');
  const loginTemplate = path.join(rootDir, 'pages/login');
  const authRateLimiter = rateLimit(createRateLimitOptions({
    options: authRateLimit,
    defaults: defaultRateLimits.auth,
    code: 'AUTH_RATE_LIMIT_EXCEEDED',
    message: 'Auth rate limit exceeded.',
  }));

  router.get('/', async (req, res, next) => {
    const extUserId = req.session.userId;
    logger.logInfo('page.index.render', { requestId: req.requestId, extUserId });
    if (! await helpers.isLoggedIn(extUserId)) {
      res.redirect(`${req.baseUrl}/login`);
      return;
    }
    try {
      const pageParam = await db.getRegisteredAddrByExtUserId(extUserId);
      res.render(indexTemplate, { param: pageParam });
    } catch (error) {
      next(error);
    }
  });

  router.get('/login', async (req, res) => {
    if (await helpers.isLoggedIn(req.session.userId)) {
      res.redirect(`${req.baseUrl}/`);
      return;
    }
    res.render(loginTemplate);
  });

  router.get('/logout', (req, res) => {
    req.session.destroy();
    return res.redirect(`${req.baseUrl}/login?reason=logged_out`);
  });

  router.get('/auth', authRateLimiter, (req, res) => {
    if (!lineLoginConfig.channelId || !lineLoginConfig.channelSecret || !lineLoginConfig.callbackUrl) {
      logger.logError('auth.config.invalid', {
        requestId: req.requestId,
        message: 'LINE login configuration is incomplete.',
      });
      return res.status(500).json({ msg: 'LINE login configuration is invalid.' });
    }
    return res.redirect(buildLineAuthUrl(req, lineLoginConfig, createRequestId));
  });

  router.get('/callback', authRateLimiter, async (req, res) => {
    try {
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      if (!code || !state || req.session.line_login_state !== state) {
        throw new Error('Authorization failed. State does not match.');
      }

      const tokenResponse = await issueLineAccessToken(code, lineLoginConfig);
      if (!(tokenResponse.expires_in > 0) || !tokenResponse.id_token) {
        throw new Error('Auth failed. Token response is invalid.');
      }

      const verifiedIdToken = await verifyLineIdToken(tokenResponse.id_token, lineLoginConfig);
      if (!verifiedIdToken.sub || verifiedIdToken.nonce !== req.session.line_login_nonce) {
        throw new Error('Verification of id token failed.');
      }

      const lineUserId = verifiedIdToken.sub;
      const user = await db.addUser(lineUserId);
      const userId = user.ext_user_id;
      const lineUserProfile = await msgbot.getProfile(lineUserId)
        .catch(() => Promise.resolve({ displayName: 'self' }));
      await db.addRecipient(lineUserId, 0, lineUserProfile.displayName.substring(0, 63), userId);
      await regenerateSessionWithUser(req, userId);
      delete req.session.line_login_state;
      delete req.session.line_login_nonce;
      logger.logInfo('auth.callback.succeeded', {
        requestId: req.requestId,
        lineUserId,
        userId,
      });
      return res.redirect(`${req.baseUrl}/`);
    } catch (error) {
      logger.logWarn('auth.callback.failed', {
        requestId: req.requestId,
        message: error && error.message,
      });
      req.session.destroy();
      return res.redirect(`${req.baseUrl}/login?reason=login_failed`);
    }
  });

  return router;
};

module.exports = {
  createPageRoutes,
};
