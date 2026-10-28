/**
 * Reports.gs - Sales Analysis, Daily Summaries, Top Selling, and Stock Valuation
 */

function getDailySalesReport(startDateStr, endDateStr, branchId = '') {
  const salesTable = getTable(SHEETS.SALES);
  const itemsTable = getTable(SHEETS.SALE_ITEMS);

  const start = startDateStr ? new Date(startDateStr + 'T00:00:00') : new Date(Date.now() - 30 * 86400000);
  const end = endDateStr ? new Date(endDateStr + 'T23:59:59') : new Date();

  // Filter valid sales
  const inRange = (s) => {
    if (branchId && s.branchId !== branchId) return false;
    const sDate = new Date(s.ts);
    return sDate >= start && sDate <= end;
  };
  const validSales = salesTable.rows.filter(s => s.status !== 'VOID' && inRange(s));

  // บิลที่ยกเลิก (แสดงแยกเพื่อให้เทียบกับใบเสร็จได้ครบทุกใบ ไม่นับรวมในยอดขายสุทธิ)
  const voidSales = salesTable.rows.filter(s => s.status === 'VOID' && inRange(s));
  let voidAmount = 0;
  for (let i = 0; i < voidSales.length; i++) {
    voidAmount += parseFloat(voidSales[i].total) || 0;
  }

  // Map receipt costs from items
  const validReceiptNos = new Set(validSales.map(s => s.receiptNo));
  const receiptCostMap = {};
  for (let i = 0; i < itemsTable.rows.length; i++) {
    const it = itemsTable.rows[i];
    if (validReceiptNos.has(it.receiptNo)) {
      const lineCost = (parseFloat(it.qty) || 0) * (parseFloat(it.unitCost) || 0);
      receiptCostMap[it.receiptNo] = (receiptCostMap[it.receiptNo] || 0) + lineCost;
    }
  }

  // Aggregate by Date (yyyy-MM-dd)
  const dailyMap = {};
  let overallTotal = 0;
  let overallCost = 0;
  let overallDiscount = 0;
  let cashTotal = 0;
  let transferTotal = 0;

  for (let i = 0; i < validSales.length; i++) {
    const s = validSales[i];
    const dayKey = Utilities.formatDate(new Date(s.ts), 'Asia/Bangkok', 'yyyy-MM-dd');
    if (!dailyMap[dayKey]) {
      dailyMap[dayKey] = {
        date: dayKey,
        billsCount: 0,
        subtotal: 0,
        discount: 0,
        total: 0,
        cost: 0,
        profit: 0
      };
    }

    const t = parseFloat(s.total) || 0;
    const sub = parseFloat(s.subtotal) || 0;
    const disc = parseFloat(s.discount) || 0;
    const cost = receiptCostMap[s.receiptNo] || 0;

    dailyMap[dayKey].billsCount += 1;
    dailyMap[dayKey].subtotal += sub;
    dailyMap[dayKey].discount += disc;
    dailyMap[dayKey].total += t;
    dailyMap[dayKey].cost += cost;
    dailyMap[dayKey].profit += (t - cost);

    overallTotal += t;
    overallCost += cost;
    overallDiscount += disc;

    if (s.payMethod === 'CASH') {
      cashTotal += t;
    } else {
      transferTotal += t;
    }
  }

  const daysList = Object.keys(dailyMap).sort().map(k => {
    const d = dailyMap[k];
    d.subtotal = round2_(d.subtotal);
    d.discount = round2_(d.discount);
    d.total = round2_(d.total);
    d.cost = round2_(d.cost);
    d.profit = round2_(d.profit);
    return d;
  });

  return {
    summary: {
      totalBills: validSales.length,
      totalSales: round2_(overallTotal),
      totalCost: round2_(overallCost),
      totalProfit: round2_(overallTotal - overallCost),
      totalDiscount: round2_(overallDiscount),
      cashSales: round2_(cashTotal),
      transferSales: round2_(transferTotal),
      voidBills: voidSales.length,
      voidAmount: round2_(voidAmount),
      grossBills: validSales.length + voidSales.length
    },
    dailyList: daysList
  };
}

function getTopSellingReport(startDateStr, endDateStr, branchId = '', limit = 15) {
  const salesTable = getTable(SHEETS.SALES);
  const itemsTable = getTable(SHEETS.SALE_ITEMS);

  const start = startDateStr ? new Date(startDateStr + 'T00:00:00') : new Date(Date.now() - 30 * 86400000);
  const end = endDateStr ? new Date(endDateStr + 'T23:59:59') : new Date();

  const validReceipts = new Set();
  salesTable.rows.forEach(s => {
    if (s.status !== 'VOID') {
      if (!branchId || s.branchId === branchId) {
        const sDate = new Date(s.ts);
        if (sDate >= start && sDate <= end) {
          validReceipts.add(s.receiptNo);
        }
      }
    }
  });

  const productAgg = {};
  itemsTable.rows.forEach(it => {
    if (validReceipts.has(it.receiptNo)) {
      if (!productAgg[it.sku]) {
        productAgg[it.sku] = {
          sku: it.sku,
          name: it.name,
          barcode: it.barcode,
          qtySold: 0,
          totalRevenue: 0,
          totalCost: 0
        };
      }
      const q = parseFloat(it.qty) || 0;
      const amt = parseFloat(it.amount) || 0;
      const c = (parseFloat(it.unitCost) || 0) * q;
      productAgg[it.sku].qtySold += q;
      productAgg[it.sku].totalRevenue += amt;
      productAgg[it.sku].totalCost += c;
    }
  });

  const list = Object.keys(productAgg).map(k => {
    const item = productAgg[k];
    item.profit = item.totalRevenue - item.totalCost;
    return item;
  });

  list.sort((a, b) => b.totalRevenue - a.totalRevenue);
  return list.slice(0, limit);
}

function getStockValuationReport(branchId = '') {
  const products = getTable(SHEETS.PRODUCTS).rows;
  const balances = getTable(SHEETS.STOCK_BALANCE).rows;

  const stockMap = {};
  balances.forEach(b => {
    if (!branchId || b.branchId === branchId) {
      stockMap[b.sku] = (stockMap[b.sku] || 0) + (parseFloat(b.qty) || 0);
    }
  });

  let totalSkus = 0;
  let totalUnits = 0;
  let totalCostValue = 0;
  let totalRetailValue = 0;
  const lowStockItems = [];

  products.forEach(p => {
    if (String(p.active) !== 'false') {
      const q = stockMap[p.sku] !== undefined ? stockMap[p.sku] : 0;
      const cost = parseFloat(p.costPrice) || 0;
      const price = parseFloat(p.salePrice) || 0;
      const min = parseFloat(p.minStock) || 0;

      totalSkus += 1;
      totalUnits += q;
      totalCostValue += (q * cost);
      totalRetailValue += (q * price);

      if (q <= min) {
        lowStockItems.push({
          sku: p.sku,
          name: p.name,
          barcode: p.barcode,
          qty: q,
          minStock: min,
          unit: p.unit
        });
      }
    }
  });

  return {
    totalSkus,
    totalUnits,
    totalCostValue,
    totalRetailValue,
    estimatedGrossProfit: totalRetailValue - totalCostValue,
    lowStockCount: lowStockItems.length,
    lowStockItems
  };
}
