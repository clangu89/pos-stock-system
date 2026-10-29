function incrementCounter_(counterKey) {
  const sheet = getSheet(SHEETS.COUNTERS);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    appendRow(SHEETS.COUNTERS, {
      key: counterKey,
      value: 1,
      updatedAt: new Date().toISOString()
    });
    return 1;
  }

  const headers = data[0].map(h => String(h).trim());
  const keyCol = headers.indexOf('key');
  const valCol = headers.indexOf('value');
  const updatedCol = headers.indexOf('updatedAt');

  const now = new Date().toISOString();
  let foundRowIdx = -1;
  let nextVal = 1;

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][keyCol]) === counterKey) {
      foundRowIdx = r + 1; // 1-based row in sheet
      nextVal = (parseInt(data[r][valCol], 10) || 0) + 1;
      break;
    }
  }

  if (foundRowIdx > 0) {
    if (valCol >= 0) sheet.getRange(foundRowIdx, valCol + 1, 1, 1).setValues([[nextVal]]);
    if (updatedCol >= 0) sheet.getRange(foundRowIdx, updatedCol + 1, 1, 1).setValues([[now]]);
  } else {
    appendRow(SHEETS.COUNTERS, {
      key: counterKey,
      value: nextVal,
      updatedAt: now
    });
  }
  return nextVal;
}

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

  // Read and increment counter atomically (1 single read + targeted cell write)
  const nextVal = incrementCounter_(counterKey);

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

/**
 * Receipt Text Customization & Store Information Resolver
 */

let _receiptTextsEnsured = false;
function ensureReceiptTextsSheet_() {
  if (_receiptTextsEnsured) return getSheet(SHEETS.RECEIPT_TEXTS);
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.RECEIPT_TEXTS);
  const headers = [
    'scopeId', 'branchId', 'receiptTitle', 'storeName', 'subHeader',
    'address', 'phone', 'taxId', 'footer',
    'showAddress', 'showPhone', 'showTaxId', 'showCashier', 'showBranch',
    'updatedBy', 'updatedAt'
  ];
  if (!sheet) {
    sheet = ss.insertSheet(SHEETS.RECEIPT_TEXTS);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#2C3E50').setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  }
  _receiptTextsEnsured = true;
  return sheet;
}

function getReceiptStoreInfo(branchId = '') {
  ensureReceiptTextsSheet_();

  // ดึง ReceiptTexts ตารางเดียวในหน่วยความจำ ไม่ต้อง findRow ซ้ำ 2 รอบ
  const receiptTextsRows = getTable(SHEETS.RECEIPT_TEXTS).rows;
  let defaultRow = receiptTextsRows.find(r => r.scopeId === 'DEFAULT' || r.branchId === '*');
  // ถ้ามีแถวค่ากลางจริง ช่องที่ผู้ใช้ "เว้นว่างโดยตั้งใจ" ต้องถูกเคารพ (ไม่ถูกแทนด้วยค่าเริ่มต้น)
  const hasDefaultRow = !!defaultRow;
  if (!defaultRow) {
    defaultRow = {
      scopeId: 'DEFAULT',
      branchId: '*',
      receiptTitle: 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ',
      storeName: getConfig('STORE_NAME', 'ระบบขายสินค้าและสต๊อก POS Store'),
      subHeader: 'ยินดีต้อนรับ / Welcome',
      address: getConfig('STORE_ADDRESS', ''),
      phone: getConfig('STORE_PHONE', ''),
      taxId: getConfig('STORE_TAX_ID', ''),
      footer: getConfig('RECEIPT_FOOTER', 'ขอบคุณที่ใช้บริการ / Thank you!\nสินค้าซื้อแล้วไม่รับเปลี่ยนคืน'),
      showAddress: 'true',
      showPhone: 'true',
      showTaxId: 'true',
      showCashier: 'true',
      showBranch: 'true'
    };
  }

  let branchRow = null;
  if (branchId && branchId !== '*') {
    branchRow = receiptTextsRows.find(r => (r.branchId === branchId || r.scopeId === `BRANCH_${branchId}`) && r.scopeId !== 'DEFAULT');
  }

  let branchMeta = null;
  if (branchId && branchId !== '*') {
    branchMeta = findRow(SHEETS.BRANCHES, r => r.branchId === branchId);
  }

  // allowBlank = true: ค่ากลางที่ว่างหมายถึง "ไม่แสดงบรรทัดนี้" (ไม่ fallback)
  // แถวเฉพาะสาขาที่ว่างหมายถึง "ใช้ค่ากลาง" เสมอ
  function pick(field, fallback = '', allowBlank = false) {
    if (branchRow && branchRow[field] !== undefined && String(branchRow[field]).trim() !== '') {
      return String(branchRow[field]);
    }
    if (defaultRow && defaultRow[field] !== undefined) {
      if (String(defaultRow[field]).trim() !== '') {
        return String(defaultRow[field]);
      }
      if (allowBlank && hasDefaultRow) {
        return '';
      }
    }
    return fallback;
  }

  function pickBool(field, defaultVal = true) {
    if (branchRow && branchRow[field] !== undefined && String(branchRow[field]).trim() !== '') {
      const v = String(branchRow[field]).toLowerCase();
      return v === 'true' || v === '1';
    }
    if (defaultRow && defaultRow[field] !== undefined && String(defaultRow[field]).trim() !== '') {
      const v = String(defaultRow[field]).toLowerCase();
      return v === 'true' || v === '1';
    }
    return defaultVal;
  }

  const storeName = pick('storeName', '') || String(getConfig('STORE_NAME', '') || '') || 'POS Store';
  const receiptTitle = pick('receiptTitle', 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ', true);
  const subHeader = pick('subHeader', '', true);

  const fallbackAddress = (branchMeta && branchMeta.address) ? branchMeta.address : getConfig('STORE_ADDRESS', '');
  const address = pick('address', fallbackAddress);

  const fallbackPhone = (branchMeta && branchMeta.phone) ? branchMeta.phone : getConfig('STORE_PHONE', '');
  const phone = normalizeThaiPhone_(pick('phone', fallbackPhone));

  const fallbackTaxId = (branchMeta && branchMeta.taxId) ? branchMeta.taxId : getConfig('STORE_TAX_ID', '');
  const taxId = normalizeThaiTaxId_(pick('taxId', fallbackTaxId));

  const footer = pick('footer', getConfig('RECEIPT_FOOTER', 'ขอบคุณที่ใช้บริการ / Thank you!\nสินค้าซื้อแล้วไม่รับเปลี่ยนคืน'), true);

  return {
    receiptTitle: receiptTitle,
    storeName: storeName,
    name: storeName, // For backward compatibility
    branchId: branchMeta ? String(branchMeta.branchId) : String(branchId || ''),
    branchCode: branchMeta ? String(branchMeta.code || '') : '',
    branchName: branchMeta ? String(branchMeta.name || '') : '',
    subHeader: subHeader,
    address: address,
    phone: phone,
    taxId: taxId,
    footer: footer,
    showAddress: pickBool('showAddress', true),
    showPhone: pickBool('showPhone', true),
    showTaxId: pickBool('showTaxId', true),
    showCashier: pickBool('showCashier', true),
    showBranch: pickBool('showBranch', true)
  };
}

function getReceiptTextsList() {
  ensureReceiptTextsSheet_();
  // ซ่อมค่าเลขผู้เสียภาษี/เบอร์โทรที่ Sheets แปลงเป็นตัวเลข (เลข 0 นำหน้าหาย) ก่อนส่งให้หน้า Admin
  const rows = getTable(SHEETS.RECEIPT_TEXTS).rows.map(r => {
    r.taxId = normalizeThaiTaxId_(r.taxId);
    r.phone = normalizeThaiPhone_(r.phone);
    return r;
  });
  const branches = getBranchesList();
  return {
    items: rows,
    branches: branches
  };
}

function saveReceiptTexts(data, sessionUser) {
  ensureReceiptTextsSheet_();
  // ล็อกคอลัมน์เบอร์โทร/เลขผู้เสียภาษีเป็นข้อความ ก่อนเขียนค่า (กันเลข 0 นำหน้าหาย)
  setTextColumns_(SHEETS.RECEIPT_TEXTS, ['phone', 'taxId']);

  const isDefault = data.scopeId === 'DEFAULT' || data.branchId === '*';
  const branchId = isDefault ? '*' : String(data.branchId || '').trim();
  const scopeId = isDefault ? 'DEFAULT' : `BRANCH_${branchId}`;

  if (!isDefault && !branchId) {
    throw new Error('กรุณาระบุสาขาสำหรับการตั้งค่าเฉพาะสาขา');
  }

  const record = {
    scopeId: scopeId,
    branchId: branchId,
    receiptTitle: data.receiptTitle !== undefined ? String(data.receiptTitle).trim() : 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ',
    storeName: data.storeName !== undefined ? String(data.storeName).trim() : '',
    subHeader: data.subHeader !== undefined ? String(data.subHeader).trim() : '',
    address: data.address !== undefined ? String(data.address).trim() : '',
    phone: data.phone !== undefined ? String(data.phone).trim() : '',
    taxId: data.taxId !== undefined ? String(data.taxId).trim() : '',
    footer: data.footer !== undefined ? String(data.footer).trim() : '',
    showAddress: String(data.showAddress !== false && String(data.showAddress) !== 'false'),
    showPhone: String(data.showPhone !== false && String(data.showPhone) !== 'false'),
    showTaxId: String(data.showTaxId !== false && String(data.showTaxId) !== 'false'),
    showCashier: String(data.showCashier !== false && String(data.showCashier) !== 'false'),
    showBranch: String(data.showBranch !== false && String(data.showBranch) !== 'false'),
    updatedBy: sessionUser.userId || 'ADMIN',
    updatedAt: new Date().toISOString()
  };

  // แถวเฉพาะสาขา: เก็บเฉพาะช่องที่ "ต่างจากค่ากลาง" ช่องที่เหมือนกันเก็บเป็นว่าง (= สืบทอดค่ากลาง)
  // เพื่อให้เมื่อแก้ค่ากลางภายหลัง สาขาจะเปลี่ยนตามอัตโนมัติ
  if (!isDefault) {
    const defRow = findRow(SHEETS.RECEIPT_TEXTS, r => r.scopeId === 'DEFAULT' || r.branchId === '*');
    if (defRow) {
      const sameAsDefault = (field) => {
        const a = String(record[field] === undefined || record[field] === null ? '' : record[field]).trim();
        let b = String(defRow[field] === undefined || defRow[field] === null ? '' : defRow[field]).trim();
        if (field === 'taxId') b = normalizeThaiTaxId_(b);
        if (field === 'phone') b = normalizeThaiPhone_(b);
        return a === b;
      };
      ['receiptTitle', 'storeName', 'subHeader', 'address', 'phone', 'taxId', 'footer'].forEach(f => {
        if (sameAsDefault(f)) record[f] = '';
      });
    }
  }

  const existing = findRow(SHEETS.RECEIPT_TEXTS, r => r.scopeId === scopeId);
  if (existing) {
    updateRows(SHEETS.RECEIPT_TEXTS, r => r.scopeId === scopeId, r => {
      Object.assign(r, record);
      return r;
    });
    logAudit(sessionUser.userId, 'UPDATE_RECEIPT_TEXTS', 'ReceiptTexts', { scopeId, branchId });
  } else {
    appendRow(SHEETS.RECEIPT_TEXTS, record);
    logAudit(sessionUser.userId, 'CREATE_RECEIPT_TEXTS', 'ReceiptTexts', { scopeId, branchId });
  }

  // If saving DEFAULT template, keep legacy Config in sync (รวมถึงกรณีลบข้อความให้ว่างโดยตั้งใจ)
  if (isDefault) {
    if (data.storeName !== undefined) setConfig('STORE_NAME', record.storeName);
    if (data.address !== undefined) setConfig('STORE_ADDRESS', record.address);
    if (data.phone !== undefined) setConfig('STORE_PHONE', record.phone);
    if (data.taxId !== undefined) setConfig('STORE_TAX_ID', record.taxId);
    if (data.footer !== undefined) setConfig('RECEIPT_FOOTER', record.footer);
  }

  return {
    ok: true,
    message: isDefault ? 'บันทึกข้อความใบเสร็จค่ากลางสำเร็จ' : `บันทึกข้อความใบเสร็จสาขา ${branchId} สำเร็จ`,
    data: record
  };
}

function deleteBranchReceiptTexts(branchId, sessionUser) {
  ensureReceiptTextsSheet_();
  if (!branchId || branchId === '*') {
    throw new Error('ไม่สามารถลบข้อความใบเสร็จที่เป็นค่ากลางได้');
  }

  const scopeId = `BRANCH_${branchId}`;
  const deleted = deleteRows(SHEETS.RECEIPT_TEXTS, r => r.scopeId === scopeId || (r.branchId === branchId && r.scopeId !== 'DEFAULT'));

  logAudit(sessionUser.userId, 'DELETE_RECEIPT_TEXTS_OVERRIDE', 'ReceiptTexts', { branchId, deleted });

  return {
    ok: true,
    message: `ลบการตั้งค่าเฉพาะสาขา ${branchId} เรียบร้อยแล้ว (กลับไปใช้ค่ากลาง)`
  };
}
