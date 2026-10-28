/**
 * Auth.gs - Authentication, Password hashing, Session management, Permissions
 */

function hashPassword(password, salt) {
  const rawBytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + ':' + password,
    Utilities.Charset.UTF_8
  );
  let hashStr = '';
  for (let i = 0; i < rawBytes.length; i++) {
    let byteVal = rawBytes[i];
    if (byteVal < 0) byteVal += 256;
    let hex = byteVal.toString(16);
    if (hex.length === 1) hex = '0' + hex;
    hashStr += hex;
  }
  return hashStr;
}

function generateRandomHex(len = 16) {
  let str = '';
  while (str.length < len) {
    str += Utilities.getUuid().replace(/-/g, '');
  }
  return str.substring(0, len);
}

function loginUser(username, password, clientInfo = {}) {
  const cleanUsername = String(username || '').trim().toLowerCase();
  if (!cleanUsername || !password) {
    throw new Error('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
  }

  const user = findRow(SHEETS.USERS, r => String(r.username).toLowerCase() === cleanUsername);
  if (!user) {
    throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }

  if (String(user.active) === 'false' || user.active === false || user.active === 0) {
    throw new Error('บัญชีผู้ใช้นี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
  }

  const now = new Date();
  if (user.lockedUntil) {
    const lockedUntilDate = new Date(user.lockedUntil);
    if (lockedUntilDate > now) {
      const waitMinutes = Math.ceil((lockedUntilDate.getTime() - now.getTime()) / 60000);
      throw new Error(`บัญชีนี้ถูกระงับชั่วคราวเนื่องจากใส่รหัสผ่านผิดหลายครั้ง กรุณารอ ${waitMinutes} นาที`);
    }
  }

  const testHash = hashPassword(password, user.salt);
  if (testHash !== user.passHash) {
    const failCount = (parseInt(user.failCount, 10) || 0) + 1;
    let lockedUntilStr = '';
    if (failCount >= 5) {
      const lockDate = new Date(now.getTime() + 15 * 60000); // Lock for 15 mins
      lockedUntilStr = lockDate.toISOString();
    }
    updateRows(SHEETS.USERS, r => r.userId === user.userId, r => {
      r.failCount = failCount;
      if (lockedUntilStr) r.lockedUntil = lockedUntilStr;
      return r;
    });
    logAudit(user.userId, 'LOGIN_FAILED', 'Users', { username: cleanUsername, failCount });
    throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }

  // Login successful
  const token = 'tok_' + generateRandomHex(32);
  const sessionHours = parseInt(getConfig('SESSION_EXPIRE_HOURS', '12'), 10) || 12;
  const expiresAt = new Date(now.getTime() + sessionHours * 3600000).toISOString();

  // Reset failCount and update lastLogin
  updateRows(SHEETS.USERS, r => r.userId === user.userId, r => {
    r.failCount = 0;
    r.lockedUntil = '';
    r.lastLogin = now.toISOString();
    return r;
  });

  // Save session to sheet
  appendRow(SHEETS.SESSIONS, {
    token: token,
    userId: user.userId,
    createdAt: now.toISOString(),
    expiresAt: expiresAt,
    userAgent: clientInfo.userAgent || '',
    ip: clientInfo.ip || ''
  });

  // Fetch role and permissions
  const role = findRow(SHEETS.ROLES, r => r.roleId === user.roleId) || {
    roleId: user.roleId,
    roleName: user.roleId,
    permissions: '{}'
  };

  let permissions = {};
  try {
    permissions = typeof role.permissions === 'string' ? JSON.parse(role.permissions || '{}') : (role.permissions || {});
  } catch (e) {
    permissions = {};
  }

  // Cache session data in CacheService for 6 hours (GAS CacheService limit is 6 hrs)
  try {
    const cache = CacheService.getScriptCache();
    const sessionPayload = {
      userId: user.userId,
      username: user.username,
      name: user.name,
      roleId: user.roleId,
      roleName: role.roleName,
      permissions: permissions,
      branchIds: String(user.branchIds || '').split(',').map(b => b.trim()).filter(Boolean),
      expiresAt: expiresAt
    };
    cache.put('sess_' + token, JSON.stringify(sessionPayload), 21600);
  } catch (e) {
    console.warn('Cache error:', e);
  }

  logAudit(user.userId, 'LOGIN_SUCCESS', 'Users', { username: cleanUsername });

  // Branches
  const userBranchIds = String(user.branchIds || '').split(',').map(b => b.trim()).filter(Boolean);

  return {
    ok: true,
    token: token,
    expiresAt: expiresAt,
    user: {
      userId: user.userId,
      username: user.username,
      name: user.name,
      roleId: user.roleId,
      roleName: role.roleName,
      branchIds: userBranchIds,
      permissions: permissions
    }
  };
}

function verifySession(token) {
  if (!token) return null;

  // 1. Check cache first
  try {
    const cache = CacheService.getScriptCache();
    const cached = cache.get('sess_' + token);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (new Date(parsed.expiresAt) > new Date()) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Cache read error:', e);
  }

  // 2. Check sheet
  const sessionRow = findRow(SHEETS.SESSIONS, r => r.token === token);
  if (!sessionRow) return null;

  if (new Date(sessionRow.expiresAt) <= new Date()) {
    deleteRows(SHEETS.SESSIONS, r => r.token === token);
    return null;
  }

  const user = findRow(SHEETS.USERS, r => r.userId === sessionRow.userId);
  if (!user || String(user.active) === 'false' || user.active === false) {
    return null;
  }

  const role = findRow(SHEETS.ROLES, r => r.roleId === user.roleId) || {
    roleId: user.roleId,
    roleName: user.roleId,
    permissions: '{}'
  };

  let permissions = {};
  try {
    permissions = typeof role.permissions === 'string' ? JSON.parse(role.permissions || '{}') : (role.permissions || {});
  } catch (e) {
    permissions = {};
  }

  const sessionPayload = {
    userId: user.userId,
    username: user.username,
    name: user.name,
    roleId: user.roleId,
    roleName: role.roleName,
    permissions: permissions,
    branchIds: String(user.branchIds || '').split(',').map(b => b.trim()).filter(Boolean),
    expiresAt: sessionRow.expiresAt
  };

  try {
    const cache = CacheService.getScriptCache();
    cache.put('sess_' + token, JSON.stringify(sessionPayload), 21600);
  } catch (e) {}

  return sessionPayload;
}

function logoutUser(token) {
  if (!token) return true;
  try {
    CacheService.getScriptCache().remove('sess_' + token);
  } catch (e) {}
  deleteRows(SHEETS.SESSIONS, r => r.token === token);
  return true;
}

function hasPermission(sessionUser, moduleName, actionName) {
  if (!sessionUser) return false;
  if (sessionUser.roleId === 'admin' || sessionUser.roleName === 'Admin') return true;
  const p = sessionUser.permissions;
  if (!p) return false;
  if (p[moduleName] && p[moduleName][actionName] === true) return true;
  // Wildcard check
  if (p[moduleName] && p[moduleName]['all'] === true) return true;
  return false;
}

function requireAuth(token, moduleName = '', actionName = '') {
  const session = verifySession(token);
  if (!session) {
    throw new Error('UNAUTHORIZED: เข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
  }
  if (moduleName && actionName) {
    if (!hasPermission(session, moduleName, actionName)) {
      throw new Error(`FORBIDDEN: คุณไม่มีสิทธิ์เข้าถึงหรือดำเนินการ [${moduleName}:${actionName}]`);
    }
  }
  return session;
}
