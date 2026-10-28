/**
 * config.js - Global System Configuration & API Endpoint
 */

const CONFIG = {
  // Apps Script Web App URL
  API_URL: "https://script.google.com/macros/s/AKfycbz1A6FrJl5kPWbYZK4CTj2k5zi_K2gWPQ7OJmzwUY82qcamx49nx8Bct6ylfDDSS6E/exec",

  // ข้อมูลเริ่มต้นสำหรับระบบ
  DEFAULT_STORE_NAME: "POS & Stock Management",
  DEFAULT_BRANCH_ID: "B01",
  DEFAULT_STATION_ID: "POS-01",

  // LocalStorage Keys
  STORAGE_KEYS: {
    API_URL: "pos_api_url",
    TOKEN: "pos_auth_token",
    USER: "pos_auth_user",
    BRANCH_ID: "pos_active_branch_id",
    STATION_ID: "pos_station_id",
    BILLS: "pos_draft_bills",
    ACTIVE_BILL_ID: "pos_active_bill_id",
    VOICE_SETTINGS: "pos_voice_settings",
    PRINTER_PROFILE_ID: "pos_printer_profile_id"
  }
};

// Allow override from localStorage if set in UI settings
(function initConfig() {
  const customUrl = localStorage.getItem(CONFIG.STORAGE_KEYS.API_URL);
  if (customUrl) {
    CONFIG.API_URL = customUrl.trim();
  }
})();
