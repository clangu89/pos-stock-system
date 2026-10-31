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
  stationId: 'POS-01',
  dayDrawerStatus: null,
  activeDrawerPreview: null,
  todayVoidReceipts: [],
  activeVoidFilter: 'ALL',
  selectedVoidReceiptNo: null,
  receiptStoreInfo: null,
  isSubmittingPayment: false,
  currentSuggestions: [],
  activeSuggestionIndex: -1,
  isDropdownOpen: false,

  async activate() {
    this.activeBranchId = localStorage.getItem(CONFIG.STORAGE_KEYS.BRANCH_ID) || CONFIG.DEFAULT_BRANCH_ID;
    this.stationId = localStorage.getItem(CONFIG.STORAGE_KEYS.STATION_ID) || CONFIG.DEFAULT_STATION_ID;
    const stLabel = document.getElementById('posStationLabel');
    if (stLabel) stLabel.textContent = this.stationId;
    this.loadDraftBills();
    // ล้างค่าช่องค้นหาเพื่อป้องกัน Browser Password Autofill แอบใส่ username
    const searchInput = document.getElementById('posBarcodeSearchInput');
    if (searchInput) {
      searchInput.value = '';
    }
    this.searchQuery = '';
    await this.refreshData();
    this.setupEventListeners();
    this.render();
    this.focusBarcodeInput();
  },

  async refreshData() {
    UI.showLoading('กำลังโหลดข้อมูลสินค้าและสต๊อก...');
    const res = await Api.call('pos:init', { branchId: this.activeBranchId, stationId: this.stationId });
    UI.hideLoading();

    if (res && res.ok) {
      this.products = res.products || [];
      this.categories = res.categories || [];
      if (res.receiptTexts) {
        this.receiptStoreInfo = res.receiptTexts;
      }
      if (res.printProfiles) {
        PrintManager.init(res.printProfiles);
      }
      if (res.dayDrawerStatus) {
        this.updateDayDrawerStatusUI(res.dayDrawerStatus);
      }
      this.populateCategoryFilter();
      this.renderProductGrid();
      this.renderBillTabs();
      this.renderCart();
    }
  },

  generateClientTxnId() {
    return 'TXN_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
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

    if (!Array.isArray(this.bills) || this.bills.length === 0) {
      this.bills = [this.createNewBillObject(1)];
      this.activeBillIndex = 0;
      this.saveDraftBills();
      return;
    }

    // ล้าง clientTxnId ค้างจากเวอร์ชันเก่า (ไม่มี txnSchema: 2) หรือบิลว่าง เพื่อให้ทุกบิลมีรหัสธุรกรรมใหม่เสมอ
    let migrated = false;
    this.bills.forEach((b, idx) => {
      if (!b || typeof b !== 'object') {
        this.bills[idx] = this.createNewBillObject(idx + 1);
        migrated = true;
        return;
      }
      if (!Array.isArray(b.items)) b.items = [];
      if (b.txnSchema !== 2 || !b.clientTxnId || b.items.length === 0) {
        b.clientTxnId = this.generateClientTxnId();
        b.txnSchema = 2;
        migrated = true;
      }
    });
    if (migrated) {
      this.saveDraftBills();
    }
  },

  saveDraftBills() {
    try {
      localStorage.setItem(CONFIG.STORAGE_KEYS.BILLS, JSON.stringify(this.bills));
    } catch (e) {}
  },

  createNewBillObject(billNum) {
    return {
      id: 'bill_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      title: `บิลที่ ${billNum || this.bills.length + 1}`,
      items: [],
      discount: 0,
      note: '',
      clientTxnId: this.generateClientTxnId(),
      txnSchema: 2
    };
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
      // สร้างบิลที่ 1 ใหม่ทั้งก้อนเพื่อให้ได้ id และ clientTxnId ใหม่เสมอ (ป้องกันการส่ง clientTxnId บิลเก่าซ้ำ)
      this.bills = [this.createNewBillObject(1)];
      this.activeBillIndex = 0;
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
      if (!this.searchQuery) {
        input.value = '';
      }
      setTimeout(() => {
        input.focus();
        if (!this.searchQuery && input.value) {
          input.value = '';
        }
      }, 50);
    }
  },

  render() {
    this.populateCategoryFilter();
    this.renderProductGrid();
    this.renderBillTabs();
    this.renderCart();
  },

  setupEventListeners() {
    const searchInput = document.getElementById('posBarcodeSearchInput');
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.dataset.bound = 'true';

      searchInput.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.navigateSuggestions(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.navigateSuggestions(-1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const query = searchInput.value.trim();
          if (query) {
            this.handleBarcodeScanOrSearch(query);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.closeSuggestionsDropdown();
        }
      });

      searchInput.addEventListener('input', e => {
        this.updateRealtimeSearch(e.target.value);
      });

      searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim() && this.currentSuggestions.length > 0) {
          this.renderSuggestionsDropdown();
        }
      });
    }

    // Document click to close suggestions dropdown when clicking outside
    if (!window._posSearchOutsideBound) {
      window._posSearchOutsideBound = true;
      document.addEventListener('click', e => {
        const container = document.getElementById('posSearchContainer');
        if (container && !container.contains(e.target)) {
          SalesModule.closeSuggestionsDropdown();
        }
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

  stripThaiDiacritics(str) {
    if (!str) return '';
    return String(str)
      .replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '')
      .toLowerCase()
      .trim();
  },

  isSubsequence(q, text) {
    if (!q || !text) return false;
    let qi = 0;
    for (let i = 0; i < text.length && qi < q.length; i++) {
      if (text[i] === q[qi]) qi++;
    }
    return qi === q.length;
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  calculateSearchScore(product, rawQuery) {
    if (!product || !rawQuery) return 0;
    const query = String(rawQuery).trim().toLowerCase();
    if (!query) return 0;

    const cleanQuery = this.stripThaiDiacritics(query);
    const name = String(product.name || '').toLowerCase();
    const cleanName = this.stripThaiDiacritics(product.name || '');
    const barcode = String(product.barcode || '').toLowerCase();
    const sku = String(product.sku || '').toLowerCase();
    const category = String(product.categoryName || product.categoryId || '').toLowerCase();

    // 1. Exact Barcode Match (Priority 1)
    if (barcode && barcode === query) return 1000;

    // 2. Exact SKU Match
    if (sku && sku === query) return 950;

    // 3. Exact Name Match
    if (name === query) return 900;

    // 4. Barcode starts with query
    if (barcode && barcode.startsWith(query)) return 850;

    // 5. SKU starts with query
    if (sku && sku.startsWith(query)) return 800;

    // 6. Name starts with query
    if (name.startsWith(query)) return 750;

    // 7. Barcode ends with query (typing last 4+ digits of barcode)
    if (barcode && query.length >= 3 && barcode.endsWith(query)) return 720;

    // 8. Barcode contains query
    if (barcode && barcode.includes(query)) return 700;

    // 9. SKU contains query
    if (sku && sku.includes(query)) return 680;

    // 10. Name contains query (boost if it appears earlier)
    const nameIdx = name.indexOf(query);
    if (nameIdx !== -1) {
      return 600 + Math.max(0, 50 - nameIdx);
    }

    // 11. Multi-word search
    const words = query.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      const allWordsMatch = words.every(w =>
        name.includes(w) || sku.includes(w) || (barcode && barcode.includes(w))
      );
      if (allWordsMatch) return 550;
    }

    // 12. Thai Diacritic-Tolerant match (e.g. "โคก" vs "โค้ก", "เลย" vs "เลย์")
    if (cleanName.startsWith(cleanQuery)) return 520;
    if (cleanName.includes(cleanQuery)) return 480;

    // 13. Thai Diacritic Multi-word match
    if (words.length > 1) {
      const cleanWords = cleanQuery.split(/\s+/).filter(Boolean);
      const allCleanWordsMatch = cleanWords.every(w =>
        cleanName.includes(w) || sku.includes(w) || (barcode && barcode.includes(w))
      );
      if (allCleanWordsMatch) return 450;
    }

    // 14. Category matches query
    if (category && category.includes(query)) return 350;

    // 15. Subsequence fuzzy match (for query length >= 2)
    if (query.length >= 2) {
      if (this.isSubsequence(query, name)) return 300;
      if (this.isSubsequence(cleanQuery, cleanName)) return 250;
    }

    return 0;
  },

  highlightMatchedText(text, rawQuery) {
    if (!text) return '';
    const safeText = String(text);
    if (!rawQuery) return this.escapeHtml(safeText);

    const query = String(rawQuery).trim();
    if (!query) return this.escapeHtml(safeText);

    // 1. Direct case-insensitive substring match
    const lowerText = safeText.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const idx = lowerText.indexOf(lowerQuery);

    if (idx !== -1) {
      const before = this.escapeHtml(safeText.substring(0, idx));
      const match = this.escapeHtml(safeText.substring(idx, idx + query.length));
      const after = this.escapeHtml(safeText.substring(idx + query.length));
      return `${before}<mark class="bg-amber-200 text-amber-950 font-bold px-0.5 rounded">${match}</mark>${after}`;
    }

    // 2. Multi-word match: highlight each word
    const words = query.split(/\s+/).filter(w => w.length > 0);
    if (words.length > 1) {
      try {
        const regexWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        const pattern = new RegExp(`(${regexWords})`, 'gi');
        if (pattern.test(safeText)) {
          return safeText.replace(pattern, '<mark class="bg-amber-200 text-amber-950 font-bold px-0.5 rounded">$1</mark>');
        }
      } catch (e) {}
    }

    // 3. Thai diacritic match: find map from stripped indices to original indices
    const isDiacritic = ch => /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(ch);
    const cleanChars = [];
    const origIndices = [];
    for (let i = 0; i < safeText.length; i++) {
      const ch = safeText[i];
      if (!isDiacritic(ch)) {
        cleanChars.push(ch.toLowerCase());
        origIndices.push(i);
      }
    }
    const cleanText = cleanChars.join('');
    const cleanQ = this.stripThaiDiacritics(query);

    if (cleanQ && cleanText.includes(cleanQ)) {
      const cIdx = cleanText.indexOf(cleanQ);
      const startOrig = origIndices[cIdx];
      const lastCleanIdx = cIdx + cleanQ.length - 1;
      let endOrig = origIndices[lastCleanIdx] + 1;
      while (endOrig < safeText.length && isDiacritic(safeText[endOrig])) {
        endOrig++;
      }

      const before = this.escapeHtml(safeText.substring(0, startOrig));
      const match = this.escapeHtml(safeText.substring(startOrig, endOrig));
      const after = this.escapeHtml(safeText.substring(endOrig));
      return `${before}<mark class="bg-amber-200 text-amber-950 font-bold px-0.5 rounded">${match}</mark>${after}`;
    }

    return this.escapeHtml(safeText);
  },

  updateRealtimeSearch(rawQuery) {
    const query = (rawQuery || '').trim();
    this.searchQuery = query.toLowerCase();

    const clearBtn = document.getElementById('posClearSearchBtn');
    if (clearBtn) {
      if (query.length > 0) {
        clearBtn.classList.remove('hidden');
        clearBtn.classList.add('flex');
      } else {
        clearBtn.classList.remove('flex');
        clearBtn.classList.add('hidden');
      }
    }

    if (!query) {
      this.currentSuggestions = [];
      this.activeSuggestionIndex = -1;
      this.closeSuggestionsDropdown();
      this.renderProductGrid();
      return;
    }

    const scoredProducts = this.products
      .map(p => ({
        product: p,
        score: this.calculateSearchScore(p, query)
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    this.currentSuggestions = scoredProducts.slice(0, 8).map(item => item.product);
    this.activeSuggestionIndex = this.currentSuggestions.length > 0 ? 0 : -1;

    this.renderSuggestionsDropdown();
    this.renderProductGrid(scoredProducts);
  },

  renderSuggestionsDropdown() {
    const dropdown = document.getElementById('posSearchSuggestionsDropdown');
    const list = document.getElementById('posSuggestionsList');
    if (!dropdown || !list) return;

    if (!this.searchQuery || this.currentSuggestions.length === 0) {
      dropdown.classList.add('hidden');
      this.isDropdownOpen = false;
      return;
    }

    dropdown.classList.remove('hidden');
    this.isDropdownOpen = true;

    list.innerHTML = this.currentSuggestions.map((prod, idx) => {
      const isActive = idx === this.activeSuggestionIndex;
      const stock = prod.stockQty !== undefined ? prod.stockQty : 0;
      const isOut = stock <= 0;
      const isLow = stock <= (prod.minStock || 0);

      const highlightedName = this.highlightMatchedText(prod.name, this.searchQuery);
      const highlightedSku = this.highlightMatchedText(prod.sku, this.searchQuery);
      const highlightedBarcode = prod.barcode ? this.highlightMatchedText(prod.barcode, this.searchQuery) : '';

      return `
        <div id="posSuggestionItem_${idx}"
             onclick="SalesModule.selectSuggestion(${idx})"
             class="p-2.5 flex items-center justify-between gap-3 cursor-pointer transition select-none ${isActive ? 'bg-blue-50 border-l-4 border-blue-600 pl-2' : 'hover:bg-slate-50 border-l-4 border-transparent'}">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-0.5">
              <span class="font-mono text-xs font-bold text-slate-500">${highlightedSku}</span>
              ${highlightedBarcode ? `<span class="font-mono text-[11px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">${highlightedBarcode}</span>` : ''}
              ${prod.categoryName ? `<span class="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-medium">${prod.categoryName}</span>` : ''}
            </div>
            <div class="text-sm font-bold text-slate-800 truncate">${highlightedName}</div>
          </div>
          <div class="flex items-center gap-3 shrink-0 text-right">
            <div>
              <div class="text-xs ${isOut ? 'text-rose-600 font-bold' : isLow ? 'text-amber-600 font-semibold' : 'text-slate-400'}">
                ${isOut ? '❌ หมด' : `คงเหลือ ${stock} ${prod.unit || 'ชิ้น'}`}
              </div>
              <div class="text-sm font-extrabold text-blue-700 font-mono">
                ฿${(parseFloat(prod.salePrice) || 0).toFixed(2)}
              </div>
            </div>
            ${isActive ? `
              <span class="hidden sm:inline-flex items-center px-2 py-1 rounded-lg bg-blue-600 text-white text-[10px] font-bold shadow-sm">
                Enter ↵
              </span>
            ` : `
              <span class="text-slate-300 text-xs">
                ➕
              </span>
            `}
          </div>
        </div>
      `;
    }).join('');
  },

  navigateSuggestions(dir) {
    if (!this.isDropdownOpen || this.currentSuggestions.length === 0) return;

    if (dir > 0) {
      this.activeSuggestionIndex = (this.activeSuggestionIndex + 1) % this.currentSuggestions.length;
    } else {
      this.activeSuggestionIndex = (this.activeSuggestionIndex - 1 + this.currentSuggestions.length) % this.currentSuggestions.length;
    }

    this.renderSuggestionsDropdown();
    this.scrollActiveSuggestionIntoView();
  },

  scrollActiveSuggestionIntoView() {
    if (this.activeSuggestionIndex < 0) return;
    const el = document.getElementById(`posSuggestionItem_${this.activeSuggestionIndex}`);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  },

  selectSuggestion(index) {
    const prod = this.currentSuggestions[index];
    if (!prod) return;

    this.addItemToCart(prod);
    SoundManager.playScannerBeep();
    this.clearSearch();
  },

  closeSuggestionsDropdown() {
    const dropdown = document.getElementById('posSearchSuggestionsDropdown');
    if (dropdown) dropdown.classList.add('hidden');
    this.isDropdownOpen = false;
    this.activeSuggestionIndex = -1;
  },

  clearSearch() {
    const input = document.getElementById('posBarcodeSearchInput');
    if (input) {
      input.value = '';
      input.focus();
    }
    const clearBtn = document.getElementById('posClearSearchBtn');
    if (clearBtn) {
      clearBtn.classList.remove('flex');
      clearBtn.classList.add('hidden');
    }
    this.searchQuery = '';
    this.currentSuggestions = [];
    this.activeSuggestionIndex = -1;
    this.closeSuggestionsDropdown();
    this.renderProductGrid();
  },

  addProductBySku(sku) {
    const prod = this.products.find(p => p.sku === sku);
    if (prod) {
      this.addItemToCart(prod);
      SoundManager.playScannerBeep();
    }
  },

  handleBarcodeScanOrSearch(code) {
    const clean = (code || '').trim();
    if (!clean) return;

    // 1. If user actively navigated dropdown and selected an item, use it
    if (this.activeSuggestionIndex >= 0 && this.currentSuggestions[this.activeSuggestionIndex]) {
      const selected = this.currentSuggestions[this.activeSuggestionIndex];
      this.addItemToCart(selected);
      SoundManager.playScannerBeep();
      this.clearSearch();
      return;
    }

    // 2. Exact Barcode Match (hardware laser scanner sends exact barcode + Enter)
    let matched = this.products.find(p => String(p.barcode || '').toLowerCase() === clean.toLowerCase());

    // 3. Exact SKU Match
    if (!matched) {
      matched = this.products.find(p => String(p.sku || '').toLowerCase() === clean.toLowerCase());
    }

    // 4. Closest Match from pre-scored suggestions if available
    if (!matched && this.currentSuggestions.length > 0) {
      matched = this.currentSuggestions[0];
    }

    // 5. Fallback calculate highest score on the fly
    if (!matched) {
      const scored = this.products
        .map(p => ({ product: p, score: this.calculateSearchScore(p, clean) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);
      if (scored.length > 0) {
        matched = scored[0].product;
      }
    }

    if (matched) {
      this.addItemToCart(matched);
      SoundManager.playScannerBeep();
      this.clearSearch();
    } else {
      SoundManager.playErrorTone();
      UI.showToast(`ไม่พบสินค้าที่ใกล้เคียงกับ: ${clean}`, 'warning');
      this.focusBarcodeInput();
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

    bill.clientTxnId = this.generateClientTxnId();
    bill.txnSchema = 2;
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
    bill.clientTxnId = this.generateClientTxnId();
    bill.txnSchema = 2;
    this.saveDraftBills();
    this.renderBillTabs();
    this.renderCart();
  },

  removeItemFromCart(sku) {
    const bill = this.getActiveBill();
    bill.items = bill.items.filter(i => i.sku !== sku);
    bill.clientTxnId = this.generateClientTxnId();
    bill.txnSchema = 2;
    this.saveDraftBills();
    this.renderBillTabs();
    this.renderCart();
  },

  setBillDiscount(amount) {
    const bill = this.getActiveBill();
    bill.discount = Math.max(0, parseFloat(amount) || 0);
    bill.clientTxnId = this.generateClientTxnId();
    bill.txnSchema = 2;
    this.saveDraftBills();
    this.renderCart();
  },

  clearCurrentCart() {
    const bill = this.getActiveBill();
    bill.items = [];
    bill.discount = 0;
    bill.clientTxnId = this.generateClientTxnId();
    bill.txnSchema = 2;
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

  renderProductGrid(preScoredItems) {
    const grid = document.getElementById('posProductGrid');
    if (!grid) return;

    let itemsToRender = [];

    if (preScoredItems && Array.isArray(preScoredItems)) {
      itemsToRender = preScoredItems.map(item => item.product);
    } else if (this.searchQuery) {
      itemsToRender = this.products
        .map(p => ({ product: p, score: this.calculateSearchScore(p, this.searchQuery) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(item => item.product);
    } else {
      itemsToRender = this.products;
    }

    if (this.selectedCategory !== 'ALL') {
      itemsToRender = itemsToRender.filter(p => p.categoryId === this.selectedCategory);
    }

    if (itemsToRender.length === 0) {
      grid.innerHTML = `
        <div class="col-span-full py-16 text-center text-slate-400">
          <div class="text-4xl mb-2">🔍</div>
          <div class="font-bold text-slate-600 mb-1">ไม่พบสินค้าที่ตรงกับการค้นหา</div>
          <div class="text-xs text-slate-400">ลองค้นหาด้วยชื่ออื่น รหัส SKU หรือบาร์โค้ด</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = itemsToRender.map(p => {
      const stock = p.stockQty !== undefined ? p.stockQty : 0;
      const isLow = stock <= (p.minStock || 0);
      const isOut = stock <= 0;
      const displayName = this.searchQuery ? this.highlightMatchedText(p.name, this.searchQuery) : this.escapeHtml(p.name);
      const displaySku = this.searchQuery ? this.highlightMatchedText(p.sku, this.searchQuery) : this.escapeHtml(p.sku);

      return `
        <div onclick="SalesModule.addProductBySku('${p.sku}')"
             class="group bg-white rounded-2xl p-3.5 border border-slate-200 hover:border-blue-500 shadow-sm hover:shadow-lg transition-all duration-200 cursor-pointer flex flex-col justify-between select-none relative overflow-hidden ${isOut ? 'opacity-60' : ''}">
          <div>
            <div class="flex items-start justify-between gap-1 mb-1.5">
              <span class="text-xs font-mono font-bold text-slate-400">${displaySku}</span>
              <span class="text-[11px] px-2 py-0.5 rounded-full font-bold ${isOut ? 'bg-rose-100 text-rose-700' : isLow ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">
                คงเหลือ: ${stock}
              </span>
            </div>
            <h4 class="font-bold text-sm text-slate-800 group-hover:text-blue-600 transition-colors line-clamp-2 mb-2 leading-snug">
              ${displayName}
            </h4>
          </div>
          <div class="flex items-baseline justify-between pt-2 border-t border-slate-100">
            <span class="text-xs text-slate-400">${this.escapeHtml(p.unit || 'ชิ้น')}</span>
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

    // Day & Drawer policy validation
    const policy = (this.dayDrawerStatus && this.dayDrawerStatus.policy) || 'WARN';
    const isDrawerOpen = !!(this.dayDrawerStatus && this.dayDrawerStatus.activeDrawer && this.dayDrawerStatus.activeDrawer.status === 'OPEN');
    if (policy === 'STRICT' && !isDrawerOpen) {
      UI.showToast('ไม่อนุญาตให้ชำระเงิน: บังคับเปิดวันทำการและลิ้นชักจุดขายก่อนขาย (STRICT)', 'error');
      SoundManager.playErrorTone();
      this.openDrawerModal();
      return;
    }
    if (policy === 'WARN' && !isDrawerOpen) {
      UI.showToast('คำเตือน: ยังไม่ได้เปิดลิ้นชักจุดขายสำหรับเครื่องนี้', 'warning');
    }

    const subtotal = bill.items.reduce((s, it) => s + it.amount, 0);
    const discount = bill.discount || 0;
    const grandTotal = Math.max(0, subtotal - discount);

    document.getElementById('payModalGrandTotal').textContent = `฿${grandTotal.toFixed(2)}`;
    document.getElementById('payReceivedInput').value = grandTotal;
    this.onPayMethodChange();

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

  onPayMethodChange() {
    const payMethod = document.querySelector('input[name="payMethodOption"]:checked')?.value || 'CASH';
    const bill = this.getActiveBill();
    const grandTotal = Math.max(0, bill.items.reduce((s, it) => s + it.amount, 0) - (bill.discount || 0));
    const input = document.getElementById('payReceivedInput');
    if (payMethod !== 'CASH' && input) {
      input.value = grandTotal;
    }
    this.calculateChange();
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
    if (this.isSubmittingPayment) return;

    const bill = this.getActiveBill();
    const calc = this.calculateChange();
    if (calc.received < calc.grandTotal) {
      UI.showToast('ยอดเงินที่รับมาน้อยกว่ายอดที่ต้องชำระ', 'warning');
      SoundManager.playErrorTone();
      return;
    }

    if (!bill.clientTxnId || bill.txnSchema !== 2) {
      bill.clientTxnId = this.generateClientTxnId();
      bill.txnSchema = 2;
      this.saveDraftBills();
    }

    const payMethod = document.querySelector('input[name="payMethodOption"]:checked')?.value || 'CASH';

    this.isSubmittingPayment = true;
    UI.closeModal('paymentModal');
    UI.showLoading('กำลังบันทึกรายการขายและตัดสต๊อก...');

    const payload = {
      branchId: this.activeBranchId,
      stationId: this.stationId || localStorage.getItem(CONFIG.STORAGE_KEYS.STATION_ID) || CONFIG.DEFAULT_STATION_ID,
      dayId: (this.dayDrawerStatus && this.dayDrawerStatus.activeDay && this.dayDrawerStatus.activeDay.dayId) || '',
      drawerId: (this.dayDrawerStatus && this.dayDrawerStatus.activeDrawer && this.dayDrawerStatus.activeDrawer.drawerId) || '',
      items: bill.items,
      discount: bill.discount || 0,
      received: calc.received,
      payMethod: payMethod,
      clientTxnId: bill.clientTxnId
    };

    let res;
    try {
      res = await Api.call('sales:checkout', payload);
    } finally {
      this.isSubmittingPayment = false;
      UI.hideLoading();
    }

    if (res && res.ok && res.sale) {
      const receiptNo = res.receiptNo || res.sale.receiptNo || '-';
      const parsedChange = parseFloat(res.sale.change);
      const actualChange = isNaN(parsedChange) ? calc.change : parsedChange;
      const storeInfo = res.store || this.receiptStoreInfo || {};

      // 1. Voice Announcement
      SoundManager.playSuccessChime();
      setTimeout(() => {
        SoundManager.announceChange(actualChange);
      }, 400);

      // 2. Clear completed bill or reset (พร้อมสร้าง clientTxnId ใหม่สำหรับบิลถัดไปทันที)
      this.closeBill(this.activeBillIndex);

      UI.showToast(`ชำระเงินสำเร็จ! ใบเสร็จเลขที่: ${receiptNo}`, 'success');

      // 3. Auto Print Receipt (or preview)
      const prof = PrintManager.activeProfile;
      if (prof && (prof.autoPrint === true || String(prof.autoPrint) === 'true')) {
        PrintManager.printReceiptDirect(res.sale, res.items, storeInfo, prof);
      } else {
        PrintManager.previewReceiptModal(res.sale, res.items, storeInfo, prof);
      }

      // 4. Background refresh stock balances and day/drawer status
      this.refreshProductsStockSilent();
      this.refreshDayDrawerStatusSilent();
    } else {
      SoundManager.playErrorTone();
      UI.showToast(`ชำระเงินไม่สำเร็จ: ${(res && (res.error || res.message)) || 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์'}`, 'error');
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
  async openVoidModal() {
    this.selectedVoidReceiptNo = null;
    this.activeVoidFilter = 'ALL';
    this.todayVoidReceipts = [];

    const searchInput = document.getElementById('voidSearchReceiptNo');
    if (searchInput) searchInput.value = '';

    const reasonInput = document.getElementById('voidReasonInput');
    if (reasonInput) reasonInput.value = '';

    const detailContainer = document.getElementById('voidReceiptDetailContainer');
    if (detailContainer) {
      detailContainer.innerHTML = `
        <div class="text-center py-10 text-slate-400 text-xs flex flex-col items-center justify-center gap-2">
          <span class="text-3xl">👈</span>
          <span>คลิกเลือกใบเสร็จจากรายการด้านซ้าย<br>หรือกรอกเลขที่ใบเสร็จแล้วกดค้นหา</span>
        </div>
      `;
    }

    const confirmBtn = document.getElementById('voidConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = true;

    const statusBadge = document.getElementById('voidSelectedStatusBadge');
    if (statusBadge) statusBadge.classList.add('hidden');

    const sub = document.getElementById('voidModalSubtitle');
    const businessDate = (this.dayDrawerStatus && this.dayDrawerStatus.activeDay && this.dayDrawerStatus.activeDay.businessDate) || new Date().toISOString().slice(0, 10);
    if (sub) {
      sub.textContent = `สาขา: ${this.activeBranchId} | วันทำการ: ${businessDate}`;
    }

    this.updateVoidFilterTabsUI();
    UI.openModal('voidReceiptModal');

    // Fetch today's receipts in background
    await this.loadTodayReceiptsForVoid();
  },

  async loadTodayReceiptsForVoid() {
    const listContainer = document.getElementById('voidTodayReceiptsList');
    if (listContainer) {
      listContainer.innerHTML = `
        <div class="text-center py-8 text-slate-400 text-xs flex items-center justify-center gap-2">
          <span class="animate-spin text-sm">⏳</span> <span>กำลังโหลดรายการใบเสร็จของวันนี้...</span>
        </div>
      `;
    }

    const businessDate = (this.dayDrawerStatus && this.dayDrawerStatus.activeDay && this.dayDrawerStatus.activeDay.businessDate) || '';
    const res = await Api.call('sales:todayReceipts', {
      branchId: this.activeBranchId,
      date: businessDate
    });

    if (res && res.ok && Array.isArray(res.receipts)) {
      this.todayVoidReceipts = res.receipts;
      this.renderTodayVoidReceiptsList();
    } else {
      if (listContainer) {
        listContainer.innerHTML = `
          <div class="text-center py-6 text-rose-500 text-xs">
            ไม่สามารถโหลดรายการใบเสร็จได้ (${(res && res.error) || 'ลองค้นหาด้วยเลขที่บิลแทน'})
          </div>
        `;
      }
    }
  },

  setVoidFilter(filter) {
    this.activeVoidFilter = filter || 'ALL';
    this.updateVoidFilterTabsUI();
    const searchInput = document.getElementById('voidSearchReceiptNo');
    const query = searchInput ? searchInput.value.trim() : '';
    this.renderTodayVoidReceiptsList(query);
  },

  updateVoidFilterTabsUI() {
    const tabs = ['ALL', 'PAID', 'VOID'];
    tabs.forEach(t => {
      const btn = document.getElementById(`voidFilterBtn_${t}`);
      if (btn) {
        if (this.activeVoidFilter === t) {
          btn.className = 'py-1 rounded-lg bg-white text-slate-800 shadow-xs transition cursor-pointer';
        } else {
          btn.className = 'py-1 rounded-lg text-slate-600 hover:text-slate-900 transition cursor-pointer';
        }
      }
    });
  },

  filterTodayVoidReceipts(query) {
    this.renderTodayVoidReceiptsList(query);
  },

  renderTodayVoidReceiptsList(searchQuery = '') {
    const listContainer = document.getElementById('voidTodayReceiptsList');
    if (!listContainer) return;

    let filtered = this.todayVoidReceipts || [];

    // Filter by status tab
    if (this.activeVoidFilter === 'PAID') {
      filtered = filtered.filter(r => r.status !== 'VOID');
    } else if (this.activeVoidFilter === 'VOID') {
      filtered = filtered.filter(r => r.status === 'VOID');
    }

    // Filter by search query
    const cleanQuery = (searchQuery || '').trim().toLowerCase();
    if (cleanQuery) {
      filtered = filtered.filter(r => {
        const no = String(r.receiptNo || '').toLowerCase();
        const cashier = String(r.cashierName || '').toLowerCase();
        const amount = String(r.total != null ? r.total : '');
        const pay = String(r.payMethod || '').toLowerCase();
        return no.includes(cleanQuery) || cashier.includes(cleanQuery) || amount.includes(cleanQuery) || pay.includes(cleanQuery);
      });
    }

    const countBadge = document.getElementById('voidReceiptsCountBadge');
    if (countBadge) {
      countBadge.textContent = `${filtered.length} / ${this.todayVoidReceipts.length} รายการ`;
    }

    if (filtered.length === 0) {
      listContainer.innerHTML = `
        <div class="text-center py-8 text-slate-400 text-xs">
          ${cleanQuery ? 'ไม่พบบิลที่ตรงกับคำค้นหา' : 'ยังไม่มีรายการใบเสร็จในวันนี้'}
        </div>
      `;
      return;
    }

    listContainer.innerHTML = filtered.map(r => {
      const isSelected = this.selectedVoidReceiptNo === r.receiptNo;
      const isVoid = r.status === 'VOID';

      const cardBorder = isSelected ?
        'border-rose-500 bg-rose-50/50 shadow-sm ring-1 ring-rose-500' :
        'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80';

      const statusBadge = isVoid ?
        '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">VOID</span>' :
        '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">PAID</span>';

      const timeStr = r.ts ? new Date(r.ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-';
      const payIcon = r.payMethod === 'CASH' ? '💵 สด' : (r.payMethod === 'QR' ? '📱 QR' : '🏦 โอน');

      return `
        <div onclick="SalesModule.selectReceiptForVoid('${escapeHtml(r.receiptNo)}')"
             class="p-2.5 rounded-2xl border transition cursor-pointer text-xs space-y-1 ${cardBorder}">
          <div class="flex items-center justify-between">
            <span class="font-mono font-bold text-slate-900">${escapeHtml(r.receiptNo)}</span>
            ${statusBadge}
          </div>
          <div class="flex items-center justify-between text-[11px] text-slate-500">
            <span>🕒 ${timeStr} • ${escapeHtml(r.cashierName || '-')}</span>
            <span class="font-mono font-bold text-slate-600">${payIcon}</span>
          </div>
          <div class="flex items-center justify-between pt-1 border-t border-slate-100 font-mono">
            <span class="text-[10px] text-slate-400">ยอดสุทธิ:</span>
            <span class="font-bold ${isVoid ? 'text-slate-400 line-through' : 'text-blue-600'}">฿${parseFloat(r.total || 0).toFixed(2)}</span>
          </div>
        </div>
      `;
    }).join('');
  },

  async selectReceiptForVoid(receiptNo) {
    if (!receiptNo) return;
    this.selectedVoidReceiptNo = receiptNo;

    const searchInput = document.getElementById('voidSearchReceiptNo');
    if (searchInput) searchInput.value = receiptNo;

    // Refresh active card highlight
    this.renderTodayVoidReceiptsList(searchInput ? searchInput.value : '');

    // Load full details for this receipt
    await this.searchReceiptForVoid(receiptNo);
  },

  async searchReceiptForVoid(explicitReceiptNo = null) {
    const receiptNo = (explicitReceiptNo || document.getElementById('voidSearchReceiptNo')?.value || '').trim();
    if (!receiptNo) {
      UI.showToast('กรุณากรอกหรือเลือกเลขที่ใบเสร็จ', 'warning');
      return;
    }

    this.selectedVoidReceiptNo = receiptNo;
    const searchInput = document.getElementById('voidSearchReceiptNo');
    if (searchInput) searchInput.value = receiptNo;

    const container = document.getElementById('voidReceiptDetailContainer');
    const confirmBtn = document.getElementById('voidConfirmBtn');
    const statusBadge = document.getElementById('voidSelectedStatusBadge');

    if (container) {
      container.innerHTML = `
        <div class="text-center py-8 text-slate-400 text-xs flex items-center justify-center gap-2">
          <span class="animate-spin text-sm">⏳</span> <span>กำลังโหลดรายละเอียดใบเสร็จ ${escapeHtml(receiptNo)}...</span>
        </div>
      `;
    }

    const res = await Api.call('sales:receipt', { receiptNo });

    if (res && res.ok && res.receipt) {
      const sale = res.receipt.sale;
      const items = res.receipt.items || [];
      const isVoid = sale.status === 'VOID';

      if (statusBadge) {
        statusBadge.classList.remove('hidden');
        if (isVoid) {
          statusBadge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800';
          statusBadge.textContent = 'ยกเลิกแล้ว (VOID)';
        } else {
          statusBadge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800';
          statusBadge.textContent = 'ชำระแล้ว (PAID)';
        }
      }

      const voidBannerHtml = isVoid ? `
        <div class="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-xs space-y-1 mb-2">
          <div class="font-bold flex items-center gap-1.5 text-rose-900">
            <span>⚠️</span> <span>ใบเสร็จนี้ถูกยกเลิกไปแล้ว (VOID)</span>
          </div>
          <div class="text-[11px] text-rose-700">ผู้ยกเลิก: <strong>${escapeHtml(sale.voidBy || '-')}</strong> เมื่อ ${sale.voidAt ? new Date(sale.voidAt).toLocaleString('th-TH') : '-'}</div>
          ${sale.voidReason ? `<div class="text-[11px] text-rose-700">เหตุผล: ${escapeHtml(sale.voidReason)}</div>` : ''}
        </div>
      ` : '';

      const payMethodLabel = sale.payMethod === 'CASH' ? 'เงินสด (Cash)' : (sale.payMethod === 'QR' ? 'สแกน QR Code' : 'โอนเงิน (Transfer)');

      if (container) {
        container.innerHTML = `
          ${voidBannerHtml}
          <div class="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-2.5">
            <div class="flex items-center justify-between font-bold text-slate-800 border-b border-slate-200 pb-2">
              <div>
                <span class="font-mono text-sm text-purple-700">${escapeHtml(sale.receiptNo)}</span>
                <span class="text-slate-400 font-normal ml-1">(${sale.ts ? new Date(sale.ts).toLocaleString('th-TH') : '-'})</span>
              </div>
              <span class="text-blue-600 font-mono text-base font-black">฿${parseFloat(sale.total || 0).toFixed(2)}</span>
            </div>

            <div class="grid grid-cols-2 gap-2 text-[11px] text-slate-600">
              <div>แคชเชียร์: <strong class="text-slate-800">${escapeHtml(sale.cashierName || sale.userId || '-')}</strong></div>
              <div>ช่องทางชำระ: <strong class="text-slate-800">${payMethodLabel}</strong></div>
            </div>

            <!-- Items Table -->
            <div class="border-t border-slate-200 pt-2 space-y-1.5 max-h-44 overflow-y-auto pr-1">
              <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">รายการสินค้า (${items.length} รายการ):</div>
              ${items.map(it => `
                <div class="flex items-center justify-between text-xs py-0.5">
                  <div class="flex-1 truncate pr-2">
                    <span class="font-medium text-slate-800">${escapeHtml(it.name)}</span>
                    <span class="text-slate-400 font-mono text-[11px]"> x${it.qty}</span>
                  </div>
                  <span class="font-mono font-bold text-slate-700">฿${parseFloat(it.amount || 0).toFixed(2)}</span>
                </div>
              `).join('')}
            </div>

            <!-- Summary Breakdown -->
            <div class="border-t border-slate-200 pt-2 space-y-0.5 text-[11px] font-mono">
              <div class="flex justify-between text-slate-500">
                <span>ยอดรวมสินค้า:</span>
                <span>฿${parseFloat(sale.subtotal || sale.total || 0).toFixed(2)}</span>
              </div>
              ${parseFloat(sale.discount || 0) > 0 ? `
                <div class="flex justify-between text-rose-600">
                  <span>ส่วนลด:</span>
                  <span>-฿${parseFloat(sale.discount).toFixed(2)}</span>
                </div>
              ` : ''}
              <div class="flex justify-between font-bold text-slate-800 text-xs pt-1 border-t border-slate-100">
                <span>ยอดชำระสุทธิ:</span>
                <span class="text-blue-600">฿${parseFloat(sale.total || 0).toFixed(2)}</span>
              </div>
            </div>
          </div>
        `;
      }

      if (confirmBtn) {
        confirmBtn.disabled = isVoid;
      }

      if (!isVoid) {
        const reasonInput = document.getElementById('voidReasonInput');
        if (reasonInput) reasonInput.focus();
      }
    } else {
      if (statusBadge) statusBadge.classList.add('hidden');
      if (container) {
        container.innerHTML = `
          <div class="text-center py-8 text-rose-500 text-xs">
            ไม่พบข้อมูลใบเสร็จ ${escapeHtml(receiptNo)}
          </div>
        `;
      }
      if (confirmBtn) confirmBtn.disabled = true;
    }
  },

  setQuickVoidReason(reason) {
    const reasonInput = document.getElementById('voidReasonInput');
    if (reasonInput) {
      reasonInput.value = reason;
      reasonInput.focus();
    }
  },

  async confirmVoidReceipt() {
    const receiptNo = (this.selectedVoidReceiptNo || document.getElementById('voidSearchReceiptNo')?.value || '').trim();
    const reason = document.getElementById('voidReasonInput')?.value.trim();

    if (!receiptNo || !reason) {
      UI.showToast('กรุณาระบุเหตุผลในการยกเลิกใบเสร็จ', 'warning');
      return;
    }

    const ok = await UI.confirmDialog('ยืนยันยกเลิกใบเสร็จ', `คุณต้องการยกเลิกใบเสร็จเลขที่ ${receiptNo} ใช่หรือไม่?\nรายการสินค้าจะถูกคืนสต๊อกโดยอัตโนมัติ`);
    if (!ok) return;

    UI.showLoading('กำลังยกเลิกใบเสร็จและคืนสต๊อก...');
    const res = await Api.call('sales:void', { receiptNo, reason });
    UI.hideLoading();

    if (res && res.ok) {
      SoundManager.announceVoid(receiptNo);
      UI.showToast(res.message || 'ยกเลิกใบเสร็จสำเร็จ (คืนสต๊อกเรียบร้อย)', 'success');
      
      // Refresh background stock balances and day/drawer status
      this.refreshProductsStockSilent();
      this.refreshDayDrawerStatusSilent();

      // Reload today's receipts in modal and show voided status
      await this.loadTodayReceiptsForVoid();
      await this.searchReceiptForVoid(receiptNo);
    } else {
      SoundManager.playErrorTone();
      UI.showToast(`ยกเลิกไม่สำเร็จ: ${(res && (res.error || res.message)) || 'เกิดข้อผิดพลาด'}`, 'error');
    }
  },

  // ================= POS DAY & DRAWER CONTROLS =================

  async promptSwitchStation() {
    const current = this.stationId || 'POS-01';
    const next = prompt('ระบุรหัสเครื่องจุดขาย (Station ID):', current);
    if (!next) return;
    const clean = next.trim().toUpperCase();
    if (!clean || clean === current) return;
    this.stationId = clean;
    localStorage.setItem(CONFIG.STORAGE_KEYS.STATION_ID, clean);
    const stLabel = document.getElementById('posStationLabel');
    if (stLabel) stLabel.textContent = clean;
    UI.showToast(`สลับเครื่องจุดขายเป็น ${clean} แล้ว`, 'info');
    await this.refreshDayDrawerStatus();
  },

  async refreshDayDrawerStatus() {
    const res = await Api.call('finance:dayStatus', {
      branchId: this.activeBranchId,
      stationId: this.stationId
    });
    if (res && res.ok) {
      this.updateDayDrawerStatusUI(res);
    }
  },

  async refreshDayDrawerStatusSilent() {
    try {
      const res = await Api.call('finance:dayStatus', {
        branchId: this.activeBranchId,
        stationId: this.stationId
      });
      if (res && res.ok) {
        this.updateDayDrawerStatusUI(res);
      }
    } catch (e) {
      console.warn('Failed to refresh day/drawer status silently:', e);
    }
  },

  updateDayDrawerStatusUI(status) {
    this.dayDrawerStatus = status || null;
    const activeDay = status && status.activeDay;
    const activeDrawer = status && status.activeDrawer;
    const policy = (status && status.policy) || 'WARN';

    // 1. Station Label
    const stLabel = document.getElementById('posStationLabel');
    if (stLabel) stLabel.textContent = this.stationId || 'POS-01';

    // 2. Day Status Pill
    const dayPill = document.getElementById('posDayStatusPill');
    const dayDot = document.getElementById('posDayStatusDot');
    const dayText = document.getElementById('posDayStatusText');
    if (dayPill && dayDot && dayText) {
      if (activeDay && activeDay.status === 'OPEN') {
        dayDot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
        dayText.textContent = `เปิดวัน: ${activeDay.businessDate}`;
        dayPill.className = 'flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold';
      } else if (activeDay && activeDay.status === 'CLOSED') {
        dayDot.className = 'w-2 h-2 rounded-full bg-slate-400';
        dayText.textContent = `ปิดวันแล้ว (${activeDay.businessDate})`;
        dayPill.className = 'flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 text-slate-600 border border-slate-200 font-bold';
      } else {
        dayDot.className = 'w-2 h-2 rounded-full bg-amber-400';
        dayText.textContent = 'ยังไม่เปิดวันทำการ';
        dayPill.className = 'flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-50 text-amber-800 border border-amber-200 font-bold';
      }
    }

    // 3. Drawer Status Pill & Manage Button
    const drawerPill = document.getElementById('posDrawerStatusPill');
    const drawerText = document.getElementById('posDrawerStatusText');
    const manageBtnText = document.getElementById('posManageDrawerBtnText');
    const manageBtn = document.getElementById('posManageDrawerBtn');
    const warnBadge = document.getElementById('posPolicyWarnBadge');

    const isDrawerOpen = !!(activeDrawer && activeDrawer.status === 'OPEN');
    if (drawerPill && drawerText) {
      if (isDrawerOpen) {
        drawerText.textContent = `ลิ้นชักเปิด: ${activeDrawer.shift || 'ปกติ'}`;
        drawerPill.className = 'flex items-center gap-1.5 px-3 py-1 rounded-xl bg-purple-50 text-purple-800 border border-purple-200 font-bold';
        if (manageBtnText) manageBtnText.textContent = 'จัดการลิ้นชัก / ปิดกะ';
        if (manageBtn) manageBtn.className = 'px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer';
      } else {
        drawerText.textContent = 'ลิ้นชักปิดอยู่';
        drawerPill.className = 'flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 text-slate-600 border border-slate-200 font-bold';
        if (manageBtnText) manageBtnText.textContent = 'เปิดลิ้นชักขาย';
        if (manageBtn) manageBtn.className = 'px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer';
      }
    }

    // 4. Policy Warning Badge
    if (warnBadge) {
      if (!isDrawerOpen) {
        warnBadge.classList.remove('hidden');
        if (policy === 'STRICT') {
          warnBadge.textContent = '🚫 ล็อกการขาย (STRICT: ต้องเปิดวันและลิ้นชักก่อน)';
          warnBadge.className = 'text-[11px] font-bold text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200';
        } else if (policy === 'WARN') {
          warnBadge.textContent = '⚠️ ยังไม่ได้เปิดวัน/ลิ้นชัก';
          warnBadge.className = 'text-[11px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200';
        } else {
          warnBadge.classList.add('hidden');
        }
      } else {
        warnBadge.classList.add('hidden');
      }
    }
  },

  async openDrawerModal() {
    UI.showLoading('กำลังตรวจสอบสถานะลิ้นชัก...');
    const res = await Api.call('finance:dayStatus', {
      branchId: this.activeBranchId,
      stationId: this.stationId
    });
    UI.hideLoading();

    if (!res || !res.ok) {
      UI.showToast(res && res.error ? res.error : 'ไม่สามารถโหลดสถานะลิ้นชักได้', 'error');
      return;
    }

    this.updateDayDrawerStatusUI(res);

    const sub = document.getElementById('posDrawerModalSubtitle');
    if (sub) sub.textContent = `เครื่อง: ${this.stationId} | สาขา: ${this.activeBranchId}`;

    const stateUnopened = document.getElementById('posDrawerState_unopened');
    const stateOpened = document.getElementById('posDrawerState_opened');

    if (res.activeDrawer && res.activeDrawer.status === 'OPEN') {
      // Show Opened State
      if (stateUnopened) stateUnopened.classList.add('hidden');
      if (stateOpened) stateOpened.classList.remove('hidden');

      // Fetch live closing preview
      UI.showLoading('กำลังสรุปยอดเงินสดในลิ้นชัก...');
      const prev = await Api.call('finance:drawerClosePreview', { drawerId: res.activeDrawer.drawerId });
      UI.hideLoading();

      if (prev && prev.ok) {
        this.activeDrawerPreview = prev;
        const d = prev.drawer || res.activeDrawer;

        const shiftEl = document.getElementById('posActiveShiftLabel');
        if (shiftEl) shiftEl.textContent = `${d.shift || 'ปกติ'} (แคชเชียร์: ${d.cashierName || d.cashierId || '-'})`;

        const idEl = document.getElementById('posActiveDrawerId');
        if (idEl) idEl.textContent = d.drawerId;

        const expEl = document.getElementById('posActiveExpectedCash');
        if (expEl) expEl.textContent = `฿${(prev.expectedCash || 0).toFixed(2)}`;

        const fltEl = document.getElementById('posActiveFloat');
        if (fltEl) fltEl.textContent = `฿${(prev.openingFloat || 0).toFixed(2)}`;

        const saleEl = document.getElementById('posActiveCashSales');
        if (saleEl) saleEl.textContent = `฿${(prev.cashSales || 0).toFixed(2)}`;

        const inEl = document.getElementById('posActiveCashIn');
        if (inEl) inEl.textContent = `+฿${(prev.cashIn || 0).toFixed(2)}`;

        const dropEl = document.getElementById('posActiveCashDrop');
        if (dropEl) dropEl.textContent = `-฿${(prev.cashDrop || 0).toFixed(2)}`;

        // Clear denominations
        [1000, 500, 100, 50, 20, 10, 5, 2, 1].forEach(dVal => {
          const inp = document.getElementById(`posDenom_${dVal}`);
          if (inp) inp.value = '';
          const tot = document.getElementById(`posDenomTot_${dVal}`);
          if (tot) tot.textContent = '฿0';
        });

        const actualInp = document.getElementById('posDrawerActualCashInput');
        if (actualInp) actualInp.value = (prev.expectedCash || 0).toFixed(2);

        const dropInp = document.getElementById('posDrawerCashDropInput');
        const defaultDrop = Math.max(0, (prev.expectedCash || 0) - (prev.openingFloat || 0));
        if (dropInp) dropInp.value = defaultDrop.toFixed(2);

        const noteInp = document.getElementById('posCloseDrawerNoteInput');
        if (noteInp) noteInp.value = '';

        this.recalculateDrawerVariance();
      }
    } else {
      // Show Unopened State
      if (stateOpened) stateOpened.classList.add('hidden');
      if (stateUnopened) stateUnopened.classList.remove('hidden');

      const shiftInp = document.getElementById('posOpenDrawerShiftInput');
      if (shiftInp && !shiftInp.value) shiftInp.value = 'กะเช้า';

      const floatInp = document.getElementById('posOpenDrawerFloatInput');
      const defFloat = (res.settings && res.settings.openingFloatAmount !== undefined) ? res.settings.openingFloatAmount : 1000;
      if (floatInp) floatInp.value = defFloat;

      const noteInp = document.getElementById('posOpenDrawerNoteInput');
      if (noteInp) noteInp.value = '';
    }

    UI.openModal('posDrawerModal');
  },

  selectShiftPreset(shift) {
    const input = document.getElementById('posOpenDrawerShiftInput');
    if (input) input.value = shift;
  },

  async submitOpenDrawer() {
    const shift = document.getElementById('posOpenDrawerShiftInput')?.value.trim() || 'ปกติ';
    const openingFloat = parseFloat(document.getElementById('posOpenDrawerFloatInput')?.value);
    const note = document.getElementById('posOpenDrawerNoteInput')?.value.trim() || '';

    if (isNaN(openingFloat) || openingFloat < 0) {
      UI.showToast('กรุณาระบุจำนวนเงินทอนตั้งต้นที่ถูกต้อง', 'warning');
      return;
    }

    UI.showLoading('กำลังบันทึกเปิดลิ้นชักจุดขาย...');
    const res = await Api.call('finance:openDrawer', {
      branchId: this.activeBranchId,
      stationId: this.stationId,
      shift,
      openingFloat,
      note
    });
    UI.hideLoading();

    if (res && res.ok) {
      UI.closeModal('posDrawerModal');
      UI.showToast(`เปิดลิ้นชัก ${shift} สำเร็จ! (เงินทอน: ฿${openingFloat.toFixed(2)})`, 'success');
      await this.refreshDayDrawerStatus();
    } else {
      UI.showToast(res && res.error ? res.error : 'ไม่สามารถเปิดลิ้นชักได้', 'error');
    }
  },

  async promptMovement(type) {
    const dId = (this.activeDrawerPreview && this.activeDrawerPreview.drawer && this.activeDrawerPreview.drawer.drawerId) ||
                (this.dayDrawerStatus && this.dayDrawerStatus.activeDrawer && this.dayDrawerStatus.activeDrawer.drawerId);

    if (!dId) {
      UI.showToast('ไม่พบข้อมูลลิ้นชักที่เปิดอยู่', 'error');
      return;
    }

    let title = 'การเคลื่อนไหวเงินสด';
    if (type === 'CASH_IN') title = 'เติมเงินทอนเข้าลิ้นชัก (Cash In)';
    else if (type === 'CASH_OUT') title = 'นำเงินสดออกจากลิ้นชัก (Cash Out)';
    else if (type === 'CASH_DROP') title = 'ดึงเงินสดส่งตู้เซฟกลางกะ (Cash Drop)';

    const amtStr = prompt(`${title}\nระบุจำนวนเงิน (บาท):`);
    if (amtStr === null) return;
    const amount = parseFloat(amtStr);
    if (isNaN(amount) || amount <= 0) {
      UI.showToast('กรุณาระบุจำนวนเงินที่มากกว่า 0', 'warning');
      return;
    }

    const note = prompt(`ระบุหมายเหตุ / เหตุผล (ถ้ามี):`, '') || '';

    UI.showLoading('กำลังบันทึกการเคลื่อนไหวเงินสด...');
    const res = await Api.call('finance:drawerMovement', {
      drawerId: dId,
      type,
      amount,
      note
    });
    UI.hideLoading();

    if (res && res.ok) {
      UI.showToast(`บันทึก ${title} เรียบร้อยแล้ว (฿${amount.toFixed(2)})`, 'success');
      await this.openDrawerModal();
    } else {
      UI.showToast(res && res.error ? res.error : 'บันทึกรายการไม่สำเร็จ', 'error');
    }
  },

  onDenomInput() {
    const denoms = [1000, 500, 100, 50, 20, 10, 5, 2, 1];
    let total = 0;
    denoms.forEach(dVal => {
      const input = document.getElementById(`posDenom_${dVal}`);
      const count = parseInt(input?.value, 10) || 0;
      const sub = count * dVal;
      total += sub;
      const display = document.getElementById(`posDenomTot_${dVal}`);
      if (display) display.textContent = `฿${sub.toLocaleString()}`;
    });

    const actualInput = document.getElementById('posDrawerActualCashInput');
    if (actualInput) actualInput.value = total.toFixed(2);

    this.recalculateDrawerVariance();
  },

  onActualManualInput() {
    this.recalculateDrawerVariance();
  },

  onCashDropInput() {
    this.recalculateDrawerVariance();
  },

  recalculateDrawerVariance() {
    const expected = (this.activeDrawerPreview && this.activeDrawerPreview.expectedCash) || 0;
    const actual = parseFloat(document.getElementById('posDrawerActualCashInput')?.value) || 0;
    const drop = parseFloat(document.getElementById('posDrawerCashDropInput')?.value) || 0;
    const carry = Math.max(0, actual - drop);
    const diff = actual - expected;

    const carryEl = document.getElementById('posDrawerCarryForwardDisplay');
    if (carryEl) carryEl.textContent = `฿${carry.toFixed(2)}`;

    const varEl = document.getElementById('posDrawerVarianceDisplay');
    if (varEl) varEl.textContent = `${diff >= 0 ? '+' : ''}฿${diff.toFixed(2)}`;

    const badge = document.getElementById('posDrawerVarianceBadge');
    if (badge) {
      if (Math.abs(diff) < 0.01) {
        badge.textContent = 'ตรงระบบ';
        badge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800';
      } else if (diff > 0) {
        badge.textContent = `เงินเกิน (+฿${diff.toFixed(2)})`;
        badge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800';
      } else {
        badge.textContent = `เงินขาด (฿${diff.toFixed(2)})`;
        badge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800';
      }
    }
  },

  async submitCloseDrawer() {
    const dId = (this.activeDrawerPreview && this.activeDrawerPreview.drawer && this.activeDrawerPreview.drawer.drawerId) ||
                (this.dayDrawerStatus && this.dayDrawerStatus.activeDrawer && this.dayDrawerStatus.activeDrawer.drawerId);

    if (!dId) {
      UI.showToast('ไม่พบข้อมูลลิ้นชักที่เปิดอยู่', 'error');
      return;
    }

    const actualCash = parseFloat(document.getElementById('posDrawerActualCashInput')?.value);
    const cashDrop = parseFloat(document.getElementById('posDrawerCashDropInput')?.value) || 0;
    const note = document.getElementById('posCloseDrawerNoteInput')?.value.trim() || '';

    if (isNaN(actualCash) || actualCash < 0) {
      UI.showToast('กรุณาระบุยอดเงินสดนับได้จริง', 'warning');
      return;
    }

    const denoms = {};
    [1000, 500, 100, 50, 20, 10, 5, 2, 1].forEach(dVal => {
      const c = parseInt(document.getElementById(`posDenom_${dVal}`)?.value, 10) || 0;
      if (c > 0) denoms[dVal] = c;
    });

    const confirmed = await UI.confirmDialog('ยืนยันปิดลิ้นชักส่งกะ', `ยอดเงินนับจริง: ฿${actualCash.toFixed(2)}\nยอดเงินสดนำส่งเซฟ: ฿${cashDrop.toFixed(2)}\nเงินทอนยกไป: ฿${Math.max(0, actualCash - cashDrop).toFixed(2)}\n\nต้องการยืนยันการปิดลิ้นชักใช่หรือไม่?`);
    if (!confirmed) return;

    UI.showLoading('กำลังบันทึกปิดลิ้นชักส่งกะ...');
    const res = await Api.call('finance:closeDrawer', {
      drawerId: dId,
      actualCash,
      denominations: denoms,
      cashDrop,
      note
    });
    UI.hideLoading();

    if (res && res.ok && res.drawer) {
      UI.closeModal('posDrawerModal');
      UI.showToast(`ปิดลิ้นชัก ${res.drawer.drawerId} สำเร็จ!`, 'success');
      this.printDrawerClosingSlip(res.drawer);
      await this.refreshDayDrawerStatus();
    } else {
      UI.showToast(res && res.error ? res.error : 'ไม่สามารถปิดลิ้นชักได้', 'error');
    }
  },

  printDrawerClosingSlip(drawer) {
    if (!drawer) return;
    const st = this.receiptStoreInfo || {};
    const storeName = st.storeName || CONFIG.DEFAULT_STORE_NAME || 'POS System';
    const branchName = drawer.branchId || 'B01';
    const variance = parseFloat(drawer.variance) || 0;
    const varText = variance === 0 ? '฿0.00 (ตรง)' : (variance > 0 ? `+฿${variance.toFixed(2)} (เกิน)` : `-฿${Math.abs(variance).toFixed(2)} (ขาด)`);

    let denomObj = {};
    try {
      denomObj = typeof drawer.denominationsJson === 'string' ? JSON.parse(drawer.denominationsJson || '{}') : (drawer.denominationsJson || {});
    } catch (e) {
      denomObj = {};
    }

    const denomRows = Object.entries(denomObj).map(([face, count]) => `
      <div style="display:flex; justify-content:space-between; font-size:10px;">
        <span>฿${face} x ${count}</span>
        <span>฿${(parseFloat(face) * count).toFixed(2)}</span>
      </div>
    `).join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>ใบปิดลิ้นชักส่งกะ - ${drawer.drawerId}</title>
        <style>
          @page { size: auto; margin: 2mm; }
          body { font-family: monospace, sans-serif; font-size: 11px; margin: 0; padding: 4px; color: #000; }
          .center { text-align: center; }
          .right { text-align: right; }
          .bold { font-weight: bold; }
          .line { border-top: 1px dashed #000; margin: 4px 0; }
          .double-line { border-top: 2px solid #000; margin: 5px 0; }
          .row { display: flex; justify-content: space-between; margin: 2px 0; }
        </style>
      </head>
      <body>
        <div class="center bold" style="font-size:13px;">${escapeHtml(storeName)}</div>
        <div class="center bold" style="font-size:12px;">ใบปิดลิ้นชักส่งกะ (Shift Closing)</div>
        <div class="center" style="font-size:10px;">สาขา: ${escapeHtml(branchName)} | เครื่อง: ${escapeHtml(drawer.stationId || 'POS-01')}</div>
        <div class="line"></div>
        <div class="row"><span>รหัสลิ้นชัก:</span><span class="bold">${escapeHtml(drawer.drawerId)}</span></div>
        <div class="row"><span>กะการทำงาน:</span><span>${escapeHtml(drawer.shift || '-')}</span></div>
        <div class="row"><span>แคชเชียร์:</span><span>${escapeHtml(drawer.cashierName || drawer.cashierId || '-')}</span></div>
        <div class="row"><span>เวลาเปิด:</span><span>${new Date(drawer.openedAt).toLocaleTimeString('th-TH')}</span></div>
        <div class="row"><span>เวลาปิด:</span><span>${new Date(drawer.closedAt || Date.now()).toLocaleTimeString('th-TH')}</span></div>
        <div class="line"></div>
        <div class="row"><span>เงินทอนตั้งต้น:</span><span class="bold">฿${parseFloat(drawer.openingFloat || 0).toFixed(2)}</span></div>
        <div class="row"><span>ยอดขายเงินสด:</span><span class="bold">฿${parseFloat(drawer.cashSales || 0).toFixed(2)}</span></div>
        <div class="row"><span>เติมเงิน (+) / ออก (-):</span><span>฿${((parseFloat(drawer.cashIn) || 0) - (parseFloat(drawer.cashOut) || 0)).toFixed(2)}</span></div>
        <div class="row"><span>ส่งเซฟกลางกะ (-):</span><span>-฿${parseFloat(drawer.cashDrop || 0).toFixed(2)}</span></div>
        <div class="line"></div>
        <div class="row bold" style="font-size:12px;"><span>เงินสดคาดการณ์:</span><span>฿${parseFloat(drawer.expectedCash || 0).toFixed(2)}</span></div>
        <div class="row bold" style="font-size:12px;"><span>เงินสดนับได้จริง:</span><span>฿${parseFloat(drawer.actualCash || 0).toFixed(2)}</span></div>
        <div class="row"><span>ผลต่าง:</span><span class="bold">${varText}</span></div>
        <div class="double-line"></div>
        <div class="row bold"><span>เงินสดส่งเซฟปิดกะ:</span><span>฿${parseFloat(drawer.finalDrop || 0).toFixed(2)}</span></div>
        <div class="row bold"><span>เงินทอนยกไปกะถัดไป:</span><span>฿${parseFloat(drawer.carryForward || 0).toFixed(2)}</span></div>
        ${denomRows ? `<div class="line"></div><div class="bold" style="font-size:10px; margin-bottom:2px;">รายละเอียดธนบัตร/เหรียญ:</div>${denomRows}` : ''}
        ${drawer.note ? `<div class="line"></div><div style="font-size:10px;">หมายเหตุ: ${escapeHtml(drawer.note)}</div>` : ''}
        <div class="line"></div>
        <div style="margin-top:16px; display:flex; justify-content:space-between; font-size:10px; text-align:center;">
          <div>........................<br>ผู้ส่งมอบเงิน (แคชเชียร์)</div>
          <div>........................<br>ผู้รับมอบเงิน / ผจก.</div>
        </div>
      </body>
      </html>
    `;

    PrintManager.printHtmlDocument(html);
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SalesModule;
}
