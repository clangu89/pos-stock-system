/**
 * Stock.gs - Inventory Management, Ledger Movements, Adjustments, Transfers
 */

function applyStockMovements(movements, userId = 'SYSTEM') {
  if (!movements || movements.length === 0) return [];
  const now = new Date().toISOString();
  const balanceTable = getTable(SHEETS.STOCK_BALANCE);

  // Group current balances: key = branchId + '_' + sku
  const balanceMap = {};
  for (let i = 0; i < balanceTable.rows.length; i++) {
    const row = balanceTable.rows[i];
    const key = `${row.branchId}_${row.sku}`;
    balanceMap[key] = {
      qty: parseFloat(row.qty) || 0,
      rowIndex: row._rowIndex
    };
  }

  const ledgerEntries = [];
  const balanceUpdates = [];
  const balanceAppends = [];

  for (let i = 0; i < movements.length; i++) {
    const m = movements[i];
    const key = `${m.branchId}_${m.sku}`;
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

  // Update StockBalance sheet
  for (const key in balanceMap) {
    const parts = key.split('_');
    const branchId = parts[0];
    const sku = parts.slice(1).join('_');
    const item = balanceMap[key];

    if (item.rowIndex) {
      updateRows(SHEETS.STOCK_BALANCE, r => r.branchId === branchId && r.sku === sku, r => {
        r.qty = item.qty;
        r.updatedAt = now;
        return r;
      });
    } else {
      balanceAppends.push({
        branchId: branchId,
        sku: sku,
        qty: item.qty,
        updatedAt: now
      });
    }
  }

  if (balanceAppends.length > 0) {
    appendRows(SHEETS.STOCK_BALANCE, balanceAppends);
  }

  // Append movements to ledger
  if (ledgerEntries.length > 0) {
    appendRows(SHEETS.STOCK_MOVEMENTS, ledgerEntries);
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
