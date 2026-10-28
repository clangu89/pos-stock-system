/**
 * admin.js - User Accounts, Roles Matrix, Receipt Patterns, Printer Drivers, Voice Settings & Audit
 */

const AdminModule = {
  currentTab: 'users',
  users: [],
  roles: [],
  branches: [],
  configs: {},
  profiles: [],

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
    else if (tabName === 'printer') this.renderPrinterSettings();
    else if (tabName === 'voice') this.populateVoiceSettingsUI();
    else if (tabName === 'audit') this.loadAuditLogs();
    else if (tabName === 'api') this.renderApiSettings();
  },

  async loadAdminData() {
    UI.showLoading('กำลังโหลดข้อมูลระบบผู้ดูแล...');
    const [uRes, rRes, bRes, cRes, pRes] = await Promise.all([
      Api.call('admin:users'),
      Api.call('admin:roles'),
      Api.call('admin:branches'),
      Api.call('admin:configs'),
      Api.call('admin:printProfiles')
    ]);
    UI.hideLoading();

    if (uRes && uRes.ok) this.users = uRes.users || [];
    if (rRes && rRes.ok) this.roles = rRes.roles || [];
    if (bRes && bRes.ok) this.branches = bRes.branches || [];
    if (cRes && cRes.ok) this.configs = cRes.configs || {};
    if (pRes && pRes.ok) this.profiles = pRes.profiles || [];

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

  // --- Printer & Paper Driver Settings ---
  renderPrinterSettings() {
    const prof = PrintManager.activeProfile || this.profiles[0] || PrintManager.getDefaultProfile();

    document.getElementById('printerNameInput').value = prof.printerName || 'XP-58 / Thermal 58mm';
    document.getElementById('printerPaperTypeSelect').value = prof.paperType || '58mm';
    document.getElementById('printerWidthInput').value = prof.widthMm || 58;
    document.getElementById('printerMarginInput').value = prof.marginMm !== undefined ? prof.marginMm : 2;
    document.getElementById('printerFontSizeInput').value = prof.fontSize || 11;
    document.getElementById('printerAutoPrintCheck').checked = prof.autoPrint === true || String(prof.autoPrint) === 'true';
    document.getElementById('printerFooterInput').value = prof.footer || 'ขอบคุณที่ใช้บริการ / Thank you!';
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
      autoPrint: document.getElementById('printerAutoPrintCheck').checked,
      footer: document.getElementById('printerFooterInput').value.trim()
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

    const mockStore = {
      name: this.configs.STORE_NAME || 'POS & Stock Store',
      address: this.configs.STORE_ADDRESS || 'สำนักงานใหญ่',
      phone: this.configs.STORE_PHONE || '02-123-4567',
      taxId: this.configs.STORE_TAX_ID || '0105500000000',
      footer: document.getElementById('printerFooterInput')?.value || 'ขอบคุณที่ใช้บริการ / Thank you!'
    };

    const prof = {
      profileId: 'TEST',
      printerName: document.getElementById('printerNameInput')?.value || 'Printer',
      paperType: document.getElementById('printerPaperTypeSelect')?.value || '58mm',
      widthMm: parseFloat(document.getElementById('printerWidthInput')?.value) || 58,
      marginMm: parseFloat(document.getElementById('printerMarginInput')?.value) || 2,
      fontSize: parseFloat(document.getElementById('printerFontSizeInput')?.value) || 11,
      footer: mockStore.footer
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
