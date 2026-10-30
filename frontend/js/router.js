/**
 * router.js - Client-side Hash Router and View Switcher with Permission Guards
 */

const Router = {
  currentView: 'login',

  init() {
    window.addEventListener('hashchange', () => this.handleRoute());
    this.handleRoute();
  },

  navigate(viewName) {
    window.location.hash = `#${viewName}`;
  },

  handleRoute() {
    let hash = window.location.hash.replace('#', '').trim();
    if (!hash) {
      hash = Auth.isLoggedIn() ? 'launcher' : 'login';
    }

    // Auth Guard
    if (hash !== 'login' && !Auth.isLoggedIn()) {
      window.location.hash = '#login';
      return;
    }

    // Permission Guard
    if (hash === 'sales' && !Auth.hasPerm('sales', 'view')) {
      UI.showToast('คุณไม่มีสิทธิ์เข้าใช้งานระบบการขาย (POS)', 'warning');
      window.location.hash = '#launcher';
      return;
    }

    if (hash === 'stock' && !Auth.hasPerm('stock', 'view')) {
      UI.showToast('คุณไม่มีสิทธิ์เข้าใช้งานระบบสต๊อกสินค้า', 'warning');
      window.location.hash = '#launcher';
      return;
    }

    if (hash === 'reports' && !Auth.hasPerm('reports', 'view')) {
      UI.showToast('คุณไม่มีสิทธิ์เข้าใช้งานระบบรายงาน', 'warning');
      window.location.hash = '#launcher';
      return;
    }

    if (hash === 'finance' && !Auth.hasPerm('finance', 'view')) {
      UI.showToast('คุณไม่มีสิทธิ์เข้าใช้งานระบบการเงิน', 'warning');
      window.location.hash = '#launcher';
      return;
    }

    if (hash === 'admin' && !Auth.hasPerm('admin', 'view')) {
      UI.showToast('คุณไม่มีสิทธิ์เข้าใช้งานระบบผู้ดูแลระบบ (Admin)', 'warning');
      window.location.hash = '#launcher';
      return;
    }

    this.switchView(hash);
  },

  switchView(viewName) {
    this.currentView = viewName;

    // Hide all view containers
    const views = document.querySelectorAll('.view-screen');
    views.forEach(v => {
      v.classList.add('hidden');
      v.classList.remove('block');
    });

    // Show target view container
    const target = document.getElementById(`view_${viewName}`);
    if (target) {
      target.classList.remove('hidden');
      target.classList.add('block');
    }

    // Update Header
    this.updateHeaderUI();

    // Trigger module lifecycle
    if (viewName === 'launcher' && typeof LauncherModule !== 'undefined') {
      LauncherModule.render();
    } else if (viewName === 'sales' && typeof SalesModule !== 'undefined') {
      SalesModule.activate();
    } else if (viewName === 'stock' && typeof StockModule !== 'undefined') {
      StockModule.activate();
    } else if (viewName === 'reports' && typeof ReportsModule !== 'undefined') {
      ReportsModule.activate();
    } else if (viewName === 'finance' && typeof FinanceModule !== 'undefined') {
      FinanceModule.activate();
    } else if (viewName === 'admin' && typeof AdminModule !== 'undefined') {
      AdminModule.activate();
    }
  },

  updateHeaderUI() {
    const header = document.getElementById('mainHeader');
    const user = Auth.getUser();

    if (!header) return;

    if (this.currentView === 'login' || !Auth.isLoggedIn()) {
      header.classList.add('hidden');
    } else {
      header.classList.remove('hidden');

      const userNameEl = document.getElementById('headerUserName');
      const userRoleEl = document.getElementById('headerUserRole');
      if (userNameEl) userNameEl.textContent = user.name || user.username;
      if (userRoleEl) userRoleEl.textContent = user.roleName || user.roleId;

      SoundManager.updateStatusBadge();
    }
  }
};
