const assert = require('assert');
const { Iconv } = require('iconv');
const {
  isUtf8Charset,
  decodeUtf8Buffer,
  convertUtf8,
  truncateLineTextMessage,
} = require('../lib/mail-text');

const run = () => {
  {
    assert.strictEqual(isUtf8Charset('utf-8'), true);
    assert.strictEqual(isUtf8Charset('UTF8'), true);
    assert.strictEqual(isUtf8Charset('us-ascii'), true);
    assert.strictEqual(isUtf8Charset('windows-31j'), false);
  }

  {
    const input = Buffer.from('hello', 'utf8');
    assert.strictEqual(decodeUtf8Buffer(input), 'hello');
    assert.strictEqual(convertUtf8(input, 'utf-8'), 'hello');
  }

  {
    const encoder = new Iconv('UTF-8', 'SHIFT_JIS//TRANSLIT//IGNORE');
    const sjis = encoder.convert(Buffer.from('日本語テスト', 'utf8'));
    const converted = convertUtf8(sjis, 'SHIFT_JIS');
    assert.strictEqual(converted, '日本語テスト');
  }

  {
    const short = 'abc';
    assert.strictEqual(truncateLineTextMessage(short, { maxChars: 5, marker: '...' }), 'abc');
  }

  {
    const text = 'abcdef';
    const truncated = truncateLineTextMessage(text, { maxChars: 5, marker: '..' });
    assert.strictEqual(truncated, 'abc..');
  }

  {
    const text = 'A😀BC😀D';
    const truncated = truncateLineTextMessage(text, { maxChars: 5, marker: '..' });
    assert.strictEqual(truncated, 'A😀B..');
  }

  console.log('mail-text tests passed');
};

run();
