const assert = require('assert');
const request = require('supertest');
const { createErrorMiddleware } = require('../lib/errors');
const { createWebhookRoutes } = require('../routes/webhook-routes');
const { createTestLogger, createBaseApp } = require('./helpers/route-test-app');

// POST /msg-webhook 用の fresh app を作る。db/msgbot はケースごとにスタブを差し替え可能。
// mqttPublish / verifyInboundParseWebhookSignature / mailWebhookRateLimit / mqttPublishDeadlineMs は
// /mail-webhook 側の依存で /msg-webhook には無関係だが、createWebhookRoutes の生成には必要なため
// 最小のダミーを渡す（mail-webhook-delivery.test.js を参考）。
const createTestApp = ({
  events = [],
  db: dbOverrides = {},
  msgbot: msgbotOverrides = {},
  logger = createTestLogger(),
} = {}) => {
  const app = createBaseApp();
  const db = {
    addRecipient: async () => {},
    ...dbOverrides,
  };
  const msgbot = {
    getGroupSummary: async () => ({ groupName: 'dummy' }),
    ...msgbotOverrides,
  };
  app.use(createWebhookRoutes({
    db,
    msgbot,
    mqttPublish: null,
    lineWebhookMiddleware: (req, res, next) => {
      req.body = { events };
      next();
    },
    verifyInboundParseWebhookSignature: () => {},
    mailWebhookRateLimit: undefined,
    mqttPublishDeadlineMs: undefined,
    logger,
  }));
  app.use(createErrorMiddleware());

  return { app, db, msgbot, logger };
};

const run = async () => {
  // 1. join + group 成功: getGroupSummary / addRecipient が正しい引数で呼ばれる
  {
    let getGroupSummaryArgs = null;
    let addRecipientArgs = null;
    const { app } = createTestApp({
      events: [{ type: 'join', source: { type: 'group', groupId: 'G1' } }],
      msgbot: {
        getGroupSummary: async (...args) => {
          getGroupSummaryArgs = args;
          return { groupName: 'テストグループ' };
        },
      },
      db: {
        addRecipient: async (...args) => { addRecipientArgs = args; },
      },
    });
    const res = await request(app).post('/msg-webhook').send({});

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(getGroupSummaryArgs, ['G1']);
    assert.deepStrictEqual(addRecipientArgs, ['G1', 1, 'テストグループ']);
  }

  // 2. groupName が64文字以上の場合、addRecipient には先頭63文字に切詰められた値が渡る
  {
    const longGroupName = 'x'.repeat(70);
    let addRecipientArgs = null;
    const { app } = createTestApp({
      events: [{ type: 'join', source: { type: 'group', groupId: 'G1' } }],
      msgbot: {
        getGroupSummary: async () => ({ groupName: longGroupName }),
      },
      db: {
        addRecipient: async (...args) => { addRecipientArgs = args; },
      },
    });
    const res = await request(app).post('/msg-webhook').send({});

    assert.strictEqual(res.status, 200);
    assert.strictEqual(addRecipientArgs[2], longGroupName.substring(0, 63));
    assert.strictEqual(addRecipientArgs[2].length, 63);
  }

  // 3. join 以外のイベントでは getGroupSummary / addRecipient とも未呼び出し
  {
    let getGroupSummaryCalls = 0;
    let addRecipientCalls = 0;
    const { app } = createTestApp({
      events: [{ type: 'message', source: { type: 'user' } }],
      msgbot: {
        getGroupSummary: async () => { getGroupSummaryCalls += 1; return { groupName: 'x' }; },
      },
      db: {
        addRecipient: async () => { addRecipientCalls += 1; },
      },
    });
    const res = await request(app).post('/msg-webhook').send({});

    assert.strictEqual(res.status, 200);
    assert.strictEqual(getGroupSummaryCalls, 0);
    assert.strictEqual(addRecipientCalls, 0);
  }

  // 4. join だが source.type が group でない場合も未呼び出し（分岐網羅）
  {
    let getGroupSummaryCalls = 0;
    let addRecipientCalls = 0;
    const { app } = createTestApp({
      events: [{ type: 'join', source: { type: 'room' } }],
      msgbot: {
        getGroupSummary: async () => { getGroupSummaryCalls += 1; return { groupName: 'x' }; },
      },
      db: {
        addRecipient: async () => { addRecipientCalls += 1; },
      },
    });
    const res = await request(app).post('/msg-webhook').send({});

    assert.strictEqual(res.status, 200);
    assert.strictEqual(getGroupSummaryCalls, 0);
    assert.strictEqual(addRecipientCalls, 0);
  }

  // 5. events が空配列（event が undefined になる分岐）
  {
    const { app } = createTestApp({ events: [] });
    const res = await request(app).post('/msg-webhook').send({});

    assert.strictEqual(res.status, 200);
  }

  // 6. getGroupSummary が reject した場合、error middleware 経由で 500 の JSON エラーになる
  {
    const { app } = createTestApp({
      events: [{ type: 'join', source: { type: 'group', groupId: 'G1' } }],
      msgbot: {
        getGroupSummary: async () => { throw new Error('line api down'); },
      },
    });
    const res = await request(app).post('/msg-webhook').send({});

    assert.strictEqual(res.status, 500);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.strictEqual(res.body.error.code, 'INTERNAL_ERROR');
  }

  // 7. logger に createLogCorrelationId が無い場合でも join 処理が落ちず 200 を返す（createSafeLogId の undefined 分岐）
  {
    let addRecipientArgs = null;
    const barebonesLogger = {
      logInfo() {},
      logWarn() {},
      logError() {},
    };
    const { app } = createTestApp({
      events: [{ type: 'join', source: { type: 'group', groupId: 'G1' } }],
      logger: barebonesLogger,
      msgbot: {
        getGroupSummary: async () => ({ groupName: 'テストグループ' }),
      },
      db: {
        addRecipient: async (...args) => { addRecipientArgs = args; },
      },
    });
    const res = await request(app).post('/msg-webhook').send({});

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(addRecipientArgs, ['G1', 1, 'テストグループ']);
  }

  console.log('webhook-routes tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
