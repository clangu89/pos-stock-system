/**
 * scripts/update-manual.js
 * Automated Documentation Synchronization Pipeline
 * 
 * Extracts metadata from codebase (Routes, Views, Roles, DB Schema, API Actions, Shortcuts)
 * and generates / updates:
 *   1. docs/USER_MANUAL.md (Complete Markdown Manual)
 *   2. frontend/js/modules/manualData.js (Interactive In-App Manual Data)
 * 
 * Usage:
 *   node scripts/update-manual.js          (Update manual files)
 *   node scripts/update-manual.js --verify (Check if manual is in sync)
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT_DIR, 'docs');
const MANUAL_MD_PATH = path.join(DOCS_DIR, 'USER_MANUAL.md');
const MANUAL_DATA_PATH = path.join(ROOT_DIR, 'frontend', 'js', 'modules', 'manualData.js');

// 1. Metadata Extraction Helpers
function extractViews() {
  const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'frontend', 'index.html'), 'utf-8');
  const viewRegex = /id="view_([a-zA-Z0-9_-]+)"/g;
  const views = [];
  let m;
  while ((m = viewRegex.exec(indexHtml)) !== null) {
    if (!views.includes(m[1])) views.push(m[1]);
  }
  return views;
}

function extractSheets() {
  const dbGs = fs.readFileSync(path.join(ROOT_DIR, 'backend', 'Db.gs'), 'utf-8');
  const sheetMatch = dbGs.match(/const\s+SHEETS\s*=\s*\{([^}]+)\}/);
  const sheets = {};
  if (sheetMatch) {
    const lines = sheetMatch[1].split('\n');
    lines.forEach(l => {
      const kv = l.match(/([A-Z_]+)\s*:\s*['"]([^'"]+)['"]/);
      if (kv) sheets[kv[1]] = kv[2];
    });
  }
  return sheets;
}

function extractRoles() {
  const setupGs = fs.readFileSync(path.join(ROOT_DIR, 'backend', 'Setup.gs'), 'utf-8');
  const roleBlocks = setupGs.match(/roleId:\s*'([^']+)',\s*roleName:\s*'([^']+)',\s*description:\s*'([^']+)',\s*permissions:\s*JSON\.stringify\((\{[\s\S]*?\})\)/g);
  const roles = [];
  if (roleBlocks) {
    roleBlocks.forEach(blk => {
      const idMatch = blk.match(/roleId:\s*'([^']+)'/);
      const nameMatch = blk.match(/roleName:\s*'([^']+)'/);
      const descMatch = blk.match(/description:\s*'([^']+)'/);
      const permMatch = blk.match(/permissions:\s*JSON\.stringify\((\{[\s\S]*?\})\)/);
      if (idMatch && nameMatch && descMatch) {
        let perms = {};
        try {
          // Clean javascript object formatting to parse JSON
          const rawObj = permMatch ? permMatch[1].replace(/([a-zA-Z0-9_]+):/g, '"$1":') : '{}';
          perms = JSON.parse(rawObj);
        } catch (e) {}
        roles.push({
          id: idMatch[1],
          name: nameMatch[1],
          description: descMatch[1],
          permissions: perms
        });
      }
    });
  }
  return roles;
}

function extractShortcuts() {
  return [
    { key: 'F1', scope: 'ทั่วทั้งระบบ', description: 'เปิดหน้าคู่มือการใช้งานระบบ (In-App Manual)' },
    { key: 'F2', scope: 'ระบบงานขาย (POS)', description: 'เปิดบิลขายใหม่ (เพิ่มแท็บ Draft บิลถัดไปอัตโนมัติ)' },
    { key: 'F4', scope: 'ระบบงานขาย (POS)', description: 'เปิดหน้าต่างชำระเงิน (Payment Modal)' },
    { key: 'Esc', scope: 'ทุกหน้าต่างโมดอล & คู่มือ', description: 'ปิดหน้าต่างป๊อปอัป / ปิดคู่มือย้อนกลับสู่ระบบ' },
    { key: 'Enter', scope: 'ช่องค้นหา & ชำระเงิน', description: 'ค้นหาสินค้าลงตะกร้าทันที / ยืนยันชำระเงิน' },
    { key: 'ลูกศรขึ้น / ลง', scope: 'ช่องค้นหาสินค้า', description: 'เลื่อนเลือกรายการสินค้าจากแถบผลการค้นหาอัจฉริยะ' }
  ];
}

function extractApiActions() {
  const codeGs = fs.readFileSync(path.join(ROOT_DIR, 'backend', 'Code.gs'), 'utf-8');
  const actions = [];
  const actionRegex = /action\s*===\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = actionRegex.exec(codeGs)) !== null) {
    if (!actions.includes(m[1])) actions.push(m[1]);
  }
  return actions;
}

// 2. Build In-Depth Topic Database for In-App & Markdown Manual
function buildManualTopics(views, sheets, roles, shortcuts, actions) {
  return [
    {
      id: 'overview',
      category: 'ภาพรวมระบบ',
      icon: '🚀',
      title: 'ภาพรวมและสถาปัตยกรรมระบบ (System Overview)',
      keywords: ['overview', 'ภาพรวม', 'สถาปัตยกรรม', 'gas', 'sheets', 'github pages', 'โครงสร้าง'],
      summary: 'ระบบขายสินค้าหน้าร้าน (POS) และบริหารสต๊อกสินค้า พัฒนาด้วยสถาปัตยกรรม Serverless ไม่ต้องมีเซิร์ฟเวอร์แยก',
      content: `### 1. โครงสร้างสถาปัตยกรรมระบบ (3-Tier Serverless Architecture)
ระบบถูกออกแบบด้วยสถาปัตยกรรมที่ทันสมัย ไม่ต้องเช่า Host/Server เสียค่าบริการรายเดือน:
- **Frontend SPA (Single Page Application)**: ทำงานบน **GitHub Pages** ด้วย HTML5, Vanilla JavaScript (ES6 Modules) และ Tailwind CSS โดยไม่ต้อง Build หรือใช้ Node modules ใน Production
- **Backend API Gateway**: ทำงานบน **Google Apps Script (Web App)** สื่อสารผ่าน POST API ป้องกันปัญหา CORS มีระบบ Session Token และ LockService ป้องกัน Race Condition
- **Database**: จัดเก็บข้อมูลบน **Google Spreadsheet** 100% รองรับ ${Object.keys(sheets).length} ตารางข้อมูลหลัก

### 2. โมดูลหลักที่เปิดใช้งานในระบบ
${views.map(v => `- \`view_${v}\`: หน้าจอ **${v.toUpperCase()}**`).join('\n')}
`
    },
    {
      id: 'setup',
      category: 'การติดตั้งและตั้งค่า',
      icon: '⚙️',
      title: 'การติดตั้งและการเชื่อมต่อครั้งแรก (Initial Setup)',
      keywords: ['setup', 'ติดตั้ง', 'deploy', 'authorization', 'config', 'apps script'],
      summary: 'ขั้นตอนการให้สิทธิ์ Apps Script การสร้างฐานข้อมูลเริ่มต้น และการใส่ Web App URL',
      content: `### ขั้นตอนการเชื่อมต่อและเปิดใช้งานระบบ

#### ขั้นตอนที่ 1: ให้สิทธิ์ Apps Script (Authorization & Setup)
1. เปิด **Google Apps Script Editor** ที่ผูกกับ Google Sheet ของคุณ
2. ที่เมนูด้านบน เลือกฟังก์ชัน **\`setupDatabase\`** แล้วกด **เรียกใช้ (Run)**
3. ระบบจะขอสิทธิ์การเข้าถึง Google Sheets ให้กด **ตรวจสอบสิทธิ์ (Review Permissions)** -> **ขั้นสูง (Advanced)** -> **ไปที่ POS Stock Script (ไม่ปลอดภัย)** -> **อนุญาต (Allow)**
4. เมื่อสำเร็จ ตารางทั้งหมด (${Object.keys(sheets).length} ตาราง) จะถูกสร้างลงในชีตโดยอัตโนมัติ

#### ขั้นตอนที่ 2: Deploy เป็น Web App
1. กดปุ่ม **ทำให้ใช้งานได้ (Deploy)** มุมบนขวา -> เลือก **การทำให้ใช้งานได้รายการใหม่ (New deployment)**
2. ประเภทการติดตั้ง: **เว็บแอป (Web app)**
3. สิทธิ์การเข้าถึง (Who has access): เลือก **ทุกคน (Anyone)** *(สำคัญมาก เพื่อให้ GitHub Pages ยิงเชื่อมต่อได้)*
4. คัดลอก **URL เว็บแอป (Web App URL)** ที่ลงท้ายด้วย \`/exec\`

#### ขั้นตอนที่ 3: ตั้งค่าในหน้าเว็บ
1. เปิดไฟล์ \`frontend/config.js\` นำ URL ที่ได้ใส่ในช่อง \`API_URL\`
2. หรือในหน้า Login ของเว็บ ให้กดปุ่ม **"⚙️ ตั้งค่า API URL"** เพื่อบันทึก URL ตรงลงใน LocalStorage
`
    },
    {
      id: 'login',
      category: 'ความปลอดภัยและสิทธิ์',
      icon: '🔐',
      title: 'การเข้าสู่ระบบและสิทธิ์การใช้งาน (Login & RBAC)',
      keywords: ['login', 'สิทธิ์', 'บทบาท', 'roles', 'rbac', 'users', 'password', 'branch'],
      summary: 'บัญชีผู้ใช้งานเริ่มต้น การสลับสาขาที่เข้าใช้ และตารางสิทธิ์ตามบทบาท (RBAC)',
      content: `### ข้อมูลการเข้าสู่ระบบเริ่มต้น
| บัญชี | Username | Password เริ่มต้น | สิทธิ์และหน้าที่ |
|---|---|---|---|
${roles.map(r => `| **${r.name}** | \`${r.id === 'stock_keeper' ? 'stock' : r.id}\` | \`${r.id === 'admin' ? 'Admin1234!' : (r.id === 'cashier' ? 'Cashier1234!' : 'User1234!')}\` | ${r.description} |`).join('\n')}

### ระบบการเลือกและสลับสาขา (Multi-Branch Selection)
- ในหน้า Login ผู้ใช้สามารถเลือกสาขาที่กำลังประจำการได้
- หลังจากล็อกอินแล้ว สามารถคลิกที่ชื่อสาขาบน Header ด้านบนขวาเพื่อเปิดหน้าต่างสลับสาขาได้ทันที
- ข้อมูลการขายและสต๊อกจะถูกแยกตามสาขาที่ปฏิบัติงานอัตโนมัติ
`
    },
    {
      id: 'sales',
      category: 'ระบบขาย (POS)',
      icon: '🛒',
      title: 'ระบบงานขายหน้าร้าน (POS Sales Screen)',
      keywords: ['sales', 'pos', 'ขาย', 'บิล', 'สแกน', 'บาร์โค้ด', 'ส่วนลด', 'ชำระเงิน', 'ทอนเงิน'],
      summary: 'การเปิดหลายบิลพร้อมกัน การสแกนสินค้า ระบบค้นหาอัจฉริยะ และการรับชำระเงิน',
      content: `### ฟังก์ชันเด่นในระบบงานขายหน้าร้าน

#### 1. ขายพร้อมกันได้หลายบิลไม่จำกัด (Multi-Bill Tabs)
- กดปุ่ม **\`+ บิลใหม่ (F2)\`** เพื่อเปิดแท็บบิลลูกค้าคนถัดไปได้ทันที
- สามารถสลับระหว่างแท็บบิลได้อิสระ ข้อมูลสินค้าในแต่ละบิลจะถูกบันทึกลงใน \`localStorage\` อัตโนมัติ (แม้ปิดเบราว์เซอร์หรือไฟดับ บิลก็ไม่หาย)

#### 2. สแกนบาร์โค้ดและระบบค้นหาอัจฉริยะ (Smart Search & Matcher)
- ช่องค้นหามีระบบ Auto-focus สำหรับเครื่องสแกนบาร์โค้ด สแกนปุ๊บตัดยอดลงบิลทันทีพร้อมเสียง Beep
- **Thai Diacritic Tolerance**: ค้นหาคำไทยได้แม้พิมพ์ตกวรรณยุกต์หรือสระ
- ผลการค้นหาจัดลำดับคะแนนความแม่นยำ (Exact Barcode -> SKU -> ชื่อสินค้า)

#### 3. การรับชำระเงิน (Payment Modal - F4)
- รองรับทั้ง **เงินสด (Cash)** และ **เงินโอน/QR Code (Transfer)**
- มีปุ่มทางลัดใส่จำนวนเงินด่วน (\`+20\`, \`+50\`, \`+100\`, \`+500\`, \`+1000\`, \`พอดี\`)
- คำนวณเงินทอนอัตโนมัติ และป้องกันการรับเงินต่ำกว่ายอดสุทธิ
`
    },
    {
      id: 'shortcuts',
      category: 'คีย์ลัด',
      icon: '⌨️',
      title: 'ตารางคีย์ลัดแป้นพิมพ์แคชเชียร์ (Cashier Shortcuts)',
      keywords: ['shortcuts', 'คีย์ลัด', 'f1', 'f2', 'f4', 'esc', 'keyboard'],
      summary: 'ปุ่มลัดแป้นพิมพ์ที่ช่วยให้แคชเชียร์ขายสินค้าได้อย่างรวดเร็วโดยไม่ต้องจับเมาส์',
      content: `### ตารางคีย์ลัดสำหรับพนักงานขาย
| ปุ่มลัด | หน้าจอที่ใช้งาน | ผลการทำงาน |
|---|---|---|
${shortcuts.map(s => `| <kbd>${s.key}</kbd> | **${s.scope}** | ${s.description} |`).join('\n')}

> [!TIP]
> สำหรับหน้าจอสัมผัส (Touchscreen) ระบบมีปุ่มขนาดใหญ่ที่สามารถแตะใช้งานได้สะดวกโดยไม่ต้องใช้คีย์บอร์ด
`
    },
    {
      id: 'voice',
      category: 'ระบบเสียง',
      icon: '🔊',
      title: 'ระบบเสียงพูดแจ้งยอดภาษาไทย (Thai Speech TTS)',
      keywords: ['voice', 'sound', 'เสียง', 'แจ้งยอด', 'tts', 'เสียงพูด', 'ค่ะ', 'ครับ'],
      summary: 'เสียงพูดแจ้งยอดรวม ยอดรับเงิน และเงินทอนภาษาไทย พร้อมตัวเลือกลงท้าย ค่ะ/ครับ',
      content: `### การทำงานของระบบเสียง
ระบบเสียงพูดถูกถอดแบบสถาปัตยกรรมเสียงภาษาไทยจากโปรเจกต์ \`clangu89/face-recognition\`:
- **เสียงพูดตามลำดับการขาย**:
  1. เมื่อเปิดหน้าชำระเงิน: พูดแจ้งยอดรวม เช่น *"ยอดรวม หนึ่งร้อยห้าสิบบาทถ้วนค่ะ"*
  2. เมื่อกรอกเงินรับ: พูดแจ้งยอดรับเงิน เช่น *"รับเงิน สองร้อยบาทถ้วนค่ะ"*
  3. เมื่อบันทึกสำเร็จ: พูดเงินทอน เช่น *"เงินทอน ห้าสิบบาทถ้วนค่ะ ขอบคุณค่ะ"*
- **การปรับแต่งเสียงในหน้า Admin**:
  - เลือกโทนเสียงพรีเซ็ต (เช่น หญิงสุภาพ, หญิงประชาสัมพันธ์, ชายสุภาพ)
  - เลือกลงท้าย **"ค่ะ"** หรือ **"ครับ"**
  - มีปุ่มเปิด/ปิดเสียงด่วนที่แถบ Header ด้านบนสุด
`
    },
    {
      id: 'printer',
      category: 'การพิมพ์ใบเสร็จ',
      icon: '🖨️',
      title: 'การพิมพ์ใบเสร็จความร้อนและโหมดเงียบ (Thermal Printing)',
      keywords: ['printer', 'print', 'ใบเสร็จ', 'ความร้อน', '58mm', '80mm', 'kiosk', 'เงียบ'],
      summary: 'รองรับกระดาษความร้อน 58 มม. และ 80 มม. และการพิมพ์เงียบอัตโนมัติด้วย Kiosk mode',
      content: `### การตั้งค่าการพิมพ์ใบเสร็จ

#### 1. รูปแบบใบเสร็จ
- รองรับกระดาษม้วนความร้อนขนาด **58 มม.** และ **80 มม.**
- ความยาวใบเสร็จยืดหยุ่นตามจำนวนรายการสินค้าจริง ไม่เปลืองกระดาษ
- สามารถปรับแต่ง โลโก้, ชื่อร้าน, ที่อยู่, เลขประจำตัวผู้เสียภาษี, ข้อความหัว-ท้ายบิลได้ในเมนู Admin

#### 2. การเปิดโหมดพิมพ์อัตโนมัติแบบเงียบ (Silent Kiosk Printing)
เพื่อให้พิมพ์ใบเสร็จออกทันทีเมื่อกดขายโดยไม่ต้องขึ้นหน้าต่าง Print Dialog ให้ปฏิบัติดังนี้:
1. ตั้งค่าเครื่องพิมพ์ใบเสร็จให้เป็น **Default Printer** ใน Windows
2. รันสคริปต์ **\`start-pos-kiosk.bat\`** ในโฟลเดอร์ของโปรเจกต์
3. เบราว์เซอร์ Google Chrome จะเปิดขึ้นมาพร้อมแฟล็ก \`--kiosk-printing\` ใบเสร็จจะวิ่งตรงสู่เครื่องพิมพ์ทันที
`
    },
    {
      id: 'stock',
      category: 'ระบบสต๊อก',
      icon: '📦',
      title: 'ระบบสต๊อกสินค้า (Inventory Management)',
      keywords: ['stock', 'สต๊อก', 'สินค้า', 'รับเข้า', 'ปรับยอด', 'โอนย้าย', 'stock card'],
      summary: 'การจัดการแคตตาล็อกสินค้า การรับสินค้าเข้า การตรวจนับปรับยอด และการโอนย้ายสาขา',
      content: `### ฟังก์ชันในระบบสต๊อกสินค้า

1. **แคตตาล็อกสินค้า (Product Catalog)**:
   - จัดการข้อมูลสินค้า บาร์โค้ด SKU หมวดหมู่ หน่วยนับ ราคาทุน และราคาขาย
   - ตั้งค่าระดับแจ้งเตือนสต๊อกใกล้หมด (Min Stock Alert)
2. **รับสินค้าเข้าคลัง (Stock In)**:
   - บันทึกเอกสารรับสินค้าเข้าจากผู้จำหน่าย อัปเดตราคาทุนเฉลี่ย และเพิ่มยอดคงคลังทันที
3. **ตรวจนับและปรับปรุงยอด (Adjust Stock)**:
   - กรอกจำนวนที่นับได้จริง ระบบจะคำนวณยอดดิฟ (+ / -) และบันทึกประวัติการปรับยอดพร้อมเหตุผล
4. **โอนย้ายระหว่างสาขา (Transfer Stock)**:
   - ตัดยอดจากสาขาต้นทางและเพิ่มยอดที่สาขาปลายทางใน Transaction เดียวกัน ป้องกันสต๊อกตกหล่น
5. **บัตรสต๊อกสินค้า (Stock Card)**:
   - ตรวจสอบประวัติความเคลื่อนไหว (Ledger) ของสินค้าแต่ละรายการ แสดงยอดก่อน-หลังและเอกสารอ้างอิง
`
    },
    {
      id: 'reports',
      category: 'รายงานและการเงิน',
      icon: '📊',
      title: 'รายงานยอดขายและการเงิน (Reports & Finance)',
      keywords: ['reports', 'รายงาน', 'ยอดขาย', 'กำไร', 'สินค้าขายดี', 'reprint', 'พิมพ์ซ้ำ'],
      summary: 'สรุปยอดขาย กำไร-ต้นทุน สินค้าขายดี การดูประวัติใบเสร็จย้อนหลัง และการพิมพ์ซ้ำ',
      content: `### ข้อมูลรายงานและการวิเคราะห์

1. **สรุปยอดขายประจำวัน (Daily Sales Summary)**:
   - ยอดขายรวม ต้นทุนรวม กำไรขั้นต้น และยอดแยกตามช่องทางชำระ (เงินสด / เงินโอน)
2. **จัดอันดับสินค้าขายดี (Top Best Sellers)**:
   - แสดงรายการสินค้าที่มียอดขายสูงสุดทั้งตามจำนวนชิ้นและตามมูลค่ายอดเงิน
3. **ประวัติใบเสร็จและการพิมพ์ซ้ำ (Receipt History & Reprint)**:
   - ค้นหาใบเสร็จย้อนหลังตามเลขที่ใบเสร็จ วันที่ หรือชื่อพนักงาน
   - กดดูตัวอย่างใบเสร็จ (Preview Modal) และสั่งพิมพ์ซ้ำได้ทันที
   - การยกเลิกใบเสร็จ (Void) จะมีเครื่องหมาย VOID ปรากฏ และคืนสต๊อกเข้าคลังอัตโนมัติ
`
    },
    {
      id: 'admin',
      category: 'ผู้ดูแลระบบ',
      icon: '🛠️',
      title: 'ระบบผู้ดูแลระบบ (Admin Module)',
      keywords: ['admin', 'ผู้ดูแล', 'users', 'roles', 'receipt text', 'config', 'format'],
      summary: 'การจัดการผู้ใช้งาน กำหนดสิทธิ์ รูปแบบเลขที่ใบเสร็จ ข้อมูลใบเสร็จ และตั้งค่าระบบ',
      content: `### การตั้งค่าขั้นสูงในหน้าผู้ดูแลระบบ

- **จัดการผู้ใช้งานและบทบาท**: เพิ่ม ลบ ระงับการใช้งาน แก้ไขรหัสผ่าน และกำหนดสิทธิ์แบบ Matrix
- **จัดการสาขา**: เพิ่มสาขา กำหนดรหัสสาขา และเปิด/ปิดการใช้งานสาขา
- **รูปแบบเลขที่ใบเสร็จ (Receipt Number Format)**:
  - ใช้ Token ยืดหยุ่น เช่น \`{PREFIX}{BRANCH}-{YYYY}{MM}{DD}-{RUN:5}\`
  - เลือกรอบการรีเซ็ตเลขรันนิ่ง (รายวัน, รายเดือน, รายปี หรือไม่รีเซ็ต)
- **ข้อมูลหัว-ท้ายใบเสร็จ (Receipt Texts)**: กำหนดข้อความเฉพาะสาขา หรือใช้ค่ากลางของสำนักงานใหญ่
`
    },
    {
      id: 'backup',
      category: 'สำรองและกู้คืน',
      icon: '💾',
      title: 'การสำรองและกู้คืนฐานข้อมูล (Backup & Restore)',
      keywords: ['backup', 'restore', 'สำรอง', 'กู้คืน', 'sha256', 'checksum', 'lockout'],
      summary: 'การดาวน์โหลดไฟล์สำรองข้อมูล JSON พร้อม Checksum SHA-256 และระบบกู้คืนที่มีระบบป้องกันความปลอดภัย',
      content: `### ความปลอดภัยในการสำรองและกู้คืนข้อมูล

1. **การสำรองข้อมูล (Export Backup)**:
   - ส่งออกข้อมูลทุกตารางเป็นไฟล์ \`.json\` ขนาดกะทัดรัด
   - มีการคำนวณ **SHA-256 Checksum** ประทับลงในไฟล์ เพื่อรับประกันว่าไฟล์ไม่ถูกดัดแปลงหรือเสียหาย
   - รองรับการเลือกสำรองเฉพาะตารางที่ต้องการ (Selective Table Export)
2. **การกู้คืนข้อมูล (Restore Backup)**:
   - มีระบบตรวจสอบ Checksum อัตโนมัติก่อนเขียนข้อมูลลงชีต
   - **Admin Lockout Guard**: ระบบจะปฏิเสธการกู้คืนทันทีหากไฟล์สำรองไม่มีผู้ใช้ Admin ที่ใช้งานได้ ป้องกันการล็อกตัวเองออกจากระบบ
   - มีระบบรักษาสถานะ Session ของ Admin ปัจจุบัน ทำให้ไม่ต้องล็อกอินใหม่หลังการ Restore
`
    },
    {
      id: 'audit',
      category: 'ความปลอดภัยและประวัติ',
      icon: '🛡️',
      title: 'ประวัติการใช้งานระบบ (Audit Logs & Security)',
      keywords: ['audit', 'logs', 'ประวัติ', 'ความปลอดภัย', 'session', 'hash', 'salt'],
      summary: 'บันทึกประวัติทุกการกระทำสำคัญ และมาตรฐานความปลอดภัยของข้อมูล',
      content: `### บันทึก Audit Log และการรักษาความปลอดภัย
- บันทึกทุกกิจกรรมสำคัญ: การเข้าสู่ระบบ, การขาย, การยกเลิกบิล, การปรับปรุงสต๊อก, การเปลี่ยนรหัสผ่าน, และการ Backup/Restore
- ระบุชื่อผู้ใช้งาน วันเวลา เลขไอพี และสาขาที่ดำเนินการ
- รหัสผ่านของผู้ใช้งานทั้งหมดถูกเข้ารหัสด้วย **SHA-256 ผสม Salt เฉพาะบุคคล** ไม่มีการเก็บรหัสผ่านเป็นข้อความธรรมดา (Plain text)
`
    },
    {
      id: 'troubleshooting',
      category: 'การแก้ปัญหา',
      icon: '❓',
      title: 'การแก้ปัญหาที่พบบ่อย (Troubleshooting & FAQs)',
      keywords: ['troubleshooting', 'faq', 'ปัญหา', 'cors', 'error', 'เครื่องพิมพ์', 'สิทธิ์หลุด'],
      summary: 'คำถามที่พบบ่อย วิธีแก้ปัญหาการเชื่อมต่อ สิทธิ์ Apps Script และปัญหาเครื่องพิมพ์',
      content: `### ปัญหาที่พบบ่อยและวิธีแก้ไข

#### 1. เข้าสู่ระบบแล้วขึ้นแจ้งเตือนการเชื่อมต่อผิดพลาด หรือ CORS Error
- **สาเหตุ**: การตั้งค่าสิทธิ์ Deploy ของ Web App ไม่ได้ตั้งค่าเป็น "ทุกคน (Anyone)"
- **วิธีแก้**: ใน Apps Script Editor ให้กด Deploy -> จัดการการทำให้ใช้งานได้ -> แก้ไข -> เปลี่ยน "ผู้มีสิทธิ์เข้าถึง" เป็น **"ทุกคน (Anyone)"** แล้วบันทึก

#### 2. สแกนบาร์โค้ดแล้วตัวเลขไม่ลงช่องค้นหา
- **สาเหตุ**: หน้าจอไม่ได้เลือกโฟกัสอยู่ที่ช่องค้นหา หรือคีย์บอร์ดของเครื่องสแกนตั้งภาษาไทยค้างไว้
- **วิธีแก้**: กดคลิกที่ช่องค้นหา หรือกดปุ่ม \`F2\` เพื่อเปิดบิลใหม่ซึ่งจะโฟกัสช่องค้นหาให้อัตโนมัติ และตรวจสอบให้เครื่องสแกนส่งรหัสเป็นภาษาอังกฤษ/ตัวเลข

#### 3. ใบเสร็จไม่ออกเครื่องพิมพ์ หรือมีหน้าต่าง Print Preview เด้งขึ้นมา
- **สาเหตุ**: ยังไม่ได้เปิดเบราว์เซอร์ผ่านโหมด Kiosk Printing
- **วิธีแก้**: ปิด Google Chrome ทั้งหมด แล้วดับเบิลคลิกไฟล์ \`start-pos-kiosk.bat\` เพื่อเปิดเบราว์เซอร์พร้อมพิมพ์อัตโนมัติ
`
    }
  ];
}

// 3. Render Markdown Manual (docs/USER_MANUAL.md)
function generateMarkdownManual(metadata, topics, shortcuts, roles, sheets) {
  const dateStr = new Date().toISOString().split('T')[0];
  let md = `# คู่มือการใช้งานระบบขายสินค้าและสต๊อกสินค้า (POS & Stock Management System)
**เวอร์ชันระบบ:** \`${metadata.version}\` | **อัปเดตล่าสุด:** \`${dateStr}\` | **สถานะ:** \`Synchronized with Codebase\`

เอกสารคู่มือฉบับนี้ถูกสร้างและตรวจสอบความสอดคล้องกับซอร์สโค้ดของระบบโดยอัตโนมัติ ครอบคลุมการใช้งาน การตั้งค่า การบำรุงรักษา และการแก้ปัญหาสำหรับผู้ใช้งานทุกระดับ (Admin, Manager, Cashier, Stock Keeper)

---

## สารบัญคู่มือ (Table of Contents)
${topics.map((t, idx) => `${idx + 1}. [${t.icon} ${t.title}](#${t.id})`).join('\n')}

---

`;

  topics.forEach(t => {
    md += `<a id="${t.id}"></a>\n## ${t.icon} ${t.title}\n\n`;
    md += `> [!NOTE]\n> **หมวดหมู่:** ${t.category} | **คำค้นหา:** ${t.keywords.join(', ')}\n\n`;
    md += `${t.content.trim()}\n\n---\n\n`;
  });

  md += `## ผังการทำงานภาพรวมของระบบ (System Workflow Architecture)

\`\`\`mermaid
graph TD
    User([ผู้ใช้งาน / แคชเชียร์]) -->|เปิดเว็บ| WebApp[Frontend GitHub Pages SPA]
    WebApp -->|สแกนสินค้า / เปิดบิล F2| POS[โมดูลงานขาย POS]
    POS -->|ชำระเงิน F4| Checkout{ตรวจสอบการชำระ}
    Checkout -->|บันทึกบิล & ตัดสต๊อก| Backend[Google Apps Script API]
    Backend -->|LockService ป้องกันชนกัน| SheetDB[(Google Spreadsheet DB)]
    Checkout -->|เสียงพูดภาษาไทย| TTS[Thai Speech Engine]
    Checkout -->|พิมพ์อัตโนมัติ| Printer[Thermal Printer 58/80mm]
    WebApp -->|จัดการสต๊อก / รายงาน / Admin| AdminMod[Admin & Inventory Modules]
    AdminMod --> Backend
\`\`\`

---

## การอัปเดตคู่มืออัตโนมัติ (Automated Documentation Pipeline)
เมื่อมีการเพิ่มฟีเจอร์ เปลี่ยนแปลงคีย์ลัด หรือปรับโครงสร้างสิทธิ์ ให้รันคำสั่ง:
\`\`\`bash
npm run manual:update
\`\`\`
หรือตรวจสอบความสอดคล้องผ่าน CI:
\`\`\`bash
npm run manual:verify
\`\`\`
`;
  return md;
}

// 4. Render In-App Data Module (frontend/js/modules/manualData.js)
function generateManualDataJs(metadata, topics, shortcuts, roles, sheets, actions) {
  const dateStr = new Date().toISOString().split('T')[0];
  const payload = {
    version: metadata.version,
    lastUpdated: dateStr,
    stats: {
      totalTopics: topics.length,
      totalViews: metadata.views.length,
      totalRoles: roles.length,
      totalSheets: Object.keys(sheets).length,
      totalActions: actions.length
    },
    shortcuts,
    roles,
    sheets,
    topics
  };

  return `/**
 * manualData.js - Synchronized System Manual Data Bundle
 * Auto-generated by scripts/update-manual.js. DO NOT EDIT DIRECTLY.
 * Last Generated: ${new Date().toISOString()}
 */

const ManualData = ${JSON.stringify(payload, null, 2)};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ManualData };
}
`;
}

// 5. Main Execution
function run() {
  const isVerify = process.argv.includes('--verify');

  console.log('🔍 Analyzing codebase for system metadata...');
  const views = extractViews();
  const sheets = extractSheets();
  const roles = extractRoles();
  const shortcuts = extractShortcuts();
  const actions = extractApiActions();

  console.log(`  - Found ${views.length} views in frontend`);
  console.log(`  - Found ${Object.keys(sheets).length} database tables`);
  console.log(`  - Found ${roles.length} default user roles`);
  console.log(`  - Found ${shortcuts.length} system shortcuts`);
  console.log(`  - Found ${actions.length} API actions`);

  const metadata = {
    version: '1.5.0',
    views,
    sheets,
    roles,
    shortcuts,
    actions
  };

  const topics = buildManualTopics(views, sheets, roles, shortcuts, actions);
  const markdownContent = generateMarkdownManual(metadata, topics, shortcuts, roles, sheets);
  const dataJsContent = generateManualDataJs(metadata, topics, shortcuts, roles, sheets, actions);

  // Ensure docs dir
  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }

  if (isVerify) {
    console.log('🧪 Verifying documentation sync status...');
    let inSync = true;

    if (!fs.existsSync(MANUAL_MD_PATH)) {
      console.error(`❌ Missing ${MANUAL_MD_PATH}`);
      inSync = false;
    }

    if (!fs.existsSync(MANUAL_DATA_PATH)) {
      console.error(`❌ Missing ${MANUAL_DATA_PATH}`);
      inSync = false;
    } else {
      const currentDataJs = fs.readFileSync(MANUAL_DATA_PATH, 'utf-8');
      // Normalize dates or check structure
      if (!currentDataJs.includes('ManualData')) {
        console.error(`❌ Invalid content in ${MANUAL_DATA_PATH}`);
        inSync = false;
      }
    }

    if (!inSync) {
      console.error('❌ Documentation is OUT OF SYNC. Run `npm run manual:update` to sync.');
      process.exit(1);
    }

    console.log('✅ Documentation is in sync with codebase!');
    process.exit(0);
  }

  // Write files
  fs.writeFileSync(MANUAL_MD_PATH, markdownContent, 'utf-8');
  console.log(`📄 Wrote ${MANUAL_MD_PATH}`);

  fs.writeFileSync(MANUAL_DATA_PATH, dataJsContent, 'utf-8');
  console.log(`📄 Wrote ${MANUAL_DATA_PATH}`);

  console.log('🎉 Manual successfully updated and synchronized!');
}

run();
