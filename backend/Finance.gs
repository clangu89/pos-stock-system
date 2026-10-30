/**
 * Finance.gs - Cash Flow, Petty Cash Income/Expense Ledger, and Daily Cash Drawer Closings
 */

let _financeSheetsEnsured = false;
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

  _financeSheetsEnsured = true;
}

/**
 * ดึงภาพรวมการเงินและกระแสเงินสด (Cash Flow & Financial Summary)
 */
function getFinanceOverview(startDateStr, endDateStr, branchId = '') {
  ensureFinanceSheets_();

  const start = startDateStr ? new Date(startDateStr + 'T00:00:00') : new Date(Date.now() - 30 * 86400000);
  const end = endDateStr ? new Date(endDateStr + 'T23:59:59') : new Date();

  // 1. Sales Data
  const salesTable = getTable(SHEETS.SALES);
  const itemsTable = getTable(SHEETS.SALE_ITEMS);

  const inRange = (s) => {
    if (branchId && s.branchId !== branchId) return false;
    const sDate = new Date(s.ts);
    return sDate >= start && sDate <= end;
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
    if (pm === 'CASH') cashSales += t;
    else if (pm === 'TRANSFER') transferSales += t;
    else if (pm === 'QR') qrSales += t;
    else otherSales += t;

    const dayKey = Utilities.formatDate(new Date(s.ts), 'Asia/Bangkok', 'yyyy-MM-dd');
    if (!dailyMap[dayKey]) {
      dailyMap[dayKey] = {
        date: dayKey,
        cashSales: 0,
        bankSales: 0,
        otherIncome: 0,
        expense: 0,
        salesCost: 0,
        netFlow: 0,
        netProfit: 0
      };
    }
    if (pm === 'CASH') dailyMap[dayKey].cashSales += t;
    else dailyMap[dayKey].bankSales += t;
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
    const txDateStr = tx.txDate || (tx.ts ? Utilities.formatDate(new Date(tx.ts), 'Asia/Bangkok', 'yyyy-MM-dd') : '');
    if (txDateStr) {
      const d = new Date(txDateStr + 'T12:00:00');
      if (d < start || d > end) return;
    }

    const amt = parseFloat(tx.amount) || 0;
    const isCash = (tx.payMethod === 'CASH');

    if (tx.type === 'INCOME') {
      otherIncomeTotal += amt;
      if (isCash) cashIncome += amt;
      else bankIncome += amt;

      if (txDateStr) {
        if (!dailyMap[txDateStr]) {
          dailyMap[txDateStr] = { date: txDateStr, cashSales: 0, bankSales: 0, otherIncome: 0, expense: 0, salesCost: 0, netFlow: 0, netProfit: 0 };
        }
        dailyMap[txDateStr].otherIncome += amt;
      }
    } else if (tx.type === 'EXPENSE') {
      expenseTotal += amt;
      if (isCash) cashExpense += amt;
      else bankExpense += amt;

      const cat = String(tx.category || 'ค่าใช้จ่ายทั่วไป').trim();
      if (!categoryMap[cat]) categoryMap[cat] = { category: cat, totalAmount: 0, count: 0 };
      categoryMap[cat].totalAmount += amt;
      categoryMap[cat].count += 1;

      if (txDateStr) {
        if (!dailyMap[txDateStr]) {
          dailyMap[txDateStr] = { date: txDateStr, cashSales: 0, bankSales: 0, otherIncome: 0, expense: 0, salesCost: 0, netFlow: 0, netProfit: 0 };
        }
        dailyMap[txDateStr].expense += amt;
      }
    }
  });

  // Calculate daily flow summaries
  const dailyFlow = Object.keys(dailyMap).sort().map(k => {
    const d = dailyMap[k];
    d.cashSales = round2_(d.cashSales);
    d.bankSales = round2_(d.bankSales);
    d.otherIncome = round2_(d.otherIncome);
    d.expense = round2_(d.expense);
    d.salesCost = round2_(d.salesCost);
    d.netFlow = round2_((d.cashSales + d.bankSales + d.otherIncome) - d.expense);
    const grossDay = (d.cashSales + d.bankSales) - d.salesCost;
    d.netProfit = round2_(grossDay + d.otherIncome - d.expense);
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

  return {
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

  const start = options.startDate ? new Date(options.startDate + 'T00:00:00') : null;
  const end = options.endDate ? new Date(options.endDate + 'T23:59:59') : null;
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
      const d = new Date(rDateStr + 'T12:00:00');
      if (start && d < start) continue;
      if (end && d > end) continue;
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
      voidReason: ''
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
    const sDate = s.ts ? Utilities.formatDate(new Date(s.ts), 'Asia/Bangkok', 'yyyy-MM-dd') : '';
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
    const txDate = tx.txDate || (tx.ts ? Utilities.formatDate(new Date(tx.ts), 'Asia/Bangkok', 'yyyy-MM-dd') : '');
    if (txDate !== closeDate) return;

    if (tx.payMethod === 'CASH') {
      const amt = parseFloat(tx.amount) || 0;
      if (tx.type === 'INCOME') cashIncome += amt;
      else if (tx.type === 'EXPENSE') cashExpense += amt;
    }
  });

  // 3. Find suggested opening float from previous closing of this branch
  const closingsTable = getTable(SHEETS.CASH_CLOSINGS);
  const branchClosings = closingsTable.rows
    .filter(c => c.branchId === targetBranch && c.status !== 'VOID')
    .sort((a, b) => new Date(b.ts || 0).getTime() - new Date(a.ts || 0).getTime());

  let suggestedFloat = parseFloat(getConfig('DEFAULT_OPENING_FLOAT', '1000')) || 1000;
  if (branchClosings.length > 0) {
    const prevCarry = parseFloat(branchClosings[0].carryForward);
    if (!isNaN(prevCarry) && prevCarry >= 0) {
      suggestedFloat = prevCarry;
    }
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
    existingClosings: existingClosings
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
  const denomJson = typeof data.denomCounts === 'object' ? JSON.stringify(data.denomCounts) : String(data.denomJson || '{}');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // Re-verify figures authoritatively
    const preview = getCashClosingPreview(closeDate, branchId);
    const expectedCash = round2_(openingFloat + preview.cashSales + preview.cashIncome - preview.cashExpense);
    const variance = round2_(actualCash - expectedCash);
    const carryForward = round2_(Math.max(0, actualCash - cashDrop));

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
