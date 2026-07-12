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
    // 「髙」(はしご高、U+9AD9)はJIS X0208にはなくCP932拡張のみに存在する。
    // charset="Shift_JIS"と宣言されつつ実体がCP932拡張文字を含むメールは
    // 実運用で頻出するため、そのケースでも正しく復号できることを確認する。
    const encoder = new Iconv('UTF-8', 'CP932//TRANSLIT//IGNORE');
    const sjis = encoder.convert(Buffer.from('髙橋様', 'utf8'));
    assert.strictEqual(convertUtf8(sjis, 'Shift_JIS'), '髙橋様');
    assert.strictEqual(convertUtf8(sjis, 'shift_jis'), '髙橋様');
  }

  {
    // 同様にISO-2022-JPも「髙」はISO-2022-JP-MS拡張のみに存在する。
    const encoder = new Iconv('UTF-8', 'ISO-2022-JP-MS//TRANSLIT//IGNORE');
    const jis = encoder.convert(Buffer.from('髙橋様', 'utf8'));
    assert.strictEqual(convertUtf8(jis, 'ISO-2022-JP'), '髙橋様');
  }

  {
    // エイリアステーブルに無い charset はそのまま渡り、正常に動作する。
    const encoder = new Iconv('UTF-8', 'ISO-8859-1//TRANSLIT//IGNORE');
    const latin1 = encoder.convert(Buffer.from('hello world', 'utf8'));
    assert.strictEqual(convertUtf8(latin1, 'ISO-8859-1'), 'hello world');
  }

  {
    // 「㈱」(U+3231)はJIS X0208にはなくEUC-JISX0213拡張のみに存在する。
    // charset="EUC-JP"と宣言されつつ実体がEUC-JISX0213拡張文字を含む
    // ケースでも正しく復号できることを確認する。
    const encoder = new Iconv('UTF-8', 'EUC-JISX0213//TRANSLIT//IGNORE');
    const eucjp = encoder.convert(Buffer.from('㈱山田商店', 'utf8'));
    assert.strictEqual(convertUtf8(eucjp, 'EUC-JP'), '㈱山田商店');
  }

  {
    // 「龍」は標準JIS X0208範囲の通常の漢字であり、EUC-JPエイリアス化の
    // 前後で挙動が変わらないことを確認する回帰テスト。
    const encoder = new Iconv('UTF-8', 'EUC-JP//TRANSLIT//IGNORE');
    const eucjp = encoder.convert(Buffer.from('龍', 'utf8'));
    assert.strictEqual(convertUtf8(eucjp, 'EUC-JP'), '龍');
  }

  {
    // 既に拡張対応版を正しく宣言している場合も壊れない(二重変換にならない)。
    const cp932Encoder = new Iconv('UTF-8', 'CP932//TRANSLIT//IGNORE');
    const cp932 = cp932Encoder.convert(Buffer.from('髙橋様', 'utf8'));
    assert.strictEqual(convertUtf8(cp932, 'CP932'), '髙橋様');
    assert.strictEqual(convertUtf8(cp932, 'Windows-31J'), '髙橋様');

    const jisMsEncoder = new Iconv('UTF-8', 'ISO-2022-JP-MS//TRANSLIT//IGNORE');
    const jisMs = jisMsEncoder.convert(Buffer.from('髙橋様', 'utf8'));
    assert.strictEqual(convertUtf8(jisMs, 'ISO-2022-JP-MS'), '髙橋様');

    const jisx0213Encoder = new Iconv('UTF-8', 'EUC-JISX0213//TRANSLIT//IGNORE');
    const jisx0213 = jisx0213Encoder.convert(Buffer.from('㈱山田商店', 'utf8'));
    assert.strictEqual(convertUtf8(jisx0213, 'EUC-JISX0213'), '㈱山田商店');
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
