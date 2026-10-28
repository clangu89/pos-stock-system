/**
 * sales.js - Multi-bill POS Checkout, Barcode Scanning, Audio Announcements, and Receipt Printing
 */

const SalesModule = {
  products: [],
  categories: [],
  bills: [],
  activeBillIndex: 0,
  selectedCategory: 'ALL',
  searchQuery: '',
  activeBranchId: 'B01',

  async activate() {
    this.activeBranchId = localStorage.getItem(CONFIG.STORAGE_KEYS.BRANCH_ID) || CONFIG.DEFAULT_BRANCH_ID;
    this.loadDraftBills();
    await this.refreshData();
    this.setupEventListeners();
    this.render();
    this.focusBarcodeInput();
  },

  async refreshData() {
    UI.showLoading('กำลังโหลดข้อมูลสินค้าและสต๊อก...');
    const res = await Api.call('pos:init', { branchId: this.activeBranchId });
    UI.hideLoading();

    if (res && res.ok) {
      this.products = res.products || [];
      this.categories = res.categories || [];
      if (res.printProfiles) {
        PrintManager.init(res.printProfiles);
      }
      this.populateCategoryFilter();
      this.renderProductGrid();
      this.renderBillTabs();
      this.renderCart();
    }
  },

  loadDraftBills() {
    try {
      const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.BILLS);
      if (saved) {
        this.bills = JSON.parse(saved);
      }
    } catch (e) {
      this.bills = [];
    }

    if (!this.bills || this.bills.length === 0) {
      this.bills = [this.createNewBillObject(1)];
      this.activeBillIndex = 0;
    }
  },

  saveDraftBills() {
    try {
      localStorage.setItem(CONFIG.STORAGE_KEYS.BILLS, JSON.stringify(this.bills));
    } catch (e) {}
  },

  createNewBillObject(billNum) {
    return {
      id: 'bill_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      title: `บิลที่ ${billNum || this.bills.length + 1}`,
      items: [],
      discount: 0,
      note: '',
      clientTxnId: 'TXN_' + UtilitiesRandom()
    };

    function UtilitiesRandom() {
      return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    }
  },

  getActiveBill() {
    if (!this.bills[this.activeBillIndex]) {
      this.activeBillIndex = 0;
    }
    return this.bills[this.activeBillIndex];
  },

  addNewBill() {
    const nextNum = this.bills.length + 1;
    this.bills.push(this.createNewBillObject(nextNum));
    this.activeBillIndex = this.bills.length - 1;
    this.saveDraftBills();
    this.renderBillTabs();
    this.renderCart();
    SoundManager.playScannerBeep();
    this.focusBarcodeInput();
  },

  switchBill(index) {
    if (this.bills[index]) {
      this.activeBillIndex = index;
      this.renderBillTabs();
      this.renderCart();
      this.focusBarcodeInput();
    }
  },

  closeBill(index, e) {
    if (e) e.stopPropagation();
    if (this.bills.length <= 1) {
      // Just clear current bill items
      this.bills[0].items = [];
      this.bills[0].discount = 0;
      this.saveDraftBills();
      this.renderBillTabs();
      this.renderCart();
      return;
    }

    this.bills.splice(index, 1);
    if (this.activeBillIndex >= this.bills.length) {
      this.activeBillIndex = this.bills.length - 1;
    }
    this.saveDraftBills();
    this.renderBillTabs();
    this.renderCart();
  },

  focusBarcodeInput() {
    const input = document.getElementById('posBarcodeSearchInput');
    if (input) {
      setTimeout(() => input.focus(), 50);
    }
  },

  setupEventListeners() {
    const searchInput = document.getElementById('posBarcodeSearchInput');
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.dataset.bound = 'true';
      searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const query = searchInput.value.trim();
          if (query) {
            this.handleBarcodeScanOrSearch(query);
            searchInput.value = '';
          }
        }
      });
      searchInput.addEventListener('input', e => {
        this.searchQuery = e.target.value.toLowerCase();
        this.renderProductGrid();
      });
    }

    // Keyboard Shortcuts (F2: New Bill, F4: Payment, F8: Hold/Switch)
    window.addEventListener('keydown', e => {
      if (Router.currentView !== 'sales') return;
      if (e.key === 'F2') {
        e.preventDefault();
        this.addNewBill();
      } else if (e.key === 'F4') {
        e.preventDefault();
        this.openPaymentModal();
      }
    });
  },

  handleBarcodeScanOrSearch(code) {
    const clean = code.trim().toLowerCase();
    // 1. Exact Barcode Match
    let matched = this.products.find(p => String(p.barcode || '').toLowerCase() === clean);
    // 2. Exact SKU Match
    if (!matched) {
      matched = this.products.find(p => String(p.sku || '').toLowerCase() === clean);
    }

    if (matched) {
      this.addItemToCart(matched);
      SoundManager.playScannerBeep();
    } else {
      SoundManager.playErrorTone();
      UI.showToast(`ไม่พบสินค้าที่มีบาร์โค้ดหรือรหัส: ${code}`, 'warning');
    }
  },

  addItemToCart(product) {
    const bill = this.getActiveBill();
    const existing = bill.items.find(i => i.sku === product.sku);

    const currentQtyInCart = existing ? existing.qty : 0;
    const requestedQty = currentQtyInCart + 1;

    // Check stock limit if negative stock not allowed
    if (product.stockQty !== undefined && requestedQty > product.stockQty) {
      SoundManager.announceOutOfStock(product.name);
      UI.showToast(`สินค้า "${product.name}" มีสต๊อกคงเหลือ ${product.stockQty} ชิ้น (ไม่พอขาย)`, 'warning');
      return;
    }

    if (existing) {
      existing.qty += 1;
      existing.amount = Math.max(0, (existing.qty * existing.unitPrice) - existing.discount);
    } else {
      bill.items.push({
        sku: product.sku,
        barcode: product.barcode,
        name: product.name,
        qty: 1,
        unitPrice: parseFloat(product.salePrice) || 0,
        unitCost: parseFloat(product.costPrice) || 0,
        discount: 0,
        amount: parseFloat(product.salePrice) || 0
      });
    }

    this.saveDraftBills();
    this.renderBillTabs();
    this.renderCart();
  },

  updateItemQty(sku, delta) {
    const bill = this.getActiveBill();
    const item = bill.items.find(i => i.sku === sku);
    if (!item) return;

    const prod = this.products.find(p => p.sku === sku);
    const newQty = item.qty + delta;

    if (newQty <= 0) {
      this.removeItemFromCart(sku);
      return;
    }

    if (prod && prod.stockQty !== undefined && newQty > prod.stockQty) {
      SoundManager.announceOutOfStock(prod.name);
      UI.showToast(`สต๊อกคงเหลือไม่พอ (คงเหลือ ${prod.stockQty})`, 'warning');
      return;
    }

    item.qty = newQty;
    item.amount = Math.max(0, (item.qty * item.unitPrice) - item.discount);
    this.saveDraftBills();
    this.renderBillTabs();
    this.renderCart();
  },

  removeItemFromCart(sku) {
    const bill = this.getActiveBill();
    bill.items = bill.items.filter(i => i.sku !== sku);
    this.saveDraftBills();
    this.renderBillTabs();
    this.renderCart();
  },

  setBillDiscount(amount) {
    const bill = this.getActiveBill();
    bill.discount = Math.max(0, parseFloat(amount) || 0);
    this.saveDraftBills();
    this.renderCart();
  },

  clearCurrentCart() {
    const bill = this.getActiveBill();
    bill.items = [];
    bill.discount = 0;
    this.saveDraftBills();
    this.renderBillTabs();
    this.renderCart();
    UI.showToast('ล้างรายการสินค้าในบิลเรียบร้อยแล้ว', 'info');
  },

  populateCategoryFilter() {
    const container = document.getElementById('posCategoryChips');
    if (!container) return;

    let html = `
      <button onclick="SalesModule.selectCategory('ALL')"
              class="px-3.5 py-1.5 rounded-full text-xs font-bold transition whitespace-nowrap ${this.selectedCategory === 'ALL' ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'}">
        ทั้งหมด
      </button>
    `;

    this.categories.forEach(cat => {
      const isAct = this.selectedCategory === cat.categoryId;
      html += `
        <button onclick="SalesModule.selectCategory('${cat.categoryId}')"
                class="px-3.5 py-1.5 rounded-full text-xs font-bold transition whitespace-nowrap ${isAct ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'}">
          ${cat.name}
        </button>
      `;
    });

    container.innerHTML = html;
  },

  selectCategory(catId) {
    this.selectedCategory = catId;
    this.populateCategoryFilter();
    this.renderProductGrid();
  },

  renderProductGrid() {
    const grid = document.getElementById('posProductGrid');
    if (!grid) return;

    let filtered = this.products;

    if (this.selectedCategory !== 'ALL') {
      filtered = filtered.filter(p => p.categoryId === this.selectedCategory);
    }

    if (this.searchQuery) {
      filtered = filtered.filter(p =>
        (p.name && p.name.toLowerCase().includes(this.searchQuery)) ||
        (p.sku && p.sku.toLowerCase().includes(this.searchQuery)) ||
        (p.barcode && p.barcode.toLowerCase().includes(this.searchQuery))
      );
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="col-span-full py-16 text-center text-slate-400">
          <div class="text-4xl mb-2">🔍</div>
          <div>ไม่พบสินค้าที่ตรงกับการค้นหา</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(p => {
      const stock = p.stockQty !== undefined ? p.stockQty : 0;
      const isLow = stock <= (p.minStock || 0);
      const isOut = stock <= 0;

      return `
        <div onclick="SalesModule.addItemToCart(${JSON.stringify(p).replace(/"/g, '&quot;')})"
             class="group bg-white rounded-2xl p-3.5 border border-slate-200 hover:border-blue-500 shadow-sm hover:shadow-lg transition-all duration-200 cursor-pointer flex flex-col justify-between select-none relative overflow-hidden ${isOut ? 'opacity-60' : ''}">
          <div>
            <div class="flex items-start justify-between gap-1 mb-1.5">
              <span class="text-xs font-mono font-bold text-slate-400">${p.sku}</span>
              <span class="text-[11px] px-2 py-0.5 rounded-full font-bold ${isOut ? 'bg-rose-100 text-rose-700' : isLow ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">
                คงเหลือ: ${stock}
              </span>
            </div>
            <h4 class="font-bold text-sm text-slate-800 group-hover:text-blue-600 transition-colors line-clamp-2 mb-2 leading-snug">
              ${p.name}
            </h4>
          </div>
          <div class="flex items-baseline justify-between pt-2 border-t border-slate-100">
            <span class="text-xs text-slate-400">${p.unit || 'ชิ้น'}</span>
            <span class="text-base font-extrabold text-blue-700">฿${(parseFloat(p.salePrice) || 0).toFixed(2)}</span>
          </div>
        </div>
      `;
    }).join('');
  },

  renderBillTabs() {
    const tabsContainer = document.getElementById('posBillTabsContainer');
    if (!tabsContainer) return;

    tabsContainer.innerHTML = this.bills.map((b, idx) => {
      const isAct = idx === this.activeBillIndex;
      const itemsCount = b.items.reduce((sum, it) => sum + it.qty, 0);
      const total = b.items.reduce((sum, it) => sum + it.amount, 0) - (b.discount || 0);

      return `
        <div onclick="SalesModule.switchBill(${idx})"
             class="group relative flex items-center gap-2 px-3.5 py-2 rounded-t-2xl font-bold text-xs cursor-pointer transition select-none ${isAct ? 'bg-white text-blue-600 shadow-sm border-t-2 border-blue-600' : 'bg-slate-200/80 text-slate-600 hover:bg-slate-200'}">
          <span>${b.title}</span>
          ${itemsCount > 0 ? `<span class="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-extrabold">${itemsCount} | ฿${Math.max(0, total).toFixed(0)}</span>` : ''}
          <button onclick="SalesModule.closeBill(${idx}, event)"
                  title="ปิดบิลนี้"
                  class="ml-1 w-4 h-4 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-300 hover:text-slate-800 transition">
            ✕
          </button>
        </div>
      `;
    }).join('') + `
      <button onclick="SalesModule.addNewBill()"
              title="เปิดบิลใหม่ (F2)"
              class="px-3 py-2 rounded-t-2xl bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-600 font-bold text-xs flex items-center gap-1 transition">
        <span>+</span> <span>บิลใหม่ (F2)</span>
      </button>
    `;
  },

  renderCart() {
    const bill = this.getActiveBill();
    const cartList = document.getElementById('posCartItemsList');
    if (!cartList) return;

    if (bill.items.length === 0) {
      cartList.innerHTML = `
        <div class="h-full flex flex-col items-center justify-center text-slate-400 p-6 text-center">
          <div class="text-5xl mb-3">🛒</div>
          <div class="font-bold text-slate-600 mb-1">ยังไม่มีสินค้าในบิลนี้</div>
          <div class="text-xs">สแกนบาร์โค้ด หรือคลิกเลือกสินค้าจากรายการทางซ้าย</div>
        </div>
      `;
      this.updateCartSummary(0, 0, 0);
      return;
    }

    cartList.innerHTML = bill.items.map(it => `
      <div class="flex items-center justify-between p-3 bg-slate-50 hover:bg-blue-50/50 rounded-2xl border border-slate-200/70 transition">
        <div class="flex-1 pr-2">
          <div class="font-bold text-sm text-slate-900 line-clamp-1">${it.name}</div>
          <div class="text-xs text-slate-400 font-mono">฿${it.unitPrice.toFixed(2)} / ชิ้น</div>
        </div>
        <div class="flex items-center gap-1.5">
          <button onclick="SalesModule.updateItemQty('${it.sku}', -1)"
                  class="w-7 h-7 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold text-sm flex items-center justify-center hover:bg-slate-100 transition shadow-sm">
            -
          </button>
          <span class="w-8 text-center font-extrabold text-sm text-slate-800 font-mono">${it.qty}</span>
          <button onclick="SalesModule.updateItemQty('${it.sku}', 1)"
                  class="w-7 h-7 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold text-sm flex items-center justify-center hover:bg-slate-100 transition shadow-sm">
            +
          </button>
        </div>
        <div class="w-20 text-right font-extrabold text-sm text-slate-900 font-mono">
          ฿${it.amount.toFixed(2)}
        </div>
        <button onclick="SalesModule.removeItemFromCart('${it.sku}')"
                class="ml-2 text-slate-400 hover:text-rose-600 transition p-1">
          🗑️
        </button>
      </div>
    `).join('');

    const subtotal = bill.items.reduce((s, it) => s + it.amount, 0);
    const discount = bill.discount || 0;
    const total = Math.max(0, subtotal - discount);

    this.updateCartSummary(subtotal, discount, total);
  },

  updateCartSummary(subtotal, discount, total) {
    const subtotalEl = document.getElementById('posSummarySubtotal');
    const discountEl = document.getElementById('posSummaryDiscount');
    const totalEl = document.getElementById('posSummaryTotal');
    const payBtn = document.getElementById('posPayButton');

    if (subtotalEl) subtotalEl.textContent = `฿${subtotal.toFixed(2)}`;
    if (discountEl) discountEl.textContent = discount > 0 ? `-฿${discount.toFixed(2)}` : '฿0.00';
    if (totalEl) totalEl.textContent = `฿${total.toFixed(2)}`;

    if (payBtn) {
      payBtn.disabled = total <= 0 && this.getActiveBill().items.length === 0;
      payBtn.innerHTML = `<span>ชำระเงิน (F4)</span> <span class="font-mono text-xl">฿${total.toFixed(2)}</span>`;
    }
  },

  openPaymentModal() {
    const bill = this.getActiveBill();
    if (bill.items.length === 0) {
      UI.showToast('ไม่มีรายการสินค้าในบิล ไม่สามารถชำระเงินได้', 'warning');
      return;
    }

    const subtotal = bill.items.reduce((s, it) => s + it.amount, 0);
    const discount = bill.discount || 0;
    const grandTotal = Math.max(0, subtotal - discount);

    document.getElementById('payModalGrandTotal').textContent = `฿${grandTotal.toFixed(2)}`;
    document.getElementById('payReceivedInput').value = grandTotal;
    this.calculateChange();

    // Voice announcement for bill total
    SoundManager.announceTotal(grandTotal);

    UI.openModal('paymentModal');
    setTimeout(() => {
      const input = document.getElementById('payReceivedInput');
      if (input) {
        input.focus();
        input.select();
      }
    }, 150);
  },

  setQuickCash(amount) {
    const bill = this.getActiveBill();
    const grandTotal = Math.max(0, bill.items.reduce((s, it) => s + it.amount, 0) - (bill.discount || 0));

    if (amount === 'EXACT') {
      document.getElementById('payReceivedInput').value = grandTotal;
    } else {
      document.getElementById('payReceivedInput').value = amount;
    }
    this.calculateChange();
  },

  calculateChange() {
    const bill = this.getActiveBill();
    const grandTotal = Math.max(0, bill.items.reduce((s, it) => s + it.amount, 0) - (bill.discount || 0));
    const received = parseFloat(document.getElementById('payReceivedInput').value) || 0;
    const change = Math.max(0, received - grandTotal);

    const changeEl = document.getElementById('payModalChange');
    if (changeEl) {
      changeEl.textContent = `฿${change.toFixed(2)}`;
    }

    const confirmBtn = document.getElementById('payModalConfirmBtn');
    if (confirmBtn) {
      confirmBtn.disabled = received < grandTotal;
    }

    return { grandTotal, received, change };
  },

  async confirmPayment() {
    const bill = this.getActiveBill();
    const calc = this.calculateChange();
    if (calc.received < calc.grandTotal) {
      UI.showToast('ยอดเงินที่รับมาน้อยกว่ายอดที่ต้องชำระ', 'warning');
      SoundManager.playErrorTone();
      return;
    }

    const payMethod = document.querySelector('input[name="payMethodOption"]:checked')?.value || 'CASH';

    UI.closeModal('paymentModal');
    UI.showLoading('กำลังบันทึกรายการขายและตัดสต๊อก...');

    const payload = {
      branchId: this.activeBranchId,
      stationId: localStorage.getItem(CONFIG.STORAGE_KEYS.STATION_ID) || CONFIG.DEFAULT_STATION_ID,
      items: bill.items,
      discount: bill.discount || 0,
      received: calc.received,
      payMethod: payMethod,
      clientTxnId: bill.clientTxnId
    };

    const res = await Api.call('sales:checkout', payload);
    UI.hideLoading();

    if (res && res.ok && res.sale) {
      // 1. Voice Announcement
      SoundManager.playSuccessChime();
      setTimeout(() => {
        SoundManager.announceChange(calc.change);
      }, 400);

      // 2. Clear completed bill or reset
      this.closeBill(this.activeBillIndex);

      UI.showToast(`ชำระเงินสำเร็จ! ใบเสร็จเลขที่: ${res.receiptNo}`, 'success');

      // 3. Auto Print Receipt (or preview)
      const prof = PrintManager.activeProfile;
      if (prof && (prof.autoPrint === true || String(prof.autoPrint) === 'true')) {
        PrintManager.printReceiptDirect(res.sale, res.items, res.store, prof);
      } else {
        PrintManager.previewReceiptModal(res.sale, res.items, res.store, prof);
      }

      // 4. Background refresh stock balances
      this.refreshProductsStockSilent();
    } else {
      SoundManager.playErrorTone();
      UI.showToast(`ชำระเงินไม่สำเร็จ: ${res.error || res.message}`, 'error');
    }
  },

  async refreshProductsStockSilent() {
    const res = await Api.call('products:list', { branchId: this.activeBranchId });
    if (res && res.ok && res.products) {
      this.products = res.products;
      this.renderProductGrid();
    }
  },

  // --- Void Receipt Operations ---
  openVoidModal() {
    document.getElementById('voidSearchReceiptNo').value = '';
    document.getElementById('voidReasonInput').value = '';
    document.getElementById('voidReceiptDetailContainer').innerHTML = `
      <div class="text-center py-8 text-slate-400">กรุณากรอกเลขที่ใบเสร็จแล้วกดค้นหา</div>
    `;
    document.getElementById('voidConfirmBtn').disabled = true;
    UI.openModal('voidReceiptModal');
  },

  async searchReceiptForVoid() {
    const receiptNo = document.getElementById('voidSearchReceiptNo').value.trim();
    if (!receiptNo) {
      UI.showToast('กรุณากรอกเลขที่ใบเสร็จ', 'warning');
      return;
    }

    UI.showLoading('กำลังค้นหาใบเสร็จ...');
    const res = await Api.call('sales:receipt', { receiptNo });
    UI.hideLoading();

    const container = document.getElementById('voidReceiptDetailContainer');
    const confirmBtn = document.getElementById('voidConfirmBtn');

    if (res && res.ok && res.receipt) {
      const sale = res.receipt.sale;
      const items = res.receipt.items;

      if (sale.status === 'VOID') {
        container.innerHTML = `
          <div class="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-center">
            <b class="text-lg">ใบเสร็จนี้ถูกยกเลิกแล้ว</b>
            <div class="text-xs mt-1">ผู้ยกเลิก: ${sale.voidBy} เมื่อ ${new Date(sale.voidAt).toLocaleString('th-TH')}</div>
            <div class="text-xs">เหตุผล: ${sale.voidReason}</div>
          </div>
        `;
        confirmBtn.disabled = true;
        return;
      }

      container.innerHTML = `
        <div class="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm space-y-2">
          <div class="flex justify-between font-bold">
            <span>เลขที่: ${sale.receiptNo}</span>
            <span class="text-blue-600">ยอดรวม: ฿${parseFloat(sale.total).toFixed(2)}</span>
          </div>
          <div class="text-xs text-slate-500">วันที่: ${new Date(sale.ts).toLocaleString('th-TH')} | แคชเชียร์: ${sale.cashierName || sale.userId}</div>
          <div class="border-t border-slate-200 pt-2 space-y-1">
            ${items.map(it => `
              <div class="flex justify-between text-xs">
                <span>${it.name} (x${it.qty})</span>
                <span>฿${parseFloat(it.amount).toFixed(2)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
      confirmBtn.disabled = false;
    } else {
      container.innerHTML = `<div class="text-center py-6 text-rose-500">ไม่พบข้อมูลใบเสร็จ ${receiptNo}</div>`;
      confirmBtn.disabled = true;
    }
  },

  async confirmVoidReceipt() {
    const receiptNo = document.getElementById('voidSearchReceiptNo').value.trim();
    const reason = document.getElementById('voidReasonInput').value.trim();

    if (!receiptNo || !reason) {
      UI.showToast('กรุณาระบุเหตุผลในการยกเลิกใบเสร็จ', 'warning');
      return;
    }

    const ok = await UI.confirmDialog('ยืนยันยกเลิกใบเสร็จ', `คุณต้องการยกเลิกใบเสร็จเลขที่ ${receiptNo} ใช่หรือไม่? รายการสินค้าจะถูกคืนสต๊อกโดยอัตโนมัติ`);
    if (!ok) return;

    UI.showLoading('กำลังยกเลิกใบเสร็จและคืนสต๊อก...');
    const res = await Api.call('sales:void', { receiptNo, reason });
    UI.hideLoading();

    if (res && res.ok) {
      UI.closeModal('voidReceiptModal');
      SoundManager.announceVoid(receiptNo);
      UI.showToast(res.message || 'ยกเลิกใบเสร็จสำเร็จ', 'success');
      this.refreshProductsStockSilent();
    } else {
      SoundManager.playErrorTone();
      UI.showToast(`ยกเลิกไม่สำเร็จ: ${res.error || res.message}`, 'error');
    }
  }
};
