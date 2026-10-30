/**
 * Admin.gs - User Management, Roles/Permissions, System Config, Printer Profiles, Audit Logs
 */

function getUsersList() {
  const users = getTable(SHEETS.USERS).rows;
  const roles = getTable(SHEETS.ROLES).rows;
  const roleMap = {};
  roles.forEach(r => { roleMap[r.roleId] = r.roleName; });

  return users.map(u => ({
    userId: u.userId,
    username: u.username,
    name: u.name,
    roleId: u.roleId,
    roleName: roleMap[u.roleId] || u.roleId,
    branchIds: String(u.branchIds || '').split(',').map(s => s.trim()).filter(Boolean),
    active: u.active === true || String(u.active) === 'true',
    lastLogin: u.lastLogin,
    failCount: u.failCount,
    createdAt: u.createdAt
  }));
}

function saveUserAccount(userData, sessionUser) {
  const username = String(userData.username || '').trim().toLowerCase();
  const name = String(userData.name || '').trim();
  const roleId = String(userData.roleId || '').trim();

  if (!username || !name || !roleId) {
    throw new Error('กรุณากรอกชื่อผู้ใช้ ชื่อ-นามสกุล และเลือกบทบาท (Role)');
  }

  const existing = findRow(SHEETS.USERS, r => String(r.username).toLowerCase() === username);

  if (userData.userId) {
    // Update existing user
    updateRows(SHEETS.USERS, r => r.userId === userData.userId, r => {
      r.name = name;
      r.roleId = roleId;
      r.branchIds = Array.isArray(userData.branchIds) ? userData.branchIds.join(',') : (userData.branchIds || '');
      if (userData.active !== undefined) {
        r.active = String(userData.active);
      }
      if (userData.password) {
        const salt = generateRandomHex(16);
        r.salt = salt;
        r.passHash = hashPassword(userData.password, salt);
        r.failCount = 0;
        r.lockedUntil = '';
      }
      return r;
    });
    logAudit(sessionUser.userId, 'UPDATE_USER', 'Users', { userId: userData.userId, username });
    return { ok: true, message: 'แก้ไขข้อมูลผู้ใช้สำเร็จ' };
  } else {
    // Create new user
    if (existing) {
      throw new Error(`ชื่อผู้ใช้ "${username}" มีอยู่ในระบบแล้ว`);
    }
    if (!userData.password) {
      throw new Error('กรุณากำหนดรหัสผ่านเริ่มต้นสำหรับผู้ใช้ใหม่');
    }

    const newUserId = 'USR_' + Utilities.getUuid().substring(0, 8).toUpperCase();
    const salt = generateRandomHex(16);
    const passHash = hashPassword(userData.password, salt);

    appendRow(SHEETS.USERS, {
      userId: newUserId,
      username: username,
      passHash: passHash,
      salt: salt,
      name: name,
      roleId: roleId,
      branchIds: Array.isArray(userData.branchIds) ? userData.branchIds.join(',') : (userData.branchIds || 'B01'),
      active: 'true',
      lastLogin: '',
      failCount: 0,
      lockedUntil: '',
      createdAt: new Date().toISOString()
    });

    logAudit(sessionUser.userId, 'CREATE_USER', 'Users', { newUserId, username });
    return { ok: true, message: 'สร้างผู้ใช้ใหม่สำเร็จ', userId: newUserId };
  }
}

function getRolesList() {
  const roles = getTable(SHEETS.ROLES).rows;
  return roles.map(r => {
    let p = {};
    try {
      p = typeof r.permissions === 'string' ? JSON.parse(r.permissions) : (r.permissions || {});
    } catch (e) {
      p = {};
    }
    return {
      roleId: r.roleId,
      roleName: r.roleName,
      description: r.description,
      permissions: p
    };
  });
}

function saveRolePermissions(roleData, sessionUser) {
  const roleId = String(roleData.roleId || '').trim();
  const roleName = String(roleData.roleName || '').trim();
  if (!roleId || !roleName) {
    throw new Error('กรุณาระบุรหัสบทบาทและชื่อบทบาท');
  }

  const permJson = typeof roleData.permissions === 'string'
    ? roleData.permissions
    : JSON.stringify(roleData.permissions || {});

  const existing = findRow(SHEETS.ROLES, r => r.roleId === roleId);
  if (existing) {
    updateRows(SHEETS.ROLES, r => r.roleId === roleId, r => {
      r.roleName = roleName;
      r.description = roleData.description || '';
      r.permissions = permJson;
      return r;
    });
    logAudit(sessionUser.userId, 'UPDATE_ROLE', 'Roles', { roleId, roleName });
  } else {
    appendRow(SHEETS.ROLES, {
      roleId: roleId,
      roleName: roleName,
      description: roleData.description || '',
      permissions: permJson,
      createdAt: new Date().toISOString()
    });
    logAudit(sessionUser.userId, 'CREATE_ROLE', 'Roles', { roleId, roleName });
  }

  return { ok: true, message: 'บันทึกสิทธิ์สำเร็จ' };
}

function getBranchesList() {
  // ซ่อมค่าเบอร์โทร/เลขผู้เสียภาษีที่ Sheets แปลงเป็นตัวเลข (เลข 0 นำหน้าหาย)
  return getTable(SHEETS.BRANCHES).rows.map(b => {
    b.phone = normalizeThaiPhone_(b.phone);
    b.taxId = normalizeThaiTaxId_(b.taxId);
    return b;
  });
}

function saveBranchData(branchData, sessionUser) {
  getSheet(SHEETS.BRANCHES);
  setTextColumns_(SHEETS.BRANCHES, ['phone', 'taxId']);
  let branchId = String(branchData.branchId || '').trim();
  const code = String(branchData.code || '').trim().toUpperCase();
  const name = String(branchData.name || '').trim();

  if (!name || !code) {
    throw new Error('กรุณาระบุตัวย่อสาขาและชื่อสาขา');
  }

  // If no branchId provided (new branch), auto-generate B01, B02...
  if (!branchId) {
    const all = getTable(SHEETS.BRANCHES).rows;
    let maxNum = 0;
    all.forEach(b => {
      const match = String(b.branchId).match(/^B(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });
    branchId = 'B' + String(maxNum + 1).padStart(2, '0');
  }

  // Check duplicate code with other branches
  const dupCode = findRow(SHEETS.BRANCHES, r => r.code === code && r.branchId !== branchId);
  if (dupCode) {
    throw new Error(`ตัวย่อสาขา "${code}" ถูกใช้งานโดย "${dupCode.name}" แล้ว กรุณาระบุตัวย่ออื่น`);
  }

  const existing = findRow(SHEETS.BRANCHES, r => r.branchId === branchId);
  const record = {
    branchId: branchId,
    code: code,
    name: name,
    address: branchData.address || '',
    phone: branchData.phone || '',
    taxId: branchData.taxId || '',
    active: branchData.active !== false && String(branchData.active) !== 'false' ? 'true' : 'false'
  };

  if (existing) {
    updateRows(SHEETS.BRANCHES, r => r.branchId === branchId, r => {
      Object.assign(r, record);
      return r;
    });
    logAudit(sessionUser.userId, 'UPDATE_BRANCH', 'Branches', { branchId, name });
  } else {
    record.createdAt = new Date().toISOString();
    appendRow(SHEETS.BRANCHES, record);
    logAudit(sessionUser.userId, 'CREATE_BRANCH', 'Branches', { branchId, name });
  }

  return { ok: true, branch: record };
}

function deleteBranchData(branchId, sessionUser) {
  const cleanId = String(branchId || '').trim();
  if (!cleanId) {
    throw new Error('ไม่ระบุรหัสสาขา');
  }

  const allBranches = getTable(SHEETS.BRANCHES).rows;
  if (allBranches.length <= 1) {
    throw new Error('ไม่สามารถลบสาขาสุดท้ายของระบบได้ (ระบบต้องมีอย่างน้อย 1 สาขา)');
  }

  const target = allBranches.find(b => b.branchId === cleanId);
  if (!target) {
    throw new Error(`ไม่พบสาขารหัส: ${cleanId}`);
  }

  // Delete Protection Checks:
  // 1. Check Sales history
  const sales = findRows(SHEETS.SALES, r => r.branchId === cleanId);
  if (sales.length > 0) {
    throw new Error(`ไม่สามารถลบสาขาได้เนื่องจากมีประวัติการขาย ${sales.length} รายการแล้ว กรุณาเลือกปิดการใช้งาน (Deactivate) แทน`);
  }

  // 2. Check Stock Balances > 0
  const balances = findRows(SHEETS.STOCK_BALANCE, r => r.branchId === cleanId && (parseFloat(r.qty) || 0) > 0);
  if (balances.length > 0) {
    throw new Error(`ไม่สามารถลบสาขาได้เนื่องจากยังมีสินค้าคงเหลือในสต๊อกสาขานี้ ${balances.length} รายการ`);
  }

  // 3. Check Stock Movements
  const movements = findRows(SHEETS.STOCK_MOVEMENTS, r => r.branchId === cleanId);
  if (movements.length > 0) {
    throw new Error(`ไม่สามารถลบสาขาได้เนื่องจากมีประวัติความเคลื่อนไหวสต๊อกในสาขานี้แล้ว กรุณาเลือกปิดการใช้งานแทน`);
  }

  // 4. Check Users assigned exclusively to this branch
  const users = findRows(SHEETS.USERS, r => {
    const uBranches = String(r.branchIds || '').split(',').map(b => b.trim());
    return uBranches.includes(cleanId) && uBranches.length === 1;
  });
  if (users.length > 0) {
    throw new Error(`ไม่สามารถลบสาขาได้เนื่องจากมีผู้ใช้งาน ${users.length} คนผูกกับสาขานี้เท่านั้น (${users.map(u => u.username).join(', ')})`);
  }

  // Clean to delete
  deleteRows(SHEETS.BRANCHES, r => r.branchId === cleanId);
  deleteRows(SHEETS.STOCK_BALANCE, r => r.branchId === cleanId);

  logAudit(sessionUser.userId, 'DELETE_BRANCH', 'Branches', { branchId: cleanId, name: target.name });

  return { ok: true, message: `ลบสาขา "${target.name}" เรียบร้อยแล้ว` };
}

function getAllConfigs() {
  const rows = getTable(SHEETS.CONFIG).rows;
  const configMap = {};
  rows.forEach(r => {
    configMap[r.key] = r.value;
  });
  return configMap;
}

const SYSTEM_CONFIG_KEYS = new Set([
  'RECEIPT_PREFIX', 'RECEIPT_FORMAT', 'RECEIPT_RESET_CYCLE',
  'STORE_NAME', 'STORE_ADDRESS', 'STORE_PHONE', 'STORE_TAX_ID', 'RECEIPT_FOOTER',
  'VAT_RATE', 'ALLOW_NEGATIVE_STOCK', 'SESSION_EXPIRE_HOURS',
  'VOICE_SELECTION', 'VOICE_SOUND_ENABLED', 'VOICE_RATE', 'VOICE_PITCH', 'VOICE_PARTICLE',
  'DEFAULT_PAY_METHOD', 'CURRENCY_SYMBOL', 'LAST_BACKUP_AT', 'LAST_BACKUP_BY', 'LAST_RESTORE_AT', 'LAST_RESTORE_BY'
]);

function getConfigsTable() {
  const rows = getTable(SHEETS.CONFIG).rows;
  return rows.map(r => ({
    key: r.key,
    value: r.value,
    description: r.description || '',
    updatedAt: r.updatedAt || '',
    isSystem: SYSTEM_CONFIG_KEYS.has(r.key)
  }));
}

function saveConfigItem(configData, sessionUser) {
  const key = String(configData.key || '').trim().toUpperCase();
  const value = configData.value !== undefined ? String(configData.value).trim() : '';
  const desc = configData.description !== undefined ? String(configData.description).trim() : '';

  if (!key) {
    throw new Error('กรุณาระบุคีย์ค่าคงที่ (Config Key)');
  }

  setConfig(key, value, desc);
  logAudit(sessionUser.userId, 'SAVE_CONFIG_ITEM', 'Config', { key, value, desc });

  return { ok: true, message: `บันทึกค่าคงที่ [${key}] สำเร็จ`, item: { key, value, description: desc } };
}

function deleteConfigItem(key, sessionUser) {
  const cleanKey = String(key || '').trim().toUpperCase();
  if (!cleanKey) throw new Error('กรุณาระบุคีย์ค่าคงที่');

  if (SYSTEM_CONFIG_KEYS.has(cleanKey)) {
    throw new Error(`ไม่อนุญาตให้ลบคีย์ระบบ [${cleanKey}] ออกจากระบบ`);
  }

  const deleted = deleteRows(SHEETS.CONFIG, r => r.key === cleanKey);
  logAudit(sessionUser.userId, 'DELETE_CONFIG_ITEM', 'Config', { key: cleanKey, deleted });

  return { ok: true, message: `ลบคีย์ค่าคงที่ [${cleanKey}] สำเร็จ` };
}

function saveBatchConfigs(configsObj, sessionUser) {
  for (const k in configsObj) {
    setConfig(k, configsObj[k]);
  }
  logAudit(sessionUser.userId, 'UPDATE_CONFIG', 'Config', configsObj);
  return { ok: true, message: 'บันทึกการตั้งค่าสำเร็จ' };
}

function getPrintProfilesList(branchId = '', stationId = '') {
  return getTable(SHEETS.PRINT_PROFILES).rows;
}

function savePrintProfileData(profileData, sessionUser) {
  const profileId = String(profileData.profileId || '').trim();
  if (!profileId) {
    throw new Error('กรุณาระบุรหัสโปรไฟล์เครื่องพิมพ์');
  }

  const now = new Date().toISOString();
  const record = {
    profileId: profileId,
    branchId: profileData.branchId || '*',
    stationId: profileData.stationId || '*',
    printerName: profileData.printerName || 'Standard Printer',
    paperType: profileData.paperType || '58mm',
    widthMm: parseFloat(profileData.widthMm) || 58,
    heightMm: parseFloat(profileData.heightMm) || 0,
    marginMm: parseFloat(profileData.marginMm) || 2,
    fontSize: parseFloat(profileData.fontSize) || 12,
    copies: parseInt(profileData.copies, 10) || 1,
    autoPrint: String(profileData.autoPrint !== false),
    showLogo: String(profileData.showLogo !== false),
    footer: profileData.footer || '',
    updatedAt: now
  };

  const existing = findRow(SHEETS.PRINT_PROFILES, r => r.profileId === profileId);
  if (existing) {
    updateRows(SHEETS.PRINT_PROFILES, r => r.profileId === profileId, r => {
      Object.assign(r, record);
      return r;
    });
    logAudit(sessionUser.userId, 'UPDATE_PRINT_PROFILE', 'PrintProfiles', { profileId });
  } else {
    appendRow(SHEETS.PRINT_PROFILES, record);
    logAudit(sessionUser.userId, 'CREATE_PRINT_PROFILE', 'PrintProfiles', { profileId });
  }

  return { ok: true, profile: record };
}

function getAuditLogsList(limit = 100) {
  const logs = getTable(SHEETS.AUDIT_LOG).rows;
  return logs.reverse().slice(0, limit);
}
