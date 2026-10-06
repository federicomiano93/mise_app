// «Import from invoices» — how the screen is wired: who sees the button, what the data layer reads and
// writes, what the two forms gained, and that every word exists in both languages.
// The pure parts are tested in invoice-import-plan.test.mjs and invoice-import-model.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { _dictionaries } from '../js/i18n.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// Comments are where this project explains itself and they name the very calls these tests forbid.
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const MAIN = codeOf(read('js/orders/registry-main.js'));
const SCREEN = codeOf(read('js/orders/invoice-import-screen.js'));
const DATA = codeOf(read('js/orders/invoice-import-data.js'));
const PAGE = read('suppliers.html');
const SW = read('sw.js');

// ── The button ──────────────────────────────────────────────────────────────────

test('⚠️ the button is in the bottom bar, hidden until the session says the person may use it', () => {
  const bar = PAGE.match(/<div class="recipe-footer"[\s\S]*?<\/div>/)[0];
  const button = bar.match(/<button[^>]*id="registry-import-btn"[^>]*>[\s\S]*?<\/button>/);
  assert.ok(button, 'suppliers.html must carry #registry-import-btn inside the bottom bar');
  assert.match(button[0], /class="recipe-footer-btn"/);
  assert.match(button[0], /\bhidden\b/, 'hidden from the first paint, never shown to staff for a moment');
  assert.match(button[0], /data-i18n="invoiceImport\.open"/);
  assert.match(button[0], /<svg[^>]*stroke="currentColor"[^>]*stroke-width="2"/, 'a stroked inline SVG icon, never an emoji');
});

test('⚠️ the button is gated on the role AND the Food cost section, and the bar only follows its buttons', () => {
  assert.match(MAIN, /importBtn\.hidden = !\(canManageHere\(\) && mayWritePrices\(\)\);/,
    'an import writes prices: the same pair the rules ask for (mayWritePrices)');
  assert.match(MAIN, /importBtn\?\.addEventListener\('click', \(\) => \{\s*if \(!\(canManageHere\(\) && mayWritePrices\(\)\)\) return;/,
    'the click asks again');
  assert.match(MAIN, /footerEl\.hidden = !\[\.\.\.footerEl\.children\]\.some\(child => !child\.hidden\);/,
    'the bar stays derived from its children — never gated on a role itself');
  assert.match(MAIN, /import \{ openInvoiceImport \} from '\.\/invoice-import-screen\.js';/);
});

test('the screen is handed live getters and the venue\'s OUTPUT language, read when it is needed', () => {
  const call = MAIN.slice(MAIN.indexOf('openInvoiceImport({'));
  assert.match(call, /suppliers: \(\) => state\.suppliers/);
  assert.match(call, /ingredients: \(\) => state\.ingredients/);
  assert.match(call, /prices: \(\) => state\.ingredientPrices/);
  assert.match(call, /ready: \(\) => state\.loaded\.suppliers && state\.loaded\.ingredients && state\.pricesReadable === true/,
    'a plan drawn before the suppliers arrived would call every supplier new');
  assert.match(call, /opener: importBtn/, 'focus goes back to the footer button on close');
  assert.match(MAIN, /watchCollection\(COLLECTIONS\.suppliers, list => \{\s*state\.suppliers = list;\s*state\.loaded\.suppliers = true;/);
  assert.match(call, /language: \(\) => outputLanguage\(currentSession\(\)\.location\)/);
});

// ── The screen ──────────────────────────────────────────────────────────────────

test('the screen imports nothing from another feature and no native dialog is used', () => {
  for (const m of SCREEN.matchAll(/from '([^']+)'/g)) {
    assert.match(m[1], /^(\.\/|\.\.\/[a-z0-9-]+\.js$)/, `${m[1]} reaches into another folder`);
  }
  assert.doesNotMatch(SCREEN, /(^|[^.\w])(confirm|alert)\(/);
  assert.match(SCREEN, /import \{ confirmDialog, alertDialog \} from '\.\/confirm-dialog\.js'/);
});

test('⚠️ no phrase is frozen at module load: every t() sits inside a function', () => {
  for (const file of ['js/orders/invoice-import-screen.js', 'js/orders/invoice-import-plan.js', 'js/orders/invoice-import-data.js']) {
    const code = codeOf(read(file));
    assert.doesNotMatch(code, /^(const|let|var)\s+\w+\s*=\s*t\(/m, `${file} reads the language at module load`);
  }
  assert.match(SCREEN, /import \{ t, localeTag \} from '\.\.\/i18n\.js';/);
});

test('leaving asks first (danger), is off while writing, and nothing is written before a confirmation', () => {
  assert.match(SCREEN, /backBtn\.disabled = s\.busy;/);
  assert.match(SCREEN, /if \(s\.busy\) return;/);
  assert.match(SCREEN, /if \(s\.file && !s\.finished\) \{\s*const ok = await confirmDialog\(\{[\s\S]*?danger: true,/);
  // each write is behind its own confirmation
  assert.match(SCREEN, /async function saveSuppliers[\s\S]*?const ok = await confirmDialog\([\s\S]*?if \(!ok\) return;[\s\S]*?createImportedSupplier/);
  assert.match(SCREEN, /async function confirmAndRun[\s\S]*?const ok = await confirmDialog\([\s\S]*?if \(!ok\) return;\s*await runImport/);
});

test('⚠️ each row is planned AGAIN on fresh server data before anything is written, and the run stops only on a refusal or no connection', () => {
  const run = SCREEN.slice(SCREEN.indexOf('async function runImport'));
  const replan = run.indexOf('await replanRow(');
  const write = run.indexOf('await runImportBatches(batches)', replan);
  assert.ok(replan > 0 && write > replan, 'replanRow must run before runImportBatches');
  assert.match(run, /freshIngredientsForSupplier\(supplierId\)/);
  assert.match(run, /invoicePointIds\(id\)/);
  assert.match(run, /freshPrice\(id\)/);
  assert.match(run, /ingredientWrites\(fresh\.row, fileIngredient, new Date\(\)\.toISOString\(\), \{ language \}\)/);
  assert.match(run, /if \(kind\) \{ stopped = kind; notRun = writing\.length - i - 1; break; \}/);
  assert.match(run, /if \(fresh\.waiting\)/, 'a row that became a question is never guessed');
});

test('accessibility: real controls, chips with aria-pressed, a live region, focus on the heading', () => {
  assert.match(SCREEN, /'aria-pressed': String\(s\.filter === f\)/);
  assert.match(SCREEN, /role: 'status', 'aria-live': 'polite'/);
  assert.match(SCREEN, /el\('label', \{ class: 'invimp-choice-label', for: id/);
  assert.match(SCREEN, /h\.focus\(\{ preventScroll: true \}\)/);
  assert.match(SCREEN, /accept: '\.zip,\.xml,\.json,application\/zip,application\/json', multiple: ''/);
  assert.match(SCREEN, /await file\.text\(\)/);
  // the status is always a word, the colour only repeats it
  assert.match(SCREEN, /pill\(TONES\[row\.status\], t\(STATUS_KEYS\[row\.status\]\)\)/);
});

test('the screen has no way to write an allergen: the model, the plan and the data layer say so', () => {
  assert.doesNotMatch(SCREEN + DATA, /allergens|mayContain|allergensCheckedAt|nutrition|packIngredients/);
});

// ── The data layer ──────────────────────────────────────────────────────────────

test('⚠️ the data layer reads from the SERVER, refuses to start offline and never overwrites a supplier', () => {
  assert.match(DATA, /getDocsFromServer/);
  assert.match(DATA, /getDocFromServer/);
  assert.doesNotMatch(DATA, /\bgetDocs\(|\bgetDoc\(/, 'a cache answer would make the fresh check a lie');
  assert.match(DATA, /navigator\.onLine === false/);
  assert.match(DATA, /saveSupplierRecord\(null, data\)/);
  assert.match(DATA, /saveSupplierRecord\(supplierId, \{ vatNumber \}\)/, 'the only field ever written onto an existing supplier');
  assert.match(DATA, /where\('source', '==', 'invoice'\)/, 'single-field equality: no composite index');
  assert.match(DATA, /where\('supplierId', '==', supplierId\)/);
  assert.match(DATA, /batch\.set\(ref, data, \{ merge: true \}\);\s*else batch\.set\(ref, data\);/, 'points are created, never merged');
  assert.match(DATA, /await withTimeout\(batch\.commit\(\)\)/);
});

test('⚠️ the suppliers step re-reads the suppliers from the server before writing, and no write can hang', () => {
  assert.match(DATA, /export async function freshSuppliers\(\) \{[\s\S]*?withTimeout\(getDocsFromServer\(collection\(db, pathFor\(SUPPLIERS\)\)\)\)/);
  assert.match(DATA, /return withTimeout\(saveSupplierRecord\(null, data\)\)/);
  assert.match(DATA, /return withTimeout\(saveSupplierRecord\(supplierId, \{ vatNumber \}\)\)/);
  const save = SCREEN.slice(SCREEN.indexOf('async function saveSuppliers'), SCREEN.indexOf('function finishSuppliers'));
  const fresh = save.indexOf('await freshSuppliers()');
  assert.ok(fresh > 0 && save.indexOf('await createImportedSupplier') > fresh, 'the fresh read comes before the first write');
  assert.ok(save.indexOf('await linkSupplierVat') > fresh);
  assert.match(save, /changedSupplierKeys\(s\.supplierPlan, fresh, settled\)/);
  assert.match(save, /t\('invoiceImport\.suppliers\.changed'\)/);
});

test('the screen is a dialog, its file box is a label for a hidden input, and a chip with nothing under it is not drawn', () => {
  assert.match(SCREEN, /role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'invimp-title'/);
  assert.match(SCREEN, /el\('h1', \{ id: 'invimp-title' \}\)/);
  assert.match(SCREEN, /opener\.focus\(\)/);
  assert.match(SCREEN, /class: 'btn-secondary invimp-file-btn', for: 'invimp-file'/);
  assert.match(SCREEN, /visibleFilters\(counts, s\.filter\)\.map/);
  const css = read('orders.css');
  assert.match(css, /\.invimp-file-btn \{[^}]*min-height: 44px/, 'a target of at least 44 px');
  assert.match(css, /\.invimp-file-input:focus-visible \+ \.invimp-file-btn \{ outline: 3px solid var\(--accent-2\)/, 'the focus ring shows on the label');
  assert.doesNotMatch(css.match(/\.invimp-file-input \{[^}]*\}/)[0], /display: none|visibility: hidden/, 'hidden by size, never display:none (it would leave the keyboard)');
});

test('the data layer exports what the screen and the brief name', async () => {
  for (const name of ['createImportedSupplier', 'linkSupplierVat', 'freshSuppliers', 'freshIngredientsForSupplier', 'invoicePointIds', 'freshPrice', 'runImportBatches']) {
    assert.match(read('js/orders/invoice-import-data.js'), new RegExp(`export async function ${name}\\b`));
  }
});

// ── The service worker ──────────────────────────────────────────────────────────

test('⚠️ the new files are precached, spelled like the real files', () => {
  for (const file of ['js/orders/invoice-import-model.js', 'js/orders/invoice-import-plan.js',
    'js/orders/invoice-import-data.js', 'js/orders/invoice-import-screen.js', 'js/pack-format.js', 'js/vat-number.js']) {
    assert.ok(SW.includes(`'./${file}'`), `sw.js must precache ./${file}`);
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${file} does not exist`);
  }
});

// ── The two forms ───────────────────────────────────────────────────────────────

function installFakeDom() {
  class FakeNode {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.dataset = {}; this.style = {};
      this.attrs = {}; this.listeners = {}; this.value = ''; this.checked = false;
      this.className = ''; this.textContent = ''; this.disabled = false;
    }
    appendChild(c) { this.children.push(c); return c; }
    setAttribute(k, v) { this.attrs[k] = v; if (k === 'value') this.value = v; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    focus() { this.focused = true; }
    querySelector(sel) {
      for (const c of this.children) {
        if (c.tagName === sel) return c;
        const deeper = c.querySelector?.(sel);
        if (deeper) return deeper;
      }
      return null;
    }
    all(pred, out = []) {
      this.children.forEach(c => { if (c.tagName) { if (pred(c)) out.push(c); c.all(pred, out); } });
      return out;
    }
  }
  globalThis.document = { createElement: tag => new FakeNode(tag), createTextNode: text => ({ text }) };
}

async function submitSupplier({ item, vat }) {
  installFakeDom();
  const { buildSupplierForm } = await import('../js/supplier-record-form.js');
  const saved = [];
  const form = buildSupplierForm({ item, save: async (id, payload) => { saved.push(payload); return id || 'new'; }, onDone: () => {} });
  const inputs = form.all(n => n.tagName === 'input' && n.attrs.type !== 'checkbox');
  const [name, , , , , vatBox] = inputs;
  name.value = 'Mulino Esempio';
  if (vat !== undefined) vatBox.value = vat;
  const save = form.headerSave;
  await save.listeners.click();
  return { saved, vatBox };
}

test('the supplier form has an optional VAT number, prefilled, capped at 30 and saved normalised', async () => {
  const fresh = await submitSupplier({ item: null, vat: ' it 0000 0000 001 ' });
  assert.equal(fresh.saved[0].vatNumber, 'IT00000000001');
  assert.equal(fresh.vatBox.attrs.maxlength, '30');
  assert.equal(fresh.vatBox.attrs.autocomplete, 'off');

  const empty = await submitSupplier({ item: null });
  assert.equal(empty.saved[0].vatNumber, '', 'present and empty, so a merge write can clear it');

  // ⚠️ A number typed WITHOUT «IT» is saved the way an invoice carries it, so the import finds the supplier.
  const bare = await submitSupplier({ item: null, vat: ' 000.000.000.01 ' });
  assert.equal(bare.saved[0].vatNumber, 'IT00000000001');
  const foreign = await submitSupplier({ item: null, vat: 'de 123456789' });
  assert.equal(foreign.saved[0].vatNumber, 'DE123456789', 'a foreign prefix is left alone');
  assert.equal(fresh.vatBox.attrs.placeholder, 'IT01234567890', 'the box shows what a full number looks like');

  const prefilled = await submitSupplier({ item: { id: 's1', name: 'Mulino Esempio', vatNumber: 'IT00000000001', active: true } });
  assert.equal(prefilled.vatBox.value, 'IT00000000001');
  assert.equal(prefilled.saved[0].vatNumber, 'IT00000000001');
});

test('a price in the history that came from an invoice says so in words', () => {
  const form = codeOf(read('js/ingredient-record-form.js'));
  assert.match(form, /entry\.source === 'invoice' \? el\('span', \{ class: 'mgmt-price-tag', text: t\('orders\.priceFromInvoice'\) \}\) : null/);
  assert.match(read('orders.css'), /\.mgmt-price-tag \{/);
});

// ── Words ───────────────────────────────────────────────────────────────────────

test('every invoiceImport key the code asks for exists in English AND Italian, with the same plural shape', () => {
  const dict = _dictionaries();
  const used = new Set();
  for (const src of [read('js/orders/invoice-import-screen.js'), PAGE, read('js/supplier-record-form.js'), read('js/ingredient-record-form.js')]) {
    for (const m of src.matchAll(/'((?:invoiceImport\.[A-Za-z.]+)|orders\.field\.vatNumber|orders\.priceFromInvoice)'|data-i18n="(invoiceImport\.[A-Za-z.]+)"/g)) used.add(m[1] || m[2]);
  }
  // keys the screen builds from a table
  for (const m of read('js/orders/invoice-import-screen.js').matchAll(/'(invoiceImport\.[A-Za-z.]+)'/g)) used.add(m[1]);
  assert.ok(used.size > 80, `only ${used.size} keys found: the scan read almost nothing`);
  for (const key of used) {
    assert.ok(key in dict.en, `${key} is missing in English`);
    assert.ok(key in dict.it, `${key} is missing in Italian`);
    assert.equal(typeof dict.en[key], typeof dict.it[key], `${key} is a plural in one language and not the other`);
    if (typeof dict.en[key] === 'object') {
      for (const lang of ['en', 'it']) {
        assert.deepEqual(Object.keys(dict[lang][key]).sort(), ['one', 'other']);
        assert.match(dict[lang][key].one, /\{n\}/);
        assert.match(dict[lang][key].other, /\{n\}/);
      }
    }
  }
  const asked = [...used].filter(k => k.startsWith('invoiceImport.'));
  Object.keys(dict.en).filter(k => k.startsWith('invoiceImport.')).forEach(k => {
    assert.ok(asked.includes(k), `${k} is in the dictionary and nothing asks for it`);
  });
});

test('the labels the owner agreed are the ones on screen', () => {
  const { en, it } = _dictionaries();
  assert.equal(en['invoiceImport.open'], 'Import from invoices');
  assert.equal(it['invoiceImport.open'], 'Importa da fatture');
  assert.equal(en['orders.field.vatNumber'], 'VAT number');
  assert.equal(it['orders.field.vatNumber'], 'P.IVA');
  assert.equal(en['orders.priceFromInvoice'], 'invoice');
  assert.equal(it['orders.priceFromInvoice'], 'fattura');
  assert.equal(en['invoiceImport.status.maybe'], 'Maybe this one?');
  assert.equal(en['invoiceImport.sameAs'], 'Same as {name}');
  assert.equal(en['invoiceImport.suppliers.createNew'], 'Create a new supplier');
  assert.equal(en['invoiceImport.ing.createNew'], 'Create a new ingredient');
  assert.equal(en['invoiceImport.file.notJson'], 'This is not an import file.');
  assert.equal(en['invoiceImport.file.label'], 'Choose the file');
  assert.equal(it['invoiceImport.file.label'], 'Scegli il file');
  assert.equal(en['invoiceImport.suppliers.changed'], 'The supplier list changed: check again.');
  assert.match(en['invoiceImport.summary.remember'], /“unisci con \{target\}”/);
  assert.match(it['invoiceImport.summary.remember'], /«unisci con \{target\}»/);
});

// ── The invoices path: remembered decisions, reason codes, precache ──────────────

test('⚠️ the decisions data layer reads from the SERVER, refuses offline, writes small bounded batches through pathFor', () => {
  assert.match(DATA, /const DECISIONS = 'invoice-decisions';/);
  const load = DATA.slice(DATA.indexOf('export async function loadInvoiceDecisions'), DATA.indexOf('export async function writeInvoiceDecisions'));
  assert.match(load, /refuseOffline\(\);/);
  assert.match(load, /withTimeout\(getDocsFromServer\(collection\(db, pathFor\(DECISIONS\)\)\)\)/);
  assert.doesNotMatch(load, /\bgetDocs\(/);
  const write = DATA.slice(DATA.indexOf('export async function writeInvoiceDecisions'));
  assert.match(write, /refuseOffline\(\);/);
  assert.match(write, /planDecisionBatches\(changes, \{ bakery: currentLocationId\(\), nowIso: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(write, /batch\.set\(ref, op\.data, \{ merge: true \}\)/);
  assert.match(write, /else batch\.delete\(ref\)/);
  assert.match(write, /await withTimeout\(batch\.commit\(\)\)/);
  assert.match(write, /collection\(db, pathFor\(DECISIONS\)\)/, 'the path is built by location.js, like every collection');
});

test('⚠️ the remembered decisions are written BEFORE the rows, and a failure there stops nothing else', () => {
  const run = SCREEN.slice(SCREEN.indexOf('async function runImport'));
  const decisions = run.indexOf('await writeInvoiceDecisions(');
  assert.ok(decisions > 0 && decisions < run.indexOf('await replanRow('), 'decisions first');
  assert.match(run, /catch \(err\) \{\s*console\.error\('Remembering the decisions failed:', err\);\s*s\.decisionsFailed = true;/);
  assert.match(SCREEN, /async function finishWithoutRows[\s\S]*?const ok = await confirmDialog\([\s\S]*?if \(!ok\) return;[\s\S]*?await writeInvoiceDecisions/,
    'a run that ends with nothing to import still asks before it remembers');
});

test('the invoices are read in memory after the browser has painted «reading», with the platform parser', () => {
  assert.match(SCREEN, /new DOMParser\(\)\.parseFromString\(text, 'application\/xml'\)/);
  assert.match(SCREEN, /await new Promise\(resolve => setTimeout\(resolve, 0\)\);\s*try \{/);
  assert.match(SCREEN, /new Uint8Array\(await file\.arrayBuffer\(\)\)/);
  assert.match(SCREEN, /buildImportFromInvoices\(inputs, \{ parseXml, now: new Date\(\), salt \}\)/);
  assert.match(SCREEN, /await file\.text\(\)/, 'a .json file keeps its old path');
});

test('every reason code of the invoice reader that can reach the screen has a phrase', async () => {
  const { NOTE, LEFT_OUT, SKIPPED } = await import('../js/orders/invoice-zip/reasons.js');
  const dict = _dictionaries();
  const codes = [...Object.values(NOTE).slice(Object.values(NOTE).indexOf('egg-quantity-unclear')), ...Object.values(LEFT_OUT), ...Object.values(SKIPPED)]
    .filter(code => code !== LEFT_OUT.NOT_AN_INGREDIENT);
  assert.ok(codes.length >= 20);
  for (const code of codes) {
    const hit = SCREEN.match(new RegExp(`'${code}': '(invoiceImport\.code\.[A-Za-z]+)'`));
    assert.ok(hit, `${code} has no phrase in the screen's table`);
    for (const lang of ['en', 'it']) assert.ok(dict[lang][hit[1]], `${hit[1]} is missing in ${lang}`);
  }
});

test('the new files are precached, spelled like the real files', () => {
  const files = readdirSync(new URL('../js/orders/invoice-zip/', import.meta.url)).map(f => `js/orders/invoice-zip/${f}`);
  assert.ok(files.includes('js/orders/invoice-zip/selection.js'));
  for (const file of [...files, 'js/vendor/fflate.esm.js']) {
    assert.ok(SW.includes(`'./${file}'`), `sw.js must precache ./${file}`);
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${file} does not exist`);
  }
});

test('the words the owner reads on the invoices path are the agreed ones, in both languages', () => {
  const { en, it } = _dictionaries();
  assert.match(en['invoiceImport.file.explain'], /zip of the invoices .* Agenzia delle Entrate .* \.json/);
  assert.match(it['invoiceImport.file.explain'], /zip delle fatture .*Agenzia delle Entrate .* \.json/);
  assert.equal(it['invoiceImport.file.reading'], 'Sto leggendo le fatture…');
  assert.equal(it['invoiceImport.zip.group.notImported'].other, 'Imballaggi e rivendita ({n})');
  assert.equal(it['invoiceImport.zip.group.skippedByYou'].other, 'Esclusi da te ({n})');
  assert.equal(it['invoiceImport.zip.group.skippedSuppliers'].other, 'Fornitori esclusi da te ({n})');
  assert.equal(it['invoiceImport.zip.importAsIngredient'], 'Importa come ingrediente');
  assert.equal(it['invoiceImport.zip.importAgain'], 'Importa di nuovo');
  assert.equal(it['invoiceImport.ing.forget'], 'Non importare (ricordalo)');
  assert.equal(it['invoiceImport.status.priceCheck'], 'Prezzo da controllare');
  assert.equal(it['invoiceImport.summary.decisions'].other, 'Decisioni ricordate: {n}');
});

test('⚠️ recording price changes is its own try/catch and never sets `stopped`; «Done» never runs the import', () => {
  const run = SCREEN.slice(SCREEN.indexOf('async function runImport'));
  const record = run.slice(run.indexOf('const recordChanges'), run.indexOf('const createdThisRun'));
  assert.match(record, /try \{[\s\S]*?planPriceChanges[\s\S]*?\} catch \(err\) \{[\s\S]*?failed: 1/);
  assert.doesNotMatch(record, /stopped|stopKind/);
  const finish = SCREEN.slice(SCREEN.indexOf('async function finishWithoutRows'), SCREEN.indexOf('const quietRows'));
  assert.doesNotMatch(finish, /runImport\(/, '«Done» writes nothing but the confirmed decisions');
  const only = SCREEN.slice(SCREEN.indexOf('async function recordChangesOnly'), SCREEN.indexOf('// ── Writing, row by row'));
  assert.match(only, /await confirmDialog\([\s\S]*?if \(!ok\) return;\s*await runImport/);
  assert.match(SCREEN, /s\.selection && quietRows\(entries\)\.length > 0/);
  assert.match(SCREEN, /t\('invoiceImport\.ing\.confirmChanges'\)/);
});
