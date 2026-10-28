/**
 * Sales.gs - Sales Checkout (Atomic with LockService), Voiding, and Receipts
 */

function checkoutSale(payload, sessionUser) {
  const lock = LockService.getScriptLock();
  try {
    const success = lock.waitLock(15000); // 15 seconds wait
    if (!success) {
      throw new Error('ระบบกำลังประมวลผลรายการอื่น กรุณาลองใหม่อีกครั้ง');
    }

    const branchId = payload.branchId || 'B01';
    const items = payload.items || [];
    const clientTxnId = payload.clientTxnId || '';

    if (items.length === 0) {
      throw new Error('ไม่พบรายการสินค้าในบิล');
    }

    // 1. Idempotency Check
    if (clientTxnId) {
      const existingSale = findRow(SHEETS.SALES, r => r.clientTxnId === clientTxnId);
      if (existingSale) {
        const saleItems = findRows(SHEETS.SALE_ITEMS, r => r.receiptNo === existingSale.receiptNo);
        return {
          ok: true,
          isDuplicate: true,
          sale: existingSale,
          items: saleItems
        };
      }
    }

    // 2. Fetch Branch info
    const branch = findRow(SHEETS.BRANCHES, r => r.branchId === branchId) || {
      branchId: branchId,
      code: 'MAIN',
      name: 'สำนักงานใหญ่'
    };

    // 3. Stock Availability Check
    const allowNegative = getConfig('ALLOW_NEGATIVE_STOCK', 'false') === 'true';
    const currentBalances = getTable(SHEETS.STOCK_BALANCE).rows;
    const balanceMap = {};
    for (let i = 0; i < currentBalances.length; i++) {
      const r = currentBalances[i];
      if (r.branchId === branchId) {
        balanceMap[r.sku] = parseFloat(r.qty) || 0;
      }
    }

    // Read current products for cost prices
    const products = getTable(SHEETS.PRODUCTS).rows;
    const productMap = {};
    for (let i = 0; i < products.length; i++) {
      productMap[products[i].sku] = products[i];
    }

    if (!allowNegative) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const reqQty = parseFloat(it.qty) || 0;
        const currStock = balanceMap[it.sku] !== undefined ? balanceMap[it.sku] : 0;
        if (reqQty > currStock) {
          throw new Error(`สินค้า "${it.name || it.sku}" มีสต๊อกคงเหลือไม่พอ (คงเหลือ ${currStock}, ขอซื้อ ${reqQty})`);
        }
      }
    }

    // 4. Calculate Bill Totals
    let subtotal = 0;
    const preparedItems = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const qty = parseFloat(it.qty) || 0;
      const unitPrice = parseFloat(it.unitPrice) || 0;
      const discount = parseFloat(it.discount) || 0;
      const amount = Math.max(0, (qty * unitPrice) - discount);
      subtotal += amount;

      const pInfo = productMap[it.sku] || {};
      const unitCost = parseFloat(pInfo.costPrice) || 0;

      preparedItems.push({
        lineNo: i + 1,
        sku: it.sku,
        barcode: it.barcode || pInfo.barcode || '',
        name: it.name || pInfo.name || it.sku,
        qty: qty,
        unitPrice: unitPrice,
        unitCost: unitCost,
        discount: discount,
        amount: amount
      });
    }

    const billDiscount = parseFloat(payload.discount) || 0;
    const totalAfterDiscount = Math.max(0, subtotal - billDiscount);

    // VAT
    const vatRate = parseFloat(getConfig('VAT_RATE', '0')) || 0;
    let vatAmount = 0;
    let grandTotal = totalAfterDiscount;
    if (vatRate > 0) {
      vatAmount = Math.round((grandTotal * (vatRate / (100 + vatRate))) * 100) / 100;
    }

    const received = parseFloat(payload.received) || grandTotal;
    const change = Math.max(0, received - grandTotal);
    const payMethod = payload.payMethod || 'CASH'; // CASH, TRANSFER, QR, CARD

    // 5. Generate Receipt Number
    const receiptNo = generateReceiptNo(branch.code || 'MAIN');
    const now = new Date().toISOString();

    // 6. Record Sale
    const saleRecord = {
      receiptNo: receiptNo,
      ts: now,
      branchId: branchId,
      stationId: payload.stationId || 'POS-01',
      userId: sessionUser.userId,
      cashierName: sessionUser.name || sessionUser.username,
      subtotal: subtotal,
      discount: billDiscount,
      vat: vatAmount,
      total: grandTotal,
      received: received,
      change: change,
      payMethod: payMethod,
      status: 'PAID',
      voidBy: '',
      voidAt: '',
      voidReason: '',
      clientTxnId: clientTxnId
    };
    appendRow(SHEETS.SALES, saleRecord);

    // 7. Record Sale Items
    const saleItemRows = preparedItems.map(it => ({
      receiptNo: receiptNo,
      lineNo: it.lineNo,
      sku: it.sku,
      barcode: it.barcode,
      name: it.name,
      qty: it.qty,
      unitPrice: it.unitPrice,
      unitCost: it.unitCost,
      discount: it.discount,
      amount: it.amount
    }));
    appendRows(SHEETS.SALE_ITEMS, saleItemRows);

    // 8. Deduct Stock via Movements
    const stockMovements = preparedItems.map(it => ({
      branchId: branchId,
      sku: it.sku,
      type: 'SALE',
      qtyIn: 0,
      qtyOut: it.qty,
      refDoc: receiptNo,
      note: `ขายสินค้า บิลเลขที่ ${receiptNo}`
    }));
    applyStockMovements(stockMovements, sessionUser.userId);

    logAudit(sessionUser.userId, 'CHECKOUT_SALE', 'Sales', { receiptNo, total: grandTotal, items: preparedItems.length });

    // Store config info for printing
    const storeInfo = {
      name: getConfig('STORE_NAME', 'POS Store'),
      address: branch.address || getConfig('STORE_ADDRESS', ''),
      phone: branch.phone || getConfig('STORE_PHONE', ''),
      taxId: branch.taxId || getConfig('STORE_TAX_ID', ''),
      footer: getConfig('RECEIPT_FOOTER', 'ขอบคุณที่ใช้บริการ')
    };

    return {
      ok: true,
      receiptNo: receiptNo,
      sale: saleRecord,
      items: saleItemRows,
      store: storeInfo
    };
  } finally {
    lock.releaseLock();
  }
}

function voidReceipt(receiptNo, reason, sessionUser) {
  if (!receiptNo || !reason) {
    throw new Error('กรุณาระบุเลขที่ใบเสร็จและเหตุผลในการยกเลิก');
  }

  const lock = LockService.getScriptLock();
  try {
    const success = lock.waitLock(15000);
    if (!success) {
      throw new Error('ระบบกำลังประมวลผลรายการอื่น กรุณาลองใหม่อีกครั้ง');
    }

    const sale = findRow(SHEETS.SALES, r => r.receiptNo === receiptNo);
    if (!sale) {
      throw new Error(`ไม่พบใบเสร็จเลขที่ ${receiptNo}`);
    }

    if (sale.status === 'VOID') {
      throw new Error(`ใบเสร็จเลขที่ ${receiptNo} ได้ถูกยกเลิกไปแล้วก่อนหน้านี้`);
    }

    const now = new Date().toISOString();

    // Mark as VOID
    updateRows(SHEETS.SALES, r => r.receiptNo === receiptNo, r => {
      r.status = 'VOID';
      r.voidBy = sessionUser.userId;
      r.voidAt = now;
      r.voidReason = reason;
      return r;
    });

    // Return items back into stock
    const saleItems = findRows(SHEETS.SALE_ITEMS, r => r.receiptNo === receiptNo);
    const returnMovements = saleItems.map(it => ({
      branchId: sale.branchId,
      sku: it.sku,
      type: 'VOID',
      qtyIn: parseFloat(it.qty) || 0,
      qtyOut: 0,
      refDoc: receiptNo,
      note: `ยกเลิกบิล ${receiptNo}: ${reason}`
    }));

    if (returnMovements.length > 0) {
      applyStockMovements(returnMovements, sessionUser.userId);
    }

    logAudit(sessionUser.userId, 'VOID_RECEIPT', 'Sales', { receiptNo, reason });

    return {
      ok: true,
      receiptNo: receiptNo,
      message: `ยกเลิกใบเสร็จเลขที่ ${receiptNo} เรียบร้อยแล้ว (คืนสต๊อกสำเร็จ)`
    };
  } finally {
    lock.releaseLock();
  }
}

function getRecentSales(branchId = '', limit = 50) {
  const sales = findRows(SHEETS.SALES, r => !branchId || r.branchId === branchId);
  return sales.reverse().slice(0, limit);
}

function getReceiptDetails(receiptNo) {
  const sale = findRow(SHEETS.SALES, r => r.receiptNo === receiptNo);
  if (!sale) throw new Error('ไม่พบข้อมูลใบเสร็จ');

  const items = findRows(SHEETS.SALE_ITEMS, r => r.receiptNo === receiptNo);
  const branch = findRow(SHEETS.BRANCHES, r => r.branchId === sale.branchId) || {};

  const storeInfo = {
    name: getConfig('STORE_NAME', 'POS Store'),
    address: branch.address || getConfig('STORE_ADDRESS', ''),
    phone: branch.phone || getConfig('STORE_PHONE', ''),
    taxId: branch.taxId || getConfig('STORE_TAX_ID', ''),
    footer: getConfig('RECEIPT_FOOTER', 'ขอบคุณที่ใช้บริการ')
  };

  return {
    sale: sale,
    items: items,
    store: storeInfo
  };
}
