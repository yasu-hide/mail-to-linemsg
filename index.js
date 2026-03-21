require('dotenv').config();

const { randomUUID } = require('crypto');
const express = require('express');
const session = require('express-session');
const csurf = require('csurf');
const bodyParser = require('body-parser');
const debug = require('debug')('index');
const Dicer = require('dicer');
const helmet = require('helmet');
const emailAddresses = require('email-addresses');
const htmlToText = require('html-to-text');
const {
  getPartTransferEncoding,
  decodeTransferEncodedBuffer,
} = require('./lib/transfer-encoding');
const {
  isUtf8Charset,
  decodeUtf8Buffer,
  truncateLineTextMessage,
} = require('./lib/mail-text');

const LINELogin = require('line-login');
const LINEMsgSdk = require ('@line/bot-sdk');
const MQTTPublish = require('./mqtt-publish');
const Database = require('./db-pgsql');

const sessionOptions = {
  secret: process.env.LINECORP_PLATFORM_LOGIN_CHANNEL_SECRET,
  cookie: { maxAge: 600000 },
  resave: false,
  saveUninitialized: false,
};
const listenPort = process.env.PORT || 3000;
const login = new LINELogin({
  channel_id: process.env.LINECORP_PLATFORM_LOGIN_CHANNEL_ID,
  channel_secret: process.env.LINECORP_PLATFORM_LOGIN_CHANNEL_SECRET,
  callback_url: process.env.LINECORP_PLATFORM_LOGIN_CHANNEL_CALLBACKURL,
});
const msgbotConfig = {
  channelAccessToken: process.env.LINECORP_PLATFORM_MESSAGING_CHANNEL_ACCESSTOKEN,
  channelSecret: process.env.LINECORP_PLATFORM_MESSAGING_CHANNEL_SECRET,
}
const msgbot = new LINEMsgSdk.messagingApi.MessagingApiClient({
  channelAccessToken: msgbotConfig.channelAccessToken,
});
const db = new Database({
  databaseURL: process.env.DATABASE_URL,
});
const mqttPublish = (() => {
  try {
    return new MQTTPublish({
      uri: process.env.MQTT_URI,
      username: process.env.MQTT_USER,
      password: process.env.MQTT_PASS || '',
      topic: process.env.MQTT_TOPIC,
    });
  } catch (e) {
    debug('Failed to load MQTT module.');
    return null;
  }
})();

const helmetOption = {
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      scriptSrc: [ "'self'", "ajax.googleapis.com" ]
    }
  }
};

const mailWebhookMaxBytes = 30 * 1024 * 1024;
const lineTextMessageMaxChars = 5000;
const lineTextMessageTruncationMarker = '\r\n（省略）';
const trackedMultipartFieldNames = new Set(['to', 'from', 'subject', 'charsets', 'text', 'html']);
const utf8MultipartFieldNames = new Set(['to', 'from', 'subject', 'charsets']);
const getMultipartBoundary = (contentType) => {
  const matched = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!matched) {
    throw new Error('Multipart boundary is missing.');
  }

  return matched[1] || matched[2];
};
const getMultipartFieldName = (contentDisposition) => {
  if (!contentDisposition) {
    return null;
  }

  const matched = contentDisposition.match(/name="([^"]+)"/i);
  return matched ? matched[1] : null;
};
const getFirstHeaderValue = (headerValue) => {
  if (!Array.isArray(headerValue) || headerValue.length <= 0) {
    return null;
  }

  return headerValue[0];
};
const isMultipartFilePart = (contentDisposition) => /filename=/i.test(contentDisposition || '');
const streamMultipartForm = (req, maxBytes) => new Promise((resolve, reject) => {
  const boundary = getMultipartBoundary(req.headers['content-type'] || '');
  const parser = new Dicer({ boundary });
  const formParts = {};
  let totalBytes = 0;
  let isSettled = false;

  const cleanup = () => {
    req.removeListener('data', handleRequestData);
    req.removeListener('aborted', handleRequestAborted);
    req.removeListener('error', handleError);
    parser.removeListener('error', handleError);
    parser.removeListener('finish', handleFinish);
    parser.removeListener('part', handlePart);
  };
  const settleError = (error) => {
    if (isSettled) {
      return;
    }

    isSettled = true;
    cleanup();
    req.unpipe(parser);
    req.resume();
    reject(error);
  };
  const handleError = (error) => settleError(error);
  const handleRequestData = (chunk) => {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      settleError(new Error('Mail webhook payload is too large.'));
    }
  };
  const handleRequestAborted = () => settleError(new Error('Mail webhook request was aborted.'));
  const handlePart = (part) => {
    let fieldName = null;
    let shouldCollect = false;
    let partHeaders = {};
    const chunks = [];

    part.on('header', (headers) => {
      partHeaders = headers;
      const contentDisposition = getFirstHeaderValue(headers['content-disposition']);
      fieldName = getMultipartFieldName(contentDisposition);
      shouldCollect = Boolean(fieldName)
        && trackedMultipartFieldNames.has(fieldName)
        && !isMultipartFilePart(contentDisposition);

      if (!shouldCollect) {
        part.resume();
      }
    });
    part.on('data', (chunk) => {
      if (shouldCollect) {
        chunks.push(chunk);
      }
    });
    part.on('error', handleError);
    part.on('end', () => {
      if (shouldCollect && fieldName) {
        formParts[fieldName] = {
          headers: partHeaders,
          data: Buffer.concat(chunks),
        };
      }
    });
  };
  const handleFinish = () => {
    if (isSettled) {
      return;
    }

    isSettled = true;
    cleanup();
    resolve(formParts);
  };

  req.on('data', handleRequestData);
  req.on('aborted', handleRequestAborted);
  req.on('error', handleError);
  parser.on('error', handleError);
  parser.on('finish', handleFinish);
  parser.on('part', handlePart);
  req.pipe(parser);
});
const decodeAndConvertMailPart = ({
  part,
  charsetHint,
  partName,
  requestId,
}) => {
  const transferEncoding = getPartTransferEncoding(part.headers);
  let decodedBuffer = part.data;

  if (transferEncoding) {
    try {
      decodedBuffer = decodeTransferEncodedBuffer(part.data, transferEncoding);
    } catch (error) {
      logWarn('mail_webhook.transfer_decode_failed', {
        requestId,
        partName,
        transferEncoding,
        message: error && error.message,
      });
      decodedBuffer = part.data;
    }
  }

  if (charsetHint && !isUtf8Charset(charsetHint)) {
    logInfo('mail_webhook.charset_hint_ignored', {
      requestId,
      partName,
      charsetHint,
    });
  }

  return decodeUtf8Buffer(decodedBuffer);
};
class AppError extends Error {
  constructor(code, message, httpStatus = 500, details = undefined) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}
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
const normalizeAppError = (error) => {
  if (error instanceof AppError) {
    return error;
  }

  if (error && error.code === 'EBADCSRFTOKEN') {
    return new AppError('CSRF_TOKEN_INVALID', 'Invalid CSRF token.', 403);
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
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shouldRetryLineError = (error) => {
  const statusCode = error && (error.statusCode || error.status);
  return !statusCode || statusCode >= 500;
};
const shouldRetryMqttError = (error) => Boolean(error);
const retryAsync = async ({
  operation,
  retries,
  initialDelayMs,
  shouldRetry,
  onRetry,
}) => {
  let attempt = 0;
  let delayMs = initialDelayMs;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      const canRetry = attempt < retries && shouldRetry(error);
      if (!canRetry) {
        throw error;
      }

      attempt += 1;
      if (onRetry) {
        onRetry(error, attempt, delayMs);
      }
      await delay(delayMs);
      delayMs *= 2;
    }
  }
};

const app = express();
const csrfProtection = csurf();
if (app.get('env') === 'production') {
  app.set('trust proxy', 1);
  sessionOptions.cookie.secure = true;
}
const isLoggedIn = async (extUserId) => {
  if(!extUserId) {
    debug('isLoggedIn:' + extUserId);
    return false;
  }
  const existUser = await db.getUserByExtUserId(extUserId);
  if(!existUser) {
    debug('isLoggedIn:userNotFound');
    return false;
  }
  debug('isLoggedIn:' + extUserId + ':' + existUser.ext_user_id);
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

app
  .use((req, res, next) => {
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
  })
  .use(session(sessionOptions))
  .use(helmet(helmetOption))
  .post('/msg-webhook', LINEMsgSdk.middleware(msgbotConfig), async (req, res, next) => {
    try {
      const event = req.body.events[0];
      if(event && event.type === 'join' && event.source.type === 'group') {
        logInfo('line.group_join.received', { requestId: req.requestId });
        const lineGroupId = event.source.groupId;
        const lineGroupSummary = await msgbot.getGroupSummary(lineGroupId);
        logInfo('line.group_join.recipient_sync', {
          requestId: req.requestId,
          lineGroupId,
        });
        await db.addRecipient(lineGroupId, 1, lineGroupSummary.groupName.substring(0, 63));
      }
      return res.sendStatus(200);
    } catch (e) {
      next(e);
    }
  })
  .post('/mail-webhook', async (req, res, next) => {
    try {
      const formParts = await streamMultipartForm(req, mailWebhookMaxBytes);
      const form = Object.keys(formParts).reduce((acc, key) => ({
        ...acc,
        ...(utf8MultipartFieldNames.has(key) ? { [key]: decodeUtf8Buffer(formParts[key].data) } : {}),
      }), {});
      let mailCharsets = {};
      try {
        mailCharsets = JSON.parse(form.charsets || '{}');
      } catch (error) {
        logWarn('mail_webhook.invalid_charsets_ignored', {
          requestId: req.requestId,
          message: error && error.message,
        });
        mailCharsets = {};
      }
      const mailTo = emailAddresses.parseAddressList((form.to || '').replace(/, *$/,''));
      if (!mailTo || mailTo.length <= 0) {
        logWarn('mail_webhook.invalid_to_address', { requestId: req.requestId });
        throw new AppError('INVALID_TO_ADDRESS', 'Invalid To address.', 400);
      }
      const recipient = await db.getEnabledRecipientByEmail(`${mailTo[0].local}`);
      if (!recipient) {
        logWarn('mail_webhook.unknown_recipient', {
          requestId: req.requestId,
          localPart: mailTo[0].local,
        });
        throw new AppError('UNKNOWN_RECIPIENT', 'Unknown recipient.', 404);
      }

      const mailContent = {
        'from': form.from || '',
        'subject': form.subject || '',
        'body': ''
      };
      if (formParts.text && formParts.text.data) {
        mailContent.body = decodeAndConvertMailPart({
          part: formParts.text,
          charsetHint: mailCharsets.text,
          partName: 'text',
          requestId: req.requestId,
        });
      }
      else if (formParts.html && formParts.html.data) {
        const htmlBody = decodeAndConvertMailPart({
          part: formParts.html,
          charsetHint: mailCharsets.html,
          partName: 'html',
          requestId: req.requestId,
        });
        mailContent.body = htmlToText.convert(htmlBody);
      }
      const msgBody = truncateLineTextMessage(`From: ${mailContent.from}\r\nSubject: ${mailContent.subject}\r\n\r\n${mailContent.body}`, {
        maxChars: lineTextMessageMaxChars,
        marker: lineTextMessageTruncationMarker,
      });
      await retryAsync({
        operation: () => msgbot.pushMessage({
          to: recipient.line_recipient_id,
          messages: [ { type: 'text', text: msgBody }, ],
        }),
        retries: 2,
        initialDelayMs: 200,
        shouldRetry: shouldRetryLineError,
        onRetry: (error, attempt, delayMs) => {
          logWarn('line.push.retry', {
            requestId: req.requestId,
            attempt,
            delayMs,
            statusCode: error && (error.statusCode || error.status),
          });
        },
      }).catch((err) => {
        const lineRequestId = err && err.headers && typeof err.headers.get === 'function'
          ? err.headers.get('x-line-request-id')
          : undefined;
        throw new AppError('LINE_PUSH_FAILED', 'Failed to push message to LINE.', 502, {
          statusCode: err && (err.statusCode || err.status),
          lineRequestId,
          body: err && err.body,
        });
      });
      logInfo('line.push.succeeded', {
        requestId: req.requestId,
        recipientId: recipient.line_recipient_id,
      });
      if (mqttPublish !== null) {
        retryAsync({
          operation: () => mqttPublish.publish(mailContent.subject),
          retries: 2,
          initialDelayMs: 200,
          shouldRetry: shouldRetryMqttError,
          onRetry: (error, attempt, delayMs) => {
            logWarn('mqtt.publish.retry', {
              requestId: req.requestId,
              attempt,
              delayMs,
              message: error && error.message,
            });
          },
        }).then(() => {
          logInfo('mqtt.publish.succeeded', {
            requestId: req.requestId,
            topic: mqttPublish.topic,
          });
        }).catch((error) => {
          logError('mqtt.publish.failed', {
            requestId: req.requestId,
            message: error && error.message,
          });
        });
      }
      return res.sendStatus(200);
    } catch(e) {
      next(e)
    }
  })
  .use(express.static(`${__dirname}/public`))
  .use(bodyParser.urlencoded({
    extended: true,
  }))
  .use(bodyParser.json())
  .set('view engine', 'ejs')
  .get('/', async (req, res) => {
    const extUserId = req.session.userId;
    logInfo('page.index.render', { requestId: req.requestId, extUserId });
    if (! await isLoggedIn(extUserId)) {
      res.redirect(`${req.baseUrl}/login`);
      return;
    }
    db.getRegisteredAddrByExtUserId(extUserId)
      .then((pageParam) => {
        res.render(`${__dirname}/pages/index`, { param: pageParam });
      })
      .catch((msg) => res.status(500).send(msg));
  })
  .get('/login', async (req, res) => {
    if (await isLoggedIn(req.session.userId)) {
      res.redirect(`${req.baseUrl}/`);
      return;
    }
    res.render(`${__dirname}/pages/login`);
  })
  .get('/logout', (req, res) => {
    req.session.destroy();
    return res.redirect(`${req.baseUrl}/login?reason=logged_out`);
  })
  .get('/auth', login.auth())
  .get('/callback', login.callback(
    async (req, res, _, tokenResponse) => {
      if (tokenResponse.expires_in > 0 && tokenResponse.id_token) {
        const lineUserId = tokenResponse.id_token.sub;
        const user = await db.addUser(lineUserId);
        const userId = user.ext_user_id;
        const lineUserProfile = await msgbot.getProfile(lineUserId)
          .catch(() => Promise.resolve({ displayName: 'self' }));
        await db.addRecipient(lineUserId, 0, lineUserProfile.displayName.substring(0, 63), userId);
        req.session.userId = userId;
        logInfo('auth.callback.succeeded', {
          requestId: req.requestId,
          lineUserId,
          userId,
        });
        return res.redirect(`${req.baseUrl}/`);
      }
      return res.status(401).json({ msg: 'Auth failed.' });
    }, (req, res, _, error) => {
      logWarn('auth.callback.failed', {
        requestId: req.requestId,
        message: error && error.message,
      });
      req.session.destroy();
      return res.redirect(`${req.baseUrl}/login?reason=login_failed`);
    },
  ))
  .get('/api/user', async (req, res, next) => {
    try {
      const extUserId = await requireAuthenticatedUser(req);
      const user = await db.getUserByExtUserId(extUserId);
      if (!user) {
        throw new AppError('USER_NOT_FOUND', 'user is not found.', 404);
      }
      res.status(200).json({
        msg: 'Success',
        result: (({ ext_user_id, line_user_id }) => ({ ext_user_id, line_user_id }))(user)
      });
    } catch (e) {
      next(e);
    }
  })
  .get('/api/recipient', async (req, res, next) => {
    try {
      const extUserId = await requireAuthenticatedUser(req);
      const availableRecipient = await getAvailableRecipient(extUserId);
      res.status(200).json({
        msg: 'Success',
        result: availableRecipient.map( rcpt => (({ ext_recipient_id, recipient_type, line_recipient_id, recipient_description, ext_addr_id, addr_mail }) => ({ ext_recipient_id, recipient_type, line_recipient_id, recipient_description, ext_addr_id, addr_mail }))(rcpt))
      });
    } catch (e) {
      next(e);
    }
  })
  .get('/api/addr', async (req, res, next) => {
    try {
      const extUserId = await requireAuthenticatedUser(req);
      const registeredAddr = await db.getRegisteredAddrByExtUserId(extUserId);
      res.status(200).json({
        msg: 'Success',
        result: registeredAddr.map(addr => (({ ext_addr_id, addr_mail }) => ({ ext_addr_id, addr_mail }))(addr))
      });
    } catch (e) {
      next(e);
    }
  })
  .get('/api/csrf-token', csrfProtection, async (req, res, next) => {
    try {
      await requireAuthenticatedUser(req);
      res.status(200).json({
        msg: 'Success',
        result: {
          csrfToken: req.csrfToken(),
        },
      });
    } catch (e) {
      next(e);
    }
  })
  .post('/api/addr', csrfProtection, async (req, res, next) => {
    try {
      const extUserId = await requireAuthenticatedUser(req);
      const inputEmail = req.body.formInputEmail;
      const inputRecipient = req.body.formInputRecipient;
      if(!inputEmail) {
        throw new AppError('EMAIL_REQUIRED', 'Email address is empty.', 400);
      }
      if(!inputRecipient) {
        throw new AppError('RECIPIENT_REQUIRED', 'Recipient is empty.', 400);
      }
      let emailAddr = inputEmail;
      if (inputEmail.indexOf('@') === -1) {
        emailAddr = `${inputEmail}@local`;
      }
      const emailObj = emailAddresses.parseOneAddress(emailAddr);
      if(!emailObj || !emailObj.local) {
        throw new AppError('EMAIL_INVALID', 'Email address is invalid format.', 400);
      }
      if(emailObj.local.length < 4) {
        throw new AppError('EMAIL_TOO_SHORT', 'Email address is too short.', 400);
      }
      emailAddr = emailObj.local.toLowerCase();
      if(await db.getAddrByEmail(emailAddr)) {
        throw new AppError('EMAIL_ALREADY_EXISTS', 'Email address is already exists.', 400);
      }

      const availableRecipient = await getAvailableRecipient(extUserId);
      const extRecipient = availableRecipient.find(rcpt => rcpt.ext_recipient_id === inputRecipient);
      if(!extRecipient) {
        throw new AppError('RECIPIENT_NOT_FOUND', 'Recipient is not found.', 400);
      }
      const extRecipientId = extRecipient.ext_recipient_id;
      if(!extRecipientId) {
        throw new AppError('RECIPIENT_UNAVAILABLE', 'Recipient ' + extRecipientId + ' is not available.', 400);
      }
      await db.addAddr(emailAddr, extUserId, extRecipientId);
      const addr = await db.getAddrByEmail(emailAddr);
      res.status(200).json({
        msg: 'Success',
        result: (({ ext_addr_id, addr_mail }) => ({ ext_addr_id, addr_mail }))(addr)
      });
    } catch (e) {
      next(e);
    }
  })
  .delete('/api/addr/:extAddrId', csrfProtection, async (req, res, next) => {
    try {
      const extAddrId = req.params.extAddrId;
      const extUserId = await requireAuthenticatedUser(req);
      const addr = await db.getAddrByExtAddrId(extAddrId);
      if (!addr) {
        throw new AppError('ADDRESS_NOT_FOUND', 'Address is not found.', 404);
      }
      const registeredAddr = await db.getRegisteredAddrByExtUserId(extUserId);
      const deleteCandidate = registeredAddr.some((registeredAddrObj) => (
        addr.addr_id === registeredAddrObj.addr_id
        && addr.ext_addr_id === registeredAddrObj.ext_addr_id
      ));
      if (!deleteCandidate) {
        throw new AppError('ADDRESS_NOT_OWNED', 'Address is not registered by this user.', 404, {
          extAddrId,
        });
      }
      await db.delAddr(extAddrId);
      res.status(200).json({ msg: 'Success', result: [ extAddrId ]});
    } catch (e) {
      next(e);
    }
  })
  .use((err, req, res, next) => {
    const appError = normalizeAppError(err);
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
  })
  .listen(listenPort, () => logInfo('server.started', { listenPort }));
