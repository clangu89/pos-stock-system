/**
 * finance.js - Complete Financial Operations, Petty Cash Ledger, Cash Reconciliation, and Daily Closing Slip
 */

const FinanceModule = {
  branches: [],
  currentTab: 'summary',
  cachedOverview: null,
  cachedTxns: [],
  cachedClosings: [],
  activeClosingPreview: null,
  activeClosingDetail: null,

  async activate() {
    this.setDefaultDates();
    await this.loadBranches();
    await this.switchTab(this.currentTab);
  },

  formatLocalDate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  },

  setDefaultDates() {
    const today = new Date();
    // Default to current month's 1st day to today
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

    const format = d => this.formatLocalDate(d);

    const finStart = document.getElementById('financeStartDate');
    const finEnd = document.getElementById('financeEndDate');
    if (finStart && !finStart.value) finStart.value = format(firstDay);
    if (finEnd && !finEnd.value) finEnd.value = format(today);

    const txStart = document.getElementById('financeTxnStartDate');
    const txEnd = document.getElementById('financeTxnEndDate');
    if (txStart && !txStart.value) txStart.value = format(firstDay);
    if (txEnd && !txEnd.value) txEnd.value = format(today);

    const closingDate = document.getElementById('closingDateInput');
    if (closingDate && !closingDate.value) closingDate.value = format(today);
  },

  async loadBranches() {
    const res = await Api.call('admin:branches');
    if (res && res.ok && res.branches) {
      this.branches = res.branches;
      const optionsHtml = '<option value="">ทุกสาขา</option>' + this.branches.map(b => `
        <option value="${b.branchId}">${b.name}</option>
      `).join('');

      const finBranch = document.getElementById('financeBranchSelect');
      if (finBranch) finBranch.innerHTML = optionsHtml;

      const txBranch = document.getElementById('financeTxnBranchFilter');
      if (txBranch) txBranch.innerHTML = optionsHtml;

      const closeBranch = document.getElementById('financeClosingBranchSelect');
      if (closeBranch) {
        // Closing must be for a specific branch (default to active branch or first branch)
        const activeBranchId = (window.Auth && window.Auth.activeBranch && window.Auth.activeBranch.branchId) || (this.branches[0] && this.branches[0].branchId) || 'B01';
        closeBranch.innerHTML = this.branches.map(b => `
          <option value="${b.branchId}" ${b.branchId === activeBranchId ? 'selected' : ''}>${b.name}</option>
        `).join('');
      }

      const modalBranch = document.getElementById('financeTxnModalBranch');
      if (modalBranch) {
        const activeBranchId = (window.Auth && window.Auth.activeBranch && window.Auth.activeBranch.branchId) || (this.branches[0] && this.branches[0].branchId) || 'B01';
        modalBranch.innerHTML = this.branches.map(b => `
          <option value="${b.branchId}" ${b.branchId === activeBranchId ? 'selected' : ''}>${b.name}</option>
        `).join('');
      }
    }
  },

  getBranchName(branchId) {
    if (!branchId) return 'สาขาหลัก';
    const match = this.branches.find(b => b.branchId === branchId);
    return match ? match.name : branchId;
  },

  async switchTab(tabName) {
    this.currentTab = tabName;

    const btnSummary = document.getElementById('financeTabBtn_summary');
    const btnLedger = document.getElementById('financeTabBtn_ledger');
    const btnClosing = document.getElementById('financeTabBtn_closing');

    const contentSummary = document.getElementById('financeTab_summary');
    const contentLedger = document.getElementById('financeTab_ledger');
    const contentClosing = document.getElementById('financeTab_closing');

    const activeClasses = 'finance-tab-btn px-4 py-2.5 rounded-xl font-bold text-xs bg-purple-600 text-white shadow-md transition cursor-pointer';
    const inactiveClasses = 'finance-tab-btn px-4 py-2.5 rounded-xl font-bold text-xs bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 transition cursor-pointer';

    if (btnSummary) btnSummary.className = (tabName === 'summary') ? activeClasses : inactiveClasses;
    if (btnLedger) btnLedger.className = (tabName === 'ledger') ? activeClasses : inactiveClasses;
    if (btnClosing) btnClosing.className = (tabName === 'closing') ? activeClasses : inactiveClasses;

    if (contentSummary) contentSummary.classList.toggle('hidden', tabName !== 'summary');
    if (contentLedger) contentLedger.classList.toggle('hidden', tabName !== 'ledger');
    if (contentClosing) contentClosing.classList.toggle('hidden', tabName !== 'closing');

    if (tabName === 'summary') {
      await this.fetchSummary();
    } else if (tabName === 'ledger') {
      await this.fetchTxns();
    } else if (tabName === 'closing') {
      await this.loadClosingPreview();
      await this.fetchClosingHistory();
    }
  },

  // ================= CSV DOWNLOAD UTILITY =================

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

  // ================= TAB 1: CASH FLOW & PROFIT OVERVIEW =================

  async fetchSummary() {
    const startDate = document.getElementById('financeStartDate')?.value || '';
    const endDate = document.getElementById('financeEndDate')?.value || '';
    const branchId = document.getElementById('financeBranchSelect')?.value || '';

    UI.showLoading('กำลังคำนวณข้อมูลการเงินและกระแสเงินสด...');

    const res = await Api.call('finance:overview', { startDate, endDate, branchId });
    UI.hideLoading();

    if (res && res.ok && res.data) {
      this.cachedOverview = res.data;
      const sum = res.data.summary || {
        ...(res.data.sales || {}),
        ...(res.data.ledger || {}),
        ...(res.data.net || {}),
        totalIncome: (res.data.ledger && res.data.ledger.otherIncomeTotal) || 0,
        totalExpense: (res.data.ledger && res.data.ledger.expenseTotal) || 0
      };
      this.renderSummaryCards(sum);
      this.renderDailyFlowTable(res.data.dailyFlow || []);
      this.renderExpenseCategoryTable(res.data.expenseByCategory || []);
    } else {
      UI.showToast(res.error || 'ไม่สามารถโหลดข้อมูลการเงินได้', 'error');
    }
  },

  renderSummaryCards(sum = {}) {
    // 1. Sales & Inflow
    const elSales = document.getElementById('finCardTotalSales');
    const elSalesBreakdown = document.getElementById('finCardSalesBreakdown');
    if (elSales) elSales.textContent = `฿${(sum.totalSales || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (elSalesBreakdown) {
      elSalesBreakdown.textContent = `เงินสด: ฿${(sum.cashSales || 0).toFixed(0)} | โอน: ฿${(sum.transferSales || 0).toFixed(0)} | QR: ฿${(sum.qrSales || 0).toFixed(0)}`;
    }

    // 2. Petty Cash Income & Expense
    const elIncome = document.getElementById('finCardTotalIncome');
    const elExpense = document.getElementById('finCardTotalExpense');
    if (elIncome) elIncome.textContent = `฿${(sum.totalIncome || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (elExpense) elExpense.textContent = `฿${(sum.totalExpense || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    // 3. Net Cash Flow
    const elCashFlow = document.getElementById('finCardNetCashFlow');
    const elCashFlowBreakdown = document.getElementById('finCardCashFlowBreakdown');
    if (elCashFlow) {
      const net = sum.totalNetCashFlow || 0;
      elCashFlow.textContent = `${net >= 0 ? '+' : ''}฿${net.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      elCashFlow.className = `text-2xl font-black font-mono ${net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;
    }
    if (elCashFlowBreakdown) {
      elCashFlowBreakdown.textContent = `เงินสดสุทธิ: ฿${(sum.netCashInflow || 0).toFixed(0)} | บัญชีธนาคาร: ฿${(sum.netBankInflow || 0).toFixed(0)}`;
    }

    // 4. Net Operating Profit
    const elOperatingProfit = document.getElementById('finCardNetProfit');
    const elGrossProfit = document.getElementById('finCardGrossProfit');
    if (elOperatingProfit) {
      const profit = sum.netOperatingProfit || 0;
      elOperatingProfit.textContent = `${profit >= 0 ? '+' : ''}฿${profit.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      elOperatingProfit.className = `text-2xl font-black font-mono ${profit >= 0 ? 'text-purple-600' : 'text-rose-600'}`;
    }
    if (elGrossProfit) {
      elGrossProfit.textContent = `กำไรขั้นต้น: ฿${(sum.grossProfit || 0).toFixed(2)} (หัก คชจ. หน้าร้าน ฿${(sum.totalExpense || 0).toFixed(2)})`;
    }
  },

  renderDailyFlowTable(list = []) {
    const tbody = document.getElementById('financeDailyFlowTableBody');
    if (!tbody) return;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-slate-400">ไม่พบข้อมูลกระแสเงินสดในช่วงเวลาที่เลือก</td></tr>`;
      return;
    }

    tbody.innerHTML = [...list].reverse().map(d => {
      const net = d.netCashFlow !== undefined ? d.netCashFlow : (d.netFlow || 0);
      const income = d.income !== undefined ? d.income : (d.otherIncome || 0);
      const transfer = d.transferSales || 0;
      const qr = d.qrSales || 0;
      const bankSales = (transfer + qr) || (d.bankSales || 0);
      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50 text-xs">
          <td class="py-2.5 px-3 font-mono font-bold">${d.date}</td>
          <td class="py-2.5 px-3 text-right font-mono text-emerald-700">฿${(d.cashSales || 0).toFixed(2)}</td>
          <td class="py-2.5 px-3 text-right font-mono text-blue-700">฿${bankSales.toFixed(2)}</td>
          <td class="py-2.5 px-3 text-right font-mono text-teal-600">${income > 0 ? `+฿${income.toFixed(2)}` : '-'}</td>
          <td class="py-2.5 px-3 text-right font-mono text-rose-500">${d.expense > 0 ? `-฿${(d.expense || 0).toFixed(2)}` : '-'}</td>
          <td class="py-2.5 px-3 text-right font-mono font-black ${net >= 0 ? 'text-slate-800' : 'text-rose-600'}">
            ${net >= 0 ? '+' : ''}฿${net.toFixed(2)}
          </td>
          <td class="py-2.5 px-3 text-center">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${net >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}">
              ${net >= 0 ? 'กระแสเงินบวก' : 'กระแสเงินติดลบ'}
            </span>
          </td>
        </tr>
      `;
    }).join('');
  },

  renderExpenseCategoryTable(catData) {
    const tbody = document.getElementById('financeExpenseCategoryTableBody');
    if (!tbody) return;

    let list = [];
    if (Array.isArray(catData)) {
      list = catData;
    } else if (catData && typeof catData === 'object') {
      const entries = Object.entries(catData);
      const total = entries.reduce((acc, [, val]) => acc + (parseFloat(val) || 0), 0);
      list = entries.map(([category, amount]) => ({
        category,
        totalAmount: parseFloat(amount) || 0,
        percent: total > 0 ? (parseFloat(amount) / total) * 100 : 0
      })).sort((a, b) => b.totalAmount - a.totalAmount);
    }

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="text-center py-6 text-slate-400">ไม่มีรายการค่าใช้จ่ายในช่วงเวลาที่เลือก</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(item => {
      const safeCat = typeof escapeHtml === 'function' ? escapeHtml(item.category) : item.category;
      const amt = parseFloat(item.totalAmount) || 0;
      const pct = (parseFloat(item.percent) || 0).toFixed(1);
      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50 text-xs">
          <td class="py-2 px-3 font-bold text-slate-700">${safeCat}</td>
          <td class="py-2 px-3 text-right font-mono font-bold text-rose-600">฿${amt.toFixed(2)}</td>
          <td class="py-2 px-3 text-right font-mono text-slate-500">${pct}%</td>
        </tr>
      `;
    }).join('');
  },

  exportDailyFlowCsv() {
    const list = (this.cachedOverview && this.cachedOverview.dailyFlow) || [];
    if (list.length === 0) {
      UI.showToast('ไม่พบข้อมูลกระแสเงินสดสำหรับส่งออก', 'warning');
      return;
    }
    const headers = ['วันที่', 'ยอดขายเงินสด (บาท)', 'ยอดขายโอนเงิน (บาท)', 'ยอดขาย QR (บาท)', 'รายรับอื่น (บาท)', 'รายจ่ายหน้าร้าน (บาท)', 'กระแสเงินสดสุทธิ (บาท)'];
    const rows = list.map(d => {
      const net = d.netCashFlow !== undefined ? d.netCashFlow : (d.netFlow || 0);
      const income = d.income !== undefined ? d.income : (d.otherIncome || 0);
      return [
        d.date,
        (d.cashSales || 0).toFixed(2),
        (d.transferSales || 0).toFixed(2),
        (d.qrSales || 0).toFixed(2),
        income.toFixed(2),
        (d.expense || 0).toFixed(2),
        net.toFixed(2)
      ];
    });
    const filename = `daily-cashflow-${this.formatLocalDate(new Date())}.csv`;
    this.downloadCsv(filename, headers, rows);
    UI.showToast(`ส่งออกไฟล์ ${filename} เรียบร้อยแล้ว`, 'success');
  },

  // ================= TAB 2: PETTY CASH & EXPENSE LEDGER =================

  async fetchTxns() {
    const startDate = document.getElementById('financeTxnStartDate')?.value || '';
    const endDate = document.getElementById('financeTxnEndDate')?.value || '';
    const branchId = document.getElementById('financeTxnBranchFilter')?.value || '';
    const type = document.getElementById('financeTxnTypeFilter')?.value || '';
    const payMethod = document.getElementById('financeTxnPayMethodFilter')?.value || '';
    const search = document.getElementById('financeTxnSearchInput')?.value || '';

    const tbody = document.getElementById('financeTxnsTableBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-slate-400">กำลังค้นหารายการบัญชี...</td></tr>`;

    const res = await Api.call('finance:txns', { startDate, endDate, branchId, type, payMethod, search });
    if (res && res.ok && res.data) {
      this.cachedTxns = res.data.txns || [];
      this.renderTxnsSummary(res.data.summary);
      this.renderTxnsTable(this.cachedTxns);
    } else {
      if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-rose-500">โหลดข้อมูลไม่สำเร็จ: ${res.error || 'เกิดข้อผิดพลาด'}</td></tr>`;
    }
  },

  renderTxnsSummary(sum = {}) {
    const elIn = document.getElementById('finTxnSumIncome');
    const elOut = document.getElementById('finTxnSumExpense');
    const elNet = document.getElementById('finTxnSumNet');
    const elCount = document.getElementById('finTxnCountLabel');

    if (elIn) elIn.textContent = `+฿${(sum.totalIncome || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (elOut) elOut.textContent = `-฿${(sum.totalExpense || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (elNet) {
      const net = (sum.totalIncome || 0) - (sum.totalExpense || 0);
      elNet.textContent = `${net >= 0 ? '+' : ''}฿${net.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      elNet.className = `font-mono font-black ${net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;
    }
    if (elCount) elCount.textContent = `แสดง ${(sum.validCount || 0).toLocaleString()} รายการ`;
  },

  renderTxnsTable(txns = []) {
    const tbody = document.getElementById('financeTxnsTableBody');
    if (!tbody) return;

    if (txns.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center py-10 text-slate-400">ไม่พบรายการรายรับ-รายจ่ายตามเงื่อนไขที่เลือก</td></tr>`;
      return;
    }

    tbody.innerHTML = txns.map(t => {
      const isVoid = t.status === 'VOID';
      const isExpense = t.type === 'EXPENSE';
      const typeBadge = isExpense
        ? `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-200">รายจ่าย</span>`
        : `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200">รายรับ</span>`;

      const payMethodLabel = t.payMethod === 'CASH' ? '💵 เงินสด' : '🏦 โอนเงิน';
      const branchName = this.getBranchName(t.branchId);

      const statusBadge = isVoid
        ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-rose-600 line-through">ยกเลิกแล้ว</span>`
        : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">ปกติ</span>`;

      const safeTxnId = typeof escapeHtml === 'function' ? escapeHtml(t.txnId) : t.txnId;
      const safeCategory = typeof escapeHtml === 'function' ? escapeHtml(t.category) : t.category;
      const safeDesc = typeof escapeHtml === 'function' ? escapeHtml(t.description || t.refDoc || '-') : (t.description || t.refDoc || '-');
      const safeUser = typeof escapeHtml === 'function' ? escapeHtml(t.userName || t.userId || '-') : (t.userName || t.userId || '-');

      const canVoid = window.Auth && window.Auth.hasPerm('finance', 'void');
      const actionBtn = (!isVoid && canVoid)
        ? `<button onclick="FinanceModule.voidTxn('${safeTxnId}')" class="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-[10px] border border-rose-200 transition cursor-pointer">ยกเลิก</button>`
        : `<span class="text-slate-300">-</span>`;

      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50 text-xs transition ${isVoid ? 'bg-rose-50/20 opacity-60' : ''}">
          <td class="py-2.5 px-3 font-mono text-slate-600">${t.txDate || '-'}</td>
          <td class="py-2.5 px-3 font-mono font-bold ${isVoid ? 'line-through text-slate-400' : 'text-purple-700'}">${safeTxnId}</td>
          <td class="py-2.5 px-3 whitespace-nowrap">${branchName}</td>
          <td class="py-2.5 px-3 text-center">${typeBadge}</td>
          <td class="py-2.5 px-3 font-bold text-slate-800">${safeCategory}</td>
          <td class="py-2.5 px-3 text-center whitespace-nowrap">${payMethodLabel}</td>
          <td class="py-2.5 px-3 text-right font-mono font-black ${isVoid ? 'line-through text-slate-400' : (isExpense ? 'text-rose-600' : 'text-emerald-600')}">
            ${isExpense ? '-' : '+'}฿${(parseFloat(t.amount) || 0).toFixed(2)}
          </td>
          <td class="py-2.5 px-3 text-slate-500 truncate max-w-xs" title="${safeDesc}">${safeDesc}</td>
          <td class="py-2.5 px-3 text-slate-500 whitespace-nowrap">${safeUser}</td>
          <td class="py-2.5 px-3 text-center">${statusBadge}</td>
          <td class="py-2.5 px-3 text-center">${actionBtn}</td>
        </tr>
      `;
    }).join('');
  },

  openCreateTxnModal(defaultType = 'EXPENSE') {
    const modal = document.getElementById('financeTxnModal');
    if (!modal) return;

    document.getElementById('financeTxnModalType').value = defaultType;
    document.getElementById('financeTxnModalDate').value = this.formatLocalDate(new Date());
    document.getElementById('financeTxnModalAmount').value = '';
    document.getElementById('financeTxnModalCategory').value = '';
    document.getElementById('financeTxnModalPayMethod').value = 'CASH';
    document.getElementById('financeTxnModalRefDoc').value = '';
    document.getElementById('financeTxnModalDesc').value = '';

    const titleEl = document.getElementById('financeTxnModalTitle');
    if (titleEl) {
      titleEl.textContent = defaultType === 'EXPENSE' ? 'บันทึกรายจ่ายหน้าร้าน (Expense)' : 'บันทึกรายรับอื่น (Income)';
    }

    UI.openModal('financeTxnModal');
  },

  async submitCreateTxn() {
    const type = document.getElementById('financeTxnModalType')?.value || 'EXPENSE';
    const txDate = document.getElementById('financeTxnModalDate')?.value || this.formatLocalDate(new Date());
    const branchId = document.getElementById('financeTxnModalBranch')?.value || '';
    const category = document.getElementById('financeTxnModalCategory')?.value?.trim();
    const amount = parseFloat(document.getElementById('financeTxnModalAmount')?.value) || 0;
    const payMethod = document.getElementById('financeTxnModalPayMethod')?.value || 'CASH';
    const refDoc = document.getElementById('financeTxnModalRefDoc')?.value?.trim() || '';
    const description = document.getElementById('financeTxnModalDesc')?.value?.trim() || '';

    if (!category) {
      UI.showToast('กรุณาระบุหมวดหมู่รายรับ/รายจ่าย', 'warning');
      return;
    }
    if (amount <= 0) {
      UI.showToast('จำนวนเงินต้องมากกว่า 0 บาท', 'warning');
      return;
    }

    UI.showLoading('กำลังบันทึกรายการบัญชี...');
    const res = await Api.call('finance:createTxn', {
      type,
      txDate,
      branchId,
      category,
      amount,
      payMethod,
      refDoc,
      description
    });
    UI.hideLoading();

    if (res && res.ok) {
      UI.closeModal('financeTxnModal');
      UI.showToast(`บันทึก${type === 'EXPENSE' ? 'รายจ่าย' : 'รายรับ'}สำเร็จ (เลขที่: ${res.txnId})`, 'success');
      await this.fetchTxns();
    } else {
      UI.showToast(res.error || 'ไม่สามารถบันทึกรายการได้', 'error');
    }
  },

  async voidTxn(txnId) {
    if (!txnId) return;
    const reason = prompt('กรุณาระบุเหตุผลในการยกเลิกรายการนี้:');
    if (reason === null) return; // user cancelled prompt
    if (!reason.trim()) {
      UI.showToast('ต้องระบุเหตุผลในการยกเลิก', 'warning');
      return;
    }

    UI.showLoading('กำลังยกเลิกรายการ...');
    const res = await Api.call('finance:voidTxn', { txnId, reason: reason.trim() });
    UI.hideLoading();

    if (res && res.ok) {
      UI.showToast('ยกเลิกรายการเรียบร้อยแล้ว', 'success');
      await this.fetchTxns();
    } else {
      UI.showToast(res.error || 'ไม่สามารถยกเลิกรายการได้', 'error');
    }
  },

  exportTxnsCsv() {
    if (!this.cachedTxns || this.cachedTxns.length === 0) {
      UI.showToast('ไม่พบรายการรายรับ-รายจ่ายสำหรับส่งออก', 'warning');
      return;
    }
    const headers = ['วันที่', 'เลขที่เอกสาร', 'สาขา', 'ประเภท', 'หมวดหมู่', 'ช่องทางชำระ', 'จำนวนเงิน (บาท)', 'เอกสารอ้างอิง', 'รายละเอียด', 'ผู้บันทึก', 'สถานะ', 'เหตุผลการยกเลิก'];
    const rows = this.cachedTxns.map(t => [
      t.txDate,
      t.txnId,
      this.getBranchName(t.branchId),
      t.type === 'EXPENSE' ? 'รายจ่าย' : 'รายรับ',
      t.category,
      t.payMethod,
      (parseFloat(t.amount) || 0).toFixed(2),
      t.refDoc || '',
      t.description || '',
      t.userName || t.userId || '',
      t.status || 'ACTIVE',
      t.voidReason || ''
    ]);
    const filename = `finance-ledger-${this.formatLocalDate(new Date())}.csv`;
    this.downloadCsv(filename, headers, rows);
    UI.showToast(`ส่งออกไฟล์ ${filename} เรียบร้อยแล้ว`, 'success');
  },

  // ================= TAB 3: DAILY CASH RECONCILIATION & CLOSING =================

  async loadClosingPreview() {
    const closeDate = document.getElementById('closingDateInput')?.value || this.formatLocalDate(new Date());
    const branchId = document.getElementById('financeClosingBranchSelect')?.value || '';

    UI.showLoading('กำลังดึงยอดเงินสดคาดการณ์จากระบบ...');
    const res = await Api.call('finance:closingPreview', { closeDate, branchId });
    UI.hideLoading();

    if (res && res.ok) {
      const d = res.data || res;
      this.activeClosingPreview = d;

      // Populate preview values
      const setTxt = (id, txt) => {
        const el = document.getElementById(id);
        if (el) el.textContent = txt;
      };

      setTxt('closePreviewFloat', `฿${(d.openingFloat || 0).toFixed(2)}`);
      setTxt('closePreviewSales', `฿${(d.cashSales || 0).toFixed(2)}`);
      setTxt('closePreviewIncome', `+฿${(d.cashIncome || 0).toFixed(2)}`);
      setTxt('closePreviewExpense', `-฿${(d.cashExpense || 0).toFixed(2)}`);
      setTxt('closePreviewExpectedCash', `฿${(d.expectedCash || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      setTxt('closePreviewNonCash', `(โอนเงิน: ฿${(d.transferSales || 0).toFixed(2)} | QR: ฿${(d.qrSales || 0).toFixed(2)})`);

      // Reset denomination counters to 0
      const denoms = [1000, 500, 100, 50, 20, 10, 5, 2, 1];
      denoms.forEach(val => {
        const input = document.getElementById(`denomCount_${val}`);
        if (input) input.value = '';
        setTxt(`denomTotal_${val}`, '฿0.00');
      });

      const actualCashInput = document.getElementById('closingActualCashInput');
      if (actualCashInput) actualCashInput.value = '';

      const cashDropInput = document.getElementById('closingCashDropInput');
      if (cashDropInput) cashDropInput.value = '';

      this.updateVarianceAndCarry();
    } else {
      UI.showToast(res.error || 'ไม่สามารถคำนวณยอดปิดได้', 'error');
    }
  },

  onDenomChange() {
    const denoms = [1000, 500, 100, 50, 20, 10, 5, 2, 1];
    let total = 0;

    denoms.forEach(val => {
      const input = document.getElementById(`denomCount_${val}`);
      const count = parseInt(input?.value, 10) || 0;
      const subtotal = count * val;
      total += subtotal;

      const totalEl = document.getElementById(`denomTotal_${val}`);
      if (totalEl) totalEl.textContent = `฿${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    });

    const actualCashInput = document.getElementById('closingActualCashInput');
    if (actualCashInput) {
      actualCashInput.value = total.toFixed(2);
    }

    this.updateVarianceAndCarry();
  },

  onActualCashManualChange() {
    this.updateVarianceAndCarry();
  },

  onCashDropChange() {
    this.updateVarianceAndCarry();
  },

  updateVarianceAndCarry() {
    const expected = this.activeClosingPreview ? (this.activeClosingPreview.expectedCash || 0) : 0;
    const actual = parseFloat(document.getElementById('closingActualCashInput')?.value) || 0;
    const variance = actual - expected;

    const varEl = document.getElementById('closingVarianceDisplay');
    const varBadge = document.getElementById('closingVarianceBadge');

    if (varEl) {
      varEl.textContent = `${variance >= 0 ? '+' : ''}฿${variance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      if (Math.abs(variance) < 0.01) {
        varEl.className = 'font-mono font-black text-2xl text-emerald-600';
        if (varBadge) {
          varBadge.textContent = 'ยอดเงินตรงกับระบบพอดี (MATCH)';
          varBadge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300';
        }
      } else if (variance > 0) {
        varEl.className = 'font-mono font-black text-2xl text-blue-600';
        if (varBadge) {
          varBadge.textContent = `เงินเกิน (OVER) +฿${variance.toFixed(2)}`;
          varBadge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300';
        }
      } else {
        varEl.className = 'font-mono font-black text-2xl text-rose-600';
        if (varBadge) {
          varBadge.textContent = `เงินขาด (SHORT) -฿${Math.abs(variance).toFixed(2)}`;
          varBadge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300';
        }
      }
    }

    const drop = parseFloat(document.getElementById('closingCashDropInput')?.value) || 0;
    const carry = Math.max(0, actual - drop);
    const carryEl = document.getElementById('closingCarryForwardDisplay');
    if (carryEl) carryEl.textContent = `฿${carry.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  },

  async submitCashClosing() {
    if (!this.activeClosingPreview) {
      UI.showToast('กรุณากดดึงข้อมูลระบบก่อนบันทึกปิดยอด', 'warning');
      return;
    }

    const closeDate = document.getElementById('closingDateInput')?.value || this.formatLocalDate(new Date());
    const branchId = document.getElementById('financeClosingBranchSelect')?.value || '';
    const actualCash = parseFloat(document.getElementById('closingActualCashInput')?.value);
    const cashDrop = parseFloat(document.getElementById('closingCashDropInput')?.value) || 0;
    const note = document.getElementById('closingNoteInput')?.value?.trim() || '';

    if (isNaN(actualCash)) {
      UI.showToast('กรุณาระบุยอดเงินสดที่นับได้จริง (หรือใช้เครื่องคิดเลขนับธนบัตร)', 'warning');
      return;
    }

    if (!confirm(`ยืนยันการบันทึกปิดยอดเงินสดประจำวัน (${closeDate})\nยอดนับจริง: ฿${actualCash.toFixed(2)}\nยอดส่งเงิน: ฿${cashDrop.toFixed(2)}`)) {
      return;
    }

    const denoms = [1000, 500, 100, 50, 20, 10, 5, 2, 1];
    const denomBreakdown = {};
    denoms.forEach(val => {
      const c = parseInt(document.getElementById(`denomCount_${val}`)?.value, 10) || 0;
      if (c > 0) denomBreakdown[val] = c;
    });

    const p = this.activeClosingPreview;
    const variance = actualCash - (p.expectedCash || 0);
    const carryForward = Math.max(0, actualCash - cashDrop);

    UI.showLoading('กำลังบันทึกใบปิดยอดส่งเงินประจำวัน...');

    const res = await Api.call('finance:saveClosing', {
      closeDate,
      branchId,
      openingFloat: p.openingFloat || 0,
      cashSales: p.cashSales || 0,
      transferSales: p.transferSales || 0,
      qrSales: p.qrSales || 0,
      cashIncome: p.cashIncome || 0,
      cashExpense: p.cashExpense || 0,
      expectedCash: p.expectedCash || 0,
      actualCash,
      variance,
      cashDrop,
      carryForward,
      denomBreakdown,
      note
    });

    UI.hideLoading();

    if (res && res.ok) {
      UI.showToast('บันทึกปิดยอดส่งเงินเรียบร้อยแล้ว', 'success');
      await this.fetchClosingHistory();
      const closingId = (res.closing && res.closing.closingId) || res.closingId || (res.data && res.data.closing && res.data.closing.closingId) || (res.data && res.data.closingId);
      if (closingId) {
        this.openClosingDetail(closingId);
      }
    } else {
      UI.showToast(res.error || 'ไม่สามารถบันทึกปิดยอดได้', 'error');
    }
  },

  async fetchClosingHistory() {
    const branchId = document.getElementById('financeClosingBranchSelect')?.value || '';
    const tbody = document.getElementById('financeClosingHistoryTableBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-slate-400">กำลังโหลดประวัติการปิดยอด...</td></tr>`;

    const res = await Api.call('finance:closings', { branchId, limit: 30 });
    if (res && res.ok) {
      const list = (res.data && res.data.closings) || res.closings || [];
      this.cachedClosings = list;
      this.renderClosingHistoryTable(this.cachedClosings);
    } else {
      if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-slate-400">ไม่มีประวัติการปิดยอด</td></tr>`;
    }
  },

  renderClosingHistoryTable(closings = []) {
    const tbody = document.getElementById('financeClosingHistoryTableBody');
    if (!tbody) return;

    if (closings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-slate-400">ยังไม่มีประวัติการปิดยอดสำหรับสาขานี้</td></tr>`;
      return;
    }

    tbody.innerHTML = closings.map(c => {
      const varNum = parseFloat(c.variance) || 0;
      let varBadge = `<span class="text-emerald-600 font-bold">฿0.00</span>`;
      if (varNum > 0) {
        varBadge = `<span class="text-blue-600 font-bold">+฿${varNum.toFixed(2)} (เกิน)</span>`;
      } else if (varNum < 0) {
        varBadge = `<span class="text-rose-600 font-bold">-฿${Math.abs(varNum).toFixed(2)} (ขาด)</span>`;
      }

      const safeId = typeof escapeHtml === 'function' ? escapeHtml(c.closingId) : c.closingId;
      const safeBranch = this.getBranchName(c.branchId);
      const safeUser = typeof escapeHtml === 'function' ? escapeHtml(c.userName || c.userId || '-') : (c.userName || c.userId || '-');

      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50 text-xs transition">
          <td class="py-2.5 px-3 font-mono font-bold">${c.closeDate || '-'}</td>
          <td class="py-2.5 px-3 font-mono font-bold text-purple-700">${safeId}</td>
          <td class="py-2.5 px-3">${safeBranch}</td>
          <td class="py-2.5 px-3 text-right font-mono">฿${(parseFloat(c.expectedCash) || 0).toFixed(2)}</td>
          <td class="py-2.5 px-3 text-right font-mono font-bold text-slate-900">฿${(parseFloat(c.actualCash) || 0).toFixed(2)}</td>
          <td class="py-2.5 px-3 text-right font-mono">${varBadge}</td>
          <td class="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">฿${(parseFloat(c.cashDrop) || 0).toFixed(2)}</td>
          <td class="py-2.5 px-3 text-right font-mono text-slate-600">฿${(parseFloat(c.carryForward) || 0).toFixed(2)}</td>
          <td class="py-2.5 px-3 text-center whitespace-nowrap">
            <div class="flex items-center justify-center gap-1">
              <button onclick="FinanceModule.openClosingDetail('${safeId}')" class="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] transition cursor-pointer">
                🔍 รายละเอียด
              </button>
              <button onclick="FinanceModule.printClosingSlip('${safeId}')" class="px-2 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold text-[10px] border border-purple-200 transition cursor-pointer">
                🖨️ ใบส่งเงิน
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  openClosingDetail(closingId) {
    const closing = this.cachedClosings.find(c => c.closingId === closingId);
    if (!closing) {
      UI.showToast('ไม่พบข้อมูลใบปิดยอด', 'error');
      return;
    }
    this.activeClosingDetail = closing;

    const setTxt = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };

    setTxt('cdModalId', closing.closingId);
    setTxt('cdModalDate', closing.closeDate);
    setTxt('cdModalBranch', this.getBranchName(closing.branchId));
    setTxt('cdModalUser', closing.userName || closing.userId || '-');
    setTxt('cdModalTimestamp', closing.ts ? new Date(closing.ts).toLocaleString('th-TH') : '-');

    setTxt('cdModalFloat', `฿${(parseFloat(closing.openingFloat) || 0).toFixed(2)}`);
    setTxt('cdModalSales', `฿${(parseFloat(closing.cashSales) || 0).toFixed(2)}`);
    setTxt('cdModalIncome', `+฿${(parseFloat(closing.cashIncome) || 0).toFixed(2)}`);
    setTxt('cdModalExpense', `-฿${(parseFloat(closing.cashExpense) || 0).toFixed(2)}`);
    setTxt('cdModalExpected', `฿${(parseFloat(closing.expectedCash) || 0).toFixed(2)}`);
    setTxt('cdModalActual', `฿${(parseFloat(closing.actualCash) || 0).toFixed(2)}`);

    const variance = parseFloat(closing.variance) || 0;
    const varEl = document.getElementById('cdModalVariance');
    if (varEl) {
      varEl.textContent = `${variance >= 0 ? '+' : ''}฿${variance.toFixed(2)}`;
      varEl.className = `font-mono font-bold ${variance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;
    }

    setTxt('cdModalDrop', `฿${(parseFloat(closing.cashDrop) || 0).toFixed(2)}`);
    setTxt('cdModalCarry', `฿${(parseFloat(closing.carryForward) || 0).toFixed(2)}`);
    setTxt('cdModalNote', closing.note || '-');

    // Denominations breakdown list
    const denomContainer = document.getElementById('cdModalDenomList');
    if (denomContainer) {
      let denomObj = {};
      try {
        denomObj = typeof closing.denomJson === 'string' ? JSON.parse(closing.denomJson || '{}') : (closing.denomJson || {});
      } catch (e) {
        denomObj = {};
      }

      const keys = Object.keys(denomObj).sort((a, b) => Number(b) - Number(a));
      if (keys.length === 0) {
        denomContainer.innerHTML = `<span class="text-slate-400 text-xs">ไม่ได้ระบุรายละเอียดธนบัตร</span>`;
      } else {
        denomContainer.innerHTML = keys.map(val => {
          const count = denomObj[val];
          const subtotal = count * Number(val);
          return `
            <div class="flex justify-between items-center py-1 border-b border-slate-100 text-xs">
              <span class="font-bold text-slate-700">${Number(val) >= 20 ? 'ธนบัตร' : 'เหรียญ'} ฿${val} x ${count}</span>
              <span class="font-mono font-bold text-slate-800">฿${subtotal.toFixed(2)}</span>
            </div>
          `;
        }).join('');
      }
    }

    UI.openModal('cashClosingDetailModal');
  },

  printClosingSlip(closingId) {
    const closing = (closingId && this.cachedClosings.find(c => c.closingId === closingId)) || this.activeClosingDetail;
    if (!closing) {
      UI.showToast('ไม่พบข้อมูลใบปิดยอดสำหรับพิมพ์', 'warning');
      return;
    }

    const varNum = parseFloat(closing.variance) || 0;
    const varText = varNum === 0 ? '0.00 (ตรงระบบ)' : (varNum > 0 ? `+${varNum.toFixed(2)} (เกิน)` : `${varNum.toFixed(2)} (ขาด)`);

    let denomObj = {};
    try {
      denomObj = typeof closing.denomJson === 'string' ? JSON.parse(closing.denomJson || '{}') : (closing.denomJson || {});
    } catch (e) {
      denomObj = {};
    }

    const denomLines = Object.keys(denomObj)
      .sort((a, b) => Number(b) - Number(a))
      .map(k => `  ${k} บาท x ${denomObj[k]} = ${(Number(k) * denomObj[k]).toFixed(2)}`)
      .join('<br>');

    const branchName = this.getBranchName(closing.branchId);
    const dateStr = closing.closeDate || '-';
    const timeStr = closing.ts ? new Date(closing.ts).toLocaleTimeString('th-TH') : '';

    const slipHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>ใบสรุปปิดยอดเงินสดประจำวัน</title>
        <style>
          body { font-family: 'Courier New', monospace, sans-serif; font-size: 12px; margin: 0; padding: 10px; width: 58mm; color: #000; }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .bold { font-weight: bold; }
          .divider { border-top: 1px dashed #000; margin: 6px 0; }
          .row { display: flex; justify-content: space-between; margin-bottom: 3px; }
          .signature-box { margin-top: 25px; padding-top: 15px; border-top: 1px dotted #888; text-align: center; font-size: 11px; }
        </style>
      </head>
      <body>
        <div class="text-center bold" style="font-size: 14px;">ใบสรุปปิดยอดเงินสด</div>
        <div class="text-center bold" style="font-size: 13px;">DAILY CASH CLOSING</div>
        <div class="text-center" style="font-size: 11px;">สาขา: ${typeof escapeHtml === 'function' ? escapeHtml(branchName) : branchName}</div>
        <div class="text-center" style="font-size: 10px;">วันที่: ${dateStr} ${timeStr}</div>
        <div class="text-center" style="font-size: 10px;">เลขที่เอกสาร: ${closing.closingId}</div>
        
        <div class="divider"></div>
        <div class="row"><span>เงินทอนยกมา:</span><span>฿${(parseFloat(closing.openingFloat) || 0).toFixed(2)}</span></div>
        <div class="row"><span>ยอดขายเงินสด:</span><span>฿${(parseFloat(closing.cashSales) || 0).toFixed(2)}</span></div>
        <div class="row"><span>รายรับเงินสดอื่น:</span><span>+฿${(parseFloat(closing.cashIncome) || 0).toFixed(2)}</span></div>
        <div class="row"><span>รายจ่ายเงินสด:</span><span>-฿${(parseFloat(closing.cashExpense) || 0).toFixed(2)}</span></div>
        <div class="divider"></div>
        
        <div class="row bold"><span>เงินสดระบบคาดหวัง:</span><span>฿${(parseFloat(closing.expectedCash) || 0).toFixed(2)}</span></div>
        <div class="row bold" style="font-size: 13px;"><span>เงินสดนับได้จริง:</span><span>฿${(parseFloat(closing.actualCash) || 0).toFixed(2)}</span></div>
        <div class="row"><span>ผลต่าง (Variance):</span><span>${varText}</span></div>
        <div class="divider"></div>
        
        <div class="row bold"><span>ยอดเงินสดนำส่ง:</span><span>฿${(parseFloat(closing.cashDrop) || 0).toFixed(2)}</span></div>
        <div class="row"><span>เงินทอนยกไป:</span><span>฿${(parseFloat(closing.carryForward) || 0).toFixed(2)}</span></div>

        ${denomLines ? `
          <div class="divider"></div>
          <div class="bold" style="font-size: 11px; margin-bottom: 2px;">รายละเอียดการนับเงิน:</div>
          <div style="font-size: 10px; line-height: 1.3;">${denomLines}</div>
        ` : ''}

        ${closing.note ? `
          <div class="divider"></div>
          <div style="font-size: 10px;">หมายเหตุ: ${typeof escapeHtml === 'function' ? escapeHtml(closing.note) : closing.note}</div>
        ` : ''}

        <div class="signature-box">
          ลงชื่อ ..........................................<br>
          (${typeof escapeHtml === 'function' ? escapeHtml(closing.userName || closing.userId || 'แคชเชียร์') : (closing.userName || closing.userId || 'แคชเชียร์')})<br>
          ผู้ส่งมอบเงิน
        </div>

        <div class="signature-box" style="margin-top: 15px;">
          ลงชื่อ ..........................................<br>
          (ผู้จัดการ / ผู้ตรวจรับเงิน)
        </div>
      </body>
      </html>
    `;

    if (window.PrintManager && typeof window.PrintManager.printHtmlDocument === 'function') {
      window.PrintManager.printHtmlDocument(slipHtml);
    } else {
      const win = window.open('', '_blank', 'width=350,height=600');
      if (win) {
        win.document.write(slipHtml);
        win.document.close();
        win.focus();
        setTimeout(() => win.print(), 300);
      } else {
        UI.showToast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up', 'warning');
      }
    }
  }
};
