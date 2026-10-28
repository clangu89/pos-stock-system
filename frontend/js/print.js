/**
 * print.js - Thermal Receipt Printing Engine & Continuous Print Configuration
 */

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function multilineHtml(str) {
  return escapeHtml(str).replace(/\r?\n/g, '<br>');
}

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
      showLogo: true
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
      const disc = parseFloat(it.discount) || 0;
      // ยอดรายการที่เป็น 0 (ของแถม/ลดเต็ม) ต้องพิมพ์เป็น 0.00 ห้าม fallback เป็นราคาเต็ม
      const parsedAmt = parseFloat(it.amount);
      const amt = isNaN(parsedAmt) ? Math.max(0, (q * p) - disc) : parsedAmt;
      const itemName = escapeHtml(it.name || it.sku);

      return `
        <tr>
          <td colspan="3" style="font-weight:600;">${itemName}</td>
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
      sale.payMethod === 'QR' ? 'QR Code' : escapeHtml(sale.payMethod || 'เงินสด');

    const storeName = multilineHtml(store.storeName || store.name || 'POS Store');
    // ฟิลด์ที่ Backend ส่งมาเป็นสตริงว่าง = ผู้ใช้ตั้งใจให้ไม่แสดง (ไม่ fallback เป็นข้อความเริ่มต้น)
    // fallback ใช้เฉพาะกรณีไม่มีฟิลด์นั้นส่งมาเลย (undefined)
    const titleText = store.receiptTitle !== undefined && store.receiptTitle !== null
      ? String(store.receiptTitle)
      : 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ';
    const receiptTitleHtml = titleText.trim()
      ? `<div style="font-size: 0.9em; font-weight: 700; margin-top: 4px;">${escapeHtml(titleText)}</div>`
      : '';
    const subHeader = (store.subHeader && String(store.subHeader).trim()) ? `<div style="font-size: 0.85em; color: #444; margin-top: 1px;">${multilineHtml(store.subHeader)}</div>` : '';

    const showAddress = store.showAddress !== false && String(store.showAddress) !== 'false';
    const showPhone = store.showPhone !== false && String(store.showPhone) !== 'false';
    const showTaxId = store.showTaxId !== false && String(store.showTaxId) !== 'false';
    const showCashier = store.showCashier !== false && String(store.showCashier) !== 'false';
    const showBranch = store.showBranch !== false && String(store.showBranch) !== 'false';

    const addressHtml = (showAddress && store.address) ? `<div style="font-size: 0.85em;">${multilineHtml(store.address)}</div>` : '';
    const phoneHtml = (showPhone && store.phone) ? `<div style="font-size: 0.85em;">โทร: ${escapeHtml(store.phone)}</div>` : '';
    const taxIdHtml = (showTaxId && store.taxId) ? `<div style="font-size: 0.85em;">เลขผู้เสียภาษี: ${escapeHtml(store.taxId)}</div>` : '';

    // ชื่อสาขาที่แสดงบนใบเสร็จ: ชื่อสาขา (ตัวย่อ) ไม่แสดงรหัสดิบ เช่น B01
    const branchLabel = store.branchName
      ? (store.branchCode ? `${store.branchName} (${store.branchCode})` : store.branchName)
      : (store.branchCode || sale.branchId || 'MAIN');

    const footerText = store.footer !== undefined && store.footer !== null
      ? String(store.footer)
      : 'ขอบคุณที่ใช้บริการ / Thank you!';
    const footerHtml = footerText.trim()
      ? `<div style="margin-top: 6px; line-height: 1.35;">${multilineHtml(footerText)}</div>`
      : '';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Receipt - ${escapeHtml(sale.receiptNo || 'Bill')}</title>
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
          ${isVoid ? `<div class="void-stamp">*** ยกเลิกใบเสร็จ (VOID) ***<br><small>${escapeHtml(sale.voidReason || '')}</small></div>` : ''}
          <div class="text-center">
            <div style="font-size: 1.25em; font-weight: 800; line-height: 1.2;">${storeName}</div>
            ${subHeader}
            ${addressHtml}
            ${phoneHtml}
            ${taxIdHtml}
            ${receiptTitleHtml}
          </div>

          <div class="divider"></div>

          <div class="meta-row">
            <span>เลขที่: <b style="font-family:monospace;">${escapeHtml(sale.receiptNo || '-')}</b></span>
            ${showBranch ? `<span>สาขา: ${escapeHtml(branchLabel)}</span>` : '<span></span>'}
          </div>
          <div class="meta-row">
            <span>วันที่: ${formattedDate}</span>
            ${showCashier ? `<span>แคชเชียร์: ${escapeHtml(sale.cashierName || sale.userId || '-')}</span>` : '<span></span>'}
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

          <div class="text-center" style="font-size: 0.85em;">
            ${footerHtml}
          </div>
        </div>
      </body>
      </html>
    `;
  },

  /**
   * เรนเดอร์ใบเสร็จเข้า container ด้วย <iframe srcdoc> (แยก CSS ออกจากหน้าเว็บหลัก ไม่ให้สไตล์รั่ว)
   * ใช้ตัวสร้าง HTML ตัวเดียวกับใบเสร็จที่พิมพ์จริง (buildReceiptHtml) จึงเห็นผลตรงกับที่พิมพ์ 100%
   */
  renderPreviewInto(container, sale, items, store, profile) {
    if (!container) return null;
    const html = this.buildReceiptHtml(sale, items, store, profile);
    const prof = profile || this.activeProfile || this.getDefaultProfile();
    const widthMm = prof.widthMm || (prof.paperType === '80mm' ? 80 : 58);

    let frame = container.querySelector('iframe[data-receipt-preview]');
    if (!frame) {
      container.innerHTML = '';
      frame = document.createElement('iframe');
      frame.setAttribute('data-receipt-preview', '1');
      frame.style.border = '0';
      frame.style.background = '#fff';
      frame.style.display = 'block';
      frame.style.margin = '0 auto';
      container.appendChild(frame);
    }
    frame.style.width = `${Math.round(widthMm * 3.78)}px`;
    frame.style.maxWidth = '100%';
    frame.style.height = '480px';
    frame.onload = () => {
      try {
        const h = frame.contentWindow.document.documentElement.scrollHeight;
        if (h) frame.style.height = `${h + 8}px`;
      } catch (e) { /* ignore */ }
    };
    frame.srcdoc = html;
    this.lastPreviewHtml = html;
    return frame;
  },

  previewReceiptModal(sale, items, store, profile) {
    const container = document.getElementById('receiptPreviewModalContent');
    if (!container) return;
    this.renderPreviewInto(container, sale, items, store, profile);
    UI.openModal('receiptPreviewModal');
  },

  /**
   * พิมพ์ใบเสร็จที่เปิดพรีวิวอยู่ (ปุ่ม "สั่งพิมพ์" ในหน้าต่างพรีวิว) — พิมพ์เฉพาะใบเสร็จ ไม่พิมพ์ทั้งหน้าเว็บ
   */
  printLastPreview() {
    if (!this.lastPreviewHtml) return;
    this.printHtmlDocument(this.lastPreviewHtml);
  },

  printHtmlDocument(htmlContent) {
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

  printReceiptDirect(sale, items, store, profile) {
    const htmlContent = this.buildReceiptHtml(sale, items, store, profile);
    this.printHtmlDocument(htmlContent);
  }
};
