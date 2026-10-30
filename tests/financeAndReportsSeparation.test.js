const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createGasMockContext } = require('./backend.mock.test.js');

test('Finance & Reports Separation: Backend Role Permissions & Normalization', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();

  // 1. Check default seeded permissions
  const roles = sandbox.getTable('Roles').rows;
  const adminRole = roles.find(r => r.roleId === 'admin');
  const mgrRole = roles.find(r => r.roleId === 'manager');
  const cashierRole = roles.find(r => r.roleId === 'cashier');
  const stockRole = roles.find(r => r.roleId === 'stock_keeper');

  assert.ok(adminRole, 'Admin role must exist');
  assert.ok(mgrRole, 'Manager role must exist');
  assert.ok(cashierRole, 'Cashier role must exist');
  assert.ok(stockRole, 'Stock keeper role must exist');

  const adminPerms = JSON.parse(adminRole.permissions);
  assert.strictEqual(adminPerms.finance.view, true);
  assert.strictEqual(adminPerms.finance.create, true);
  assert.strictEqual(adminPerms.finance.close, true);
  assert.strictEqual(adminPerms.finance.void, true);
  assert.strictEqual(adminPerms.reports.view, true);

  const mgrPerms = JSON.parse(mgrRole.permissions);
  assert.strictEqual(mgrPerms.finance.view, true);
  assert.strictEqual(mgrPerms.finance.create, true);
  assert.strictEqual(mgrPerms.finance.close, true);
  assert.strictEqual(mgrPerms.finance.void, true);

  const cashierPerms = JSON.parse(cashierRole.permissions);
  assert.strictEqual(cashierPerms.finance.view, false);
  assert.strictEqual(cashierPerms.finance.create, false);
  assert.strictEqual(cashierPerms.finance.close, false);
  assert.strictEqual(cashierPerms.finance.void, false);

  // 2. Normalization test on legacy role without finance key
  const legacyPerms = {
    sales: { view: true, checkout: true },
    reports: { view: true, export: false }
  };
  const normalizedAdmin = sandbox.normalizeRolePermissions_('admin', legacyPerms);
  assert.strictEqual(normalizedAdmin.finance.view, true);
  assert.strictEqual(normalizedAdmin.finance.create, true);

  const normalizedCashier = sandbox.normalizeRolePermissions_('cashier', legacyPerms);
  assert.strictEqual(normalizedCashier.finance.view, false);
  assert.strictEqual(normalizedCashier.finance.create, false);
});

test('Finance & Reports Separation: Role Guarding via API Router (Code.gs)', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();

  const cashierLogin = sandbox.loginUser('cashier', 'Cashier1234!');
  assert.strictEqual(cashierLogin.ok, true);

  const adminLogin = sandbox.loginUser('admin', 'Admin1234!');
  assert.strictEqual(adminLogin.ok, true);

  // Cashier should throw FORBIDDEN from finance actions
  assert.throws(
    () => sandbox.routeAction('finance:overview', cashierLogin.token, {}, {}),
    /FORBIDDEN/
  );

  assert.throws(
    () => sandbox.routeAction('finance:createTxn', cashierLogin.token, {
      type: 'EXPENSE',
      amount: 100,
      category: 'ทดสอบ'
    }, {}),
    /FORBIDDEN/
  );

  assert.throws(
    () => sandbox.routeAction('finance:saveClosing', cashierLogin.token, {
      closeDate: '2026-10-30',
      actualCash: 500
    }, {}),
    /FORBIDDEN/
  );

  // Admin should be allowed
  const allowedOverview = sandbox.routeAction('finance:overview', adminLogin.token, {}, {});
  assert.strictEqual(allowedOverview.ok, true);
});

test('Finance & Reports Separation: Petty Cash Ledger CRUD & Voiding', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const adminLogin = sandbox.loginUser('admin', 'Admin1234!');

  // 1. Create Expense
  const createExpRes = sandbox.createFinanceTxn({
    type: 'EXPENSE',
    txDate: '2026-10-30',
    branchId: 'B01',
    category: 'ค่าน้ำมันรถส่งของ',
    amount: 350.50,
    payMethod: 'CASH',
    refDoc: 'PETROL-99',
    description: 'เติมน้ำมันส่งของให้ลูกค้า'
  }, adminLogin.user);

  assert.strictEqual(createExpRes.ok, true);
  assert.ok(createExpRes.txn.txnId.startsWith('EXP-20261030-'));

  // 2. Create Other Income
  const createIncRes = sandbox.createFinanceTxn({
    type: 'INCOME',
    txDate: '2026-10-30',
    branchId: 'B01',
    category: 'ค่าบริการจัดส่ง',
    amount: 150.00,
    payMethod: 'TRANSFER',
    refDoc: 'DELIV-01',
    description: 'ค่าจัดส่งด่วนพิเศษ'
  }, adminLogin.user);

  assert.strictEqual(createIncRes.ok, true);
  assert.ok(createIncRes.txn.txnId.startsWith('INC-20261030-'));

  // 3. Query Txns
  const listRes = sandbox.getFinanceTxns({ branchId: 'B01', txDate: '2026-10-30' });
  assert.strictEqual(listRes.txns.length, 2);
  assert.strictEqual(listRes.summary.totalExpense, 350.50);
  assert.strictEqual(listRes.summary.totalIncome, 150.00);

  // 4. Void an Expense
  const voidRes = sandbox.voidFinanceTxn({ txnId: createExpRes.txn.txnId, reason: 'กรอกยอดผิดพลาด' }, adminLogin.user);
  assert.strictEqual(voidRes.ok, true);

  // Query again after void
  const listAfterVoid = sandbox.getFinanceTxns({ branchId: 'B01', txDate: '2026-10-30' });
  assert.strictEqual(listAfterVoid.summary.totalExpense, 0); // voided expense no longer counted in summary
  assert.strictEqual(listAfterVoid.summary.totalIncome, 150.00);

  const voidedTxn = listAfterVoid.txns.find(t => t.txnId === createExpRes.txn.txnId);
  assert.strictEqual(voidedTxn.status, 'VOID');
  assert.strictEqual(voidedTxn.voidReason, 'กรอกยอดผิดพลาด');
});

test('Finance & Reports Separation: Cash Drawer Closing, Variance & Roll-over', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const adminLogin = sandbox.loginUser('admin', 'Admin1234!');

  const p1 = sandbox.getTable('Products').rows.find(p => p.sku === 'P1001'); // Singha water 10 THB
  assert.ok(p1, 'P1001 should exist');

  // Checkout 2 sales on 2026-10-30:
  // Sale 1: CASH 100 THB
  // Sale 2: TRANSFER 200 THB
  const sale1 = sandbox.checkoutSale({
    branchId: 'B01',
    ts: '2026-10-30T10:00:00.000Z',
    payMethod: 'CASH',
    received: 100,
    subtotal: 100,
    discount: 0,
    vat: 0,
    total: 100,
    change: 0,
    items: [{ sku: 'P1001', name: p1.name, unitPrice: 10, qty: 10, discount: 0, amount: 100 }]
  }, adminLogin.user);
  assert.strictEqual(sale1.ok, true);

  const sale2 = sandbox.checkoutSale({
    branchId: 'B01',
    ts: '2026-10-30T10:05:00.000Z',
    payMethod: 'TRANSFER',
    received: 200,
    subtotal: 200,
    discount: 0,
    vat: 0,
    total: 200,
    change: 0,
    items: [{ sku: 'P1001', name: p1.name, unitPrice: 10, qty: 20, discount: 0, amount: 200 }]
  }, adminLogin.user);
  assert.strictEqual(sale2.ok, true);

  // Add 1 petty cash expense: CASH 20 THB
  sandbox.createFinanceTxn({
    type: 'EXPENSE',
    txDate: '2026-10-30',
    branchId: 'B01',
    category: 'ซื้อน้ำแข็ง',
    amount: 20.00,
    payMethod: 'CASH',
    description: 'น้ำแข็งหลอด'
  }, adminLogin.user);

  // Check Closing Preview for 2026-10-30
  // Initial default float = 1000 THB
  // Expected Cash = float(1000) + cashSales(100) + cashIncome(0) - cashExpense(20) = 1080 THB
  const preview = sandbox.getCashClosingPreview('2026-10-30', 'B01');
  assert.strictEqual(preview.ok, true);
  assert.strictEqual(preview.openingFloat, 1000);
  assert.strictEqual(preview.cashSales, 100);
  assert.strictEqual(preview.transferSales, 200);
  assert.strictEqual(preview.cashExpense, 20);
  assert.strictEqual(preview.expectedCash, 1080);

  // Save Cash Closing:
  // Counted actual cash = 1080 THB (variance = 0)
  // Cash Drop = 80 THB
  // Carry Forward = 1000 THB
  const saveCloseRes = sandbox.saveCashClosing({
    closeDate: '2026-10-30',
    branchId: 'B01',
    openingFloat: 1000,
    cashSales: 100,
    transferSales: 200,
    qrSales: 0,
    cashIncome: 0,
    cashExpense: 20,
    expectedCash: 1080,
    actualCash: 1080,
    variance: 0,
    cashDrop: 80,
    carryForward: 1000,
    denomBreakdown: { 1000: 1, 50: 1, 20: 1, 10: 1 },
    note: 'ส่งเงินสด 80 บาท เหลือเงินทอน 1000 บาท'
  }, adminLogin.user);

  assert.strictEqual(saveCloseRes.ok, true);
  assert.ok(saveCloseRes.closing.closingId.startsWith('CLS-B01-20261030-'));

  // Test Roll-over to next day: 2026-10-31
  // Next day preview should automatically receive carryForward (1000 THB) as openingFloat!
  const nextDayPreview = sandbox.getCashClosingPreview('2026-10-31', 'B01');
  assert.strictEqual(nextDayPreview.ok, true);
  assert.strictEqual(nextDayPreview.openingFloat, 1000, 'Opening float on next day should equal previous carryForward (1000 THB)');
});

test('Finance & Reports Separation: Reports Module Preserves Receipt History & Reprint', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const adminLogin = sandbox.loginUser('admin', 'Admin1234!');

  // Checkout a sale
  const p1 = sandbox.getTable('Products').rows.find(p => p.sku === 'P1001');
  const saleRes = sandbox.checkoutSale({
    branchId: 'B01',
    payMethod: 'CASH',
    received: 50,
    subtotal: 50,
    discount: 0,
    vat: 0,
    total: 50,
    change: 0,
    items: [{ sku: 'P1001', name: p1.name, unitPrice: 10, qty: 5, discount: 0, amount: 50 }]
  }, adminLogin.user);
  assert.strictEqual(saleRes.ok, true);

  // 1. Check reports:receipts
  const receiptsRes = sandbox.getReceiptsList({ branchId: 'B01', limit: 10 });
  assert.ok(receiptsRes.receipts.length >= 1);
  const found = receiptsRes.receipts.find(r => r.receiptNo === saleRes.receiptNo);
  assert.ok(found, 'Receipt should be queryable in reports:receipts');

  // 2. Check sales:receipt for reprint details via routeAction
  const receiptDetailRes = sandbox.routeAction('sales:receipt', adminLogin.token, { receiptNo: saleRes.receiptNo }, {});
  assert.strictEqual(receiptDetailRes.ok, true);
  assert.ok(receiptDetailRes.receipt.sale);
  assert.ok(receiptDetailRes.receipt.items);
  assert.strictEqual(receiptDetailRes.receipt.items.length, 1);
  assert.strictEqual(receiptDetailRes.receipt.sale.total, 50);
});

test('Finance & Reports Separation: Frontend UI Integrity & 5 Launcher Cards', () => {
  const frontendDir = path.join(__dirname, '..', 'frontend');
  const indexHtml = fs.readFileSync(path.join(frontendDir, 'index.html'), 'utf8');

  // 1. Launcher cards layout
  assert.ok(indexHtml.includes('id="launcherCardsContainer"'), 'Launcher cards container must exist');
  assert.ok(indexHtml.includes('grid-cols-1 md:grid-cols-2 lg:grid-cols-3'), 'Responsive grid for 5 cards');

  // 2. launcher.js has 5 core modules
  const launcherJs = fs.readFileSync(path.join(frontendDir, 'js', 'modules', 'launcher.js'), 'utf8');
  assert.ok(launcherJs.includes("id: 'sales'"));
  assert.ok(launcherJs.includes("id: 'stock'"));
  assert.ok(launcherJs.includes("id: 'reports'"));
  assert.ok(launcherJs.includes("id: 'finance'"));
  assert.ok(launcherJs.includes("id: 'admin'"));

  // 3. Reports screen in index.html has 3 distinct tabs
  assert.ok(indexHtml.includes('id="reportsTabBtn_overview"'));
  assert.ok(indexHtml.includes('id="reportsTabBtn_stock"'));
  assert.ok(indexHtml.includes('id="reportsTabBtn_receipts"'));
  assert.ok(indexHtml.includes('id="reportsTab_overview"'));
  assert.ok(indexHtml.includes('id="reportsTab_stock"'));
  assert.ok(indexHtml.includes('id="reportsTab_receipts"'));

  // 4. Finance screen in index.html has 3 distinct tabs
  assert.ok(indexHtml.includes('id="view_finance"'));
  assert.ok(indexHtml.includes('id="financeTabBtn_summary"'));
  assert.ok(indexHtml.includes('id="financeTabBtn_ledger"'));
  assert.ok(indexHtml.includes('id="financeTabBtn_closing"'));
  assert.ok(indexHtml.includes('id="financeTab_summary"'));
  assert.ok(indexHtml.includes('id="financeTab_ledger"'));
  assert.ok(indexHtml.includes('id="financeTab_closing"'));
  assert.ok(indexHtml.includes('id="financeTab_settings"'));
  assert.ok(indexHtml.includes('id="financeTabBtn_settings"'));
  assert.ok(indexHtml.includes('id="financeModalCategoryChips"'));
  assert.ok(indexHtml.includes('id="closingDuplicateWarningBanner"'));
  assert.ok(indexHtml.includes('id="closeEditFloatBtn"'));

  // 5. Modals exist
  assert.ok(indexHtml.includes('id="financeTxnModal"'));
  assert.ok(indexHtml.includes('id="cashClosingDetailModal"'));

  // 6. Scripts import finance.js and router has finance route
  assert.ok(indexHtml.includes('src="js/modules/finance.js?v=20261030-v19"'));
  const routerJs = fs.readFileSync(path.join(frontendDir, 'js', 'router.js'), 'utf8');
  assert.ok(routerJs.includes("hash === 'finance' && !Auth.hasPerm('finance', 'view')"));
  assert.ok(routerJs.includes("FinanceModule.activate()"));

  // 7. Admin roles matrix includes finance column
  const adminJs = fs.readFileSync(path.join(frontendDir, 'js', 'modules', 'admin.js'), 'utf8');
  assert.ok(adminJs.includes("Finance"));
  assert.ok(adminJs.includes("finance?.view"));
  assert.ok(adminJs.includes("finance_view"));
  assert.ok(adminJs.includes("finance: {"));
});

test('Finance & Reports Separation: Cash Closing Preview & Closings API compatibility (res.data wrapping)', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const adminLogin = sandbox.loginUser('admin', 'Admin1234!');

  // Checkout 1 CASH sale
  const p1 = sandbox.getTable('Products').rows.find(p => p.sku === 'P1001');
  sandbox.checkoutSale({
    branchId: 'B01',
    ts: '2026-10-30T11:00:00.000Z',
    payMethod: 'CASH',
    received: 100,
    subtotal: 100,
    discount: 0,
    vat: 0,
    total: 100,
    change: 0,
    items: [{ sku: 'P1001', name: p1.name, unitPrice: 10, qty: 10, discount: 0, amount: 100 }]
  }, adminLogin.user);

  // Test 1: finance:closingPreview returns both res.data and root properties
  const previewRes = sandbox.routeAction('finance:closingPreview', adminLogin.token, {
    closeDate: '2026-10-30',
    branchId: 'B01'
  }, {});

  assert.strictEqual(previewRes.ok, true);
  assert.ok(previewRes.data, 'previewRes must contain data property');
  assert.strictEqual(previewRes.data.cashSales, 100);
  assert.strictEqual(previewRes.cashSales, 100, 'previewRes must also contain cashSales at root for backward compatibility');
  assert.strictEqual(previewRes.data.expectedCash, 1100); // 1000 float + 100 cash

  // Test 2: finance:saveClosing returns res.data, res.closingId, and root properties
  const saveRes = sandbox.routeAction('finance:saveClosing', adminLogin.token, {
    closeDate: '2026-10-30',
    branchId: 'B01',
    openingFloat: 1000,
    cashSales: 100,
    transferSales: 0,
    qrSales: 0,
    cashIncome: 0,
    cashExpense: 0,
    expectedCash: 1100,
    actualCash: 1100,
    variance: 0,
    cashDrop: 100,
    carryForward: 1000,
    denomBreakdown: { 1000: 1, 100: 1 },
    note: 'ทดสอบปิดยอดประจำวัน'
  }, {});

  assert.strictEqual(saveRes.ok, true);
  assert.ok(saveRes.closingId, 'saveRes must contain closingId at root');
  assert.ok(saveRes.closingId.startsWith('CLS-B01-20261030-'));
  assert.ok(saveRes.data, 'saveRes must contain data property');

  // Test 3: finance:closings returns both res.data.closings and res.closings
  const historyRes = sandbox.routeAction('finance:closings', adminLogin.token, {
    branchId: 'B01',
    limit: 10
  }, {});

  assert.strictEqual(historyRes.ok, true);
  assert.ok(historyRes.data, 'historyRes must contain data property');
  assert.ok(Array.isArray(historyRes.data.closings), 'historyRes.data.closings must be an array');
  assert.ok(Array.isArray(historyRes.closings), 'historyRes.closings must be an array at root');
  assert.strictEqual(historyRes.data.closings.length, 1);
  assert.strictEqual(historyRes.data.closings[0].closingId, saveRes.closingId);
});

test('Finance & Reports Separation: POS Checkout of 46.00 THB reflects accurately in Finance Overview', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const adminLogin = sandbox.loginUser('admin', 'Admin1234!');

  // Checkout exact sale matching user scenario: 46.00 THB CASH
  const p1 = sandbox.getTable('Products').rows.find(p => p.sku === 'P1001'); // 10 THB
  const p2 = sandbox.getTable('Products').rows.find(p => p.sku === 'P1002'); // 16 THB

  const checkoutRes = sandbox.checkoutSale({
    branchId: 'B01',
    payMethod: 'CASH',
    received: 50,
    subtotal: 46,
    discount: 0,
    vat: 0,
    total: 46,
    change: 4,
    items: [
      { sku: 'P1001', name: p1.name, unitPrice: 10, qty: 3, discount: 0, amount: 30 },
      { sku: 'P1002', name: p2.name, unitPrice: 16, qty: 1, discount: 0, amount: 16 }
    ]
  }, adminLogin.user);

  assert.strictEqual(checkoutRes.ok, true);
  assert.strictEqual(checkoutRes.sale.total, 46);
  assert.strictEqual(checkoutRes.sale.payMethod, 'CASH');

  // Query finance:overview API
  const overviewRes = sandbox.routeAction('finance:overview', adminLogin.token, {
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    branchId: 'B01'
  }, {});

  assert.strictEqual(overviewRes.ok, true);
  const data = overviewRes.data;
  assert.ok(data, 'overviewRes must include data property');
  assert.ok(data.summary, 'data must include a top-level summary object');
  assert.strictEqual(data.summary.totalSales, 46.00, 'totalSales must equal 46.00');
  assert.strictEqual(data.summary.cashSales, 46.00, 'cashSales must equal 46.00');
  assert.strictEqual(data.summary.transferSales, 0, 'transferSales must be 0');
  assert.strictEqual(data.summary.qrSales, 0, 'qrSales must be 0');
  assert.strictEqual(data.summary.netCashInflow, 46.00, 'netCashInflow must equal 46.00');
  assert.strictEqual(data.summary.totalNetCashFlow, 46.00, 'totalNetCashFlow must equal 46.00');
  assert.strictEqual(data.summary.paidBills, 1, 'paidBills must be 1');

  // Verify dailyFlow
  assert.ok(Array.isArray(data.dailyFlow), 'dailyFlow must be an array');
  assert.strictEqual(data.dailyFlow.length, 1);
  const day = data.dailyFlow[0];
  assert.strictEqual(day.cashSales, 46.00);
  assert.strictEqual(day.transferSales, 0);
  assert.strictEqual(day.qrSales, 0);
  assert.strictEqual(day.netCashFlow, 46.00);
  assert.strictEqual(day.netFlow, 46.00);

  // Verify expenseByCategory is array
  assert.ok(Array.isArray(data.expenseByCategory), 'expenseByCategory must be an array');
});

test('Finance Settings: Global & Branch Override CRUD, Float Policies & Operational Limits', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const adminLogin = sandbox.loginUser('admin', 'Admin1234!');
  const cashierLogin = sandbox.loginUser('cashier', 'Cashier1234!');

  // 1. Check default settings via finance:getSettings
  const defRes = sandbox.routeAction('finance:getSettings', adminLogin.token, {}, {});
  assert.strictEqual(defRes.ok, true);
  const defSt = defRes.settings;
  assert.strictEqual(defSt.openingFloatAmount, 1000);
  assert.strictEqual(defSt.openingFloatMode, 'AUTO_CARRY');
  assert.strictEqual(defSt.allowEditOpeningFloat, true);
  assert.strictEqual(defSt.duplicateClosingPolicy, 'WARN');
  assert.strictEqual(defSt.isBranchOverride, false);

  // 2. Permission check: cashier should NOT be allowed to save settings
  assert.throws(
    () => sandbox.routeAction('finance:saveSettings', cashierLogin.token, {
      openingFloatAmount: 2000
    }, {}),
    /FORBIDDEN/
  );

  // 3. Save Global Settings
  const saveGlobalRes = sandbox.routeAction('finance:saveSettings', adminLogin.token, {
    openingFloatAmount: 1500,
    openingFloatMode: 'FIXED_FLOAT',
    allowEditOpeningFloat: true,
    targetCarryForward: 1200,
    varianceAlertThreshold: 50,
    duplicateClosingPolicy: 'BLOCK',
    autoCalcCashDrop: true,
    requireNoteOnVariance: true,
    maxCashExpensePerTxn: 2500,
    requireRefDocAboveAmount: 400,
    defaultPayMethod: 'CASH',
    defaultDatePreset: 'TODAY',
    closingSlipPaperWidth: '80mm',
    closingReceiverTitle: 'ผู้จัดการสาขา',
    closingSlipFooterNote: 'ตรวจนับเรียบร้อย',
    autoPrintOnClosing: true
  }, {});
  assert.strictEqual(saveGlobalRes.ok, true);

  // Read back global settings
  const readGlobal = sandbox.routeAction('finance:getSettings', adminLogin.token, {}, {});
  assert.strictEqual(readGlobal.settings.openingFloatAmount, 1500);
  assert.strictEqual(readGlobal.settings.openingFloatMode, 'FIXED_FLOAT');
  assert.strictEqual(readGlobal.settings.closingSlipPaperWidth, '80mm');
  assert.strictEqual(readGlobal.settings.isBranchOverride, false);

  // 4. Save Branch Override for B02
  const saveB02Res = sandbox.routeAction('finance:saveSettings', adminLogin.token, {
    branchId: 'B02',
    openingFloatAmount: 3000,
    openingFloatMode: 'AUTO_CARRY',
    closingSlipPaperWidth: '58mm'
  }, {});
  assert.strictEqual(saveB02Res.ok, true);

  // Read B02 settings: should have openingFloatAmount = 3000 and isBranchOverride = true
  const readB02 = sandbox.routeAction('finance:getSettings', adminLogin.token, { branchId: 'B02' }, {});
  assert.strictEqual(readB02.settings.openingFloatAmount, 3000);
  assert.strictEqual(readB02.settings.isBranchOverride, true);
  // Unset values on B02 fall back to global
  assert.strictEqual(readB02.settings.targetCarryForward, 1200);

  // Read B01 settings: should still be Global
  const readB01 = sandbox.routeAction('finance:getSettings', adminLogin.token, { branchId: 'B01' }, {});
  assert.strictEqual(readB01.settings.openingFloatAmount, 1500);
  assert.strictEqual(readB01.settings.isBranchOverride, false);

  // 5. Reset Branch Override for B02
  const resetRes = sandbox.routeAction('finance:resetBranchSettings', adminLogin.token, { branchId: 'B02' }, {});
  assert.strictEqual(resetRes.ok, true);
  const readB02AfterReset = sandbox.routeAction('finance:getSettings', adminLogin.token, { branchId: 'B02' }, {});
  assert.strictEqual(readB02AfterReset.settings.openingFloatAmount, 1500);
  assert.strictEqual(readB02AfterReset.settings.isBranchOverride, false);

  // 6. Operational Limit: maxCashExpensePerTxn (limit is 2500)
  assert.throws(
    () => sandbox.routeAction('finance:createTxn', adminLogin.token, {
      type: 'EXPENSE',
      payMethod: 'CASH',
      amount: 3000,
      category: 'ค่าซ่อมบำรุง'
    }, {}),
    /เกินวงเงินสูงสุด/
  );

  // 7. Operational Limit: requireRefDocAboveAmount (limit is 400, require refDoc)
  assert.throws(
    () => sandbox.routeAction('finance:createTxn', adminLogin.token, {
      type: 'EXPENSE',
      payMethod: 'CASH',
      amount: 600,
      category: 'ค่าซ่อมบำรุง'
      // refDoc omitted
    }, {}),
    /ต้องระบุเลขที่เอกสาร/
  );

  // Providing refDoc passes
  const validExp = sandbox.routeAction('finance:createTxn', adminLogin.token, {
    type: 'EXPENSE',
    payMethod: 'CASH',
    amount: 600,
    category: 'ค่าซ่อมบำรุง',
    refDoc: 'INV-999'
  }, {});
  assert.strictEqual(validExp.ok, true);

  // 8. Closing policy: duplicateClosingPolicy === 'BLOCK' and requireNoteOnVariance
  // Closing preview with openingFloatMode FIXED_FLOAT
  const prev = sandbox.routeAction('finance:closingPreview', adminLogin.token, {
    closeDate: '2026-10-30',
    branchId: 'B01'
  }, {});
  assert.strictEqual(prev.ok, true);
  assert.strictEqual(prev.openingFloat, 1500);

  // Save closing with variance > 50 but no note -> should throw because requireNoteOnVariance is true
  assert.throws(
    () => sandbox.routeAction('finance:saveClosing', adminLogin.token, {
      closeDate: '2026-10-30',
      branchId: 'B01',
      actualCash: 500, // expected is 1500 - 600 = 900 -> variance is -400 > 50 threshold
      note: ''
    }, {}),
    /กรุณาระบุหมายเหตุชี้แจง/
  );

  // Save closing with note succeeds
  const close1 = sandbox.routeAction('finance:saveClosing', adminLogin.token, {
    closeDate: '2026-10-30',
    branchId: 'B01',
    actualCash: 500,
    cashDrop: 0,
    carryForward: 500,
    note: 'เงินขาดเนื่องจากมีจ่ายค่าอุปกรณ์ด่วน'
  }, {});
  assert.strictEqual(close1.ok, true);

  // Attempting second closing on same date when policy is BLOCK -> must throw
  assert.throws(
    () => sandbox.routeAction('finance:saveClosing', adminLogin.token, {
      closeDate: '2026-10-30',
      branchId: 'B01',
      actualCash: 500,
      note: 'ปิดซ้ำรอบสอง'
    }, {}),
    /ไม่อนุญาตให้ปิดยอดซ้ำ/
  );
});
