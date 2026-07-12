const { Iconv } = require('iconv');

const isUtf8Charset = (charset) => !charset || /^(utf-?8|us-ascii|ascii)$/i.test(charset);
const decodeUtf8Buffer = (valueBuffer) => valueBuffer.toString('utf8');

// 既知の「宣言と実体が食い違う」charset別名。
// 実体はWindows拡張(CP932 / ISO-2022-JP-MS)だが、メールがJIS標準の名前で
// 宣言してくることが多いため、標準名を拡張対応版へ読み替える。
// (標準規格の内容は拡張版でも完全に後方互換で復号できることを確認済み)
// 注意: EUC-JPにはCP932系(EUC-JP-MS)とは別系統のJIS X0213拡張(EUC-JISX0213)
// があり、この実行環境ではEUC-JP-MSが利用不可なためEUC-JISX0213のみ対応する。
// そのため「髙」(はしご高、CP932/ISO-2022-JP-MS側の拡張文字)はEUC-JP経路では
// 依然として消失する既知の限界(EUC-JISX0213には含まれない文字のため)。
const CHARSET_ALIASES = {
  'shift_jis': 'CP932',
  'sjis': 'CP932',
  'shift-jis': 'CP932',
  'ms_kanji': 'CP932',
  'iso-2022-jp': 'ISO-2022-JP-MS',
  'csiso2022jp': 'ISO-2022-JP-MS',
  'euc-jp': 'EUC-JISX0213',
};

const normalizeCharset = (charset) => CHARSET_ALIASES[charset.toLowerCase()] || charset;

const convertUtf8 = (valueBuffer, charset) => {
  if (isUtf8Charset(charset)) {
    return decodeUtf8Buffer(valueBuffer);
  }

  const cnv = new Iconv(normalizeCharset(charset), 'UTF-8//TRANSLIT//IGNORE');
  return cnv.convert(valueBuffer).toString('utf8');
};

// 切り詰めフロー:
//
//   message (コードポイント配列 messageChars, 長さ = charsBefore)
//     │
//     ├─ charsBefore <= maxChars ─────────────────► { text: message, truncated: false, ... }
//     │
//     └─ charsBefore > maxChars
//           │
//           ▼
//     書記素クラスタを先頭から走査、truncatedLength(コードポイント基準)を
//     超える直前の完全な書記素境界で停止 ─► safeLength
//           │
//           ▼
//     messageChars.slice(0, safeLength) + marker ─► { text, truncated: true, ... }
//
// safeLength は必ず「完全な書記素クラスタの境界」であり、IVS/ZWJ絵文字
// シーケンスの途中では止まらない。
const truncateLineTextMessage = (message, options = {}) => {
  const maxChars = options.maxChars || 5000;
  const marker = options.marker ?? '\r\n（省略）';
  const messageChars = Array.from(message);
  const charsBefore = messageChars.length;
  if (charsBefore <= maxChars) {
    return {
      text: message,
      truncated: false,
      charsBefore,
      charsAfter: charsBefore,
    };
  }

  const markerChars = Array.from(marker);
  const truncatedLength = Math.max(maxChars - markerChars.length, 0);

  // コードポイント単位でtruncatedLength件に切るが、書記素クラスタ(IVS・ZWJ絵文字
  // シーケンス等)の途中で切らないよう、直前の安全な境界まで戻す。maxChars自体は
  // LINE APIの文字数上限(コードポイント基準)を守るため、書記素数には切り替えない。
  let codePointCount = 0;
  let safeLength = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(message)) {
    const segmentCodePointLength = Array.from(segment).length;
    if (codePointCount + segmentCodePointLength > truncatedLength) {
      break;
    }
    codePointCount += segmentCodePointLength;
    safeLength = codePointCount;
  }

  const text = `${messageChars.slice(0, safeLength).join('')}${marker}`;
  return {
    text,
    truncated: true,
    charsBefore,
    charsAfter: Array.from(text).length,
  };
};

module.exports = {
  isUtf8Charset,
  decodeUtf8Buffer,
  convertUtf8,
  truncateLineTextMessage,
};
