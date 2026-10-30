const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createGasMockContext } = require('./backend.mock.test.js');

test('GAS Mock: Backup Status reports accurate table row counts and config values', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();

  const status = sandbox.getBackupStatus();
  assert.strictEqual(status.ok, true);
  assert.ok(status.spreadsheetId);
  assert.ok(status.totalRows > 0);
  assert.strictEqual(status.tableCount, 17);
  assert.ok(status.tableStats);

  // ตรวจสอบว่ามีตารางหลักครบ 17 ตาราง และเก็บจำนวนแถว >= 0
  const expectedTables = [
    'Users', 'Roles', 'Branches', 'Products', 'Categories', 'Units',
    'StockBalance', 'StockMovements', 'StockDocs', 'Sales', 'SaleItems',
    'Counters', 'Config', 'ReceiptTexts', 'PrintProfiles', 'AuditLog', 'Sessions'
  ];
  for (const t of expectedTables) {
    assert.ok(typeof status.tableStats[t] === 'number', `tableStats should have numeric row count for ${t}`);
  }

  // เริ่มต้นยังไม่มีประวัติสำรองข้อมูล
  assert.strictEqual(status.lastBackupAt, '');
  assert.strictEqual(status.lastRestoreAt, '');
});

test('GAS Mock: Export Backup generates compact schema, computes SHA-256 checksum, logs audit, and updates configs', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const admin = sandbox.loginUser('admin', 'Admin1234!');

  const res = sandbox.exportDatabaseBackup({}, admin.user);
  assert.strictEqual(res.ok, true);
  assert.ok(res.backup);

  const b = res.backup;
  assert.strictEqual(b.format, 'POS_STOCK_BACKUP');
  assert.strictEqual(b.version, '1.0');
  assert.ok(b.exportedAt);
  assert.strictEqual(b.exportedBy, 'ผู้ดูแลระบบสูงสุด');
  assert.ok(b.checksum && b.checksum.startsWith('sha256:'), 'Checksum should start with sha256:');
  assert.strictEqual(b.tableCount, 16); // 17 ตารางลบ Sessions

  // ตรวจสอบตาราง Users ใน backup
  assert.ok(b.tables.Users);
  assert.ok(Array.isArray(b.tables.Users.headers));
  assert.ok(Array.isArray(b.tables.Users.rows));
  assert.ok(b.tables.Users.rows.length >= 2, 'Should contain at least admin and cashier users');

  // ตรวจสอบ Configs บันทึก LAST_BACKUP_AT / LAST_BACKUP_BY
  const lastAt = sandbox.getConfig('LAST_BACKUP_AT');
  const lastBy = sandbox.getConfig('LAST_BACKUP_BY');
  assert.ok(lastAt);
  assert.strictEqual(lastBy, 'ผู้ดูแลระบบสูงสุด');

  // ตรวจสอบ AuditLogs
  const auditLogs = sandbox.getTable('AuditLog').rows;
  const backupAudit = auditLogs.find(a => a.action === 'BACKUP_DATABASE');
  assert.ok(backupAudit, 'AuditLog must have BACKUP_DATABASE record');
  assert.strictEqual(backupAudit.userId, 'USR_ADMIN_01');
});

test('GAS Mock: Selective Export exports only requested tables', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const admin = sandbox.loginUser('admin', 'Admin1234!');

  const res = sandbox.exportDatabaseBackup({
    tables: ['Products', 'Categories']
  }, admin.user);

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.backup.tableCount, 2);
  assert.ok(res.backup.tables.Products);
  assert.ok(res.backup.tables.Categories);
  assert.strictEqual(res.backup.tables.Users, undefined);
  assert.strictEqual(res.backup.tables.Sales, undefined);
});

test('GAS Mock: Restore Backup rejects corrupted backup payload when checksum mismatch', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const admin = sandbox.loginUser('admin', 'Admin1234!');

  const expRes = sandbox.exportDatabaseBackup({}, admin.user);
  const backupData = JSON.parse(JSON.stringify(expRes.backup));

  // แอบแก้ไขข้อมูลแถวใน Users โดยไม่แก้ checksum
  backupData.tables.Users.rows[0][1] = 'hacked_username';

  assert.throws(() => {
    sandbox.restoreDatabaseBackup({
      tables: backupData.tables,
      selectedTables: ['Users'],
      exportedAt: backupData.exportedAt,
      exportedBy: backupData.exportedBy,
      checksum: backupData.checksum,
      skipChecksumVerify: false
    }, admin.user, admin.token);
  }, /Checksum Mismatch/);
});

test('GAS Mock: Restore Backup enforces Admin lockout guard when Users table lacks active admin', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const admin = sandbox.loginUser('admin', 'Admin1234!');

  const expRes = sandbox.exportDatabaseBackup({}, admin.user);
  const backupData = JSON.parse(JSON.stringify(expRes.backup));

  // ดัดแปลงข้อมูล Users ให้เหลือแต่ cashier เท่านั้น (ไม่มี roleId === 'admin')
  const userHeaders = backupData.tables.Users.headers;
  const roleIdx = userHeaders.indexOf('roleId');

  backupData.tables.Users.rows.forEach(r => {
    r[roleIdx] = 'cashier'; // เปลี่ยน role ทั้งหมดเป็น cashier
  });

  // แม้ว่าจะ bypass checksum ก็ต้องถูกบล็อกโดย Admin Lockout Guard
  assert.throws(() => {
    sandbox.restoreDatabaseBackup({
      tables: backupData.tables,
      selectedTables: ['Users'],
      exportedAt: backupData.exportedAt,
      exportedBy: backupData.exportedBy,
      checksum: backupData.checksum,
      skipChecksumVerify: true
    }, admin.user, admin.token);
  }, /ไม่มีบัญชีผู้ดูแลระบบ \(Admin\)/);
});

test('GAS Mock: Restore Backup clears ghost rows, preserves text formatting (@), and restores data accurately', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const admin = sandbox.loginUser('admin', 'Admin1234!');

  // เพิ่มข้อมูล Product ตัวอย่างที่มีบาร์โค้ดขึ้นต้นด้วย 0 และ SKU ตัวเลข
  sandbox.appendRow('Products', {
    sku: '00123',
    barcode: '0885012345678',
    name: 'สินค้าทดสอบเลขศูนย์นำหน้า',
    categoryId: 'cat_drink',
    unit: 'ขวด',
    costPrice: 10,
    salePrice: 20,
    minStock: 5,
    active: true
  });

  // Export Backup
  const expRes = sandbox.exportDatabaseBackup({}, admin.user);
  const backup = expRes.backup;

  // เพิ่ม "Ghost rows" อีก 3 แถวในชีต Products
  sandbox.appendRow('Products', { sku: 'GHOST_1', barcode: 'G1', name: 'ผี 1' });
  sandbox.appendRow('Products', { sku: 'GHOST_2', barcode: 'G2', name: 'ผี 2' });
  sandbox.appendRow('Products', { sku: 'GHOST_3', barcode: 'G3', name: 'ผี 3' });

  const rowsBeforeRestore = sandbox.getTable('Products').rows;
  assert.strictEqual(rowsBeforeRestore.length, backup.tables.Products.rows.length + 3);

  // Restore กลับ
  const restoreRes = sandbox.restoreDatabaseBackup({
    tables: backup.tables,
    selectedTables: ['Products'],
    exportedAt: backup.exportedAt,
    exportedBy: backup.exportedBy,
    checksum: backup.checksum,
    skipChecksumVerify: false
  }, admin.user, admin.token);

  assert.strictEqual(restoreRes.ok, true);

  // ตรวจสอบว่า Ghost rows ถูกลบเกลี้ยง (จำนวนแถวเท่ากับ backup เดิมพอดี)
  const rowsAfterRestore = sandbox.getTable('Products').rows;
  assert.strictEqual(rowsAfterRestore.length, backup.tables.Products.rows.length);

  // ตรวจสอบสินค้า 00123 ว่าเลข 0 นำหน้ายังคงอยู่ครบถ้วน ไม่กลายเป็นตัวเลขถูกตัด 0
  const p00123 = rowsAfterRestore.find(p => p.sku === '00123');
  assert.ok(p00123, 'Product with sku 00123 must exist');
  assert.strictEqual(p00123.barcode, '0885012345678');
  assert.strictEqual(p00123.sku, '00123');

  // ตรวจสอบ Configs
  assert.ok(sandbox.getConfig('LAST_RESTORE_AT'));
  assert.strictEqual(sandbox.getConfig('LAST_RESTORE_BY'), 'ผู้ดูแลระบบสูงสุด');

  // ตรวจสอบ AuditLogs
  const auditLogs = sandbox.getTable('AuditLog').rows;
  const restoreAudit = auditLogs.find(a => a.action === 'RESTORE_DATABASE');
  assert.ok(restoreAudit, 'AuditLog must have RESTORE_DATABASE record');
  assert.strictEqual(restoreAudit.userId, 'USR_ADMIN_01');
});

test('GAS Mock: Restore Backup preserves active admin session token across Sessions restore', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const admin = sandbox.loginUser('admin', 'Admin1234!');
  assert.ok(admin.token, 'Admin should have active session token');

  // ตรวจสอบว่า session มีอยู่ในชีต Sessions
  let sessions = sandbox.getTable('Sessions').rows;
  const activeSess = sessions.find(s => s.token === admin.token);
  assert.ok(activeSess, 'Session must exist in Sessions sheet');

  // สร้าง backup ที่ไม่มี token ปัจจุบันนี้ (เช่น mock backup จากเครื่องอื่น)
  const expRes = sandbox.exportDatabaseBackup({ tables: ['Sessions'] }, admin.user);
  const backup = JSON.parse(JSON.stringify(expRes.backup));
  backup.tables.Sessions.rows = []; // จำลองไฟล์ backup ว่างเปล่าใน Sessions

  // คำนวณ checksum ใหม่
  backup.checksum = sandbox.computeBackupChecksum_(backup.tables);

  // กู้คืนตาราง Sessions
  const res = sandbox.restoreDatabaseBackup({
    tables: backup.tables,
    selectedTables: ['Sessions'],
    exportedAt: backup.exportedAt,
    exportedBy: backup.exportedBy,
    checksum: backup.checksum,
    skipChecksumVerify: false
  }, admin.user, admin.token);

  assert.strictEqual(res.ok, true);

  // ตรวจสอบว่า session token ของผู้เรียกยังคงอยู่ ไม่ถูกลบหายไป
  sessions = sandbox.getTable('Sessions').rows;
  const preservedSess = sessions.find(s => s.token === admin.token);
  assert.ok(preservedSess, 'Active admin session must be preserved during Sessions restore');
});

test('Frontend DOM: Admin Backup & Restore tab, controls, presets, and safety confirmation modal are present', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');

  // 1. Navigation items
  assert.ok(html.includes(`data-tab="backup"`), 'Sidebar must have backup tab');
  assert.ok(html.includes(`สำรอง/กู้คืนฐานข้อมูล`), 'Dropdown must have backup tab');

  // 2. Admin backup tab view
  assert.ok(html.includes(`id="adminTab_backup"`), 'adminTab_backup view container must exist');
  assert.ok(html.includes(`id="backupSpreadsheetLink"`), 'backupSpreadsheetLink must exist');
  assert.ok(html.includes(`id="backupTotalRowsCount"`), 'backupTotalRowsCount must exist');
  assert.ok(html.includes(`id="backupLastCard"`), 'backupLastCard must exist');
  assert.ok(html.includes(`id="backupTablesDetailGrid"`), 'backupTablesDetailGrid must exist');

  // 3. Export presets
  assert.ok(html.includes(`name="backupPresetOption" value="full"`), 'Full backup preset radio must exist');
  assert.ok(html.includes(`name="backupPresetOption" value="master"`), 'Master backup preset radio must exist');
  assert.ok(html.includes(`name="backupPresetOption" value="custom"`), 'Custom backup preset radio must exist');
  assert.ok(html.includes(`id="backupCustomTablesContainer"`), 'backupCustomTablesContainer must exist');

  // 4. Import & Diff preview
  assert.ok(html.includes(`id="restoreFileInput"`), 'restoreFileInput must exist');
  assert.ok(html.includes(`id="restoreFileInspectorContainer"`), 'restoreFileInspectorContainer must exist');
  assert.ok(html.includes(`id="restoreDiffTableBody"`), 'restoreDiffTableBody must exist');

  // 5. Confirmation Modal
  assert.ok(html.includes(`id="restoreConfirmModal"`), 'restoreConfirmModal must exist');
  assert.ok(html.includes(`id="restoreConfirmPhraseInput"`), 'restoreConfirmPhraseInput must exist');
  assert.ok(html.includes(`id="restoreConfirmSubmitBtn"`), 'restoreConfirmSubmitBtn must exist');
  assert.ok(html.includes(`id="restoreSafetyBackupCheck"`), 'restoreSafetyBackupCheck must exist');
});


test('Frontend JS: admin.js parses with valid syntax and AdminModule has all tab handlers', () => {
  const adminJsPath = path.join(__dirname, '..', 'frontend', 'js', 'modules', 'admin.js');
  const code = fs.readFileSync(adminJsPath, 'utf8');

  // Verify syntax via vm
  const vm = require('vm');
  const sandbox = {
    window: {},
    document: {
      querySelectorAll: () => [],
      getElementById: () => null
    },
    localStorage: { getItem: () => null, setItem: () => null },
    console,
    UI: { showToast: () => {}, showLoading: () => {}, hideLoading: () => {}, openModal: () => {}, closeModal: () => {} },
    Api: { call: async () => ({ ok: true }) },
    SoundManager: { playSuccessChime: () => {}, playErrorTone: () => {} },
    Auth: { user: { roleId: 'admin' } }
  };
  vm.createContext(sandbox);

  let AdminModule;
  assert.doesNotThrow(() => {
    AdminModule = vm.runInContext(code + '\n;AdminModule;', sandbox, { filename: 'admin.js' });
  }, 'admin.js must parse and execute without syntax errors');
  assert.ok(AdminModule, 'AdminModule object must be defined');
  assert.strictEqual(typeof AdminModule.activate, 'function');
  assert.strictEqual(typeof AdminModule.switchTab, 'function');
  assert.strictEqual(typeof AdminModule.setupTabNavigation, 'function');
  assert.strictEqual(typeof AdminModule.loadBackupUI, 'function');
  assert.strictEqual(typeof AdminModule.executeRestoreDatabase, 'function');
  assert.strictEqual(typeof AdminModule.exportDatabaseBackup, 'function');
});
