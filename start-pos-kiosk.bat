@echo off
chcp 65001 >nul
echo ========================================================
echo   เปิดระบบขายสินค้า POS ในโหมดพิมพ์ใบเสร็จอัตโนมัติ (Kiosk Printing)
echo ========================================================
echo.
echo กำลังเปิด Google Chrome ด้วยพารามิเตอร์ --kiosk-printing...
echo (หมายเหตุ: ตรวจสอบให้แน่ใจว่าได้ตั้งเครื่องพิมพ์ใบเสร็จเป็น Default Printer ใน Windows แล้ว)
echo.

set "TARGET_URL=https://clangu89.github.io/pos-stock-system/"

if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    start "" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" --kiosk-printing "%TARGET_URL%"
) else if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --kiosk-printing "%TARGET_URL%"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --kiosk-printing "%TARGET_URL%"
) else if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --kiosk-printing "%TARGET_URL%"
) else (
    echo ไม่พบ Google Chrome หรือ Microsoft Edge ในตำแหน่งมาตรฐาน
    start "%TARGET_URL%"
)

exit
