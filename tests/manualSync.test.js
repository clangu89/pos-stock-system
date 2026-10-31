const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'frontend', 'index.html');
const MANUAL_MD_PATH = path.join(ROOT_DIR, 'docs', 'USER_MANUAL.md');
const MANUAL_DATA_PATH = path.join(ROOT_DIR, 'frontend', 'js', 'modules', 'manualData.js');
const MANUAL_JS_PATH = path.join(ROOT_DIR, 'frontend', 'js', 'modules', 'manual.js');
const ROUTER_JS_PATH = path.join(ROOT_DIR, 'frontend', 'js', 'router.js');

test('Manual Sync: update-manual.js --verify runs successfully and reports in sync', () => {
  const result = execSync('node scripts/update-manual.js --verify', { cwd: ROOT_DIR, encoding: 'utf-8' });
  assert.match(result, /Documentation is in sync with codebase/);
});

test('Manual Integrity: docs/USER_MANUAL.md exists and contains complete documentation', () => {
  assert.ok(fs.existsSync(MANUAL_MD_PATH), 'docs/USER_MANUAL.md should exist');
  const mdContent = fs.readFileSync(MANUAL_MD_PATH, 'utf-8');
  assert.ok(mdContent.length > 5000, 'User manual should contain in-depth content');
  assert.match(mdContent, /# คู่มือการใช้งานระบบขายสินค้าและสต๊อกสินค้า/);
  assert.match(mdContent, /## สารบัญคู่มือ/);
  assert.match(mdContent, /ระบบงานขายหน้าร้าน/);
  assert.match(mdContent, /ตารางคีย์ลัด/);
  assert.match(mdContent, /ระบบเสียงพูดแจ้งยอดภาษาไทย/);
  assert.match(mdContent, /การสำรองและกู้คืนฐานข้อมูล/);
  assert.match(mdContent, /การแก้ปัญหาที่พบบ่อย/);
  assert.match(mdContent, /mermaid/);
});

test('Manual Data Module: frontend/js/modules/manualData.js is valid and contains structured topics', () => {
  assert.ok(fs.existsSync(MANUAL_DATA_PATH), 'manualData.js should exist');
  const { ManualData } = require('../frontend/js/modules/manualData.js');
  assert.ok(ManualData, 'ManualData should be exported');
  assert.ok(ManualData.topics.length >= 10, 'Should have at least 10 topics');
  assert.ok(ManualData.shortcuts.length >= 5, 'Should have system shortcuts');
  assert.ok(ManualData.roles.length >= 4, 'Should have at least 4 default roles');

  // Verify key shortcuts are listed
  const shortcutKeys = ManualData.shortcuts.map(s => s.key);
  assert.ok(shortcutKeys.includes('F1'), 'Should include F1 shortcut');
  assert.ok(shortcutKeys.includes('F2'), 'Should include F2 shortcut');
  assert.ok(shortcutKeys.includes('F4'), 'Should include F4 shortcut');
  assert.ok(shortcutKeys.includes('Esc'), 'Should include Esc shortcut');
});

test('In-App Manual DOM: frontend/index.html includes manual view, buttons, and scripts', () => {
  const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');

  // Header Manual Button at Top Right
  assert.match(indexHtml, /id="headerManualBtn"/, 'Should have headerManualBtn');
  assert.match(indexHtml, /Router\.navigate\('manual'\)/, 'Header or buttons should link to manual');
  assert.match(indexHtml, /📖/, 'Should have manual icon');
  assert.match(indexHtml, />คู่มือ</, 'Should have prominent text คู่มือ');
  assert.match(indexHtml, />F1</, 'Should have prominent badge F1');

  // Verify headerManualBtn is inside the right controls div
  const rightControlsMatch = indexHtml.match(/<!-- Right Controls[^>]*-->[\s\S]*?id="headerManualBtn"/);
  assert.ok(rightControlsMatch, 'headerManualBtn must be inside the right controls section (Top Right Menu Bar)');

  // Manual Section View
  assert.match(indexHtml, /id="view_manual"/, 'Should have view_manual container');
  assert.match(indexHtml, /id="manualSearchInput"/, 'Should have manualSearchInput');
  assert.match(indexHtml, /id="manualCategoryTabs"/, 'Should have manualCategoryTabs');
  assert.match(indexHtml, /id="manualTopicsContainer"/, 'Should have manualTopicsContainer');
  assert.match(indexHtml, /id="manualQuickShortcuts"/, 'Should have manualQuickShortcuts');

  // Script tags
  assert.match(indexHtml, /src="js\/modules\/manualData\.js/, 'Should load manualData.js');
  assert.match(indexHtml, /src="js\/modules\/manual\.js/, 'Should load manual.js');
});

test('Router: router.js supports manual view, unauthenticated access, and F1 shortcut', () => {
  const routerCode = fs.readFileSync(ROUTER_JS_PATH, 'utf-8');

  assert.match(routerCode, /hash !== 'manual'/, 'Should exempt manual from strict login redirect');
  assert.match(routerCode, /e\.key === 'F1'/, 'Should handle F1 shortcut to open manual');
  assert.match(routerCode, /ManualModule\.activate\(\)/, 'Should activate ManualModule on view_manual');
  assert.match(routerCode, /goBack\(\)/, 'Should provide goBack function');
  assert.match(routerCode, /header\.classList\.remove\('hidden'\)/, 'Header should remain visible for top-right manual button');
});

test('Launcher: launcher.js includes manual card for quick access', () => {
  const launcherCode = fs.readFileSync(path.join(ROOT_DIR, 'frontend', 'js', 'modules', 'launcher.js'), 'utf-8');
  assert.match(launcherCode, /id:\s*'manual'/, 'Launcher should include manual module');
});
