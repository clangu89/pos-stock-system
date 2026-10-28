/**
 * reports.js - Analytics Dashboard, Daily Summaries, Top Sellers, and Valuation
 */

const ReportsModule = {
  branches: [],
  activeBranchId: '',

  async activate() {
    this.setDefaultDates();
    await this.loadBranches();
    await this.generateReport();
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
  },

  async loadBranches() {
    const res = await Api.call('admin:branches');
    if (res && res.ok && res.branches) {
      this.branches = res.branches;
      const select = document.getElementById('reportBranchSelect');
      if (select) {
        select.innerHTML = '<option value="">ทุกสาขา</option>' + this.branches.map(b => `
          <option value="${b.branchId}">${b.name}</option>
        `).join('');
      }
    }
  },

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
  }
};
