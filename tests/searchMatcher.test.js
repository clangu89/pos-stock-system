const test = require('node:test');
const assert = require('node:assert/strict');
const SalesModule = require('../frontend/js/modules/sales.js');

const sampleProducts = [
  {
    sku: 'BEV-001',
    barcode: '885012345678',
    name: 'น้ำอัดลม โค้ก แคน 325ml',
    categoryName: 'เครื่องดื่ม',
    salePrice: 15,
    stockQty: 24,
    unit: 'กระป๋อง'
  },
  {
    sku: 'BEV-002',
    barcode: '885012345679',
    name: 'น้ำดื่มตรา สิงห์ 600ml',
    categoryName: 'เครื่องดื่ม',
    salePrice: 10,
    stockQty: 50,
    unit: 'ขวด'
  },
  {
    sku: 'SNK-001',
    barcode: '885098765432',
    name: 'มันฝรั่งทอดกรอบ เลย์ รสคลาสสิค 50g',
    categoryName: 'ขนมขบเคี้ยว',
    salePrice: 20,
    stockQty: 30,
    unit: 'ซอง'
  },
  {
    sku: 'BEV-003',
    barcode: '885012345680',
    name: 'โค้ก ซีโร่ ไม่มีน้ำตาล 325ml',
    categoryName: 'เครื่องดื่ม',
    salePrice: 15,
    stockQty: 18,
    unit: 'กระป๋อง'
  },
  {
    sku: 'FOD-001',
    barcode: '885112233445',
    name: 'ข้าวผัดกะเพราหมูสับไข่ดาว',
    categoryName: 'อาหารพร้อมทาน',
    salePrice: 55,
    stockQty: 10,
    unit: 'กล่อง'
  }
];

test('Search Matcher: 1. Exact Barcode Match has highest priority (Score 1000)', () => {
  const p = sampleProducts[0];
  const score = SalesModule.calculateSearchScore(p, '885012345678');
  assert.equal(score, 1000, 'Exact barcode should score 1000');
});

test('Search Matcher: 2. Exact SKU Match scores 950', () => {
  const p = sampleProducts[0];
  const score = SalesModule.calculateSearchScore(p, 'BEV-001');
  assert.equal(score, 950, 'Exact SKU should score 950');
});

test('Search Matcher: 3. Exact Name Match scores 900', () => {
  const p = sampleProducts[3];
  const score = SalesModule.calculateSearchScore(p, 'โค้ก ซีโร่ ไม่มีน้ำตาล 325ml');
  assert.equal(score, 900, 'Exact product name should score 900');
});

test('Search Matcher: 4. Prefix Barcode & SKU Match', () => {
  const p = sampleProducts[0];
  const scoreBarcode = SalesModule.calculateSearchScore(p, '885012');
  assert.equal(scoreBarcode, 850, 'Barcode prefix match should score 850');

  const scoreSku = SalesModule.calculateSearchScore(p, 'bev-00');
  assert.equal(scoreSku, 800, 'SKU prefix match should score 800');
});

test('Search Matcher: 5. Barcode Ends With Query (Partial Barcode)', () => {
  const p = sampleProducts[0]; // barcode 885012345678
  const score = SalesModule.calculateSearchScore(p, '5678');
  assert.equal(score, 720, 'Barcode ending with query should score 720');
});

test('Search Matcher: 6. Substring in Name Match', () => {
  const p = sampleProducts[0]; // 'น้ำอัดลม โค้ก แคน 325ml'
  const score = SalesModule.calculateSearchScore(p, 'แคน');
  assert.ok(score >= 600, 'Substring match should score >= 600');
});

test('Search Matcher: 7. Multi-word Search (e.g. "น้ำ สิงห์")', () => {
  const p = sampleProducts[1]; // 'น้ำดื่มตรา สิงห์ 600ml'
  const score = SalesModule.calculateSearchScore(p, 'น้ำ สิงห์');
  assert.equal(score, 550, 'Multi-word match should score 550');
});

test('Search Matcher: 8. Thai Diacritic Tolerance (Missing tones/vowels)', () => {
  // Query "โคก" vs "โค้ก"
  const cokeCan = sampleProducts[0];
  const cokeZero = sampleProducts[3];
  const scoreCokeCan = SalesModule.calculateSearchScore(cokeCan, 'โคก');
  const scoreCokeZero = SalesModule.calculateSearchScore(cokeZero, 'โคก');

  assert.ok(scoreCokeCan >= 480, 'Query "โคก" should match "โค้ก" in coke can');
  assert.ok(scoreCokeZero >= 520, 'Query "โคก" should match prefix "โค้ก" in coke zero');

  // Query "เลย" vs "เลย์"
  const lays = sampleProducts[2];
  const scoreLays = SalesModule.calculateSearchScore(lays, 'เลย');
  assert.ok(scoreLays >= 480, 'Query "เลย" should match "เลย์" with diacritic tolerance');
});

test('Search Matcher: 9. Ranking Ordering across multiple products', () => {
  // Query "โค้ก"
  const ranked = sampleProducts
    .map(p => ({ p, score: SalesModule.calculateSearchScore(p, 'โค้ก') }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  assert.ok(ranked.length >= 2, 'Should find at least 2 coke products');
  // 'โค้ก ซีโร่...' starts with 'โค้ก' so it should rank higher than 'น้ำอัดลม โค้ก...'
  assert.equal(ranked[0].p.sku, 'BEV-003', 'Coke Zero (prefix match) ranks higher');
  assert.equal(ranked[1].p.sku, 'BEV-001', 'Coke Can (substring match) ranks second');
});

test('Search Matcher: 10. Text Highlighting with Safe HTML Escaping', () => {
  const highlighted = SalesModule.highlightMatchedText('น้ำดื่มตรา สิงห์ 600ml', 'สิงห์');
  assert.ok(highlighted.includes('<mark class="bg-amber-200 text-amber-950 font-bold px-0.5 rounded">สิงห์</mark>'));

  // Test XSS prevention
  const xssText = '<b>Attack</b> 100ml';
  const safeHighlight = SalesModule.highlightMatchedText(xssText, 'Attack');
  assert.ok(!safeHighlight.includes('<b>Attack</b>'), 'Should not render raw HTML tags');
  assert.ok(safeHighlight.includes('&lt;b&gt;'), 'Should escape HTML tags');

  // Test Thai diacritic highlighting
  const thaiHighlight = SalesModule.highlightMatchedText('น้ำอัดลม โค้ก แคน', 'โคก');
  assert.ok(thaiHighlight.includes('<mark class="bg-amber-200 text-amber-950 font-bold px-0.5 rounded">โค้ก</mark>'), 'Should highlight "โค้ก" when query is "โคก"');
});
