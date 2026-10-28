const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createSalesSandbox(initialStorage = {}) {
  const store = new Map(Object.entries(initialStorage));
  const apiCalls = [];
  const printedReceipts = [];

  const elements = new Map();
  function getEl(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        value: '',
        textContent: '',
        innerHTML: '',
        disabled: false,
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {},
        focus() {},
        select() {}
      });
    }
    return elements.get(id);
  }

  let selectedPayMethod = 'CASH';

  const sandbox = {
    console,
    Math,
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    parseFloat,
    parseInt,
    isNaN,
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    CONFIG: {
      DEFAULT_BRANCH_ID: 'B01',
      DEFAULT_STATION_ID: 'POS-01',
      STORAGE_KEYS: {
        BRANCH_ID: 'pos_active_branch_id',
        STATION_ID: 'pos_station_id',
        BILLS: 'pos_draft_bills'
      }
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    document: {
      getElementById: (id) => getEl(id),
      querySelector: (sel) => {
        if (sel === 'input[name="payMethodOption"]:checked') {
          return { value: selectedPayMethod };
        }
        return null;
      },
      addEventListener: () => {}
    },
    UI: {
      showLoading: () => {},
      hideLoading: () => {},
      showToast: () => {},
      openModal: () => {},
      closeModal: () => {}
    },
    SoundManager: {
      playScannerBeep: () => {},
      playSuccessChime: () => {},
      playErrorTone: () => {},
      announceOutOfStock: () => {},
      announceTotal: () => {},
      announceChange: () => {}
    },
    PrintManager: {
      activeProfile: { profileId: 'P_58MM_DEFAULT', autoPrint: true },
      init: () => {},
      printReceiptDirect: (sale, items, storeInfo, prof) => {
        printedReceipts.push({ sale, items, storeInfo, prof });
      },
      previewReceiptModal: (sale, items, storeInfo, prof) => {
        printedReceipts.push({ sale, items, storeInfo, prof, preview: true });
      }
    },
    Api: {
      call: async (action, payload) => {
        apiCalls.push({ action, payload: JSON.parse(JSON.stringify(payload || {})) });
        if (action === 'sales:checkout') {
          const total = payload.items.reduce((s, i) => s + i.amount, 0) - (payload.discount || 0);
          return {
            ok: true,
            receiptNo: 'RC-NEW-' + apiCalls.length,
            sale: {
              receiptNo: 'RC-NEW-' + apiCalls.length,
              total,
              subtotal: total + (payload.discount || 0),
              discount: payload.discount || 0,
              received: payload.payMethod === 'CASH' ? payload.received : total,
              change: payload.payMethod === 'CASH' ? Math.max(0, payload.received - total) : 0,
              payMethod: payload.payMethod,
              status: 'PAID'
            },
            items: payload.items,
            store: { storeName: 'ร้าน ศศิธร อะไหล่ แอร์', branchName: 'สาขาหลัก' }
          };
        }
        return { ok: true, products: [] };
      }
    }
  };

  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'modules', 'sales.js'), 'utf8');
  vm.runInContext(code + '\n;this.SalesModule = SalesModule;', sandbox, { filename: 'sales.js' });

  return {
    SalesModule: sandbox.SalesModule,
    store,
    apiCalls,
    printedReceipts,
    getEl,
    setPayMethod: (m) => { selectedPayMethod = m; }
  };
}

test('SalesModule: legacy localStorage draft bill without txnSchema:2 rotates stale clientTxnId immediately', () => {
  const staleBills = JSON.stringify([
    {
      id: 'bill_old',
      title: 'บิลที่ 1',
      items: [{ sku: 'P1001', name: 'น้ำ', qty: 1, unitPrice: 10, discount: 0, amount: 10 }],
      discount: 0,
      note: '',
      clientTxnId: 'TXN_mvrqahca9ith7e' // ค่าค้างตัวเดียวกับที่ทำให้เกิดบั๊กจริง
    }
  ]);

  const { SalesModule, store } = createSalesSandbox({ pos_draft_bills: staleBills });
  SalesModule.loadDraftBills();

  const active = SalesModule.getActiveBill();
  assert.notStrictEqual(active.clientTxnId, 'TXN_mvrqahca9ith7e', 'ต้องเปลี่ยน clientTxnId ค้างจากเวอร์ชันเก่าทันที');
  assert.strictEqual(active.txnSchema, 2);

  const persisted = JSON.parse(store.get('pos_draft_bills'));
  assert.strictEqual(persisted[0].clientTxnId, active.clientTxnId);
  assert.strictEqual(persisted[0].txnSchema, 2);
});

test('SalesModule: two consecutive single-tab checkouts (65 CASH -> 120 TRANSFER) use distinct clientTxnIds and print exact amounts', async () => {
  const { SalesModule, apiCalls, printedReceipts, getEl, setPayMethod } = createSalesSandbox();
  SalesModule.products = [
    { sku: 'P1001', name: 'น้ำดื่ม', salePrice: 10, costPrice: 6, stockQty: 100 },
    { sku: 'P1004', name: 'ข้าวผัด', salePrice: 55, costPrice: 35, stockQty: 50 },
    { sku: 'P2001', name: 'อะไหล่แอร์', salePrice: 120, costPrice: 80, stockQty: 20 }
  ];
  SalesModule.loadDraftBills();

  // บิลที่ 1: 10 + 55 = 65 บาท เงินสด รับ 100
  SalesModule.addItemToCart(SalesModule.products[0]);
  SalesModule.addItemToCart(SalesModule.products[1]);
  setPayMethod('CASH');
  SalesModule.openPaymentModal();
  getEl('payReceivedInput').value = '100';
  await SalesModule.confirmPayment();

  // บิลที่ 2 (แท็บเดิมหลัง closeBill!): 120 บาท โอน/QR
  SalesModule.addItemToCart(SalesModule.products[2]);
  setPayMethod('TRANSFER');
  SalesModule.openPaymentModal();
  assert.strictEqual(String(getEl('payReceivedInput').value), '120');
  await SalesModule.confirmPayment();

  const checkouts = apiCalls.filter(c => c.action === 'sales:checkout');
  assert.strictEqual(checkouts.length, 2);
  assert.notStrictEqual(
    checkouts[0].payload.clientTxnId,
    checkouts[1].payload.clientTxnId,
    'ห้ามส่ง clientTxnId ซ้ำกันระหว่างบิลที่ 1 กับบิลที่ 2 เด็ดขาด'
  );

  assert.strictEqual(printedReceipts.length, 2);
  assert.strictEqual(printedReceipts[0].sale.total, 65);
  assert.strictEqual(printedReceipts[1].sale.total, 120);
  assert.strictEqual(printedReceipts[1].sale.payMethod, 'TRANSFER');
  assert.strictEqual(printedReceipts[1].storeInfo.storeName, 'ร้าน ศศิธร อะไหล่ แอร์');
});
