# ระบบขายสินค้าและสต๊อกสินค้า (POS & Stock Management System)
**Google Apps Script (Backend & Google Sheets Database) + GitHub Pages (Frontend SPA)**

ระบบเว็บแอปพลิเคชันจัดการการขายหน้าร้าน (POS) เชื่อมโยงสต๊อกสินค้าแบบ Real-time พร้อมระบบเสียงแจ้งยอดพูดไทย (ถอดแบบสถาปัตยกรรมจากโปรเจกต์ `clangu89/face-recognition`), การพิมพ์ใบเสร็จความร้อนแบบต่อเนื่องอัตโนมัติ และระบบผู้ดูแลระบบ (Admin) แยกสิทธิ์การใช้งานชัดเจน

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
3. **Database (Google Sheets)**:
   - จัดเก็บข้อมูลทั้งหมดใน Google Spreadsheet ของคุณ (Users, Roles, Products, StockBalance, StockMovements, Sales, SaleItems, Counters, Config, PrintProfiles, AuditLog)

---

## ฟังก์ชันการทำงานหลัก

### 1. หน้าจอเลือกระบบหลังเข้าสู่ระบบ (Launcher Dashboard)
- แสดง 4 ไอคอนระบบขนาดใหญ่ตามสิทธิ์ของผู้ใช้งาน:
  - 🛒 **งานขาย (POS)**
  - 📦 **ระบบสต๊อกสินค้า**
  - 📊 **รายงานและการเงิน**
  - ⚙️ **ผู้ดูแลระบบ (Admin)**
- หากผู้ใช้ไม่มีสิทธิ์ในระบบใด ไอคอนจะถูกล็อกและปิดการเข้าถึงโดยอัตโนมัติ

### 2. ระบบงานขาย (POS)
- **ขายพร้อมกันหลายบิลไม่จำกัด**: กด `+ บิลใหม่ (F2)` เพื่อสลับบิลลูกค้าได้อิสระ โดยบันทึก Draft ใน `localStorage` อัตโนมัติ (รีเฟรชหน้าจอข้อมูลไม่หาย)
- **สแกนบาร์โค้ด**: โฟกัสช่องสแกนอัตโนมัติ สแกนปุ๊บตัดยอดลงตะกร้าทันที พร้อมเสียง Beep สั้น
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
- **ยกเลิกใบเสร็จ (Void)**:
  - ค้นหาเลขที่ใบเสร็จ ระบุเหตุผล และคืนสต๊อกสินค้ากลับเข้าคลังอัตโนมัติ (เคลื่อนไหวใน Stock Movements Ledger)

### 3. ระบบสต๊อกสินค้า (Inventory)
- **แคตตาล็อกสินค้า**: เพิ่ม แก้ไข ลบ ค้นหาด้วยบาร์โค้ด/SKU/ชื่อสินค้า กำหนดราคาทุน ราคาขาย และจุดเตือนสต๊อกใกล้หมด
- **รับสินค้าเข้าคลัง (Stock In)**: บันทึกใบรับสินค้า อัปเดตราคาทุน และเพิ่มยอดคงเหลือ
- **ตรวจนับและปรับยอด (Adjust Stock)**: กรอกยอดที่นับได้จริง ระบบคำนวณส่วนต่างและบันทึกประวัติพร้อมเหตุผล
- **โอนย้ายระหว่างสาขา (Transfer Stock)**: ตัดสต๊อกสาขาต้นทางและเพิ่มสาขาปลายทางใน Transaction เดียว
- **Stock Card**: ตรวจสอบประวัติการเคลื่อนไหวทุกรายการของสินค้าแยกตามสาขา

### 4. ระบบผู้ดูแลระบบ (Admin)
- จัดการผู้ใช้งาน กำหนดบทบาท (Admin, Manager, Cashier, Stock Keeper)
- กำหนดสิทธิ์รายเมทริกซ์ (เปิดดู, เพิ่ม, แก้ไข, ลบ, ยกเลิกบิล)
- กำหนดรูปแบบเลขที่ใบเสร็จด้วย Token เช่น `{PREFIX}{BRANCH}-{YYYY}{MM}{DD}-{RUN:5}` พร้อมตั้งรอบการรีเซ็ตเลขรันนิ่ง (รายวัน, รายเดือน, รายปี)
- ตั้งค่าโปรไฟล์เครื่องพิมพ์ ขนาดกระดาษ ระยะขอบ และชื่อไดรเวอร์อ้างอิง
- ตั้งค่าระบบเสียงพูด (Rate, Pitch, Voice Selection, Test Speech)
- ตรวจสอบประวัติ Audit Logs

---

## ขั้นตอนการติดตั้งและเชื่อมต่อ

### ขั้นตอนที่ 1: ติดตั้ง Google Apps Script (Backend)
1. เปิด Google Drive ของคุณ และสร้าง **Google Spreadsheet** ใหม่ ตั้งชื่อเช่น `POS & Stock DB`
2. ไปที่เมนู **ส่วนขยาย (Extensions)** -> **Apps Script**
3. คัดลอกโค้ดจากโฟลเดอร์ `backend/` ในโปรเจกต์นี้ไปใส่ใน Apps Script:
   - `Db.gs`
   - `Auth.gs`
   - `Setup.gs`
   - `Receipt.gs`
   - `Products.gs`
   - `Stock.gs`
   - `Sales.gs`
   - `Reports.gs`
   - `Admin.gs`
   - `Code.gs`
   - `appsscript.json` (ตั้ง timezone เป็น `Asia/Bangkok`)
4. ในหน้าต่าง Apps Script เลือกฟังก์ชัน **`setupDatabase`** แล้วกดปุ่ม **Run (เรียกใช้)** 1 ครั้ง
   - กดยอมรับสิทธิ์การเข้าถึง (Authorization)
   - ระบบจะสร้างชีตทั้งหมดและข้อมูลเริ่มต้น (Admin, Cashier, สินค้าตัวอย่าง, การตั้งค่า) โดยอัตโนมัติ
5. กดปุ่ม **Deploy (ทำให้ใช้งานได้)** -> **New deployment (การทำให้ใช้งานได้ใหม่)**:
   - เลือกประเภท: **Web app**
   - Execute as: **Me (ฉัน)**
   - Who has access: **Anyone (ทุกคน)**
   - กด **Deploy** แล้วคัดลอก **Web app URL** (ลงท้ายด้วย `/exec`)

---

### ขั้นตอนที่ 2: ตั้งค่า URL ในหน้าเว็บ Frontend
1. เปิดไฟล์ `frontend/config.js` และใส่ Web app URL ลงในตัวแปร `API_URL`:
   ```javascript
   const CONFIG = {
     API_URL: "https://script.google.com/macros/s/AKfycb.../exec",
     ...
   };
   ```
   *(หรือสามารถเปิดหน้าเว็บแล้วกดปุ่ม "⚙️ ตั้งค่า API URL" ในหน้า Login เพื่อใส่ URL ก็ได้เช่นกัน)*

---

### ขั้นตอนที่ 3: บัญชีผู้ใช้งานเริ่มต้น
| บทบาท | Username | Password | สิทธิ์ |
|---|---|---|---|
| **ผู้ดูแลระบบ (Admin)** | `admin` | `Admin1234!` | สูงสุด เข้าถึงได้ทุกระบบ |
| **พนักงานขาย (Cashier)** | `cashier` | `Cashier1234!` | เข้าเฉพาะหน้าขาย (POS) |

---

### ขั้นตอนที่ 4: การตั้งค่าพิมพ์ใบเสร็จออโต้แบบเงียบ (Kiosk Printing)
1. ติดตั้งเครื่องพิมพ์ใบเสร็จความร้อน (เช่น ขนาด 58 มม. หรือ 80 มม.) ลงในเครื่องคอมพิวเตอร์
2. ตั้งค่าเครื่องพิมพ์ใบเสร็จให้เป็น **Default Printer (เครื่องพิมพ์เริ่มต้น)** ใน Windows Settings
3. รันไฟล์ `start-pos-kiosk.bat` ในโฟลเดอร์โปรเจกต์นี้
   - สคริปต์จะเปิด Google Chrome พร้อมพารามิเตอร์ `--kiosk-printing`
   - เมื่อทำการขายในหน้า POS ใบเสร็จจะถูกส่งพิมพ์ตรงไปยังเครื่องพิมพ์ทันทีโดยไม่เด้งหน้าต่างตัวอย่างการพิมพ์ขึ้นมารบกวน

---

## การ Deploy สู่ GitHub Pages (`clangu89/pos-stock-system`)

โปรเจกต์มี GitHub Actions Workflow อยู่ที่ `.github/workflows/pages.yml` ซึ่งจะนำโฟลเดอร์ `frontend/` ขึ้นสู่ GitHub Pages โดยอัตโนมัติเมื่อ Push ขึ้น Repository:

```powershell
# 1. สร้าง Git Repository
git init
git add .
git commit -m "Initial commit POS & Stock Management System"

# 2. สร้าง GitHub Repository และ Push (บัญชี clangu89)
gh repo create clangu89/pos-stock-system --public --source . --push

# 3. เปิดใช้งาน GitHub Pages ผ่าน GitHub Actions
gh api -X POST repos/clangu89/pos-stock-system/pages -f build_type=workflow
```

เมื่อ Workflow รันเสร็จสิ้น เว็บไซต์จะพร้อมใช้งานที่:
👉 **https://clangu89.github.io/pos-stock-system/**
