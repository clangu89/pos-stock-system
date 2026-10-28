const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadPrintManager() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'print.js'), 'utf8');
  const sandbox = {
    console,
    CONFIG: { STORAGE_KEYS: { PRINTER_PROFILE_ID: 'pos_printer_profile_id' } },
    localStorage: { getItem: () => null, setItem: () => {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(code + '\n;this.PrintManager = PrintManager;', sandbox, { filename: 'print.js' });
  return sandbox.PrintManager;
}

const baseSale = {
  receiptNo: 'RCMAIN-20261028-00002',
  ts: '2026-10-28T06:53:18.130Z',
  branchId: 'B01',
  cashierName: 'admin',
  subtotal: 65, discount: 0, vat: 0, total: 65, received: 100, change: 35,
  payMethod: 'CASH', status: 'PAID'
};
const baseItems = [
  { sku: 'P1001', name: 'น้ำดื่ม', qty: 1, unitPrice: 10, discount: 0, amount: 10 },
  { sku: 'P1004', name: 'ข้าวผัด', qty: 1, unitPrice: 55, discount: 0, amount: 55 }
];
const baseStore = {
  receiptTitle: 'ใบเสร็จรับเงิน', storeName: 'ร้านทดสอบ', subHeader: 'ยินดีต้อนรับ',
  address: 'กทม.', phone: '0812345678', taxId: '0105500000000', footer: 'ขอบคุณครับ',
  branchId: 'B01', branchCode: 'MAIN', branchName: 'สาขาหลัก',
  showAddress: true, showPhone: true, showTaxId: true, showCashier: true, showBranch: true
};

test('Print: item with amount 0 prints 0.00 (not full price)', () => {
  const PM = loadPrintManager();
  const items = [{ sku: 'FREE', name: 'ของแถม', qty: 1, unitPrice: 10, discount: 10, amount: 0 }];
  const html = PM.buildReceiptHtml({ ...baseSale, subtotal: 0, total: 0 }, items, baseStore);
  assert.ok(html.includes('>0.00</td>'), 'ยอดรายการต้องเป็น 0.00');
  assert.ok(!html.includes('>10.00</td>'), 'ห้ามพิมพ์ราคาเต็มเป็นยอดรายการ');
});

test('Print: shows branch name/code instead of raw branch id', () => {
  const PM = loadPrintManager();
  const html = PM.buildReceiptHtml(baseSale, baseItems, baseStore);
  assert.ok(html.includes('สาขา: สาขาหลัก (MAIN)'));
  assert.ok(!html.includes('สาขา: B01'));
});

test('Print: blank footer / subHeader / title are not replaced by defaults', () => {
  const PM = loadPrintManager();
  const html = PM.buildReceiptHtml(baseSale, baseItems, { ...baseStore, footer: '', subHeader: '', receiptTitle: '' });
  assert.ok(!html.includes('Thank you'), 'ท้ายใบเสร็จที่ว่างต้องไม่แสดงข้อความเริ่มต้น');
  assert.ok(!html.includes('ใบกำกับภาษีอย่างย่อ'), 'ชื่อเอกสารที่ว่างต้องไม่แสดงข้อความเริ่มต้น');
  assert.ok(!html.includes('ยินดีต้อนรับ'));
});

test('Print: falls back to defaults only when the fields are missing entirely', () => {
  const PM = loadPrintManager();
  const html = PM.buildReceiptHtml(baseSale, baseItems, { storeName: 'ร้าน' });
  assert.ok(html.includes('Thank you'));
  assert.ok(html.includes('ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ'));
});

test('Print: show/hide switches and tax id keep leading zero', () => {
  const PM = loadPrintManager();
  const shown = PM.buildReceiptHtml(baseSale, baseItems, baseStore);
  assert.ok(shown.includes('เลขผู้เสียภาษี: 0105500000000'));
  assert.ok(shown.includes('โทร: 0812345678'));
  assert.ok(shown.includes('แคชเชียร์: admin'));

  const hidden = PM.buildReceiptHtml(baseSale, baseItems, {
    ...baseStore, showAddress: false, showPhone: 'false', showTaxId: false, showCashier: false, showBranch: false
  });
  assert.ok(!hidden.includes('เลขผู้เสียภาษี'));
  assert.ok(!hidden.includes('โทร:'));
  assert.ok(!hidden.includes('แคชเชียร์'));
  assert.ok(!hidden.includes('สาขา:'));
  assert.ok(!hidden.includes('กทม.'));
});

test('Print: totals shown on receipt equal sale record values', () => {
  const PM = loadPrintManager();
  const html = PM.buildReceiptHtml(baseSale, baseItems, baseStore);
  assert.ok(html.includes('65.00 บาท'));
  assert.ok(html.includes('35.00 บาท'));
  assert.ok(html.includes('100.00'));
});