/**
 * Stock.gs - Inventory Management, Ledger Movements, Adjustments, Transfers
 */

function applyStockMovements(movements, userId = 'SYSTEM', options = {}) {
  if (!movements || movements.length === 0) return [];
  const now = new Date().toISOString();

  // Read StockBalance ONCE directly from sheet
  const balanceSheet = getSheet(SHEETS.STOCK_BALANCE);
  const dataRange = balanceSheet.getDataRange();
  const rawValues = dataRange.getValues();

  const headers = rawValues.length > 0 ? rawValues[0].map(h => String(h).trim()) : [];
  const branchCol = headers.indexOf('branchId');
  const skuCol = headers.indexOf('sku');
  const qtyCol = headers.indexOf('qty');
  const updatedCol = headers.indexOf('updatedAt');

  // Group current balances: key = branchId + '_' + sku
  const balanceMap = {};
  for (let i = 1; i < rawValues.length; i++) {
    const bId = rawValues[i][branchCol];
    const sSku = rawValues[i][skuCol];
    const key = `${bId}_${sSku}`;
    balanceMap[key] = {
      qty: parseFloat(rawValues[i][qtyCol]) || 0,
      rowIndex: i + 1
    };
  }

  // Pre-validate stock availability in-memory if requested (avoids redundant StockBalance read)
  if (options && options.checkAvailability) {
    const nameMap = options.nameMap || {};
    for (let i = 0; i < movements.length; i++) {
      const m = movements[i];
      const reqQty = parseFloat(m.qtyOut) || 0;
      if (reqQty > 0) {
        const key = `${m.branchId}_${m.sku}`;
        const curr = balanceMap[key] ? balanceMap[key].qty : 0;
        if (reqQty > curr) {
          const itemName = nameMap[m.sku] || m.sku;
          throw new Error(`สินค้า "${itemName}" มีสต๊อกคงเหลือไม่พอ (คงเหลือ ${curr}, ขอซื้อ ${reqQty})`);
        }
      }
    }
  }

  const ledgerEntries = [];
  const balanceAppends = [];
  const touchedKeys = new Set();

  for (let i = 0; i < movements.length; i++) {
    const m = movements[i];
    const key = `${m.branchId}_${m.sku}`;
    touchedKeys.add(key);
    const curr = balanceMap[key] ? balanceMap[key].qty : 0;
    const qtyIn = parseFloat(m.qtyIn) || 0;
    const qtyOut = parseFloat(m.qtyOut) || 0;
    const newBalance = curr + qtyIn - qtyOut;

    balanceMap[key] = {
      qty: newBalance,
      rowIndex: balanceMap[key] ? balanceMap[key].rowIndex : null
    };

    const movId = 'MOV_' + Utilities.getUuid().substring(0, 8).toUpperCase();
    ledgerEntries.push({
      movId: movId,
      ts: now,
      branchId: m.branchId,
      sku: m.sku,
      type: m.type,
      qtyIn: qtyIn,
      qtyOut: qtyOut,
      balanceAfter: newBalance,
      refDoc: m.refDoc || '',
      userId: userId,
      note: m.note || ''
    });
  }

  if (rawValues.length > 1) {
    const headers = rawValues[0].map(h => String(h).trim());
    const branchCol = headers.indexOf('branchId');
    const skuCol = headers.indexOf('sku');
    const qtyCol = headers.indexOf('qty');
    const updatedCol = headers.indexOf('updatedAt');

    let modified = false;
    for (let r = 1; r < rawValues.length; r++) {
      const bId = rawValues[r][branchCol];
      const sSku = rawValues[r][skuCol];
      const key = `${bId}_${sSku}`;
      if (touchedKeys.has(key)) {
        if (qtyCol >= 0) rawValues[r][qtyCol] = balanceMap[key].qty;
        if (updatedCol >= 0) rawValues[r][updatedCol] = now;
        modified = true;
      }
    }
    if (modified) {
      dataRange.setValues(rawValues);
      delete _tableCache[SHEETS.STOCK_BALANCE];
    }
  }

  // Handle new SKU appends for SKUs that were not previously in StockBalance
  touchedKeys.forEach(key => {
    const item = balanceMap[key];
    if (!item || !item.rowIndex) {
      const parts = key.split('_');
      balanceAppends.push({
        branchId: parts[0],
        sku: parts.slice(1).join('_'),
        qty: item ? item.qty : 0,
        updatedAt: now
      });
    }
  });

  if (balanceAppends.length > 0) {
    appendRows(SHEETS.STOCK_BALANCE, balanceAppends);
  }

  // Append movements to ledger
  if (ledgerEntries.length > 0) {
    appendRows(SHEETS.STOCK_MOVEMENTS, ledgerEntries);
    delete _tableCache[SHEETS.STOCK_BALANCE];
    delete _tableCache[SHEETS.STOCK_MOVEMENTS];
  }

  return ledgerEntries;
}

function receiveStock(payload, sessionUser) {
  const branchId = payload.branchId;
  const items = payload.items || [];
  const note = payload.note || '';

  if (!branchId || items.length === 0) {
    throw new Error('กรุณาระบุสาขาและรายการสินค้าที่รับเข้า');
  }

  const docNo = 'RCV-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss');
  const movements = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const qty = parseFloat(item.qty) || 0;
    if (qty <= 0) continue;

    movements.push({
      branchId: branchId,
      sku: item.sku,
      type: 'RECEIVE',
      qtyIn: qty,
      qtyOut: 0,
      refDoc: docNo,
      note: note
    });

    // Optionally update cost price on product
    if (item.costPrice && parseFloat(item.costPrice) > 0) {
      updateRows(SHEETS.PRODUCTS, r => r.sku === item.sku, r => {
        r.costPrice = parseFloat(item.costPrice);
        r.updatedAt = new Date().toISOString();
        return r;
      });
    }
  }

  applyStockMovements(movements, sessionUser.userId);

  appendRow(SHEETS.STOCK_DOCS, {
    docNo: docNo,
    type: 'RECEIVE',
    branchId: branchId,
    toBranchId: '',
    status: 'COMPLETED',
    itemsJson: JSON.stringify(items),
    userId: sessionUser.userId,
    note: note,
    createdAt: new Date().toISOString()
  });

  logAudit(sessionUser.userId, 'RECEIVE_STOCK', 'Stock', { docNo, branchId, itemCount: items.length });
  return { ok: true, docNo: docNo };
}

function adjustStock(payload, sessionUser) {
  const branchId = payload.branchId;
  const items = payload.items || [];
  const note = payload.note || 'ปรับปรุงยอดตรวจนับ';

  if (!branchId || items.length === 0) {
    throw new Error('กรุณาระบุสาขาและรายการสินค้าที่ต้องการปรับปรุง');
  }

  const docNo = 'ADJ-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss');
  const currentBalances = getTable(SHEETS.STOCK_BALANCE).rows;
  const balanceMap = {};
  for (let i = 0; i < currentBalances.length; i++) {
    const r = currentBalances[i];
    if (r.branchId === branchId) {
      balanceMap[r.sku] = parseFloat(r.qty) || 0;
    }
  }

  const movements = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const actualQty = parseFloat(item.actualQty);
    if (isNaN(actualQty)) continue;

    const currQty = balanceMap[item.sku] !== undefined ? balanceMap[item.sku] : 0;
    const diff = actualQty - currQty;

    if (diff > 0) {
      movements.push({
        branchId: branchId,
        sku: item.sku,
        type: 'ADJUST',
        qtyIn: diff,
        qtyOut: 0,
        refDoc: docNo,
        note: `นับได้จริง ${actualQty} (เดิม ${currQty}): ${item.note || note}`
      });
    } else if (diff < 0) {
      movements.push({
        branchId: branchId,
        sku: item.sku,
        type: 'ADJUST',
        qtyIn: 0,
        qtyOut: Math.abs(diff),
        refDoc: docNo,
        note: `นับได้จริง ${actualQty} (เดิม ${currQty}): ${item.note || note}`
      });
    }
  }

  if (movements.length > 0) {
    applyStockMovements(movements, sessionUser.userId);
  }

  appendRow(SHEETS.STOCK_DOCS, {
    docNo: docNo,
    type: 'ADJUST',
    branchId: branchId,
    toBranchId: '',
    status: 'COMPLETED',
    itemsJson: JSON.stringify(items),
    userId: sessionUser.userId,
    note: note,
    createdAt: new Date().toISOString()
  });

  logAudit(sessionUser.userId, 'ADJUST_STOCK', 'Stock', { docNo, branchId, itemCount: items.length });
  return { ok: true, docNo: docNo, adjustedCount: movements.length };
}

function transferStock(payload, sessionUser) {
  const fromBranchId = payload.fromBranchId;
  const toBranchId = payload.toBranchId;
  const items = payload.items || [];
  const note = payload.note || '';

  if (!fromBranchId || !toBranchId || fromBranchId === toBranchId || items.length === 0) {
    throw new Error('กรุณาระบุสาขาต้นทาง สาขาปลายทาง (ต้องไม่ซ้ำกัน) และรายการสินค้า');
  }

  // Check sufficient balance at fromBranch
  const allowNegative = getConfig('ALLOW_NEGATIVE_STOCK', 'false') === 'true';
  const currentBalances = getTable(SHEETS.STOCK_BALANCE).rows;
  const fromBalanceMap = {};
  for (let i = 0; i < currentBalances.length; i++) {
    const r = currentBalances[i];
    if (r.branchId === fromBranchId) {
      fromBalanceMap[r.sku] = parseFloat(r.qty) || 0;
    }
  }

  if (!allowNegative) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const reqQty = parseFloat(it.qty) || 0;
      const curr = fromBalanceMap[it.sku] || 0;
      if (reqQty > curr) {
        throw new Error(`สินค้า SKU ${it.sku} ในสาขาต้นทางมีไม่พอสำหรับโอนย้าย (มี ${curr}, ขอโอน ${reqQty})`);
      }
    }
  }

  const docNo = 'TRF-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss');
  const movements = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const qty = parseFloat(it.qty) || 0;
    if (qty <= 0) continue;

    // TRANSFER OUT
    movements.push({
      branchId: fromBranchId,
      sku: it.sku,
      type: 'TRANSFER_OUT',
      qtyIn: 0,
      qtyOut: qty,
      refDoc: docNo,
      note: `โอนไปสาขา ${toBranchId}: ${note}`
    });

    // TRANSFER IN
    movements.push({
      branchId: toBranchId,
      sku: it.sku,
      type: 'TRANSFER_IN',
      qtyIn: qty,
      qtyOut: 0,
      refDoc: docNo,
      note: `รับโอนมาจากสาขา ${fromBranchId}: ${note}`
    });
  }

  applyStockMovements(movements, sessionUser.userId);

  appendRow(SHEETS.STOCK_DOCS, {
    docNo: docNo,
    type: 'TRANSFER',
    branchId: fromBranchId,
    toBranchId: toBranchId,
    status: 'COMPLETED',
    itemsJson: JSON.stringify(items),
    userId: sessionUser.userId,
    note: note,
    createdAt: new Date().toISOString()
  });

  logAudit(sessionUser.userId, 'TRANSFER_STOCK', 'Stock', { docNo, fromBranchId, toBranchId, itemCount: items.length });
  return { ok: true, docNo: docNo };
}

function getStockCard(sku, branchId, limit = 100) {
  const movs = findRows(SHEETS.STOCK_MOVEMENTS, r => {
    if (sku && r.sku !== sku) return false;
    if (branchId && r.branchId !== branchId) return false;
    return true;
  });

  return movs.reverse().slice(0, limit);
}
