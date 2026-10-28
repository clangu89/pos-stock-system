/**
 * print.js - Thermal Receipt Printing Engine & Continuous Print Configuration
 */

const PrintManager = {
  profiles: [],
  activeProfile: null,

  init(profilesList = []) {
    this.profiles = profilesList;
    const savedId = localStorage.getItem(CONFIG.STORAGE_KEYS.PRINTER_PROFILE_ID);
    if (savedId) {
      this.activeProfile = this.profiles.find(p => p.profileId === savedId) || this.profiles[0];
    } else {
      this.activeProfile = this.profiles[0] || this.getDefaultProfile();
    }
  },

  getDefaultProfile() {
    return {
      profileId: 'P_58MM_DEFAULT',
      printerName: 'XP-58 / Thermal 58mm',
      paperType: '58mm',
      widthMm: 58,
      heightMm: 0,
      marginMm: 2,
      fontSize: 11,
      copies: 1,
      autoPrint: true,
      showLogo: true,
      footer: 'ขอบคุณที่ใช้บริการ / Thank you!'
    };
  },

  setActiveProfile(profileId) {
    const match = this.profiles.find(p => p.profileId === profileId);
    if (match) {
      this.activeProfile = match;
      localStorage.setItem(CONFIG.STORAGE_KEYS.PRINTER_PROFILE_ID, profileId);
    }
  },

  buildReceiptHtml(sale, items = [], store = {}, profile = null) {
    const prof = profile || this.activeProfile || this.getDefaultProfile();
    const isVoid = sale.status === 'VOID';

    const widthMm = prof.widthMm || (prof.paperType === '80mm' ? 80 : 58);
    const marginMm = prof.marginMm !== undefined ? prof.marginMm : 2;
    const fontSize = prof.fontSize || (widthMm >= 80 ? 13 : 11);

    const itemsHtml = items.map(it => {
      const q = parseFloat(it.qty) || 0;
      const p = parseFloat(it.unitPrice) || 0;
      const amt = parseFloat(it.amount) || (q * p);
      const disc = parseFloat(it.discount) || 0;

      return `
        <tr>
          <td colspan="3" style="font-weight:600;">${it.name || it.sku}</td>
        </tr>
        <tr>
          <td style="color:#555; padding-left: 8px;">${q} x ${p.toFixed(2)}</td>
          <td class="text-right" style="color:#c0392b;">${disc > 0 ? `-${disc.toFixed(2)}` : ''}</td>
          <td class="text-right" style="font-weight:600;">${amt.toFixed(2)}</td>
        </tr>
      `;
    }).join('');

    const formattedDate = sale.ts
      ? new Date(sale.ts).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'medium' })
      : new Date().toLocaleString('th-TH');

    const payMethodText = sale.payMethod === 'CASH' ? 'เงินสด (Cash)' :
      sale.payMethod === 'TRANSFER' ? 'โอนเงิน / PromptPay' :
      sale.payMethod === 'QR' ? 'QR Code' : sale.payMethod || 'เงินสด';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Receipt - ${sale.receiptNo || 'Bill'}</title>
        <style>
          @page {
            size: ${widthMm}mm auto;
            margin: ${marginMm}mm;
          }
          body {
            margin: 0;
            padding: 0;
            font-family: 'Sarabun', 'Courier New', monospace, sans-serif;
            font-size: ${fontSize}px;
            color: #000;
            background: #fff;
            line-height: 1.3;
          }
          .receipt-box {
            width: 100%;
            max-width: ${widthMm}mm;
            margin: 0 auto;
            box-sizing: border-box;
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .bold { font-weight: bold; }
          .divider { border-top: 1px dashed #222; margin: 4px 0; }
          .double-divider { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 3px 0; margin: 4px 0; }
          .meta-row { display: flex; justify-content: space-between; font-size: 0.9em; }
          table { width: 100%; border-collapse: collapse; }
          .void-stamp {
            border: 2px solid #c0392b;
            color: #c0392b;
            text-align: center;
            font-weight: 800;
            padding: 3px;
            margin: 4px 0;
            font-size: 1.1em;
          }
        </style>
      </head>
      <body>
        <div class="receipt-box">
          ${isVoid ? `<div class="void-stamp">*** ยกเลิกใบเสร็จ (VOID) ***<br><small>${sale.voidReason || ''}</small></div>` : ''}
          <div class="text-center">
            <div style="font-size: 1.25em; font-weight: 800;">${store.name || 'POS Store'}</div>
            ${store.address ? `<div style="font-size: 0.85em;">${store.address}</div>` : ''}
            ${store.phone ? `<div style="font-size: 0.85em;">โทร: ${store.phone}</div>` : ''}
            ${store.taxId ? `<div style="font-size: 0.85em;">เลขผู้เสียภาษี: ${store.taxId}</div>` : ''}
            <div style="font-size: 0.9em; font-weight: 700; margin-top: 4px;">ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ</div>
          </div>

          <div class="divider"></div>

          <div class="meta-row">
            <span>เลขที่: <b style="font-family:monospace;">${sale.receiptNo || '-'}</b></span>
            <span>สาขา: ${sale.branchId || 'MAIN'}</span>
          </div>
          <div class="meta-row">
            <span>วันที่: ${formattedDate}</span>
            <span>แคชเชียร์: ${sale.cashierName || sale.userId || '-'}</span>
          </div>

          <div class="divider"></div>

          <table>
            <thead>
              <tr style="border-bottom: 1px dashed #222; font-size: 0.9em;">
                <th style="text-align:left;">รายการ</th>
                <th style="text-align:right;">ส่วนลด</th>
                <th style="text-align:right;">รวม</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <div class="divider"></div>

          <div class="meta-row">
            <span>รวมเป็นเงิน (Subtotal):</span>
            <span>${(parseFloat(sale.subtotal) || 0).toFixed(2)}</span>
          </div>
          ${parseFloat(sale.discount) > 0 ? `
            <div class="meta-row" style="color:#c0392b;">
              <span>ส่วนลดท้ายบิล (Discount):</span>
              <span>-${(parseFloat(sale.discount) || 0).toFixed(2)}</span>
            </div>
          ` : ''}
          ${parseFloat(sale.vat) > 0 ? `
            <div class="meta-row" style="font-size:0.85em; color:#555;">
              <span>ภาษีมูลค่าเพิ่ม (VAT Included):</span>
              <span>${(parseFloat(sale.vat) || 0).toFixed(2)}</span>
            </div>
          ` : ''}

          <div class="double-divider meta-row bold" style="font-size: 1.15em;">
            <span>ยอดชำระสุทธิ (Total):</span>
            <span>${(parseFloat(sale.total) || 0).toFixed(2)} บาท</span>
          </div>

          <div class="meta-row" style="font-size: 0.9em;">
            <span>วิธีชำระเงิน:</span>
            <span>${payMethodText}</span>
          </div>
          <div class="meta-row" style="font-size: 0.9em;">
            <span>รับเงินมา:</span>
            <span>${(parseFloat(sale.received) || 0).toFixed(2)}</span>
          </div>
          <div class="meta-row bold" style="font-size: 0.95em;">
            <span>เงินทอน (Change):</span>
            <span>${(parseFloat(sale.change) || 0).toFixed(2)} บาท</span>
          </div>

          <div class="divider"></div>

          <div class="text-center" style="font-size: 0.85em; margin-top: 6px;">
            <div>${prof.footer || store.footer || 'ขอบคุณที่ใช้บริการ / Thank you!'}</div>
            <div style="font-size: 0.75em; color: #777; margin-top: 4px;">Print Profile: ${prof.printerName || prof.profileId}</div>
          </div>
        </div>
      </body>
      </html>
    `;
  },

  printReceiptDirect(sale, items, store, profile) {
    const htmlContent = this.buildReceiptHtml(sale, items, store, profile);
    let printFrame = document.getElementById('receiptPrintIframe');
    if (!printFrame) {
      printFrame = document.createElement('iframe');
      printFrame.id = 'receiptPrintIframe';
      printFrame.style.position = 'fixed';
      printFrame.style.right = '0';
      printFrame.style.bottom = '0';
      printFrame.style.width = '0';
      printFrame.style.height = '0';
      printFrame.style.border = '0';
      document.body.appendChild(printFrame);
    }

    const doc = printFrame.contentWindow.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();

    setTimeout(() => {
      try {
        printFrame.contentWindow.focus();
        printFrame.contentWindow.print();
      } catch (e) {
        console.error('Direct print failed:', e);
      }
    }, 250);
  },

  previewReceiptModal(sale, items, store, profile) {
    const container = document.getElementById('receiptPreviewModalContent');
    if (!container) return;
    const html = this.buildReceiptHtml(sale, items, store, profile);
    container.innerHTML = html;
    UI.openModal('receiptPreviewModal');
  }
};
