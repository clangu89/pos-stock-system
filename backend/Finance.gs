/**
 * Finance.gs - Cash Flow, Petty Cash Income/Expense Ledger, and Daily Cash Drawer Closings
 */

let _financeSheetsEnsured = false;

function formatBangkokDate_(val) {
  if (!val) return '';
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
    return val.trim();
  }
  try {
    const d = (val instanceof Date) ? val : new Date(val);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd');
    }
  } catch (e) {}
  return '';
}

function ensureFinanceSheets_() {
  if (_financeSheetsEnsured) return;
  const ss = getSpreadsheet();

  // 1. FinanceTxns
  let txnSheet = ss.getSheetByName(SHEETS.FINANCE_TXNS);
  if (!txnSheet) {
    txnSheet = ss.insertSheet(SHEETS.FINANCE_TXNS);
    const headers = DB_SCHEMAS[SHEETS.FINANCE_TXNS];
    txnSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    txnSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#2C3E50').setFontColor('#FFFFFF');
    txnSheet.setFrozenRows(1);
    setTextColumns_(SHEETS.FINANCE_TXNS, ['txnId', 'txDate', 'branchId', 'refDoc', 'userId']);
  }

  // 2. CashClosings
  let closeSheet = ss.getSheetByName(SHEETS.CASH_CLOSINGS);
  if (!closeSheet) {
    closeSheet = ss.insertSheet(SHEETS.CASH_CLOSINGS);
    const headers = DB_SCHEMAS[SHEETS.CASH_CLOSINGS];
    closeSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    closeSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#2C3E50').setFontColor('#FFFFFF');
    closeSheet.setFrozenRows(1);
    setTextColumns_(SHEETS.CASH_CLOSINGS, ['closingId', 'closeDate', 'branchId', 'userId']);
  }

  // 3. BusinessDays
  let daySheet = ss.getSheetByName(SHEETS.BUSINESS_DAYS);
  if (!daySheet) {
    daySheet = ss.insertSheet(SHEETS.BUSINESS_DAYS);
    const headers = DB_SCHEMAS[SHEETS.BUSINESS_DAYS];
    daySheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    daySheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#2C3E50').setFontColor('#FFFFFF');
    daySheet.setFrozenRows(1);
    setTextColumns_(SHEETS.BUSINESS_DAYS, ['dayId', 'businessDate', 'branchId', 'openedBy', 'closedBy']);
  }

  // 4. CashDrawers
  let drawerSheet = ss.getSheetByName(SHEETS.CASH_DRAWERS);
  if (!drawerSheet) {
    drawerSheet = ss.insertSheet(SHEETS.CASH_DRAWERS);
    const headers = DB_SCHEMAS[SHEETS.CASH_DRAWERS];
    drawerSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    drawerSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#2C3E50').setFontColor('#FFFFFF');
    drawerSheet.setFrozenRows(1);
    setTextColumns_(SHEETS.CASH_DRAWERS, ['drawerId', 'dayId', 'businessDate', 'branchId', 'stationId', 'openedBy', 'closedBy']);
  }

  ensureSheetColumns_(SHEETS.SALES, ['dayId', 'drawerId']);
  ensureSheetColumns_(SHEETS.FINANCE_TXNS, ['dayId', 'drawerId']);

  _financeSheetsEnsured = true;
}

/**
 * ดึงภาพรวมการเงินและกระแสเงินสด (Cash Flow & Financial Summary)
 */
function getFinanceOverview(startDateStr, endDateStr, branchId = '') {
  ensureFinanceSheets_();

  const todayBangkok = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const sStart = startDateStr || '';
  const sEnd = endDateStr || todayBangkok;

  // 1. Sales Data
  const salesTable = getTable(SHEETS.SALES);
  const itemsTable = getTable(SHEETS.SALE_ITEMS);

  const inRange = (s) => {
    if (branchId && s.branchId !== branchId) return false;
    const sDateStr = formatBangkokDate_(s.ts);
    if (!sDateStr) return false;
    if (sStart && sDateStr < sStart) return false;
    if (sEnd && sDateStr > sEnd) return false;
    return true;
  };

  const validSales = salesTable.rows.filter(s => s.status !== 'VOID' && inRange(s));
  const voidSales = salesTable.rows.filter(s => s.status === 'VOID' && inRange(s));

  let voidAmount = 0;
  for (let i = 0; i < voidSales.length; i++) {
    voidAmount += parseFloat(voidSales[i].total) || 0;
  }

  // Cost map
  const validReceiptNos = new Set(validSales.map(s => s.receiptNo));
  const receiptCostMap = {};
  for (let i = 0; i < itemsTable.rows.length; i++) {
    const it = itemsTable.rows[i];
    if (validReceiptNos.has(it.receiptNo)) {
      const lineCost = (parseFloat(it.qty) || 0) * (parseFloat(it.unitCost) || 0);
      receiptCostMap[it.receiptNo] = (receiptCostMap[it.receiptNo] || 0) + lineCost;
    }
  }

  let cashSales = 0;
  let transferSales = 0;
  let qrSales = 0;
  let otherSales = 0;
  let totalSales = 0;
  let totalCost = 0;

  const dailyMap = {};

  validSales.forEach(s => {
    const t = parseFloat(s.total) || 0;
    const cost = receiptCostMap[s.receiptNo] || 0;
    totalSales += t;
    totalCost += cost;

    const pm = String(s.payMethod || '').toUpperCase();
    const dayKey = formatBangkokDate_(s.ts) || todayBangkok;
    if (!dailyMap[dayKey]) {
      dailyMap[dayKey] = {
        date: dayKey,
        cashSales: 0,
        transferSales: 0,
        qrSales: 0,
        otherSales: 0,
        bankSales: 0,
        income: 0,
        otherIncome: 0,
        expense: 0,
        salesCost: 0,
        netCashFlow: 0,
        netFlow: 0,
        netProfit: 0
      };
    }

    if (pm === 'CASH') {
      cashSales += t;
      dailyMap[dayKey].cashSales += t;
    } else if (pm === 'TRANSFER') {
      transferSales += t;
      dailyMap[dayKey].transferSales += t;
      dailyMap[dayKey].bankSales += t;
    } else if (pm === 'QR') {
      qrSales += t;
      dailyMap[dayKey].qrSales += t;
      dailyMap[dayKey].bankSales += t;
    } else {
      otherSales += t;
      dailyMap[dayKey].otherSales += t;
      dailyMap[dayKey].bankSales += t;
    }
    dailyMap[dayKey].salesCost += cost;
  });

  // 2. FinanceTxns Data (Other Income & Expenses)
  const txnsTable = getTable(SHEETS.FINANCE_TXNS);
  let otherIncomeTotal = 0;
  let cashIncome = 0;
  let bankIncome = 0;

  let expenseTotal = 0;
  let cashExpense = 0;
  let bankExpense = 0;

  const categoryMap = {};

  txnsTable.rows.forEach(tx => {
    if (tx.status === 'VOID') return;
    if (branchId && tx.branchId !== branchId) return;

    // Check date (txDate or ts)
    const txDateStr = formatBangkokDate_(tx.txDate) || formatBangkokDate_(tx.ts);
    if (!txDateStr) return;
    if (sStart && txDateStr < sStart) return;
    if (sEnd && txDateStr > sEnd) return;

    const amt = parseFloat(tx.amount) || 0;
    const isCash = (tx.payMethod === 'CASH');

    if (!dailyMap[txDateStr]) {
      dailyMap[txDateStr] = {
        date: txDateStr,
        cashSales: 0,
        transferSales: 0,
        qrSales: 0,
        otherSales: 0,
        bankSales: 0,
        income: 0,
        otherIncome: 0,
        expense: 0,
        salesCost: 0,
        netCashFlow: 0,
        netFlow: 0,
        netProfit: 0
      };
    }

    if (tx.type === 'INCOME') {
      otherIncomeTotal += amt;
      if (isCash) cashIncome += amt;
      else bankIncome += amt;

      dailyMap[txDateStr].income += amt;
      dailyMap[txDateStr].otherIncome += amt;
    } else if (tx.type === 'EXPENSE') {
      expenseTotal += amt;
      if (isCash) cashExpense += amt;
      else bankExpense += amt;

      const cat = String(tx.category || 'ค่าใช้จ่ายทั่วไป').trim();
      if (!categoryMap[cat]) categoryMap[cat] = { category: cat, totalAmount: 0, count: 0 };
      categoryMap[cat].totalAmount += amt;
      categoryMap[cat].count += 1;

      dailyMap[txDateStr].expense += amt;
    }
  });

  // Calculate daily flow summaries
  const dailyFlow = Object.keys(dailyMap).sort().map(k => {
    const d = dailyMap[k];
    d.cashSales = round2_(d.cashSales);
    d.transferSales = round2_(d.transferSales);
    d.qrSales = round2_(d.qrSales);
    d.otherSales = round2_(d.otherSales);
    d.bankSales = round2_(d.bankSales);
    d.income = round2_(d.income);
    d.otherIncome = round2_(d.otherIncome);
    d.expense = round2_(d.expense);
    d.salesCost = round2_(d.salesCost);
    d.netCashFlow = round2_((d.cashSales + d.bankSales + d.income) - d.expense);
    d.netFlow = d.netCashFlow;
    const grossDay = (d.cashSales + d.bankSales) - d.salesCost;
    d.netProfit = round2_(grossDay + d.income - d.expense);
    return d;
  });

  const grossProfit = round2_(totalSales - totalCost);
  const netOperatingProfit = round2_(grossProfit + otherIncomeTotal - expenseTotal);
  const netCashInflow = round2_(cashSales + cashIncome - cashExpense);
  const netBankInflow = round2_(transferSales + qrSales + otherSales + bankIncome - bankExpense);
  const totalNetCashFlow = round2_(netCashInflow + netBankInflow);

  const expenseByCategory = Object.values(categoryMap).map(c => {
    c.totalAmount = round2_(c.totalAmount);
    c.percent = expenseTotal > 0 ? round2_((c.totalAmount / expenseTotal) * 100) : 0;
    return c;
  }).sort((a, b) => b.totalAmount - a.totalAmount);

  const summary = {
    totalSales: round2_(totalSales),
    cashSales: round2_(cashSales),
    transferSales: round2_(transferSales),
    qrSales: round2_(qrSales),
    otherSales: round2_(otherSales),
    bankSales: round2_(transferSales + qrSales + otherSales),
    totalCost: round2_(totalCost),
    grossProfit: grossProfit,
    totalIncome: round2_(otherIncomeTotal),
    cashIncome: round2_(cashIncome),
    bankIncome: round2_(bankIncome),
    totalExpense: round2_(expenseTotal),
    cashExpense: round2_(cashExpense),
    bankExpense: round2_(bankExpense),
    netOperatingProfit: netOperatingProfit,
    netCashInflow: netCashInflow,
    netBankInflow: netBankInflow,
    totalNetCashFlow: totalNetCashFlow,
    paidBills: validSales.length,
    voidBills: voidSales.length,
    voidAmount: round2_(voidAmount)
  };

  return {
    summary: summary,
    sales: {
      totalSales: round2_(totalSales),
      cashSales: round2_(cashSales),
      transferSales: round2_(transferSales),
      qrSales: round2_(qrSales),
      otherSales: round2_(otherSales),
      bankSales: round2_(transferSales + qrSales + otherSales),
      totalCost: round2_(totalCost),
      grossProfit: grossProfit,
      paidBills: validSales.length,
      voidBills: voidSales.length,
      voidAmount: round2_(voidAmount)
    },
    ledger: {
      otherIncomeTotal: round2_(otherIncomeTotal),
      cashIncome: round2_(cashIncome),
      bankIncome: round2_(bankIncome),
      expenseTotal: round2_(expenseTotal),
      cashExpense: round2_(cashExpense),
      bankExpense: round2_(bankExpense)
    },
    net: {
      grossProfit: grossProfit,
      netOperatingProfit: netOperatingProfit,
      netCashInflow: netCashInflow,
      netBankInflow: netBankInflow,
      totalNetCashFlow: totalNetCashFlow
    },
    expenseByCategory: expenseByCategory,
    dailyFlow: dailyFlow
  };
}

/**
 * ดึงรายการรายรับ-รายจ่ายหน้าร้าน (Petty Cash Ledger)
 */
function getFinanceTxns(options = {}) {
  ensureFinanceSheets_();

  const txnsTable = getTable(SHEETS.FINANCE_TXNS);
  const rows = txnsTable.rows || [];

  const startDateStr = options.startDate || '';
  const endDateStr = options.endDate || '';
  const branchId = options.branchId || '';
  const type = options.type || '';
  const payMethod = options.payMethod || '';
  const status = options.status || '';
  const searchLower = options.search ? String(options.search).trim().toLowerCase() : '';

  const matched = [];
  let totalIncome = 0;
  let totalExpense = 0;
  let activeCount = 0;
  let voidCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.txnId) continue;

    if (branchId && r.branchId !== branchId) continue;
    if (type && r.type !== type) continue;
    if (payMethod && r.payMethod !== payMethod) continue;
    if (status && r.status !== status) continue;

    const rDateStr = r.txDate || (r.ts ? Utilities.formatDate(new Date(r.ts), 'Asia/Bangkok', 'yyyy-MM-dd') : '');
    if (rDateStr) {
      if (startDateStr && rDateStr < startDateStr) continue;
      if (endDateStr && rDateStr > endDateStr) continue;
    }

    if (searchLower) {
      const text = `${r.txnId} ${r.category} ${r.refDoc} ${r.description} ${r.userName}`.toLowerCase();
      if (!text.includes(searchLower)) continue;
    }

    matched.push(r);

    const amt = parseFloat(r.amount) || 0;
    if (r.status === 'VOID') {
      voidCount++;
    } else {
      activeCount++;
      if (r.type === 'INCOME') totalIncome += amt;
      else if (r.type === 'EXPENSE') totalExpense += amt;
    }
  }

  // Sort newest first
  matched.sort((a, b) => {
    const tA = a.ts ? new Date(a.ts).getTime() : 0;
    const tB = b.ts ? new Date(b.ts).getTime() : 0;
    if (tB !== tA) return tB - tA;
    return (b._rowIndex || 0) - (a._rowIndex || 0);
  });

  const limit = Math.max(1, parseInt(options.limit, 10) || 200);
  return {
    txns: matched.slice(0, limit),
    summary: {
      totalCount: matched.length,
      activeCount: activeCount,
      voidCount: voidCount,
      totalIncome: round2_(totalIncome),
      totalExpense: round2_(totalExpense),
      netAmount: round2_(totalIncome - totalExpense)
    }
  };
}

/**
 * บันทึกรายรับ/รายจ่ายหน้าร้านใหม่
 */
function createFinanceTxn(data = {}, sessionUser = {}) {
  ensureFinanceSheets_();

  const type = String(data.type || '').toUpperCase();
  if (type !== 'INCOME' && type !== 'EXPENSE') {
    throw new Error('ประเภทรายการไม่ถูกต้อง (ต้องเป็น INCOME หรือ EXPENSE)');
  }

  const amount = parseFloat(data.amount);
  if (isNaN(amount) || amount <= 0) {
    throw new Error('กรุณาระบุจำนวนเงินที่ถูกต้องและมากกว่า 0');
  }

  const category = String(data.category || '').trim();
  if (!category) {
    throw new Error('กรุณาระบุหมวดหมู่รายการ');
  }

  const payMethod = String(data.payMethod || 'CASH').toUpperCase();
  const branchId = String(data.branchId || sessionUser.branchIds?.[0] || 'B01').trim();
  const txDate = String(data.txDate || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd')).trim();
  const refDoc = String(data.refDoc || '').trim();
  const description = String(data.description || '').trim();

  // Validate against Finance Settings
  const settingsRes = getFinanceSettings(branchId);
  const st = settingsRes.effective || DEFAULT_FINANCE_SETTINGS_;

  if (type === 'EXPENSE' && payMethod === 'CASH' && st.maxCashExpensePerTxn > 0 && amount > st.maxCashExpensePerTxn) {
    throw new Error(`ยอดเบิกจ่ายเงินสด (฿${amount.toFixed(2)}) เกินวงเงินสูงสุดที่กำหนดไว้ (฿${st.maxCashExpensePerTxn.toFixed(2)} ต่อรายการ)`);
  }

  if (type === 'EXPENSE' && st.requireRefDocAboveAmount > 0 && amount >= st.requireRefDocAboveAmount && !refDoc) {
    throw new Error(`รายการจ่ายตั้งแต่ ฿${st.requireRefDocAboveAmount.toFixed(2)} ขึ้นไป ต้องระบุเลขที่เอกสาร/บิลอ้างอิง`);
  }

  // Check if day is locked
  if (st.lockLedgerAfterDayClose !== false) {
    const closedDay = findRow(SHEETS.BUSINESS_DAYS, r => r.branchId === branchId && r.businessDate === txDate && r.status === 'CLOSED');
    const openDay = findRow(SHEETS.BUSINESS_DAYS, r => r.branchId === branchId && r.status === 'OPEN');
    if (closedDay && !openDay) {
      throw new Error(`ไม่สามารถบันทึกรายการได้: วันทำการ [${txDate}] ของสาขานี้ได้ถูกปิดวันเรียบร้อยแล้ว`);
    }
  }

  const activeDay = findRow(SHEETS.BUSINESS_DAYS, r => r.branchId === branchId && r.status === 'OPEN');
  const dayId = activeDay ? activeDay.dayId : String(data.dayId || '').trim();
  const drawerId = String(data.drawerId || '').trim();

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const yyyymmdd = txDate.replace(/-/g, '');
    const counterKey = (type === 'INCOME' ? 'INC_' : 'EXP_') + yyyymmdd;
    const runNum = incrementCounter_(counterKey);
    const prefix = type === 'INCOME' ? 'INC' : 'EXP';
    const txnId = `${prefix}-${yyyymmdd}-${String(runNum).padStart(4, '0')}`;
    const nowIso = new Date().toISOString();

    const rowObj = {
      txnId: txnId,
      ts: nowIso,
      txDate: txDate,
      branchId: branchId,
      type: type,
      category: category,
      amount: round2_(amount),
      payMethod: payMethod,
      refDoc: refDoc,
      description: description,
      status: 'ACTIVE',
      userId: sessionUser.userId || 'SYSTEM',
      userName: sessionUser.name || sessionUser.username || 'Admin',
      voidBy: '',
      voidAt: '',
      voidReason: '',
      dayId: dayId,
      drawerId: drawerId
    };

    appendRow(SHEETS.FINANCE_TXNS, rowObj);

    logAudit(sessionUser.userId, 'CREATE_FINANCE_TXN', 'FinanceTxns', {
      txnId: txnId,
      type: type,
      category: category,
      amount: round2_(amount),
      payMethod: payMethod,
      branchId: branchId
    });

    return {
      ok: true,
      message: `${type === 'INCOME' ? 'บันทึกรายรับ' : 'บันทึกรายจ่าย'} เรียบร้อยแล้ว`,
      txn: rowObj
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ยกเลิกรายการรายรับ/รายจ่าย (Void)
 */
function voidFinanceTxn(data = {}, sessionUser = {}) {
  ensureFinanceSheets_();

  const txnId = String(data.txnId || '').trim();
  const reason = String(data.reason || '').trim();

  if (!txnId) throw new Error('กรุณาระบุรหัสรายการที่ต้องการยกเลิก');
  if (!reason) throw new Error('กรุณาระบุเหตุผลในการยกเลิกรายการ');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getSheet(SHEETS.FINANCE_TXNS);
    const tableData = sheet.getDataRange().getValues();
    if (tableData.length <= 1) throw new Error('ไม่พบข้อมูลรายการ');

    const headers = tableData[0].map(h => String(h).trim());
    const idCol = headers.indexOf('txnId');
    const statusCol = headers.indexOf('status');
    const voidByCol = headers.indexOf('voidBy');
    const voidAtCol = headers.indexOf('voidAt');
    const voidReasonCol = headers.indexOf('voidReason');

    let targetRowIndex = -1;
    let targetRow = null;

    for (let r = 1; r < tableData.length; r++) {
      if (String(tableData[r][idCol]) === txnId) {
        targetRowIndex = r + 1; // 1-based index
        targetRow = tableData[r];
        break;
      }
    }

    if (targetRowIndex === -1) {
      throw new Error(`ไม่พบรายการรหัส [${txnId}]`);
    }

    if (String(targetRow[statusCol]) === 'VOID') {
      throw new Error(`รายการ [${txnId}] ถูกยกเลิกไปแล้ว`);
    }

    const branchCol = headers.indexOf('branchId');
    const txDateCol = headers.indexOf('txDate');
    const rowBranch = branchCol >= 0 ? String(targetRow[branchCol]) : '';
    const rowDate = txDateCol >= 0 ? String(targetRow[txDateCol]) : '';

    const settingsRes = getFinanceSettings(rowBranch);
    const st = settingsRes.effective || DEFAULT_FINANCE_SETTINGS_;
    if (st.lockLedgerAfterDayClose !== false && rowBranch && rowDate) {
      const closedDay = findRow(SHEETS.BUSINESS_DAYS, r => r.branchId === rowBranch && r.businessDate === rowDate && r.status === 'CLOSED');
      const openDay = findRow(SHEETS.BUSINESS_DAYS, r => r.branchId === rowBranch && r.status === 'OPEN');
      if (closedDay && !openDay) {
        throw new Error(`ไม่สามารถยกเลิกรายการได้: วันทำการ [${rowDate}] ของสาขานี้ได้ถูกปิดวันเรียบร้อยแล้ว`);
      }
    }

    const nowIso = new Date().toISOString();
    sheet.getRange(targetRowIndex, statusCol + 1).setValue('VOID');
    if (voidByCol >= 0) sheet.getRange(targetRowIndex, voidByCol + 1).setValue(sessionUser.name || sessionUser.username || 'Admin');
    if (voidAtCol >= 0) sheet.getRange(targetRowIndex, voidAtCol + 1).setValue(nowIso);
    if (voidReasonCol >= 0) sheet.getRange(targetRowIndex, voidReasonCol + 1).setValue(reason);

    delete _tableCache[SHEETS.FINANCE_TXNS];

    logAudit(sessionUser.userId, 'VOID_FINANCE_TXN', 'FinanceTxns', {
      txnId: txnId,
      reason: reason
    });

    return {
      ok: true,
      message: `ยกเลิกรายการ [${txnId}] เรียบร้อยแล้ว`
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * คำนวณยอดเงินสดคาดการณ์สำหรับเตรียมปิดยอดประจำวัน
 */
function getCashClosingPreview(closeDateStr, branchId = '') {
  ensureFinanceSheets_();

  const closeDate = closeDateStr || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const targetBranch = branchId || 'B01';

  // 1. Calculate sales of that exact day
  const salesTable = getTable(SHEETS.SALES);
  let cashSales = 0;
  let transferSales = 0;
  let qrSales = 0;
  let paidBillsCount = 0;
  let voidBillsCount = 0;

  salesTable.rows.forEach(s => {
    if (targetBranch && s.branchId !== targetBranch) return;
    const sDate = formatBangkokDate_(s.ts);
    if (sDate !== closeDate) return;

    const t = parseFloat(s.total) || 0;
    if (s.status === 'VOID') {
      voidBillsCount++;
    } else {
      paidBillsCount++;
      const pm = String(s.payMethod || '').toUpperCase();
      if (pm === 'CASH') cashSales += t;
      else if (pm === 'TRANSFER') transferSales += t;
      else if (pm === 'QR') qrSales += t;
      else transferSales += t;
    }
  });

  // 2. Calculate FinanceTxns of that day
  const txnsTable = getTable(SHEETS.FINANCE_TXNS);
  let cashIncome = 0;
  let cashExpense = 0;

  txnsTable.rows.forEach(tx => {
    if (tx.status === 'VOID') return;
    if (targetBranch && tx.branchId !== targetBranch) return;
    const txDate = formatBangkokDate_(tx.txDate) || formatBangkokDate_(tx.ts);
    if (txDate !== closeDate) return;

    if (tx.payMethod === 'CASH') {
      const amt = parseFloat(tx.amount) || 0;
      if (tx.type === 'INCOME') cashIncome += amt;
      else if (tx.type === 'EXPENSE') cashExpense += amt;
    }
  });

  // 3. Find suggested opening float based on settings and previous closing of this branch
  const closingsTable = getTable(SHEETS.CASH_CLOSINGS);
  const branchClosings = closingsTable.rows
    .filter(c => c.branchId === targetBranch && c.status !== 'VOID')
    .sort((a, b) => new Date(b.ts || 0).getTime() - new Date(a.ts || 0).getTime());

  const settingsRes = getFinanceSettings(targetBranch);
  const st = settingsRes.effective || DEFAULT_FINANCE_SETTINGS_;

  let suggestedFloat = st.openingFloatAmount !== undefined ? st.openingFloatAmount : 1000;
  if (st.openingFloatMode === 'AUTO_CARRY') {
    if (branchClosings.length > 0) {
      const prevCarry = parseFloat(branchClosings[0].carryForward);
      if (!isNaN(prevCarry) && prevCarry >= 0) {
        suggestedFloat = prevCarry;
      }
    }
  } else {
    // FIXED_FLOAT mode uses configured amount every day
    suggestedFloat = st.openingFloatAmount !== undefined ? st.openingFloatAmount : 1000;
  }

  const existingClosings = branchClosings.filter(c => c.closeDate === closeDate);

  const expectedCash = round2_(suggestedFloat + cashSales + cashIncome - cashExpense);

  return {
    ok: true,
    closeDate: closeDate,
    branchId: targetBranch,
    openingFloat: suggestedFloat,
    suggestedOpeningFloat: suggestedFloat,
    cashSales: round2_(cashSales),
    transferSales: round2_(transferSales),
    qrSales: round2_(qrSales),
    cashIncome: round2_(cashIncome),
    cashExpense: round2_(cashExpense),
    expectedCash: expectedCash,
    paidBillsCount: paidBillsCount,
    voidBillsCount: voidBillsCount,
    existingClosingsCount: existingClosings.length,
    existingClosings: existingClosings,
    settings: st
  };
}

/**
 * บันทึกใบปิดยอดส่งเงินสดประจำวัน (Cash Drawer Closing)
 */
function saveCashClosing(data = {}, sessionUser = {}) {
  ensureFinanceSheets_();

  const closeDate = String(data.closeDate || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd')).trim();
  const branchId = String(data.branchId || 'B01').trim();
  const openingFloat = Math.max(0, parseFloat(data.openingFloat) || 0);
  const actualCash = Math.max(0, parseFloat(data.actualCash) || 0);
  const cashDrop = Math.max(0, parseFloat(data.cashDrop) || 0);
  const note = String(data.note || '').trim();
  const denomJson = typeof data.denomBreakdown === 'object' ? JSON.stringify(data.denomBreakdown) : (typeof data.denomCounts === 'object' ? JSON.stringify(data.denomCounts) : String(data.denomJson || '{}'));

  const settingsRes = getFinanceSettings(branchId);
  const st = settingsRes.effective || DEFAULT_FINANCE_SETTINGS_;

  if (st.duplicateClosingPolicy === 'BLOCK') {
    const existing = findRows(SHEETS.CASH_CLOSINGS, c => c.branchId === branchId && c.closeDate === closeDate && c.status !== 'VOID');
    if (existing.length > 0) {
      throw new Error(`สาขานี้ได้ทำการปิดยอดวันที่ ${closeDate} ไปแล้ว (นโยบายระบบไม่อนุญาตให้ปิดยอดซ้ำ)`);
    }
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // Re-verify figures authoritatively
    const preview = getCashClosingPreview(closeDate, branchId);
    const expectedCash = round2_(openingFloat + preview.cashSales + preview.cashIncome - preview.cashExpense);
    const variance = round2_(actualCash - expectedCash);
    const carryForward = round2_(Math.max(0, actualCash - cashDrop));

    if (st.requireNoteOnVariance) {
      const varianceVal = Math.abs(variance);
      if (varianceVal > (st.varianceAlertThreshold || 0) && !note) {
        throw new Error(`ยอดเงินสดที่นับได้มีผลต่าง ${variance > 0 ? '+' : ''}${variance.toFixed(2)} บาท กรุณาระบุหมายเหตุชี้แจง`);
      }
    }

    const yyyymmdd = closeDate.replace(/-/g, '');
    const counterKey = `CLS_${branchId}_${yyyymmdd}`;
    const runNum = incrementCounter_(counterKey);
    const closingId = `CLS-${branchId}-${yyyymmdd}-${String(runNum).padStart(2, '0')}`;
    const nowIso = new Date().toISOString();

    const rowObj = {
      closingId: closingId,
      ts: nowIso,
      closeDate: closeDate,
      branchId: branchId,
      openingFloat: round2_(openingFloat),
      cashSales: preview.cashSales,
      transferSales: preview.transferSales,
      qrSales: preview.qrSales,
      cashIncome: preview.cashIncome,
      cashExpense: preview.cashExpense,
      expectedCash: expectedCash,
      actualCash: round2_(actualCash),
      variance: variance,
      cashDrop: round2_(cashDrop),
      carryForward: carryForward,
      denomJson: denomJson,
      note: note,
      status: 'CLOSED',
      userId: sessionUser.userId || 'SYSTEM',
      userName: sessionUser.name || sessionUser.username || 'Admin'
    };

    appendRow(SHEETS.CASH_CLOSINGS, rowObj);

    logAudit(sessionUser.userId, 'SAVE_CASH_CLOSING', 'CashClosings', {
      closingId: closingId,
      closeDate: closeDate,
      branchId: branchId,
      expectedCash: expectedCash,
      actualCash: round2_(actualCash),
      variance: variance,
      cashDrop: round2_(cashDrop)
    });

    return {
      ok: true,
      message: `บันทึกปิดยอดส่งเงินสด [${closingId}] เรียบร้อยแล้ว`,
      closing: rowObj
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ดึงประวัติการปิดยอดส่งเงินสดประจำวัน
 */
function getCashClosingsList(options = {}) {
  ensureFinanceSheets_();

  const table = getTable(SHEETS.CASH_CLOSINGS);
  const rows = table.rows || [];

  const start = options.startDate ? new Date(options.startDate + 'T00:00:00') : null;
  const end = options.endDate ? new Date(options.endDate + 'T23:59:59') : null;
  const branchId = options.branchId || '';

  const matched = [];
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i];
    if (!c || !c.closingId) continue;
    if (branchId && c.branchId !== branchId) continue;

    if (c.closeDate) {
      const d = new Date(c.closeDate + 'T12:00:00');
      if (start && d < start) continue;
      if (end && d > end) continue;
    }

    matched.push(c);
  }

  matched.sort((a, b) => {
    const tA = a.ts ? new Date(a.ts).getTime() : 0;
    const tB = b.ts ? new Date(b.ts).getTime() : 0;
    if (tB !== tA) return tB - tA;
    return (b._rowIndex || 0) - (a._rowIndex || 0);
  });

  const limit = Math.max(1, parseInt(options.limit, 10) || 50);
  return {
    ok: true,
    closings: matched.slice(0, limit)
  };
}

/**
 * ค่าเริ่มต้นมาตรฐานสำหรับการตั้งค่าระบบการเงิน (Finance Settings Default)
 */
const DEFAULT_FINANCE_SETTINGS_ = {
  // 1. เงินสดยกมา & เงินทอนลิ้นชักแคชเชียร์
  openingFloatAmount: 1000,
  openingFloatMode: 'AUTO_CARRY', // 'AUTO_CARRY' (ดึงยอดยกไปวันก่อน) หรือ 'FIXED_FLOAT' (ยอดคงที่ทุกวัน)
  allowEditOpeningFloat: true,     // อนุญาตให้แก้ไขยอดเงินทอนยกมาหน้างานได้
  
  // 2. นโยบายปิดยอด & เงินสดนำส่ง
  targetCarryForward: 1000,        // เงินทอนเป้าหมายที่ต้องการคงไว้ในลิ้นชัก
  autoCalcCashDrop: true,          // คำนวณ Cash Drop อัตโนมัติ (ยอดนับจริง - targetCarryForward)
  varianceAlertThreshold: 0,       // ผลต่างที่เริ่มเตือน (0 = ทุกผลต่าง)
  requireNoteOnVariance: false,    // บังคับระบุหมายเหตุเมื่อเงินขาด/เกิน
  duplicateClosingPolicy: 'WARN',  // 'WARN' (เตือนแต่ให้บันทึกซ้ำได้) หรือ 'BLOCK' (ล็อกห้ามบันทึกซ้ำวันเดียวกัน)
  
  // 3. หมวดหมู่รายรับ-รายจ่ายหน้าร้าน & วงเงินสดย่อย
  expenseCategories: [
    'ของใช้ในร้าน',
    'เดินทาง/ค่าน้ำมัน',
    'สาธารณูปโภค (น้ำ/ไฟ/เน็ต)',
    'วัสดุอุปกรณ์สำนักงาน',
    'ซ่อมแซมบำรุงรักษา',
    'ค่าอาหาร/เครื่องดื่มรับรอง',
    'ค่าจ้างชั่วคราว',
    'ค่าใช้จ่ายเบ็ดเตล็ด'
  ],
  incomeCategories: [
    'รับค่าบริการ',
    'ขายเศษวัสดุ/กล่อง/ลัง',
    'รับเงินรางวัล/ส่งเสริมการขาย',
    'รายรับเบ็ดเตล็ด'
  ],
  maxCashExpensePerTxn: 0,         // วงเงินเบิกจ่ายเงินสดสูงสุดต่อครั้ง (0 = ไม่จำกัด)
  requireRefDocAboveAmount: 0,     // บังคับกรอกเอกสารอ้างอิงเมื่อยอดเกินนี้ (0 = ไม่บังคับ)
  defaultTxnPayMethod: 'CASH',     // CASH หรือ TRANSFER
  defaultDateRangePreset: 'THIS_MONTH', // TODAY, LAST_7_DAYS, THIS_MONTH
  
  // 4. รูปแบบใบสรุปปิดยอดส่งเงินสด (Thermal Closing Slip)
  closingSlipPaperWidth: '58mm',   // '58mm' หรือ '80mm'
  autoPrintClosingSlip: false,     // พิมพ์อัตโนมัติหลังกดบันทึกปิดยอด
  closingReceiverTitle: 'ผู้จัดการ / ผู้ตรวจรับเงิน',
  closingSlipFooterNote: 'กรุณาเก็บเอกสารนี้ไว้เป็นหลักฐานการส่งเงินประจำวัน',

  // 5. นโยบายเปิด-ปิดวันทำการ & เปิด-ปิดลิ้นชักจุดขาย
  posDayDrawerPolicy: 'WARN',      // 'STRICT' (บล็อกหน้าขายถ้ายังไม่เปิดวัน/ลิ้นชัก) | 'WARN' (เตือนแต่ให้ขายได้) | 'NONE'
  requireCloseAllDrawersBeforeDayClose: true, // บังคับปิดลิ้นชักครบทุกเครื่องก่อนปิดวันทำการ
  lockLedgerAfterDayClose: true,   // ล็อกห้ามบันทึกขาย/รายรับ-รายจ่ายในวันที่ปิดวันไปแล้ว
  autoOpenDayOnFirstDrawer: false  // ทางเลือก: เปิดวันอัตโนมัติเมื่อเปิดลิ้นชักแรก หรือต้องให้ ผจก. กดเปิดวันก่อน
};

/**
 * ดึงการตั้งค่าระบบการเงิน (ทั้งแบบค่ากลาง และแบบเจาะจงรายสาขา)
 */
function getFinanceSettings(branchId = '') {
  ensureFinanceSheets_();
  const rawGlobal = getConfig('FINANCE_SETTINGS_GLOBAL', '');
  let globalObj = {};
  try {
    globalObj = rawGlobal ? JSON.parse(rawGlobal) : {};
  } catch (e) {
    globalObj = {};
  }
  
  // Fallback to DEFAULT_OPENING_FLOAT if set in Config
  if (globalObj.openingFloatAmount === undefined) {
    const legacyFloat = parseFloat(getConfig('DEFAULT_OPENING_FLOAT', '1000'));
    if (!isNaN(legacyFloat)) globalObj.openingFloatAmount = legacyFloat;
  }

  const mergedGlobal = Object.assign({}, DEFAULT_FINANCE_SETTINGS_, globalObj);

  let branchObj = null;
  if (branchId) {
    const rawBranch = getConfig(`FINANCE_SETTINGS_BRANCH_${branchId}`, '');
    if (rawBranch) {
      try {
        branchObj = JSON.parse(rawBranch);
      } catch (e) {
        branchObj = null;
      }
    }
  }

  const effective = Object.assign({}, mergedGlobal, branchObj || {});
  const isBranchOverride = branchObj !== null;
  const settingsObj = Object.assign({}, effective, {
    isBranchOverride: isBranchOverride,
    defaultPayMethod: effective.defaultTxnPayMethod || 'CASH',
    defaultDatePreset: effective.defaultDateRangePreset || 'THIS_MONTH',
    autoPrintOnClosing: !!effective.autoPrintClosingSlip
  });

  return {
    ok: true,
    branchId: branchId,
    hasBranchOverride: isBranchOverride,
    global: mergedGlobal,
    branch: branchObj,
    effective: effective,
    settings: settingsObj
  };
}

/**
 * บันทึกการตั้งค่าระบบการเงิน (บันทึกค่ากลาง หรือบันทึกเฉพาะสาขา)
 */
function saveFinanceSettings(payload = {}, sessionUser = {}) {
  ensureFinanceSheets_();
  const branchId = String(payload.branchId || '').trim();
  const settings = (payload.settings && typeof payload.settings === 'object') ? payload.settings : payload;

  const cleanSettings = {};
  if (settings.openingFloatAmount !== undefined) cleanSettings.openingFloatAmount = Math.max(0, parseFloat(settings.openingFloatAmount) || 0);
  if (settings.openingFloatMode) cleanSettings.openingFloatMode = settings.openingFloatMode === 'FIXED_FLOAT' ? 'FIXED_FLOAT' : 'AUTO_CARRY';
  if (settings.allowEditOpeningFloat !== undefined) cleanSettings.allowEditOpeningFloat = !!settings.allowEditOpeningFloat;
  if (settings.targetCarryForward !== undefined) cleanSettings.targetCarryForward = Math.max(0, parseFloat(settings.targetCarryForward) || 0);
  if (settings.autoCalcCashDrop !== undefined) cleanSettings.autoCalcCashDrop = !!settings.autoCalcCashDrop;
  if (settings.varianceAlertThreshold !== undefined) cleanSettings.varianceAlertThreshold = Math.max(0, parseFloat(settings.varianceAlertThreshold) || 0);
  if (settings.requireNoteOnVariance !== undefined) cleanSettings.requireNoteOnVariance = !!settings.requireNoteOnVariance;
  if (settings.duplicateClosingPolicy) cleanSettings.duplicateClosingPolicy = settings.duplicateClosingPolicy === 'BLOCK' ? 'BLOCK' : 'WARN';
  
  if (Array.isArray(settings.expenseCategories)) {
    cleanSettings.expenseCategories = settings.expenseCategories.map(c => String(c).trim()).filter(Boolean);
  }
  if (Array.isArray(settings.incomeCategories)) {
    cleanSettings.incomeCategories = settings.incomeCategories.map(c => String(c).trim()).filter(Boolean);
  }
  if (settings.maxCashExpensePerTxn !== undefined) cleanSettings.maxCashExpensePerTxn = Math.max(0, parseFloat(settings.maxCashExpensePerTxn) || 0);
  if (settings.requireRefDocAboveAmount !== undefined) cleanSettings.requireRefDocAboveAmount = Math.max(0, parseFloat(settings.requireRefDocAboveAmount) || 0);
  
  const payMethod = settings.defaultPayMethod || settings.defaultTxnPayMethod;
  if (payMethod) cleanSettings.defaultTxnPayMethod = payMethod === 'TRANSFER' ? 'TRANSFER' : 'CASH';

  const datePreset = settings.defaultDatePreset || settings.defaultDateRangePreset;
  if (datePreset) cleanSettings.defaultDateRangePreset = ['TODAY', 'THIS_WEEK', 'LAST_7_DAYS', 'THIS_MONTH'].includes(datePreset) ? datePreset : 'THIS_MONTH';

  if (settings.closingSlipPaperWidth) cleanSettings.closingSlipPaperWidth = settings.closingSlipPaperWidth === '80mm' ? '80mm' : '58mm';
  
  const autoPrint = settings.autoPrintOnClosing !== undefined ? settings.autoPrintOnClosing : settings.autoPrintClosingSlip;
  if (autoPrint !== undefined) cleanSettings.autoPrintClosingSlip = !!autoPrint;

  if (settings.closingReceiverTitle !== undefined) cleanSettings.closingReceiverTitle = String(settings.closingReceiverTitle).trim();
  if (settings.closingSlipFooterNote !== undefined) cleanSettings.closingSlipFooterNote = String(settings.closingSlipFooterNote).trim();

  if (settings.posDayDrawerPolicy) {
    cleanSettings.posDayDrawerPolicy = ['STRICT', 'WARN', 'NONE'].includes(settings.posDayDrawerPolicy) ? settings.posDayDrawerPolicy : 'WARN';
  }
  if (settings.requireCloseAllDrawersBeforeDayClose !== undefined) {
    cleanSettings.requireCloseAllDrawersBeforeDayClose = !!settings.requireCloseAllDrawersBeforeDayClose;
  }
  if (settings.lockLedgerAfterDayClose !== undefined) {
    cleanSettings.lockLedgerAfterDayClose = !!settings.lockLedgerAfterDayClose;
  }
  if (settings.autoOpenDayOnFirstDrawer !== undefined) {
    cleanSettings.autoOpenDayOnFirstDrawer = !!settings.autoOpenDayOnFirstDrawer;
  }

  const key = branchId ? `FINANCE_SETTINGS_BRANCH_${branchId}` : 'FINANCE_SETTINGS_GLOBAL';
  const desc = branchId ? `การตั้งค่าระบบการเงิน สาขา ${branchId}` : 'การตั้งค่าระบบการเงิน ค่ากลางทุกสาขา';
  
  setConfig(key, JSON.stringify(cleanSettings), desc);
  if (!branchId && cleanSettings.openingFloatAmount !== undefined) {
    setConfig('DEFAULT_OPENING_FLOAT', String(cleanSettings.openingFloatAmount), 'ยอดเงินทอนตั้งต้นประจำวัน (บาท)');
  }

  logAudit(sessionUser.userId, 'SAVE_FINANCE_SETTINGS', 'Config', { branchId: branchId || 'GLOBAL', settings: cleanSettings });

  return {
    ok: true,
    message: branchId ? `บันทึกการตั้งค่าการเงินสำหรับสาขา [${branchId}] สำเร็จ` : 'บันทึกการตั้งค่าการเงินค่ากลางสำเร็จ',
    settings: cleanSettings
  };
}

/**
 * ลบการตั้งค่าเฉพาะสาขา เพื่อให้กลับไปใช้ค่ากลาง
 */
function resetBranchFinanceSettings(branchId, sessionUser = {}) {
  if (!branchId) throw new Error('กรุณาระบุรหัสสาขาที่ต้องการรีเซ็ต');
  const key = `FINANCE_SETTINGS_BRANCH_${branchId}`;
  deleteRows(SHEETS.CONFIG, r => r.key === key);
  _configCache = null;
  logAudit(sessionUser.userId, 'RESET_BRANCH_FINANCE_SETTINGS', 'Config', { branchId });
  return { ok: true, message: `รีเซ็ตการตั้งค่าสาขา [${branchId}] กลับไปใช้ค่ากลางเรียบร้อยแล้ว` };
}

// ============================================================================
// DAY CONTROL & CASH DRAWER CONTROL (2-Tier Cash Lifecycle)
// ============================================================================

/**
 * ดึงสถานะวันทำการและลิ้นชักจุดขายปัจจุบัน (สำหรับหน้า POS และหน้า Finance)
 */
function getDayAndDrawerStatus(branchId = '', stationId = '', businessDate = '') {
  ensureFinanceSheets_();
  const targetBranch = String(branchId || 'B01').trim();
  const targetStation = String(stationId || 'POS-01').trim();
  const targetDate = String(businessDate || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd')).trim();

  const settingsRes = getFinanceSettings(targetBranch);
  const st = settingsRes.effective || DEFAULT_FINANCE_SETTINGS_;

  // 1. ตรวจสอบสถานะวันทำการของสาขา
  const daysTable = getTable(SHEETS.BUSINESS_DAYS);
  const branchDays = (daysTable.rows || []).filter(d => d.branchId === targetBranch);
  const activeDay = branchDays.find(d => d.status === 'OPEN') || null;
  const closedDay = branchDays.find(d => d.businessDate === targetDate && d.status === 'CLOSED') || null;
  const isDayOpen = !!activeDay;

  // 2. ตรวจสอบสถานะลิ้นชักของเครื่องจุดขายนี้
  const drawersTable = getTable(SHEETS.CASH_DRAWERS);
  const branchDrawers = (drawersTable.rows || []).filter(d => d.branchId === targetBranch);
  const activeDrawer = branchDrawers.find(d => d.stationId === targetStation && d.status === 'OPEN') || null;
  const isDrawerOpen = !!activeDrawer;

  // 3. รายการลิ้นชักทั้งหมดของวันทำการปัจจุบัน (หรือของวันที่เลือก)
  const todayDrawers = branchDrawers.filter(d => {
    if (activeDay) return d.dayId === activeDay.dayId;
    return d.businessDate === targetDate;
  });

  // 4. คำนวณเงินทอนตั้งต้นที่แนะนำ
  let suggestedFloat = st.openingFloatAmount !== undefined ? st.openingFloatAmount : 1000;
  if (st.openingFloatMode === 'AUTO_CARRY') {
    const closedDays = branchDays.filter(d => d.status === 'CLOSED').sort((a, b) => new Date(b.closedAt || b.openedAt || 0) - new Date(a.closedAt || a.openedAt || 0));
    if (closedDays.length > 0) {
      const prevCarry = parseFloat(closedDays[0].carryForward);
      if (!isNaN(prevCarry) && prevCarry >= 0) suggestedFloat = prevCarry;
    }
  }

  return {
    ok: true,
    branchId: targetBranch,
    stationId: targetStation,
    businessDate: targetDate,
    activeDay: activeDay,
    closedDay: closedDay,
    isDayOpen: isDayOpen,
    activeDrawer: activeDrawer,
    isDrawerOpen: isDrawerOpen,
    allDrawers: todayDrawers,
    openDrawersCount: todayDrawers.filter(d => d.status === 'OPEN').length,
    closedDrawersCount: todayDrawers.filter(d => d.status === 'CLOSED').length,
    suggestedOpeningFloat: suggestedFloat,
    policy: st.posDayDrawerPolicy || 'WARN',
    settings: st
  };
}

/**
 * เปิดวันทำการระดับสาขา (Manager / Admin)
 */
function openBusinessDay(payload = {}, sessionUser = {}) {
  ensureFinanceSheets_();
  const branchId = String(payload.branchId || 'B01').trim();
  const businessDate = String(payload.businessDate || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd')).trim();
  const openingFloat = Math.max(0, parseFloat(payload.openingFloat) || 0);
  const openNote = String(payload.note || payload.openNote || '').trim();

  const settingsRes = getFinanceSettings(branchId);
  const st = settingsRes.effective || DEFAULT_FINANCE_SETTINGS_;

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const existingOpen = findRow(SHEETS.BUSINESS_DAYS, r => r.branchId === branchId && r.status === 'OPEN');
    if (existingOpen) {
      throw new Error(`สาขานี้มีวันทำการที่เปิดค้างอยู่แล้ว (${existingOpen.businessDate} [${existingOpen.dayId}]) กรุณาปิดวันเดิมก่อนเปิดวันใหม่`);
    }

    const existingClosed = findRow(SHEETS.BUSINESS_DAYS, r => r.branchId === branchId && r.businessDate === businessDate && r.status === 'CLOSED');
    if (existingClosed && st.duplicateClosingPolicy === 'BLOCK') {
      throw new Error(`วันทำการ [${businessDate}] ของสาขานี้ได้ทำการปิดวันไปแล้ว (นโยบายระบบไม่อนุญาตให้เปิดวันซ้ำ)`);
    }

    const cleanDate = businessDate.replace(/-/g, '');
    let dayId = `DAY-${branchId}-${cleanDate}`;
    if (findRow(SHEETS.BUSINESS_DAYS, r => r.dayId === dayId)) {
      dayId = `${dayId}_${Date.now().toString(36).slice(-4)}`;
    }

    const now = new Date().toISOString();
    const dayRecord = {
      dayId: dayId,
      businessDate: businessDate,
      branchId: branchId,
      status: 'OPEN',
      openingFloat: round2_(openingFloat),
      openedAt: now,
      openedBy: sessionUser.userId || 'SYSTEM',
      openedByName: sessionUser.name || sessionUser.username || 'Manager',
      openNote: openNote,
      drawerCount: 0,
      cashSales: 0,
      transferSales: 0,
      qrSales: 0,
      otherSales: 0,
      cashIncome: 0,
      cashExpense: 0,
      drawerCashIn: 0,
      drawerCashOut: 0,
      drawerMidDrop: 0,
      expectedCash: round2_(openingFloat),
      actualCash: 0,
      variance: 0,
      cashDrop: 0,
      carryForward: round2_(openingFloat),
      closedAt: '',
      closedBy: '',
      closedByName: '',
      closeNote: ''
    };

    appendRow(SHEETS.BUSINESS_DAYS, dayRecord);

    logAudit(sessionUser.userId, 'OPEN_BUSINESS_DAY', 'BusinessDays', {
      dayId: dayId,
      branchId: branchId,
      businessDate: businessDate,
      openingFloat: openingFloat
    });

    return {
      ok: true,
      message: `เปิดวันทำการ [${businessDate}] สาขา [${branchId}] สำเร็จ`,
      day: dayRecord
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ดึงข้อมูลสรุปพรีวิวการปิดวันทำการ (End-of-Day Z-Report Preview)
 */
function getBusinessDayClosePreview(payload = {}) {
  ensureFinanceSheets_();
  const branchId = String(payload.branchId || 'B01').trim();
  const dayId = String(payload.dayId || '').trim();

  const daysTable = getTable(SHEETS.BUSINESS_DAYS);
  const targetDay = dayId
    ? daysTable.rows.find(d => d.dayId === dayId)
    : daysTable.rows.find(d => d.branchId === branchId && d.status === 'OPEN');

  if (!targetDay) {
    throw new Error('ไม่พบวันทำการที่กำลังเปิดอยู่ของสาขานี้');
  }

  const settingsRes = getFinanceSettings(branchId);
  const st = settingsRes.effective || DEFAULT_FINANCE_SETTINGS_;

  const drawersTable = getTable(SHEETS.CASH_DRAWERS);
  const dayDrawers = drawersTable.rows.filter(d => d.dayId === targetDay.dayId);
  const openDrawers = dayDrawers.filter(d => d.status === 'OPEN');
  const closedDrawers = dayDrawers.filter(d => d.status === 'CLOSED');

  let totalDrawerOpeningFloat = 0;
  let totalDrawerCashSales = 0;
  let totalDrawerTransferSales = 0;
  let totalDrawerQrSales = 0;
  let totalDrawerOtherSales = 0;
  let totalDrawerCashIn = 0;
  let totalDrawerCashOut = 0;
  let totalDrawerMidDrop = 0;
  let totalDrawerExpectedCash = 0;
  let totalDrawerActualCash = 0;
  let totalDrawerVariance = 0;
  let totalDrawerCashDrop = 0;
  let totalDrawerCarryForward = 0;

  dayDrawers.forEach(d => {
    totalDrawerOpeningFloat += parseFloat(d.openingFloat) || 0;
    totalDrawerCashSales += parseFloat(d.cashSales) || 0;
    totalDrawerTransferSales += parseFloat(d.transferSales) || 0;
    totalDrawerQrSales += parseFloat(d.qrSales) || 0;
    totalDrawerOtherSales += parseFloat(d.otherSales) || 0;
    totalDrawerCashIn += parseFloat(d.cashIn) || 0;
    totalDrawerCashOut += parseFloat(d.cashOut) || 0;
    totalDrawerMidDrop += parseFloat(d.midShiftDrop) || 0;
    totalDrawerExpectedCash += parseFloat(d.expectedCash) || 0;
    totalDrawerActualCash += parseFloat(d.actualCash) || 0;
    totalDrawerVariance += parseFloat(d.variance) || 0;
    totalDrawerCashDrop += parseFloat(d.cashDrop) || 0;
    totalDrawerCarryForward += parseFloat(d.carryForward) || 0;
  });

  const salesTable = getTable(SHEETS.SALES);
  let branchCashSales = 0;
  let branchTransferSales = 0;
  let branchQrSales = 0;
  let branchOtherSales = 0;
  let branchPaidCount = 0;
  let branchVoidCount = 0;

  salesTable.rows.forEach(s => {
    if (s.branchId !== branchId) return;
    const matchDay = s.dayId ? (s.dayId === targetDay.dayId) : (formatBangkokDate_(s.ts) === targetDay.businessDate);
    if (!matchDay) return;

    const t = parseFloat(s.total) || 0;
    if (s.status === 'VOID') {
      branchVoidCount++;
    } else {
      branchPaidCount++;
      const pm = String(s.payMethod || '').toUpperCase();
      if (pm === 'CASH') branchCashSales += t;
      else if (pm === 'TRANSFER') branchTransferSales += t;
      else if (pm === 'QR') branchQrSales += t;
      else branchOtherSales += t;
    }
  });

  const txnsTable = getTable(SHEETS.FINANCE_TXNS);
  let cashIncome = 0;
  let cashExpense = 0;

  txnsTable.rows.forEach(tx => {
    if (tx.status === 'VOID' || tx.branchId !== branchId) return;
    const matchDay = tx.dayId ? (tx.dayId === targetDay.dayId) : (tx.txDate === targetDay.businessDate);
    if (!matchDay) return;

    if (tx.payMethod === 'CASH') {
      const amt = parseFloat(tx.amount) || 0;
      if (tx.type === 'INCOME') cashIncome += amt;
      else if (tx.type === 'EXPENSE') cashExpense += amt;
    }
  });

  const effectiveCashSales = dayDrawers.length > 0 ? totalDrawerCashSales : branchCashSales;
  const effectiveTransferSales = dayDrawers.length > 0 ? totalDrawerTransferSales : branchTransferSales;
  const effectiveQrSales = dayDrawers.length > 0 ? totalDrawerQrSales : branchQrSales;
  const effectiveOtherSales = dayDrawers.length > 0 ? totalDrawerOtherSales : branchOtherSales;

  const dayOpeningFloat = parseFloat(targetDay.openingFloat) || 0;
  let expectedCash = 0;
  let actualCash = 0;
  let variance = 0;
  let cashDrop = 0;
  let carryForward = 0;

  if (dayDrawers.length > 0) {
    expectedCash = round2_(totalDrawerActualCash + cashIncome - cashExpense);
    actualCash = round2_(totalDrawerActualCash);
    variance = round2_(totalDrawerVariance);
    cashDrop = round2_(totalDrawerCashDrop);
    carryForward = round2_(totalDrawerCarryForward);
  } else {
    expectedCash = round2_(dayOpeningFloat + effectiveCashSales + cashIncome - cashExpense);
    actualCash = expectedCash;
    variance = 0;
    cashDrop = round2_(Math.max(0, actualCash - dayOpeningFloat));
    carryForward = dayOpeningFloat;
  }

  const canClose = openDrawers.length === 0 || !st.requireCloseAllDrawersBeforeDayClose;

  return {
    ok: true,
    day: targetDay,
    dayId: targetDay.dayId,
    businessDate: targetDay.businessDate,
    branchId: branchId,
    openingFloat: dayOpeningFloat,
    drawerCount: dayDrawers.length,
    openDrawersCount: openDrawers.length,
    closedDrawersCount: closedDrawers.length,
    canClose: canClose,
    openDrawers: openDrawers,
    closedDrawers: closedDrawers,
    allDrawers: dayDrawers,
    cashSales: round2_(effectiveCashSales),
    transferSales: round2_(effectiveTransferSales),
    qrSales: round2_(effectiveQrSales),
    otherSales: round2_(effectiveOtherSales),
    totalSales: round2_(effectiveCashSales + effectiveTransferSales + effectiveQrSales + effectiveOtherSales),
    cashIncome: round2_(cashIncome),
    cashExpense: round2_(cashExpense),
    drawerCashIn: round2_(totalDrawerCashIn),
    drawerCashOut: round2_(totalDrawerCashOut),
    drawerMidDrop: round2_(totalDrawerMidDrop),
    expectedCash: expectedCash,
    actualCash: actualCash,
    variance: variance,
    cashDrop: cashDrop,
    carryForward: carryForward,
    paidBillsCount: branchPaidCount,
    voidBillsCount: branchVoidCount,
    settings: st
  };
}

/**
 * ปิดวันทำการระดับสาขา (Close Business Day / Z-Report)
 */
function closeBusinessDay(payload = {}, sessionUser = {}) {
  ensureFinanceSheets_();
  const branchId = String(payload.branchId || 'B01').trim();
  const dayId = String(payload.dayId || '').trim();
  const closeNote = String(payload.note || payload.closeNote || '').trim();

  const settingsRes = getFinanceSettings(branchId);
  const st = settingsRes.effective || DEFAULT_FINANCE_SETTINGS_;

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const preview = getBusinessDayClosePreview({ branchId, dayId });
    if (!preview.canClose && st.requireCloseAllDrawersBeforeDayClose) {
      const names = preview.openDrawers.map(d => `${d.stationId} (${d.shiftLabel})`).join(', ');
      throw new Error(`ไม่สามารถปิดวันทำการได้: ยังมีลิ้นชักเปิดค้างอยู่ ${preview.openDrawersCount} เครื่อง (${names}) กรุณาปิดลิ้นชักให้ครบก่อน`);
    }

    const actualCash = payload.actualCash !== undefined ? round2_(parseFloat(payload.actualCash) || 0) : preview.actualCash;
    const variance = round2_(actualCash - preview.expectedCash);
    const cashDrop = payload.cashDrop !== undefined ? round2_(parseFloat(payload.cashDrop) || 0) : preview.cashDrop;
    const carryForward = round2_(Math.max(0, actualCash - cashDrop));
    const now = new Date().toISOString();

    updateRows(SHEETS.BUSINESS_DAYS, r => r.dayId === preview.dayId, r => {
      r.status = 'CLOSED';
      r.drawerCount = preview.drawerCount;
      r.cashSales = preview.cashSales;
      r.transferSales = preview.transferSales;
      r.qrSales = preview.qrSales;
      r.otherSales = preview.otherSales;
      r.cashIncome = preview.cashIncome;
      r.cashExpense = preview.cashExpense;
      r.drawerCashIn = preview.drawerCashIn;
      r.drawerCashOut = preview.drawerCashOut;
      r.drawerMidDrop = preview.drawerMidDrop;
      r.expectedCash = preview.expectedCash;
      r.actualCash = actualCash;
      r.variance = variance;
      r.cashDrop = cashDrop;
      r.carryForward = carryForward;
      r.closedAt = now;
      r.closedBy = sessionUser.userId || 'SYSTEM';
      r.closedByName = sessionUser.name || sessionUser.username || 'Manager';
      r.closeNote = closeNote;
      return r;
    });

    const yyyymmdd = preview.businessDate.replace(/-/g, '');
    const counterKey = `CLS_${branchId}_${yyyymmdd}`;
    const runNum = incrementCounter_(counterKey);
    const closingId = `CLS-${branchId}-${yyyymmdd}-${String(runNum).padStart(2, '0')}`;

    appendRow(SHEETS.CASH_CLOSINGS, {
      closingId: closingId,
      ts: now,
      closeDate: preview.businessDate,
      branchId: branchId,
      openingFloat: preview.openingFloat,
      cashSales: preview.cashSales,
      transferSales: preview.transferSales,
      qrSales: preview.qrSales,
      cashIncome: preview.cashIncome,
      cashExpense: preview.cashExpense,
      expectedCash: preview.expectedCash,
      actualCash: actualCash,
      variance: variance,
      cashDrop: cashDrop,
      carryForward: carryForward,
      denomJson: '{}',
      note: `ปิดวันทำการ ${preview.dayId}${closeNote ? ' - ' + closeNote : ''}`,
      status: 'CLOSED',
      userId: sessionUser.userId || 'SYSTEM',
      userName: sessionUser.name || sessionUser.username || 'Manager'
    });

    logAudit(sessionUser.userId, 'CLOSE_BUSINESS_DAY', 'BusinessDays', {
      dayId: preview.dayId,
      branchId: branchId,
      businessDate: preview.businessDate,
      actualCash: actualCash,
      cashDrop: cashDrop,
      variance: variance
    });

    return {
      ok: true,
      message: `ปิดวันทำการ [${preview.businessDate}] ของสาขา [${branchId}] สำเร็จ`,
      dayId: preview.dayId,
      businessDate: preview.businessDate,
      zReport: {
        dayId: preview.dayId,
        businessDate: preview.businessDate,
        branchId: branchId,
        openedAt: preview.day.openedAt,
        openedByName: preview.day.openedByName,
        closedAt: now,
        closedByName: sessionUser.name || sessionUser.username || 'Manager',
        openingFloat: preview.openingFloat,
        drawerCount: preview.drawerCount,
        cashSales: preview.cashSales,
        transferSales: preview.transferSales,
        qrSales: preview.qrSales,
        otherSales: preview.otherSales,
        totalSales: preview.totalSales,
        cashIncome: preview.cashIncome,
        cashExpense: preview.cashExpense,
        expectedCash: preview.expectedCash,
        actualCash: actualCash,
        variance: variance,
        cashDrop: cashDrop,
        carryForward: carryForward,
        closeNote: closeNote
      }
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ดึงประวัติการเปิด-ปิดวันทำการย้อนหลัง
 */
function getBusinessDaysHistory(options = {}) {
  ensureFinanceSheets_();
  const branchId = options.branchId || '';
  const start = options.startDate || '';
  const end = options.endDate || '';

  const table = getTable(SHEETS.BUSINESS_DAYS);
  const rows = table.rows || [];

  const matched = rows.filter(d => {
    if (!d || !d.dayId) return false;
    if (branchId && d.branchId !== branchId) return false;
    if (start && d.businessDate < start) return false;
    if (end && d.businessDate > end) return false;
    return true;
  });

  matched.sort((a, b) => {
    const tA = a.openedAt ? new Date(a.openedAt).getTime() : 0;
    const tB = b.openedAt ? new Date(b.openedAt).getTime() : 0;
    if (tB !== tA) return tB - tA;
    return (b._rowIndex || 0) - (a._rowIndex || 0);
  });

  const limit = Math.max(1, parseInt(options.limit, 10) || 50);
  return {
    ok: true,
    days: matched.slice(0, limit)
  };
}

/**
 * เปิดลิ้นชักประจำเครื่องจุดขายและกะ (Cashier / Manager)
 */
function openCashDrawer(payload = {}, sessionUser = {}) {
  ensureFinanceSheets_();
  const branchId = String(payload.branchId || 'B01').trim();
  const stationId = String(payload.stationId || 'POS-01').trim();
  const shiftLabel = String(payload.shiftLabel || 'กะเช้า').trim();
  const openingFloat = Math.max(0, parseFloat(payload.openingFloat) || 0);
  const openNote = String(payload.note || payload.openNote || '').trim();

  const settingsRes = getFinanceSettings(branchId);
  const st = settingsRes.effective || DEFAULT_FINANCE_SETTINGS_;

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    let activeDay = findRow(SHEETS.BUSINESS_DAYS, r => r.branchId === branchId && r.status === 'OPEN');
    if (!activeDay) {
      if (st.autoOpenDayOnFirstDrawer) {
        const dayRes = openBusinessDay({ branchId, openingFloat }, sessionUser);
        activeDay = dayRes.day;
      } else {
        throw new Error(`ไม่สามารถเปิดลิ้นชักได้: วันทำการของสาขายังไม่ได้เปิด กรุณาให้ผู้จัดการเปิดวันทำการก่อน`);
      }
    }

    const existingDrawer = findRow(SHEETS.CASH_DRAWERS, r => r.branchId === branchId && r.stationId === stationId && r.status === 'OPEN');
    if (existingDrawer) {
      throw new Error(`เครื่องจุดขาย [${stationId}] มีลิ้นชักเปิดอยู่แล้ว (${existingDrawer.shiftLabel} [${existingDrawer.drawerId}]) กรุณาปิดลิ้นชักเดิมก่อน`);
    }

    const cleanDate = activeDay.businessDate.replace(/-/g, '');
    const cleanStation = stationId.replace(/[^A-Za-z0-9]/g, '');
    const todayStationDrawers = findRows(SHEETS.CASH_DRAWERS, r => r.dayId === activeDay.dayId && r.stationId === stationId);
    const seq = String(todayStationDrawers.length + 1).padStart(2, '0');
    const drawerId = `DRW-${cleanDate}-${cleanStation}-${seq}`;

    const now = new Date().toISOString();
    const drawerRecord = {
      drawerId: drawerId,
      dayId: activeDay.dayId,
      businessDate: activeDay.businessDate,
      branchId: branchId,
      stationId: stationId,
      shiftLabel: shiftLabel,
      status: 'OPEN',
      openingFloat: round2_(openingFloat),
      openedAt: now,
      openedBy: sessionUser.userId || 'SYSTEM',
      openedByName: sessionUser.name || sessionUser.username || 'Cashier',
      openNote: openNote,
      cashIn: 0,
      cashOut: 0,
      midShiftDrop: 0,
      movementsJson: '[]',
      cashSales: 0,
      transferSales: 0,
      qrSales: 0,
      otherSales: 0,
      saleCount: 0,
      expectedCash: round2_(openingFloat),
      actualCash: 0,
      variance: 0,
      cashDrop: 0,
      carryForward: round2_(openingFloat),
      denomJson: '{}',
      closedAt: '',
      closedBy: '',
      closedByName: '',
      closeNote: ''
    };

    appendRow(SHEETS.CASH_DRAWERS, drawerRecord);

    updateRows(SHEETS.BUSINESS_DAYS, r => r.dayId === activeDay.dayId, r => {
      r.drawerCount = (parseInt(r.drawerCount) || 0) + 1;
      return r;
    });

    logAudit(sessionUser.userId, 'OPEN_CASH_DRAWER', 'CashDrawers', {
      drawerId: drawerId,
      branchId: branchId,
      stationId: stationId,
      shiftLabel: shiftLabel,
      openingFloat: openingFloat
    });

    return {
      ok: true,
      message: `เปิดลิ้นชัก [${drawerId}] เครื่อง [${stationId}] สำเร็จ`,
      drawer: drawerRecord
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * บันทึกรายการเคลื่อนไหวเงินสดในลิ้นชักระหว่างกะ
 */
function recordDrawerMovement(payload = {}, sessionUser = {}) {
  ensureFinanceSheets_();
  const drawerId = String(payload.drawerId || '').trim();
  const type = String(payload.type || '').trim().toUpperCase();
  const amount = Math.max(0, parseFloat(payload.amount) || 0);
  const reason = String(payload.reason || '').trim();

  if (!drawerId) throw new Error('กรุณาระบุรหัสลิ้นชัก');
  if (!['CASH_IN', 'CASH_OUT', 'CASH_DROP'].includes(type)) {
    throw new Error('ประเภทรายการไม่ถูกต้อง (ต้องเป็น CASH_IN, CASH_OUT หรือ CASH_DROP)');
  }
  if (amount <= 0) throw new Error('จำนวนเงินต้องมากกว่า 0');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const drawer = findRow(SHEETS.CASH_DRAWERS, r => r.drawerId === drawerId);
    if (!drawer) throw new Error(`ไม่พบลิ้นชักรหัส [${drawerId}]`);
    if (drawer.status !== 'OPEN') throw new Error(`ลิ้นชัก [${drawerId}] ได้ปิดกะไปแล้ว`);

    let movements = [];
    try {
      movements = drawer.movementsJson ? JSON.parse(drawer.movementsJson) : [];
      if (!Array.isArray(movements)) movements = [];
    } catch (e) {
      movements = [];
    }

    const now = new Date().toISOString();
    const movId = `MOV-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const movObj = {
      movId: movId,
      ts: now,
      type: type,
      amount: round2_(amount),
      reason: reason,
      userId: sessionUser.userId || 'SYSTEM',
      userName: sessionUser.name || sessionUser.username || 'Cashier'
    };
    movements.push(movObj);

    let updatedDrawer = null;
    updateRows(SHEETS.CASH_DRAWERS, r => r.drawerId === drawerId, r => {
      if (type === 'CASH_IN') r.cashIn = round2_((parseFloat(r.cashIn) || 0) + amount);
      else if (type === 'CASH_OUT') r.cashOut = round2_((parseFloat(r.cashOut) || 0) + amount);
      else if (type === 'CASH_DROP') r.midShiftDrop = round2_((parseFloat(r.midShiftDrop) || 0) + amount);

      const opFloat = parseFloat(r.openingFloat) || 0;
      const cSales = parseFloat(r.cashSales) || 0;
      const cIn = parseFloat(r.cashIn) || 0;
      const cOut = parseFloat(r.cashOut) || 0;
      const mDrop = parseFloat(r.midShiftDrop) || 0;

      r.expectedCash = round2_(opFloat + cSales + cIn - cOut - mDrop);
      r.movementsJson = JSON.stringify(movements);
      updatedDrawer = r;
      return r;
    });

    logAudit(sessionUser.userId, 'DRAWER_MOVEMENT', 'CashDrawers', {
      drawerId: drawerId,
      type: type,
      amount: amount,
      reason: reason
    });

    return {
      ok: true,
      message: `บันทึกรายการเคลื่อนไหวเงินสด [${type}] ฿${amount.toFixed(2)} สำเร็จ`,
      movement: movObj,
      drawer: updatedDrawer
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ดึงข้อมูลพรีวิวสำหรับเตรียมนับเงินปิดลิ้นชัก (Cash Drawer Close Preview)
 */
function getCashDrawerClosePreview(drawerId = '') {
  ensureFinanceSheets_();
  const cleanId = String(drawerId || '').trim();
  if (!cleanId) throw new Error('กรุณาระบุรหัสลิ้นชัก');

  const drawer = findRow(SHEETS.CASH_DRAWERS, r => r.drawerId === cleanId);
  if (!drawer) throw new Error(`ไม่พบลิ้นชักรหัส [${cleanId}]`);

  const settingsRes = getFinanceSettings(drawer.branchId);
  const st = settingsRes.effective || DEFAULT_FINANCE_SETTINGS_;

  const salesTable = getTable(SHEETS.SALES);
  let cashSales = 0;
  let transferSales = 0;
  let qrSales = 0;
  let otherSales = 0;
  let saleCount = 0;

  salesTable.rows.forEach(s => {
    if (s.status === 'VOID') return;
    const matchDrawer = s.drawerId ? (s.drawerId === cleanId) : (
      s.branchId === drawer.branchId &&
      s.stationId === drawer.stationId &&
      s.ts >= drawer.openedAt &&
      (!drawer.closedAt || s.ts <= drawer.closedAt)
    );
    if (!matchDrawer) return;

    const t = parseFloat(s.total) || 0;
    saleCount++;
    const pm = String(s.payMethod || '').toUpperCase();
    if (pm === 'CASH') cashSales += t;
    else if (pm === 'TRANSFER') transferSales += t;
    else if (pm === 'QR') qrSales += t;
    else otherSales += t;
  });

  const openingFloat = parseFloat(drawer.openingFloat) || 0;
  const cashIn = parseFloat(drawer.cashIn) || 0;
  const cashOut = parseFloat(drawer.cashOut) || 0;
  const midShiftDrop = parseFloat(drawer.midShiftDrop) || 0;

  const expectedCash = round2_(openingFloat + cashSales + cashIn - cashOut - midShiftDrop);

  let movements = [];
  try {
    movements = drawer.movementsJson ? JSON.parse(drawer.movementsJson) : [];
  } catch (e) {
    movements = [];
  }

  return {
    ok: true,
    drawer: drawer,
    drawerId: drawer.drawerId,
    dayId: drawer.dayId,
    businessDate: drawer.businessDate,
    stationId: drawer.stationId,
    shiftLabel: drawer.shiftLabel,
    status: drawer.status,
    openingFloat: round2_(openingFloat),
    cashSales: round2_(cashSales),
    transferSales: round2_(transferSales),
    qrSales: round2_(qrSales),
    otherSales: round2_(otherSales),
    saleCount: saleCount,
    cashIn: round2_(cashIn),
    cashOut: round2_(cashOut),
    midShiftDrop: round2_(midShiftDrop),
    expectedCash: expectedCash,
    movements: movements,
    suggestedCarryForward: st.targetCarryForward !== undefined ? st.targetCarryForward : 1000,
    settings: st
  };
}

/**
 * บันทึกนับเงินสดและปิดลิ้นชักส่งกะ (Close Cash Drawer)
 */
function closeCashDrawer(payload = {}, sessionUser = {}) {
  ensureFinanceSheets_();
  const drawerId = String(payload.drawerId || '').trim();
  const actualCash = Math.max(0, parseFloat(payload.actualCash) || 0);
  const cashDrop = Math.max(0, parseFloat(payload.cashDrop) || 0);
  const closeNote = String(payload.note || payload.closeNote || '').trim();
  const denomJson = typeof payload.denomBreakdown === 'object' ? JSON.stringify(payload.denomBreakdown) : (typeof payload.denomCounts === 'object' ? JSON.stringify(payload.denomCounts) : String(payload.denomJson || '{}'));

  if (!drawerId) throw new Error('กรุณาระบุรหัสลิ้นชัก');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const preview = getCashDrawerClosePreview(drawerId);
    if (preview.status === 'CLOSED') {
      throw new Error(`ลิ้นชัก [${drawerId}] ได้ทำการปิดกะไปแล้วก่อนหน้านี้`);
    }

    const variance = round2_(actualCash - preview.expectedCash);
    const carryForward = round2_(Math.max(0, actualCash - cashDrop));
    const now = new Date().toISOString();

    let updatedDrawer = null;
    updateRows(SHEETS.CASH_DRAWERS, r => r.drawerId === drawerId, r => {
      r.status = 'CLOSED';
      r.cashSales = preview.cashSales;
      r.transferSales = preview.transferSales;
      r.qrSales = preview.qrSales;
      r.otherSales = preview.otherSales;
      r.saleCount = preview.saleCount;
      r.expectedCash = preview.expectedCash;
      r.actualCash = round2_(actualCash);
      r.variance = variance;
      r.cashDrop = round2_(cashDrop);
      r.carryForward = carryForward;
      r.denomJson = denomJson;
      r.closedAt = now;
      r.closedBy = sessionUser.userId || 'SYSTEM';
      r.closedByName = sessionUser.name || sessionUser.username || 'Cashier';
      r.closeNote = closeNote;
      updatedDrawer = r;
      return r;
    });

    logAudit(sessionUser.userId, 'CLOSE_CASH_DRAWER', 'CashDrawers', {
      drawerId: drawerId,
      actualCash: actualCash,
      variance: variance,
      cashDrop: cashDrop,
      carryForward: carryForward
    });

    return {
      ok: true,
      message: `ปิดลิ้นชัก [${drawerId}] สำเร็จ (นำส่งเงินสด ฿${cashDrop.toFixed(2)}, เงินทอนยกไป ฿${carryForward.toFixed(2)})`,
      drawer: updatedDrawer,
      slipData: {
        drawerId: drawerId,
        stationId: preview.stationId,
        shiftLabel: preview.shiftLabel,
        businessDate: preview.businessDate,
        openedAt: preview.drawer.openedAt,
        openedByName: preview.drawer.openedByName,
        closedAt: now,
        closedByName: sessionUser.name || sessionUser.username || 'Cashier',
        openingFloat: preview.openingFloat,
        cashSales: preview.cashSales,
        transferSales: preview.transferSales,
        qrSales: preview.qrSales,
        otherSales: preview.otherSales,
        saleCount: preview.saleCount,
        cashIn: preview.cashIn,
        cashOut: preview.cashOut,
        midShiftDrop: preview.midShiftDrop,
        expectedCash: preview.expectedCash,
        actualCash: actualCash,
        variance: variance,
        cashDrop: cashDrop,
        carryForward: carryForward,
        denomBreakdown: payload.denomBreakdown || {},
        closeNote: closeNote
      }
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ดึงรายการลิ้นชักจุดขายตามวันที่และเงื่อนไข
 */
function getCashDrawersList(options = {}) {
  ensureFinanceSheets_();
  const branchId = options.branchId || '';
  const dayId = options.dayId || '';
  const date = options.businessDate || '';
  const stationId = options.stationId || '';
  const status = options.status || '';

  const table = getTable(SHEETS.CASH_DRAWERS);
  const rows = table.rows || [];

  const matched = rows.filter(d => {
    if (!d || !d.drawerId) return false;
    if (branchId && d.branchId !== branchId) return false;
    if (dayId && d.dayId !== dayId) return false;
    if (date && d.businessDate !== date) return false;
    if (stationId && d.stationId !== stationId) return false;
    if (status && d.status !== status) return false;
    return true;
  });

  matched.sort((a, b) => {
    const tA = a.openedAt ? new Date(a.openedAt).getTime() : 0;
    const tB = b.openedAt ? new Date(b.openedAt).getTime() : 0;
    if (tB !== tA) return tB - tA;
    return (b._rowIndex || 0) - (a._rowIndex || 0);
  });

  const limit = Math.max(1, parseInt(options.limit, 10) || 50);
  return {
    ok: true,
    drawers: matched.slice(0, limit)
  };
}
