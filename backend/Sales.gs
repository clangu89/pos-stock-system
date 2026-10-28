/**
 * Sales.gs - Sales Checkout (Atomic with LockService), Voiding, and Receipts
 */

function acquireScriptLock_(timeoutMs) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(timeoutMs || 15000)) {
    throw new Error('ระบบกำลังประมวลผลรายการอื่น กรุณาลองใหม่อีกครั้ง');
  }
  return lock;
}

/**
 * สร้างลายนิ้วมือรายการสินค้า (sku:qty:unitPrice:discount) เพื่อแยกแยะ
 * "การส่งซ้ำเพราะเน็ตสะดุด" ออกจาก "บิลใหม่ที่บังเอิญติด clientTxnId ค้างมาจาก localStorage"
 */
function buildItemsSignature_(list) {
  return (list || [])
    .map(it => {
      const q = round2_(parseFloat(it.qty) || 0);
      const p = round2_(parseFloat(it.unitPrice) || 0);
      const d = round2_(Math.max(0, parseFloat(it.discount) || 0));
      return `${String(it.sku || '').trim()}:${q}:${p}:${d}`;
    })
    .join('|');
}

function checkoutSale(payload, sessionUser) {
  const lock = acquireScriptLock_(15000);
  try {
    const branchId = payload.branchId || 'B01';
    const items = payload.items || [];
    const clientTxnId = String(payload.clientTxnId || '').trim();

    if (items.length === 0) {
      throw new Error('ไม่พบรายการสินค้าในบิล');
    }

    // Read current products for cost prices & item metadata
    const products = getTable(SHEETS.PRODUCTS).rows;
    const productMap = {};
    for (let i = 0; i < products.length; i++) {
      productMap[products[i].sku] = products[i];
    }

    // 1. Calculate Bill Totals First (เพื่อใช้เทียบความตรงกันใน Idempotency Check ด้วย)
    let subtotal = 0;
    const preparedItems = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const qty = parseFloat(it.qty) || 0;
      const unitPrice = parseFloat(it.unitPrice) || 0;
      const discount = round2_(Math.max(0, parseFloat(it.discount) || 0));
      const amount = round2_(Math.max(0, (qty * unitPrice) - discount));
      subtotal = round2_(subtotal + amount);

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

    // ส่วนลดท้ายบิลต้องไม่ติดลบ และไม่เกินยอดรวมรายการ
    const billDiscount = round2_(Math.min(Math.max(0, parseFloat(payload.discount) || 0), subtotal));
    const totalAfterDiscount = round2_(Math.max(0, subtotal - billDiscount));

    // VAT
    const vatRate = parseFloat(getConfig('VAT_RATE', '0')) || 0;
    let vatAmount = 0;
    let grandTotal = totalAfterDiscount;
    if (vatRate > 0) {
      vatAmount = round2_(grandTotal * (vatRate / (100 + vatRate)));
    }

    const payMethod = payload.payMethod || 'CASH'; // CASH, TRANSFER, QR, CARD
    let received = round2_(parseFloat(payload.received) || grandTotal);
    if (payMethod === 'CASH') {
      if (received < grandTotal) {
        throw new Error('ยอดเงินที่รับมาน้อยกว่ายอดที่ต้องชำระ');
      }
    } else {
      // โอน / QR / บัตร: รับเงินเท่ายอดบิลเสมอ ไม่มีเงินทอน
      received = grandTotal;
    }
    const change = round2_(Math.max(0, received - grandTotal));

    // 2. Smart Idempotency Check (เช็คลายนิ้วมือบิล + ยอด + วิธีชำระ + เวลาไม่เกิน 5 นาที)
    let effectiveClientTxnId = clientTxnId || ('TXN_SRV_' + Utilities.getUuid().slice(0, 12));
    if (clientTxnId) {
      const matchedSales = findRows(SHEETS.SALES, r => String(r.clientTxnId || '') === clientTxnId);
      const existingSale = matchedSales.length > 0 ? matchedSales[matchedSales.length - 1] : null;
      if (existingSale) {
        const saleItems = findRows(SHEETS.SALE_ITEMS, r => r.receiptNo === existingSale.receiptNo);
        const existingTs = existingSale.ts ? new Date(existingSale.ts).getTime() : 0;
        const isRecent = existingTs > 0 && Math.abs(Date.now() - existingTs) <= 5 * 60 * 1000;
        const isSamePayload =
          existingSale.status !== 'VOID' &&
          String(existingSale.branchId) === String(branchId) &&
          String(existingSale.payMethod) === String(payMethod) &&
          round2_(existingSale.total) === grandTotal &&
          buildItemsSignature_(saleItems) === buildItemsSignature_(preparedItems);

        if (isRecent && isSamePayload) {
          return {
            ok: true,
            isDuplicate: true,
            receiptNo: existingSale.receiptNo,
            sale: existingSale,
            items: saleItems,
            store: getReceiptStoreInfo(existingSale.branchId || branchId)
          };
        }

        // clientTxnId ชนกับบิลเก่าคนละรายการ/คนละยอด (เช่น ค้างมาจาก localStorage เดิม) -> ออกรหัสใหม่เพื่อให้บันทึกบิลนี้ได้ตามปกติ
        effectiveClientTxnId = `${clientTxnId}_${Utilities.getUuid().slice(0, 8)}`;
      }
    }

    // 3. Fetch Branch info
    const branch = findRow(SHEETS.BRANCHES, r => r.branchId === branchId) || {
      branchId: branchId,
      code: 'MAIN',
      name: 'สำนักงานใหญ่'
    };

    // 4. Stock Availability Check
    const allowNegative = getConfig('ALLOW_NEGATIVE_STOCK', 'false') === 'true';
    const currentBalances = getTable(SHEETS.STOCK_BALANCE).rows;
    const balanceMap = {};
    for (let i = 0; i < currentBalances.length; i++) {
      const r = currentBalances[i];
      if (r.branchId === branchId) {
        balanceMap[r.sku] = parseFloat(r.qty) || 0;
      }
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
      clientTxnId: effectiveClientTxnId
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

    // Store config info for printing resolved via ReceiptTexts
    const storeInfo = getReceiptStoreInfo(branchId);

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

  const lock = acquireScriptLock_(15000);
  try {
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
  const storeInfo = getReceiptStoreInfo(sale.branchId);

  return {
    sale: sale,
    items: items,
    store: storeInfo
  };
}
