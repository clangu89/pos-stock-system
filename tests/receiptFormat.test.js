const test = require('node:test');
const assert = require('node:assert');

function formatReceiptNumber(formatStr, tokens) {
  let result = formatStr;
  result = result.replace(/{PREFIX}/gi, tokens.prefix || '');
  result = result.replace(/{BRANCH}/gi, tokens.branch || '');
  result = result.replace(/{YYYY}/gi, tokens.yyyy || '');
  result = result.replace(/{YY}/gi, tokens.yy || '');
  result = result.replace(/{BE}/gi, tokens.be || '');
  result = result.replace(/{MM}/gi, tokens.mm || '');
  result = result.replace(/{DD}/gi, tokens.dd || '');

  result = result.replace(/{RUN(?::(\d+))?}/gi, (match, digits) => {
    const len = digits ? parseInt(digits, 10) : 5;
    let s = String(tokens.runVal);
    while (s.length < len) {
      s = '0' + s;
    }
    return s;
  });

  return result;
}

test('formatReceiptNumber with standard tokens', () => {
  const tokens = {
    prefix: 'RC',
    branch: 'B01',
    yyyy: '2026',
    yy: '26',
    be: '2569',
    mm: '10',
    dd: '28',
    runVal: 15
  };

  const pattern1 = '{PREFIX}{BRANCH}-{YYYY}{MM}{DD}-{RUN:5}';
  assert.strictEqual(formatReceiptNumber(pattern1, tokens), 'RCB01-20261028-00015');

  const pattern2 = '{PREFIX}/{BE}-{RUN:4}';
  assert.strictEqual(formatReceiptNumber(pattern2, tokens), 'RC/2569-0015');
});
