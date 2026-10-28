/**
 * auth.js - Client-side Authentication, Sessions & Permissions Checker
 */

const Auth = {
  token: null,
  user: null,
  activeBranch: null,
  accessibleBranches: [],

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

    const branchStr = localStorage.getItem('pos_active_branch_info');
    if (branchStr) {
      try {
        this.activeBranch = JSON.parse(branchStr);
      } catch (e) {
        this.activeBranch = null;
      }
    }

    const accBranchesStr = localStorage.getItem('pos_accessible_branches');
    if (accBranchesStr) {
      try {
        this.accessibleBranches = JSON.parse(accBranchesStr);
      } catch (e) {
        this.accessibleBranches = [];
      }
    }

    this.updateHeaderBranchInfo();
    this.loadPublicBranches();
  },

  getToken() {
    return this.token;
  },

  getUser() {
    return this.user;
  },

  getActiveBranchId() {
    return localStorage.getItem(CONFIG.STORAGE_KEYS.BRANCH_ID) || CONFIG.DEFAULT_BRANCH_ID;
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
    this.activeBranch = null;
    this.accessibleBranches = [];
    localStorage.removeItem(CONFIG.STORAGE_KEYS.TOKEN);
    localStorage.removeItem(CONFIG.STORAGE_KEYS.USER);
    localStorage.removeItem('pos_active_branch_info');
    localStorage.removeItem('pos_accessible_branches');
    this.updateHeaderBranchInfo();
  },

  async loadPublicBranches() {
    const select = document.getElementById('loginBranchSelect');
    if (!select) return;

    // 1. Load from cache immediately
    const cached = localStorage.getItem('pos_cached_branches');
    let branches = [];
    if (cached) {
      try {
        branches = JSON.parse(cached);
        this.renderLoginBranchSelect(branches);
      } catch (e) {}
    }

    // 2. Fetch fresh branches from backend
    try {
      const res = await Api.call('public:branches');
      if (res && res.ok && Array.isArray(res.branches)) {
        branches = res.branches;
        localStorage.setItem('pos_cached_branches', JSON.stringify(branches));
        this.renderLoginBranchSelect(branches);
      }
    } catch (e) {}
  },

  renderLoginBranchSelect(branches) {
    const select = document.getElementById('loginBranchSelect');
    if (!select || !Array.isArray(branches) || branches.length === 0) return;

    const savedBranchId = localStorage.getItem(CONFIG.STORAGE_KEYS.BRANCH_ID) || CONFIG.DEFAULT_BRANCH_ID;
    select.innerHTML = branches.map(b => `
      <option value="${b.branchId}" ${b.branchId === savedBranchId ? 'selected' : ''}>
        🏢 ${b.name} (${b.code || b.branchId})
      </option>
    `).join('');
  },

  updateHeaderBranchInfo() {
    const container = document.getElementById('headerBranchContainer');
    const nameEl = document.getElementById('headerBranchName');
    const codeEl = document.getElementById('headerBranchCode');

    if (!container) return;

    if (this.isLoggedIn()) {
      container.classList.remove('hidden');
      container.classList.add('sm:inline-flex');
      const bName = this.activeBranch ? this.activeBranch.name : (this.getActiveBranchId());
      const bCode = this.activeBranch ? `(${this.activeBranch.code || this.activeBranch.branchId})` : `(${this.getActiveBranchId()})`;
      if (nameEl) nameEl.textContent = bName;
      if (codeEl) codeEl.textContent = bCode;
    } else {
      container.classList.add('hidden');
      container.classList.remove('sm:inline-flex');
    }
  },

  openBranchSwitcherModal() {
    if (!this.isLoggedIn()) return;

    const listEl = document.getElementById('branchSwitcherList');
    if (!listEl) return;

    const currentBranchId = this.getActiveBranchId();
    const branches = this.accessibleBranches.length > 0 
      ? this.accessibleBranches 
      : [{ branchId: currentBranchId, name: this.activeBranch?.name || 'สาขาปัจจุบัน', code: this.activeBranch?.code || 'MAIN' }];

    listEl.innerHTML = branches.map(b => {
      const isAct = b.branchId === currentBranchId;
      return `
        <div onclick="Auth.switchBranch('${b.branchId}')"
             class="p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between select-none ${isAct ? 'bg-blue-50 border-blue-500 shadow-sm' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}">
          <div class="flex items-center gap-2.5">
            <span class="text-xl">🏢</span>
            <div>
              <div class="font-bold text-xs ${isAct ? 'text-blue-900' : 'text-slate-800'}">${b.name}</div>
              <div class="text-[11px] font-mono text-slate-400">ID: ${b.branchId} | Code: ${b.code || b.branchId}</div>
            </div>
          </div>
          ${isAct ? '<span class="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-black">กำลังใช้งาน</span>' : '<span class="text-xs text-slate-400">เลือก →</span>'}
        </div>
      `;
    }).join('');

    UI.openModal('branchSwitcherModal');
  },

  async switchBranch(newBranchId) {
    if (!newBranchId) return;
    if (newBranchId === this.getActiveBranchId()) {
      UI.closeModal('branchSwitcherModal');
      return;
    }

    UI.showLoading('กำลังสลับสาขา...');
    try {
      const res = await Api.call('auth:switchBranch', { branchId: newBranchId });
      UI.hideLoading();

      if (res && res.ok && res.activeBranch) {
        this.activeBranch = res.activeBranch;
        localStorage.setItem(CONFIG.STORAGE_KEYS.BRANCH_ID, res.activeBranchId);
        localStorage.setItem('pos_active_branch_info', JSON.stringify(res.activeBranch));
        this.updateHeaderBranchInfo();
        UI.closeModal('branchSwitcherModal');
        UI.showToast(`สลับไปยัง ${res.activeBranch.name} เรียบร้อยแล้ว`, 'success');

        // Refresh currently active screen
        if (Router.currentView === 'sales' && typeof SalesModule !== 'undefined') {
          SalesModule.activeBranchId = res.activeBranchId;
          SalesModule.refreshData();
        } else if (Router.currentView === 'stock' && typeof StockModule !== 'undefined') {
          StockModule.activeBranchId = res.activeBranchId;
          StockModule.refreshData();
        } else if (Router.currentView === 'reports' && typeof ReportsModule !== 'undefined') {
          ReportsModule.loadData();
        } else if (Router.currentView === 'admin' && typeof AdminModule !== 'undefined') {
          AdminModule.loadAdminData();
        }
      } else {
        UI.showToast(res?.message || 'ไม่สามารถสลับสาขาได้', 'error');
      }
    } catch (err) {
      UI.hideLoading();
      UI.showToast(`เกิดข้อผิดพลาด: ${err.message}`, 'error');
    }
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

  async login(username, password, branchId) {
    UI.showLoading('กำลังเข้าสู่ระบบ...');
    try {
      const selectedBranch = branchId || document.getElementById('loginBranchSelect')?.value || '';
      const res = await Api.call('login', { username, password, branchId: selectedBranch });
      UI.hideLoading();

      if (res && res.token && res.user) {
        this.setSession(res.token, res.user);

        if (res.activeBranchId) {
          localStorage.setItem(CONFIG.STORAGE_KEYS.BRANCH_ID, res.activeBranchId);
        }
        if (res.activeBranch) {
          this.activeBranch = res.activeBranch;
          localStorage.setItem('pos_active_branch_info', JSON.stringify(res.activeBranch));
        }
        if (Array.isArray(res.accessibleBranches)) {
          this.accessibleBranches = res.accessibleBranches;
          localStorage.setItem('pos_accessible_branches', JSON.stringify(res.accessibleBranches));
        }

        this.updateHeaderBranchInfo();
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
