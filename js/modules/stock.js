/**
 * stock.js - Inventory Management, Catalog CRUD, Receive, Adjust, Transfer, and Stock Card
 */

const StockModule = {
  currentTab: 'products',
  products: [],
  categories: [],
  units: [],
  branches: [],
  activeBranchId: 'B01',

  async activate() {
    this.activeBranchId = localStorage.getItem(CONFIG.STORAGE_KEYS.BRANCH_ID) || CONFIG.DEFAULT_BRANCH_ID;
    this.setupTabNavigation();
    await this.loadInitialData();
  },

  setupTabNavigation() {
    const tabs = document.querySelectorAll('.stock-tab-btn');
    tabs.forEach(btn => {
      btn.onclick = () => {
        const tab = btn.dataset.tab;
        this.switchTab(tab);
      };
    });
  },

  switchTab(tabName) {
    this.currentTab = tabName;
    document.querySelectorAll('.stock-tab-btn').forEach(b => {
      const isAct = b.dataset.tab === tabName;
      b.className = `stock-tab-btn px-4 py-2.5 rounded-xl font-bold text-xs transition cursor-pointer ${isAct ? 'bg-emerald-600 text-white shadow-md' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'}`;
    });

    document.querySelectorAll('.stock-tab-content').forEach(c => {
      c.classList.add('hidden');
    });

    const target = document.getElementById(`stockTab_${tabName}`);
    if (target) target.classList.remove('hidden');

    if (tabName === 'products') this.renderProductsTable();
    else if (tabName === 'receive') this.initReceiveTab();
    else if (tabName === 'adjust') this.initAdjustTab();
    else if (tabName === 'transfer') this.initTransferTab();
    else if (tabName === 'card') this.initStockCardTab();
  },

  async loadInitialData() {
    UI.showLoading('กำลังโหลดข้อมูลสต๊อกสินค้า...');
    const res = await Api.call('pos:init', { branchId: this.activeBranchId });
    UI.hideLoading();

    if (res && res.ok) {
      this.products = res.products || [];
      this.categories = res.categories || [];
      this.units = res.units || [];
      this.branches = res.branches || [];

      this.populateBranchDropdowns();
      this.populateCategoryFilter();
      this.renderProductsTable();
    }
  },

  populateBranchDropdowns() {
    const selects = ['stockBranchFilter', 'receiveBranchSelect', 'adjustBranchSelect', 'transferFromBranch', 'transferToBranch', 'cardBranchSelect'];
    selects.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = this.branches.map(b => `
        <option value="${b.branchId}" ${b.branchId === this.activeBranchId ? 'selected' : ''}>${b.name} (${b.code})</option>
      `).join('');
    });
  },

  populateCategoryFilter() {
    const select = document.getElementById('stockCategoryFilter');
    if (!select) return;
    select.innerHTML = '<option value="ALL">ทุกหมวดหมู่</option>' + this.categories.map(c => `
      <option value="${c.categoryId}">${c.name}</option>
    `).join('');
  },

  renderProductsTable() {
    const tbody = document.getElementById('stockProductsTableBody');
    if (!tbody) return;

    const catFilter = document.getElementById('stockCategoryFilter')?.value || 'ALL';
    const search = (document.getElementById('stockSearchInput')?.value || '').toLowerCase().trim();
    const lowStockOnly = document.getElementById('stockLowStockOnlyCheck')?.checked || false;

    let list = this.products;

    if (catFilter !== 'ALL') {
      list = list.filter(p => p.categoryId === catFilter);
    }
    if (search) {
      list = list.filter(p =>
        (p.name && p.name.toLowerCase().includes(search)) ||
        (p.sku && p.sku.toLowerCase().includes(search)) ||
        (p.barcode && p.barcode.toLowerCase().includes(search))
      );
    }
    if (lowStockOnly) {
      list = list.filter(p => (p.stockQty || 0) <= (p.minStock || 0));
    }

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400">ไม่พบรายการสินค้า</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((p, idx) => {
      const stock = p.stockQty !== undefined ? p.stockQty : 0;
      const min = p.minStock || 0;
      const isLow = stock <= min;

      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50 text-sm">
          <td class="py-3 px-3 font-mono font-bold text-slate-600">${p.sku}</td>
          <td class="py-3 px-3 font-mono text-xs text-slate-400">${p.barcode || '-'}</td>
          <td class="py-3 px-3 font-bold text-slate-900">${p.name}</td>
          <td class="py-3 px-3 text-slate-600 text-xs">${p.unit || 'ชิ้น'}</td>
          <td class="py-3 px-3 text-right font-mono text-slate-600">฿${(parseFloat(p.costPrice) || 0).toFixed(2)}</td>
          <td class="py-3 px-3 text-right font-mono font-bold text-blue-600">฿${(parseFloat(p.salePrice) || 0).toFixed(2)}</td>
          <td class="py-3 px-3 text-center">
            <span class="px-2.5 py-1 rounded-full font-extrabold text-xs ${isLow ? 'bg-rose-100 text-rose-700 animate-pulse' : 'bg-emerald-100 text-emerald-800'}">
              ${stock}
            </span>
          </td>
          <td class="py-3 px-3 text-right">
            <button onclick="StockModule.openProductModal('${p.sku}')" class="px-2 py-1 text-xs font-bold text-blue-600 hover:bg-blue-50 rounded-lg">แก้ไข</button>
            <button onclick="StockModule.deleteProduct('${p.sku}')" class="px-2 py-1 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-lg ml-1">ลบ</button>
          </td>
        </tr>
      `;
    }).join('');
  },

  // --- Product Modal CRUD ---
  openProductModal(sku = '') {
    const isEdit = !!sku;
    document.getElementById('productModalTitle').textContent = isEdit ? 'แก้ไขข้อมูลสินค้า' : 'เพิ่มสินค้าใหม่';

    // Populate Category & Unit Select in Modal
    const catSelect = document.getElementById('prodModalCategory');
    if (catSelect) {
      catSelect.innerHTML = this.categories.map(c => `<option value="${c.categoryId}">${c.name}</option>`).join('');
    }

    const unitSelect = document.getElementById('prodModalUnit');
    if (unitSelect) {
      unitSelect.innerHTML = this.units.map(u => `<option value="${u.name}">${u.name}</option>`).join('');
    }

    if (isEdit) {
      const p = this.products.find(x => x.sku === sku);
      if (!p) return;
      document.getElementById('prodModalSku').value = p.sku;
      document.getElementById('prodModalSku').disabled = true;
      document.getElementById('prodModalBarcode').value = p.barcode || '';
      document.getElementById('prodModalName').value = p.name || '';
      document.getElementById('prodModalCategory').value = p.categoryId || '';
      document.getElementById('prodModalUnit').value = p.unit || 'ชิ้น';
      document.getElementById('prodModalCost').value = p.costPrice || 0;
      document.getElementById('prodModalPrice').value = p.salePrice || 0;
      document.getElementById('prodModalMin').value = p.minStock || 0;
    } else {
      document.getElementById('prodModalSku').value = 'P' + (1000 + this.products.length + 1);
      document.getElementById('prodModalSku').disabled = false;
      document.getElementById('prodModalBarcode').value = '';
      document.getElementById('prodModalName').value = '';
      document.getElementById('prodModalCost').value = '0';
      document.getElementById('prodModalPrice').value = '0';
      document.getElementById('prodModalMin').value = '10';
    }

    UI.openModal('productEditModal');
  },

  async saveProductModal() {
    const sku = document.getElementById('prodModalSku').value.trim();
    const name = document.getElementById('prodModalName').value.trim();
    if (!sku || !name) {
      UI.showToast('กรุณากรอกรหัสสินค้าและชื่อสินค้า', 'warning');
      return;
    }

    const payload = {
      sku: sku,
      barcode: document.getElementById('prodModalBarcode').value.trim(),
      name: name,
      categoryId: document.getElementById('prodModalCategory').value,
      unit: document.getElementById('prodModalUnit').value,
      costPrice: parseFloat(document.getElementById('prodModalCost').value) || 0,
      salePrice: parseFloat(document.getElementById('prodModalPrice').value) || 0,
      minStock: parseFloat(document.getElementById('prodModalMin').value) || 0,
      active: true
    };

    UI.showLoading('กำลังบันทึกสินค้า...');
    const res = await Api.call('products:save', payload);
    UI.hideLoading();

    if (res && res.ok) {
      UI.closeModal('productEditModal');
      UI.showToast('บันทึกสินค้าเรียบร้อยแล้ว', 'success');
      await this.loadInitialData();
    } else {
      UI.showToast(`บันทึกไม่สำเร็จ: ${res.error || res.message}`, 'error');
    }
  },

  async deleteProduct(sku) {
    const ok = await UI.confirmDialog('ยืนยันลบสินค้า', `คุณต้องการลบสินค้า SKU ${sku} ใช่หรือไม่?`);
    if (!ok) return;

    UI.showLoading('กำลังลบสินค้า...');
    const res = await Api.call('products:delete', { sku });
    UI.hideLoading();

    if (res && res.ok) {
      UI.showToast('ลบสินค้าสำเร็จ', 'success');
      await this.loadInitialData();
    } else {
      UI.showToast(`ลบไม่สำเร็จ: ${res.error || res.message}`, 'error');
    }
  },

  // --- Receive Stock ---
  receiveItems: [],
  initReceiveTab() {
    this.receiveItems = [];
    this.renderReceiveItemsTable();
  },

  addReceiveItemRow() {
    if (this.products.length === 0) return;
    const p = this.products[0];
    this.receiveItems.push({
      sku: p.sku,
      qty: 10,
      costPrice: p.costPrice || 0
    });
    this.renderReceiveItemsTable();
  },

  renderReceiveItemsTable() {
    const tbody = document.getElementById('receiveItemsTableBody');
    if (!tbody) return;

    if (this.receiveItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-slate-400">ยังไม่มีรายการ กดปุ่ม "+ เพิ่มรายการรับเข้า" ด้านบน</td></tr>`;
      return;
    }

    tbody.innerHTML = this.receiveItems.map((it, idx) => `
      <tr class="border-b border-slate-100">
        <td class="py-2 px-3">
          <select onchange="StockModule.updateReceiveItem(${idx}, 'sku', this.value)" class="w-full text-xs p-1.5 rounded-lg border border-slate-200">
            ${this.products.map(p => `
              <option value="${p.sku}" ${p.sku === it.sku ? 'selected' : ''}>${p.sku} - ${p.name}</option>
            `).join('')}
          </select>
        </td>
        <td class="py-2 px-3">
          <input type="number" step="1" min="1" value="${it.qty}" onchange="StockModule.updateReceiveItem(${idx}, 'qty', this.value)" class="w-24 text-right text-xs p-1.5 rounded-lg border border-slate-200">
        </td>
        <td class="py-2 px-3">
          <input type="number" step="0.5" min="0" value="${it.costPrice}" onchange="StockModule.updateReceiveItem(${idx}, 'costPrice', this.value)" class="w-24 text-right text-xs p-1.5 rounded-lg border border-slate-200">
        </td>
        <td class="py-2 px-3 text-right font-mono font-bold text-xs">
          ฿${((it.qty || 0) * (it.costPrice || 0)).toFixed(2)}
        </td>
        <td class="py-2 px-3 text-center">
          <button onclick="StockModule.removeReceiveItem(${idx})" class="text-rose-500 font-bold hover:bg-rose-50 px-2 py-1 rounded">✕</button>
        </td>
      </tr>
    `).join('');
  },

  updateReceiveItem(idx, key, value) {
    if (!this.receiveItems[idx]) return;
    if (key === 'qty') this.receiveItems[idx].qty = parseFloat(value) || 0;
    else if (key === 'costPrice') this.receiveItems[idx].costPrice = parseFloat(value) || 0;
    else if (key === 'sku') {
      this.receiveItems[idx].sku = value;
      const p = this.products.find(x => x.sku === value);
      if (p) this.receiveItems[idx].costPrice = p.costPrice || 0;
    }
    this.renderReceiveItemsTable();
  },

  removeReceiveItem(idx) {
    this.receiveItems.splice(idx, 1);
    this.renderReceiveItemsTable();
  },

  async submitReceiveStock() {
    if (this.receiveItems.length === 0) {
      UI.showToast('ไม่มีรายการสินค้าที่รับเข้า', 'warning');
      return;
    }

    const branchId = document.getElementById('receiveBranchSelect').value;
    const note = document.getElementById('receiveNoteInput').value;

    UI.showLoading('กำลังบันทึกการรับสินค้าเข้าสต๊อก...');
    const res = await Api.call('stock:receive', {
      branchId,
      items: this.receiveItems,
      note
    });
    UI.hideLoading();

    if (res && res.ok) {
      UI.showToast(`รับสินค้าเข้าสต๊อกสำเร็จ! เลขที่ใบรับ: ${res.docNo}`, 'success');
      this.initReceiveTab();
      await this.loadInitialData();
    } else {
      UI.showToast(`บันทึกไม่สำเร็จ: ${res.error || res.message}`, 'error');
    }
  },

  // --- Adjust Stock ---
  initAdjustTab() {
    const tbody = document.getElementById('adjustItemsTableBody');
    if (!tbody) return;

    tbody.innerHTML = this.products.map((p, idx) => `
      <tr class="border-b border-slate-100 text-sm">
        <td class="py-2.5 px-3 font-mono font-bold">${p.sku}</td>
        <td class="py-2.5 px-3 font-bold">${p.name}</td>
        <td class="py-2.5 px-3 text-center font-bold text-slate-700">${p.stockQty || 0}</td>
        <td class="py-2.5 px-3 text-center">
          <input type="number" id="adj_actual_${p.sku}" data-sku="${p.sku}" data-curr="${p.stockQty || 0}"
                 value="${p.stockQty || 0}" onchange="StockModule.calcAdjustDiff('${p.sku}')"
                 class="w-24 text-center p-1.5 rounded-lg border border-slate-200 font-bold">
        </td>
        <td class="py-2.5 px-3 text-center font-mono font-extrabold text-xs" id="adj_diff_${p.sku}">
          0
        </td>
        <td class="py-2.5 px-3">
          <input type="text" id="adj_note_${p.sku}" placeholder="ระบุเหตุผล (ถ้ามี)" class="w-full text-xs p-1.5 rounded-lg border border-slate-200">
        </td>
      </tr>
    `).join('');
  },

  calcAdjustDiff(sku) {
    const actualInput = document.getElementById(`adj_actual_${sku}`);
    const diffEl = document.getElementById(`adj_diff_${sku}`);
    if (!actualInput || !diffEl) return;

    const actual = parseFloat(actualInput.value) || 0;
    const curr = parseFloat(actualInput.dataset.curr) || 0;
    const diff = actual - curr;

    if (diff > 0) {
      diffEl.textContent = `+${diff}`;
      diffEl.className = 'py-2.5 px-3 text-center font-mono font-extrabold text-xs text-emerald-600';
    } else if (diff < 0) {
      diffEl.textContent = `${diff}`;
      diffEl.className = 'py-2.5 px-3 text-center font-mono font-extrabold text-xs text-rose-600';
    } else {
      diffEl.textContent = '0';
      diffEl.className = 'py-2.5 px-3 text-center font-mono font-extrabold text-xs text-slate-400';
    }
  },

  async submitAdjustStock() {
    const branchId = document.getElementById('adjustBranchSelect').value;
    const note = document.getElementById('adjustGeneralNote').value;

    const items = [];
    this.products.forEach(p => {
      const actualInput = document.getElementById(`adj_actual_${p.sku}`);
      const noteInput = document.getElementById(`adj_note_${p.sku}`);
      if (actualInput) {
        const actual = parseFloat(actualInput.value);
        const curr = parseFloat(actualInput.dataset.curr) || 0;
        if (!isNaN(actual) && actual !== curr) {
          items.push({
            sku: p.sku,
            actualQty: actual,
            note: noteInput ? noteInput.value : ''
          });
        }
      }
    });

    if (items.length === 0) {
      UI.showToast('ไม่มีรายการที่มีผลต่างการตรวจนับ', 'info');
      return;
    }

    const ok = await UI.confirmDialog('ยืนยันปรับยอดสต๊อก', `พบสินค้าที่มีผลต่างจำนวน ${items.length} รายการ ต้องการปรับปรุงยอดใช่หรือไม่?`);
    if (!ok) return;

    UI.showLoading('กำลังบันทึกการปรับปรุงยอดสต๊อก...');
    const res = await Api.call('stock:adjust', { branchId, items, note });
    UI.hideLoading();

    if (res && res.ok) {
      UI.showToast(`ปรับปรุงยอดสำเร็จ ${res.adjustedCount} รายการ! เลขที่: ${res.docNo}`, 'success');
      await this.loadInitialData();
      this.initAdjustTab();
    } else {
      UI.showToast(`ปรับปรุงยอดไม่สำเร็จ: ${res.error || res.message}`, 'error');
    }
  },

  // --- Transfer Stock ---
  transferItems: [],
  initTransferTab() {
    this.transferItems = [];
    this.renderTransferItemsTable();
  },

  addTransferRow() {
    if (this.products.length === 0) return;
    this.transferItems.push({
      sku: this.products[0].sku,
      qty: 5
    });
    this.renderTransferItemsTable();
  },

  renderTransferItemsTable() {
    const tbody = document.getElementById('transferItemsTableBody');
    if (!tbody) return;

    if (this.transferItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center py-6 text-slate-400">ยังไม่มีรายการโอนย้าย กด "+ เพิ่มรายการโอน"</td></tr>`;
      return;
    }

    tbody.innerHTML = this.transferItems.map((it, idx) => `
      <tr class="border-b border-slate-100">
        <td class="py-2 px-3">
          <select onchange="StockModule.transferItems[${idx}].sku = this.value; StockModule.renderTransferItemsTable();" class="w-full text-xs p-1.5 rounded-lg border border-slate-200">
            ${this.products.map(p => `
              <option value="${p.sku}" ${p.sku === it.sku ? 'selected' : ''}>${p.sku} - ${p.name} (คงเหลือ: ${p.stockQty})</option>
            `).join('')}
          </select>
        </td>
        <td class="py-2 px-3">
          <input type="number" min="1" value="${it.qty}" onchange="StockModule.transferItems[${idx}].qty = parseFloat(this.value)||0;" class="w-24 text-right text-xs p-1.5 rounded-lg border border-slate-200">
        </td>
        <td class="py-2 px-3 text-center">
          <button onclick="StockModule.transferItems.splice(${idx}, 1); StockModule.renderTransferItemsTable();" class="text-rose-500 font-bold hover:bg-rose-50 px-2 py-1 rounded">✕</button>
        </td>
      </tr>
    `).join('');
  },

  async submitTransferStock() {
    const fromBranchId = document.getElementById('transferFromBranch').value;
    const toBranchId = document.getElementById('transferToBranch').value;
    const note = document.getElementById('transferNoteInput').value;

    if (fromBranchId === toBranchId) {
      UI.showToast('สาขาต้นทางและปลายทางต้องไม่เป็นสาขาเดียวกัน', 'warning');
      return;
    }

    if (this.transferItems.length === 0) {
      UI.showToast('ไม่มีรายการสินค้าที่ต้องการโอนย้าย', 'warning');
      return;
    }

    UI.showLoading('กำลังบันทึกการโอนย้ายสินค้าระหว่างสาขา...');
    const res = await Api.call('stock:transfer', {
      fromBranchId,
      toBranchId,
      items: this.transferItems,
      note
    });
    UI.hideLoading();

    if (res && res.ok) {
      UI.showToast(`โอนย้ายสินค้าสำเร็จ! เลขที่เอกสาร: ${res.docNo}`, 'success');
      this.initTransferTab();
      await this.loadInitialData();
    } else {
      UI.showToast(`โอนย้ายไม่สำเร็จ: ${res.error || res.message}`, 'error');
    }
  },

  // --- Stock Card Ledger ---
  initStockCardTab() {
    const select = document.getElementById('cardProductSelect');
    if (select) {
      select.innerHTML = '<option value="">-- เลือกสินค้า --</option>' + this.products.map(p => `
        <option value="${p.sku}">${p.sku} - ${p.name}</option>
      `).join('');
    }
  },

  async loadStockCard() {
    const sku = document.getElementById('cardProductSelect').value;
    const branchId = document.getElementById('cardBranchSelect').value;
    const tbody = document.getElementById('stockCardTableBody');
    if (!tbody) return;

    if (!sku) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-slate-400">กรุณาเลือกสินค้า</td></tr>`;
      return;
    }

    UI.showLoading('กำลังโหลด Stock Card...');
    const res = await Api.call('stock:card', { sku, branchId, limit: 100 });
    UI.hideLoading();

    if (res && res.ok && res.movements) {
      if (res.movements.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-slate-400">ไม่พบประวัติการเคลื่อนไหว</td></tr>`;
        return;
      }

      tbody.innerHTML = res.movements.map(m => `
        <tr class="border-b border-slate-100 text-xs">
          <td class="py-2 px-3 text-slate-500">${new Date(m.ts).toLocaleString('th-TH')}</td>
          <td class="py-2 px-3 font-bold">${m.type}</td>
          <td class="py-2 px-3 font-mono">${m.refDoc || '-'}</td>
          <td class="py-2 px-3 text-right font-bold text-emerald-600">${parseFloat(m.qtyIn) > 0 ? `+${m.qtyIn}` : '-'}</td>
          <td class="py-2 px-3 text-right font-bold text-rose-600">${parseFloat(m.qtyOut) > 0 ? `-${m.qtyOut}` : '-'}</td>
          <td class="py-2 px-3 text-right font-extrabold text-slate-900">${m.balanceAfter}</td>
          <td class="py-2 px-3 text-slate-500">${m.note || '-'} (${m.userId})</td>
        </tr>
      `).join('');
    }
  }
};
