const Busboy = require('busboy');
const emailAddresses = require('email-addresses');
const htmlToText = require('html-to-text');
const {
  getPartTransferEncoding,
  decodeTransferEncodedBuffer,
} = require('./transfer-encoding');
const {
  isUtf8Charset,
  decodeUtf8Buffer,
  convertUtf8,
  truncateLineTextMessage,
} = require('./mail-text');
const { AppError } = require('./errors');
const {
  verifyInboundParseWebhookSignature: defaultVerifyInboundParseWebhookSignature,
} = require('./inbound-parse-webhook-signature');

const mailWebhookMaxBytes = 30 * 1024 * 1024;
const mqttPublishDeadlineMs = 500;
const lineTextMessageMaxChars = 5000;
const lineTextMessageTruncationMarker = '\r\n（省略）';
const trackedMultipartFieldNames = new Set(['to', 'from', 'subject', 'charsets', 'text', 'html']);
const utf8MultipartFieldNames = new Set(['to', 'from', 'subject', 'charsets']);

const createSafeLogId = (logger, value) => {
  if (!value) {
    return undefined;
  }
  if (logger && typeof logger.createLogCorrelationId === 'function') {
    return logger.createLogCorrelationId(value);
  }

  return undefined;
};

const getMultipartBoundary = (contentType) => {
  const matched = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!matched) {
    throw new Error('Multipart boundary is missing.');
  }

  return matched[1] || matched[2];
};

const streamMultipartForm = (req, maxBytes = mailWebhookMaxBytes) => new Promise((resolve, reject) => {
  getMultipartBoundary(req.headers['content-type'] || '');
  const parser = Busboy({
    headers: req.headers,
    limits: {
      files: 0,
      fieldSize: maxBytes,
    },
  });
  const formParts = {};
  const rawChunks = [];
  let totalBytes = 0;
  let isSettled = false;

  const cleanup = () => {
    req.removeListener('data', handleRequestData);
    req.removeListener('aborted', handleRequestAborted);
    req.removeListener('error', handleError);
    parser.removeListener('error', handleError);
    parser.removeListener('finish', handleFinish);
    parser.removeListener('field', handleField);
    parser.removeListener('file', handleFile);
    parser.removeListener('fieldsLimit', handleLimitExceeded);
    parser.removeListener('filesLimit', handleLimitExceeded);
    parser.removeListener('partsLimit', handleLimitExceeded);
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
  const handleLimitExceeded = () => settleError(new Error('Mail webhook payload is too large.'));
  const handleRequestData = (chunk) => {
    rawChunks.push(chunk);
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      settleError(new Error('Mail webhook payload is too large.'));
    }
  };
  const handleRequestAborted = () => settleError(new Error('Mail webhook request was aborted.'));
  const handleFile = (_, file) => file.resume();
  const handleField = (fieldName, value, info) => {
    if (!trackedMultipartFieldNames.has(fieldName)) {
      return;
    }
    if (info && info.valueTruncated) {
      settleError(new Error('Mail webhook payload is too large.'));
      return;
    }

    const transferEncoding = (info && info.encoding) ? info.encoding.toLowerCase() : '';
    formParts[fieldName] = {
      headers: {
        'content-transfer-encoding': [transferEncoding],
      },
      data: Buffer.from(value, 'utf8'),
    };
  };
  const handleFinish = () => {
    if (isSettled) {
      return;
    }

    isSettled = true;
    cleanup();
    resolve({
      formParts,
      rawBody: Buffer.concat(rawChunks, totalBytes),
    });
  };

  req.on('data', handleRequestData);
  req.on('aborted', handleRequestAborted);
  req.on('error', handleError);
  parser.on('error', handleError);
  parser.on('finish', handleFinish);
  parser.on('field', handleField);
  parser.on('file', handleFile);
  parser.on('fieldsLimit', handleLimitExceeded);
  parser.on('filesLimit', handleLimitExceeded);
  parser.on('partsLimit', handleLimitExceeded);
  req.pipe(parser);
});

const decodeAndConvertMailPart = ({
  part,
  charsetHint,
  partName,
  requestId,
  logger,
}) => {
  const transferEncoding = getPartTransferEncoding(part.headers);
  let decodedBuffer = part.data;

  if (transferEncoding) {
    try {
      decodedBuffer = decodeTransferEncodedBuffer(part.data, transferEncoding);
      logger.logInfo('mail_webhook.part.transfer_decoded', {
        requestId,
        partName,
        transferEncoding,
        bytesBefore: part.data.length,
        bytesAfter: decodedBuffer.length,
      });
    } catch (error) {
      logger.logWarn('mail_webhook.transfer_decode_failed', {
        requestId,
        partName,
        transferEncoding,
        message: error && error.message,
      });
      decodedBuffer = part.data;
    }
  }

  try {
    const convertedText = isUtf8Charset(charsetHint)
      ? decodeUtf8Buffer(decodedBuffer)
      : convertUtf8(decodedBuffer, charsetHint);
    logger.logInfo('mail_webhook.part.charset_converted', {
      requestId,
      partName,
      charsetHint,
      bytes: decodedBuffer.length,
      chars: Array.from(convertedText).length,
    });
    return convertedText;
  } catch (error) {
    logger.logWarn('mail_webhook.part.charset_conversion_failed', {
      requestId,
      partName,
      charsetHint,
      message: error && error.message,
    });
  }

  return decodeUtf8Buffer(decodedBuffer);
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withDeadline = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('MQTT publish deadline exceeded.')), ms);
    if (timer.unref) {
      timer.unref();
    }
  }),
]);

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

const createMailWebhookHandler = ({
  db,
  msgbot,
  mqttPublish,
  logger,
  verifyInboundParseWebhookSignature = defaultVerifyInboundParseWebhookSignature,
  maxBytes = mailWebhookMaxBytes,
}) => async (req, res, next) => {
  try {
    const {
      formParts,
      rawBody,
    } = await streamMultipartForm(req, maxBytes);
    logger.logInfo('mail_webhook.received', {
      requestId: req.requestId,
      rawBodyBytes: rawBody.length,
      fields: Object.keys(formParts).sort(),
    });
    verifyInboundParseWebhookSignature({
      headers: req.headers,
      rawBody,
    });
    logger.logInfo('mail_webhook.signature.verified', {
      requestId: req.requestId,
    });
    const form = Object.keys(formParts).reduce((acc, key) => ({
      ...acc,
      ...(utf8MultipartFieldNames.has(key) ? { [key]: decodeUtf8Buffer(formParts[key].data) } : {}),
    }), {});
    let mailCharsets = {};
    try {
      mailCharsets = JSON.parse(form.charsets || '{}');
    } catch (error) {
      logger.logWarn('mail_webhook.invalid_charsets_ignored', {
        requestId: req.requestId,
        message: error && error.message,
      });
      mailCharsets = {};
    }
    const mailTo = emailAddresses.parseAddressList((form.to || '').replace(/, *$/,''));
    if (!mailTo || mailTo.length <= 0) {
      logger.logWarn('mail_webhook.invalid_to_address', { requestId: req.requestId });
      throw new AppError('INVALID_TO_ADDRESS', 'Invalid To address.', 400);
    }
    const recipient = await db.getEnabledRecipientByEmail(`${mailTo[0].local}`);
    const recipientAddressKey = createSafeLogId(logger, mailTo[0].local);
    if (!recipient) {
      logger.logWarn('mail_webhook.unknown_recipient', {
        requestId: req.requestId,
        recipientAddressKey,
      });
      throw new AppError('UNKNOWN_RECIPIENT', 'Unknown recipient.', 404);
    }
    const lineRecipientKey = createSafeLogId(logger, recipient.line_recipient_id);
    logger.logInfo('mail_webhook.recipient.resolved', {
      requestId: req.requestId,
      recipientAddressKey,
      lineRecipientKey,
    });

    const mailContent = {
      'from': form.from || '',
      'subject': form.subject || '',
      'body': ''
    };
    if (formParts.text && formParts.text.data) {
      logger.logInfo('mail_webhook.body.selected', {
        requestId: req.requestId,
        partName: 'text',
      });
      mailContent.body = decodeAndConvertMailPart({
        part: formParts.text,
        charsetHint: mailCharsets.text,
        partName: 'text',
        requestId: req.requestId,
        logger,
      });
    }
    else if (formParts.html && formParts.html.data) {
      logger.logInfo('mail_webhook.body.selected', {
        requestId: req.requestId,
        partName: 'html',
      });
      const htmlBody = decodeAndConvertMailPart({
        part: formParts.html,
        charsetHint: mailCharsets.html,
        partName: 'html',
        requestId: req.requestId,
        logger,
      });
      mailContent.body = htmlToText.convert(htmlBody);
    }
    const lineMessageText = `From: ${mailContent.from}\r\nSubject: ${mailContent.subject}\r\n\r\n${mailContent.body}`;
    const charsBefore = Array.from(lineMessageText).length;
    const msgBody = truncateLineTextMessage(lineMessageText, {
      maxChars: lineTextMessageMaxChars,
      marker: lineTextMessageTruncationMarker,
    });
    const charsAfter = Array.from(msgBody).length;
    logger.logInfo('mail_webhook.message.prepared', {
      requestId: req.requestId,
      charsBefore,
      charsAfter,
      truncated: charsAfter < charsBefore,
    });
    const channels = [
      {
        name: 'line',
        run: async () => {
          logger.logInfo('line.push.started', {
            requestId: req.requestId,
            lineRecipientKey,
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
              logger.logWarn('line.push.retry', {
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
            logger.logError('line.push.failed', {
              requestId: req.requestId,
              lineRecipientKey,
              statusCode: err && (err.statusCode || err.status),
              lineRequestId,
              message: err && err.message,
            });
            throw new AppError('LINE_PUSH_FAILED', 'Failed to push message to LINE.', 502, {
              statusCode: err && (err.statusCode || err.status),
              lineRequestId,
            });
          });
          logger.logInfo('line.push.succeeded', {
            requestId: req.requestId,
            lineRecipientKey,
          });
        },
      },
    ];

    if (mqttPublish != null) {
      channels.push({
        name: 'mqtt',
        run: async () => {
          logger.logInfo('mqtt.publish.started', {
            requestId: req.requestId,
            topic: mqttPublish.topic,
          });
          await withDeadline(retryAsync({
            operation: () => mqttPublish.publish(mailContent.subject),
            retries: 1,
            initialDelayMs: 100,
            shouldRetry: shouldRetryMqttError,
            onRetry: (error, attempt, delayMs) => {
              logger.logWarn('mqtt.publish.retry', {
                requestId: req.requestId,
                attempt,
                delayMs,
                message: error && error.message,
              });
            },
          }), mqttPublishDeadlineMs).catch((error) => {
            logger.logError('mqtt.publish.failed', {
              requestId: req.requestId,
              message: error && error.message,
            });
            throw error;
          });
          logger.logInfo('mqtt.publish.succeeded', {
            requestId: req.requestId,
            topic: mqttPublish.topic,
          });
        },
      });
    }

    const results = await Promise.allSettled(channels.map((channel) => channel.run()));
    const delivered = [];
    const failed = [];
    results.forEach((result, index) => {
      (result.status === 'fulfilled' ? delivered : failed).push(channels[index].name);
    });

    if (failed.length === 0) {
      return res.sendStatus(200);
    }
    if (delivered.length > 0) {
      logger.logInfo('mail_webhook.partial_success', {
        requestId: req.requestId,
        delivered,
        failed,
      });
      return res.status(207).json({
        success: false,
        requestId: req.requestId,
        delivered,
        failed,
      });
    }
    // 全失敗。LINE は常時チャネルに含まれ、失敗時は AppError('LINE_PUSH_FAILED')
    // を reject するため、その理由を投げてエラーミドルウェアで 502 にする。
    const lineFailure = results.find(
      (result, index) => result.status === 'rejected' && channels[index].name === 'line',
    );
    throw lineFailure.reason;
  } catch(e) {
    next(e);
  }
};

module.exports = {
  createMailWebhookHandler,
  decodeAndConvertMailPart,
  getMultipartBoundary,
  streamMultipartForm,
};
