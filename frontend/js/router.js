/**
 * router.js - Client-side Hash Router and View Switcher with Permission Guards
 */

const Router = {
  currentView: 'login',
  previousView: null,

  init() {
    window.addEventListener('hashchange', () => this.handleRoute());

    // Global System Shortcuts (F1: Manual, Esc: Return from Manual)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F1') {
        e.preventDefault();
        this.navigate('manual');
      } else if (e.key === 'Escape') {
        if (this.currentView === 'manual') {
          e.preventDefault();
          this.goBack();
        }
      }
    });

    this.handleRoute();
  },

  navigate(viewName) {
    if (this.currentView !== viewName && this.currentView !== 'manual') {
      this.previousView = this.currentView;
    }
    window.location.hash = `#${viewName}`;
  },

  goBack() {
    if (this.previousView && this.previousView !== 'manual') {
      this.navigate(this.previousView);
    } else {
      this.navigate(Auth.isLoggedIn() ? 'launcher' : 'login');
    }
  },

  handleRoute() {
    let hash = window.location.hash.replace('#', '').trim();
    if (!hash) {
      hash = Auth.isLoggedIn() ? 'launcher' : 'login';
    }

    // Support direct hash to topic e.g. #manual_sales
    if (hash.startsWith('manual_')) {
      const topicId = hash.replace('manual_', '');
      hash = 'manual';
      setTimeout(() => {
        if (typeof ManualModule !== 'undefined') {
          ManualModule.scrollToTopic(topicId);
        }
      }, 100);
    }

    // Auth Guard (exempt 'login' and 'manual' views)
    if (hash !== 'login' && hash !== 'manual' && !Auth.isLoggedIn()) {
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
    if (this.currentView !== viewName && this.currentView !== 'manual') {
      this.previousView = this.currentView;
    }
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
    } else if (viewName === 'manual' && typeof ManualModule !== 'undefined') {
      ManualModule.activate();
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Router };
}
