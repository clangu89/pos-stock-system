/**
 * numberToThai.js - Convert numbers into Thai Baht text (คำอ่านภาษาไทย)
 * Example: 1250.50 -> "หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์"
 */

function numberToThai(num) {
  if (num === null || num === undefined || isNaN(num)) return '';

  const number = parseFloat(num);
  if (number === 0) return 'ศูนย์บาทถ้วน';

  const isNegative = number < 0;
  const absNum = Math.abs(number);

  // Split integer and satang parts
  const formatted = absNum.toFixed(2);
  const parts = formatted.split('.');
  const integerPart = parts[0];
  const satangPart = parts[1];

  let result = '';
  if (isNegative) result += 'ลบ';

  // Convert Integer Part
  if (parseInt(integerPart, 10) > 0) {
    result += convertIntegerToThai(integerPart) + 'บาท';
  }

  // Convert Satang Part
  const satangVal = parseInt(satangPart, 10);
  if (satangVal === 0) {
    result += 'ถ้วน';
  } else {
    result += convertIntegerToThai(satangPart) + 'สตางค์';
  }

  return result;
}

function convertIntegerToThai(strNum) {
  const digits = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const units = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

  let text = '';
  const len = strNum.length;

  for (let i = 0; i < len; i++) {
    const digit = parseInt(strNum.charAt(i), 10);
    const pos = (len - i - 1) % 6;

    if (digit !== 0) {
      if (pos === 1 && digit === 1) {
        text += 'สิบ';
      } else if (pos === 1 && digit === 2) {
        text += 'ยี่สิบ';
      } else if (pos === 0 && digit === 1 && len > 1) {
        text += 'เอ็ด';
      } else {
        text += digits[digit] + units[pos];
      }
    }

    if (pos === 0 && i < len - 1) {
      text += 'ล้าน';
    }
  }

  return text;
}

// Support both ES module and browser script tag
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { numberToThai, convertIntegerToThai };
}
