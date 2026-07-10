require('dotenv').config();

const LINEMsgSdk = require('@line/bot-sdk');
const MQTTPublish = require('./mqtt-publish');
const Database = require('./db-pgsql');
const { createApp } = require('./app/create-app');
const { logInfo } = require('./lib/logger');
const { requireSessionSecret } = require('./lib/session-secret');

// SESSION_SECRET is required; unset means fail-fast at load time.
// (Distinct from the mqttPublish try/catch below, which disables an
//  optional feature and continues. A missing session secret must stop boot.)
const sessionSecret = requireSessionSecret(process.env);
const sessionOptions = {
  secret: sessionSecret,
  name: 'mail_to_linemsg.sid',
  cookie: {
    maxAge: 600000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  },
  resave: false,
  saveUninitialized: false,
};
const listenPort = process.env.PORT || 3000;
const lineLoginConfig = {
  channelId: process.env.LINECORP_PLATFORM_LOGIN_CHANNEL_ID,
  channelSecret: process.env.LINECORP_PLATFORM_LOGIN_CHANNEL_SECRET,
  callbackUrl: process.env.LINECORP_PLATFORM_LOGIN_CHANNEL_CALLBACKURL,
};
const msgbotConfig = {
  channelAccessToken: process.env.LINECORP_PLATFORM_MESSAGING_CHANNEL_ACCESSTOKEN,
  channelSecret: process.env.LINECORP_PLATFORM_MESSAGING_CHANNEL_SECRET,
};
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
    logInfo('mqtt.module.unavailable', {
      message: 'Failed to load MQTT module.',
    });
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

const app = createApp({
  rootDir: __dirname,
  config: {
    helmetOption,
    lineLoginConfig,
    msgbotConfig,
    sessionOptions,
  },
  db,
  msgbot,
  mqttPublish,
});

app.listen(listenPort, () => logInfo('server.started', { listenPort }));
