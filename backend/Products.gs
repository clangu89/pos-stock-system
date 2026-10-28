/**
 * Products.gs - Products, Categories, and Units Catalog
 */

function getProductsWithStock(branchId = 'B01') {
  const productsTable = getTable(SHEETS.PRODUCTS);
  const stockTable = getTable(SHEETS.STOCK_BALANCE);

  // Map stock balances by SKU for given branch
  const stockMap = {};
  for (let i = 0; i < stockTable.rows.length; i++) {
    const row = stockTable.rows[i];
    if (!branchId || row.branchId === branchId) {
      stockMap[row.sku] = (stockMap[row.sku] || 0) + (parseFloat(row.qty) || 0);
    }
  }

  return productsTable.rows
    .filter(p => String(p.active) !== 'false')
    .map(p => ({
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      categoryId: p.categoryId,
      unit: p.unit,
      costPrice: parseFloat(p.costPrice) || 0,
      salePrice: parseFloat(p.salePrice) || 0,
      minStock: parseFloat(p.minStock) || 0,
      imageUrl: p.imageUrl || '',
      stockQty: stockMap[p.sku] !== undefined ? stockMap[p.sku] : 0,
      isLowStock: (stockMap[p.sku] !== undefined ? stockMap[p.sku] : 0) <= (parseFloat(p.minStock) || 0)
    }));
}

function saveProduct(productData, sessionUser) {
  const sku = String(productData.sku || '').trim();
  const name = String(productData.name || '').trim();
  const barcode = String(productData.barcode || '').trim();

  if (!sku || !name) {
    throw new Error('กรุณาระบุรหัสสินค้า (SKU) และชื่อสินค้า');
  }

  const existingBySku = findRow(SHEETS.PRODUCTS, r => r.sku === sku);

  // Check barcode uniqueness if barcode provided
  if (barcode) {
    const existingByBarcode = findRow(SHEETS.PRODUCTS, r => String(r.barcode || '').trim() === barcode && String(r.sku || '').trim() !== sku);
    if (existingByBarcode) {
      throw new Error(`บาร์โค้ด ${barcode} ซ้ำกับสินค้า "${existingByBarcode.name}" (SKU: ${existingByBarcode.sku})`);
    }
  }

  const now = new Date().toISOString();
  const record = {
    sku: sku,
    barcode: barcode,
    name: name,
    categoryId: productData.categoryId || '',
    unit: productData.unit || 'ชิ้น',
    costPrice: parseFloat(productData.costPrice) || 0,
    salePrice: parseFloat(productData.salePrice) || 0,
    minStock: parseFloat(productData.minStock) || 0,
    active: productData.active !== false && String(productData.active) !== 'false' ? 'true' : 'false',
    imageUrl: productData.imageUrl || '',
    updatedAt: now
  };

  if (existingBySku) {
    updateRows(SHEETS.PRODUCTS, r => r.sku === sku, r => {
      Object.assign(r, record);
      return r;
    });
    logAudit(sessionUser.userId, 'UPDATE_PRODUCT', 'Products', { sku, name });
  } else {
    record.createdAt = now;
    appendRow(SHEETS.PRODUCTS, record);
    logAudit(sessionUser.userId, 'CREATE_PRODUCT', 'Products', { sku, name });
  }

  return { ok: true, product: record };
}

function deleteProduct(sku, sessionUser) {
  if (!sku) throw new Error('ไม่พบรหัสสินค้า');
  updateRows(SHEETS.PRODUCTS, r => r.sku === sku, r => {
    r.active = 'false';
    r.updatedAt = new Date().toISOString();
    return r;
  });
  logAudit(sessionUser.userId, 'DELETE_PRODUCT', 'Products', { sku });
  return { ok: true };
}

function getCategories() {
  return getTable(SHEETS.CATEGORIES).rows;
}

function getUnits() {
  return getTable(SHEETS.UNITS).rows;
}
