const assert = require('assert');
const {
  regenerateSession,
  regenerateSessionWithUser,
} = require('../lib/session-security');

const createReq = ({ error = null } = {}) => {
  const req = {
    session: {
      userId: undefined,
      regenerate: (cb) => {
        cb(error);
      },
    },
  };
  return req;
};

const run = async () => {
  {
    const req = createReq();
    await regenerateSession(req);
  }

  {
    const userId = 'test-user-id';
    const req = createReq();
    await regenerateSessionWithUser(req, userId);
    assert.strictEqual(req.session.userId, userId);
  }

  {
    const req = createReq({ error: new Error('regenerate failed') });
    await regenerateSession(req)
      .then(() => {
        throw new Error('Expected regenerateSession to reject');
      })
      .catch((error) => {
        assert.strictEqual(error.message, 'regenerate failed');
      });
  }

  {
    const userId = 'should-not-be-set';
    const req = createReq({ error: new Error('regenerate failed') });
    await regenerateSessionWithUser(req, userId)
      .then(() => {
        throw new Error('Expected regenerateSessionWithUser to reject');
      })
      .catch((error) => {
        assert.strictEqual(error.message, 'regenerate failed');
      });
    assert.strictEqual(req.session.userId, undefined);
  }

  console.log('session-security tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
