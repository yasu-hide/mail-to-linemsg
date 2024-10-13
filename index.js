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

const app = express();
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
  .use(session(sessionOptions))
  .use(helmet(helmetOption))
  .post('/msg-webhook', LINEMsgSdk.middleware(msgbotConfig), async (req, res, next) => {
    try {
      res.sendStatus(200);
      const event = req.body.events[0];
      if(event && event.type === 'join' && event.source.type === 'group') {
        const lineGroupId = event.source.groupId;
        const lineGroupSummary = await msgbot.getGroupSummary(lineGroupId);
        await db.addRecipient(lineGroupId, 1, lineGroupSummary.groupName.substring(0, 63));
      }
    } catch (e) {
      next(e);
    }
  })
  .post('/mail-webhook', multerUpload.none(), async (req, res, next) => {
    try {
      res.sendStatus(200);
      const form = req.body;
      const mailTo = emailAddresses.parseAddressList(form.to.replace(/, *$/,''));
      if (!mailTo || mailTo.length <= 0) {
        debug('Invalid To address.');
        return;
      }
      const recipient = await db.getEnabledRecipientByEmail(`${mailTo[0].local}`);
      if (!recipient) {
        debug('Unknown recipient.');
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
      const msgBody = `From: ${mailContent.from}\r\nSubject: ${mailContent.subject}\r\n\r\n${mailContent.body}`;
      await msgbot.pushMessage({
        to: recipient.line_recipient_id,
        messages: [ { type: 'text', text: msgBody }, ],
      });
      if (mqttPublish !== null) {
        mqttPublish.publish(mailContent.subject)
          .catch((msg) => debug(msg));
      }
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
    debug('index:extUserId', extUserId);
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
        return res.redirect(`${req.baseUrl}/`);
      }
      return res.status(401);
    }, (req, res, _, error) => {
      debug(error);
      req.session.destroy();
      return res.redirect(`${req.baseUrl}/login?reason=login_failed`);
    },
  ))
  .get('/api/user', async (req, res, next) => {
    try {
      const extUserId = req.session.userId;
      if (! await isLoggedIn(extUserId)) {
        req.session.destroy();
        return res.status(401).json({msg: "Auth failed." });
      }
      const user = await db.getUserByExtUserId(extUserId);
      if (!user) {
        return res.status(400).json({ msg: 'user is not found.' });
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
      const extUserId = req.session.userId;
      if (! await isLoggedIn(extUserId)) {
        req.session.destroy();
        return res.status(401).json({msg: "Auth failed." });
      }
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
      const extUserId = req.session.userId;
      if (! await isLoggedIn(extUserId)) {
        req.session.destroy();
        return res.status(401).json({ msg: "Auth failed." });
      }
      const registeredAddr = await db.getRegisteredAddrByExtUserId(extUserId);
      res.status(200).json({
        msg: 'Success',
        result: registeredAddr.map(addr => (({ ext_addr_id, addr_mail }) => ({ ext_addr_id, addr_mail }))(addr))
      });
    } catch (e) {
      next(e);
    }
  })
  .post('/api/addr', async (req, res, next) => {
    try {
      const extUserId = req.session.userId;
      if (! await isLoggedIn(extUserId)) {
        req.session.destroy();
        return res.status(401).json({ msg: "Auth failed." });
      }
      const inputEmail = req.body.formInputEmail;
      const inputRecipient = req.body.formInputRecipient;
      if(!inputEmail) {
        return res.status(400).json({ msg: 'Email address is empty.' });
      }
      if(!inputRecipient) {
        return res.status(400).json({ msg: 'Recipient is empty.' });
      }
      let emailAddr = inputEmail;
      if (inputEmail.indexOf('@') === -1) {
        emailAddr = `${inputEmail}@local`;
      }
      const emailObj = emailAddresses.parseOneAddress(emailAddr);
      if(!emailAddr) {
        return res.status(400).json({ msg: 'Email address is invalid format.' });
      }
      if(emailObj.local.length < 4) {
        return res.status(400).json({ msg: 'Email address is too short.' });
      }
      emailAddr = emailObj.local.toLowerCase();
      if(await db.getAddrByEmail(emailAddr)) {
        return res.status(400).json({ msg: 'Email address is already exists.' });
      }

      const availableRecipient = await getAvailableRecipient(extUserId);
      const extRecipient = availableRecipient.find(rcpt => rcpt.ext_recipient_id === inputRecipient);
      if(!extRecipient) {
        return res.status(400).json({ msg: 'Recipient is not found.' });
      }
      const extRecipientId = extRecipient.ext_recipient_id;
      if(!extRecipientId) {
        return res.status(400).json({ msg: 'Recipient ' + extRecipientId + ' is not available.' });
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
  .delete('/api/addr/:extAddrId', async (req, res, next) => {
    try {
      const extAddrId = req.params.extAddrId;
      const extUserId = req.session.userId;
      if (! await isLoggedIn(extUserId)) {
        req.session.destroy();
        return res.status(401).json({ msg: "Auth failed." });
      }
      const addr = await db.getAddrByExtAddrId(extAddrId);
      const registeredAddr = await db.getRegisteredAddrByExtUserId(extUserId);
      const deleteCandidate = registeredAddr.filter(registeredAddrObj => { (addr.addr_id === registeredAddrObj.addr_id) && (addr.ext_addr_id === registeredAddrObj.ext_addr_id) });
      if (!deleteCandidate) {
        return res.status(204).json({ msg: 'No content', result: [] });
      }
      await db.delAddr(extAddrId);
      res.status(200).json({ msg: 'Success', result: [ extAddrId ]});
    } catch (e) {
      next(e);
    }
  })
  .listen(listenPort, () => debug(`Listening on ${listenPort}`));
