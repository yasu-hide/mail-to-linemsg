require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const multerUpload = require('multer')();
const debug = require('debug')('index');
const { Iconv } = require('iconv');
const helmet = require('helmet');
const emailAddresses = require('email-addresses');

const LINELogin = require('line-login');
const LINENotify = require('./line-notify');
const MQTTPublish = require('./mqtt-publish');
const Database = require('./db-pgsql');

const sessionOptions = {
  secret: process.env.LINECORP_PLATFORM_CHANNEL_CHANNELSECRET,
  cookie: { maxAge: 600000 },
  resave: false,
  saveUninitialized: false,
};
const listenPort = process.env.PORT || 3000;
const login = new LINELogin({
  channel_id: process.env.LINECORP_PLATFORM_CHANNEL_CHANNELID,
  channel_secret: process.env.LINECORP_PLATFORM_CHANNEL_CHANNELSECRET,
  callback_url: process.env.LINECORP_PLATFORM_CHANNEL_CALLBACKURL,
});
const notify = new LINENotify({
  client_id: process.env.LINECORP_PLATFORM_NOTIFY_CLIENTID,
  client_secret: process.env.LINECORP_PLATFORM_NOTIFY_CLIENTSECRET,
  callback_url: process.env.LINECORP_PLATFORM_NOTIFY_CALLBACKURL,
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

const isLoggedIn = (userId) => (userId != null);

const app = express();
if (app.get('env') === 'production') {
  app.set('trust proxy', 1);
  sessionOptions.cookie.secure = true;
}

app
  .use(session(sessionOptions))
  .use(helmet())
  .post('/webhook', multerUpload.none(), async (req, res) => {
    res.sendStatus(200);
    const form = req.body;
    const mailTo = emailAddresses.parseAddressList(form.to.replace(/, *$/,''));
    if (!mailTo || mailTo.length <= 0) {
      debug('Invalid To address.');
      return;
    }
    const notifyToken = await db.getEnabledNotifyTokenByAddr(`${mailTo[0].local}`)
      .catch((msg) => debug(msg));
    if (!notifyToken) {
      debug('Unknown user.');
      return;
    }
    const mailCharsets = JSON.parse(form.charsets);
    const convertUtf8 = (convertString, convertCharset) => {
      const cnv = new Iconv(convertCharset, 'UTF-8//TRANSLIT//IGNORE');
      return cnv.convert(convertString).toString();
    }

    const mailContent = {
      'from': convertUtf8(form.from, mailCharsets.from),
      'subject': convertUtf8(form.subject, mailCharsets.subject),
      'body': ''
    };
    if(mailCharsets.text && form.text) {
      mailContent.body = convertUtf8(form.text, mailCharsets.text);
    }
    else if(mailCharsets.html && form.html) {
      const htmlToText = require('html-to-text');
      mailContent.body = convertUtf8(htmlToText.convert(form.html), mailCharsets.html);
    }

    const notifyBody = `From: ${mailContent.from}\r\nSubject: ${mailContent.subject}\r\n\r\n${mailContent.body}`;
    await notify.notifyMessage(notifyToken, notifyBody)
      .catch((stCode, msg) => debug(stCode, msg));
    if (mqttPublish !== null) {
      mqttPublish.publish(mailContent.subject)
        .catch((msg) => debug(msg));
    }
  })
  .use(express.static(`${__dirname}/public`))
  .use(bodyParser.urlencoded({
    extended: true,
  }))
  .use(bodyParser.json())
  .set('view engine', 'ejs')
  .get('/', (req, res) => {
    const userId = req.session.user_id;
    debug('index:user_id', userId);
    if (!isLoggedIn(userId)) {
      res.redirect(`${req.baseUrl}/login`);
      return;
    }
    db.getAddr(userId)
      .then((pageParam) => {
        res.render(`${__dirname}/pages/index`, { param: pageParam });
      })
      .catch((msg) => res.status(500).send(msg));
  })
  .get('/login', (req, res) => {
    if (isLoggedIn(req.session.user_id)) {
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
        const userId = await db.createUser(lineUserId);
        req.session.user_id = userId;
        return res.redirect(`${req.baseUrl}/`);
      }
      return res.status(401);
    }, (req, res, _, error) => {
      debug(error);
      req.session.destroy();
      return res.redirect(`${req.baseUrl}/login?reason=login_failed`);
    },
  ))
  .post('/register-addr', async (req, res) => {
    if (!isLoggedIn(req.session.user_id)) {
      req.session.destroy();
      return res.redirect(`${req.baseUrl}/login?reason=not_logged_in`);
    }
    const inputEmail = req.body.formInputEmail;
    if (!inputEmail) {
      return res.redirect(`${req.baseUrl}/?reason=invalid_addr`);
    }
    let email = inputEmail;
    if (inputEmail.indexOf('@') === -1) {
      email = `${inputEmail}@local`
    }
    email = emailAddresses.parseOneAddress(email);
    if (!email) {
      return res.redirect(`${req.baseUrl}/?reason=invalid_addr`);
    }
    if(email.local.length < 4) {
      return res.redirect(`${req.baseUrl}/?reason=too_short_addr`);
    }

    req.session.email = email.local.toLowerCase();
    if (await db.isDupAddr(req.session.email)) {
      return res.redirect(`${req.baseUrl}/?reason=duplicate_addr`);
    }
    return res.redirect(`${req.baseUrl}/notify-auth`);
  })
  .post('/unregister-addr', async (req, res) => {
    if (!isLoggedIn(req.session.user_id)) {
      req.session.destroy();
      return res.redirect(`${req.baseUrl}/login?reason=not_logged_in`);
    }
    const addrId = req.body.formIndexEmail;
    const notifyToken = await db.getNotifyToken(addrId);
    if (notifyToken) {
      await notify.revokeAccessToken(notifyToken)
        .then(await db.unsetAddr(addrId))
        .catch((stCode, msg) => debug(stCode, msg));
    }
    return res.redirect(`${req.baseUrl}/`);
  })
  .get('/notify-auth', (req, res, next) => {
    if (!isLoggedIn(req.session.user_id)) {
      req.session.destroy();
      return res.redirect(`${req.baseUrl}/login?reason=not_logged_in`);
    }
    return notify.auth()(req, res, next);
  })
  .get('/notify-callback', notify.callback(
    async (req, res, _, tokenResponse) => {
      if (!isLoggedIn(req.session.user_id)) {
        req.session.destroy();
        return res.redirect(`${req.baseUrl}/login?reason=not_logged_in`);
      }
      if (tokenResponse.access_token) {
        const notifyToken = encodeURIComponent(tokenResponse.access_token);
        const userId = req.session.user_id;
        const mailAddr = req.session.email;
        delete req.session.email;
        await db.setAddr(mailAddr, userId, notifyToken, 1)
          .catch((msg) => debug(msg));
        return res.redirect(`${req.baseUrl}/`);
      }
      return res.status(401);
    }, (req, res, _, error) => {
      debug(error);
      return res.redirect(`${req.baseUrl}/?reason=canceled_notify_auth`);
    },
  ))
  .listen(listenPort, () => debug(`Listening on ${listenPort}`));
