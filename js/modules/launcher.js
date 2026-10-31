/**
 * launcher.js - Post-login Dashboard Launcher with Visual Module Cards
 */

const LauncherModule = {
  render() {
    const container = document.getElementById('launcherCardsContainer');
    if (!container) return;

    const modules = [
      {
        id: 'sales',
        title: 'ระบบงานขาย (POS)',
        desc: 'ขายสินค้าหลายบิลพร้อมกัน พิมพ์ใบเสร็จความร้อนอัตโนมัติ เสียงพูดแจ้งยอด ชำระเงินสด/โอน และยกเลิกใบเสร็จ',
        icon: '🛒',
        color: 'from-blue-600 to-indigo-700',
        allowed: Auth.hasPerm('sales', 'view')
      },
      {
        id: 'stock',
        title: 'ระบบสต๊อกสินค้า',
        desc: 'จัดการข้อมูลสินค้า แคตตาล็อก รับสินค้าเข้า ปรับปรุงยอดตรวจนับ โอนย้ายระหว่างสาขา และประวัติการเคลื่อนไหว (Stock Card)',
        icon: '📦',
        color: 'from-emerald-600 to-teal-700',
        allowed: Auth.hasPerm('stock', 'view')
      },
      {
        id: 'reports',
        title: 'ระบบรายงาน (Reports)',
        desc: 'วิเคราะห์ยอดขายรายวัน จัดอันดับสินค้าขายดี รายงานมูลค่าสต๊อก/สินค้าใกล้หมด ตรวจสอบใบเสร็จ และพิมพ์ซ้ำ (Reprint) พร้อมส่งออก CSV',
        icon: '📊',
        color: 'from-amber-500 to-orange-600',
        allowed: Auth.hasPerm('reports', 'view')
      },
      {
        id: 'finance',
        title: 'ระบบการเงิน (Finance)',
        desc: 'สรุปกระแสเงินสดแยกช่องทางชำระ (เงินสด/โอน/QR) บันทึกรายรับ-รายจ่ายหน้าร้าน และปิดยอดนับเงินสดส่งประจำวัน',
        icon: '💰',
        color: 'from-violet-600 to-purple-700',
        allowed: Auth.hasPerm('finance', 'view')
      },
      {
        id: 'admin',
        title: 'ระบบผู้ดูแลระบบ (Admin)',
        desc: 'จัดการผู้ใช้งาน สิทธิ์การเข้าถึง รูปแบบเลขที่ใบเสร็จ ตั้งค่าไดรเวอร์และเครื่องพิมพ์ ตั้งค่าเสียงพูดระบบ และ Audit Logs',
        icon: '⚙️',
        color: 'from-slate-700 to-gray-900',
        allowed: Auth.hasPerm('admin', 'view')
      },
      {
        id: 'manual',
        title: 'คู่มือการใช้งาน (Manual)',
        desc: 'คู่มือฉบับสมบูรณ์ วิธีติดตั้งและเริ่มใช้งาน ตารางคีย์ลัดแคชเชียร์ (F1) การขาย สต๊อก การเงิน และการแก้ปัญหาที่พบบ่อย',
        icon: '📖',
        color: 'from-sky-600 to-blue-700',
        allowed: true
      }
    ];

    container.innerHTML = modules.map(m => {
      if (!m.allowed) {
        return `
          <div class="relative bg-white/60 border border-slate-200 rounded-3xl p-6 shadow-sm opacity-50 cursor-not-allowed select-none">
            <div class="absolute top-4 right-4 bg-slate-200 text-slate-600 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
              🔒 ไม่มีสิทธิ์
            </div>
            <div class="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-3xl mb-4">
              ${m.icon}
            </div>
            <h3 class="text-xl font-bold text-slate-700 mb-2">${m.title}</h3>
            <p class="text-sm text-slate-500 leading-relaxed">${m.desc}</p>
          </div>
        `;
      }

      return `
        <div onclick="Router.navigate('${m.id}')"
             class="group relative bg-white border border-slate-100 hover:border-slate-300 rounded-3xl p-6 shadow-md hover:shadow-2xl transition-all duration-300 cursor-pointer transform hover:-translate-y-1">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-br ${m.color} text-white flex items-center justify-center text-3xl mb-4 shadow-lg group-hover:scale-110 transition-transform">
            ${m.icon}
          </div>
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-xl font-bold text-slate-900 group-hover:text-blue-600 transition-colors">${m.title}</h3>
            <span class="text-slate-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all">➔</span>
          </div>
          <p class="text-sm text-slate-600 leading-relaxed">${m.desc}</p>
        </div>
      `;
    }).join('');
  }
};
