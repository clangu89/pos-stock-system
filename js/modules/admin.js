/**
 * admin.js - User Accounts, Roles Matrix, Receipt Patterns, Printer Drivers, Voice Settings & Audit
 */

const AdminModule = {
  currentTab: 'users',
  users: [],
  roles: [],
  branches: [],
  configs: {},
  configsTable: [],
  categories: [],
  units: [],
  products: [],
  profiles: [],
  receiptTextsList: [],
  currentReceiptScope: 'DEFAULT',
  previewPaperWidth: 58,

  async activate() {
    this.setupTabNavigation();
    await this.loadAdminData();
    this.populateVoiceSettingsUI();
  },

  setupTabNavigation() {
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.onclick = () => {
        const tab = btn.dataset.tab;
        this.switchTab(tab);
      };
    });
  },

  switchTab(tabName) {
    this.currentTab = tabName;
    document.querySelectorAll('.admin-tab-btn').forEach(b => {
      const isAct = b.dataset.tab === tabName;
      b.className = `admin-tab-btn px-4 py-2.5 rounded-xl font-bold text-xs transition cursor-pointer ${isAct ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'}`;
    });

    document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
    const target = document.getElementById(`adminTab_${tabName}`);
    if (target) target.classList.remove('hidden');

    if (tabName === 'users') this.renderUsersTable();
    else if (tabName === 'roles') this.renderRolesMatrix();
    else if (tabName === 'receipt') this.renderReceiptSettings();
    else if (tabName === 'receiptText') this.loadReceiptTextsUI();
    else if (tabName === 'printer') this.renderPrinterSettings();
    else if (tabName === 'voice') this.populateVoiceSettingsUI();
    else if (tabName === 'constants') this.loadConstantsUI();
    else if (tabName === 'categories') this.loadCategoriesUI();
    else if (tabName === 'units') this.loadUnitsUI();
    else if (tabName === 'audit') this.loadAuditLogs();
    else if (tabName === 'api') this.renderApiSettings();
  },

  async loadAdminData() {
    UI.showLoading('กำลังโหลดข้อมูลระบบผู้ดูแล...');
    const [uRes, rRes, bRes, cRes, pRes, catRes, unitRes, prodRes] = await Promise.all([
      Api.call('admin:users'),
      Api.call('admin:roles'),
      Api.call('admin:branches'),
      Api.call('admin:configs'),
      Api.call('admin:printProfiles'),
      Api.call('admin:categories'),
      Api.call('admin:units'),
      Api.call('products:list')
    ]);
    UI.hideLoading();

    if (uRes && uRes.ok) this.users = uRes.users || [];
    if (rRes && rRes.ok) this.roles = rRes.roles || [];
    if (bRes && bRes.ok) this.branches = bRes.branches || [];
    if (cRes && cRes.ok) this.configs = cRes.configs || {};
    if (pRes && pRes.ok) this.profiles = pRes.profiles || [];
    if (catRes && catRes.ok) this.categories = catRes.categories || [];
    if (unitRes && unitRes.ok) this.units = unitRes.units || [];
    if (prodRes && prodRes.ok) this.products = prodRes.products || [];

    this.renderUsersTable();
  },

  // --- Users Management ---
  renderUsersTable() {
    const tbody = document.getElementById('adminUsersTableBody');
    if (!tbody) return;

    tbody.innerHTML = this.users.map(u => `
      <tr class="border-b border-slate-100 text-sm hover:bg-slate-50">
        <td class="py-3 px-3 font-mono font-bold">${u.username}</td>
        <td class="py-3 px-3 font-bold text-slate-900">${u.name}</td>
        <td class="py-3 px-3">
          <span class="px-2.5 py-1 rounded-full text-xs font-bold ${u.roleId === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}">
            ${u.roleName || u.roleId}
          </span>
        </td>
        <td class="py-3 px-3 text-xs text-slate-600">${u.branchIds.join(', ') || 'ทุกสาขา'}</td>
        <td class="py-3 px-3 text-center">
          <span class="px-2 py-0.5 rounded-full text-xs font-bold ${u.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}">
            ${u.active ? 'ใช้งาน' : 'ระงับ'}
          </span>
        </td>
        <td class="py-3 px-3 text-right">
          <button onclick="AdminModule.openUserModal('${u.userId}')" class="px-2 py-1 text-xs font-bold text-blue-600 hover:bg-blue-50 rounded-lg">แก้ไข</button>
        </td>
      </tr>
    `).join('');
  },

  openUserModal(userId = '') {
    const isEdit = !!userId;
    document.getElementById('userModalTitle').textContent = isEdit ? 'แก้ไขผู้ใช้งาน' : 'เพิ่มผู้ใช้งานใหม่';

    // Populate roles
    const roleSelect = document.getElementById('userModalRoleSelect');
    if (roleSelect) {
      roleSelect.innerHTML = this.roles.map(r => `<option value="${r.roleId}">${r.roleName}</option>`).join('');
    }

    if (isEdit) {
      const u = this.users.find(x => x.userId === userId);
      if (!u) return;
      document.getElementById('userModalUserId').value = u.userId;
      document.getElementById('userModalUsername').value = u.username;
      document.getElementById('userModalUsername').disabled = true;
      document.getElementById('userModalName').value = u.name;
      document.getElementById('userModalPassword').value = '';
      document.getElementById('userModalPassword').placeholder = '(เว้นว่างหากไม่เปลี่ยน)';
      document.getElementById('userModalRoleSelect').value = u.roleId;
      document.getElementById('userModalActiveCheck').checked = u.active;
    } else {
      document.getElementById('userModalUserId').value = '';
      document.getElementById('userModalUsername').value = '';
      document.getElementById('userModalUsername').disabled = false;
      document.getElementById('userModalName').value = '';
      document.getElementById('userModalPassword').value = '';
      document.getElementById('userModalPassword').placeholder = 'กำหนดรหัสผ่าน';
      document.getElementById('userModalActiveCheck').checked = true;
    }

    UI.openModal('userEditModal');
  },

  async saveUserModal() {
    const userId = document.getElementById('userModalUserId').value;
    const username = document.getElementById('userModalUsername').value.trim();
    const name = document.getElementById('userModalName').value.trim();
    const password = document.getElementById('userModalPassword').value;
    const roleId = document.getElementById('userModalRoleSelect').value;
    const active = document.getElementById('userModalActiveCheck').checked;

    if (!username || !name) {
      UI.showToast('กรุณากรอกชื่อผู้ใช้และชื่อ-นามสกุล', 'warning');
      return;
    }

    if (!userId && !password) {
      UI.showToast('กรุณากำหนดรหัสผ่านสำหรับผู้ใช้ใหม่', 'warning');
      return;
    }

    const payload = {
      userId,
      username,
      name,
      password: password || undefined,
      roleId,
      branchIds: ['B01'],
      active
    };

    UI.showLoading('กำลังบันทึกข้อมูลผู้ใช้...');
    const res = await Api.call('admin:saveUser', payload);
    UI.hideLoading();

    if (res && res.ok) {
      UI.closeModal('userEditModal');
      UI.showToast(res.message || 'บันทึกสำเร็จ', 'success');
      const uRes = await Api.call('admin:users');
      if (uRes && uRes.ok) this.users = uRes.users;
      this.renderUsersTable();
    } else {
      UI.showToast(`บันทึกไม่สำเร็จ: ${res.error || res.message}`, 'error');
    }
  },

  // --- Roles & Permissions Matrix ---
  renderRolesMatrix() {
    const container = document.getElementById('adminRolesContainer');
    if (!container) return;

    container.innerHTML = this.roles.map(r => {
      const p = r.permissions || {};
      const isAdmin = r.roleId === 'admin';

      return `
        <div class="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3">
          <div class="flex items-center justify-between pb-2 border-b border-slate-200">
            <div>
              <h4 class="font-bold text-base text-slate-900">${r.roleName}</h4>
              <p class="text-xs text-slate-500">${r.description || ''}</p>
            </div>
            <span class="text-xs font-mono font-bold text-slate-400">ID: ${r.roleId}</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div class="bg-white p-3 rounded-xl border border-slate-200">
              <div class="font-bold text-blue-700 mb-2">🛒 งานขาย (Sales)</div>
              <label class="flex items-center gap-1.5 mb-1"><input type="checkbox" ${isAdmin || p.sales?.view ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} id="perm_${r.roleId}_sales_view"> ดูหน้าขาย</label>
              <label class="flex items-center gap-1.5 mb-1"><input type="checkbox" ${isAdmin || p.sales?.create ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} id="perm_${r.roleId}_sales_create"> คิดเงิน/เปิดบิล</label>
              <label class="flex items-center gap-1.5"><input type="checkbox" ${isAdmin || p.sales?.void ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} id="perm_${r.roleId}_sales_void"> ยกเลิกใบเสร็จ</label>
            </div>
            <div class="bg-white p-3 rounded-xl border border-slate-200">
              <div class="font-bold text-emerald-700 mb-2">📦 สต๊อก (Stock)</div>
              <label class="flex items-center gap-1.5 mb-1"><input type="checkbox" ${isAdmin || p.stock?.view ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} id="perm_${r.roleId}_stock_view"> ดูรายการสต๊อก</label>
              <label class="flex items-center gap-1.5 mb-1"><input type="checkbox" ${isAdmin || p.stock?.receive ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} id="perm_${r.roleId}_stock_receive"> รับสินค้าเข้า</label>
              <label class="flex items-center gap-1.5 mb-1"><input type="checkbox" ${isAdmin || p.stock?.adjust ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} id="perm_${r.roleId}_stock_adjust"> ปรับปรุงยอด</label>
              <label class="flex items-center gap-1.5"><input type="checkbox" ${isAdmin || p.stock?.transfer ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} id="perm_${r.roleId}_stock_transfer"> โอนย้ายสาขา</label>
            </div>
            <div class="bg-white p-3 rounded-xl border border-slate-200">
              <div class="font-bold text-amber-700 mb-2">📊 รายงาน (Reports)</div>
              <label class="flex items-center gap-1.5 mb-1"><input type="checkbox" ${isAdmin || p.reports?.view ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} id="perm_${r.roleId}_reports_view"> ดูรายงานยอดขาย</label>
              <label class="flex items-center gap-1.5"><input type="checkbox" ${isAdmin || p.reports?.export ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} id="perm_${r.roleId}_reports_export"> ส่งออกข้อมูล</label>
            </div>
            <div class="bg-white p-3 rounded-xl border border-slate-200">
              <div class="font-bold text-slate-800 mb-2">⚙️ Admin (ระบบ)</div>
              <label class="flex items-center gap-1.5 mb-1"><input type="checkbox" ${isAdmin || p.admin?.users ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} id="perm_${r.roleId}_admin_users"> จัดการผู้ใช้</label>
              <label class="flex items-center gap-1.5 mb-1"><input type="checkbox" ${isAdmin || p.admin?.config ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} id="perm_${r.roleId}_admin_config"> ตั้งค่าระบบ</label>
              <label class="flex items-center gap-1.5"><input type="checkbox" ${isAdmin || p.admin?.printer ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} id="perm_${r.roleId}_admin_printer"> ตั้งค่าเครื่องพิมพ์</label>
            </div>
          </div>
          ${!isAdmin ? `
            <div class="text-right pt-2">
              <button onclick="AdminModule.saveRolePermissions('${r.roleId}')" class="px-4 py-1.5 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition">
                บันทึกสิทธิ์บทบาทนี้
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  },

  async saveRolePermissions(roleId) {
    const role = this.roles.find(r => r.roleId === roleId);
    if (!role) return;

    const perms = {
      sales: {
        view: document.getElementById(`perm_${roleId}_sales_view`)?.checked || false,
        create: document.getElementById(`perm_${roleId}_sales_create`)?.checked || false,
        void: document.getElementById(`perm_${roleId}_sales_void`)?.checked || false
      },
      stock: {
        view: document.getElementById(`perm_${roleId}_stock_view`)?.checked || false,
        receive: document.getElementById(`perm_${roleId}_stock_receive`)?.checked || false,
        adjust: document.getElementById(`perm_${roleId}_stock_adjust`)?.checked || false,
        transfer: document.getElementById(`perm_${roleId}_stock_transfer`)?.checked || false
      },
      reports: {
        view: document.getElementById(`perm_${roleId}_reports_view`)?.checked || false,
        export: document.getElementById(`perm_${roleId}_reports_export`)?.checked || false
      },
      admin: {
        users: document.getElementById(`perm_${roleId}_admin_users`)?.checked || false,
        config: document.getElementById(`perm_${roleId}_admin_config`)?.checked || false,
        printer: document.getElementById(`perm_${roleId}_admin_printer`)?.checked || false
      }
    };

    UI.showLoading('กำลังบันทึกสิทธิ์การใช้งาน...');
    const res = await Api.call('admin:saveRole', {
      roleId,
      roleName: role.roleName,
      description: role.description,
      permissions: perms
    });
    UI.hideLoading();

    if (res && res.ok) {
      UI.showToast('บันทึกสิทธิ์บทบาทสำเร็จ', 'success');
      const rRes = await Api.call('admin:roles');
      if (rRes && rRes.ok) this.roles = rRes.roles;
    } else {
      UI.showToast(`บันทึกไม่สำเร็จ: ${res.error || res.message}`, 'error');
    }
  },

  // --- Receipt Number Format Settings ---
  renderReceiptSettings() {
    const prefixInput = document.getElementById('receiptPrefixInput');
    const formatInput = document.getElementById('receiptFormatInput');
    const cycleSelect = document.getElementById('receiptCycleSelect');

    if (prefixInput) prefixInput.value = this.configs.RECEIPT_PREFIX || 'RC';
    if (formatInput) formatInput.value = this.configs.RECEIPT_FORMAT || '{PREFIX}{BRANCH}-{YYYY}{MM}{DD}-{RUN:5}';
    if (cycleSelect) cycleSelect.value = this.configs.RECEIPT_RESET_CYCLE || 'DAILY';

    this.updateReceiptPreview();
  },

  updateReceiptPreview() {
    const format = document.getElementById('receiptFormatInput')?.value || '{PREFIX}{BRANCH}-{YYYY}{MM}{DD}-{RUN:5}';
    const prefix = document.getElementById('receiptPrefixInput')?.value || 'RC';
    const previewEl = document.getElementById('receiptFormatPreview');

    const d = new Date();
    const yyyy = String(d.getFullYear());
    const yy = yyyy.substring(2);
    const be = String(d.getFullYear() + 543);
    const mm = ('0' + (d.getMonth() + 1)).slice(-2);
    const dd = ('0' + d.getDate()).slice(-2);

    let res = format
      .replace(/{PREFIX}/gi, prefix)
      .replace(/{BRANCH}/gi, 'MAIN')
      .replace(/{YYYY}/gi, yyyy)
      .replace(/{YY}/gi, yy)
      .replace(/{BE}/gi, be)
      .replace(/{MM}/gi, mm)
      .replace(/{DD}/gi, dd)
      .replace(/{RUN(?::(\d+))?}/gi, (m, digits) => {
        const len = digits ? parseInt(digits, 10) : 5;
        return '00000000'.substring(0, len - 1) + '1';
      });

    if (previewEl) previewEl.textContent = res;
  },

  async saveReceiptSettings() {
    const prefix = document.getElementById('receiptPrefixInput').value.trim();
    const format = document.getElementById('receiptFormatInput').value.trim();
    const cycle = document.getElementById('receiptCycleSelect').value;

    if (!format.includes('{RUN')) {
      UI.showToast('รูปแบบเลขที่ใบเสร็จต้องมี Token {RUN} หรือ {RUN:5}', 'warning');
      return;
    }

    UI.showLoading('กำลังบันทึกรูปแบบเลขที่ใบเสร็จ...');
    const res = await Api.call('admin:saveConfigs', {
      RECEIPT_PREFIX: prefix,
      RECEIPT_FORMAT: format,
      RECEIPT_RESET_CYCLE: cycle
    });
    UI.hideLoading();

    if (res && res.ok) {
      this.configs.RECEIPT_PREFIX = prefix;
      this.configs.RECEIPT_FORMAT = format;
      this.configs.RECEIPT_RESET_CYCLE = cycle;
      UI.showToast('บันทึกรูปแบบเลขที่ใบเสร็จสำเร็จ', 'success');
    } else {
      UI.showToast(`บันทึกไม่สำเร็จ: ${res.error || res.message}`, 'error');
    }
  },

  // --- Receipt Text Customization & Live Preview ---
  async loadReceiptTextsUI() {
    UI.showLoading('กำลังโหลดข้อความใบเสร็จ...');
    const res = await Api.call('admin:receiptTexts');
    UI.hideLoading();

    if (res && res.ok && res.data) {
      this.receiptTextsList = res.data.items || [];
      if (res.data.branches) this.branches = res.data.branches;
    }

    // Populate branch select
    const branchSelect = document.getElementById('receiptTextBranchSelect');
    if (branchSelect) {
      let opts = '<option value="DEFAULT">⭐ ค่ากลาง (ใช้งานทุกสาขา)</option>';
      this.branches.forEach(b => {
        opts += `<option value="${b.branchId}">🏢 ${b.name} (${b.code || b.branchId})</option>`;
      });
      branchSelect.innerHTML = opts;
      branchSelect.value = this.currentReceiptScope || 'DEFAULT';
    }

    this.onReceiptTextScopeChange(this.currentReceiptScope || 'DEFAULT');
  },

  onReceiptTextScopeChange(scopeVal) {
    this.currentReceiptScope = scopeVal;

    const defaultItem = this.receiptTextsList.find(r => r.scopeId === 'DEFAULT' || r.branchId === '*') || {};
    const branchItem = scopeVal !== 'DEFAULT'
      ? this.receiptTextsList.find(r => r.branchId === scopeVal && r.scopeId !== 'DEFAULT')
      : null;

    const banner = document.getElementById('receiptTextOverrideBanner');
    const bannerText = document.getElementById('receiptTextOverrideText');

    if (scopeVal === 'DEFAULT') {
      if (banner) banner.classList.add('hidden');
    } else {
      if (banner) banner.classList.remove('hidden');
      if (branchItem) {
        if (bannerText) bannerText.textContent = `สาขา ${scopeVal} มีการปรับแต่งข้อความเฉพาะของตนเอง`;
      } else {
        if (bannerText) bannerText.textContent = `สาขา ${scopeVal} กำลังใช้ค่ากลาง (เมื่อแก้ไขและบันทึก จะสร้างการตั้งค่าเฉพาะสาขา)`;
      }
    }

    const branchMeta = this.branches.find(b => b.branchId === scopeVal);

    const getVal = (field, fallback = '') => {
      if (branchItem && branchItem[field] !== undefined && String(branchItem[field]).trim() !== '') {
        return branchItem[field];
      }
      if (defaultItem && defaultItem[field] !== undefined && String(defaultItem[field]).trim() !== '') {
        return defaultItem[field];
      }
      return fallback;
    };

    const getBool = (field, def = true) => {
      if (branchItem && branchItem[field] !== undefined && String(branchItem[field]).trim() !== '') {
        const v = String(branchItem[field]).toLowerCase();
        return v === 'true' || v === '1';
      }
      if (defaultItem && defaultItem[field] !== undefined && String(defaultItem[field]).trim() !== '') {
        const v = String(defaultItem[field]).toLowerCase();
        return v === 'true' || v === '1';
      }
      return def;
    };

    document.getElementById('receiptTextTitleInput').value = getVal('receiptTitle', 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ');
    document.getElementById('receiptTextStoreNameInput').value = getVal('storeName', this.configs.STORE_NAME || 'POS Store');
    document.getElementById('receiptTextSubHeaderInput').value = getVal('subHeader', 'ยินดีต้อนรับ / Welcome');

    const defAddress = (branchMeta && branchMeta.address) ? branchMeta.address : (this.configs.STORE_ADDRESS || '');
    document.getElementById('receiptTextAddressInput').value = getVal('address', defAddress);

    const defPhone = (branchMeta && branchMeta.phone) ? branchMeta.phone : (this.configs.STORE_PHONE || '');
    document.getElementById('receiptTextPhoneInput').value = getVal('phone', defPhone);

    const defTaxId = (branchMeta && branchMeta.taxId) ? branchMeta.taxId : (this.configs.STORE_TAX_ID || '');
    document.getElementById('receiptTextTaxIdInput').value = getVal('taxId', defTaxId);

    document.getElementById('receiptTextFooterInput').value = getVal('footer', 'ขอบคุณที่ใช้บริการ / Thank you!\nสินค้าซื้อแล้วไม่รับเปลี่ยนคืน');

    document.getElementById('receiptTextShowAddressCheck').checked = getBool('showAddress', true);
    document.getElementById('receiptTextShowPhoneCheck').checked = getBool('showPhone', true);
    document.getElementById('receiptTextShowTaxIdCheck').checked = getBool('showTaxId', true);
    document.getElementById('receiptTextShowCashierCheck').checked = getBool('showCashier', true);
    document.getElementById('receiptTextShowBranchCheck').checked = getBool('showBranch', true);

    this.updateReceiptTextPreview();
  },

  updateReceiptTextPreview() {
    const title = document.getElementById('receiptTextTitleInput')?.value || 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ';
    const storeName = document.getElementById('receiptTextStoreNameInput')?.value || 'POS Store';
    const subHeader = document.getElementById('receiptTextSubHeaderInput')?.value || '';
    const address = document.getElementById('receiptTextAddressInput')?.value || '';
    const phone = document.getElementById('receiptTextPhoneInput')?.value || '';
    const taxId = document.getElementById('receiptTextTaxIdInput')?.value || '';
    const footer = document.getElementById('receiptTextFooterInput')?.value || '';

    const showAddress = document.getElementById('receiptTextShowAddressCheck')?.checked;
    const showPhone = document.getElementById('receiptTextShowPhoneCheck')?.checked;
    const showTaxId = document.getElementById('receiptTextShowTaxIdCheck')?.checked;
    const showCashier = document.getElementById('receiptTextShowCashierCheck')?.checked;
    const showBranch = document.getElementById('receiptTextShowBranchCheck')?.checked;

    const elStoreName = document.getElementById('prevStoreName');
    if (elStoreName) elStoreName.innerHTML = multilineHtml(storeName);

    const elSubHeader = document.getElementById('prevSubHeader');
    if (elSubHeader) {
      if (subHeader.trim()) {
        elSubHeader.innerHTML = multilineHtml(subHeader);
        elSubHeader.classList.remove('hidden');
      } else {
        elSubHeader.classList.add('hidden');
      }
    }

    const elAddress = document.getElementById('prevAddress');
    if (elAddress) {
      if (showAddress && address.trim()) {
        elAddress.innerHTML = multilineHtml(address);
        elAddress.classList.remove('hidden');
      } else {
        elAddress.classList.add('hidden');
      }
    }

    const elPhone = document.getElementById('prevPhone');
    if (elPhone) {
      if (showPhone && phone.trim()) {
        elPhone.textContent = `โทร: ${phone}`;
        elPhone.classList.remove('hidden');
      } else {
        elPhone.classList.add('hidden');
      }
    }

    const elTaxId = document.getElementById('prevTaxId');
    if (elTaxId) {
      if (showTaxId && taxId.trim()) {
        elTaxId.textContent = `เลขผู้เสียภาษี: ${taxId}`;
        elTaxId.classList.remove('hidden');
      } else {
        elTaxId.classList.add('hidden');
      }
    }

    const elTitle = document.getElementById('prevTitle');
    if (elTitle) elTitle.textContent = title;

    const elBranch = document.getElementById('prevBranch');
    if (elBranch) {
      if (showBranch) {
        elBranch.textContent = `สาขา: ${this.currentReceiptScope === 'DEFAULT' ? 'MAIN' : this.currentReceiptScope}`;
        elBranch.classList.remove('hidden');
      } else {
        elBranch.classList.add('hidden');
      }
    }

    const elCashier = document.getElementById('prevCashier');
    if (elCashier) {
      if (showCashier) {
        elCashier.textContent = `แคชเชียร์: ${Auth.getUser()?.username || 'admin'}`;
        elCashier.classList.remove('hidden');
      } else {
        elCashier.classList.add('hidden');
      }
    }

    const elFooter = document.getElementById('prevFooter');
    if (elFooter) {
      elFooter.innerHTML = multilineHtml(footer || 'ขอบคุณที่ใช้บริการ / Thank you!');
    }
  },

  setPreviewPaperWidth(width) {
    this.previewPaperWidth = width;
    const card = document.getElementById('receiptLivePreviewCard');
    const btn58 = document.getElementById('previewWidth58Btn');
    const btn80 = document.getElementById('previewWidth80Btn');

    if (card) {
      if (width === 80) {
        card.style.width = '350px';
        card.style.fontSize = '12px';
        if (btn80) {
          btn80.className = 'px-2 py-0.5 rounded bg-white text-slate-900 shadow-xs';
        }
        if (btn58) {
          btn58.className = 'px-2 py-0.5 rounded text-slate-600 hover:text-slate-900';
        }
      } else {
        card.style.width = '260px';
        card.style.fontSize = '11px';
        if (btn58) {
          btn58.className = 'px-2 py-0.5 rounded bg-white text-slate-900 shadow-xs';
        }
        if (btn80) {
          btn80.className = 'px-2 py-0.5 rounded text-slate-600 hover:text-slate-900';
        }
      }
    }
  },

  async saveReceiptTextSettings() {
    const isDefault = this.currentReceiptScope === 'DEFAULT';
    const payload = {
      scopeId: isDefault ? 'DEFAULT' : `BRANCH_${this.currentReceiptScope}`,
      branchId: isDefault ? '*' : this.currentReceiptScope,
      receiptTitle: document.getElementById('receiptTextTitleInput').value.trim(),
      storeName: document.getElementById('receiptTextStoreNameInput').value.trim(),
      subHeader: document.getElementById('receiptTextSubHeaderInput').value.trim(),
      address: document.getElementById('receiptTextAddressInput').value.trim(),
      phone: document.getElementById('receiptTextPhoneInput').value.trim(),
      taxId: document.getElementById('receiptTextTaxIdInput').value.trim(),
      footer: document.getElementById('receiptTextFooterInput').value.trim(),
      showAddress: document.getElementById('receiptTextShowAddressCheck').checked,
      showPhone: document.getElementById('receiptTextShowPhoneCheck').checked,
      showTaxId: document.getElementById('receiptTextShowTaxIdCheck').checked,
      showCashier: document.getElementById('receiptTextShowCashierCheck').checked,
      showBranch: document.getElementById('receiptTextShowBranchCheck').checked
    };

    UI.showLoading('กำลังบันทึกข้อความใบเสร็จ...');
    const res = await Api.call('admin:saveReceiptTexts', payload);
    UI.hideLoading();

    if (res && res.ok) {
      UI.showToast(res.message || 'บันทึกข้อความใบเสร็จสำเร็จ', 'success');
      SoundManager.playSuccessChime();

      // Refresh list
      const updatedList = await Api.call('admin:receiptTexts');
      if (updatedList && updatedList.ok && updatedList.data) {
        this.receiptTextsList = updatedList.data.items || [];
      }
      this.onReceiptTextScopeChange(this.currentReceiptScope);
    } else {
      UI.showToast(`บันทึกไม่สำเร็จ: ${res.error || res.message}`, 'error');
      SoundManager.playErrorTone();
    }
  },

  async deleteReceiptTextOverride() {
    if (this.currentReceiptScope === 'DEFAULT') return;

    const ok = confirm(`ต้องการลบการตั้งค่าเฉพาะสาขา ${this.currentReceiptScope} เพื่อกลับไปใช้ค่ากลางใช่หรือไม่?`);
    if (!ok) return;

    UI.showLoading('กำลังลบการปรับแต่งเฉพาะสาขา...');
    const res = await Api.call('admin:deleteReceiptTexts', { branchId: this.currentReceiptScope });
    UI.hideLoading();

    if (res && res.ok) {
      UI.showToast(res.message || 'ลบการปรับแต่งเรียบร้อยแล้ว', 'success');
      // Refresh list
      const updatedList = await Api.call('admin:receiptTexts');
      if (updatedList && updatedList.ok && updatedList.data) {
        this.receiptTextsList = updatedList.data.items || [];
      }
      this.onReceiptTextScopeChange(this.currentReceiptScope);
    } else {
      UI.showToast(`เกิดข้อผิดพลาด: ${res.error || res.message}`, 'error');
    }
  },

  testPrintFromTextSettings() {
    const mockSale = {
      receiptNo: 'RC-PREVIEW-001',
      ts: new Date().toISOString(),
      branchId: this.currentReceiptScope === 'DEFAULT' ? 'MAIN' : this.currentReceiptScope,
      cashierName: Auth.getUser()?.name || 'Admin',
      subtotal: 75,
      discount: 0,
      vat: 0,
      total: 75,
      received: 100,
      change: 25,
      payMethod: 'CASH',
      status: 'PAID'
    };

    const mockItems = [
      { sku: 'P1001', name: 'น้ำดื่มสิงห์ 600 มล.', qty: 2, unitPrice: 10, discount: 0, amount: 20 },
      { sku: 'P1004', name: 'ข้าวผัดกระเพราไก่ไข่ดาว', qty: 1, unitPrice: 55, discount: 0, amount: 55 }
    ];

    const mockStore = {
      receiptTitle: document.getElementById('receiptTextTitleInput')?.value || 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ',
      storeName: document.getElementById('receiptTextStoreNameInput')?.value || 'POS Store',
      name: document.getElementById('receiptTextStoreNameInput')?.value || 'POS Store',
      subHeader: document.getElementById('receiptTextSubHeaderInput')?.value || '',
      address: document.getElementById('receiptTextAddressInput')?.value || '',
      phone: document.getElementById('receiptTextPhoneInput')?.value || '',
      taxId: document.getElementById('receiptTextTaxIdInput')?.value || '',
      footer: document.getElementById('receiptTextFooterInput')?.value || 'ขอบคุณที่ใช้บริการ / Thank you!',
      showAddress: document.getElementById('receiptTextShowAddressCheck')?.checked,
      showPhone: document.getElementById('receiptTextShowPhoneCheck')?.checked,
      showTaxId: document.getElementById('receiptTextShowTaxIdCheck')?.checked,
      showCashier: document.getElementById('receiptTextShowCashierCheck')?.checked,
      showBranch: document.getElementById('receiptTextShowBranchCheck')?.checked
    };

    const prof = {
      profileId: 'PREVIEW',
      printerName: 'XP Thermal Printer',
      paperType: this.previewPaperWidth === 80 ? '80mm' : '58mm',
      widthMm: this.previewPaperWidth || 58,
      marginMm: 2,
      fontSize: this.previewPaperWidth === 80 ? 12 : 11
    };

    PrintManager.previewReceiptModal(mockSale, mockItems, mockStore, prof);
  },

  // --- Printer & Paper Driver Settings ---
  renderPrinterSettings() {
    const prof = PrintManager.activeProfile || this.profiles[0] || PrintManager.getDefaultProfile();

    document.getElementById('printerNameInput').value = prof.printerName || 'XP-58 / Thermal 58mm';
    document.getElementById('printerPaperTypeSelect').value = prof.paperType || '58mm';
    document.getElementById('printerWidthInput').value = prof.widthMm || 58;
    document.getElementById('printerMarginInput').value = prof.marginMm !== undefined ? prof.marginMm : 2;
    document.getElementById('printerFontSizeInput').value = prof.fontSize || 11;
    document.getElementById('printerAutoPrintCheck').checked = prof.autoPrint === true || String(prof.autoPrint) === 'true';
  },

  onPaperTypeChange(val) {
    const widthInput = document.getElementById('printerWidthInput');
    const fontInput = document.getElementById('printerFontSizeInput');
    if (val === '58mm') {
      widthInput.value = 58;
      fontInput.value = 11;
    } else if (val === '80mm') {
      widthInput.value = 80;
      fontInput.value = 13;
    } else if (val === 'A5') {
      widthInput.value = 148;
      fontInput.value = 14;
    } else if (val === 'A4') {
      widthInput.value = 210;
      fontInput.value = 15;
    }
  },

  async savePrinterSettings() {
    const record = {
      profileId: PrintManager.activeProfile ? PrintManager.activeProfile.profileId : 'P_58MM_DEFAULT',
      printerName: document.getElementById('printerNameInput').value.trim(),
      paperType: document.getElementById('printerPaperTypeSelect').value,
      widthMm: parseFloat(document.getElementById('printerWidthInput').value) || 58,
      heightMm: 0, // Continuous
      marginMm: parseFloat(document.getElementById('printerMarginInput').value) || 2,
      fontSize: parseFloat(document.getElementById('printerFontSizeInput').value) || 11,
      copies: 1,
      autoPrint: document.getElementById('printerAutoPrintCheck').checked
    };

    UI.showLoading('กำลังบันทึกการตั้งค่าเครื่องพิมพ์...');
    const res = await Api.call('admin:savePrintProfile', record);
    UI.hideLoading();

    if (res && res.ok && res.profile) {
      PrintManager.activeProfile = res.profile;
      localStorage.setItem(CONFIG.STORAGE_KEYS.PRINTER_PROFILE_ID, res.profile.profileId);
      UI.showToast('บันทึกการตั้งค่าเครื่องพิมพ์สำเร็จ', 'success');
    } else {
      UI.showToast(`บันทึกไม่สำเร็จ: ${res.error || res.message}`, 'error');
    }
  },

  testPrintReceipt() {
    const mockSale = {
      receiptNo: 'RC-TEST-0001',
      ts: new Date().toISOString(),
      branchId: 'B01',
      cashierName: Auth.getUser()?.name || 'Admin',
      subtotal: 100,
      discount: 10,
      vat: 0,
      total: 90,
      received: 100,
      change: 10,
      payMethod: 'CASH',
      status: 'PAID'
    };

    const mockItems = [
      { sku: 'P1001', name: 'น้ำดื่มสิงห์ 600 มล.', qty: 2, unitPrice: 10, discount: 0, amount: 20 },
      { sku: 'P1004', name: 'ข้าวผัดกระเพราไก่ไข่ดาว', qty: 1, unitPrice: 55, discount: 0, amount: 55 },
      { sku: 'P1003', name: 'เลย์ มันฝรั่งแท้ รสคลาสสิค', qty: 1, unitPrice: 25, discount: 0, amount: 25 }
    ];

    const defaultText = (this.receiptTextsList && this.receiptTextsList.find(r => r.scopeId === 'DEFAULT')) || {};
    const mockStore = {
      receiptTitle: defaultText.receiptTitle || 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ',
      storeName: defaultText.storeName || this.configs.STORE_NAME || 'POS & Stock Store',
      name: defaultText.storeName || this.configs.STORE_NAME || 'POS & Stock Store',
      subHeader: defaultText.subHeader || 'ยินดีต้อนรับ / Welcome',
      address: defaultText.address || this.configs.STORE_ADDRESS || 'สำนักงานใหญ่',
      phone: defaultText.phone || this.configs.STORE_PHONE || '02-123-4567',
      taxId: defaultText.taxId || this.configs.STORE_TAX_ID || '0105500000000',
      footer: defaultText.footer || 'ขอบคุณที่ใช้บริการ / Thank you!\nสินค้าซื้อแล้วไม่รับเปลี่ยนคืน',
      showAddress: defaultText.showAddress !== false && String(defaultText.showAddress) !== 'false',
      showPhone: defaultText.showPhone !== false && String(defaultText.showPhone) !== 'false',
      showTaxId: defaultText.showTaxId !== false && String(defaultText.showTaxId) !== 'false',
      showCashier: defaultText.showCashier !== false && String(defaultText.showCashier) !== 'false',
      showBranch: defaultText.showBranch !== false && String(defaultText.showBranch) !== 'false'
    };

    const prof = {
      profileId: 'TEST',
      printerName: document.getElementById('printerNameInput')?.value || 'Printer',
      paperType: document.getElementById('printerPaperTypeSelect')?.value || '58mm',
      widthMm: parseFloat(document.getElementById('printerWidthInput')?.value) || 58,
      marginMm: parseFloat(document.getElementById('printerMarginInput')?.value) || 2,
      fontSize: parseFloat(document.getElementById('printerFontSizeInput')?.value) || 11
    };

    PrintManager.previewReceiptModal(mockSale, mockItems, mockStore, prof);
  },

  // --- Voice & Sound Settings (Face Recognition Style) ---
  populateVoiceSettingsUI() {
    const select = document.getElementById('adminVoiceSelectDropdown');
    const optGroup = document.getElementById('adminDeviceVoicesGroup');
    const rateSlider = document.getElementById('adminVoiceRateSlider');
    const pitchSlider = document.getElementById('adminVoicePitchSlider');
    const particleSelect = document.getElementById('adminVoiceParticleSelect');
    const soundToggle = document.getElementById('adminSoundMasterToggle');

    if (soundToggle) soundToggle.checked = SoundManager.soundEnabled;
    if (rateSlider) rateSlider.value = SoundManager.voiceRate || 1.0;
    if (pitchSlider) pitchSlider.value = SoundManager.voicePitch || 1.0;
    if (particleSelect) particleSelect.value = SoundManager.voiceParticle || 'ค่ะ';

    // Populate Device Voices into optgroup
    if (optGroup) {
      const voices = SoundManager.getAvailableVoices();
      if (voices.length > 0) {
        optGroup.innerHTML = voices.map(v => `
          <option value="device:${v.voiceURI || v.name}">${v.name} (${v.lang})</option>
        `).join('');
      } else {
        optGroup.innerHTML = '<option disabled>กำลังโหลดรายชื่อเสียงในอุปกรณ์...</option>';
      }
    }

    if (select) {
      select.value = SoundManager.voiceSelection || 'preset:female_polite';
    }

    this.syncVoiceLabels();
  },

  syncVoiceLabels() {
    const rateVal = document.getElementById('adminVoiceRateSlider')?.value || 1.0;
    const pitchVal = document.getElementById('adminVoicePitchSlider')?.value || 1.0;

    const rLabel = document.getElementById('adminVoiceRateLabel');
    const pLabel = document.getElementById('adminVoicePitchLabel');
    if (rLabel) rLabel.textContent = `${parseFloat(rateVal).toFixed(2)}x`;
    if (pLabel) pLabel.textContent = `${parseFloat(pitchVal).toFixed(2)}x`;
  },

  handleVoiceChange(val) {
    SoundManager.setVoiceSelection(val, false);
    const rateSlider = document.getElementById('adminVoiceRateSlider');
    const pitchSlider = document.getElementById('adminVoicePitchSlider');
    const particleSelect = document.getElementById('adminVoiceParticleSelect');

    if (rateSlider) rateSlider.value = SoundManager.voiceRate;
    if (pitchSlider) pitchSlider.value = SoundManager.voicePitch;
    if (particleSelect) particleSelect.value = SoundManager.voiceParticle;

    this.syncVoiceLabels();
    SoundManager.speakText(`เปลี่ยนรูปแบบเสียงเป็น ${SoundManager.thaiVoice ? SoundManager.thaiVoice.name : val} ${SoundManager.voiceParticle}`);
  },

  handleSliderChange(type, val) {
    if (type === 'rate') SoundManager.voiceRate = parseFloat(val);
    else if (type === 'pitch') SoundManager.voicePitch = parseFloat(val);
    SoundManager.saveSettings();
    this.syncVoiceLabels();
  },

  handleParticleChange(val) {
    SoundManager.voiceParticle = val;
    SoundManager.saveSettings();
    SoundManager.speakText(`ทดสอบคำลงท้าย ${val}`);
  },

  toggleSoundMaster(checked) {
    SoundManager.toggleSound(checked);
    UI.showToast(checked ? 'เปิดเสียงระบบแล้ว' : 'ปิดเสียงระบบแล้ว', 'info');
  },

  testVoicePhrase(type) {
    if (type === 'total') {
      SoundManager.announceTotal(1250.50);
    } else if (type === 'received') {
      SoundManager.announceReceived(1500);
    } else if (type === 'change') {
      SoundManager.announceChange(249.50);
    } else if (type === 'void') {
      SoundManager.announceVoid('RC-TEST-001');
    }
  },

  // --- System Constants & Configs Management ---
  async loadConstantsUI() {
    UI.showLoading('กำลังโหลดค่าคงที่ระบบ...');
    const [cMapRes, cTableRes] = await Promise.all([
      Api.call('admin:configs'),
      Api.call('admin:configsTable')
    ]);
    UI.hideLoading();

    if (cMapRes && cMapRes.ok) this.configs = cMapRes.configs || {};
    if (cTableRes && cTableRes.ok) this.configsTable = cTableRes.configs || [];

    this.renderCoreConstants();
    this.renderConfigsTable();
  },

  renderCoreConstants() {
    const vat = document.getElementById('constVatRateInput');
    const hours = document.getElementById('constSessionHoursInput');
    const pay = document.getElementById('constDefaultPayMethodSelect');
    const curr = document.getElementById('constCurrencySymbolInput');
    const negCheck = document.getElementById('constAllowNegativeCheck');
    const negLabel = document.getElementById('constAllowNegativeLabel');

    if (vat) vat.value = this.configs.VAT_RATE !== undefined ? this.configs.VAT_RATE : 0;
    if (hours) hours.value = this.configs.SESSION_EXPIRE_HOURS || 12;
    if (pay) pay.value = this.configs.DEFAULT_PAY_METHOD || 'CASH';
    if (curr) curr.value = this.configs.CURRENCY_SYMBOL || '฿';

    const isNeg = this.configs.ALLOW_NEGATIVE_STOCK === 'true' || this.configs.ALLOW_NEGATIVE_STOCK === true;
    if (negCheck) negCheck.checked = isNeg;
    if (negLabel) negLabel.textContent = isNeg ? 'เปิดใช้งาน' : 'ปิด';
  },

  async saveCoreConstants() {
    const vatVal = parseFloat(document.getElementById('constVatRateInput')?.value) || 0;
    const hoursVal = parseInt(document.getElementById('constSessionHoursInput')?.value, 10) || 12;
    const payVal = document.getElementById('constDefaultPayMethodSelect')?.value || 'CASH';
    const currVal = document.getElementById('constCurrencySymbolInput')?.value.trim() || '฿';
    const negVal = document.getElementById('constAllowNegativeCheck')?.checked ? 'true' : 'false';

    const payload = {
      VAT_RATE: String(vatVal),
      SESSION_EXPIRE_HOURS: String(hoursVal),
      DEFAULT_PAY_METHOD: payVal,
      CURRENCY_SYMBOL: currVal,
      ALLOW_NEGATIVE_STOCK: negVal
    };

    UI.showLoading('กำลังบันทึกการตั้งค่าระบบหลัก...');
    const res = await Api.call('admin:saveConfigs', payload);
    UI.hideLoading();

    if (res && res.ok) {
      Object.assign(this.configs, payload);
      UI.showToast('บันทึกการตั้งค่าระบบหลักสำเร็จ', 'success');
      SoundManager.playSuccessChime();
      await this.loadConstantsUI();
    } else {
      UI.showToast(`บันทึกไม่สำเร็จ: ${res.error || res.message}`, 'error');
      SoundManager.playErrorTone();
    }
  },

  renderConfigsTable(list = null) {
    const tbody = document.getElementById('adminConfigsTableBody');
    if (!tbody) return;

    const data = list || this.configsTable || [];
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-slate-400">ไม่พบรายการค่าคงที่</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(c => `
      <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
        <td class="py-2.5 px-3 font-mono font-bold text-slate-900">${escapeHtml(c.key)}</td>
        <td class="py-2.5 px-3 font-mono font-bold text-blue-700 truncate max-w-xs" title="${escapeHtml(c.value)}">${escapeHtml(c.value)}</td>
        <td class="py-2.5 px-3 text-slate-600">${escapeHtml(c.description || '-')}</td>
        <td class="py-2.5 px-3 text-slate-400 text-[11px] whitespace-nowrap">${c.updatedAt ? new Date(c.updatedAt).toLocaleString('th-TH') : '-'}</td>
        <td class="py-2.5 px-3 text-right whitespace-nowrap">
          <button onclick="AdminModule.openConfigModal('${c.key}')" class="px-2.5 py-1 text-xs font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition">แก้ไข</button>
          ${!c.isSystem ? `<button onclick="AdminModule.deleteConfigItem('${c.key}')" class="px-2.5 py-1 text-xs font-bold text-red-600 hover:bg-red-50 rounded-lg ml-1 transition">ลบ</button>` : ''}
        </td>
      </tr>
    `).join('');
  },

  filterConfigsTable(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) {
      this.renderConfigsTable();
      return;
    }
    const filtered = (this.configsTable || []).filter(c =>
      String(c.key).toLowerCase().includes(q) ||
      String(c.value).toLowerCase().includes(q) ||
      String(c.description || '').toLowerCase().includes(q)
    );
    this.renderConfigsTable(filtered);
  },

  openConfigModal(key = '') {
    const isEdit = !!key;
    document.getElementById('configModalTitle').textContent = isEdit ? 'แก้ไขค่าคงที่' : 'เพิ่มค่าคงที่ใหม่';
    const keyInput = document.getElementById('configModalKey');
    const valInput = document.getElementById('configModalValue');
    const descInput = document.getElementById('configModalDesc');

    if (isEdit) {
      const item = (this.configsTable || []).find(c => c.key === key);
      keyInput.value = key;
      keyInput.disabled = true;
      valInput.value = item ? item.value : (this.configs[key] || '');
      descInput.value = item ? (item.description || '') : '';
    } else {
      keyInput.value = '';
      keyInput.disabled = false;
      valInput.value = '';
      descInput.value = '';
    }

    UI.openModal('configEditModal');
  },

  async saveConfigModal() {
    const key = document.getElementById('configModalKey').value.trim().toUpperCase();
    const value = document.getElementById('configModalValue').value;
    const description = document.getElementById('configModalDesc').value.trim();

    if (!key) {
      UI.showToast('กรุณาระบุคีย์ค่าคงที่ (Key)', 'warning');
      return;
    }

    UI.showLoading('กำลังบันทึกค่าคงที่...');
    const res = await Api.call('admin:saveConfigItem', { key, value, description });
    UI.hideLoading();

    if (res && res.ok) {
      UI.closeModal('configEditModal');
      UI.showToast(res.message || 'บันทึกสำเร็จ', 'success');
      SoundManager.playSuccessChime();
      this.configs[key] = value;
      await this.loadConstantsUI();
    } else {
      UI.showToast(`บันทึกไม่สำเร็จ: ${res.error || res.message}`, 'error');
      SoundManager.playErrorTone();
    }
  },

  async deleteConfigItem(key) {
    const ok = confirm(`ต้องการลบคีย์ค่าคงที่ [${key}] ใช่หรือไม่?`);
    if (!ok) return;

    UI.showLoading('กำลังลบคีย์ค่าคงที่...');
    const res = await Api.call('admin:deleteConfigItem', { key });
    UI.hideLoading();

    if (res && res.ok) {
      UI.showToast(res.message || 'ลบสำเร็จ', 'success');
      delete this.configs[key];
      await this.loadConstantsUI();
    } else {
      UI.showToast(`ไม่สามารถลบได้: ${res.error || res.message}`, 'error');
    }
  },

  // --- Product Categories Management ---
  async loadCategoriesUI() {
    UI.showLoading('กำลังโหลดหมวดหมู่สินค้า...');
    const [catRes, prodRes] = await Promise.all([
      Api.call('admin:categories'),
      Api.call('products:list')
    ]);
    UI.hideLoading();

    if (catRes && catRes.ok) this.categories = catRes.categories || [];
    if (prodRes && prodRes.ok) this.products = prodRes.products || [];

    this.renderCategoriesTable();
  },

  renderCategoriesTable(list = null) {
    const tbody = document.getElementById('adminCategoriesTableBody');
    if (!tbody) return;

    const data = list || this.categories || [];
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-slate-400">ไม่พบหมวดหมู่สินค้า</td></tr>';
      return;
    }

    // Count products per category
    const countMap = {};
    (this.products || []).forEach(p => {
      countMap[p.categoryId] = (countMap[p.categoryId] || 0) + 1;
    });

    tbody.innerHTML = data.map(c => {
      const prodCount = countMap[c.categoryId] || 0;
      const color = c.color || '#3498DB';
      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
          <td class="py-2.5 px-3 text-center">
            <span class="inline-block w-4 h-4 rounded-full border border-black/10 shadow-xs" style="background-color: ${escapeHtml(color)};"></span>
          </td>
          <td class="py-2.5 px-3 font-mono font-bold text-slate-900">${escapeHtml(c.categoryId)}</td>
          <td class="py-2.5 px-3 font-bold text-slate-800">
            <span class="px-2.5 py-1 rounded-full text-xs font-bold" style="background-color: ${escapeHtml(color)}1a; color: ${escapeHtml(color)};">
              ${escapeHtml(c.name)}
            </span>
          </td>
          <td class="py-2.5 px-3 text-center font-bold text-slate-700">${parseInt(c.sortOrder, 10) || 1}</td>
          <td class="py-2.5 px-3 text-center">
            <span class="px-2 py-0.5 rounded-full text-xs font-bold ${prodCount > 0 ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-500'}">
              ${prodCount} รายการ
            </span>
          </td>
          <td class="py-2.5 px-3 text-right whitespace-nowrap">
            <button onclick="AdminModule.openCategoryModal('${c.categoryId}')" class="px-2.5 py-1 text-xs font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition">แก้ไข</button>
            <button onclick="AdminModule.deleteCategory('${c.categoryId}')" class="px-2.5 py-1 text-xs font-bold text-red-600 hover:bg-red-50 rounded-lg ml-1 transition">ลบ</button>
          </td>
        </tr>
      `;
    }).join('');
  },

  filterCategoriesTable(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) {
      this.renderCategoriesTable();
      return;
    }
    const filtered = (this.categories || []).filter(c =>
      String(c.categoryId).toLowerCase().includes(q) ||
      String(c.name).toLowerCase().includes(q)
    );
    this.renderCategoriesTable(filtered);
  },

  openCategoryModal(catId = '') {
    const isEdit = !!catId;
    document.getElementById('categoryModalTitle').textContent = isEdit ? 'แก้ไขหมวดหมู่สินค้า' : 'เพิ่มหมวดสินค้าใหม่';
    const idInput = document.getElementById('categoryModalId');
    const nameInput = document.getElementById('categoryModalName');
    const colorInput = document.getElementById('categoryModalColor');
    const hexInput = document.getElementById('categoryModalColorHex');
    const sortInput = document.getElementById('categoryModalSortOrder');

    if (isEdit) {
      const c = (this.categories || []).find(x => x.categoryId === catId);
      idInput.value = catId;
      idInput.disabled = true;
      nameInput.value = c ? c.name : '';
      const clr = c ? (c.color || '#3498DB') : '#3498DB';
      colorInput.value = clr;
      hexInput.value = clr;
      sortInput.value = c ? (c.sortOrder || 1) : 1;
    } else {
      idInput.value = '';
      idInput.disabled = false;
      nameInput.value = '';
      colorInput.value = '#3498DB';
      hexInput.value = '#3498DB';
      sortInput.value = (this.categories || []).length + 1;
    }

    UI.openModal('categoryEditModal');
  },

  setCategoryModalColor(hex) {
    document.getElementById('categoryModalColor').value = hex;
    document.getElementById('categoryModalColorHex').value = hex;
  },

  async saveCategoryModal() {
    const categoryId = document.getElementById('categoryModalId').value.trim();
    const name = document.getElementById('categoryModalName').value.trim();
    const color = document.getElementById('categoryModalColor').value;
    const sortOrder = parseInt(document.getElementById('categoryModalSortOrder').value, 10) || 1;

    if (!name) {
      UI.showToast('กรุณาระบุชื่อหมวดหมู่สินค้า', 'warning');
      return;
    }

    UI.showLoading('กำลังบันทึกหมวดสินค้า...');
    const res = await Api.call('admin:saveCategory', { categoryId, name, color, sortOrder });
    UI.hideLoading();

    if (res && res.ok) {
      UI.closeModal('categoryEditModal');
      UI.showToast('บันทึกหมวดหมู่สินค้าสำเร็จ', 'success');
      SoundManager.playSuccessChime();

      await this.loadCategoriesUI();
      this.syncCategoriesToModules();
    } else {
      UI.showToast(`บันทึกไม่สำเร็จ: ${res.error || res.message}`, 'error');
      SoundManager.playErrorTone();
    }
  },

  async deleteCategory(catId) {
    const c = (this.categories || []).find(x => x.categoryId === catId);
    const catName = c ? c.name : catId;

    const ok = confirm(`ต้องการลบหมวดหมู่ "${catName}" ใช่หรือไม่?`);
    if (!ok) return;

    UI.showLoading('กำลังลบหมวดสินค้า...');
    const res = await Api.call('admin:deleteCategory', { categoryId: catId });
    UI.hideLoading();

    if (res && res.ok) {
      UI.showToast('ลบหมวดหมู่สินค้าสำเร็จ', 'success');
      await this.loadCategoriesUI();
      this.syncCategoriesToModules();
    } else {
      UI.showToast(`ไม่สามารถลบได้: ${res.error || res.message}`, 'error');
    }
  },

  syncCategoriesToModules() {
    if (window.SalesModule) {
      SalesModule.categories = this.categories;
      SalesModule.populateCategoryFilter();
    }
    if (window.StockModule) {
      StockModule.categories = this.categories;
      StockModule.populateCategoryFilter();
    }
  },

  // --- Units of Measure Management ---
  async loadUnitsUI() {
    UI.showLoading('กำลังโหลดหน่วยนับสินค้า...');
    const [unitRes, prodRes] = await Promise.all([
      Api.call('admin:units'),
      Api.call('products:list')
    ]);
    UI.hideLoading();

    if (unitRes && unitRes.ok) this.units = unitRes.units || [];
    if (prodRes && prodRes.ok) this.products = prodRes.products || [];

    this.renderUnitsTable();
  },

  renderUnitsTable(list = null) {
    const tbody = document.getElementById('adminUnitsTableBody');
    if (!tbody) return;

    const data = list || this.units || [];
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-slate-400">ไม่พบหน่วยนับสินค้า</td></tr>';
      return;
    }

    // Count products per unit name
    const countMap = {};
    (this.products || []).forEach(p => {
      countMap[p.unit] = (countMap[p.unit] || 0) + 1;
    });

    tbody.innerHTML = data.map(u => {
      const prodCount = countMap[u.name] || 0;
      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
          <td class="py-2.5 px-3 font-mono font-bold text-slate-900">${escapeHtml(u.unitId)}</td>
          <td class="py-2.5 px-3 font-bold text-slate-800">${escapeHtml(u.name)}</td>
          <td class="py-2.5 px-3 text-center">
            <span class="px-2 py-0.5 rounded-full text-xs font-bold ${prodCount > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}">
              ${prodCount} รายการ
            </span>
          </td>
          <td class="py-2.5 px-3 text-right whitespace-nowrap">
            <button onclick="AdminModule.openUnitModal('${u.unitId}')" class="px-2.5 py-1 text-xs font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition">แก้ไข</button>
            <button onclick="AdminModule.deleteUnit('${u.unitId}')" class="px-2.5 py-1 text-xs font-bold text-red-600 hover:bg-red-50 rounded-lg ml-1 transition">ลบ</button>
          </td>
        </tr>
      `;
    }).join('');
  },

  filterUnitsTable(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) {
      this.renderUnitsTable();
      return;
    }
    const filtered = (this.units || []).filter(u =>
      String(u.unitId).toLowerCase().includes(q) ||
      String(u.name).toLowerCase().includes(q)
    );
    this.renderUnitsTable(filtered);
  },

  openUnitModal(unitId = '') {
    const isEdit = !!unitId;
    document.getElementById('unitModalTitle').textContent = isEdit ? 'แก้ไขหน่วยนับสินค้า' : 'เพิ่มหน่วยนับใหม่';
    const idInput = document.getElementById('unitModalId');
    const nameInput = document.getElementById('unitModalName');

    if (isEdit) {
      const u = (this.units || []).find(x => x.unitId === unitId);
      idInput.value = unitId;
      idInput.disabled = true;
      nameInput.value = u ? u.name : '';
    } else {
      idInput.value = '';
      idInput.disabled = false;
      nameInput.value = '';
    }

    UI.openModal('unitEditModal');
  },

  async saveUnitModal() {
    const unitId = document.getElementById('unitModalId').value.trim();
    const name = document.getElementById('unitModalName').value.trim();

    if (!name) {
      UI.showToast('กรุณาระบุชื่อหน่วยนับ', 'warning');
      return;
    }

    UI.showLoading('กำลังบันทึกหน่วยนับ...');
    const res = await Api.call('admin:saveUnit', { unitId, name });
    UI.hideLoading();

    if (res && res.ok) {
      UI.closeModal('unitEditModal');
      UI.showToast('บันทึกหน่วยนับสำเร็จ', 'success');
      SoundManager.playSuccessChime();

      await this.loadUnitsUI();
      this.syncUnitsToModules();
    } else {
      UI.showToast(`บันทึกไม่สำเร็จ: ${res.error || res.message}`, 'error');
      SoundManager.playErrorTone();
    }
  },

  async deleteUnit(unitId) {
    const u = (this.units || []).find(x => x.unitId === unitId);
    const unitName = u ? u.name : unitId;

    const ok = confirm(`ต้องการลบหน่วยนับ "${unitName}" ใช่หรือไม่?`);
    if (!ok) return;

    UI.showLoading('กำลังลบหน่วยนับ...');
    const res = await Api.call('admin:deleteUnit', { unitId });
    UI.hideLoading();

    if (res && res.ok) {
      UI.showToast('ลบหน่วยนับสำเร็จ', 'success');
      await this.loadUnitsUI();
      this.syncUnitsToModules();
    } else {
      UI.showToast(`ไม่สามารถลบได้: ${res.error || res.message}`, 'error');
    }
  },

  syncUnitsToModules() {
    if (window.StockModule) {
      StockModule.units = this.units;
    }
  },

  // --- Audit Logs ---
  async loadAuditLogs() {
    const tbody = document.getElementById('adminAuditTableBody');
    if (!tbody) return;

    UI.showLoading('กำลังโหลด Audit Logs...');
    const res = await Api.call('admin:auditLogs', { limit: 100 });
    UI.hideLoading();

    if (res && res.ok && res.logs) {
      if (res.logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-slate-400">ยังไม่มีบันทึก Audit Logs</td></tr>`;
        return;
      }

      tbody.innerHTML = res.logs.map(log => `
        <tr class="border-b border-slate-100 text-xs hover:bg-slate-50">
          <td class="py-2.5 px-3 font-mono text-slate-500">${new Date(log.ts).toLocaleString('th-TH')}</td>
          <td class="py-2.5 px-3 font-mono font-bold">${log.userId}</td>
          <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded-full font-bold bg-slate-200 text-slate-800">${log.action}</span></td>
          <td class="py-2.5 px-3 font-bold text-slate-700">${log.target}</td>
          <td class="py-2.5 px-3 font-mono text-slate-600 truncate max-w-xs" title="${log.detail}">${log.detail}</td>
        </tr>
      `).join('');
    }
  },

  // --- Web App API Setting ---
  renderApiSettings() {
    const input = document.getElementById('adminApiUrlInput');
    if (input) input.value = CONFIG.API_URL || '';
  },

  async testAndSaveApiUrl() {
    const input = document.getElementById('adminApiUrlInput');
    const url = (input ? input.value : '').trim();

    if (!url) {
      UI.showToast('กรุณาระบุ URL ของ Google Apps Script Web App', 'warning');
      return;
    }

    UI.showLoading('กำลังทดสอบการเชื่อมต่อ Apps Script API...');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'ping' })
      });
      const data = await res.json();
      UI.hideLoading();

      if (data && data.pong) {
        Api.setApiUrl(url);
        UI.showToast('เชื่อมต่อ API สำเร็จสมบูรณ์!', 'success');
        SoundManager.playSuccessChime();
      } else {
        UI.showToast('เชื่อมต่อสำเร็จแต่รูปแบบข้อมูลไม่ถูกต้อง กรุณาตรวจสอบโค้ด Apps Script', 'warning');
      }
    } catch (err) {
      UI.hideLoading();
      UI.showToast(`ไม่สามารถเชื่อมต่อ API ได้: ${err.message}`, 'error');
      SoundManager.playErrorTone();
    }
  }
};
