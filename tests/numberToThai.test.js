const test = require('node:test');
const assert = require('node:assert');
const { numberToThai, convertIntegerToThai } = require('../frontend/js/numberToThai.js');

test('numberToThai zero', () => {
  assert.strictEqual(numberToThai(0), 'ศูนย์บาทถ้วน');
  assert.strictEqual(numberToThai('0.00'), 'ศูนย์บาทถ้วน');
});

test('numberToThai integer baht', () => {
  assert.strictEqual(numberToThai(10), 'สิบบาทถ้วน');
  assert.strictEqual(numberToThai(20), 'ยี่สิบบาทถ้วน');
  assert.strictEqual(numberToThai(21), 'ยี่สิบเอ็ดบาทถ้วน');
  assert.strictEqual(numberToThai(100), 'หนึ่งร้อยบาทถ้วน');
  assert.strictEqual(numberToThai(101), 'หนึ่งร้อยเอ็ดบาทถ้วน');
  assert.strictEqual(numberToThai(1250), 'หนึ่งพันสองร้อยห้าสิบบาทถ้วน');
});

test('numberToThai with satang', () => {
  assert.strictEqual(numberToThai(10.25), 'สิบบาทยี่สิบห้าสตางค์');
  assert.strictEqual(numberToThai(1250.50), 'หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์');
  assert.strictEqual(numberToThai(0.75), 'เจ็ดสิบห้าสตางค์');
});
