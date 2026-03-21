const getFirstHeaderValue = (headerValue) => {
  if (!Array.isArray(headerValue) || headerValue.length <= 0) {
    return null;
  }

  return headerValue[0];
};

const getPartTransferEncoding = (partHeaders) => {
  const transferEncoding = getFirstHeaderValue(partHeaders && partHeaders['content-transfer-encoding']);
  return transferEncoding ? transferEncoding.trim().toLowerCase() : '';
};

const decodeQuotedPrintableBuffer = (valueBuffer) => {
  const qpText = valueBuffer.toString('latin1');
  const softBreakRemoved = qpText.replace(/=\r?\n/g, '');
  const binaryText = softBreakRemoved.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => (
    String.fromCharCode(parseInt(hex, 16))
  ));
  return Buffer.from(binaryText, 'latin1');
};

const decodeTransferEncodedBuffer = (valueBuffer, transferEncoding) => {
  if (!transferEncoding) {
    return valueBuffer;
  }

  if (transferEncoding === 'base64') {
    const compacted = valueBuffer.toString('ascii').replace(/[\r\n\s]/g, '');
    return Buffer.from(compacted, 'base64');
  }
  if (transferEncoding === 'quoted-printable') {
    return decodeQuotedPrintableBuffer(valueBuffer);
  }

  return valueBuffer;
};

module.exports = {
  getPartTransferEncoding,
  decodeQuotedPrintableBuffer,
  decodeTransferEncodedBuffer,
};
