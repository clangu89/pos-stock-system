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
    const stationId = payload.stationId || 'POS-01';
    const items = payload.items || [];
    const clientTxnId = String(payload.clientTxnId || '').trim();

    if (items.length === 0) {
      throw new Error('ไม่พบรายการสินค้าในบิล');
    }

    const now = payload.ts || new Date().toISOString();
    const targetDate = Utilities.formatDate(new Date(now), 'Asia/Bangkok', 'yyyy-MM-dd');

    // Day & Drawer policy resolution
    let dayId = payload.dayId || '';
    let drawerId = payload.drawerId || '';

    const finSettings = (typeof getFinanceSettings === 'function' ? getFinanceSettings(branchId).settings : null) || {};
    const policy = finSettings.posDayDrawerPolicy || 'WARN';
    const lockAfterClose = finSettings.lockLedgerAfterDayClose !== false;

    // 1) Closed day lock enforcement
    if (lockAfterClose) {
      const closedDay = findRow(SHEETS.BUSINESS_DAYS, r => r.branchId === branchId && r.businessDate === targetDate && r.status === 'CLOSED');
      const openDay = findRow(SHEETS.BUSINESS_DAYS, r => r.branchId === branchId && r.status === 'OPEN');
      if (closedDay && !openDay) {
        throw new Error(`ไม่สามารถทำรายการขายได้: วันทำการ [${targetDate}] ของสาขานี้ได้ถูกปิดวันเรียบร้อยแล้ว`);
      }
    }

    // 2) Resolve active day
    let activeDay = null;
    if (dayId) {
      activeDay = findRow(SHEETS.BUSINESS_DAYS, r => r.dayId === dayId);
    } else {
      activeDay = findRow(SHEETS.BUSINESS_DAYS, r => r.branchId === branchId && r.status === 'OPEN');
      if (activeDay) dayId = activeDay.dayId;
    }

    // 3) Resolve active drawer
    let activeDrawer = null;
    if (drawerId) {
      activeDrawer = findRow(SHEETS.CASH_DRAWERS, r => r.drawerId === drawerId);
    } else {
      activeDrawer = findRow(SHEETS.CASH_DRAWERS, r => r.branchId === branchId && r.stationId === stationId && r.status === 'OPEN');
      if (activeDrawer) drawerId = activeDrawer.drawerId;
    }

    // 4) Enforce STRICT policy if configured
    if (policy === 'STRICT') {
      if (!activeDay || activeDay.status !== 'OPEN') {
        throw new Error('ไม่สามารถคิดเงินได้: ระบบตั้งค่านโยบายเข้มงวด (STRICT) ต้องเปิดวันทำการก่อนเริ่มขาย');
      }
      if (!activeDrawer || activeDrawer.status !== 'OPEN') {
        throw new Error(`ไม่สามารถคิดเงินได้: ลิ้นชักของเครื่องจุดขาย [${stationId}] ยังไม่ได้เปิดกะ`);
      }
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
      // Fast path: ตรวจสอบ CacheService ก่อน (ใช้เวลา ~10ms ไม่ต้องอ่าน Google Sheets)
      const cachedTxn = getScriptCacheJson_('txn_' + clientTxnId);
      if (cachedTxn && cachedTxn.receiptNo && cachedTxn.sale) {
        const isSameCached =
          cachedTxn.sale.status !== 'VOID' &&
          String(cachedTxn.sale.branchId) === String(branchId) &&
          String(cachedTxn.sale.payMethod) === String(payMethod) &&
          round2_(cachedTxn.sale.total) === grandTotal &&
          buildItemsSignature_(cachedTxn.items) === buildItemsSignature_(preparedItems);

        if (isSameCached) {
          const copy = JSON.parse(JSON.stringify(cachedTxn));
          copy.isDuplicate = true;
          return copy;
        }
      }

      // ค้นหาเฉพาะ 50 บิลล่าสุดจากท้ายตาราง
      const recentSales = getRecentSalesRows_(50);
      const matchedSales = recentSales.filter(r => String(r.clientTxnId || '') === clientTxnId);
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

    // 4. Stock Availability Configuration
    const allowNegative = getConfig('ALLOW_NEGATIVE_STOCK', 'false') === 'true';
    const nameMap = {};
    for (let i = 0; i < items.length; i++) {
      nameMap[items[i].sku] = items[i].name || items[i].sku;
    }

    // 5. Generate Receipt Number
    const receiptNo = generateReceiptNo(branch.code || 'MAIN');

    // 6. Record Sale
    const saleRecord = {
      receiptNo: receiptNo,
      ts: now,
      branchId: branchId,
      stationId: stationId,
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
      clientTxnId: effectiveClientTxnId,
      dayId: dayId,
      drawerId: drawerId
    };
    appendRow(SHEETS.SALES, saleRecord);

    // Update real-time drawer stats if open
    if (activeDrawer && activeDrawer.drawerId) {
      updateRows(SHEETS.CASH_DRAWERS, r => r.drawerId === activeDrawer.drawerId, r => {
        const pm = String(payMethod || '').toUpperCase();
        if (pm === 'CASH') {
          r.cashSales = round2_((parseFloat(r.cashSales) || 0) + grandTotal);
          r.expectedCash = round2_((parseFloat(r.expectedCash) || 0) + grandTotal);
        } else if (pm === 'TRANSFER') {
          r.transferSales = round2_((parseFloat(r.transferSales) || 0) + grandTotal);
        } else if (pm === 'QR') {
          r.qrSales = round2_((parseFloat(r.qrSales) || 0) + grandTotal);
        } else {
          r.otherSales = round2_((parseFloat(r.otherSales) || 0) + grandTotal);
        }
        r.saleCount = (parseInt(r.saleCount) || 0) + 1;
        return r;
      });
    }

    // Update real-time day stats if open
    if (activeDay && activeDay.dayId) {
      updateRows(SHEETS.BUSINESS_DAYS, r => r.dayId === activeDay.dayId, r => {
        const pm = String(payMethod || '').toUpperCase();
        if (pm === 'CASH') {
          r.cashSales = round2_((parseFloat(r.cashSales) || 0) + grandTotal);
        } else if (pm === 'TRANSFER') {
          r.transferSales = round2_((parseFloat(r.transferSales) || 0) + grandTotal);
        } else if (pm === 'QR') {
          r.qrSales = round2_((parseFloat(r.qrSales) || 0) + grandTotal);
        } else {
          r.otherSales = round2_((parseFloat(r.otherSales) || 0) + grandTotal);
        }
        return r;
      });
    }

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

    // 8. Deduct Stock via Movements (ตรวจสอบสต๊อกและตัดสต๊อกในรอบเดียว)
    const stockMovements = preparedItems.map(it => ({
      branchId: branchId,
      sku: it.sku,
      type: 'SALE',
      qtyIn: 0,
      qtyOut: it.qty,
      refDoc: receiptNo,
      note: `ขายสินค้า บิลเลขที่ ${receiptNo}`
    }));
    applyStockMovements(stockMovements, sessionUser.userId, { checkAvailability: !allowNegative, nameMap: nameMap });

    logAudit(sessionUser.userId, 'CHECKOUT_SALE', 'Sales', { receiptNo, total: grandTotal, items: preparedItems.length });

    // Store config info for printing resolved via ReceiptTexts
    const storeInfo = getReceiptStoreInfo(branchId);

    const result = {
      ok: true,
      receiptNo: receiptNo,
      sale: saleRecord,
      items: saleItemRows,
      store: storeInfo
    };

    if (clientTxnId) {
      setScriptCacheJson_('txn_' + clientTxnId, result, 300);
    }

    return result;
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

function getRecentSalesRows_(limit = 100) {
  const sheet = getSheet(SHEETS.SALES);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const headers = getSheetHeaders_(SHEETS.SALES, sheet);
  const numRows = Math.min(limit, lastRow - 1);
  const startRow = lastRow - numRows + 1;
  const values = sheet.getRange(startRow, 1, numRows, headers.length).getValues();

  const rows = [];
  for (let i = 0; i < values.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[i][j];
    }
    row._rowIndex = startRow + i;
    rows.push(row);
  }
  return rows;
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
