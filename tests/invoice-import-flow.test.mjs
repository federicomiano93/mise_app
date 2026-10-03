// «Import from invoices» — the screen EXECUTED, start to finish, over a fake DOM and an in-memory «database».
// What it proves is what the screen DECIDES: which step shows what, what is asked before a write, what is
// written and in which order, what a failure does. How anything looks is the ui-check skill's job.
//
// The data layer, mgmt-ui and the dialog are replaced by tests/helpers/invoice-import-stubs.mjs (they load
// the Firebase SDK from a CDN, which node cannot, and a unit test must never reach a database). The writes
// go through the REAL planBatchWrites, so the documents are the ones the data layer would set. Every name,
// VAT number and invoice id below is INVENTED.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Node, walk } from './helpers/form-dom.mjs';

// The screen logs a failed row for diagnosis (console.error); the tests below fail rows on purpose.
console.error = () => {};

// ── The fake DOM, a little more than form-dom.mjs's ─────────────────────────────

class Dom extends Node {
  focus() { globalThis.document.activeElement = this; this.focused += 1; }
  contains(other) { for (let n = other; n; n = n.parentNode) if (n === this) return true; return false; }
  replaceChildren(...nodes) { this.children = []; this._text = null; nodes.forEach(n => this.appendChild(n)); }
  querySelector(selector) {
    const attr = selector.match(/^\[data-fid="(.+)"\]$/);
    const test = attr ? (n) => n.attributes['data-fid'] === attr[1] : (n) => n.tagName === selector.toUpperCase();
    return walk(this).find(n => n !== this && test(n)) || null;
  }
}
class DomText extends Dom {
  constructor(text) { super('#text'); this._text = String(text); }
}
globalThis.document = {
  body: new Dom('body'),
  activeElement: null,
  createElement: tag => new Dom(tag),
  createTextNode: text => new DomText(text),
  querySelectorAll: () => [],
  addEventListener: () => {},
};

// ── The three modules the screen cannot load under node ─────────────────────────

const stubUrl = new URL('./helpers/invoice-import-stubs.mjs', import.meta.url).href;
const screenHref = pathToFileURL(fileURLToPath(new URL('../js/orders/invoice-import-screen.js', import.meta.url))).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === screenHref && ['./invoice-import-data.js', './mgmt-ui.js', './confirm-dialog.js'].includes(specifier)) {
      return { url: stubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { openInvoiceImport } = await import('../js/orders/invoice-import-screen.js');
const { planBatchWrites } = await import('../js/orders/invoice-import-plan.js');

// ── The in-memory «database» ────────────────────────────────────────────────────

function makeDb() {
  const db = {
    suppliers: [], ingredients: [], prices: {}, points: {},
    calls: [], batches: 0, failOn: null, beforeBatch: null, beforeSuppliers: null, failSupplier: null, n: 0,
  };
  const failure = (code) => Object.assign(new Error(code), { code });
  globalThis.__inv = {
    async createImportedSupplier(data) {
      if (db.failSupplier) throw failure(db.failSupplier);
      const id = `sup-${++db.n}`;
      db.suppliers.push({ id, ...data });
      db.calls.push(['createSupplier', id]);
      return id;
    },
    async linkSupplierVat(id, vatNumber) {
      db.suppliers.find(s => s.id === id).vatNumber = vatNumber;
      db.calls.push(['linkVat', id, vatNumber]);
    },
    async freshSuppliers() {
      if (db.beforeSuppliers) db.beforeSuppliers();
      return db.suppliers.map(s => ({ ...s }));
    },
    async freshIngredientsForSupplier(supplierId) { return db.ingredients.filter(i => i.supplierId === supplierId).map(i => ({ ...i })); },
    async invoicePointIds(id) { return new Set(db.points[id] || []); },
    async freshPrice(id) { return db.prices[id] ? { ...db.prices[id] } : null; },
    async runImportBatches(batches) {
      db.batches += 1;
      if (db.beforeBatch) db.beforeBatch(batches);
      if (db.failOn) { const code = db.failOn(db.batches); if (code) throw failure(code); }
      const plan = planBatchWrites(batches, { mintId: () => `ing-${++db.n}`, bakery: 'loc-test' });
      plan.batches.flat().forEach(({ path, data, merge }) => {
        db.calls.push(['write', path.join('/')]);
        if (path[0] === 'ingredients' && path.length === 2) {
          const at = db.ingredients.findIndex(i => i.id === path[1]);
          if (at < 0) db.ingredients.push({ id: path[1], ...data });
          else db.ingredients[at] = { ...db.ingredients[at], ...data };
        } else if (path[0] === 'ingredient-prices') {
          db.prices[path[1]] = { ...(db.prices[path[1]] || {}), ...data };
        } else {
          const list = (db.points[path[1]] ||= []);
          if (list.includes(path[3])) throw failure('permission-denied');   // create-only, like the rules
          list.push(path[3]);
        }
        assert.equal(merge, !(path[2] === 'prices'));
      });
      return plan.ingredientId;
    },
  };
  return db;
}

const dataOf = (db) => ({
  suppliers: () => db.suppliers,
  ingredients: () => db.ingredients.map(i => ({ ...i, ...(db.prices[i.id] || {}) })),
  prices: () => db.prices,
  ready: () => true,
  language: () => 'it',
});

// ── Driving it ──────────────────────────────────────────────────────────────────

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0)); };
const overlay = () => globalThis.document.body.children.filter(c => c.className.includes('mgmt-overlay')).at(-1) || null;
const textOf = (root) => root.textContent;
const buttons = (root) => walk(root).filter(n => n.tagName === 'BUTTON');
const buttonWith = (root, text) => buttons(root).find(b => b.textContent.startsWith(text));
const isDisabled = (node) => node.disabled === true || node.attributes.disabled !== undefined;
const press = async (root, text) => {
  const b = buttonWith(root, text);
  assert.ok(b, `no button «${text}» in: ${buttons(root).map(x => x.textContent).join(' | ')}`);
  b.fire('click');
  await settle();
};
const selects = (root) => walk(root).filter(n => n.tagName === 'SELECT');
const pick = async (select, value) => { select.value = value; select.fire('change'); await settle(); };

const price = (over = {}) => ({ invoiceId: '18000000001', line: 5, invoiceDate: '2026-08-31', pricePerUnit: 0.57, qty: 25, ...over });
const ing = (over = {}) => ({
  key: 'IT00000000001|name:farina', supplierKey: 'IT00000000001', mergeWith: '', name: 'Farina tipo 00',
  brand: '', category: '', supplierCode: '', weight: '25 kg', packUnit: 'sacco', packCount: null,
  priceUnit: 'kg', unitWeightKg: null, vatRate: 4, prices: [price()], ...over,
});
const fileText = (ingredients = [ing(), ing({ key: 'IT00000000001|name:zucchero', name: 'Zucchero velo', weight: '1 kg', prices: [price({ line: 6 })] })]) => JSON.stringify({
  format: 'mise-invoice-import', version: 1, generatedAt: '2026-10-03T10:00:00Z',
  suppliers: [{ key: 'IT00000000001', vatNumber: 'IT00000000001', name: 'FORNITORE ESEMPIO SRL' }],
  ingredients,
});

async function open(db, text) {
  globalThis.__dialogs = [];
  globalThis.__confirmAnswer = true;
  openInvoiceImport(dataOf(db));
  const root = overlay();
  assert.ok(root, 'the overlay is on the page');
  if (text !== undefined) await load(root, text);
  return root;
}
async function load(root, text, name = 'mise-import.json') {
  const input = walk(root).find(n => n.tagName === 'INPUT' && n.attributes.type === 'file');
  input.files = [{ name, text: async () => text }];
  input.fire('change');
  await settle();
}
// Through the suppliers step, accepting every question the same way, into the ingredients step.
async function toIngredients(root) {
  await press(root, 'Next');
  const save = buttons(root).find(b => /^Save \d+ supplier/.test(b.textContent));
  await press(root, save ? save.textContent : 'Next');
  await settle();
}
const closeOverlay = async (root) => {
  const done = buttonWith(root, 'Done');
  if (done) { done.fire('click'); await settle(); }
};

// Whatever a test leaves open is closed (Back, answered Yes), so the next one starts on a clean page.
afterEach(async () => {
  const root = overlay();
  if (!root) return;
  globalThis.__confirmAnswer = true;
  const back = buttons(root).find(b => b.attributes['aria-label'] === 'Back');
  back.fire('click');
  await settle();
  assert.equal(overlay(), null, 'the test left the screen open');
});

// ── The whole way ───────────────────────────────────────────────────────────────

test('a file goes through every step and writes suppliers and ingredients, each behind a confirmation', async () => {
  const db = makeDb();
  const root = await open(db, fileText());
  assert.match(textOf(root), /1 supplier found/);
  assert.match(textOf(root), /2 ingredients found/);
  assert.equal(db.calls.length, 0, 'nothing is written by choosing a file');

  await press(root, 'Next');
  assert.match(textOf(root), /FORNITORE ESEMPIO SRL/);
  assert.match(textOf(root), /VAT number IT00000000001/);
  assert.match(textOf(root), /New/);
  assert.equal(db.calls.length, 0, 'nothing is written before the suppliers are confirmed');
  await press(root, 'Save 1 supplier');
  assert.equal(globalThis.__dialogs[0].kind, 'confirm');
  assert.equal(globalThis.__dialogs[0].message, '1 new supplier will be created.');
  assert.deepEqual(db.calls[0], ['createSupplier', 'sup-1']);
  assert.equal(db.suppliers[0].vatNumber, 'IT00000000001');

  // the ingredients step
  assert.match(textOf(root), /Ingredients/);
  assert.match(textOf(root), /Farina tipo 00/);
  assert.match(textOf(root), /Zucchero velo/);
  assert.match(textOf(root), /FORNITORE ESEMPIO SRL/);
  assert.match(textOf(root), /€0\.57 \/ kg|£0\.57 \/ kg|\$0\.57 \/ kg|0\.57 \/ kg/);
  assert.match(textOf(root), /1 invoice/);
  assert.equal(db.ingredients.length, 0, 'nothing is written before the ingredients are confirmed');
  await press(root, 'Import 2 ingredients');
  const confirm = globalThis.__dialogs.at(-1);
  assert.equal(confirm.message, '2 new ingredients will be created.\n2 prices will be added.');

  assert.match(textOf(root), /Import finished/);
  assert.match(textOf(root), /2 ingredients created/);
  assert.match(textOf(root), /2 prices added/);
  assert.equal(db.ingredients.length, 2);
  db.ingredients.forEach(i => {
    assert.equal(i.supplierId, 'sup-1');
    assert.equal(i.bakery, 'loc-test');
    for (const key of ['allergens', 'mayContain', 'allergensCheckedAt', 'nutrition', 'packIngredients']) assert.ok(!(key in i), `${key} was written`);
  });
  assert.equal(Object.keys(db.points).length, 2);
  await closeOverlay(root);
  assert.equal(overlay(), null, 'Done closes the screen');
});

test('⚠️ loading the same file again plans no write at all: everything is Unchanged', async () => {
  const db = makeDb();
  let root = await open(db, fileText());
  await toIngredients(root);
  await press(root, 'Import 2 ingredients');
  await closeOverlay(root);
  const written = db.calls.length;
  const batches = db.batches;

  root = await open(db, fileText());
  await press(root, 'Next');
  assert.match(textOf(root), /Already in Mise/);
  await press(root, 'Next');
  assert.match(textOf(root), /2 unchanged ingredients/);
  assert.match(textOf(root), /Nothing to import/);
  assert.ok(!buttonWith(root, 'Import'), 'there is nothing to import');
  await press(root, 'Done');
  assert.equal(db.calls.length, written, 'not one more write');
  assert.equal(db.batches, batches);
  assert.equal(db.ingredients.length, 2, 'and no copy');
  assert.equal(overlay(), null);
});

// ── The questions ───────────────────────────────────────────────────────────────

test('a supplier that may already exist blocks the button until it is answered, and linking writes only its VAT number', async () => {
  const db = makeDb();
  db.suppliers.push({ id: 's9', name: 'Fornitore Esempio', shortName: '', vatNumber: '' });
  const root = await open(db, fileText());
  await press(root, 'Next');
  assert.match(textOf(root), /Maybe this one\?/);
  const primary = buttons(root).find(b => b.className === 'btn-primary');
  assert.ok(isDisabled(primary), 'the button waits for an answer');
  assert.match(textOf(root), /Choose what to do with 1 supplier first\./);
  assert.equal(primary.attributes['aria-describedby'], 'invimp-hint', 'and says why, to a screen reader too');
  const [select] = selects(root);
  assert.deepEqual(select.options.map(o => o.textContent), ['Choose…', 'Same as Fornitore Esempio', 'Create a new supplier', 'Skip']);

  await pick(select, 'link:s9');
  await press(root, 'Save 1 supplier');
  assert.equal(globalThis.__dialogs[0].message, '1 existing supplier will get its VAT number added.');
  assert.deepEqual(db.calls[0], ['linkVat', 's9', 'IT00000000001']);
  assert.deepEqual(db.suppliers[0], { id: 's9', name: 'Fornitore Esempio', shortName: '', vatNumber: 'IT00000000001' });
  assert.ok(!db.calls.some(c => c[0] === 'createSupplier'));
});

test('a skipped supplier makes its ingredients errors that say why, and nothing is imported for them', async () => {
  const db = makeDb();
  db.suppliers.push({ id: 's9', name: 'Fornitore Esempio', shortName: '', vatNumber: '' });
  const root = await open(db, fileText());
  await press(root, 'Next');
  await pick(selects(root)[0], 'skip');
  await press(root, 'Next');
  assert.match(textOf(root), /2 ingredients with errors/);
  assert.match(textOf(root), /Its supplier was skipped or is not in the file\./);
  assert.match(textOf(root), /Nothing to import/);
  assert.equal(db.calls.length, 0);
});

test('an ingredient that looks like one you have asks, and the answer decides what is written', async () => {
  const db = makeDb();
  db.suppliers.push({ id: 's1', name: 'Fornitore', vatNumber: 'IT00000000001' });
  db.ingredients.push({ id: 'i1', name: 'Farina 00 Esempio', shortName: '', supplierId: 's1', kind: 'ingredient', supplierCode: '' });
  const text = fileText([ing({ name: 'Farina 00 Premium' })]);
  const root = await open(db, text);
  await toIngredients(root);
  assert.match(textOf(root), /To decide/);
  const primary = buttons(root).find(b => b.className === 'btn-primary');
  assert.ok(isDisabled(primary));
  assert.match(textOf(root), /Choose what to do with 1 ingredient first\./);
  const [select] = selects(root);
  assert.deepEqual(select.options.map(o => o.textContent), ['Choose…', 'Same as Farina 00 Esempio', 'Create a new ingredient', 'Skip']);

  await pick(select, 'same:i1');
  assert.ok(!isDisabled(buttons(root).find(b => b.className === 'btn-primary')));
  await press(root, 'Import 1 ingredient');
  assert.equal(db.ingredients.length, 1, 'no second ingredient');
  assert.deepEqual(db.points.i1, ['inv-18000000001-5']);
  assert.equal(db.prices.i1.pricePerUnit, 0.57);
  assert.equal(db.ingredients[0].name, 'Farina 00 Esempio', 'an existing ingredient keeps its name');
  assert.match(textOf(root), /1 existing ingredient got new prices/);
});

test('«Skip» imports nothing for that row, and an «unisci con» row has no «Create a new ingredient»', async () => {
  const db = makeDb();
  db.suppliers.push({ id: 's1', name: 'Fornitore', vatNumber: 'IT00000000001' });
  db.ingredients.push({ id: 'i1', name: 'Farina 00 Esempio', shortName: '', supplierId: 's1', kind: 'ingredient', supplierCode: '' });
  const root = await open(db, fileText([ing({ mergeWith: 'Pasta di semola' })]));
  await toIngredients(root);
  const [select] = selects(root);
  assert.ok(!select.options.some(o => o.textContent === 'Create a new ingredient'));
  await pick(select, 'skip');
  assert.match(textOf(root), /Nothing to import/);
  assert.equal(db.calls.length, 0);
});

// ── Leaving ─────────────────────────────────────────────────────────────────────

test('Back closes at once before a file is loaded, and asks (danger) once there is one', async () => {
  const db = makeDb();
  let root = await open(db);
  const back = () => buttons(root).find(b => b.attributes['aria-label'] === 'Back');
  back().fire('click');
  await settle();
  assert.equal(globalThis.__dialogs.length, 0, 'nothing to lose, nothing asked');
  assert.equal(overlay(), null);

  root = await open(db, fileText());
  globalThis.__confirmAnswer = false;
  back().fire('click');
  await settle();
  assert.equal(globalThis.__dialogs.length, 1);
  assert.equal(globalThis.__dialogs[0].danger, true);
  assert.ok(overlay(), 'No keeps the plan on screen');
  globalThis.__confirmAnswer = true;
  back().fire('click');
  await settle();
  assert.equal(overlay(), null);
  assert.equal(db.calls.length, 0);
});

test('while rows are being written Back is off and does nothing', async () => {
  const db = makeDb();
  const root = await open(db, fileText());
  await toIngredients(root);
  const seen = [];
  db.beforeBatch = () => {
    const back = buttons(root).find(b => b.attributes['aria-label'] === 'Back');
    seen.push(back.disabled);
    const before = globalThis.__dialogs.length;
    back.fire('click');
    seen.push(globalThis.__dialogs.length === before);
    seen.push(textOf(root).includes('Importing…'));
  };
  await press(root, 'Import 2 ingredients');
  assert.deepEqual(seen.slice(0, 3), [true, true, true]);
  const back = buttons(root).find(b => b.attributes['aria-label'] === 'Back');
  assert.equal(back.disabled, false, 'and on again afterwards');
});

// ── What goes wrong ─────────────────────────────────────────────────────────────

const threeRows = () => fileText([
  ing({ key: 'k1', name: 'Zucchero velo', prices: [price({ line: 1 })] }),
  ing({ key: 'k2', name: 'Olio extravergine', prices: [price({ line: 2 })] }),
  ing({ key: 'k3', name: 'Sale marino', prices: [price({ line: 3 })] }),
]);

test('⚠️ a refusal stops the run at once, says so, and says how many were not tried', async () => {
  const db = makeDb();
  const root = await open(db, threeRows());
  await toIngredients(root);
  db.failOn = () => 'permission-denied';
  await press(root, 'Import 3 ingredients');
  assert.equal(db.batches, 1, 'no second attempt');
  assert.equal(db.ingredients.length, 0);
  assert.match(textOf(root), /Mise was not allowed to save this/);
  assert.match(textOf(root), /2 ingredients were not tried\./);
  assert.match(textOf(root), /1 ingredient not imported/);
  assert.match(textOf(root), /Load the same file again to finish/);
});

test('losing the connection stops the run too', async () => {
  const db = makeDb();
  const root = await open(db, threeRows());
  await toIngredients(root);
  db.failOn = (n) => (n === 2 ? 'unavailable' : null);
  await press(root, 'Import 3 ingredients');
  assert.equal(db.ingredients.length, 1, 'the first row landed and stays');
  assert.match(textOf(root), /There is no connection\./);
  assert.match(textOf(root), /1 ingredient created/);
  assert.match(textOf(root), /1 ingredient was not tried\./);
});

test('any other failure is recorded with its reason and the run goes on with the next row', async () => {
  const db = makeDb();
  const root = await open(db, threeRows());
  await toIngredients(root);
  db.failOn = (n) => (n === 1 ? 'invalid-argument' : null);
  await press(root, 'Import 3 ingredients');
  assert.equal(db.ingredients.length, 2);
  assert.match(textOf(root), /2 ingredients created/);
  assert.match(textOf(root), /1 ingredient not imported/);
  assert.match(textOf(root), /Zucchero velo/);
  assert.match(textOf(root), /Could not be saved \(invalid-argument\)\./);
});

test('⚠️ a row that matches an ingredient created moments ago becomes a question, never a duplicate', async () => {
  const db = makeDb();
  const root = await open(db, fileText([
    ing({ key: 'k1', name: 'Farina 00', prices: [price({ line: 1 })] }),
    ing({ key: 'k2', name: 'Farina 00 Premium', prices: [price({ line: 2 })] }),
  ]));
  await toIngredients(root);
  assert.match(textOf(root), /Import 2 ingredients/, 'both were new when planned');
  await press(root, 'Import 2 ingredients');
  assert.equal(db.ingredients.length, 1, 'the second is not created beside the first');
  assert.match(textOf(root), /A similar ingredient appeared during the import\. Load the file again to decide\./);
  assert.match(textOf(root), /Farina 00 Premium/);
});

test('a plan drawn before the lists have arrived is refused, not drawn with everything new', async () => {
  const db = makeDb();
  globalThis.__dialogs = [];
  openInvoiceImport({ ...dataOf(db), ready: () => false });
  const root = overlay();
  await load(root, fileText());
  await press(root, 'Next');
  assert.match(textOf(root), /still loading/);
  assert.match(textOf(root), /Choose the file/, 'it stays on the first step');
  buttons(root).find(b => b.attributes['aria-label'] === 'Back').fire('click');
  await settle();
  assert.equal(overlay(), null);
});

test('a file that is not an import file says what is wrong, in words', async () => {
  const db = makeDb();
  const root = await open(db);
  await load(root, 'not json at all');
  assert.match(textOf(root), /This is not an import file\./);
  await load(root, JSON.stringify({ format: 'mise-invoice-import', version: 7, suppliers: [], ingredients: [] }));
  assert.match(textOf(root), /made by a different version of the script/);
  assert.ok(!buttonWith(root, 'Next'), 'no way on from a refused file');
  await load(root, fileText());
  assert.match(textOf(root), /1 supplier found/);
  assert.ok(buttonWith(root, 'Next'));
  buttons(root).find(b => b.attributes['aria-label'] === 'Back').fire('click');
  await settle();
  globalThis.__confirmAnswer = true;
  assert.equal(overlay(), null);
});

test('the filter chips count the rows and are real toggles', async () => {
  const db = makeDb();
  const root = await open(db, threeRows());
  await toIngredients(root);
  const chips = buttons(root).filter(b => b.className === 'invimp-filter');
  // ⚠️ A chip with nothing under it is not drawn (296 px: seven chips took half the screen).
  assert.deepEqual(chips.map(c => c.textContent), ['All (3)', 'New (3)']);
  assert.equal(chips[0].attributes['aria-pressed'], 'true');
  chips[1].fire('click');
  await settle();
  const after = buttons(root).filter(b => b.className === 'invimp-filter');
  assert.equal(after[1].attributes['aria-pressed'], 'true');
  assert.equal(after[0].attributes['aria-pressed'], 'false');
  buttons(root).find(b => b.attributes['aria-label'] === 'Back').fire('click');
  await settle();
});

// ── Review fixes ────────────────────────────────────────────────────────────────

test('⚠️ a supplier that appeared while the owner was deciding stops the write and asks again', async () => {
  const db = makeDb();
  const root = await open(db, fileText());
  await press(root, 'Next');
  // Another phone adds the same supplier (same VAT number) after the plan was drawn and confirmed on screen.
  db.beforeSuppliers = () => { db.suppliers.push({ id: 'other-phone', name: 'Fornitore Esempio', shortName: '', vatNumber: 'IT00000000001' }); };
  await press(root, 'Save 1 supplier');
  assert.ok(!db.calls.some(c => c[0] === 'createSupplier'), 'nothing was written');
  assert.match(textOf(root), /The supplier list changed: check again\./);
  assert.match(textOf(root), /Already in Mise/, 'the step shows the fresh plan');
  assert.match(textOf(root), /Step 2 of 3/, 'and stays on the suppliers step');
  db.beforeSuppliers = null;
  await press(root, 'Next');
  assert.match(textOf(root), /Ingredients/);
  assert.equal(db.suppliers.length, 1, 'no second copy of the supplier');
});

test('a supplier write that never answers ends in the offline message, and Back still works', async () => {
  const db = makeDb();
  const root = await open(db, fileText());
  await press(root, 'Next');
  db.failSupplier = 'timeout';
  await press(root, 'Save 1 supplier');
  assert.match(textOf(root), /There is no connection\./);
  assert.match(textOf(root), /Step 2 of 3/);
  const back = buttons(root).find(b => b.attributes['aria-label'] === 'Back');
  assert.equal(back.disabled, false, 'Back is usable again');
  assert.equal(db.ingredients.length, 0);
});

test('«Load the same file again» only when a second load can help; an invalid entry says to fix the workbook', async () => {
  const db = makeDb();
  const root = await open(db, fileText([
    ing({ key: 'k1', name: 'Zucchero velo', prices: [price({ line: 1 })] }),
    ing({ key: 'k-bad', name: 'Olio extravergine', prices: [price({ line: 2, invoiceDate: '31/08/2026' })] }),
  ]));
  await toIngredients(root);
  await press(root, 'Import 1 ingredient');
  assert.match(textOf(root), /1 ingredient not imported/);
  assert.match(textOf(root), /A price in the file is not valid\./);
  assert.match(textOf(root), /correct them in the workbook and create the file again/);
  assert.doesNotMatch(textOf(root), /Load the same file again/);
});

test('a write that failed DOES say to load the same file again', async () => {
  const db = makeDb();
  const root = await open(db, threeRows());
  await toIngredients(root);
  db.failOn = (n) => (n === 1 ? 'invalid-argument' : null);
  await press(root, 'Import 3 ingredients');
  assert.match(textOf(root), /Load the same file again to finish/);
  assert.doesNotMatch(textOf(root), /create the file again/);
});

test('⚠️ a «Same as» answer is remembered: the second load asks nothing, and the summary says how to skip it for good', async () => {
  const db = makeDb();
  db.suppliers.push({ id: 's1', name: 'Fornitore', vatNumber: 'IT00000000001' });
  db.ingredients.push({ id: 'i1', name: 'Farina 00 Esempio', shortName: '', supplierId: 's1', kind: 'ingredient', supplierCode: '' });
  const text = fileText([ing({ name: 'Farina 00 Premium' })]);

  let root = await open(db, text);
  await toIngredients(root);
  await pick(selects(root)[0], 'same:i1');
  await press(root, 'Import 1 ingredient');
  assert.match(textOf(root), /To skip this question next month, write “unisci con Farina 00 Esempio” in the workbook’s Azione for Farina 00 Premium\./);
  await closeOverlay(root);
  const written = db.calls.length;

  root = await open(db, text);
  await toIngredients(root);
  assert.doesNotMatch(textOf(root), /To decide/, 'the owner is not asked again');
  assert.equal(selects(root).length, 0);
  assert.match(textOf(root), /1 unchanged ingredient/);
  assert.match(textOf(root), /Nothing to import/);
  await press(root, 'Done');
  assert.equal(db.calls.length, written, 'and nothing is written');
  assert.equal(db.ingredients.length, 1);
});

test('a row with an article code gets no «unisci con» hint: the code finds it next month', async () => {
  const db = makeDb();
  db.suppliers.push({ id: 's1', name: 'Fornitore', vatNumber: 'IT00000000001' });
  db.ingredients.push({ id: 'i1', name: 'Farina 00 Esempio', shortName: '', supplierId: 's1', kind: 'ingredient', supplierCode: '' });
  const root = await open(db, fileText([ing({ name: 'Farina 00 Premium', supplierCode: 'F00' })]));
  await toIngredients(root);
  await pick(selects(root)[0], 'same:i1');
  await press(root, 'Import 1 ingredient');
  assert.doesNotMatch(textOf(root), /unisci con/);
});

test('the file box is a label dressed as a button for one hidden input, and the chosen file name is shown', async () => {
  const db = makeDb();
  const root = await open(db);
  const input = walk(root).find(n => n.tagName === 'INPUT' && n.attributes.type === 'file');
  const label = walk(root).find(n => n.tagName === 'LABEL' && n.attributes.for === input.attributes.id);
  assert.ok(label, 'a label is tied to the input');
  assert.match(label.className, /btn-secondary/);
  assert.equal(label.textContent, 'Choose the file');
  assert.doesNotMatch(textOf(root), /Chosen file/);
  await load(root, fileText(), 'mise-import-2026-10-03.json');
  assert.match(textOf(root), /Chosen file: mise-import-2026-10-03\.json/);
  assert.equal(walk(root).filter(n => n.tagName === 'INPUT' && n.attributes.type === 'file').length, 1, 'still the one input');
  buttons(root).find(b => b.attributes['aria-label'] === 'Back').fire('click');
  await settle();
  globalThis.__confirmAnswer = true;
});

test('the screen is a modal dialog named by its title, and focus goes back to the button that opened it', async () => {
  const db = makeDb();
  globalThis.__dialogs = [];
  const opener = globalThis.document.createElement('button');
  openInvoiceImport({ ...dataOf(db), opener });
  const root = overlay();
  assert.equal(root.attributes.role, 'dialog');
  assert.equal(root.attributes['aria-modal'], 'true');
  const titleId = root.attributes['aria-labelledby'];
  const title = walk(root).find(n => n.attributes.id === titleId);
  assert.ok(title, 'aria-labelledby names a real element');
  assert.equal(title.textContent, 'Import from invoices');
  buttons(root).find(b => b.attributes['aria-label'] === 'Back').fire('click');
  await settle();
  assert.equal(overlay(), null);
  assert.equal(opener.focused, 1, 'the opener has the focus again');
});

test('a chip with a count of zero is hidden unless it is All or the one that is on', async () => {
  const db = makeDb();
  db.suppliers.push({ id: 's1', name: 'Fornitore', vatNumber: 'IT00000000001' });
  db.ingredients.push({ id: 'i1', name: 'Farina 00 Esempio', shortName: '', supplierId: 's1', kind: 'ingredient', supplierCode: '' });
  const root = await open(db, fileText([ing({ name: 'Farina 00 Premium' }), ing({ key: 'bad', name: '' })]));
  await toIngredients(root);
  const chips = () => buttons(root).filter(b => b.className === 'invimp-filter').map(c => c.textContent);
  assert.deepEqual(chips(), ['All (2)', 'To decide (1)', 'Errors (1)']);
  await pick(selects(root)[0], 'skip');
  buttons(root).find(b => b.className === 'invimp-filter' && b.textContent.startsWith('To decide')).fire('click');
  await settle();
  assert.deepEqual(chips(), ['All (2)', 'To decide (1)', 'Errors (1)'], 'answered rows stay under To decide');
});
