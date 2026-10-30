const test = require('node:test');
const assert = require('node:assert');
const { createGasMockContext } = require('./backend.mock.test.js');

test('Day & Drawer Control: Business Day lifecycle and duplicate open protection', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const manager = sandbox.loginUser('admin', 'Admin1234!');

  // 1. Initial status reports day is not open
  const initStatus = sandbox.getDayAndDrawerStatus('B01', 'POS-01');
  assert.strictEqual(initStatus.ok, true);
  assert.strictEqual(initStatus.isDayOpen, false);
  assert.strictEqual(initStatus.isDrawerOpen, false);
  assert.strictEqual(initStatus.suggestedOpeningFloat, 1000);

  // 2. Open business day for B01
  const openRes = sandbox.openBusinessDay({
    branchId: 'B01',
    businessDate: '2026-10-31',
    openingFloat: 1500,
    note: 'เปิดวันทำการทดสอบ'
  }, manager.user);

  assert.strictEqual(openRes.ok, true);
  assert.strictEqual(openRes.day.status, 'OPEN');
  assert.strictEqual(openRes.day.openingFloat, 1500);
  assert.ok(openRes.day.dayId.startsWith('DAY-B01-20261031'));

  // 3. Attempt to open a second day while first is OPEN -> must throw error
  assert.throws(() => {
    sandbox.openBusinessDay({
      branchId: 'B01',
      businessDate: '2026-10-31',
      openingFloat: 1000
    }, manager.user);
  }, /มีวันทำการที่เปิดค้างอยู่แล้ว/);

  // 4. Status reflects open day
  const statusAfter = sandbox.getDayAndDrawerStatus('B01', 'POS-01');
  assert.strictEqual(statusAfter.isDayOpen, true);
  assert.strictEqual(statusAfter.activeDay.dayId, openRes.day.dayId);
  assert.strictEqual(statusAfter.activeDay.openingFloat, 1500);
});

test('Day & Drawer Control: Multi-station & multi-shift drawer operations, mid-shift movements, and sales linking', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const manager = sandbox.loginUser('admin', 'Admin1234!');
  const cashier = sandbox.loginUser('cashier', 'Cashier1234!');

  // 1. Open business day
  const dayRes = sandbox.openBusinessDay({
    branchId: 'B01',
    businessDate: '2026-10-31',
    openingFloat: 1000
  }, manager.user);
  const dayId = dayRes.day.dayId;

  // 2. Cashier opens Drawer for POS-01 (กะเช้า)
  const d1Res = sandbox.openCashDrawer({
    branchId: 'B01',
    stationId: 'POS-01',
    shiftLabel: 'กะเช้า',
    openingFloat: 500,
    note: 'เงินทอน 500'
  }, cashier.user);

  assert.strictEqual(d1Res.ok, true);
  assert.strictEqual(d1Res.drawer.status, 'OPEN');
  assert.strictEqual(d1Res.drawer.openingFloat, 500);
  assert.strictEqual(d1Res.drawer.expectedCash, 500);
  const drawer1Id = d1Res.drawer.drawerId;

  // 3. Trying to open another drawer on POS-01 while first is OPEN -> must throw
  assert.throws(() => {
    sandbox.openCashDrawer({
      branchId: 'B01',
      stationId: 'POS-01',
      shiftLabel: 'กะบ่าย',
      openingFloat: 500
    }, cashier.user);
  }, /มีลิ้นชักเปิดอยู่แล้ว/);

  // 4. POS-02 can open independently on the same business day!
  const d2Res = sandbox.openCashDrawer({
    branchId: 'B01',
    stationId: 'POS-02',
    shiftLabel: 'กะเช้า',
    openingFloat: 500
  }, cashier.user);
  assert.strictEqual(d2Res.ok, true);
  assert.strictEqual(d2Res.drawer.stationId, 'POS-02');

  // 5. Cash sales on POS-01 automatically tags dayId and drawer1Id
  const p1 = sandbox.getTable('Products').rows.find(p => p.sku === 'P1001'); // 10 THB
  const saleRes = sandbox.checkoutSale({
    branchId: 'B01',
    stationId: 'POS-01',
    payMethod: 'CASH',
    ts: '2026-10-31T09:00:00.000Z',
    received: 100,
    subtotal: 100,
    discount: 0,
    vat: 0,
    total: 100,
    change: 0,
    items: [{ sku: 'P1001', name: p1.name, unitPrice: 10, qty: 10, discount: 0, amount: 100 }]
  }, cashier.user);

  assert.strictEqual(saleRes.ok, true);
  assert.strictEqual(saleRes.sale.dayId, dayId);
  assert.strictEqual(saleRes.sale.drawerId, drawer1Id);

  // 6. Mid-shift movements on POS-01:
  // a) CASH_IN (เติมเงินทอน 200)
  const movIn = sandbox.recordDrawerMovement({
    drawerId: drawer1Id,
    type: 'CASH_IN',
    amount: 200,
    reason: 'เติมเหรียญสิบ'
  }, cashier.user);
  assert.strictEqual(movIn.ok, true);
  assert.strictEqual(movIn.drawer.cashIn, 200);

  // b) CASH_DROP (ดึงเงินเก็บเข้าตู้เซฟระหว่างกะ 400)
  const movDrop = sandbox.recordDrawerMovement({
    drawerId: drawer1Id,
    type: 'CASH_DROP',
    amount: 400,
    reason: 'นำส่งเงินระหว่างกะ'
  }, cashier.user);
  assert.strictEqual(movDrop.ok, true);
  assert.strictEqual(movDrop.drawer.midShiftDrop, 400);

  // Expected Cash on POS-01:
  // Float(500) + CashSales(100) + CashIn(200) - MidDrop(400) = 400 THB
  const preview = sandbox.getCashDrawerClosePreview(drawer1Id);
  assert.strictEqual(preview.ok, true);
  assert.strictEqual(preview.expectedCash, 400);
  assert.strictEqual(preview.cashSales, 100);
  assert.strictEqual(preview.cashIn, 200);
  assert.strictEqual(preview.midShiftDrop, 400);
  assert.strictEqual(preview.movements.length, 2);

  // 7. Cashier closes POS-01 drawer (counted 400 THB, Drop 100 to safe, carry 300 to next shift)
  const closeRes = sandbox.closeCashDrawer({
    drawerId: drawer1Id,
    actualCash: 400,
    cashDrop: 100,
    denomBreakdown: { 100: 4 },
    note: 'ส่งกะเช้าเรียบร้อย'
  }, cashier.user);

  assert.strictEqual(closeRes.ok, true);
  assert.strictEqual(closeRes.drawer.status, 'CLOSED');
  assert.strictEqual(closeRes.drawer.variance, 0);
  assert.strictEqual(closeRes.drawer.cashDrop, 100);
  assert.strictEqual(closeRes.drawer.carryForward, 300);
  assert.ok(closeRes.slipData, 'Should return thermal slip data');

  // 8. Now POS-01 can open "กะบ่าย" with suggested carryForward of 300!
  const d1Afternoon = sandbox.openCashDrawer({
    branchId: 'B01',
    stationId: 'POS-01',
    shiftLabel: 'กะบ่าย',
    openingFloat: 300
  }, cashier.user);
  assert.strictEqual(d1Afternoon.ok, true);
  assert.strictEqual(d1Afternoon.drawer.shiftLabel, 'กะบ่าย');
  assert.strictEqual(d1Afternoon.drawer.openingFloat, 300);
});

test('Day & Drawer Control: Pre-close checklist blocks day close when drawers remain open, then allows close and locks day', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const manager = sandbox.loginUser('admin', 'Admin1234!');
  const cashier = sandbox.loginUser('cashier', 'Cashier1234!');

  // Open day
  const dayRes = sandbox.openBusinessDay({
    branchId: 'B01',
    businessDate: '2026-10-31',
    openingFloat: 1000
  }, manager.user);

  // Open drawer POS-01
  const drw1 = sandbox.openCashDrawer({
    branchId: 'B01',
    stationId: 'POS-01',
    shiftLabel: 'กะเช้า',
    openingFloat: 500
  }, cashier.user);

  // Check day preview: canClose should be false because POS-01 is still OPEN
  const dayPreview = sandbox.getBusinessDayClosePreview({ branchId: 'B01' });
  assert.strictEqual(dayPreview.ok, true);
  assert.strictEqual(dayPreview.openDrawersCount, 1);
  assert.strictEqual(dayPreview.canClose, false);

  // Attempting to close day while drawer is OPEN -> must throw error
  assert.throws(() => {
    sandbox.closeBusinessDay({
      branchId: 'B01',
      dayId: dayRes.day.dayId
    }, manager.user);
  }, /ยังมีลิ้นชักเปิดค้างอยู่ 1 เครื่อง/);

  // Close the drawer on POS-01
  sandbox.closeCashDrawer({
    drawerId: drw1.drawer.drawerId,
    actualCash: 500,
    cashDrop: 0
  }, cashier.user);

  // Now Day Preview canClose should be true!
  const dayPreview2 = sandbox.getBusinessDayClosePreview({ branchId: 'B01' });
  assert.strictEqual(dayPreview2.openDrawersCount, 0);
  assert.strictEqual(dayPreview2.canClose, true);

  // Close the Business Day
  const closeDayRes = sandbox.closeBusinessDay({
    branchId: 'B01',
    dayId: dayRes.day.dayId,
    note: 'ปิดวันทำการเรียบร้อย'
  }, manager.user);

  assert.strictEqual(closeDayRes.ok, true);
  assert.ok(closeDayRes.zReport, 'Should generate Z-Report data');

  // Verify Day status in BusinessDays table is CLOSED
  const closedDay = sandbox.findRow('BusinessDays', r => r.dayId === dayRes.day.dayId);
  assert.strictEqual(closedDay.status, 'CLOSED');

  // Verify sync to CashClosings
  const closings = sandbox.findRows('CashClosings', r => r.closeDate === '2026-10-31' && r.branchId === 'B01');
  assert.ok(closings.length >= 1, 'Should have synced to CashClosings');

  // Lock Enforcement: attempting to record checkout or petty cash expense on closed day -> blocked!
  const p1 = sandbox.getTable('Products').rows.find(p => p.sku === 'P1001');
  assert.throws(() => {
    sandbox.checkoutSale({
      branchId: 'B01',
      stationId: 'POS-01',
      payMethod: 'CASH',
      ts: '2026-10-31T10:00:00.000Z',
      received: 50,
      subtotal: 50,
      discount: 0,
      vat: 0,
      total: 50,
      change: 0,
      items: [{ sku: 'P1001', name: p1.name, unitPrice: 10, qty: 5, discount: 0, amount: 50 }]
    }, cashier.user);
  }, /ได้ถูกปิดวันเรียบร้อยแล้ว/);

  assert.throws(() => {
    sandbox.createFinanceTxn({
      type: 'EXPENSE',
      txDate: '2026-10-31',
      branchId: 'B01',
      category: 'ของใช้ในร้าน',
      amount: 50,
      payMethod: 'CASH',
      description: 'กระดาษทิชชู่'
    }, manager.user);
  }, /ได้ถูกปิดวันเรียบร้อยแล้ว/);
});

test('Day & Drawer Control: STRICT posDayDrawerPolicy enforcement blocks POS checkout', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const manager = sandbox.loginUser('admin', 'Admin1234!');
  const cashier = sandbox.loginUser('cashier', 'Cashier1234!');

  // Set policy to STRICT
  sandbox.saveFinanceSettings({
    branchId: 'B01',
    settings: { posDayDrawerPolicy: 'STRICT' }
  }, manager.user);

  const p1 = sandbox.getTable('Products').rows.find(p => p.sku === 'P1001');

  // Attempt checkout without open day -> must throw STRICT error
  assert.throws(() => {
    sandbox.checkoutSale({
      branchId: 'B01',
      stationId: 'POS-01',
      payMethod: 'CASH',
      ts: '2026-10-31T10:00:00.000Z',
      received: 20,
      subtotal: 20,
      discount: 0,
      vat: 0,
      total: 20,
      change: 0,
      items: [{ sku: 'P1001', name: p1.name, unitPrice: 10, qty: 2, discount: 0, amount: 20 }]
    }, cashier.user);
  }, /ต้องเปิดวันทำการก่อนเริ่มขาย/);

  // Open Day, but drawer still not open
  sandbox.openBusinessDay({
    branchId: 'B01',
    businessDate: '2026-10-31',
    openingFloat: 1000
  }, manager.user);

  // Attempt checkout with Day open but Drawer closed -> must throw Drawer error
  assert.throws(() => {
    sandbox.checkoutSale({
      branchId: 'B01',
      stationId: 'POS-01',
      payMethod: 'CASH',
      ts: '2026-10-31T10:05:00.000Z',
      received: 20,
      subtotal: 20,
      discount: 0,
      vat: 0,
      total: 20,
      change: 0,
      items: [{ sku: 'P1001', name: p1.name, unitPrice: 10, qty: 2, discount: 0, amount: 20 }]
    }, cashier.user);
  }, /ลิ้นชักของเครื่องจุดขาย \[POS-01\] ยังไม่ได้เปิดกะ/);

  // Open Drawer on POS-01
  sandbox.openCashDrawer({
    branchId: 'B01',
    stationId: 'POS-01',
    shiftLabel: 'กะเช้า',
    openingFloat: 500
  }, cashier.user);

  // Now checkout in STRICT mode succeeds!
  const saleOk = sandbox.checkoutSale({
    branchId: 'B01',
    stationId: 'POS-01',
    payMethod: 'CASH',
    ts: '2026-10-31T10:10:00.000Z',
    received: 20,
    subtotal: 20,
    discount: 0,
    vat: 0,
    total: 20,
    change: 0,
    items: [{ sku: 'P1001', name: p1.name, unitPrice: 10, qty: 2, discount: 0, amount: 20 }]
  }, cashier.user);

  assert.strictEqual(saleOk.ok, true);
  assert.strictEqual(saleOk.sale.total, 20);
});

test('Day & Drawer Control: Role-based permissions guarding in API router', () => {
  const { sandbox } = createGasMockContext();
  sandbox.setupDatabase();
  const manager = sandbox.loginUser('admin', 'Admin1234!');
  const cashier = sandbox.loginUser('cashier', 'Cashier1234!');

  // Cashier cannot call finance:openDay
  assert.throws(() => {
    sandbox.routeAction('finance:openDay', cashier.token, {
      branchId: 'B01',
      businessDate: '2026-10-31',
      openingFloat: 1000
    }, {});
  }, /FORBIDDEN/);

  // Cashier cannot call finance:closeDay
  assert.throws(() => {
    sandbox.routeAction('finance:closeDay', cashier.token, {
      branchId: 'B01'
    }, {});
  }, /FORBIDDEN/);

  // Manager opens day
  const dayRes = sandbox.routeAction('finance:openDay', manager.token, {
    branchId: 'B01',
    businessDate: '2026-10-31',
    openingFloat: 1000
  }, {});
  assert.strictEqual(dayRes.ok, true);

  // Cashier CAN call finance:openDrawer and finance:dayStatus
  const statusRes = sandbox.routeAction('finance:dayStatus', cashier.token, {
    branchId: 'B01',
    stationId: 'POS-01'
  }, {});
  assert.strictEqual(statusRes.ok, true);
  assert.strictEqual(statusRes.isDayOpen, true);

  const openDrawerRes = sandbox.routeAction('finance:openDrawer', cashier.token, {
    branchId: 'B01',
    stationId: 'POS-01',
    shiftLabel: 'กะเช้า',
    openingFloat: 500
  }, {});
  assert.strictEqual(openDrawerRes.ok, true);
  assert.strictEqual(openDrawerRes.drawer.status, 'OPEN');
});

test('Day & Drawer Control: Frontend DOM Elements and Module Functionality', () => {
  const fs = require('fs');
  const path = require('path');

  // 1. Verify index.html elements
  const html = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');

  // POS Status Bar & Drawer Modal
  const expectedPosElements = [
    'id="posDayDrawerStatusBar"',
    'id="posStationLabel"',
    'id="posDayStatusPill"',
    'id="posDrawerStatusPill"',
    'id="posPolicyWarnBadge"',
    'id="posManageDrawerBtn"',
    'id="posDrawerModal"',
    'id="posDrawerState_unopened"',
    'id="posDrawerState_opened"',
    'id="posOpenDrawerShiftInput"',
    'id="posOpenDrawerFloatInput"',
    'id="posDrawerActualCashInput"',
    'id="posDrawerCashDropInput"',
    'id="posDrawerVarianceBadge"',
    'id="posDrawerVarianceDisplay"'
  ];
  for (const el of expectedPosElements) {
    assert.ok(html.includes(el), `index.html must contain ${el}`);
  }

  // Finance Day Tab & Z-Report
  const expectedFinanceElements = [
    'id="financeTabBtn_day"',
    'id="financeTab_day"',
    'id="financeDayBranchSelect"',
    'id="financeDayDateInput"',
    'id="financeOpenDayCard"',
    'id="financeActiveDayInfoCard"',
    'id="financeLiveDrawersTableBody"',
    'id="financeDayClosePanel"',
    'id="businessDaysHistoryTableBody"',
    'id="st_posDayDrawerPolicy"',
    'id="st_requireCloseAllDrawersBeforeDayClose"',
    'id="st_lockLedgerAfterDayClose"',
    'id="st_autoOpenDayOnFirstDrawer"',
    'id="dayCloseDetailModal"',
    'id="zModalDayId"',
    'id="zModalContent"'
  ];
  for (const el of expectedFinanceElements) {
    assert.ok(html.includes(el), `index.html must contain ${el}`);
  }

  // 2. Verify SalesModule methods
  // Mock globals needed by sales.js when required in Node
  global.CONFIG = {
    DEFAULT_BRANCH_ID: 'B01',
    DEFAULT_STATION_ID: 'POS-01',
    STORAGE_KEYS: {
      BRANCH_ID: 'pos_active_branch_id',
      STATION_ID: 'pos_station_id',
      BILLS: 'pos_draft_bills',
      ACTIVE_BILL_ID: 'pos_active_bill_id'
    }
  };
  global.localStorage = {
    getItem: () => null,
    setItem: () => {}
  };
  global.UI = {
    showLoading: () => {},
    hideLoading: () => {},
    showToast: () => {},
    openModal: () => {},
    closeModal: () => {},
    confirmDialog: async () => true
  };
  global.Api = { call: async () => ({ ok: true }) };
  global.PrintManager = { init: () => {}, activeProfile: {}, printReceiptDirect: () => {} };
  global.SoundManager = { announceTotal: () => {}, playSuccessChime: () => {}, playErrorTone: () => {}, announceChange: () => {} };

  const SalesModule = require('../frontend/js/modules/sales.js');
  assert.strictEqual(typeof SalesModule.promptSwitchStation, 'function');
  assert.strictEqual(typeof SalesModule.refreshDayDrawerStatus, 'function');
  assert.strictEqual(typeof SalesModule.updateDayDrawerStatusUI, 'function');
  assert.strictEqual(typeof SalesModule.openDrawerModal, 'function');
  assert.strictEqual(typeof SalesModule.selectShiftPreset, 'function');
  assert.strictEqual(typeof SalesModule.submitOpenDrawer, 'function');
  assert.strictEqual(typeof SalesModule.promptMovement, 'function');
  assert.strictEqual(typeof SalesModule.onDenomInput, 'function');
  assert.strictEqual(typeof SalesModule.onActualManualInput, 'function');
  assert.strictEqual(typeof SalesModule.onCashDropInput, 'function');
  assert.strictEqual(typeof SalesModule.recalculateDrawerVariance, 'function');
  assert.strictEqual(typeof SalesModule.submitCloseDrawer, 'function');
  assert.strictEqual(typeof SalesModule.printDrawerClosingSlip, 'function');

  // 3. Verify FinanceModule methods
  const FinanceModule = require('../frontend/js/modules/finance.js');
  assert.strictEqual(typeof FinanceModule.loadDayStatus, 'function');
  assert.strictEqual(typeof FinanceModule.fetchLiveDrawers, 'function');
  assert.strictEqual(typeof FinanceModule.fetchDayClosePreview, 'function');
  assert.strictEqual(typeof FinanceModule.submitOpenDay, 'function');
  assert.strictEqual(typeof FinanceModule.submitCloseDay, 'function');
  assert.strictEqual(typeof FinanceModule.loadBusinessDaysHistory, 'function');
  assert.strictEqual(typeof FinanceModule.openZReportFromHistory, 'function');
  assert.strictEqual(typeof FinanceModule.renderZReportModal, 'function');
  assert.strictEqual(typeof FinanceModule.printZReportSlip, 'function');
  assert.strictEqual(typeof FinanceModule.openNewDrawerModal, 'function');
  assert.strictEqual(typeof FinanceModule.saveSettings, 'function');
});
