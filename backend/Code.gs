/**
 * Code.gs - API Gateway, Action Router, and Request Handler
 */

function doGet(e) {
  const result = {
    ok: true,
    service: 'POS & Stock Management API',
    status: 'ONLINE',
    time: new Date().toISOString()
  };
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let output;
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }

    const action = String(payload.action || '').trim();
    const token = payload.token || '';
    const data = payload.data || {};

    output = routeAction(action, token, data, e);
  } catch (err) {
    output = {
      ok: false,
      error: err.message || String(err)
    };
  }

  return ContentService.createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

function routeAction(action, token, data, reqContext) {
  // --- Public Actions ---
  if (action === 'ping') {
    return { ok: true, pong: true, time: new Date().toISOString() };
  }

  if (action === 'setup') {
    const usersTable = getTable(SHEETS.USERS);
    if (usersTable.rows.length > 0) {
      const session = verifySession(token);
      if (!session || !hasPermission(session, 'admin', 'config')) {
        return {
          ok: false,
          error: 'UNAUTHORIZED',
          message: 'ระบบได้รับการติดตั้งเรียบร้อยแล้ว การรัน setup ใหม่ต้องใช้สิทธิ์ Admin เท่านั้น'
        };
      }
    }
    return setupDatabase();
  }

  if (action === 'login') {
    return loginUser(data.username, data.password, {
      userAgent: data.userAgent || '',
      ip: data.ip || ''
    });
  }

  // --- Protected Actions (Require valid session) ---
  const session = verifySession(token);
  if (!session) {
    return {
      ok: false,
      error: 'UNAUTHORIZED',
      message: 'เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่'
    };
  }

  // --- Auth Session Actions ---
  if (action === 'auth:verify') {
    return { ok: true, user: session };
  }

  if (action === 'auth:logout') {
    logoutUser(token);
    return { ok: true };
  }

  // --- High-Speed Initial POS Load (Products + Branches + Config + Profiles in 1 Call) ---
  if (action === 'pos:init') {
    const branchId = data.branchId || (session.branchIds && session.branchIds[0]) || 'B01';
    return {
      ok: true,
      products: getProductsWithStock(branchId),
      branches: getBranchesList(),
      configs: getAllConfigs(),
      receiptTexts: getReceiptStoreInfo(branchId),
      printProfiles: getPrintProfilesList(),
      categories: getCategories(),
      units: getUnits()
    };
  }

  // --- Products Catalog ---
  if (action === 'products:list') {
    return { ok: true, products: getProductsWithStock(data.branchId) };
  }

  if (action === 'products:save') {
    requireAuth(token, 'stock', 'edit');
    return saveProduct(data, session);
  }

  if (action === 'products:delete') {
    requireAuth(token, 'stock', 'delete');
    return deleteProduct(data.sku, session);
  }

  // --- Stock Operations ---
  if (action === 'stock:receive') {
    requireAuth(token, 'stock', 'receive');
    return receiveStock(data, session);
  }

  if (action === 'stock:adjust') {
    requireAuth(token, 'stock', 'adjust');
    return adjustStock(data, session);
  }

  if (action === 'stock:transfer') {
    requireAuth(token, 'stock', 'transfer');
    return transferStock(data, session);
  }

  if (action === 'stock:card') {
    return { ok: true, movements: getStockCard(data.sku, data.branchId, data.limit) };
  }

  // --- Sales Operations ---
  if (action === 'sales:checkout') {
    requireAuth(token, 'sales', 'create');
    return checkoutSale(data, session);
  }

  if (action === 'sales:void') {
    requireAuth(token, 'sales', 'void');
    return voidReceipt(data.receiptNo, data.reason, session);
  }

  if (action === 'sales:recent') {
    return { ok: true, sales: getRecentSales(data.branchId, data.limit) };
  }

  if (action === 'sales:receipt') {
    return { ok: true, receipt: getReceiptDetails(data.receiptNo) };
  }

  // --- Reports ---
  if (action === 'reports:daily') {
    requireAuth(token, 'reports', 'view');
    return { ok: true, data: getDailySalesReport(data.startDate, data.endDate, data.branchId) };
  }

  if (action === 'reports:topSelling') {
    requireAuth(token, 'reports', 'view');
    return { ok: true, data: getTopSellingReport(data.startDate, data.endDate, data.branchId, data.limit) };
  }

  if (action === 'reports:stockValuation') {
    requireAuth(token, 'reports', 'view');
    return { ok: true, data: getStockValuationReport(data.branchId) };
  }

  // --- Admin Operations ---
  if (action === 'admin:users') {
    requireAuth(token, 'admin', 'users');
    return { ok: true, users: getUsersList() };
  }

  if (action === 'admin:saveUser') {
    requireAuth(token, 'admin', 'users');
    return saveUserAccount(data, session);
  }

  if (action === 'admin:roles') {
    requireAuth(token, 'admin', 'roles');
    return { ok: true, roles: getRolesList() };
  }

  if (action === 'admin:saveRole') {
    requireAuth(token, 'admin', 'roles');
    return saveRolePermissions(data, session);
  }

  if (action === 'admin:branches') {
    return { ok: true, branches: getBranchesList() };
  }

  if (action === 'admin:saveBranch') {
    requireAuth(token, 'admin', 'config');
    return saveBranchData(data, session);
  }

  if (action === 'admin:configs') {
    return { ok: true, configs: getAllConfigs() };
  }

  if (action === 'admin:configsTable') {
    requireAuth(token, 'admin', 'config');
    return { ok: true, configs: getConfigsTable() };
  }

  if (action === 'admin:saveConfigItem') {
    requireAuth(token, 'admin', 'config');
    return saveConfigItem(data, session);
  }

  if (action === 'admin:deleteConfigItem') {
    requireAuth(token, 'admin', 'config');
    return deleteConfigItem(data.key, session);
  }

  if (action === 'admin:saveConfigs') {
    requireAuth(token, 'admin', 'config');
    return saveBatchConfigs(data, session);
  }

  // --- Admin: Categories CRUD ---
  if (action === 'admin:categories') {
    return { ok: true, categories: getCategories() };
  }

  if (action === 'admin:saveCategory') {
    requireAuth(token, 'stock', 'edit');
    return saveCategory(data, session);
  }

  if (action === 'admin:deleteCategory') {
    requireAuth(token, 'stock', 'delete');
    return deleteCategory(data.categoryId, session);
  }

  // --- Admin: Units CRUD ---
  if (action === 'admin:units') {
    return { ok: true, units: getUnits() };
  }

  if (action === 'admin:saveUnit') {
    requireAuth(token, 'stock', 'edit');
    return saveUnit(data, session);
  }

  if (action === 'admin:deleteUnit') {
    requireAuth(token, 'stock', 'delete');
    return deleteUnit(data.unitId, session);
  }

  // --- Admin: Receipt Text Customizations ---
  if (action === 'admin:receiptTexts') {
    requireAuth(token, 'admin', 'config');
    return { ok: true, data: getReceiptTextsList() };
  }

  if (action === 'admin:saveReceiptTexts') {
    requireAuth(token, 'admin', 'config');
    return saveReceiptTexts(data, session);
  }

  if (action === 'admin:deleteReceiptTexts') {
    requireAuth(token, 'admin', 'config');
    return deleteBranchReceiptTexts(data.branchId, session);
  }

  if (action === 'admin:printProfiles') {
    return { ok: true, profiles: getPrintProfilesList() };
  }

  if (action === 'admin:savePrintProfile') {
    requireAuth(token, 'admin', 'printer');
    return savePrintProfileData(data, session);
  }

  if (action === 'admin:auditLogs') {
    requireAuth(token, 'admin', 'audit');
    return { ok: true, logs: getAuditLogsList(data.limit) };
  }

  if (action === 'admin:previewReceipt') {
    return {
      ok: true,
      preview: previewReceiptFormat(data.format, data.prefix, data.branch, data.runVal)
    };
  }

  throw new Error(`ไม่พบคำสั่ง (Action) [${action}] ในระบบ`);
}
