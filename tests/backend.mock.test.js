const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createGasMockContext(options = {}) {
  const sheetsStore = new Map();
  const scriptProperties = new Map();
  const cacheStore = new Map();

  class MockSheet {
    constructor(name) {
      this.name = name;
      this.data = []; // 2D array [row][col]
      this.frozenRows = 0;
      this.textColumns = new Set(); // คอลัมน์ที่ตั้ง number format เป็น '@' (Plain Text)
    }

    getMaxRows() {
      return 1000;
    }

    getDataRange() {
      const self = this;
      return self.getRange(1, 1, Math.max(1, self.getLastRow()), Math.max(1, self.getLastColumn()));
    }

    getLastRow() {
      return this.data.length;
    }

    getLastColumn() {
      return this.data.length > 0 ? this.data[0].length : 0;
    }

    getRange(row, col, numRows, numCols) {
      const self = this;
      const rangeObj = {
        getValues: () => {
          const res = [];
          for (let r = 0; r < numRows; r++) {
            const rowArr = [];
            const targetRow = self.data[row - 1 + r] || [];
            for (let c = 0; c < numCols; c++) {
              rowArr.push(targetRow[col - 1 + c] !== undefined ? targetRow[col - 1 + c] : '');
            }
            res.push(rowArr);
          }
          return res;
        },
        setValues: (matrix) => {
          for (let r = 0; r < matrix.length; r++) {
            const rowIndex = row - 1 + r;
            if (!self.data[rowIndex]) {
              self.data[rowIndex] = [];
            }
            for (let c = 0; c < matrix[r].length; c++) {
              let v = matrix[r][c];
              // จำลองพฤติกรรม Google Sheets: สตริงตัวเลขล้วนถูกแปลงเป็น number (เลข 0 นำหน้าหาย)
              // ยกเว้นคอลัมน์ที่ตั้งเป็น Plain Text ('@')
              if (options.coerceNumeric && typeof v === 'string' && /^\d+$/.test(v) && !self.textColumns.has(col - 1 + c)) {
                v = Number(v);
              }
              self.data[rowIndex][col - 1 + c] = v;
            }
          }
          return rangeObj;
        },
        setNumberFormat: (fmt) => {
          if (fmt === '@') {
            for (let c = 0; c < numCols; c++) self.textColumns.add(col - 1 + c);
          }
          return rangeObj;
        },
        setFontWeight: () => rangeObj,
        setBackground: () => rangeObj,
        setFontColor: () => rangeObj
      };
      return rangeObj;
    }

    insertSheet(name) {
      return getOrCreateSheet(name);
    }

    setFrozenRows(n) {
      this.frozenRows = n;
    }

    deleteRow(rowIdx) {
      this.data.splice(rowIdx - 1, 1);
    }
  }

  function getOrCreateSheet(name) {
    if (!sheetsStore.has(name)) {
      sheetsStore.set(name, new MockSheet(name));
    }
    return sheetsStore.get(name);
  }

  class MockSpreadsheet {
    getSheetByName(name) {
      return sheetsStore.get(name) || null;
    }
    insertSheet(name) {
      return getOrCreateSheet(name);
    }
  }

  const activeSpreadsheet = new MockSpreadsheet();

  let lockHolder = false;
  const mockLock = {
    // REAL GAS behavior: waitLock returns void (undefined) and throws on timeout
    waitLock: (timeout) => {
      if (lockHolder) {
        throw new Error('Lock timeout');
      }
      lockHolder = true;
      return undefined; // VOID return value!
    },
    tryLock: (timeout) => {
      if (lockHolder) {
        return false;
      }
      lockHolder = true;
      return true;
    },
    releaseLock: () => {
      lockHolder = false;
    },
    hasLock: () => lockHolder
  };

  const sandbox = {
    console,
    Math,
    Date,
    JSON,
    String,
    parseInt,
    parseFloat,
    isNaN,
    Array,
    Set,
    Object,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => activeSpreadsheet,
      openById: (id) => activeSpreadsheet
    },
    LockService: {
      getScriptLock: () => mockLock
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => scriptProperties.get(key) || null,
        setProperty: (key, val) => scriptProperties.set(key, val)
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => cacheStore.get(key) || null,
        put: (key, val, ttl) => cacheStore.set(key, val),
        remove: (key) => cacheStore.delete(key)
      })
    },
    Utilities: {
      getUuid: () => 'uuid-' + Math.random().toString(36).substring(2, 10),
      formatDate: (date, tz, format) => {
        const d = date instanceof Date ? date : new Date(date);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        return format
          .replace('yyyy', yyyy)
          .replace('MM', mm)
          .replace('dd', dd)
          .replace('HH', hh)
          .replace('mm', min)
          .replace('ss', ss);
      },
      computeDigest: (alg, text, charset) => {
        const crypto = require('crypto');
        return Array.from(crypto.createHash('sha256').update(text, 'utf8').digest());
      },
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' }
    },
    ContentService: {
      createTextOutput: (text) => ({
        setMimeType: () => text,
        text
      }),
      MimeType: { JSON: 'JSON' }
    }
  };

  vm.createContext(sandbox);

  // Load all backend files in dependency order
  const backendDir = path.join(__dirname, '..', 'backend');
  const filesOrder = [
    'Db.gs',
    'Auth.gs',
    'Receipt.gs',
    'Products.gs',
    'Stock.gs',
    'Sales.gs',
    'Admin.gs',
    'Reports.gs',
    'Setup.gs',
    'Code.gs'
  ];

  for (const f of filesOrder) {
    const code = fs.readFileSync(path.join(backendDir, f), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }

  return { sandbox, sheetsStore };
}

test('GAS Mock: setupDatabase, login, and verify lock behavior in checkoutSale', () => {
  const { sandbox } = createGasMockContext();

  // 1. Setup database
  const setupRes = sandbox.setupDatabase();
  assert.strictEqual(setupRes.ok, true, 'setupDatabase should succeed');

  // 2. Login as cashier
  const loginRes = sandbox.loginUser('cashier', 'Cashier1234!');
  assert.ok(loginRes.token, 'Should have login token');
  assert.strictEqual(loginRes.user.username, 'cashier');

  // 3. Checkout sale: 1 Singha Water (10 THB) + 1 Basil Chicken Rice (55 THB) = 65 THB
  const payload = {
    branchId: 'B01',
    stationId: 'POS-01',
    items: [
      { sku: 'P1001', name: 'น้ำดื่มสิงห์ 600 มล.', qty: 1, unitPrice: 10, discount: 0 },
      { sku: 'P1004', name: 'ข้าวผัดกระเพราไก่ไข่ดาว', qty: 1, unitPrice: 55, discount: 0 }
    ],
    discount: 0,
    received: 100,
    payMethod: 'CASH',
    clientTxnId: 'TXN-TEST-001'
  };

  const saleRes = sandbox.checkoutSale(payload, loginRes.user);
  assert.strictEqual(saleRes.ok, true);
  assert.strictEqual(saleRes.sale.total, 65);
  assert.strictEqual(saleRes.sale.change, 35);
  assert.ok(saleRes.receiptNo.startsWith('RC'));

  // 4. Verify Stock was deducted
  const prods = sandbox.getProductsWithStock('B01');
  const p1001 = prods.find(p => p.sku === 'P1001');
  const p1004 = prods.find(p => p.sku === 'P1004');
  assert.strictEqual(p1001.stockQty, 99, 'Initial was 100, sold 1, should be 99');
  assert.strictEqual(p1004.stockQty, 24, 'Initial was 25, sold 1, should be 24');

  // 5. Test idempotency with duplicate clientTxnId
  const dupRes = sandbox.checkoutSale(payload, loginRes.user);
  assert.strictEqual(dupRes.isDuplicate, true);
  assert.strictEqual(dupRes.sale.receiptNo, saleRes.receiptNo);

  // 6. Test Void Receipt (by admin)
  const adminLogin = sandbox.loginUser('admin', 'Admin1234!');
  const voidRes = sandbox.voidReceipt(saleRes.receiptNo, 'Customer changed mind', adminLogin.user);
  assert.strictEqual(voidRes.ok, true);

  // Verify Stock was restored after void
  const prodsAfterVoid = sandbox.getProductsWithStock('B01');
  const p1001AfterVoid = prodsAfterVoid.find(p => p.sku === 'P1001');
  const p1004AfterVoid = prodsAfterVoid.find(p => p.sku === 'P1004');
  assert.strictEqual(p1001AfterVoid.stockQty, 100, 'Restored back to 100');
  assert.strictEqual(p1004AfterVoid.stockQty, 25, 'Restored back to 25');
});

test('GAS Mock: ReceiptTexts CRUD, branch override inheritance, and setup security', () => {
  const { sandbox } = createGasMockContext();

  // 1. Initial setup
  const setupRes = sandbox.setupDatabase();
  assert.strictEqual(setupRes.ok, true);

  // 2. Check default receipt text
  const defaultInfo = sandbox.getReceiptStoreInfo('B01');
  assert.strictEqual(defaultInfo.receiptTitle, 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ');
  assert.strictEqual(defaultInfo.showAddress, true);
  assert.strictEqual(defaultInfo.showCashier, true);
  assert.ok(defaultInfo.footer.includes('ขอบคุณที่ใช้บริการ'));

  // 3. Login as admin
  const adminLogin = sandbox.loginUser('admin', 'Admin1234!');

  // 4. Save branch-specific override for B01
  const saveOverrideRes = sandbox.saveReceiptTexts({
    scopeId: 'BRANCH_B01',
    branchId: 'B01',
    receiptTitle: 'ใบเสร็จรับเงินสาขาสุขุมวิท',
    storeName: 'POS Store สาขา 1 สุขุมวิท',
    subHeader: 'สาขาเปิด 24 ชม.',
    address: 'อาคารเอ็กซ์ ถ.สุขุมวิท กทม.',
    phone: '02-999-8888',
    taxId: '0105500000000',
    footer: 'เฉพาะสาขานี้สะสมแต้มได้ 2 เท่า',
    showAddress: true,
    showPhone: true,
    showTaxId: true,
    showCashier: false, // Turn off cashier display
    showBranch: true
  }, adminLogin.user);

  assert.strictEqual(saveOverrideRes.ok, true);

  // 5. Query store info for B01 vs other branch (e.g. B99)
  const b01Info = sandbox.getReceiptStoreInfo('B01');
  assert.strictEqual(b01Info.receiptTitle, 'ใบเสร็จรับเงินสาขาสุขุมวิท');
  assert.strictEqual(b01Info.storeName, 'POS Store สาขา 1 สุขุมวิท');
  assert.strictEqual(b01Info.showCashier, false, 'Cashier should be false for B01 override');
  assert.strictEqual(b01Info.footer, 'เฉพาะสาขานี้สะสมแต้มได้ 2 เท่า');

  const b99Info = sandbox.getReceiptStoreInfo('B99');
  assert.strictEqual(b99Info.receiptTitle, 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ', 'B99 should inherit DEFAULT title');
  assert.strictEqual(b99Info.showCashier, true, 'B99 should inherit DEFAULT showCashier (true)');

  // 6. Delete branch override for B01
  const delRes = sandbox.deleteBranchReceiptTexts('B01', adminLogin.user);
  assert.strictEqual(delRes.ok, true);

  // After delete, B01 should revert to DEFAULT
  const b01Reverted = sandbox.getReceiptStoreInfo('B01');
  assert.strictEqual(b01Reverted.receiptTitle, 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ');
  assert.strictEqual(b01Reverted.showCashier, true);

  // 7. Test Setup Action Security:
  // Now that Users table is populated, calling routeAction('setup') without token or with non-admin should fail
  const unauthSetup = sandbox.routeAction('setup', '', {}, {});
  assert.strictEqual(unauthSetup.ok, false);
  assert.strictEqual(unauthSetup.error, 'UNAUTHORIZED');

  const cashierLogin = sandbox.loginUser('cashier', 'Cashier1234!');
  const cashierSetup = sandbox.routeAction('setup', cashierLogin.token, {}, {});
  assert.strictEqual(cashierSetup.ok, false);
  assert.strictEqual(cashierSetup.error, 'UNAUTHORIZED');

  const adminSetup = sandbox.routeAction('setup', adminLogin.token, {}, {});
  assert.strictEqual(adminSetup.ok, true);
});

test('GAS Mock: Categories, Units, and Configs CRUD with Delete Protection', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const adminLogin = sandbox.loginUser('admin', 'Admin1234!');

  // --- 1. Categories CRUD ---
  // A) Save new category
  const saveCatRes = sandbox.saveCategory({
    categoryId: 'CAT_TEST',
    name: 'อุปกรณ์ไอที',
    color: '#9B59B6',
    sortOrder: 10
  }, adminLogin.user);
  assert.strictEqual(saveCatRes.ok, true);
  assert.strictEqual(saveCatRes.category.name, 'อุปกรณ์ไอที');

  // Verify it exists in getCategories
  let cats = sandbox.getCategories();
  assert.ok(cats.some(c => c.categoryId === 'CAT_TEST'));

  // B) Delete protection: CAT_BEV is used by sample products (P1001, P1002)
  assert.throws(() => {
    sandbox.deleteCategory('CAT_BEV', adminLogin.user);
  }, /ไม่สามารถลบหมวดหมู่นี้ได้/);

  // C) Delete unused category CAT_TEST should succeed
  const delCatRes = sandbox.deleteCategory('CAT_TEST', adminLogin.user);
  assert.strictEqual(delCatRes.ok, true);
  cats = sandbox.getCategories();
  assert.ok(!cats.some(c => c.categoryId === 'CAT_TEST'));

  // --- 2. Units CRUD ---
  // A) Save new unit
  const saveUnitRes = sandbox.saveUnit({
    unitId: 'U_KG',
    name: 'กิโลกรัม'
  }, adminLogin.user);
  assert.strictEqual(saveUnitRes.ok, true);
  assert.strictEqual(saveUnitRes.unit.name, 'กิโลกรัม');

  // Duplicate name check
  assert.throws(() => {
    sandbox.saveUnit({ unitId: 'U_KG2', name: 'กิโลกรัม' }, adminLogin.user);
  }, /ชื่อหน่วยนับ "กิโลกรัม" มีอยู่ในระบบแล้ว/);

  // B) Delete protection: 'ขวด' is used by sample products
  const btlUnit = sandbox.getUnits().find(u => u.name === 'ขวด');
  assert.ok(btlUnit, 'Should have unit ขวด');
  assert.throws(() => {
    sandbox.deleteUnit(btlUnit.unitId, adminLogin.user);
  }, /ไม่สามารถลบหน่วยนับ "ขวด" ได้/);

  // C) Delete unused unit U_KG should succeed
  const delUnitRes = sandbox.deleteUnit('U_KG', adminLogin.user);
  assert.strictEqual(delUnitRes.ok, true);
  const units = sandbox.getUnits();
  assert.ok(!units.some(u => u.unitId === 'U_KG'));

  // --- 3. Configs Table & Item CRUD ---
  // A) Get configs table
  const confTable = sandbox.getConfigsTable();
  assert.ok(confTable.length >= 10);
  const vatItem = confTable.find(c => c.key === 'VAT_RATE');
  assert.ok(vatItem);
  assert.strictEqual(vatItem.isSystem, true);

  // B) Save core config
  sandbox.saveConfigItem({ key: 'VAT_RATE', value: '7', description: 'อัตราภาษี 7%' }, adminLogin.user);
  assert.strictEqual(sandbox.getConfig('VAT_RATE'), '7');

  // C) Save custom config
  sandbox.saveConfigItem({ key: 'CUSTOM_BANNER_TEXT', value: 'ยินดีต้อนรับทุกท่าน', description: 'แบนเนอร์' }, adminLogin.user);
  assert.strictEqual(sandbox.getConfig('CUSTOM_BANNER_TEXT'), 'ยินดีต้อนรับทุกท่าน');

  // D) Delete system key protection
  assert.throws(() => {
    sandbox.deleteConfigItem('VAT_RATE', adminLogin.user);
  }, /ไม่อนุญาตให้ลบคีย์ระบบ/);

  // E) Delete custom key should succeed
  const delConfRes = sandbox.deleteConfigItem('CUSTOM_BANNER_TEXT', adminLogin.user);
  assert.strictEqual(delConfRes.ok, true);
  assert.strictEqual(sandbox.getConfig('CUSTOM_BANNER_TEXT', 'NOT_FOUND'), 'NOT_FOUND');
});

test('GAS Mock: Branch Management CRUD, Login Branch Selection, Delete Protection, and Isolation', () => {
  const { sandbox } = createGasMockContext();

  // Setup database
  sandbox.setupDatabase();

  // 1. Public branches endpoint
  const pubRes = sandbox.routeAction('public:branches', null, {});
  assert.strictEqual(pubRes.ok, true);
  assert.ok(pubRes.branches.some(b => b.branchId === 'B01'), 'Public branches should contain B01');

  // 2. Admin creates a new branch B02
  const adminLogin = sandbox.routeAction('login', null, { username: 'admin', password: 'Admin1234!', branchId: 'B01' });
  assert.strictEqual(adminLogin.ok, true);
  assert.strictEqual(adminLogin.activeBranchId, 'B01');
  assert.strictEqual(adminLogin.activeBranch.code, 'MAIN');

  // Save new branch B02
  const b02Res = sandbox.routeAction('admin:saveBranch', adminLogin.token, {
    branchId: 'B02',
    code: 'BANGNA',
    name: 'สาขา 2 (เซ็นทรัลบางนา)',
    phone: '02-777-8888',
    address: 'บางนา-ตราด กม.3',
    taxId: '0105500000002',
    active: 'true'
  });
  assert.strictEqual(b02Res.ok, true);
  assert.strictEqual(b02Res.branch.branchId, 'B02');
  assert.strictEqual(b02Res.branch.code, 'BANGNA');

  // Check duplicate branch code rejection
  assert.throws(() => {
    sandbox.saveBranchData({ branchId: 'B03', code: 'BANGNA', name: 'สาขาซ้ำ' }, adminLogin.user);
  }, /ตัวย่อสาขา "BANGNA" ถูกใช้งานโดย/);

  // 3. User branch authorization at login
  // Cashier has branchIds: 'B01' only
  const cashierLoginB01 = sandbox.routeAction('login', null, { username: 'cashier', password: 'Cashier1234!', branchId: 'B01' });
  assert.strictEqual(cashierLoginB01.ok, true);
  assert.strictEqual(cashierLoginB01.activeBranchId, 'B01');

  // Cashier attempts to log in to B02 (unauthorized)
  assert.throws(() => {
    sandbox.loginUser('cashier', 'Cashier1234!', { branchId: 'B02' });
  }, /คุณไม่มีสิทธิ์เข้าใช้งานสาขาที่เลือก \(B02\)/);

  // 4. Branch switching for authorized user (Admin)
  const switchRes = sandbox.routeAction('auth:switchBranch', adminLogin.token, { branchId: 'B02' });
  assert.strictEqual(switchRes.ok, true);
  assert.strictEqual(switchRes.activeBranchId, 'B02');
  assert.strictEqual(switchRes.activeBranch.code, 'BANGNA');

  // 5. Delete protection: B01 has seeded stock and sales
  assert.throws(() => {
    sandbox.deleteBranchData('B01', adminLogin.user);
  }, /ไม่สามารถลบสาขาได้/);

  // 6. Clean deletion: B02 has no sales or stock -> delete succeeds
  const delB02 = sandbox.routeAction('admin:deleteBranch', adminLogin.token, { branchId: 'B02' });
  assert.strictEqual(delB02.ok, true);

  const finalBranches = sandbox.getBranchesList();
  assert.ok(!finalBranches.some(b => b.branchId === 'B02'), 'B02 should be removed');
});

test('GAS Mock: Receipt texts keep leading zeros, honor blank fields, and expose branch name', () => {
  // coerceNumeric: จำลอง Google Sheets ที่แปลงสตริงตัวเลขล้วนเป็น number
  const { sandbox } = createGasMockContext({ coerceNumeric: true });
  sandbox.setupDatabase();
  const admin = sandbox.loginUser('admin', 'Admin1234!');

  // ข้อมูลเดิมที่ถูกแปลงเป็น number แล้ว (เลข 0 นำหน้าหาย) ต้องถูกซ่อมตอนอ่าน
  const raw = sandbox.getTable('ReceiptTexts').rows[0];
  assert.strictEqual(typeof raw.taxId, 'number', 'ข้อมูลตั้งต้นในชีตจำลองต้องเป็น number (เลข 0 หาย)');
  assert.strictEqual(sandbox.getReceiptStoreInfo('B01').taxId, '0105500000000');

  // บันทึกใหม่: คอลัมน์ต้องเป็นข้อความ เลข 0 ไม่หาย และเว้นว่างหัวรอง/ท้ายใบเสร็จได้จริง
  sandbox.saveReceiptTexts({
    scopeId: 'DEFAULT', branchId: '*',
    receiptTitle: 'ใบเสร็จรับเงิน', storeName: 'ร้านทดสอบ', subHeader: '',
    address: 'กทม.', phone: '0812345678', taxId: '0105500000001', footer: '',
    showAddress: true, showPhone: true, showTaxId: true, showCashier: true, showBranch: true
  }, admin.user);

  const saved = sandbox.getTable('ReceiptTexts').rows.find(r => r.scopeId === 'DEFAULT');
  assert.strictEqual(saved.taxId, '0105500000001');
  assert.strictEqual(saved.phone, '0812345678');

  const info = sandbox.getReceiptStoreInfo('B01');
  assert.strictEqual(info.taxId, '0105500000001');
  assert.strictEqual(info.phone, '0812345678');
  assert.strictEqual(info.subHeader, '', 'ช่องที่เว้นว่างโดยตั้งใจต้องไม่ถูกแทนด้วยค่าเริ่มต้น');
  assert.strictEqual(info.footer, '', 'ท้ายใบเสร็จที่เว้นว่างต้องไม่ถูกแทนด้วยค่าเริ่มต้น');
  assert.strictEqual(info.branchCode, 'MAIN');
  assert.ok(info.branchName.length > 0, 'ต้องมีชื่อสาขาสำหรับพิมพ์บนใบเสร็จ');

  // แถวเฉพาะสาขา: ช่องที่เหมือนค่ากลางถูกเก็บเป็นว่าง (สืบทอด) และเปลี่ยนตามเมื่อแก้ค่ากลาง
  sandbox.saveReceiptTexts({
    scopeId: 'BRANCH_B01', branchId: 'B01',
    receiptTitle: 'ใบเสร็จรับเงิน', storeName: 'ร้านทดสอบ สาขา 1', subHeader: '',
    address: 'กทม.', phone: '0812345678', taxId: '0105500000001', footer: 'ท้ายเฉพาะสาขา',
    showAddress: true, showPhone: true, showTaxId: true, showCashier: true, showBranch: true
  }, admin.user);
  const branchRow = sandbox.getTable('ReceiptTexts').rows.find(r => r.scopeId === 'BRANCH_B01');
  assert.strictEqual(branchRow.storeName, 'ร้านทดสอบ สาขา 1');
  assert.strictEqual(branchRow.address, '', 'ที่อยู่เหมือนค่ากลาง ต้องเก็บเป็นว่าง (สืบทอด)');
  assert.strictEqual(branchRow.taxId, '', 'เลขผู้เสียภาษีเหมือนค่ากลาง ต้องเก็บเป็นว่าง (สืบทอด)');

  sandbox.saveReceiptTexts({
    scopeId: 'DEFAULT', branchId: '*',
    receiptTitle: 'ใบเสร็จรับเงิน', storeName: 'ร้านทดสอบ', subHeader: '',
    address: 'ที่อยู่ใหม่', phone: '0812345678', taxId: '0105500000001', footer: '',
    showAddress: true, showPhone: true, showTaxId: true, showCashier: true, showBranch: true
  }, admin.user);
  const after = sandbox.getReceiptStoreInfo('B01');
  assert.strictEqual(after.address, 'ที่อยู่ใหม่', 'สาขาต้องตามค่ากลางที่แก้ไขใหม่');
  assert.strictEqual(after.footer, 'ท้ายเฉพาะสาขา');
  assert.strictEqual(after.storeName, 'ร้านทดสอบ สาขา 1');

  // รายการสาขาที่ส่งให้หน้า Admin ต้องไม่ทำเลข 0 หาย
  const branches = sandbox.getBranchesList();
  assert.strictEqual(branches[0].taxId, '0105500000000');
});

test('GAS Mock: Checkout rounds money, enforces payment rules, and reports include voided bills', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const admin = sandbox.loginUser('admin', 'Admin1234!');

  // 1) ปัดทศนิยม: 3 x 0.1 ต้องได้ 0.3 พอดี (ไม่ใช่ 0.30000000000000004)
  const r1 = sandbox.checkoutSale({
    branchId: 'B01', items: [{ sku: 'P1001', name: 'น้ำ', qty: 3, unitPrice: 0.1, discount: 0 }],
    received: 1, payMethod: 'CASH', clientTxnId: 'T-ROUND-1'
  }, admin.user);
  assert.strictEqual(r1.sale.total, 0.3);
  assert.strictEqual(r1.sale.subtotal, 0.3);
  assert.strictEqual(r1.items[0].amount, 0.3);
  assert.strictEqual(r1.sale.change, 0.7);

  // 2) รายการลดเต็มจำนวน amount ต้องเป็น 0 (ไม่ใช่ราคาเต็ม)
  const r2 = sandbox.checkoutSale({
    branchId: 'B01', items: [{ sku: 'P1001', name: 'น้ำ', qty: 1, unitPrice: 10, discount: 10 }],
    received: 0, payMethod: 'TRANSFER', clientTxnId: 'T-ZERO-1'
  }, admin.user);
  assert.strictEqual(r2.items[0].amount, 0);
  assert.strictEqual(r2.sale.total, 0);

  // 3) เงินสดรับไม่พอ ต้องถูกปฏิเสธ
  assert.throws(() => sandbox.checkoutSale({
    branchId: 'B01', items: [{ sku: 'P1001', name: 'น้ำ', qty: 1, unitPrice: 10, discount: 0 }],
    received: 5, payMethod: 'CASH', clientTxnId: 'T-SHORT-1'
  }, admin.user), /น้อยกว่ายอด/);

  // 4) โอนเงิน: received = total, change = 0 แม้ส่ง received มากกว่า
  const r4 = sandbox.checkoutSale({
    branchId: 'B01', items: [{ sku: 'P1001', name: 'น้ำ', qty: 2, unitPrice: 10, discount: 0 }],
    received: 500, payMethod: 'TRANSFER', clientTxnId: 'T-TRANSFER-1'
  }, admin.user);
  assert.strictEqual(r4.sale.total, 20);
  assert.strictEqual(r4.sale.received, 20);
  assert.strictEqual(r4.sale.change, 0);

  // 5) ส่วนลดท้ายบิลเกินยอดรวม ต้องถูกจำกัดไม่ให้ยอดติดลบ
  const r5 = sandbox.checkoutSale({
    branchId: 'B01', items: [{ sku: 'P1001', name: 'น้ำ', qty: 1, unitPrice: 10, discount: 0 }],
    discount: 999, received: 0, payMethod: 'QR', clientTxnId: 'T-DISC-1'
  }, admin.user);
  assert.strictEqual(r5.sale.discount, 10);
  assert.strictEqual(r5.sale.total, 0);

  // 6) รายงาน: ยกเลิกบิล r4 แล้วต้องแยกแสดงบิลที่ยกเลิก และยอดสุทธิไม่รวมบิลนั้น
  sandbox.voidReceipt(r4.receiptNo, 'ทดสอบยกเลิก', admin.user);
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const rep = sandbox.getDailySalesReport(today, today, '');
  assert.strictEqual(rep.summary.voidBills, 1);
  assert.strictEqual(rep.summary.voidAmount, 20);
  assert.strictEqual(rep.summary.totalBills, 3);
  assert.strictEqual(rep.summary.grossBills, 4);
  assert.strictEqual(rep.summary.totalSales, 0.3, 'ยอดสุทธิ = 0.3 + 0 + 0 (ไม่รวมบิลที่ยกเลิก)');
});

test('GAS Mock: Smart idempotency distinguishes true network retry vs stale clientTxnId across new bills', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const admin = sandbox.loginUser('admin', 'Admin1234!');

  // ตั้งชื่อร้านเฉพาะเพื่อยืนยันว่าทั้งบิลปกติและบิลซ้ำส่ง store กลับมาครบถ้วน (ไม่หลุดเป็น POS Store)
  sandbox.saveReceiptTexts({
    scopeId: 'DEFAULT', branchId: '*',
    receiptTitle: 'ใบเสร็จรับเงิน', storeName: 'ร้าน ศศิธร อะไหล่ แอร์', subHeader: 'ยินดีต้อนรับ',
    address: 'กทม.', phone: '02-123-4567', taxId: '0105500000000', footer: 'ขอบคุณที่ใช้บริการ',
    showAddress: false, showPhone: false, showTaxId: false, showCashier: true, showBranch: false
  }, admin.user);

  // บิลที่ 1: 65 บาท เงินสด ด้วย clientTxnId = TXN_STALE_01
  const bill1Payload = {
    branchId: 'B01',
    items: [
      { sku: 'P1001', name: 'น้ำดื่มสิงห์ 600 มล.', qty: 1, unitPrice: 10, discount: 0 },
      { sku: 'P1004', name: 'ข้าวผัดกระเพราไก่ไข่ดาว', qty: 1, unitPrice: 55, discount: 0 }
    ],
    discount: 0,
    received: 100,
    payMethod: 'CASH',
    clientTxnId: 'TXN_STALE_01'
  };
  const res1 = sandbox.checkoutSale(bill1Payload, admin.user);
  assert.strictEqual(res1.ok, true);
  assert.strictEqual(res1.sale.total, 65);
  assert.strictEqual(res1.store.storeName, 'ร้าน ศศิธร อะไหล่ แอร์');

  // กรณี A: เน็ตสะดุดส่ง payload เดิมเป๊ะซ้ำทันที -> ต้องได้ isDuplicate: true พร้อม receiptNo และ store ครบ!
  const retryRes = sandbox.checkoutSale(bill1Payload, admin.user);
  assert.strictEqual(retryRes.isDuplicate, true);
  assert.strictEqual(retryRes.receiptNo, res1.receiptNo, 'ต้องมี receiptNo ใน response เสมอ');
  assert.ok(retryRes.store, 'ต้องแนบ store มาด้วยแม้เป็น isDuplicate');
  assert.strictEqual(retryRes.store.storeName, 'ร้าน ศศิธร อะไหล่ แอร์');
  assert.strictEqual(retryRes.store.showBranch, false);

  // กรณี B: บิลใหม่ยอด 120 บาท โอน/QR แต่ติด clientTxnId เดิมค้างมาจาก localStorage!
  // ต้องไม่คืนบิลเก่า 65 บาท! ต้องออกเลขที่ใบเสร็จใหม่ ยอด 120 โอน/QR และตัดสต๊อกจริง!
  const bill2Payload = {
    branchId: 'B01',
    items: [
      { sku: 'P1001', name: 'น้ำดื่มสิงห์ 600 มล.', qty: 12, unitPrice: 10, discount: 0 }
    ],
    discount: 0,
    received: 120,
    payMethod: 'TRANSFER',
    clientTxnId: 'TXN_STALE_01' // จงใจส่งรหัสซ้ำกับบิล 65 บาท!
  };
  const res2 = sandbox.checkoutSale(bill2Payload, admin.user);
  assert.strictEqual(res2.ok, true);
  assert.strictEqual( Boolean(res2.isDuplicate), false, 'ต้องบันทึกเป็นบิลใหม่ ไม่ใช่บิลซ้ำ');
  assert.notStrictEqual(res2.receiptNo, res1.receiptNo, 'ต้องได้เลขที่ใบเสร็จใบใหม่');
  assert.strictEqual(res2.sale.total, 120, 'ยอดสุทธิใบเสร็จต้องเป็น 120 บาทตรงตามที่ชำระ');
  assert.strictEqual(res2.sale.payMethod, 'TRANSFER');
  assert.strictEqual(res2.sale.received, 120);
  assert.strictEqual(res2.sale.change, 0);
  assert.strictEqual(res2.store.storeName, 'ร้าน ศศิธร อะไหล่ แอร์');

  // สต๊อก P1001 เดิม 100 -> ขายบิลแรก 1 ชิ้น (retry ไม่ตัดซ้ำ) -> ขายบิลสอง 12 ชิ้น = คงเหลือ 87 ชิ้น
  const p1001 = sandbox.getProductsWithStock('B01').find(p => p.sku === 'P1001');
  assert.strictEqual(p1001.stockQty, 87);
});
