const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('Search Autofill Prevention: index.html has type="search" and explicit name attributes', () => {
  const htmlPath = path.join(__dirname, '..', 'frontend', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Verify POS Barcode Search input
  assert.match(
    html,
    /<input type="search"[^>]*id="posBarcodeSearchInput"[^>]*name="pos_barcode_search_query"[^>]*autocomplete="off"/,
    'posBarcodeSearchInput must be type="search" with name and autocomplete="off"'
  );

  // Verify Login inputs have explicit name attributes to contain browser password manager
  assert.match(
    html,
    /<input type="text"[^>]*id="loginUsername"[^>]*name="username"/,
    'loginUsername must have name="username"'
  );
  assert.match(
    html,
    /<input type="password"[^>]*id="loginPassword"[^>]*name="password"/,
    'loginPassword must have name="password"'
  );

  // Verify other search inputs across the app are type="search"
  assert.match(html, /<input type="search"[^>]*id="stockSearchInput"[^>]*name="stock_search_query"/);
  assert.match(html, /<input type="search"[^>]*id="receiptSearchInput"[^>]*name="receipt_search_query"/);
  assert.match(html, /<input type="search"[^>]*id="voidSearchReceiptNo"[^>]*name="void_search_receipt_no"/);
  assert.match(html, /<input type="search"[^>]*id="constSearchInput"[^>]*name="const_search_query"/);
  assert.match(html, /<input type="search"[^>]*id="branchSearchInput"[^>]*name="branch_search_query"/);
  assert.match(html, /<input type="search"[^>]*id="categorySearchInput"[^>]*name="category_search_query"/);
  assert.match(html, /<input type="search"[^>]*id="unitSearchInput"[^>]*name="unit_search_query"/);
});

test('Search Autofill Prevention: SalesModule lifecycle and focusBarcodeInput', async () => {
  const salesJsPath = path.join(__dirname, '..', 'frontend', 'js', 'modules', 'sales.js');
  const salesJs = fs.readFileSync(salesJsPath, 'utf8');

  let clearedValue = null;
  let focused = false;
  const mockInput = {
    value: 'admin', // Simulate browser having autofilled "admin"
    dataset: {},
    focus() {
      focused = true;
    },
    addEventListener() {}
  };

  const calledMethods = [];

  const sandbox = {
    console,
    setTimeout: (fn, ms) => {
      fn();
    },
    localStorage: {
      getItem: () => null,
      setItem: () => null
    },
    CONFIG: {
      DEFAULT_BRANCH_ID: 'B01',
      STORAGE_KEYS: { BRANCH_ID: 'pos_branch_id', BILLS: 'pos_bills' }
    },
    UI: {
      showLoading: () => {},
      hideLoading: () => {}
    },
    Api: {
      call: async () => ({
        ok: true,
        products: [],
        categories: []
      })
    },
    document: {
      getElementById(id) {
        if (id === 'posBarcodeSearchInput') return mockInput;
        return null;
      }
    },
    PrintManager: {
      init: () => {}
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(salesJs + '; globalThis.SalesModule = SalesModule;', sandbox);

  const mod = sandbox.SalesModule;
  assert.strictEqual(typeof mod.render, 'function', 'SalesModule.render must be a function');

  // Test focusBarcodeInput clears autofilled username when searchQuery is empty
  mockInput.value = 'admin'; // simulate browser autofill
  mod.searchQuery = '';
  mod.focusBarcodeInput();

  assert.strictEqual(mockInput.value, '', 'focusBarcodeInput must clear autofilled text when searchQuery is empty');
  assert.strictEqual(focused, true, 'focusBarcodeInput must call focus()');

  // Test that if user intentionally has a searchQuery, it is not cleared
  mockInput.value = 'น้ำดื่ม';
  mod.searchQuery = 'น้ำดื่ม';
  mod.focusBarcodeInput();
  assert.strictEqual(mockInput.value, 'น้ำดื่ม', 'focusBarcodeInput must preserve intentional search queries');
});
