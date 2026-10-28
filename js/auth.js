/**
 * auth.js - Client-side Authentication, Sessions & Permissions Checker
 */

const Auth = {
  token: null,
  user: null,

  init() {
    this.token = localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN);
    const userStr = localStorage.getItem(CONFIG.STORAGE_KEYS.USER);
    if (userStr) {
      try {
        this.user = JSON.parse(userStr);
      } catch (e) {
        this.user = null;
      }
    }
  },

  getToken() {
    return this.token;
  },

  getUser() {
    return this.user;
  },

  isLoggedIn() {
    return !!(this.token && this.user);
  },

  setSession(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN, token);
    localStorage.setItem(CONFIG.STORAGE_KEYS.USER, JSON.stringify(user));
  },

  clearSession() {
    this.token = null;
    this.user = null;
    localStorage.removeItem(CONFIG.STORAGE_KEYS.TOKEN);
    localStorage.removeItem(CONFIG.STORAGE_KEYS.USER);
  },

  hasPerm(moduleName, actionName = 'view') {
    if (!this.user) return false;
    if (this.user.roleId === 'admin' || this.user.roleName === 'Admin') return true;
    const p = this.user.permissions;
    if (!p) return false;
    if (p[moduleName]) {
      if (p[moduleName]['all'] === true) return true;
      return p[moduleName][actionName] === true;
    }
    return false;
  },

  async login(username, password) {
    UI.showLoading('กำลังเข้าสู่ระบบ...');
    try {
      const res = await Api.call('login', { username, password });
      UI.hideLoading();

      if (res && res.token && res.user) {
        this.setSession(res.token, res.user);
        UI.showToast(`ยินดีต้อนรับคุณ ${res.user.name || res.user.username}`, 'success');
        SoundManager.speakText(`ยินดีต้อนรับคุณ ${res.user.name || res.user.username} ${SoundManager.voiceParticle}`);
        Router.navigate('launcher');
        return true;
      } else {
        const errMsg = (res && (res.error || res.message)) || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
        UI.showToast(errMsg, 'error');
        SoundManager.playErrorTone();
        return false;
      }
    } catch (err) {
      UI.hideLoading();
      UI.showToast(`เข้าสู่ระบบไม่สำเร็จ: ${err.message}`, 'error');
      return false;
    }
  },

  async logout() {
    if (this.token) {
      await Api.call('auth:logout');
    }
    this.clearSession();
    UI.showToast('ออกจากระบบเรียบร้อยแล้ว', 'info');
    Router.navigate('login');
  }
};
