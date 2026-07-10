const assert = require('assert');
const {
  requireSessionSecret,
} = require('../lib/session-secret');

const run = async () => {
  {
    const env = {
      SESSION_SECRET: 'a-dedicated-random-secret',
    };

    assert.strictEqual(requireSessionSecret(env), 'a-dedicated-random-secret');
  }

  {
    assert.throws(() => requireSessionSecret({}));
  }

  {
    const env = {
      SESSION_SECRET: '',
    };

    assert.throws(() => requireSessionSecret(env));
  }

  {
    const env = {
      LINECORP_PLATFORM_LOGIN_CHANNEL_SECRET: 'line-login-channel-secret',
    };

    assert.throws(() => requireSessionSecret(env));
  }

  console.log('session-secret tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
