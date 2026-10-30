/**
 * reports.js - Analytics Dashboard, Daily Summaries, Top Sellers, Stock Valuation, Low Stock Alerts, and Receipt History / Reprint
 */

const ReportsModule = {
  branches: [],
  activeBranchId: '',
  currentTab: 'overview',
  activeDetailReceipt: null,
  cachedReceipts: [],
  cachedDailyList: [],
  cachedTopSelling: [],
  cachedValuation: null,

  async activate() {
    this.setDefaultDates();
    await this.loadBranches();
    if (this.currentTab === 'receipts') {
      await this.fetchReceipts();
    } else if (this.currentTab === 'stock') {
      await this.fetchStockValuation();
    } else {
      await this.generateReport();
    }
  },

  switchTab(tabName) {
    this.currentTab = tabName;

    const btnOverview = document.getElementById('reportsTabBtn_overview');
    const btnStock = document.getElementById('reportsTabBtn_stock');
    const btnReceipts = document.getElementById('reportsTabBtn_receipts');
    const contentOverview = document.getElementById('reportsTab_overview');
    const contentStock = document.getElementById('reportsTab_stock');
    const contentReceipts = document.getElementById('reportsTab_receipts');

    const activeClasses = 'reports-tab-btn px-4 py-2.5 rounded-xl font-bold text-xs bg-amber-600 text-white shadow-md transition cursor-pointer';
    const inactiveClasses = 'reports-tab-btn px-4 py-2.5 rounded-xl font-bold text-xs bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 transition cursor-pointer';

    if (btnOverview) btnOverview.className = (tabName === 'overview') ? activeClasses : inactiveClasses;
    if (btnStock) btnStock.className = (tabName === 'stock') ? activeClasses : inactiveClasses;
    if (btnReceipts) btnReceipts.className = (tabName === 'receipts') ? 'reports-tab-btn px-4 py-2.5 rounded-xl font-bold text-xs bg-blue-600 text-white shadow-md transition cursor-pointer' : inactiveClasses;

    if (contentOverview) contentOverview.classList.toggle('hidden', tabName !== 'overview');
    if (contentStock) contentStock.classList.toggle('hidden', tabName !== 'stock');
    if (contentReceipts) contentReceipts.classList.toggle('hidden', tabName !== 'receipts');

    if (tabName === 'receipts') {
      if (!this.cachedReceipts || this.cachedReceipts.length === 0) {
        this.fetchReceipts();
      }
    } else if (tabName === 'stock') {
      if (!this.cachedValuation) {
        this.fetchStockValuation();
      }
    } else {
      if (!this.cachedDailyList || this.cachedDailyList.length === 0) {
        this.generateReport();
      }
    }
  },

  formatLocalDate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  },

  setDefaultDates() {
    const today = new Date();
    const past = new Date(Date.now() - 30 * 86400000);

    const format = d => this.formatLocalDate(d);
    const startEl = document.getElementById('reportStartDate');
    const endEl = document.getElementById('reportEndDate');
    if (startEl && !startEl.value) startEl.value = format(past);
    if (endEl && !endEl.value) endEl.value = format(today);

    const recStartEl = document.getElementById('receiptStartDate');
    const recEndEl = document.getElementById('receiptEndDate');
    if (recStartEl && !recStartEl.value) recStartEl.value = format(past);
    if (recEndEl && !recEndEl.value) recEndEl.value = format(today);
  },

  async loadBranches() {
    const res = await Api.call('admin:branches');
    if (res && res.ok && res.branches) {
      this.branches = res.branches;
      const optionsHtml = '<option value="">ทุกสาขา</option>' + this.branches.map(b => `
        <option value="${b.branchId}">${b.name}</option>
      `).join('');

      const repSelect = document.getElementById('reportBranchSelect');
      if (repSelect) repSelect.innerHTML = optionsHtml;

      const valSelect = document.getElementById('reportStockValuationBranchSelect');
      if (valSelect) valSelect.innerHTML = optionsHtml;

      const recSelect = document.getElementById('receiptBranchSelect');
      if (recSelect) recSelect.innerHTML = optionsHtml;
    }
  },

  // ================= CSV EXPORT UTILITY =================

  downloadCsv(filename, headers, rows) {
    const escapeCol = val => {
      const s = val === null || val === undefined ? '' : String(val);
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const content = [
      headers.map(escapeCol).join(','),
      ...rows.map(row => row.map(escapeCol).join(','))
    ].join('\r\n');

    // \uFEFF for UTF-8 BOM so Thai characters open cleanly in MS Excel
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // ================= TAB 1: OVERVIEW & ANALYTICS =================

  async generateReport() {
    const startDate = document.getElementById('reportStartDate')?.value || '';
    const endDate = document.getElementById('reportEndDate')?.value || '';
    const branchId = document.getElementById('reportBranchSelect')?.value || '';

    UI.showLoading('กำลังคำนวณรายงานยอดขาย...');

    const [dailyRes, topRes, valRes] = await Promise.all([
      Api.call('reports:daily', { startDate, endDate, branchId }),
      Api.call('reports:topSelling', { startDate, endDate, branchId }),
      Api.call('reports:stockValuation', { branchId })
    ]);

    UI.hideLoading();

    if (dailyRes && dailyRes.ok && dailyRes.data) {
      this.cachedDailyList = dailyRes.data.dailyList || [];
      this.renderSummaryCards(dailyRes.data.summary);
      this.renderDailyTable(this.cachedDailyList);
    }

    if (topRes && topRes.ok && topRes.data) {
      this.cachedTopSelling = topRes.data || [];
      this.renderTopSellingTable(this.cachedTopSelling);
    }

    if (valRes && valRes.ok && valRes.data) {
      this.cachedValuation = valRes.data;
      this.renderValuationCards(valRes.data);
    }
  },

  renderSummaryCards(sum) {
    if (!sum) return;
    const elSales = document.getElementById('repTotalSales');
    const elProfit = document.getElementById('repTotalProfit');
    const elBills = document.getElementById('repTotalBills');
    const elRatio = document.getElementById('repCashRatio');

    if (elSales) elSales.textContent = `฿${(sum.totalSales || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (elProfit) elProfit.textContent = `฿${(sum.totalProfit || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (elBills) elBills.textContent = `${(sum.totalBills || 0).toLocaleString()} บิล`;
    if (elRatio) elRatio.textContent = `เงินสด: ฿${(sum.cashSales || 0).toFixed(0)} | โอน: ฿${(sum.transferSales || 0).toFixed(0)}`;

    const voidEl = document.getElementById('repVoidInfo');
    if (voidEl) {
      voidEl.textContent = `ยกเลิก: ${(sum.voidBills || 0).toLocaleString()} บิล (฿${(sum.voidAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })})`;
    }

    const scopeEl = document.getElementById('repScopeInfo');
    if (scopeEl) {
      const select = document.getElementById('reportBranchSelect');
      const branchLabel = select && select.value
        ? (select.options[select.selectedIndex]?.textContent.trim() || select.value)
        : 'ทุกสาขา';
      const s = document.getElementById('reportStartDate')?.value || '';
      const e = document.getElementById('reportEndDate')?.value || '';
      scopeEl.textContent = `${branchLabel} | ${s} ถึง ${e} (ไม่รวมบิลที่ยกเลิก)`;
    }
  },

  renderDailyTable(list = []) {
    const tbody = document.getElementById('reportDailyTableBody');
    if (!tbody) return;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-400">ไม่มียอดขายในช่วงเวลาที่เลือก</td></tr>`;
      return;
    }

    tbody.innerHTML = [...list].reverse().map(d => `
      <tr class="border-b border-slate-100 hover:bg-slate-50 text-sm">
        <td class="py-2.5 px-3 font-mono font-bold">${d.date}</td>
        <td class="py-2.5 px-3 text-center">${d.billsCount}</td>
        <td class="py-2.5 px-3 text-right font-mono">฿${d.subtotal.toFixed(2)}</td>
        <td class="py-2.5 px-3 text-right font-mono text-rose-500">${d.discount > 0 ? `-฿${d.discount.toFixed(2)}` : '-'}</td>
        <td class="py-2.5 px-3 text-right font-mono font-bold text-blue-600">฿${d.total.toFixed(2)}</td>
        <td class="py-2.5 px-3 text-right font-mono font-bold text-emerald-600">฿${d.profit.toFixed(2)}</td>
      </tr>
    `).join('');
  },

  renderTopSellingTable(list = []) {
    const tbody = document.getElementById('reportTopSellingTableBody');
    if (!tbody) return;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-slate-400">ไม่พบข้อมูลสินค้าขายดี</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((item, idx) => `
      <tr class="border-b border-slate-100 hover:bg-slate-50 text-sm">
        <td class="py-2.5 px-3 font-mono font-bold text-center">${idx + 1}</td>
        <td class="py-2.5 px-3 font-bold">${typeof escapeHtml === 'function' ? escapeHtml(item.name) : item.name} <small class="text-slate-400 font-mono">(${item.sku})</small></td>
        <td class="py-2.5 px-3 text-center font-bold">${item.qtySold}</td>
        <td class="py-2.5 px-3 text-right font-mono font-bold text-blue-600">฿${item.totalRevenue.toFixed(2)}</td>
        <td class="py-2.5 px-3 text-right font-mono font-bold text-emerald-600">฿${item.profit.toFixed(2)}</td>
      </tr>
    `).join('');
  },

  renderValuationCards(val) {
    if (!val) return;
    const elUnits = document.getElementById('valTotalUnits');
    const elCost = document.getElementById('valTotalCost');
    const elRetail = document.getElementById('valTotalRetail');
    const elLow = document.getElementById('valLowStockCount');

    if (elUnits) elUnits.textContent = `${(val.totalUnits || 0).toLocaleString()} ชิ้น (${val.totalSkus || 0} รายการ)`;
    if (elCost) elCost.textContent = `฿${(val.totalCostValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (elRetail) elRetail.textContent = `฿${(val.totalRetailValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (elLow) elLow.textContent = `${val.lowStockCount || 0} รายการ`;

    // Also populate Stock Tab specific elements if present
    const sUnits = document.getElementById('repStockUnits');
    const sCost = document.getElementById('repStockCost');
    const sRetail = document.getElementById('repStockRetail');
    const sProfit = document.getElementById('repStockProfit');
    const sLow = document.getElementById('repStockLowCount');

    if (sUnits) sUnits.textContent = `${(val.totalUnits || 0).toLocaleString()} ชิ้น (${val.totalSkus || 0} รายการ)`;
    if (sCost) sCost.textContent = `฿${(val.totalCostValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (sRetail) sRetail.textContent = `฿${(val.totalRetailValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (sProfit) sProfit.textContent = `฿${((val.totalRetailValue || 0) - (val.totalCostValue || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (sLow) sLow.textContent = `${(val.lowStockCount || 0).toLocaleString()} รายการ`;
  },

  exportDailySalesCsv() {
    if (!this.cachedDailyList || this.cachedDailyList.length === 0) {
      UI.showToast('ไม่พบข้อมูลยอดขายรายวันสำหรับส่งออก', 'warning');
      return;
    }
    const headers = ['วันที่', 'จำนวนบิล', 'ยอดรวมก่อนลด (บาท)', 'ส่วนลด (บาท)', 'ยอดสุทธิ (บาท)', 'กำไรขั้นต้น (บาท)'];
    const rows = this.cachedDailyList.map(d => [
      d.date,
      d.billsCount,
      d.subtotal.toFixed(2),
      d.discount.toFixed(2),
      d.total.toFixed(2),
      d.profit.toFixed(2)
    ]);
    const filename = `daily-sales-${this.formatLocalDate(new Date())}.csv`;
    this.downloadCsv(filename, headers, rows);
    UI.showToast(`ส่งออกไฟล์ ${filename} เรียบร้อยแล้ว`, 'success');
  },

  exportTopSellingCsv() {
    if (!this.cachedTopSelling || this.cachedTopSelling.length === 0) {
      UI.showToast('ไม่พบข้อมูลสินค้าขายดีสำหรับส่งออก', 'warning');
      return;
    }
    const headers = ['อันดับ', 'รหัสสินค้า (SKU)', 'ชื่อสินค้า', 'จำนวนที่ขายได้', 'ยอดขายรวม (บาท)', 'กำไรขั้นต้น (บาท)'];
    const rows = this.cachedTopSelling.map((it, idx) => [
      idx + 1,
      it.sku,
      it.name,
      it.qtySold,
      it.totalRevenue.toFixed(2),
      it.profit.toFixed(2)
    ]);
    const filename = `top-selling-${this.formatLocalDate(new Date())}.csv`;
    this.downloadCsv(filename, headers, rows);
    UI.showToast(`ส่งออกไฟล์ ${filename} เรียบร้อยแล้ว`, 'success');
  },

  // ================= TAB 2: STOCK VALUATION & LOW STOCK =================

  async fetchStockValuation() {
    const branchId = document.getElementById('reportStockValuationBranchSelect')?.value || '';
    UI.showLoading('กำลังคำนวณมูลค่าสต๊อกสินค้า...');

    const res = await Api.call('reports:stockValuation', { branchId });
    UI.hideLoading();

    if (res && res.ok && res.data) {
      this.cachedValuation = res.data;
      this.renderValuationCards(res.data);
      this.renderLowStockTable(res.data.lowStockItems || []);
    } else {
      UI.showToast('ไม่สามารถดึงข้อมูลมูลค่าสต๊อกได้', 'error');
    }
  },

  renderLowStockTable(items = []) {
    const tbody = document.getElementById('reportLowStockTableBody');
    const badgeCount = document.getElementById('reportLowStockBadgeCount');
    if (badgeCount) badgeCount.textContent = items.length;
    if (!tbody) return;

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-emerald-600 font-bold">🎉 ไม่มีรายการสินค้าต่ำกว่าจุดสั่งซื้อขั้นต่ำ (สต๊อกอยู่ในเกณฑ์ปกติ)</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map((it, idx) => {
      const isOutOfStock = (parseFloat(it.qty) || 0) <= 0;
      const statusBadge = isOutOfStock
        ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-700 border border-rose-300">หมดสต๊อก</span>`
        : `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300">ใกล้หมด</span>`;

      return `
        <tr class="border-b border-slate-100 hover:bg-amber-50/40 text-xs transition">
          <td class="py-2.5 px-3 font-mono font-bold text-center text-slate-400">${idx + 1}</td>
          <td class="py-2.5 px-3 font-mono font-bold text-blue-700">${typeof escapeHtml === 'function' ? escapeHtml(it.sku) : it.sku}</td>
          <td class="py-2.5 px-3 font-mono text-slate-500">${typeof escapeHtml === 'function' ? escapeHtml(it.barcode || '-') : (it.barcode || '-')}</td>
          <td class="py-2.5 px-3 font-bold text-slate-800">${typeof escapeHtml === 'function' ? escapeHtml(it.name) : it.name}</td>
          <td class="py-2.5 px-3 text-center font-mono font-black ${isOutOfStock ? 'text-rose-600' : 'text-amber-600'}">
            ${it.qty} <span class="font-normal text-[10px] text-slate-400">${typeof escapeHtml === 'function' ? escapeHtml(it.unit || '') : (it.unit || '')}</span>
          </td>
          <td class="py-2.5 px-3 text-center font-mono text-slate-600">${it.minStock}</td>
          <td class="py-2.5 px-3 text-center">${statusBadge}</td>
        </tr>
      `;
    }).join('');
  },

  exportLowStockCsv() {
    const items = (this.cachedValuation && this.cachedValuation.lowStockItems) || [];
    if (items.length === 0) {
      UI.showToast('ไม่มีรายการสินค้าใกล้หมดสำหรับส่งออก', 'info');
      return;
    }
    const headers = ['ลำดับ', 'รหัสสินค้า (SKU)', 'บาร์โค้ด', 'ชื่อสินค้า', 'คงเหลือปัจจุบัน', 'หน่วยนับ', 'จุดสั่งซื้อขั้นต่ำ (Min Stock)', 'สถานะ'];
    const rows = items.map((it, idx) => [
      idx + 1,
      it.sku,
      it.barcode || '',
      it.name,
      it.qty,
      it.unit || '',
      it.minStock,
      (parseFloat(it.qty) || 0) <= 0 ? 'หมดสต๊อก' : 'ใกล้หมด'
    ]);
    const filename = `low-stock-alert-${this.formatLocalDate(new Date())}.csv`;
    this.downloadCsv(filename, headers, rows);
    UI.showToast(`ส่งออกไฟล์ ${filename} เรียบร้อยแล้ว`, 'success');
  },

  // ================= TAB 3: RECEIPTS & REPRINT =================

  async fetchReceipts() {
    const startDate = document.getElementById('receiptStartDate')?.value || '';
    const endDate = document.getElementById('receiptEndDate')?.value || '';
    const branchId = document.getElementById('receiptBranchSelect')?.value || '';
    const status = document.getElementById('receiptStatusSelect')?.value || '';
    const payMethod = document.getElementById('receiptPayMethodSelect')?.value || '';
    const search = document.getElementById('receiptSearchInput')?.value || '';

    const tbody = document.getElementById('receiptsTableBody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-slate-400">กำลังค้นหาใบเสร็จ...</td></tr>`;
    }
    const label = document.getElementById('receiptTableCountLabel');
    if (label) label.textContent = 'กำลังโหลด...';

    const res = await Api.call('reports:receipts', {
      startDate,
      endDate,
      branchId,
      status,
      payMethod,
      search,
      limit: 200
    });

    if (res && res.ok && res.data) {
      this.cachedReceipts = res.data.receipts || [];
      this.renderReceiptsSummary(res.data.summary);
      this.renderReceiptsTable(this.cachedReceipts);
    } else {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-rose-500">โหลดข้อมูลไม่สำเร็จ: ${res.error || res.message || 'เกิดข้อผิดพลาด'}</td></tr>`;
      }
      if (label) label.textContent = 'เกิดข้อผิดพลาด';
    }
  },

  resetReceiptFilters() {
    this.setDefaultDates();
    const branchSel = document.getElementById('receiptBranchSelect');
    if (branchSel) branchSel.value = '';
    const statusSel = document.getElementById('receiptStatusSelect');
    if (statusSel) statusSel.value = '';
    const paySel = document.getElementById('receiptPayMethodSelect');
    if (paySel) paySel.value = '';
    const searchInp = document.getElementById('receiptSearchInput');
    if (searchInp) searchInp.value = '';

    this.fetchReceipts();
  },

  renderReceiptsSummary(sum = {}) {
    const totalEl = document.getElementById('receiptSummaryTotal');
    const amountEl = document.getElementById('receiptSummaryAmount');
    const paidEl = document.getElementById('receiptSummaryPaid');
    const voidEl = document.getElementById('receiptSummaryVoid');
    const voidAmtEl = document.getElementById('receiptSummaryVoidAmount');

    if (totalEl) totalEl.textContent = (sum.totalBills || 0).toLocaleString();
    if (amountEl) amountEl.textContent = (sum.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (paidEl) paidEl.textContent = (sum.paidBills || 0).toLocaleString();
    if (voidEl) voidEl.textContent = (sum.voidBills || 0).toLocaleString();
    if (voidAmtEl) voidAmtEl.textContent = (sum.voidAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  renderReceiptsTable(receipts = []) {
    const tbody = document.getElementById('receiptsTableBody');
    const label = document.getElementById('receiptTableCountLabel');
    if (!tbody) return;

    if (label) {
      label.textContent = `แสดง ${receipts.length.toLocaleString()} รายการ`;
    }

    if (receipts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-slate-400">ไม่พบรายการใบเสร็จตามเงื่อนไขที่เลือก</td></tr>`;
      return;
    }

    tbody.innerHTML = receipts.map(r => {
      const isVoid = r.status === 'VOID';
      const formattedDate = r.ts
        ? new Date(r.ts).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'medium' })
        : '-';

      const payMethodLabel = r.payMethod === 'CASH' ? '💵 เงินสด' :
        r.payMethod === 'TRANSFER' ? '🏦 โอนเงิน' :
        r.payMethod === 'QR' ? '📱 QR Code' : `💳 ${r.payMethod || '-'}`;

      const statusBadge = isVoid
        ? `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-rose-50 text-rose-600 border border-rose-200">ยกเลิก (VOID)</span>`
        : `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-600 border border-emerald-200">ชำระแล้ว (PAID)</span>`;

      const branchName = this.getBranchName(r.branchId);
      const safeReceiptNo = typeof escapeHtml === 'function' ? escapeHtml(r.receiptNo) : r.receiptNo;
      const safeBranchName = typeof escapeHtml === 'function' ? escapeHtml(branchName) : branchName;
      const safeCashier = typeof escapeHtml === 'function' ? escapeHtml(r.cashierName || r.userId || '-') : (r.cashierName || r.userId || '-');

      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition ${isVoid ? 'bg-rose-50/20' : ''}">
          <td class="py-3 px-3 text-slate-600 font-mono text-[11px] whitespace-nowrap">${formattedDate}</td>
          <td class="py-3 px-3 font-mono font-bold ${isVoid ? 'text-rose-600 line-through' : 'text-blue-600'}">${safeReceiptNo}</td>
          <td class="py-3 px-3 text-slate-700 whitespace-nowrap">${safeBranchName}</td>
          <td class="py-3 px-3 text-slate-700 whitespace-nowrap">${safeCashier}</td>
          <td class="py-3 px-3 text-slate-600 whitespace-nowrap">${payMethodLabel}</td>
          <td class="py-3 px-3 text-right font-mono font-black ${isVoid ? 'text-slate-400 line-through' : 'text-slate-900'}">฿${(parseFloat(r.total) || 0).toFixed(2)}</td>
          <td class="py-3 px-3 text-center whitespace-nowrap">${statusBadge}</td>
          <td class="py-3 px-3 text-center whitespace-nowrap">
            <div class="flex items-center justify-center gap-1.5">
              <button onclick="ReportsModule.openReceiptDetail('${safeReceiptNo}')"
                      title="ดูรายละเอียดบิล"
                      class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] transition flex items-center gap-1 cursor-pointer">
                <span>🔍</span> <span>รายละเอียด</span>
              </button>
              <button onclick="ReportsModule.reprintReceipt('${safeReceiptNo}')"
                      title="พิมพ์ซ้ำใบเสร็จ"
                      class="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[11px] border border-blue-200 transition flex items-center gap-1 cursor-pointer">
                <span>🖨️</span> <span>พิมพ์ซ้ำ</span>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  exportReceiptsCsv() {
    if (!this.cachedReceipts || this.cachedReceipts.length === 0) {
      UI.showToast('ไม่พบข้อมูลใบเสร็จสำหรับส่งออก', 'warning');
      return;
    }
    const headers = ['วัน-เวลา', 'เลขที่ใบเสร็จ', 'สาขา', 'แคชเชียร์', 'ช่องทางชำระ', 'ยอดสุทธิ (บาท)', 'สถานะ', 'เหตุผลการยกเลิก'];
    const rows = this.cachedReceipts.map(r => {
      const formattedDate = r.ts
        ? new Date(r.ts).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'medium' })
        : '-';
      return [
        formattedDate,
        r.receiptNo,
        this.getBranchName(r.branchId),
        r.cashierName || r.userId || '-',
        r.payMethod || 'CASH',
        (parseFloat(r.total) || 0).toFixed(2),
        r.status || 'PAID',
        r.voidReason || ''
      ];
    });
    const filename = `receipts-history-${this.formatLocalDate(new Date())}.csv`;
    this.downloadCsv(filename, headers, rows);
    UI.showToast(`ส่งออกไฟล์ ${filename} เรียบร้อยแล้ว`, 'success');
  },

  getBranchName(branchId) {
    if (!branchId) return 'สาขาหลัก';
    const match = this.branches.find(b => b.branchId === branchId);
    return match ? match.name : branchId;
  },

  // ================= RECEIPT DETAIL MODAL & REPRINT =================

  async openReceiptDetail(receiptNo) {
    if (!receiptNo) return;
    UI.showLoading('กำลังโหลดรายละเอียดใบเสร็จ...');

    const res = await Api.call('sales:receipt', { receiptNo });
    UI.hideLoading();

    if (!res || !res.ok || !res.receipt) {
      UI.showToast('ไม่พบข้อมูลใบเสร็จที่ระบุ', 'error');
      return;
    }

    const { sale, items, store } = res.receipt;
    this.activeDetailReceipt = res.receipt;

    // 1. Meta
    document.getElementById('rdReceiptNo').textContent = sale.receiptNo || '-';
    document.getElementById('rdDate').textContent = sale.ts
      ? new Date(sale.ts).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'medium' })
      : '-';
    document.getElementById('rdBranch').textContent = this.getBranchName(sale.branchId);
    document.getElementById('rdCashier').textContent = sale.cashierName || sale.userId || '-';

    const payMethodText = sale.payMethod === 'CASH' ? '💵 เงินสด' :
      sale.payMethod === 'TRANSFER' ? '🏦 โอนเงิน / PromptPay' :
      sale.payMethod === 'QR' ? '📱 QR Code' : `💳 ${sale.payMethod || '-'}`;
    document.getElementById('rdPayMethod').textContent = payMethodText;

    // 2. VOID banner
    const voidBanner = document.getElementById('rdVoidBanner');
    const voidInfo = document.getElementById('rdVoidInfo');
    if (sale.status === 'VOID') {
      voidBanner.classList.remove('hidden');
      const voidDate = sale.voidAt ? new Date(sale.voidAt).toLocaleString('th-TH') : '-';
      voidInfo.textContent = `ยกเลิกโดย: ${sale.voidBy || '-'} เมื่อ ${voidDate} | เหตุผล: ${sale.voidReason || 'ไม่ได้ระบุเหตุผล'}`;
    } else {
      voidBanner.classList.add('hidden');
    }

    // 3. Items Table
    const itemsBody = document.getElementById('rdItemsBody');
    if (itemsBody) {
      itemsBody.innerHTML = (items || []).map((it, idx) => {
        const qty = parseFloat(it.qty) || 0;
        const price = parseFloat(it.unitPrice) || 0;
        const discount = parseFloat(it.discount) || 0;
        const parsedAmt = parseFloat(it.amount);
        const amount = isNaN(parsedAmt) ? Math.max(0, (qty * price) - discount) : parsedAmt;
        const safeName = typeof escapeHtml === 'function' ? escapeHtml(it.name || it.sku) : (it.name || it.sku);
        const safeSku = typeof escapeHtml === 'function' ? escapeHtml(it.sku || '-') : (it.sku || '-');

        return `
          <tr class="hover:bg-slate-50">
            <td class="py-2 px-2.5 font-mono text-slate-400">${idx + 1}</td>
            <td class="py-2 px-2.5 font-bold text-slate-800">
              ${safeName}
              <div class="text-[10px] text-slate-400 font-mono font-normal">SKU: ${safeSku}</div>
            </td>
            <td class="py-2 px-2 text-center font-mono font-bold">${qty}</td>
            <td class="py-2 px-2 text-right font-mono">฿${price.toFixed(2)}</td>
            <td class="py-2 px-2 text-right font-mono text-rose-500">${discount > 0 ? `-฿${discount.toFixed(2)}` : '-'}</td>
            <td class="py-2 px-2.5 text-right font-mono font-black text-slate-900">฿${amount.toFixed(2)}</td>
          </tr>
        `;
      }).join('');
    }

    // 4. Totals Calculation
    const subtotal = parseFloat(sale.subtotal) || 0;
    const discount = parseFloat(sale.discount) || 0;
    const vat = parseFloat(sale.vat) || 0;
    const total = parseFloat(sale.total) || 0;
    const received = parseFloat(sale.received) || 0;
    const change = parseFloat(sale.change) || 0;

    document.getElementById('rdSubtotal').textContent = `฿${subtotal.toFixed(2)}`;

    const discountRow = document.getElementById('rdDiscountRow');
    if (discountRow) {
      if (discount > 0) {
        discountRow.classList.remove('hidden');
        document.getElementById('rdDiscount').textContent = `-฿${discount.toFixed(2)}`;
      } else {
        discountRow.classList.add('hidden');
      }
    }

    const vatRow = document.getElementById('rdVatRow');
    if (vatRow) {
      if (vat > 0) {
        vatRow.classList.remove('hidden');
        document.getElementById('rdVat').textContent = `฿${vat.toFixed(2)}`;
      } else {
        vatRow.classList.add('hidden');
      }
    }

    document.getElementById('rdTotal').textContent = `฿${total.toFixed(2)}`;
    document.getElementById('rdReceived').textContent = `฿${received.toFixed(2)}`;
    document.getElementById('rdChange').textContent = `฿${change.toFixed(2)}`;

    UI.openModal('receiptDetailModal');
  },

  reprintActiveDetailReceipt() {
    if (!this.activeDetailReceipt || !this.activeDetailReceipt.sale) {
      UI.showToast('ไม่พบข้อมูลใบเสร็จสำหรับพิมพ์ซ้ำ', 'warning');
      return;
    }
    const { sale, items, store } = this.activeDetailReceipt;
    UI.closeModal('receiptDetailModal');
    PrintManager.previewReceiptModal(sale, items, store);
  },

  async reprintReceipt(receiptNo) {
    if (!receiptNo) return;
    UI.showLoading('กำลังโหลดข้อมูลใบเสร็จเพื่อพิมพ์ซ้ำ...');

    const res = await Api.call('sales:receipt', { receiptNo });
    UI.hideLoading();

    if (res && res.ok && res.receipt) {
      const { sale, items, store } = res.receipt;
      PrintManager.previewReceiptModal(sale, items, store);
    } else {
      UI.showToast('ไม่สามารถดึงข้อมูลใบเสร็จเพื่อพิมพ์ซ้ำได้', 'error');
    }
  }
};
