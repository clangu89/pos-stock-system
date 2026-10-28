/**
 * ui.js - Common UI Utilities, Toasts, Modals, and Dialogs
 */

const UI = {
  toastTimeout: null,

  showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const colors = {
      info: 'bg-slate-800 text-white border-slate-700',
      success: 'bg-emerald-600 text-white border-emerald-500',
      warning: 'bg-amber-600 text-white border-amber-500',
      error: 'bg-rose-600 text-white border-rose-500'
    };

    const icons = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌'
    };

    const toast = document.createElement('div');
    toast.className = `flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl border text-sm font-medium transition-all transform translate-y-2 opacity-0 ${colors[type] || colors.info}`;
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span class="flex-1">${message}</span>`;

    container.appendChild(toast);

    // Animate in
    setTimeout(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
      toast.classList.add('translate-y-0', 'opacity-100');
    }, 10);

    // Auto dismiss
    setTimeout(() => {
      toast.classList.remove('translate-y-0', 'opacity-100');
      toast.classList.add('translate-y-2', 'opacity-0');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) {
      el.classList.remove('hidden');
      el.classList.add('flex');
    }
  },

  closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) {
      el.classList.remove('flex');
      el.classList.add('hidden');
    }
  },

  showLoading(text = 'กำลังประมวลผล...') {
    const overlay = document.getElementById('globalLoadingOverlay');
    const msg = document.getElementById('globalLoadingText');
    if (msg) msg.textContent = text;
    if (overlay) {
      overlay.classList.remove('hidden');
      overlay.classList.add('flex');
    }
  },

  hideLoading() {
    const overlay = document.getElementById('globalLoadingOverlay');
    if (overlay) {
      overlay.classList.remove('flex');
      overlay.classList.add('hidden');
    }
  },

  confirmDialog(title, message) {
    return new Promise(resolve => {
      const modal = document.getElementById('confirmModal');
      const titleEl = document.getElementById('confirmModalTitle');
      const msgEl = document.getElementById('confirmModalMessage');
      const okBtn = document.getElementById('confirmModalOkBtn');
      const cancelBtn = document.getElementById('confirmModalCancelBtn');

      if (!modal) {
        resolve(window.confirm(`${title}\n${message}`));
        return;
      }

      titleEl.textContent = title || 'ยืนยันการดำเนินการ';
      msgEl.textContent = message || 'คุณแน่ใจหรือไม่ที่จะทำรายการนี้?';

      const handleOk = () => {
        cleanup();
        resolve(true);
      };
      const handleCancel = () => {
        cleanup();
        resolve(false);
      };

      const cleanup = () => {
        okBtn.removeEventListener('click', handleOk);
        cancelBtn.removeEventListener('click', handleCancel);
        this.closeModal('confirmModal');
      };

      okBtn.addEventListener('click', handleOk);
      cancelBtn.addEventListener('click', handleCancel);
      this.openModal('confirmModal');
    });
  }
};
