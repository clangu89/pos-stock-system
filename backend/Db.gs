/**
 * Db.gs - Helper functions for Google Sheets Database operations
 */

const SHEETS = {
  USERS: 'Users',
  ROLES: 'Roles',
  SESSIONS: 'Sessions',
  BRANCHES: 'Branches',
  CATEGORIES: 'Categories',
  UNITS: 'Units',
  PRODUCTS: 'Products',
  STOCK_BALANCE: 'StockBalance',
  STOCK_MOVEMENTS: 'StockMovements',
  STOCK_DOCS: 'StockDocs',
  SALES: 'Sales',
  SALE_ITEMS: 'SaleItems',
  COUNTERS: 'Counters',
  CONFIG: 'Config',
  RECEIPT_TEXTS: 'ReceiptTexts',
  PRINT_PROFILES: 'PrintProfiles',
  AUDIT_LOG: 'AuditLog'
};

const DEFAULT_SPREADSHEET_ID = '1YEVUjb74z9BmGPalcmOS7mfX9TzvUGx0sXKFfzgiYJc';

function getSpreadsheet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) return ss;
  } catch (e) {}

  // Fallback for standalone script or Web App execution
  const props = PropertiesService.getScriptProperties();
  const dbId = props.getProperty('DB_ID') || DEFAULT_SPREADSHEET_ID;
  if (dbId) {
    return SpreadsheetApp.openById(dbId);
  }
  throw new Error('Spreadsheet not found. Please bind this script to a Google Sheet or set DB_ID script property.');
}

function getSheet(sheetName) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

function getTable(sheetName) {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  if (!data || data.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = data[0].map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    row._rowIndex = i + 1; // 1-based index in sheet
    rows.push(row);
  }
  return { headers, rows };
}

function findRows(sheetName, predicate) {
  const table = getTable(sheetName);
  return table.rows.filter(predicate);
}

function findRow(sheetName, predicate) {
  const table = getTable(sheetName);
  for (let i = 0; i < table.rows.length; i++) {
    if (predicate(table.rows[i])) {
      return table.rows[i];
    }
  }
  return null;
}

function appendRows(sheetName, rowObjs) {
  if (!rowObjs || rowObjs.length === 0) return;
  const sheet = getSheet(sheetName);
  const headerData = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  const headers = headerData.map(h => String(h).trim());

  const matrix = rowObjs.map(rowObj => {
    return headers.map(h => {
      const v = rowObj[h];
      return v === undefined || v === null ? '' : v;
    });
  });

  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, matrix.length, headers.length).setValues(matrix);
}

function appendRow(sheetName, rowObj) {
  appendRows(sheetName, [rowObj]);
}

function updateRows(sheetName, predicate, updaterFn) {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return 0;

  const headers = data[0].map(h => String(h).trim());
  let updatedCount = 0;

  for (let i = 1; i < data.length; i++) {
    const rowObj = {};
    for (let j = 0; j < headers.length; j++) {
      rowObj[headers[j]] = data[i][j];
    }
    rowObj._rowIndex = i + 1;

    if (predicate(rowObj)) {
      const updated = updaterFn(rowObj) || rowObj;
      for (let j = 0; j < headers.length; j++) {
        const v = updated[headers[j]];
        data[i][j] = v === undefined || v === null ? '' : v;
      }
      updatedCount++;
    }
  }

  if (updatedCount > 0) {
    sheet.getRange(1, 1, data.length, headers.length).setValues(data);
  }
  return updatedCount;
}

function deleteRows(sheetName, predicate) {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return 0;

  const headers = data[0].map(h => String(h).trim());
  let deletedCount = 0;

  // Delete from bottom up to maintain correct row index
  for (let i = data.length - 1; i >= 1; i--) {
    const rowObj = {};
    for (let j = 0; j < headers.length; j++) {
      rowObj[headers[j]] = data[i][j];
    }
    if (predicate(rowObj)) {
      sheet.deleteRow(i + 1);
      deletedCount++;
    }
  }
  return deletedCount;
}

/**
 * ปัดเศษเงินเป็น 2 ตำแหน่ง (กันเศษทศนิยมลอย เช่น 3 x 0.1 = 0.30000000000000004)
 */
function round2_(n) {
  const v = Number(n);
  if (!isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * ล็อกคอลัมน์ที่ระบุให้เป็น "ข้อความ" (Plain Text) ป้องกัน Google Sheets แปลงเป็นตัวเลข
 * จนเลข 0 นำหน้า (เลขผู้เสียภาษี / เบอร์โทร) หาย
 */
function setTextColumns_(sheetName, headerNames) {
  const sheet = getSheet(sheetName);
  const lastCol = Math.max(1, sheet.getLastColumn());
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const maxRows = typeof sheet.getMaxRows === 'function' ? sheet.getMaxRows() : Math.max(sheet.getLastRow(), 1000);
  headerNames.forEach(h => {
    const idx = headers.indexOf(h);
    if (idx >= 0) {
      sheet.getRange(1, idx + 1, maxRows, 1).setNumberFormat('@');
    }
  });
}

/**
 * เลขประจำตัวผู้เสียภาษี: ตัวเลขล้วนที่สั้นกว่า 13 หลัก (เลข 0 นำหน้าหาย) -> เติม 0 ให้ครบ 13 หลัก
 */
function normalizeThaiTaxId_(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  return /^\d+$/.test(s) && s.length < 13 ? s.padStart(13, '0') : s;
}

/**
 * เบอร์โทร: ตัวเลขล้วน 8-10 หลักที่ไม่ขึ้นต้นด้วย 0 (เลข 0 นำหน้าหาย) -> เติม 0 นำหน้า
 */
function normalizeThaiPhone_(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  return /^[1-9]\d{7,9}$/.test(s) ? '0' + s : s;
}

function getConfig(key, defaultValue = '') {
  const row = findRow(SHEETS.CONFIG, r => r.key === key);
  return row ? row.value : defaultValue;
}

function setConfig(key, value, desc = '') {
  const count = updateRows(SHEETS.CONFIG, r => r.key === key, r => {
    r.value = value;
    if (desc) r.description = desc;
    r.updatedAt = new Date().toISOString();
    return r;
  });
  if (count === 0) {
    appendRow(SHEETS.CONFIG, {
      key: key,
      value: value,
      description: desc,
      updatedAt: new Date().toISOString()
    });
  }
}

function logAudit(userId, action, target, detail = '') {
  try {
    appendRow(SHEETS.AUDIT_LOG, {
      ts: new Date().toISOString(),
      userId: userId || 'SYSTEM',
      action: action,
      target: target,
      detail: typeof detail === 'object' ? JSON.stringify(detail) : String(detail)
    });
  } catch (e) {
    console.error('Audit log failed:', e);
  }
}
