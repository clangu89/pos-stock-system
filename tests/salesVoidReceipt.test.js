const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createGasMockContext } = require('./backend.mock.test.js');

test('Sales Void Modal Upgrade: getTodaySalesForVoid & sales:todayReceipts route', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const cashier = sandbox.loginUser('cashier', 'Cashier1234!');
  const admin = sandbox.loginUser('admin', 'Admin1234!');

  // Checkout 2 sales on today's date
  const p1 = sandbox.getTable('Products').rows.find(p => p.sku === 'P1001');
  const sale1 = sandbox.checkoutSale({
    branchId: 'B01',
    payMethod: 'CASH',
    received: 100,
    subtotal: 100,
    discount: 0,
    vat: 0,
    total: 100,
    change: 0,
    items: [{ sku: 'P1001', name: p1.name, unitPrice: 10, qty: 10, discount: 0, amount: 100 }]
  }, cashier.user);

  const sale2 = sandbox.checkoutSale({
    branchId: 'B01',
    payMethod: 'TRANSFER',
    received: 50,
    subtotal: 50,
    discount: 0,
    vat: 0,
    total: 50,
    change: 0,
    items: [{ sku: 'P1001', name: p1.name, unitPrice: 10, qty: 5, discount: 0, amount: 50 }]
  }, cashier.user);

  // 1. Direct function call getTodaySalesForVoid
  const todayReceipts = sandbox.getTodaySalesForVoid('B01');
  assert.ok(Array.isArray(todayReceipts));
  assert.strictEqual(todayReceipts.length, 2);
  // Sorted newest first
  assert.strictEqual(todayReceipts[0].receiptNo, sale2.receiptNo);
  assert.strictEqual(todayReceipts[1].receiptNo, sale1.receiptNo);
  assert.strictEqual(todayReceipts[0].total, 50);
  assert.strictEqual(todayReceipts[1].total, 100);
  assert.strictEqual(todayReceipts[0].status, 'PAID');

  // 2. Route action sales:todayReceipts with Cashier auth (Cashier has sales.view: true)
  const routeRes = sandbox.routeAction('sales:todayReceipts', cashier.token, {
    branchId: 'B01'
  }, {});

  assert.strictEqual(routeRes.ok, true);
  assert.ok(Array.isArray(routeRes.receipts));
  assert.strictEqual(routeRes.receipts.length, 2);
  assert.strictEqual(routeRes.receipts[0].receiptNo, sale2.receiptNo);

  // 3. Void sale 1 and verify status updates in today's receipts
  const voidRes = sandbox.voidReceipt(sale1.receiptNo, 'ลูกค้าเปลี่ยนใจ', admin.user);
  assert.strictEqual(voidRes.ok, true);

  const updatedReceipts = sandbox.getTodaySalesForVoid('B01');
  const v1 = updatedReceipts.find(r => r.receiptNo === sale1.receiptNo);
  assert.strictEqual(v1.status, 'VOID');
  assert.strictEqual(v1.voidReason, 'ลูกค้าเปลี่ยนใจ');
});

test('Sales Void Modal Upgrade: Frontend DOM Structure & Quick Reasons', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');

  // 1. Modal container & 2-column layout
  assert.ok(indexHtml.includes('id="voidReceiptModal"'));
  assert.ok(indexHtml.includes('id="voidTodayReceiptsList"'));
  assert.ok(indexHtml.includes('id="voidReceiptsCountBadge"'));
  assert.ok(indexHtml.includes('id="voidSearchReceiptNo"'));
  assert.ok(indexHtml.includes('id="voidFilterBtn_ALL"'));
  assert.ok(indexHtml.includes('id="voidFilterBtn_PAID"'));
  assert.ok(indexHtml.includes('id="voidFilterBtn_VOID"'));

  // 2. Detail preview elements
  assert.ok(indexHtml.includes('id="voidReceiptDetailContainer"'));
  assert.ok(indexHtml.includes('id="voidSelectedStatusBadge"'));
  assert.ok(indexHtml.includes('id="voidReasonInput"'));
  assert.ok(indexHtml.includes('id="voidConfirmBtn"'));

  // 3. Quick cancellation reason chips
  assert.ok(indexHtml.includes("SalesModule.setQuickVoidReason('ลูกค้าเปลี่ยนใจ')"));
  assert.ok(indexHtml.includes("SalesModule.setQuickVoidReason('สแกนสินค้าผิดชิ้น')"));
  assert.ok(indexHtml.includes("SalesModule.setQuickVoidReason('คิดเงินผิดจำนวน')"));
  assert.ok(indexHtml.includes("SalesModule.setQuickVoidReason('ลูกค้ายกเลิกออเดอร์')"));
});

test('Sales Void Modal Upgrade: sales.js Module Methods & Logic', () => {
  const salesJs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'modules', 'sales.js'), 'utf8');

  // Method existence
  assert.ok(salesJs.includes('openVoidModal('));
  assert.ok(salesJs.includes('loadTodayReceiptsForVoid('));
  assert.ok(salesJs.includes('setVoidFilter('));
  assert.ok(salesJs.includes('updateVoidFilterTabsUI('));
  assert.ok(salesJs.includes('filterTodayVoidReceipts('));
  assert.ok(salesJs.includes('renderTodayVoidReceiptsList('));
  assert.ok(salesJs.includes('selectReceiptForVoid('));
  assert.ok(salesJs.includes('searchReceiptForVoid('));
  assert.ok(salesJs.includes('setQuickVoidReason('));
  assert.ok(salesJs.includes('confirmVoidReceipt('));

  // Properties
  assert.ok(salesJs.includes('todayVoidReceipts: []'));
  assert.ok(salesJs.includes("activeVoidFilter: 'ALL'"));
  assert.ok(salesJs.includes('selectedVoidReceiptNo: null'));
});
