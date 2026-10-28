/**
 * api.js - Backend Communication Gateway via text/plain POST (No CORS preflight)
 */

const Api = {
  async call(action, data = {}) {
    if (!CONFIG.API_URL) {
      UI.showToast('กรุณาระบุ URL ของ Google Apps Script Web App ในการตั้งค่าก่อนเริ่มใช้งาน', 'warning');
      return { ok: false, error: 'NO_API_URL', message: 'ไม่ได้ตั้งค่า API URL' };
    }

    const payload = {
      action: action,
      token: Auth.getToken() || '',
      data: data
    };

    try {
      const response = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      if (result && result.error === 'UNAUTHORIZED') {
        Auth.clearSession();
        Router.navigate('login');
        UI.showToast('เซสชันการเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'warning');
      }

      return result;
    } catch (err) {
      console.error(`API Call failed [${action}]:`, err);
      UI.showToast(`การเชื่อมต่อเซิร์ฟเวอร์ล้มเหลว: ${err.message}`, 'error');
      return { ok: false, error: 'NETWORK_ERROR', message: err.message };
    }
  },

  setApiUrl(url) {
    if (!url) return;
    const cleanUrl = url.trim();
    CONFIG.API_URL = cleanUrl;
    localStorage.setItem(CONFIG.STORAGE_KEYS.API_URL, cleanUrl);
    UI.showToast('บันทึก Web App API URL เรียบร้อยแล้ว', 'success');
  }
};
