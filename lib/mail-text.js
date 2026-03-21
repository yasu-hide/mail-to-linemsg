const { Iconv } = require('iconv');

const isUtf8Charset = (charset) => !charset || /^(utf-?8|us-ascii|ascii)$/i.test(charset);
const decodeUtf8Buffer = (valueBuffer) => valueBuffer.toString('utf8');

const convertUtf8 = (valueBuffer, charset) => {
  if (isUtf8Charset(charset)) {
    return decodeUtf8Buffer(valueBuffer);
  }

  const cnv = new Iconv(charset, 'UTF-8//TRANSLIT//IGNORE');
  return cnv.convert(valueBuffer).toString('utf8');
};

const truncateLineTextMessage = (message, options = {}) => {
  const maxChars = options.maxChars || 5000;
  const marker = options.marker || '\r\n（省略）';
  const messageChars = Array.from(message);
  if (messageChars.length <= maxChars) {
    return message;
  }

  const markerChars = Array.from(marker);
  const truncatedLength = Math.max(maxChars - markerChars.length, 0);
  return `${messageChars.slice(0, truncatedLength).join('')}${marker}`;
};

module.exports = {
  isUtf8Charset,
  decodeUtf8Buffer,
  convertUtf8,
  truncateLineTextMessage,
};
