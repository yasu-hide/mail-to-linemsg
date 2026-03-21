const assert = require('assert');
const {
  isOwnedAddress,
} = require('../lib/address-ownership');

const run = async () => {
  {
    const target = {
      addr_id: 10,
      ext_addr_id: 'addr-1',
    };
    const registered = [
      {
        addr_id: 11,
        ext_addr_id: 'addr-2',
      },
      {
        addr_id: 10,
        ext_addr_id: 'addr-1',
      },
    ];

    assert.strictEqual(isOwnedAddress(target, registered), true);
  }

  {
    const target = {
      addr_id: 10,
      ext_addr_id: 'addr-1',
    };
    const registered = [
      {
        addr_id: 10,
        ext_addr_id: 'addr-2',
      },
      {
        addr_id: 11,
        ext_addr_id: 'addr-1',
      },
    ];

    assert.strictEqual(isOwnedAddress(target, registered), false);
  }

  {
    assert.strictEqual(isOwnedAddress(null, []), false);
    assert.strictEqual(isOwnedAddress({ addr_id: 1, ext_addr_id: 'a' }, null), false);
  }

  console.log('address-ownership tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
