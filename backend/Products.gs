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

function saveCategory(catData, sessionUser) {
  let categoryId = String(catData.categoryId || '').trim();
  const name = String(catData.name || '').trim();
  const color = String(catData.color || '#3498DB').trim();
  const sortOrder = parseInt(catData.sortOrder, 10) || 0;

  if (!name) {
    throw new Error('กรุณาระบุชื่อหมวดหมู่สินค้า');
  }

  // If new and no categoryId provided, generate one
  if (!categoryId) {
    categoryId = 'CAT_' + Date.now().toString(36).toUpperCase();
  }

  const existing = findRow(SHEETS.CATEGORIES, r => r.categoryId === categoryId);
  const record = {
    categoryId: categoryId,
    name: name,
    color: color,
    sortOrder: sortOrder
  };

  if (existing) {
    updateRows(SHEETS.CATEGORIES, r => r.categoryId === categoryId, r => {
      Object.assign(r, record);
      return r;
    });
    logAudit(sessionUser.userId, 'UPDATE_CATEGORY', 'Categories', { categoryId, name });
  } else {
    appendRow(SHEETS.CATEGORIES, record);
    logAudit(sessionUser.userId, 'CREATE_CATEGORY', 'Categories', { categoryId, name });
  }

  return { ok: true, category: record };
}

function deleteCategory(categoryId, sessionUser) {
  if (!categoryId) throw new Error('กรุณาระบุรหัสหมวดหมู่สินค้า');

  // Delete protection: check if any active product is using this categoryId
  const activeProducts = findRows(SHEETS.PRODUCTS, r => r.categoryId === categoryId && String(r.active) !== 'false');
  if (activeProducts.length > 0) {
    throw new Error(`ไม่สามารถลบหมวดหมู่นี้ได้ เนื่องจากมีสินค้าใช้งานอยู่ ${activeProducts.length} รายการ (เช่น ${activeProducts[0].name || activeProducts[0].sku})`);
  }

  const deleted = deleteRows(SHEETS.CATEGORIES, r => r.categoryId === categoryId);
  logAudit(sessionUser.userId, 'DELETE_CATEGORY', 'Categories', { categoryId, deleted });

  return { ok: true, message: 'ลบหมวดหมู่สินค้าสำเร็จ' };
}

function getUnits() {
  return getTable(SHEETS.UNITS).rows;
}

function saveUnit(unitData, sessionUser) {
  let unitId = String(unitData.unitId || '').trim();
  const name = String(unitData.name || '').trim();

  if (!name) {
    throw new Error('กรุณาระบุชื่อหน่วยนับ');
  }

  if (!unitId) {
    unitId = 'U_' + Date.now().toString(36).toUpperCase();
  }

  // Check duplicate unit name for other IDs
  const dup = findRow(SHEETS.UNITS, r => String(r.name).trim().toLowerCase() === name.toLowerCase() && r.unitId !== unitId);
  if (dup) {
    throw new Error(`ชื่อหน่วยนับ "${name}" มีอยู่ในระบบแล้ว`);
  }

  const existing = findRow(SHEETS.UNITS, r => r.unitId === unitId);
  const record = {
    unitId: unitId,
    name: name
  };

  if (existing) {
    updateRows(SHEETS.UNITS, r => r.unitId === unitId, r => {
      Object.assign(r, record);
      return r;
    });
    logAudit(sessionUser.userId, 'UPDATE_UNIT', 'Units', { unitId, name });
  } else {
    appendRow(SHEETS.UNITS, record);
    logAudit(sessionUser.userId, 'CREATE_UNIT', 'Units', { unitId, name });
  }

  return { ok: true, unit: record };
}

function deleteUnit(unitId, sessionUser) {
  if (!unitId) throw new Error('กรุณาระบุรหัสหน่วยนับ');

  const unitRow = findRow(SHEETS.UNITS, r => r.unitId === unitId);
  if (!unitRow) throw new Error('ไม่พบข้อมูลหน่วยนับที่ต้องการลบ');

  const unitName = String(unitRow.name || '').trim();

  // Delete protection: check if any active product is using this unit name
  const activeProducts = findRows(SHEETS.PRODUCTS, r => String(r.unit).trim() === unitName && String(r.active) !== 'false');
  if (activeProducts.length > 0) {
    throw new Error(`ไม่สามารถลบหน่วยนับ "${unitName}" ได้ เนื่องจากมีสินค้าใช้งานอยู่ ${activeProducts.length} รายการ (เช่น ${activeProducts[0].name || activeProducts[0].sku})`);
  }

  const deleted = deleteRows(SHEETS.UNITS, r => r.unitId === unitId);
  logAudit(sessionUser.userId, 'DELETE_UNIT', 'Units', { unitId, unitName, deleted });

  return { ok: true, message: 'ลบหน่วยนับสำเร็จ' };
}
