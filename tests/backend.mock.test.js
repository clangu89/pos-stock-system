const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createGasMockContext() {
  const sheetsStore = new Map();
  const scriptProperties = new Map();
  const cacheStore = new Map();

  class MockSheet {
    constructor(name) {
      this.name = name;
      this.data = []; // 2D array [row][col]
      this.frozenRows = 0;
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
              self.data[rowIndex][col - 1 + c] = matrix[r][c];
            }
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
