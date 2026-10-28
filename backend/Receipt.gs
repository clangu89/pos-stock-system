/**
 * Receipt.gs - Receipt Running Number Generator and Format Parsing
 */

function generateReceiptNo(branchCode = 'MAIN', dateObj = new Date()) {
  const prefix = getConfig('RECEIPT_PREFIX', 'RC');
  const format = getConfig('RECEIPT_FORMAT', '{PREFIX}{BRANCH}-{YYYY}{MM}{DD}-{RUN:5}');
  const resetCycle = getConfig('RECEIPT_RESET_CYCLE', 'DAILY').toUpperCase();

  const d = dateObj instanceof Date ? dateObj : new Date();
  const yyyy = String(d.getFullYear());
  const yy = yyyy.substring(2);
  const be = String(d.getFullYear() + 543);
  const mm = ('0' + (d.getMonth() + 1)).slice(-2);
  const dd = ('0' + d.getDate()).slice(-2);

  let counterPeriodKey = '';
  if (resetCycle === 'DAILY') {
    counterPeriodKey = `${yyyy}${mm}${dd}`;
  } else if (resetCycle === 'MONTHLY') {
    counterPeriodKey = `${yyyy}${mm}`;
  } else if (resetCycle === 'YEARLY') {
    counterPeriodKey = `${yyyy}`;
  } else {
    counterPeriodKey = 'GLOBAL';
  }

  const counterKey = `RC_${branchCode}_${counterPeriodKey}`;

  // Read and increment counter atomically
  let nextVal = 1;
  const existingCounter = findRow(SHEETS.COUNTERS, r => r.key === counterKey);
  if (existingCounter) {
    nextVal = (parseInt(existingCounter.value, 10) || 0) + 1;
    updateRows(SHEETS.COUNTERS, r => r.key === counterKey, r => {
      r.value = nextVal;
      r.updatedAt = new Date().toISOString();
      return r;
    });
  } else {
    appendRow(SHEETS.COUNTERS, {
      key: counterKey,
      value: nextVal,
      updatedAt: new Date().toISOString()
    });
  }

  return formatReceiptNumber(format, {
    prefix: prefix,
    branch: branchCode,
    yyyy: yyyy,
    yy: yy,
    be: be,
    mm: mm,
    dd: dd,
    runVal: nextVal
  });
}

function formatReceiptNumber(formatStr, tokens) {
  let result = formatStr;
  result = result.replace(/{PREFIX}/gi, tokens.prefix || '');
  result = result.replace(/{BRANCH}/gi, tokens.branch || '');
  result = result.replace(/{YYYY}/gi, tokens.yyyy || '');
  result = result.replace(/{YY}/gi, tokens.yy || '');
  result = result.replace(/{BE}/gi, tokens.be || '');
  result = result.replace(/{MM}/gi, tokens.mm || '');
  result = result.replace(/{DD}/gi, tokens.dd || '');

  // Match {RUN:n} or {RUN}
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

function previewReceiptFormat(formatStr, prefix, branchCode, runVal = 1) {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const yy = yyyy.substring(2);
  const be = String(d.getFullYear() + 543);
  const mm = ('0' + (d.getMonth() + 1)).slice(-2);
  const dd = ('0' + d.getDate()).slice(-2);

  return formatReceiptNumber(formatStr, {
    prefix: prefix || 'RC',
    branch: branchCode || 'MAIN',
    yyyy: yyyy,
    yy: yy,
    be: be,
    mm: mm,
    dd: dd,
    runVal: runVal
  });
}
