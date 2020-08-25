const debug = require('debug')('line-notify:module');
const request = require('request');
const querystring = require('querystring');
const secureCompare = require('secure-compare');
const crypto = require('crypto');

class LineNotify {
  constructor(options) {
    const requiredParams = ['client_id', 'client_secret', 'callback_url'];
    requiredParams.forEach((param) => {
      if (!options[param]) {
        throw new Error(`Required parameter ${param} is missing.`);
      }
    });
    this.client_id = options.client_id;
    this.client_secret = options.client_secret;
    this.callback_url = options.callback_url;
    this.scope = 'notify';
  }

  auth() {
    // eslint-disable-next-line no-unused-vars
    return (req, res, _) => {
      // eslint-disable-next-line no-underscore-dangle
      const stateParam = LineNotify._random();
      req.session.line_login_state = stateParam;
      // eslint-disable-next-line no-underscore-dangle
      const nonceParam = LineNotify._random();
      req.session.line_login_nonce = nonceParam;

      const query = querystring.stringify({
        response_type: 'code',
        client_id: process.env.LINECORP_PLATFORM_NOTIFY_CLIENTID,
        redirect_uri: process.env.LINECORP_PLATFORM_NOTIFY_CALLBACKURL,
        state: stateParam,
        nonce: nonceParam,
        scope: encodeURIComponent(this.scope),
      });
      res.redirect(301, `https://notify-bot.line.me/oauth/authorize?${query}`);
    };
  }

  callback(s, f) {
    // eslint-disable-next-line consistent-return
    return (req, res, next) => {
      const authCode = req.query.code;
      const failed = ((cause) => {
        debug(cause);
        return f(req, res, next, cause);
      });
      if (!authCode) {
        return failed('Authorization failed.');
      }
      if (!secureCompare(req.session.line_login_state, req.query.state)) {
        return failed('Authorization failed. State does not match.');
      }
      debug('Authorization succeeded.');
      delete req.session.line_login_state;
      delete req.session.line_login_nonce;

      this.issueAccessToken(authCode).then((tokenResponse) => {
        s(req, res, next, tokenResponse);
      }).catch((statusCode, error) => {
        debug(statusCode, error);
        if (f) return f(req, res, next, error);
        throw error;
      });
    };
  }

  issueAccessToken(authCode) {
    return request.postAsync({
      url: 'https://notify-bot.line.me/oauth/token',
      form: {
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: this.callback_url,
        client_id: this.client_id,
        client_secret: this.client_secret,
      },
    }).then((response) => {
      if (response.statusCode === 200) {
        return JSON.parse(response.body);
      }
      return (response.statusCode, new Error(response.statusMessage));
    });
  }

  // eslint-disable-next-line class-methods-use-this
  notifyMessage(accessToken, messageText) {
    return request.postAsync({
      url: 'https://notify-api.line.me/api/notify',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      form: {
        message: messageText,
      },
    }).then((response) => {
      if (response.statusCode === 200) {
        return null;
      }
      return (response.statusCode, new Error(response.statusMessage));
    });
  }

  // eslint-disable-next-line class-methods-use-this
  revokeAccessToken(accessToken) {
    return request.postAsync({
      url: 'https://notify-api.line.me/api/revoke',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }).then((response) => {
      if (response.statusCode === 200) {
        return null;
      }
      return (response.statusCode, new Error(response.statusMessage));
    });
  }

  // eslint-disable-next-line class-methods-use-this
  getTokenStatus(accessToken) {
    return request.getAsync({
      url: 'https://notify-api.line.me/api/status',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }).then((response) => {
      if (response.statusCode === 200) {
        return JSON.parse(response.body);
      }
      return (response.statusCode, new Error(response.statusMessage));
    });
  }

  /**
    Method to generate random string.
    @method
    @return {Number}
    */
  // eslint-disable-next-line no-underscore-dangle
  static _random() {
    return crypto.randomBytes(20).toString('base64');
  }
}
module.exports = LineNotify;
