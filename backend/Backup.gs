/**
 * Backup.gs - Database Backup, Export, Integrity Checksum, and Safe Restore
 */

const BACKUP_TEXT_COLUMNS = {
  [SHEETS.USERS]: ['userId', 'username', 'passHash', 'salt', 'roleId', 'branchIds'],
  [SHEETS.BRANCHES]: ['branchId', 'code', 'phone', 'taxId'],
  [SHEETS.PRODUCTS]: ['sku', 'barcode', 'categoryId'],
  [SHEETS.STOCK_BALANCE]: ['branchId', 'sku'],
  [SHEETS.STOCK_MOVEMENTS]: ['movId', 'branchId', 'sku', 'refDoc'],
  [SHEETS.STOCK_DOCS]: ['docNo', 'branchId', 'toBranchId'],
  [SHEETS.SALES]: ['receiptNo', 'branchId', 'stationId', 'clientTxnId'],
  [SHEETS.SALE_ITEMS]: ['receiptNo', 'sku', 'barcode'],
  [SHEETS.COUNTERS]: ['key'],
  [SHEETS.CONFIG]: ['key', 'value'],
  [SHEETS.RECEIPT_TEXTS]: ['scopeId', 'branchId', 'phone', 'taxId'],
  [SHEETS.PRINT_PROFILES]: ['profileId', 'branchId', 'stationId'],
  [SHEETS.AUDIT_LOG]: ['userId']
};

function computeBackupChecksum_(tablesPayload) {
  const keys = Object.keys(tablesPayload || {}).sort();
  const summary = keys.map(k => {
    const t = tablesPayload[k];
    const rLen = (t && t.rows) ? t.rows.length : 0;
    const hJoin = (t && t.headers) ? t.headers.join(',') : '';
    const rData = (t && t.rows) ? JSON.stringify(t.rows) : '';
    return `${k}:${hJoin}:${rLen}:${rData}`;
  }).join('|');

  const rawBytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    summary,
    Utilities.Charset.UTF_8
  );
  let hex = '';
  for (let i = 0; i < rawBytes.length; i++) {
    let b = rawBytes[i];
    if (b < 0) b += 256;
    let h = b.toString(16);
    if (h.length === 1) h = '0' + h;
    hex += h;
  }
  return 'sha256:' + hex;
}

function getBackupStatus() {
  const ss = getSpreadsheet();
  const sheetNames = Object.values(SHEETS);
  const tableStats = {};
  let totalRows = 0;

  sheetNames.forEach(name => {
    const s = ss.getSheetByName(name);
    if (s) {
      const lastRow = Math.max(0, s.getLastRow() - 1);
      tableStats[name] = lastRow;
      totalRows += lastRow;
    } else {
      tableStats[name] = 0;
    }
  });

  const allConfigs = getAllConfigs();
  const auditLogs = getTable(SHEETS.AUDIT_LOG).rows;
  const backupHistory = auditLogs
    .filter(r => r.action === 'BACKUP_DATABASE' || r.action === 'RESTORE_DATABASE')
    .reverse()
    .slice(0, 20)
    .map(r => ({
      ts: r.ts,
      userId: r.userId,
      action: r.action,
      detail: r.detail
    }));

  return {
    ok: true,
    spreadsheetId: ss.getId ? ss.getId() : DEFAULT_SPREADSHEET_ID,
    spreadsheetName: ss.getName ? ss.getName() : 'POS & Stock Database',
    tableCount: sheetNames.length,
    totalRows: totalRows,
    tableStats: tableStats,
    lastBackupAt: allConfigs['LAST_BACKUP_AT'] || '',
    lastBackupBy: allConfigs['LAST_BACKUP_BY'] || '',
    lastRestoreAt: allConfigs['LAST_RESTORE_AT'] || '',
    lastRestoreBy: allConfigs['LAST_RESTORE_BY'] || '',
    history: backupHistory
  };
}

function exportDatabaseBackup(options = {}, sessionUser = {}) {
  const requestedTables = Array.isArray(options.tables) && options.tables.length > 0
    ? options.tables
    : Object.values(SHEETS).filter(s => s !== SHEETS.SESSIONS);

  const ss = getSpreadsheet();
  const tables = {};
  let totalExportedRows = 0;

  requestedTables.forEach(sheetName => {
    if (!Object.values(SHEETS).includes(sheetName)) return;
    const s = ss.getSheetByName(sheetName);
    if (!s) return;

    const data = s.getDataRange().getValues();
    if (!data || data.length === 0) {
      tables[sheetName] = { headers: (typeof DB_SCHEMAS !== 'undefined' && DB_SCHEMAS[sheetName]) ? DB_SCHEMAS[sheetName] : [], rows: [] };
      return;
    }

    const headers = data[0].map(h => String(h).trim());
    const rows = [];
    for (let r = 1; r < data.length; r++) {
      const rowVals = data[r].map(cell => {
        if (cell instanceof Date) {
          return cell.toISOString();
        }
        if (cell === null || cell === undefined) {
          return '';
        }
        return cell;
      });
      rows.push(rowVals);
    }
    tables[sheetName] = { headers, rows };
    totalExportedRows += rows.length;
  });

  const now = new Date().toISOString();
  const checksum = computeBackupChecksum_(tables);
  const note = String(options.note || '').trim();

  const backupPayload = {
    format: 'POS_STOCK_BACKUP',
    version: '1.0',
    exportedAt: now,
    exportedBy: sessionUser.name || sessionUser.username || 'ADMIN',
    exportedUserId: sessionUser.userId || 'SYSTEM',
    spreadsheetId: ss.getId ? ss.getId() : DEFAULT_SPREADSHEET_ID,
    note: note,
    tableCount: Object.keys(tables).length,
    totalRows: totalExportedRows,
    checksum: checksum,
    tables: tables
  };

  setConfig('LAST_BACKUP_AT', now, 'วัน-เวลาสำรองข้อมูลล่าสุด');
  setConfig('LAST_BACKUP_BY', sessionUser.name || sessionUser.username || 'ADMIN', 'ผู้สำรองข้อมูลล่าสุด');

  logAudit(sessionUser.userId, 'BACKUP_DATABASE', 'Database', {
    tableCount: Object.keys(tables).length,
    totalRows: totalExportedRows,
    note: note,
    checksum: checksum
  });

  return {
    ok: true,
    backup: backupPayload
  };
}

function restoreDatabaseBackup(payload = {}, sessionUser = {}, activeToken = '') {
  if (!payload || !payload.tables || typeof payload.tables !== 'object') {
    throw new Error('รูปแบบไฟล์สำรองข้อมูลไม่ถูกต้อง (ไม่พบข้อมูลตาราง)');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('ระบบกำลังประมวลผลรายการอื่นอยู่ กรุณารอสักครู่แล้วลองใหม่อีกครั้ง');
  }

  try {
    const incomingTables = payload.tables;
    const selectedTableNames = Array.isArray(payload.selectedTables) && payload.selectedTables.length > 0
      ? payload.selectedTables
      : Object.keys(incomingTables);

    const validTableNames = Object.values(SHEETS);
    const targetTables = selectedTableNames.filter(t => validTableNames.includes(t) && incomingTables[t]);

    if (targetTables.length === 0) {
      throw new Error('ไม่พบตารางที่ถูกต้องสำหรับการกู้คืนข้อมูล');
    }

    // Checksum verification
    if (payload.checksum && !payload.skipChecksumVerify) {
      const expectedChecksum = computeBackupChecksum_(incomingTables);
      if (payload.checksum !== expectedChecksum) {
        throw new Error('การตรวจสอบความสมบูรณ์ของไฟล์ล้มเหลว (Checksum Mismatch) ไฟล์อาจเสียหายหรือถูกดัดแปลง');
      }
    }

    // ADMIN LOCKOUT GUARD: If Users is being restored, verify at least one active admin exists
    if (targetTables.includes(SHEETS.USERS)) {
      const usersData = incomingTables[SHEETS.USERS];
      const headers = usersData.headers || [];
      const roleCol = headers.indexOf('roleId');
      const activeCol = headers.indexOf('active');
      const rows = usersData.rows || [];

      let hasActiveAdmin = false;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const rRole = Array.isArray(r) ? r[roleCol] : r.roleId;
        const rActive = Array.isArray(r) ? r[activeCol] : r.active;
        if (rRole === 'admin' && (rActive === true || String(rActive) === 'true')) {
          hasActiveAdmin = true;
          break;
        }
      }
      if (!hasActiveAdmin) {
        throw new Error('ไม่สามารถกู้คืนข้อมูลได้: ข้อมูลผู้ใช้ในไฟล์สำรองไม่มีบัญชีผู้ดูแลระบบ (Admin) ที่เปิดใช้งานอยู่');
      }
    }

    // ACTIVE SESSION PRESERVATION:
    const ss = getSpreadsheet();
    let preservedSessionRow = null;
    if (activeToken) {
      const sessSheet = ss.getSheetByName(SHEETS.SESSIONS);
      if (sessSheet) {
        const sData = sessSheet.getDataRange().getValues();
        if (sData.length > 1) {
          const sHeaders = sData[0].map(h => String(h).trim());
          const tokCol = sHeaders.indexOf('token');
          for (let r = 1; r < sData.length; r++) {
            if (String(sData[r][tokCol]) === String(activeToken)) {
              preservedSessionRow = {};
              sHeaders.forEach((h, idx) => { preservedSessionRow[h] = sData[r][idx]; });
              break;
            }
          }
        }
      }
    }

    const restoredSummary = {};
    let totalRestoredRows = 0;

    targetTables.forEach(sheetName => {
      let sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
      }

      const tableData = incomingTables[sheetName];
      const canonicalHeaders = (typeof DB_SCHEMAS !== 'undefined' && DB_SCHEMAS[sheetName])
        ? DB_SCHEMAS[sheetName]
        : (tableData.headers || []);
      const incomingHeaders = tableData.headers || canonicalHeaders;
      const incomingRows = tableData.rows || [];

      // Clear contents completely
      sheet.clearContents();

      // Format header row
      sheet.getRange(1, 1, 1, canonicalHeaders.length).setValues([canonicalHeaders]);
      sheet.getRange(1, 1, 1, canonicalHeaders.length).setFontWeight('bold').setBackground('#2C3E50').setFontColor('#FFFFFF');
      sheet.setFrozenRows(1);

      // Apply Text Column formatting (@) to prevent leading zeros from stripping
      const textCols = BACKUP_TEXT_COLUMNS[sheetName] || [];
      if (textCols.length > 0) {
        setTextColumns_(sheetName, textCols);
      }

      if (incomingRows.length > 0) {
        const matrix = incomingRows.map(row => {
          if (Array.isArray(row)) {
            return canonicalHeaders.map(ch => {
              const inIdx = incomingHeaders.indexOf(ch);
              const v = inIdx >= 0 ? row[inIdx] : '';
              return v === null || v === undefined ? '' : v;
            });
          } else {
            return canonicalHeaders.map(ch => {
              const v = row[ch];
              return v === null || v === undefined ? '' : v;
            });
          }
        });

        sheet.getRange(2, 1, matrix.length, canonicalHeaders.length).setValues(matrix);
      }

      restoredSummary[sheetName] = incomingRows.length;
      totalRestoredRows += incomingRows.length;
    });

    // Restore preserved active session if Sessions was overwritten or missing caller token
    if (preservedSessionRow && activeToken) {
      const sessSheet = getSheet(SHEETS.SESSIONS);
      const sessData = sessSheet.getDataRange().getValues();
      const sHeaders = sessData[0].map(h => String(h).trim());
      const tokCol = sHeaders.indexOf('token');
      let foundActive = false;
      for (let r = 1; r < sessData.length; r++) {
        if (String(sessData[r][tokCol]) === String(activeToken)) {
          foundActive = true;
          break;
        }
      }
      if (!foundActive) {
        appendRow(SHEETS.SESSIONS, preservedSessionRow);
      }
    }

    // INVALIDATE ALL CACHES IMMEDIATELY
    clearExecutionContextCache();
    try {
      const cache = CacheService.getScriptCache();
      cache.remove(SCRIPT_CACHE_KEYS.PRODUCTS);
      cache.remove(SCRIPT_CACHE_KEYS.BRANCHES);
      cache.remove(SCRIPT_CACHE_KEYS.RECEIPT_TEXTS);
      cache.remove(SCRIPT_CACHE_KEYS.CONFIG);
    } catch (e) {}

    const now = new Date().toISOString();
    setConfig('LAST_RESTORE_AT', now, 'วัน-เวลากู้คืนข้อมูลล่าสุด');
    setConfig('LAST_RESTORE_BY', sessionUser.name || sessionUser.username || 'ADMIN', 'ผู้กู้คืนข้อมูลล่าสุด');

    logAudit(sessionUser.userId, 'RESTORE_DATABASE', 'Database', {
      tableCount: targetTables.length,
      totalRows: totalRestoredRows,
      restoredTables: targetTables,
      backupExportedAt: payload.exportedAt || '',
      backupExportedBy: payload.exportedBy || ''
    });

    return {
      ok: true,
      message: `กู้คืนฐานข้อมูลสำเร็จเรียบร้อย (${targetTables.length} ตาราง, รวม ${totalRestoredRows} แถว)`,
      restoredTables: targetTables,
      restoredSummary: restoredSummary,
      totalRows: totalRestoredRows,
      restoredAt: now
    };
  } finally {
    lock.releaseLock();
  }
}
