const assert = require('assert');
const { Iconv } = require('iconv');
const { decodeTransferEncodedBuffer } = require('../lib/transfer-encoding');
const { convertUtf8 } = require('../lib/mail-text');

const encodeQuotedPrintable = (buf) => Array.from(buf)
  .map((byte) => `=${byte.toString(16).toUpperCase().padStart(2, '0')}`)
  .join('');

const decodeByPipeline = ({ rawBody, transferEncoding, charset }) => {
  const encodedBuffer = Buffer.from(rawBody, 'ascii');
  const decodedBuffer = decodeTransferEncodedBuffer(encodedBuffer, transferEncoding);
  return convertUtf8(decodedBuffer, charset);
};

const run = () => {
  {
    const source = '日本語テスト123';
    const encoder = new Iconv('UTF-8', 'SHIFT_JIS//TRANSLIT//IGNORE');
    const sjisBuffer = encoder.convert(Buffer.from(source, 'utf8'));
    const qpBody = encodeQuotedPrintable(sjisBuffer);
    const result = decodeByPipeline({
      rawBody: qpBody,
      transferEncoding: 'quoted-printable',
      charset: 'windows-31j',
    });
    assert.strictEqual(result, source);
  }

  {
    const source = 'こんにちは世界';
    const encoder = new Iconv('UTF-8', 'ISO-2022-JP//TRANSLIT//IGNORE');
    const isoBuffer = encoder.convert(Buffer.from(source, 'utf8'));
    const base64Body = isoBuffer.toString('base64').replace(/(.{16})/g, '$1\r\n');
    const result = decodeByPipeline({
      rawBody: base64Body,
      transferEncoding: 'base64',
      charset: 'iso-2022-jp',
    });
    assert.strictEqual(result, source);
  }

  console.log('e2e mail samples tests passed');
};

run();
