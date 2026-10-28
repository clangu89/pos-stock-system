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
  PRINT_PROFILES: 'PrintProfiles',
  AUDIT_LOG: 'AuditLog'
};

function getSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  // Fallback for standalone script bound to ScriptProperties DB_ID
  const props = PropertiesService.getScriptProperties();
  const dbId = props.getProperty('DB_ID');
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
