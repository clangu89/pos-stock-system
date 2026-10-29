/**
 * reports.js - Analytics Dashboard, Daily Summaries, Top Sellers, Valuation, and Receipt History / Reprint
 */

const ReportsModule = {
  branches: [],
  activeBranchId: '',
  currentTab: 'overview',
  activeDetailReceipt: null,
  cachedReceipts: [],

  async activate() {
    this.setDefaultDates();
    await this.loadBranches();
    if (this.currentTab === 'receipts') {
      await this.fetchReceipts();
    } else {
      await this.generateReport();
    }
  },

  switchTab(tabName) {
    this.currentTab = tabName;

    const btnOverview = document.getElementById('reportsTabBtn_overview');
    const btnReceipts = document.getElementById('reportsTabBtn_receipts');
    const contentOverview = document.getElementById('reportsTab_overview');
    const contentReceipts = document.getElementById('reportsTab_receipts');

    if (tabName === 'receipts') {
      if (btnOverview) btnOverview.className = 'reports-tab-btn px-4 py-2.5 rounded-xl font-bold text-xs bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 transition cursor-pointer';
      if (btnReceipts) btnReceipts.className = 'reports-tab-btn px-4 py-2.5 rounded-xl font-bold text-xs bg-blue-600 text-white shadow-md transition cursor-pointer';
      if (contentOverview) contentOverview.classList.add('hidden');
      if (contentReceipts) contentReceipts.classList.remove('hidden');

      if (!this.cachedReceipts || this.cachedReceipts.length === 0) {
        this.fetchReceipts();
      }
    } else {
      if (btnOverview) btnOverview.className = 'reports-tab-btn px-4 py-2.5 rounded-xl font-bold text-xs bg-amber-600 text-white shadow-md transition cursor-pointer';
      if (btnReceipts) btnReceipts.className = 'reports-tab-btn px-4 py-2.5 rounded-xl font-bold text-xs bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 transition cursor-pointer';
      if (contentOverview) contentOverview.classList.remove('hidden');
      if (contentReceipts) contentReceipts.classList.add('hidden');
    }
  },

  // วันที่ท้องถิ่น (yyyy-MM-dd) — ห้ามใช้ toISOString() เพราะเป็นเวลา UTC ทำให้ช่วง 00:00-06:59 น. (เวลาไทย)
  // วันที่สิ้นสุดกลายเป็น "เมื่อวาน" และยอดขายวันนี้หายจากรายงาน
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

      const recSelect = document.getElementById('receiptBranchSelect');
      if (recSelect) recSelect.innerHTML = optionsHtml;
    }
  },

  // ================= TAB 1: OVERVIEW & ANALYTICS =================

  async generateReport() {
    const startDate = document.getElementById('reportStartDate')?.value || '';
    const endDate = document.getElementById('reportEndDate')?.value || '';
    const branchId = document.getElementById('reportBranchSelect')?.value || '';

    UI.showLoading('กำลังคำนวณรายงาน...');

    // Parallel fetch reports
    const [dailyRes, topRes, valRes] = await Promise.all([
      Api.call('reports:daily', { startDate, endDate, branchId }),
      Api.call('reports:topSelling', { startDate, endDate, branchId }),
      Api.call('reports:stockValuation', { branchId })
    ]);

    UI.hideLoading();

    if (dailyRes && dailyRes.ok && dailyRes.data) {
      this.renderSummaryCards(dailyRes.data.summary);
      this.renderDailyTable(dailyRes.data.dailyList);
    }

    if (topRes && topRes.ok && topRes.data) {
      this.renderTopSellingTable(topRes.data);
    }

    if (valRes && valRes.ok && valRes.data) {
      this.renderValuationCards(valRes.data);
    }
  },

  renderSummaryCards(sum) {
    if (!sum) return;
    document.getElementById('repTotalSales').textContent = `฿${(sum.totalSales || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    document.getElementById('repTotalProfit').textContent = `฿${(sum.totalProfit || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    document.getElementById('repTotalBills').textContent = `${(sum.totalBills || 0).toLocaleString()} บิล`;
    document.getElementById('repCashRatio').textContent = `เงินสด: ฿${(sum.cashSales || 0).toFixed(0)} | โอน: ฿${(sum.transferSales || 0).toFixed(0)}`;

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

    tbody.innerHTML = list.reverse().map(d => `
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
        <td class="py-2.5 px-3 font-bold">${item.name} <small class="text-slate-400 font-mono">(${item.sku})</small></td>
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
  },

  // ================= TAB 2: RECEIPTS & REPRINT =================

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

      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition ${isVoid ? 'bg-rose-50/20' : ''}">
          <td class="py-3 px-3 text-slate-600 font-mono text-[11px] whitespace-nowrap">${formattedDate}</td>
          <td class="py-3 px-3 font-mono font-bold ${isVoid ? 'text-rose-600 line-through' : 'text-blue-600'}">${escapeHtml(r.receiptNo)}</td>
          <td class="py-3 px-3 text-slate-700 whitespace-nowrap">${escapeHtml(branchName)}</td>
          <td class="py-3 px-3 text-slate-700 whitespace-nowrap">${escapeHtml(r.cashierName || r.userId || '-')}</td>
          <td class="py-3 px-3 text-slate-600 whitespace-nowrap">${payMethodLabel}</td>
          <td class="py-3 px-3 text-right font-mono font-black ${isVoid ? 'text-slate-400 line-through' : 'text-slate-900'}">฿${(parseFloat(r.total) || 0).toFixed(2)}</td>
          <td class="py-3 px-3 text-center whitespace-nowrap">${statusBadge}</td>
          <td class="py-3 px-3 text-center whitespace-nowrap">
            <div class="flex items-center justify-center gap-1.5">
              <button onclick="ReportsModule.openReceiptDetail('${escapeHtml(r.receiptNo)}')"
                      title="ดูรายละเอียดบิล"
                      class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] transition flex items-center gap-1 cursor-pointer">
                <span>🔍</span> <span>รายละเอียด</span>
              </button>
              <button onclick="ReportsModule.reprintReceipt('${escapeHtml(r.receiptNo)}')"
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

        return `
          <tr class="hover:bg-slate-50">
            <td class="py-2 px-2.5 font-mono text-slate-400">${idx + 1}</td>
            <td class="py-2 px-2.5 font-bold text-slate-800">
              ${escapeHtml(it.name || it.sku)}
              <div class="text-[10px] text-slate-400 font-mono font-normal">SKU: ${escapeHtml(it.sku || '-')}</div>
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
    // ปิดหน้าต่างรายละเอียดบิล เพื่อสลับมาแสดงหน้าต่างตัวอย่างใบเสร็จอย่างชัดเจน
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
