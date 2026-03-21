const assert = require('assert');

const {
  getPartTransferEncoding,
  decodeQuotedPrintableBuffer,
  decodeTransferEncodedBuffer,
} = require('../lib/transfer-encoding');

const run = () => {
  {
    const headers = { 'content-transfer-encoding': ['  QuOtEd-PrInTaBlE  '] };
    assert.strictEqual(getPartTransferEncoding(headers), 'quoted-printable');
  }

  {
    const headers = {};
    assert.strictEqual(getPartTransferEncoding(headers), '');
  }

  {
    const qp = Buffer.from('Hello=20World=21', 'ascii');
    const decoded = decodeQuotedPrintableBuffer(qp).toString('utf8');
    assert.strictEqual(decoded, 'Hello World!');
  }

  {
    const qpSoftBreak = Buffer.from('foo=\r\nbar', 'ascii');
    const decoded = decodeQuotedPrintableBuffer(qpSoftBreak).toString('utf8');
    assert.strictEqual(decoded, 'foobar');
  }

  {
    const qpJp = Buffer.from('=E6=97=A5=E6=9C=AC=E8=AA=9E', 'ascii');
    const decoded = decodeQuotedPrintableBuffer(qpJp).toString('utf8');
    assert.strictEqual(decoded, '日本語');
  }

  {
    const encoded = Buffer.from('44GT44KT44Gr44Gh44Gv', 'ascii');
    const decoded = decodeTransferEncodedBuffer(encoded, 'base64').toString('utf8');
    assert.strictEqual(decoded, 'こんにちは');
  }

  {
    const input = Buffer.from('=E6=97=A5=E6=9C=AC=E8=AA=9E', 'ascii');
    const decoded = decodeTransferEncodedBuffer(input, 'quoted-printable').toString('utf8');
    assert.strictEqual(decoded, '日本語');
  }

  {
    const input = Buffer.from('plain text', 'utf8');
    const decoded = decodeTransferEncodedBuffer(input, '7bit').toString('utf8');
    assert.strictEqual(decoded, 'plain text');
  }

  console.log('decode-transfer-encoding tests passed');
};

run();
