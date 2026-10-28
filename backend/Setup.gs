/**
 * Setup.gs - Database Schema Initialization and Seed Data
 */

function setupDatabase() {
  const ss = getSpreadsheet();

  const schemas = {
    [SHEETS.USERS]: ['userId', 'username', 'passHash', 'salt', 'name', 'roleId', 'branchIds', 'active', 'lastLogin', 'failCount', 'lockedUntil', 'createdAt'],
    [SHEETS.ROLES]: ['roleId', 'roleName', 'description', 'permissions', 'createdAt'],
    [SHEETS.SESSIONS]: ['token', 'userId', 'createdAt', 'expiresAt', 'userAgent', 'ip'],
    [SHEETS.BRANCHES]: ['branchId', 'code', 'name', 'address', 'phone', 'taxId', 'active', 'createdAt'],
    [SHEETS.CATEGORIES]: ['categoryId', 'name', 'color', 'sortOrder'],
    [SHEETS.UNITS]: ['unitId', 'name'],
    [SHEETS.PRODUCTS]: ['sku', 'barcode', 'name', 'categoryId', 'unit', 'costPrice', 'salePrice', 'minStock', 'active', 'imageUrl', 'createdAt', 'updatedAt'],
    [SHEETS.STOCK_BALANCE]: ['branchId', 'sku', 'qty', 'updatedAt'],
    [SHEETS.STOCK_MOVEMENTS]: ['movId', 'ts', 'branchId', 'sku', 'type', 'qtyIn', 'qtyOut', 'balanceAfter', 'refDoc', 'userId', 'note'],
    [SHEETS.STOCK_DOCS]: ['docNo', 'type', 'branchId', 'toBranchId', 'status', 'itemsJson', 'userId', 'note', 'createdAt'],
    [SHEETS.SALES]: ['receiptNo', 'ts', 'branchId', 'stationId', 'userId', 'cashierName', 'subtotal', 'discount', 'vat', 'total', 'received', 'change', 'payMethod', 'status', 'voidBy', 'voidAt', 'voidReason', 'clientTxnId'],
    [SHEETS.SALE_ITEMS]: ['receiptNo', 'lineNo', 'sku', 'barcode', 'name', 'qty', 'unitPrice', 'unitCost', 'discount', 'amount'],
    [SHEETS.COUNTERS]: ['key', 'value', 'updatedAt'],
    [SHEETS.CONFIG]: ['key', 'value', 'description', 'updatedAt'],
    [SHEETS.PRINT_PROFILES]: ['profileId', 'branchId', 'stationId', 'printerName', 'paperType', 'widthMm', 'heightMm', 'marginMm', 'fontSize', 'copies', 'autoPrint', 'showLogo', 'footer', 'updatedAt'],
    [SHEETS.AUDIT_LOG]: ['ts', 'userId', 'action', 'target', 'detail']
  };

  for (const sheetName in schemas) {
    let sheet = ss.getSheetByName(sheetName);
    const headers = schemas[sheetName];
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#2C3E50').setFontColor('#FFFFFF');
      sheet.setFrozenRows(1);
    } else {
      // Check if headers match or need update
      const existingHeaders = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
      if (!existingHeaders || existingHeaders[0] === '') {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#2C3E50').setFontColor('#FFFFFF');
        sheet.setFrozenRows(1);
      }
    }
  }

  // Seed Roles
  const rolesCount = getTable(SHEETS.ROLES).rows.length;
  if (rolesCount === 0) {
    const rolesData = [
      {
        roleId: 'admin',
        roleName: 'ผู้ดูแลระบบ (Admin)',
        description: 'สิทธิ์สูงสุด เข้าถึงได้ทุกระบบ ทุกฟังก์ชัน',
        permissions: JSON.stringify({
          sales: { view: true, create: true, void: true, discount: true, reprint: true },
          stock: { view: true, create: true, edit: true, delete: true, receive: true, adjust: true, transfer: true },
          reports: { view: true, export: true },
          admin: { view: true, users: true, roles: true, config: true, printer: true, audit: true }
        }),
        createdAt: new Date().toISOString()
      },
      {
        roleId: 'manager',
        roleName: 'ผู้จัดการสาขา (Manager)',
        description: 'จัดการการขาย ยกเลิกบิล ปรับสต๊อก และดูรายงาน',
        permissions: JSON.stringify({
          sales: { view: true, create: true, void: true, discount: true, reprint: true },
          stock: { view: true, create: true, edit: true, delete: false, receive: true, adjust: true, transfer: true },
          reports: { view: true, export: true },
          admin: { view: false }
        }),
        createdAt: new Date().toISOString()
      },
      {
        roleId: 'cashier',
        roleName: 'พนักงานขาย (Cashier)',
        description: 'เข้าใช้งานหน้าขาย พิมพ์ใบเสร็จ ดูสต๊อกคงเหลือ',
        permissions: JSON.stringify({
          sales: { view: true, create: true, void: false, discount: false, reprint: true },
          stock: { view: true, create: false, edit: false, delete: false, receive: false, adjust: false, transfer: false },
          reports: { view: false },
          admin: { view: false }
        }),
        createdAt: new Date().toISOString()
      },
      {
        roleId: 'stock_keeper',
        roleName: 'เจ้าหน้าที่สต๊อก (Stock Keeper)',
        description: 'จัดการสินค้า รับเข้า ปรับสต๊อก โอนย้าย ดูรายงานสต๊อก',
        permissions: JSON.stringify({
          sales: { view: false },
          stock: { view: true, create: true, edit: true, delete: false, receive: true, adjust: true, transfer: true },
          reports: { view: true, export: true },
          admin: { view: false }
        }),
        createdAt: new Date().toISOString()
      }
    ];
    appendRows(SHEETS.ROLES, rolesData);
  }

  // Seed Branches
  const branchCount = getTable(SHEETS.BRANCHES).rows.length;
  if (branchCount === 0) {
    appendRow(SHEETS.BRANCHES, {
      branchId: 'B01',
      code: 'MAIN',
      name: 'สาขาหลัก (สำนักงานใหญ่)',
      address: '123/45 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110',
      phone: '02-123-4567',
      taxId: '0105500000000',
      active: 'true',
      createdAt: new Date().toISOString()
    });
  }

  // Seed Admin User (default admin / Admin1234!)
  const usersCount = getTable(SHEETS.USERS).rows.length;
  if (usersCount === 0) {
    const salt = generateRandomHex(16);
    const passHash = hashPassword('Admin1234!', salt);
    appendRow(SHEETS.USERS, {
      userId: 'USR_ADMIN_01',
      username: 'admin',
      passHash: passHash,
      salt: salt,
      name: 'ผู้ดูแลระบบสูงสุด',
      roleId: 'admin',
      branchIds: 'B01',
      active: 'true',
      lastLogin: '',
      failCount: 0,
      lockedUntil: '',
      createdAt: new Date().toISOString()
    });

    // Also seed a cashier user for testing
    const saltCashier = generateRandomHex(16);
    appendRow(SHEETS.USERS, {
      userId: 'USR_CASHIER_01',
      username: 'cashier',
      passHash: hashPassword('Cashier1234!', saltCashier),
      salt: saltCashier,
      name: 'พนักงานขาย หน้าร้าน',
      roleId: 'cashier',
      branchIds: 'B01',
      active: 'true',
      lastLogin: '',
      failCount: 0,
      lockedUntil: '',
      createdAt: new Date().toISOString()
    });
  }

  // Seed Categories & Units
  if (getTable(SHEETS.CATEGORIES).rows.length === 0) {
    appendRows(SHEETS.CATEGORIES, [
      { categoryId: 'CAT_BEV', name: 'เครื่องดื่ม', color: '#3498DB', sortOrder: 1 },
      { categoryId: 'CAT_SNK', name: 'ขนมขบเคี้ยว', color: '#E67E22', sortOrder: 2 },
      { categoryId: 'CAT_FOD', name: 'อาหารปรุงสำเร็จ', color: '#2ECC71', sortOrder: 3 },
      { categoryId: 'CAT_GEN', name: 'ของใช้ทั่วไป', color: '#9B59B6', sortOrder: 4 }
    ]);
  }

  if (getTable(SHEETS.UNITS).rows.length === 0) {
    appendRows(SHEETS.UNITS, [
      { unitId: 'U_PCS', name: 'ชิ้น' },
      { unitId: 'U_BTL', name: 'ขวด' },
      { unitId: 'U_CAN', name: 'กระป๋อง' },
      { unitId: 'U_BOX', name: 'กล่อง' },
      { unitId: 'U_PCK', name: 'แพ็ค' }
    ]);
  }

  // Seed Sample Products
  if (getTable(SHEETS.PRODUCTS).rows.length === 0) {
    const sampleProducts = [
      { sku: 'P1001', barcode: '8850123456789', name: 'น้ำดื่มสิงห์ 600 มล.', categoryId: 'CAT_BEV', unit: 'ขวด', costPrice: 5.5, salePrice: 10, minStock: 24, active: 'true', imageUrl: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { sku: 'P1002', barcode: '8850987654321', name: 'โค้ก ออริจินัล 325 มล.', categoryId: 'CAT_BEV', unit: 'กระป๋อง', costPrice: 10.5, salePrice: 16, minStock: 20, active: 'true', imageUrl: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { sku: 'P1003', barcode: '8851122334455', name: 'เลย์ มันฝรั่งแท้ รสคลาสสิค 50 กรัม', categoryId: 'CAT_SNK', unit: 'ซอง', costPrice: 15.0, salePrice: 20, minStock: 15, active: 'true', imageUrl: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { sku: 'P1004', barcode: '8852233445566', name: 'ข้าวผัดกระเพราไก่ไข่ดาว', categoryId: 'CAT_FOD', unit: 'กล่อง', costPrice: 35.0, salePrice: 55, minStock: 5, active: 'true', imageUrl: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { sku: 'P1005', barcode: '8853344556677', name: 'ทิชชู่ม้วน พรีเมียม', categoryId: 'CAT_GEN', unit: 'ม้วน', costPrice: 12.0, salePrice: 19, minStock: 10, active: 'true', imageUrl: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ];
    appendRows(SHEETS.PRODUCTS, sampleProducts);

    // Initial stock balances for B01
    const initialBalances = [
      { branchId: 'B01', sku: 'P1001', qty: 100, updatedAt: new Date().toISOString() },
      { branchId: 'B01', sku: 'P1002', qty: 80, updatedAt: new Date().toISOString() },
      { branchId: 'B01', sku: 'P1003', qty: 50, updatedAt: new Date().toISOString() },
      { branchId: 'B01', sku: 'P1004', qty: 25, updatedAt: new Date().toISOString() },
      { branchId: 'B01', sku: 'P1005', qty: 40, updatedAt: new Date().toISOString() }
    ];
    appendRows(SHEETS.STOCK_BALANCE, initialBalances);

    // Initial movements
    const movements = initialBalances.map((b, idx) => ({
      movId: 'MOV_INIT_' + (idx + 1),
      ts: new Date().toISOString(),
      branchId: b.branchId,
      sku: b.sku,
      type: 'INIT',
      qtyIn: b.qty,
      qtyOut: 0,
      balanceAfter: b.qty,
      refDoc: 'INITIAL_STOCK',
      userId: 'USR_ADMIN_01',
      note: 'ยอดยกมาเริ่มต้นระบบ'
    }));
    appendRows(SHEETS.STOCK_MOVEMENTS, movements);
  }

  // Seed Config
  const configs = [
    { key: 'RECEIPT_PREFIX', value: 'RC', description: 'คำนำหน้าเลขที่ใบเสร็จ' },
    { key: 'RECEIPT_FORMAT', value: '{PREFIX}{BRANCH}-{YYYY}{MM}{DD}-{RUN:5}', description: 'รูปแบบเลขที่ใบเสร็จ' },
    { key: 'RECEIPT_RESET_CYCLE', value: 'DAILY', description: 'รอบการรีเซ็ตเลขรัน (DAILY, MONTHLY, YEARLY, NEVER)' },
    { key: 'STORE_NAME', value: 'ระบบขายสินค้าและสต๊อก POS Store', description: 'ชื่อร้านค้า/กิจการ' },
    { key: 'STORE_ADDRESS', value: '123/45 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110', description: 'ที่อยู่ร้านค้า' },
    { key: 'STORE_PHONE', value: '02-123-4567', description: 'เบอร์โทรศัพท์ร้านค้า' },
    { key: 'STORE_TAX_ID', value: '0105500000000', description: 'เลขประจำตัวผู้เสียภาษี' },
    { key: 'RECEIPT_FOOTER', value: 'ขอบคุณที่ใช้บริการ / Thank you!', description: 'ข้อความท้ายใบเสร็จ' },
    { key: 'VAT_RATE', value: '0', description: 'อัตราภาษีมูลค่าเพิ่ม (%)' },
    { key: 'ALLOW_NEGATIVE_STOCK', value: 'false', description: 'อนุญาตให้ขายสินค้าแม้สต๊อกติดลบหรือไม่ (true/false)' },
    { key: 'SESSION_EXPIRE_HOURS', value: '12', description: 'อายุเซสชันการล็อกอิน (ชั่วโมง)' },
    { key: 'VOICE_SELECTION', value: 'preset:female_polite', description: 'รูปแบบเสียงที่เลือกใช้งาน' },
    { key: 'VOICE_SOUND_ENABLED', value: 'true', description: 'เปิด/ปิดเสียงระบบ' },
    { key: 'VOICE_RATE', value: '1.0', description: 'ความเร็วการพูด (0.7 - 1.5)' },
    { key: 'VOICE_PITCH', value: '1.0', description: 'ระดับเสียงสูงต่ำ (0.7 - 1.5)' },
    { key: 'VOICE_PARTICLE', value: 'ค่ะ', description: 'คำลงท้ายเสียงพูด (ค่ะ/ครับ)' }
  ];

  for (const c of configs) {
    setConfig(c.key, c.value, c.description);
  }

  // Seed Print Profiles
  if (getTable(SHEETS.PRINT_PROFILES).rows.length === 0) {
    appendRows(SHEETS.PRINT_PROFILES, [
      {
        profileId: 'P_58MM_DEFAULT',
        branchId: '*',
        stationId: '*',
        printerName: 'XP-58 / Standard Thermal 58mm',
        paperType: '58mm',
        widthMm: 58,
        heightMm: 0, // 0 = continuous
        marginMm: 2,
        fontSize: 11,
        copies: 1,
        autoPrint: 'true',
        showLogo: 'true',
        footer: 'ขอบคุณที่ใช้บริการ / Thank you!',
        updatedAt: new Date().toISOString()
      },
      {
        profileId: 'P_80MM_DEFAULT',
        branchId: '*',
        stationId: '*',
        printerName: 'XP-80 / Standard Thermal 80mm',
        paperType: '80mm',
        widthMm: 80,
        heightMm: 0,
        marginMm: 4,
        fontSize: 12,
        copies: 1,
        autoPrint: 'true',
        showLogo: 'true',
        footer: 'ขอบคุณที่ใช้บริการ / Thank you!',
        updatedAt: new Date().toISOString()
      }
    ]);
  }

  return {
    ok: true,
    message: 'ติดตั้งฐานข้อมูลเริ่มต้นสำเร็จเรียบร้อย',
    adminAccount: {
      username: 'admin',
      defaultPassword: 'Admin1234!'
    },
    cashierAccount: {
      username: 'cashier',
      defaultPassword: 'Cashier1234!'
    }
  };
}
