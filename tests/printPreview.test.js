const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('PrintPreview: index.html has correct modal z-index hierarchy', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');

  // 1. receiptPreviewModal must be z-[70] (higher than z-50 detail modal)
  assert.ok(
    indexHtml.includes('id="receiptPreviewModal" class="hidden fixed inset-0 z-[70]'),
    'receiptPreviewModal must have z-[70]'
  );

  // 2. receiptDetailModal must be z-50
  assert.ok(
    indexHtml.includes('id="receiptDetailModal" class="hidden fixed inset-0 z-50'),
    'receiptDetailModal must have z-50'
  );

  // 3. globalLoadingOverlay must be z-[80]
  assert.ok(
    indexHtml.includes('id="globalLoadingOverlay" class="hidden fixed inset-0 z-[80]'),
    'globalLoadingOverlay must have z-[80]'
  );

  // 4. toastContainer must be z-[100]
  assert.ok(
    indexHtml.includes('id="toastContainer" class="fixed top-5 right-5 z-[100]'),
    'toastContainer must have z-[100]'
  );
});

test('PrintPreview: PrintManager.previewReceiptModal opens modal before rendering iframe', () => {
  const printJs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'print.js'), 'utf8');

  const modalOpened = [];
  const containerHtml = { innerHTML: '', appendChild: (node) => {} };

  const sandbox = {
    console, Math, Date, String, parseFloat, isNaN,
    CONFIG: { STORAGE_KEYS: { PRINTER_PROFILE_ID: 'pos_printer_profile_id' } },
    localStorage: { getItem: () => null, setItem: () => {} },
    UI: {
      openModal: (id) => modalOpened.push(id)
    },
    document: {
      getElementById: (id) => {
        if (id === 'receiptPreviewModalContent') return containerHtml;
        return null;
      },
      createElement: (tag) => ({
        setAttribute: () => {},
        style: {}
      })
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(printJs + '; this.PrintManager = PrintManager;', sandbox);

  const sale = { receiptNo: 'RC-001', total: 100, status: 'PAID' };
  sandbox.PrintManager.previewReceiptModal(sale, [], {});

  assert.strictEqual(modalOpened.length, 1);
  assert.strictEqual(modalOpened[0], 'receiptPreviewModal', 'Must open receiptPreviewModal');
});

test('PrintPreview: ReportsModule.reprintActiveDetailReceipt closes detail modal and calls previewReceiptModal', () => {
  const reportsJs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'modules', 'reports.js'), 'utf8');

  const closedModals = [];
  let previewCalledWith = null;

  const sandbox = {
    console, Math, Date, String, parseFloat, isNaN,
    escapeHtml: (s) => s,
    UI: {
      closeModal: (id) => closedModals.push(id),
      showToast: () => {}
    },
    PrintManager: {
      previewReceiptModal: (sale, items, store) => {
        previewCalledWith = { sale, items, store };
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(reportsJs + '; this.ReportsModule = ReportsModule;', sandbox);

  // Set active receipt
  sandbox.ReportsModule.activeDetailReceipt = {
    sale: { receiptNo: 'RCMAIN-20261028-00005', total: 120 },
    items: [{ sku: 'P1001', name: 'น้ำดื่ม', qty: 1 }],
    store: { storeName: 'ร้านทดสอบ' }
  };

  sandbox.ReportsModule.reprintActiveDetailReceipt();

  // Must close receiptDetailModal
  assert.ok(closedModals.includes('receiptDetailModal'), 'Must close receiptDetailModal');

  // Must call previewReceiptModal
  assert.ok(previewCalledWith, 'Must call PrintManager.previewReceiptModal');
  assert.strictEqual(previewCalledWith.sale.receiptNo, 'RCMAIN-20261028-00005');
  assert.strictEqual(previewCalledWith.items.length, 1);
});
