# ระบบขายสินค้าและสต๊อกสินค้า (POS & Stock Management System)
**Google Apps Script (Backend & Google Sheets Database) + GitHub Pages (Frontend SPA)**

ระบบเว็บแอปพลิเคชันจัดการการขายหน้าร้าน (POS) เชื่อมโยงสต๊อกสินค้าแบบ Real-time พร้อมระบบเสียงแจ้งยอดพูดไทย (ถอดแบบสถาปัตยกรรมจากโปรเจกต์ `clangu89/face-recognition`), การพิมพ์ใบเสร็จความร้อนแบบต่อเนื่องอัตโนมัติ, ระบบรายงานสถิติวิเคราะห์ยอดขายและประวัติใบเสร็จ, ระบบบริหารการเงินและปิดยอดเงินสดประจำวันครบวงจร และระบบผู้ดูแลระบบ (Admin) แยกสิทธิ์การใช้งานชัดเจน

---

## สถาปัตยกรรมระบบ

1. **Frontend (GitHub Pages)**:
   - เทคโนโลยี: HTML5, Vanilla JavaScript (Modular ES6), Tailwind CSS (CDN)
   - ไม่ต้องคอมไพล์/Build รองรับการรันผ่านเว็บเบราว์เซอร์หรือ GitHub Pages ทันที
   - รองรับหน้าจอสัมผัส (Touchscreen), คีย์บอร์ดแคชเชียร์ (F2: เปิดบิลใหม่, F4: ชำระเงิน)
2. **Backend (Google Apps Script Web App)**:
   - สื่อสารผ่าน `POST` แบบ `Content-Type: text/plain` ป้องกันปัญหา CORS Preflight
   - จัดการความปลอดภัยด้วย Session Token + Hash Salt SHA-256 + Role-based Permission Guard ทุก Action
   - ป้องกัน Stock Race Condition และเลขที่ใบเสร็จชนกันด้วย `LockService.getScriptLock()`
3. **Database (Google Sheets - 21 ตาราง)**:
   - จัดเก็บข้อมูลทั้งหมดใน Google Spreadsheet ของคุณ:
     - `Users`, `Roles`, `Branches`, `Products`, `Categories`, `Units`
     - `StockBalance`, `StockMovements`, `StockDocs`
     - `Sales`, `SaleItems`, `Counters`, `Config`, `ReceiptTexts`, `PrintProfiles`, `AuditLog`, `Sessions`
     - `FinanceTxns`, `CashClosings`, `BusinessDays`, `CashDrawers`

---

## ฟังก์ชันการทำงานหลักในระบบ (Launcher Dashboard)

ระบบแบ่งออกเป็นโมดูลอิสระตามสิทธิ์การใช้งานของผู้ใช้:

### 1. 🛒 ระบบงานขาย (POS)
- **ขายพร้อมกันหลายบิลไม่จำกัด**: กด `+ บิลใหม่ (F2)` เพื่อสลับบิลลูกค้าได้อิสระ โดยบันทึก Draft ใน `localStorage` อัตโนมัติ (รีเฟรชหน้าจอข้อมูลไม่หาย)
- **สแกนบาร์โค้ด**: โฟกัสช่องสแกนอัตโนมัติ สแกนปุ๊บตัดยอดลงตะกร้าทันที พร้อมเสียง Beep สั้น
- **ค้นหาสินค้าอัจฉริยะ**: ค้นหาด้วยชื่อ/SKU/บาร์โค้ด รองรับคำค้นหาหลายคำและการพิมพ์ตกวรรณยุกต์ไทย พร้อมระบบป้องกัน Browser Password Autofill
- **เชื่อมโยงสต๊อก Real-time**: แสดงยอดคงเหลือของแต่ละสินค้า และแจ้งเตือนเมื่อสต๊อกไม่พอขาย
- **เสียงแจ้งยอดภาษาไทย**:
  - ถอดแบบจาก `clangu89/face-recognition`: มีทั้ง Tone Presets (หญิงสุภาพ, หญิงประชาสัมพันธ์, ชายสุภาพ ฯลฯ) และเลือก System Voices ในอุปกรณ์
  - มีตัวเลือกลงท้าย "ค่ะ" หรือ "ครับ"
  - แจ้งยอดรวม ("ยอดรวม หนึ่งร้อยห้าสิบบาทถ้วนค่ะ")
  - แจ้งยอดรับเงิน ("รับเงิน สองร้อยบาทถ้วนค่ะ")
  - แจ้งเงินทอน ("เงินทอน ห้าสิบบาทถ้วนค่ะ" หรือ "รับเงินพอดี ขอบคุณค่ะ")
  - Fallback สู่เสียงเตือน Web Audio / Google Translate TTS อัตโนมัติ
- **พิมพ์ใบเสร็จความร้อนอัตโนมัติ (Auto Print)**:
  - รองรับขนาดกระดาษความร้อน 58 มม. และ 80 มม. พิมพ์ต่อเนื่องตามความยาวรายการจริงผ่าน CSS `@page`
  - รองรับโหมดพิมพ์เงียบอัตโนมัติด้วย Chrome Kiosk Printing (`--kiosk-printing`)
- **ยกเลิกใบเสร็จ (Void)**: ค้นหาเลขที่ใบเสร็จ ระบุเหตุผล และคืนสต๊อกสินค้ากลับเข้าคลังอัตโนมัติ

### 2. 📦 ระบบสต๊อกสินค้า (Stock & Inventory)
- **แคตตาล็อกสินค้า**: เพิ่ม แก้ไข ลบ ค้นหาด้วยบาร์โค้ด/SKU/ชื่อสินค้า กำหนดราคาทุน ราคาขาย และจุดเตือนสต๊อกใกล้หมด
- **รับสินค้าเข้าคลัง (Stock In)**: บันทึกใบรับสินค้า อัปเดตราคาทุน และเพิ่มยอดคงเหลือ
- **ตรวจนับและปรับยอด (Adjust Stock)**: กรอกยอดที่นับได้จริง ระบบคำนวณส่วนต่างและบันทึกประวัติพร้อมเหตุผล
- **โอนย้ายระหว่างสาขา (Transfer Stock)**: ตัดสต๊อกสาขาต้นทางและเพิ่มสาขาปลายทางใน Transaction เดียว
- **Stock Card**: ตรวจสอบประวัติการเคลื่อนไหวทุกรายการของสินค้าแยกตามสาขา

### 3. 📊 ระบบรายงาน (Reports)
- **ภาพรวมและยอดขายรายวัน**: สรุปยอดขายรวม กำไรขั้นต้น จำนวนบิล สัดส่วนเงินสด vs เงินโอน ตารางยอดขายรายวัน และ 15 อันดับสินค้าขายดี (Top Sellers)
- **รายงานมูลค่าสต๊อกสินค้า**: ประเมินมูลค่าต้นทุนรวม ราคาขายรวม กำไรส่วนต่างคาดการณ์ และตารางเตือนสินค้าต่ำกว่าจุดสั่งซื้อขั้นต่ำ (Low Stock Alert)
- **ตรวจสอบประวัติใบเสร็จและพิมพ์ซ้ำ (Reprint)**: ค้นหาและกรองใบเสร็จย้อนหลัง ดูรายละเอียดสินค้าในบิล ดูข้อมูลบิลที่ยกเลิก และกดพิมพ์ซ้ำใบเสร็จผ่าน Thermal Printer
- **ส่งออกข้อมูล (Export CSV)**: ส่งออกข้อมูลยอดขายรายวัน, สินค้าขายดี, รายการสินค้าใกล้หมด และประวัติใบเสร็จเป็นไฟล์ CSV (UTF-8 BOM สำหรับเปิดใน MS Excel)

### 4. 💰 ระบบการเงิน (Finance)
- **สรุปกระแสเงินสดและกำไรสุทธิ**:
  - สรุปยอดขายแยกช่องทาง เงินสด (`CASH`), โอนเงิน (`TRANSFER`), และ `QR Code`
  - สรุปรายรับอื่นและรายจ่ายหน้าร้าน
  - คำนวณกระแสเงินสดสุทธิ (Net Cash Flow) และกำไรจากการดำเนินงานสุทธิ (Net Operating Profit)
  - ตารางกระแสเงินสดรายวัน และสัดส่วนค่าใช้จ่ายตามหมวดหมู่
- **สมุดบัญชีรายรับ-รายจ่ายหน้าร้าน (Petty Cash Ledger)**:
  - บันทึกค่าใช้จ่ายเบ็ดเตล็ดและรายรับอื่นหน้าร้าน แยกตามสาขาและช่องทางเงินสด/เงินโอน
  - ระบบยกเลิกรายการ (Void) พร้อมบันทึกเหตุผลและ Audit Log
- **ปิดยอด / นับเงินสดส่งประจำวัน (Cash Drawer Closing)**:
  - ดึงยอดเงินสดคาดการณ์ตามระบบอัตโนมัติ (เงินทอนยกมา + ยอดขายสด + รายรับสด - รายจ่ายสด)
  - เครื่องคิดเลขนับธนบัตรและเหรียญ (฿1,000 ถึง ฿1) พร้อมคำนวณยอดเงินสดนับจริงแบบ Real-time
  - คำนวณส่วนต่างเงินเกิน/ขาด (Variance) แสดงสถานะ Over / Short / Exact Match
  - กำหนดยอดเงินสดนำส่ง (Cash Drop) และคำนวณเงินทอนยกไปวันถัดไป (Carry Forward)
  - Roll-over ยอดเงินทอนยกไปเป็นเงินทอนเริ่มต้นในวันถัดไปให้อัตโนมัติ
  - พิมพ์ใบสรุปปิดยอดส่งเงินประจำวัน (Thermal Closing Slip 58mm/80mm)

### 5. ⚙️ ระบบผู้ดูแลระบบ (Admin)
- จัดการผู้ใช้งาน กำหนดบทบาท (Admin, Manager, Cashier, Stock Keeper)
- **บทบาทและสิทธิ์รายเมทริกซ์**: กำหนดสิทธิ์แยกอิสระครบ 5 โมดูล (`sales`, `stock`, `reports`, `finance`, `admin`)
- กำหนดรูปแบบเลขที่ใบเสร็จด้วย Token เช่น `{PREFIX}{BRANCH}-{YYYY}{MM}{DD}-{RUN:5}` พร้อมตั้งรอบการรีเซ็ตเลขรันนิ่ง (รายวัน, รายเดือน, รายปี)
- ปรับแต่งข้อความใบเสร็จ (หัวกระดาษ, ที่อยู่, เบอร์โทร, เลขภาษี, ท้ายบิล) รองรับค่ากลางและปรับแต่งรายสาขา
- ตั้งค่าเครื่องพิมพ์ความร้อน ไดรเวอร์ ขนาดกระดาษ (58 มม. / 80 มม.) และเสียงพูดระบบ
- **สำรองและกู้คืนฐานข้อมูล (Backup & Safe Restore)**: ส่งออกข้อมูลทั้ง 21 ตารางพร้อม SHA-256 Checksum และระบบความปลอดภัย 4 ชั้นป้องกันข้อมูลสูญหาย

### 6. 📖 คู่มือการใช้งานระบบ (In-App Interactive Manual & Docs)
- **หน้าจอคู่มือในแอป (`#manual`)**: เข้าถึงได้ทันทีโดยกดปุ่ม **`📖 คู่มือ (F1)`** บน Header, ในหน้าเลือกระบบ Launcher หรือกดปุ่มลัด `F1` จากหน้าจอใดก็ได้
- **ค้นหาอัจฉริยะแบบ Real-time**: ค้นหาหัวข้อการใช้งาน คีย์ลัด หรือวิธีแก้ปัญหา พร้อมระบบแยกหมวดหมู่
- **เอกสารคู่มือฉบับเต็มภาษาไทย**: อ่านคู่มือฉบับสมบูรณ์พร้อมไดอะแกรม Mermaid ได้ที่ [docs/USER_MANUAL.md](docs/USER_MANUAL.md)
- **ระบบอัปเดตคู่มืออัตโนมัติ (Zero-drift Pipeline)**:
  - สคริปต์สกัด Metadata จากโค้ดจริง (Routes, Shortcuts, Roles, Sheets, APIs): `npm run manual:update`
  - ตรวจสอบความสอดคล้องใน CI: `npm run manual:verify`
  - Git Pre-commit Hook ซิงค์คู่มืออัตโนมัติทุกครั้งที่มีการ commit โค้ด

---

## ลิงก์และข้อมูลสำหรับการติดตั้ง

- **Google Spreadsheet Database**: [https://docs.google.com/spreadsheets/d/1YEVUjb74z9BmGPalcmOS7mfX9TzvUGx0sXKFfzgiYJc/edit](https://docs.google.com/spreadsheets/d/1YEVUjb74z9BmGPalcmOS7mfX9TzvUGx0sXKFfzgiYJc/edit)
- **Google Apps Script Editor**: [https://script.google.com/d/10rMmH_47aiOvXCzDPBf2ih4z3-cDrf8URBuycGHiyiwV8i_TGNKWCcV4/edit](https://script.google.com/d/10rMmH_47aiOvXCzDPBf2ih4z3-cDrf8URBuycGHiyiwV8i_TGNKWCcV4/edit)
- **Web App Endpoint (Version 13)**: `https://script.google.com/macros/s/AKfycbxFPqfj6B0Nsa-OQnziTygQrh7n899RYPCKmnlbjraAawPmSSNtlN4MbU-cPLs-u1C1/exec`
- **GitHub Repository**: [https://github.com/clangu89/pos-stock-system](https://github.com/clangu89/pos-stock-system)
- **GitHub Pages Live System**: [https://clangu89.github.io/pos-stock-system/](https://clangu89.github.io/pos-stock-system/)

---

## วิธีติดตั้งและเริ่มต้นใช้งาน

1. เปิดลิงก์ **[Google Apps Script Editor](https://script.google.com/d/10rMmH_47aiOvXCzDPBf2ih4z3-cDrf8URBuycGHiyiwV8i_TGNKWCcV4/edit)** (ล็อกอินด้วยบัญชี Google ของคุณ)
2. โค้ดทั้งหมดในโฟลเดอร์ `backend/` ได้รับการ Deploy สู่ Version 13 เรียบร้อยแล้ว
3. ระบบจะสร้างชีตใหม่ (`FinanceTxns`, `CashClosings`, `BusinessDays`, `CashDrawers`) พร้อมจัดฟอร์แมตอัตโนมัติ
4. เข้าใช้งานระบบผ่าน **[GitHub Pages](https://clangu89.github.io/pos-stock-system/)**
5. เข้าสู่ระบบด้วยผู้ใช้งานเริ่มต้น:
   - **Admin**: `admin` / `Admin1234!` (เข้าได้ครบทุกระบบ)
   - **Cashier**: `cashier` / `Cashier1234!` (เฉพาะระบบงานขาย POS และระบบสต๊อกสินค้า)
