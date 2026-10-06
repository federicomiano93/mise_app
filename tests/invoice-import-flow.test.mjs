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
import { zipSync, strToU8 } from '../js/vendor/fflate.esm.js';
import { parseXmlTree } from './helpers/xml-tree.mjs';
import { invoiceXml, metadataXml } from './helpers/invoice-builders.mjs';
import { decisionId } from '../js/orders/invoice-zip/selection.js';

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
const { planBatchWrites, pointsOfDocs } = await import('../js/orders/invoice-import-plan.js');

// ── The in-memory «database» ────────────────────────────────────────────────────

function makeDb() {
  const db = {
    suppliers: [], ingredients: [], prices: {}, points: {}, pointDocs: {}, changes: [], changeReads: 0,
    calls: [], batches: 0, failOn: null, beforeBatch: null, beforeSuppliers: null, failSupplier: null, n: 0,
    decisions: [], failDecisionsLoad: null, failDecisionsWrite: null,
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
    async invoicePointIds(id) {
      const set = new Set(db.points[id] || []);
      set.points = pointsOfDocs(Object.entries(db.pointDocs[id] || {}).map(([pid, data]) => ({ id: pid, data })));
      return set;
    },
    async storedPriceChangeIds(id) {
      db.changeReads += 1;
      return db.changes.filter(c => c.ingredientId === id)
        .map(({ id: changeId, oldPrice, newPrice, oldDate, date, priceUnit }) => ({ id: changeId, oldPrice, newPrice, oldDate, date, priceUnit }));
    },
    async freshPrice(id) { return db.prices[id] ? { ...db.prices[id] } : null; },
    async loadInvoiceDecisions() {
      if (db.failDecisionsLoad) throw failure(db.failDecisionsLoad);
      return db.decisions.map(d => ({ ...d }));
    },
    async writeInvoiceDecisions(changes) {
      db.calls.push(['decisions', changes.set.length, changes.remove.length]);
      if (db.failDecisionsWrite) throw failure(db.failDecisionsWrite);
      changes.remove.forEach(id => { db.decisions = db.decisions.filter(d => d.id !== id); });
      changes.set.forEach(c => {
        db.decisions = db.decisions.filter(d => d.id !== c.id);
        db.decisions.push({ id: c.id, decision: c.decision, label: c.label });
      });
      return changes.set.length + changes.remove.length;
    },
    async runImportBatches(batches) {
      db.batches += 1;
      if (db.beforeBatch) db.beforeBatch(batches);
      if (db.failOn) { const code = db.failOn(db.batches, batches); if (code) throw failure(code); }
      const plan = planBatchWrites(batches, { mintId: () => `ing-${++db.n}`, bakery: 'loc-test' });
      plan.batches.flat().forEach(({ path, data, merge, remove }) => {
        if (remove) {
          db.calls.push(['remove', path.join('/')]);
          db.changes = db.changes.filter(c => c.id !== path[1]);
          return;
        }
        db.calls.push(['write', path.join('/')]);
        if (path[0] === 'ingredients' && path.length === 2) {
          const at = db.ingredients.findIndex(i => i.id === path[1]);
          if (at < 0) db.ingredients.push({ id: path[1], ...data });
          else db.ingredients[at] = { ...db.ingredients[at], ...data };
        } else if (path[0] === 'ingredient-prices') {
          db.prices[path[1]] = { ...(db.prices[path[1]] || {}), ...data };
        } else if (path[0] === 'price-changes') {
          if (db.changes.some(c => c.id === path[1])) throw failure('permission-denied');   // create-only, like the rules
          db.changes.push({ id: path[1], ...data });
        } else {
          const list = (db.points[path[1]] ||= []);
          if (list.includes(path[3])) throw failure('permission-denied');   // create-only, like the rules
          list.push(path[3]);
          (db.pointDocs[path[1]] ||= {})[path[3]] = data;
        }
        assert.equal(merge, !(path[2] === 'prices' || path[0] === 'price-changes'));
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
  parseXml: parseXmlTree,
  venueId: () => 'loc-test',
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
  assert.equal(confirm.message, '2 new ingredients will be created.\n2 prices will be added.\nPrice changes are recorded too.');

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
  assert.ok(!buttonWith(root, 'Record price changes'), 'a .json file has no price-change button');
  const readsBefore = db.changeReads;
  await press(root, 'Done');
  assert.equal(overlay(), null, '⚠️ «Done» only closes: nothing is written, nothing is asked, nothing is read');
  assert.equal(globalThis.__dialogs.length, 0);
  assert.equal(db.changeReads, readsBefore);
  assert.equal(db.calls.length, written, 'not one more write');
  assert.equal(db.batches, batches);
  assert.equal(db.ingredients.length, 2, 'and no copy');
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

// 5 Oct 2026, the first real zip: 43 of 238 rows came back «a similar ingredient appeared» — two products of
// one supplier, both new, created one after the other in the same run.
test('⚠️ two NEW products with different article codes are both created, however alike their names', async () => {
  const db = makeDb();
  const root = await open(db, fileText([
    ing({ key: 'IT00000000001|code:AC-B', supplierCode: 'AC-B', name: 'Aceto bianco 1 l', prices: [price({ line: 1 })] }),
    ing({ key: 'IT00000000001|code:AC-R', supplierCode: 'AC-R', name: 'Aceto rosso 1 l', prices: [price({ line: 2 })] }),
  ]));
  await toIngredients(root);
  await press(root, 'Import 2 ingredients');
  assert.equal(db.ingredients.length, 2, 'both created');
  assert.doesNotMatch(textOf(root), /A similar ingredient appeared/);
  assert.deepEqual(db.ingredients.map(i => i.supplierCode).sort(), ['AC-B', 'AC-R']);
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

// ── Invoices straight from the zip ──────────────────────────────────────────────

const FLOUR_LINE = { desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00', qty: 25, unit: 'KG', total: 14.25 };
const COLA_LINE = { desc: 'COCA COLA LATTINA 33 CL', code: 'COLA', qty: 24, unit: 'PZ', total: 12 };
const STRONG_LINE = { desc: 'SPEZIA FORTE', code: 'SP', qty: 100, unit: 'KG', total: 4 };
const K_FLOUR = 'IT00000000001|code:F00';
const K_COLA = 'IT00000000001|code:COLA';

const fileOf = (name, bytes) => ({ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
function invoiceZip(lines = [FLOUR_LINE, COLA_LINE, STRONG_LINE], options = {}, sdi = '9000000001') {
  const members = { 'inv1.xml': invoiceXml(lines, options), 'inv1_MT_001.xml': metadataXml(sdi) };
  return fileOf('fatture.zip', zipSync(Object.fromEntries(Object.entries(members).map(([n, x]) => [n, strToU8(x)]))));
}
async function loadFiles(root, files) {
  const input = walk(root).find(n => n.tagName === 'INPUT' && n.attributes.type === 'file');
  input.files = files;
  input.fire('change');
  await settle();
}
async function openWithZip(db, files = [invoiceZip()]) {
  const root = await open(db);
  await loadFiles(root, files);
  return root;
}
const byFid = (root, id) => walk(root).find(n => n.attributes['data-fid'] === id);
const tick = async (root, id, on = true) => {
  const box = byFid(root, id);
  assert.ok(box, `no tick-box ${id}`);
  box.checked = on;
  box.fire('change');
  await settle();
};
const newSelects = (root, prefix) => walk(root).filter(n => n.tagName === 'SELECT' && (n.attributes.id || '').startsWith(prefix));

test('⚠️ a zip is read in the app: a summary, groups for what is left out, and NOTHING is written', async () => {
  const db = makeDb();
  const root = await openWithZip(db);
  assert.match(textOf(root), /Chosen file: fatture\.zip/);
  assert.match(textOf(root), /1 invoice read · 1 supplier found · 2 ingredients found/);
  assert.match(textOf(root), /Packaging and resale \(1\)/);
  assert.match(textOf(root), /COCA COLA LATTINA 33 CL/);
  assert.match(textOf(root), /Import as an ingredient/);
  assert.doesNotMatch(textOf(root), /Left out by you/);
  assert.equal(db.calls.length, 0);
  assert.equal(db.decisions.length, 0);
  const input = walk(root).find(n => n.tagName === 'INPUT' && n.attributes.type === 'file');
  assert.equal(input.attributes.accept, '.zip,.xml,.json,application/zip,application/json');
  assert.equal(input.attributes.multiple, '');
});

test('the whole way from the zip: price-less ingredients are asked about in their own group, and rows are written', async () => {
  const db = makeDb();
  const root = await openWithZip(db);
  await toIngredients(root);
  assert.match(textOf(root), /To check \(1\)/);
  assert.match(textOf(root), /The price looks wrong for this product/);
  assert.match(textOf(root), /Farina tipo 00/);
  await press(root, 'Import 2 ingredients');
  assert.equal(globalThis.__dialogs.at(-1).message, '2 new ingredients will be created.\n1 price will be added.\nPrice changes are recorded too.');
  assert.match(textOf(root), /2 ingredients created/);
  assert.equal(db.ingredients.length, 2);
  const strong = db.ingredients.find(i => i.name === 'Spezia forte');
  assert.ok(strong, 'the price-less ingredient is created');
  assert.equal(db.prices[strong.id], undefined, 'with no price document');
  assert.equal(db.points[strong.id], undefined, 'and no price points');
  assert.equal(db.decisions.length, 0, 'nothing to remember');
  assert.ok(!db.calls.some(c => c[0] === 'decisions'));
});

test('⚠️ ticking a product re-runs the selection at once, and the decision is written BEFORE the rows', async () => {
  const db = makeDb();
  const root = await openWithZip(db);
  await tick(root, 'invimp-tick-notImported-0');
  assert.match(textOf(root), /3 ingredients found/);
  assert.equal(db.calls.length, 0, 'ticking writes nothing');
  await tick(root, 'invimp-tick-notImported-0', false);
  assert.match(textOf(root), /2 ingredients found/);
  await tick(root, 'invimp-tick-notImported-0');
  await toIngredients(root);
  await press(root, 'Import 3 ingredients');
  assert.match(globalThis.__dialogs.at(-1).message, /1 choice will be remembered for the next imports\./);
  const firstDecision = db.calls.findIndex(c => c[0] === 'decisions');
  const firstWrite = db.calls.findIndex(c => c[0] === 'write');
  assert.ok(firstDecision >= 0 && firstDecision < firstWrite, 'the answers go first');
  assert.deepEqual(db.decisions, [{ id: decisionId(K_COLA), decision: 'ingredient', label: 'COCA COLA LATTINA 33 CL' }]);
  assert.match(textOf(root), /Choices remembered: 1/);
  assert.equal(db.ingredients.length, 3);
});

test('a remembered skip is listed, ticking «Import again» imports it and DELETES the decision', async () => {
  const db = makeDb();
  db.decisions.push({ id: decisionId(K_FLOUR), decision: 'skip', label: 'Farina' });
  const root = await openWithZip(db);
  assert.match(textOf(root), /Left out by you \(1\)/);
  assert.match(textOf(root), /1 ingredient found/, 'only the strong spice is left');
  assert.match(textOf(root), /Import again/);
  await tick(root, 'invimp-tick-skippedByYou-0');
  assert.match(textOf(root), /2 ingredients found/);
  await toIngredients(root);
  await press(root, 'Import 2 ingredients');
  assert.deepEqual(db.calls.find(c => c[0] === 'decisions'), ['decisions', 0, 1]);
  assert.deepEqual(db.decisions, [], 'the remembered skip is gone');
  assert.ok(db.ingredients.some(i => i.name === 'Farina tipo 00'));
});

test('a NEW row can be left out and remembered: «Create» is the default and never blocks the button', async () => {
  const db = makeDb();
  const root = await openWithZip(db);
  await toIngredients(root);
  const selects3 = newSelects(root, 'invimp-new-');
  assert.equal(selects3.length, 2);
  assert.deepEqual(selects3[0].options.map(o => o.textContent), ['Create', 'Do not import (remember)']);
  assert.equal(selects3[0].value, 'create');
  assert.ok(!isDisabled(buttonWith(root, 'Import 2 ingredients')));
  const flourSelect = selects3.find(sel => /Farina/.test(textOf(sel.parentNode.parentNode)));
  await pick(flourSelect, 'forget');
  await press(root, 'Import 1 ingredient');
  assert.match(globalThis.__dialogs.at(-1).message, /1 choice will be remembered/);
  const firstDecision = db.calls.findIndex(c => c[0] === 'decisions');
  assert.ok(firstDecision >= 0 && firstDecision < db.calls.findIndex(c => c[0] === 'write'));
  assert.deepEqual(db.decisions, [{ id: decisionId(K_FLOUR), decision: 'skip', label: 'FARINA TIPO 00 SACCO KG 25' }]);
  assert.ok(!db.ingredients.some(i => i.name === 'Farina tipo 00'), 'the left-out ingredient was not created');
  assert.match(textOf(root), /1 ingredient created/);
});

test('⚠️ a supplier chosen «do not import anything» is dropped with all its products, remembered, and next time listed', async () => {
  const db = makeDb();
  const root = await openWithZip(db);
  await press(root, 'Next');
  const [select] = newSelects(root, 'invimp-supnew-');
  assert.deepEqual(select.options.map(o => o.textContent), ['Import', 'Do not import anything from this supplier (remember)']);
  await pick(select, 'forget');
  const primary = buttons(root).find(b => b.className === 'btn-primary');
  assert.equal(primary.textContent, 'Next', 'no supplier left to create');
  await press(root, 'Next');
  assert.match(textOf(root), /Nothing to import/);
  assert.ok(!db.calls.some(c => c[0] === 'createSupplier'), 'the supplier was not created');
  assert.equal(db.calls.length, 0, 'nothing is written until Done is confirmed');
  await press(root, 'Done');
  assert.equal(globalThis.__dialogs.at(-1).kind, 'confirm');
  assert.match(globalThis.__dialogs.at(-1).message, /1 choice will be remembered/);
  assert.deepEqual(db.decisions, [{ id: decisionId('supplier:IT00000000001'), decision: 'skip', label: 'FORNITORE ESEMPIO SRL' }]);
  assert.equal(overlay(), null, 'the screen closed');

  // the next import
  const again = await openWithZip(db);
  assert.match(textOf(again), /Suppliers left out by you \(1\)/);
  assert.match(textOf(again), /3 products/);
  assert.match(textOf(again), /0 ingredients found/);
  await tick(again, 'invimp-tick-supplier-0');
  assert.match(textOf(again), /2 ingredients found/);
});

test('declining the question on Done keeps the screen and writes nothing', async () => {
  const db = makeDb();
  const root = await openWithZip(db);
  await press(root, 'Next');
  await pick(newSelects(root, 'invimp-supnew-')[0], 'forget');
  await press(root, 'Next');
  globalThis.__confirmAnswer = false;
  await press(root, 'Done');
  assert.ok(overlay(), 'still open');
  assert.equal(db.decisions.length, 0);
  globalThis.__confirmAnswer = true;
});

test('the remembered decisions are read from the server: offline refuses the file, with a message', async () => {
  const db = makeDb();
  db.failDecisionsLoad = 'offline';
  const root = await openWithZip(db);
  assert.match(textOf(root), /There is no connection/);
  assert.doesNotMatch(textOf(root), /ingredients found/);
  assert.ok(!buttonWith(root, 'Next'), 'no way on without the decisions');
});

test('a failure while remembering stops nothing else and is reported in the summary', async () => {
  const db = makeDb();
  db.failDecisionsWrite = 'unavailable';
  const root = await openWithZip(db);
  await tick(root, 'invimp-tick-notImported-0');
  await toIngredients(root);
  await press(root, 'Import 3 ingredients');
  assert.equal(db.ingredients.length, 3, 'the rows were written anyway');
  assert.match(textOf(root), /Your choices could not be remembered/);
  assert.doesNotMatch(textOf(root), /Choices remembered/);
});

test('an update shows the price in force, the new one and the change; another unit shows only the new one', async () => {
  const db = makeDb();
  db.suppliers.push({ id: 's1', name: 'Fornitore', vatNumber: 'IT00000000001' });
  db.ingredients.push({ id: 'i1', name: 'Farina tipo 00', shortName: '', supplierId: 's1', kind: 'ingredient', supplierCode: 'F00' });
  db.prices.i1 = { priceUnit: 'kg', pricePerUnit: 0.5, priceUpdatedAt: '2026-01-01T12:00:00.000Z' };
  let root = await openWithZip(db, [invoiceZip([FLOUR_LINE])]);
  await toIngredients(root);
  assert.match(textOf(root), /0\.50 \/ kg → .*0\.57 \/ kg \(\+14%\)/);
  buttons(root).find(b => b.attributes['aria-label'] === 'Back').fire('click');
  await settle();

  db.prices.i1 = { priceUnit: 'pcs', pricePerUnit: 3, priceUpdatedAt: '2026-01-01T12:00:00.000Z' };
  root = await openWithZip(db, [invoiceZip([FLOUR_LINE])]);
  await toIngredients(root);
  assert.doesNotMatch(textOf(root), /→/);
  assert.match(textOf(root), /0\.57 \/ kg/);
});

test('one .json beside zips (or two .json) is refused with a message; a bad zip is a friendly error', async () => {
  const db = makeDb();
  const root = await openWithZip(db, [invoiceZip(), { name: 'a.json', text: async () => '{}' }]);
  assert.match(textOf(root), /Choose either one \.json file or the invoice files/);
  await loadFiles(root, [{ name: 'a.json', text: async () => '{}' }, { name: 'b.json', text: async () => '{}' }]);
  assert.match(textOf(root), /Choose either one \.json file/);
  await loadFiles(root, [{ name: 'x.zip', arrayBuffer: async () => { throw new Error('disk'); } }]);
  assert.match(textOf(root), /The invoices could not be read/);
  assert.equal(db.calls.length, 0);
});

test('a .json file still takes the old path: no remembered decisions are read or offered', async () => {
  const db = makeDb();
  db.failDecisionsLoad = 'offline';
  const root = await open(db, fileText());
  assert.match(textOf(root), /2 ingredients found/);
  await toIngredients(root);
  assert.equal(newSelects(root, 'invimp-new-').length, 0, 'no «Do not import (remember)» on this path');
  await press(root, 'Import 2 ingredients');
  assert.ok(!db.calls.some(c => c[0] === 'decisions'));
});

// ── Price changes found by the import ───────────────────────────────────────────

const stepPrice = (invoiceId, pricePerUnit, invoiceDate) => price({ invoiceId, line: 1, invoiceDate, pricePerUnit });
const stepFile = () => fileText([ing({
  key: 'k-step', name: 'Burro', supplierCode: '',
  prices: [stepPrice('18000000001', 1, '2026-01-10'), stepPrice('18000000002', 1.1, '2026-02-10'), stepPrice('18000000003', 1.1, '2026-03-10')],
})]);

test('⚠️ three invoices at 1.00 → 1.10 → 1.10 write exactly ONE price change, and the same file again writes nothing new', async () => {
  const db = makeDb();
  let root = await open(db, stepFile());
  await toIngredients(root);
  await press(root, 'Import 1 ingredient');
  assert.equal(db.changes.length, 1);
  const [change] = db.changes;
  const ingredientId = db.ingredients[0].id;
  assert.equal(change.id, `inv-18000000002-1-${ingredientId}`);
  assert.deepEqual(change, {
    id: change.id, ingredientId, supplierId: 'sup-1', name: 'Burro', priceUnit: 'kg', oldPrice: 1, newPrice: 1.1,
    oldDate: '2026-01-10', date: '2026-02-10', invoiceId: '18000000002', line: 1, pct: 10,
    recordedAt: change.recordedAt, bakery: 'loc-test',
  });
  assert.match(change.recordedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(textOf(root), /Price changes recorded: 1/);
  assert.ok(db.calls.findIndex(c => c[1] && c[1].startsWith('price-changes/')) > db.calls.findIndex(c => c[1] && c[1].includes('/prices/')), 'after the prices of the row itself');
  await closeOverlay(root);

  const before = db.calls.length;
  root = await open(db, stepFile());
  await toIngredients(root);
  assert.match(textOf(root), /1 unchanged ingredient/);
  await press(root, 'Done');
  assert.equal(overlay(), null, 'Done only closes');
  assert.equal(db.changes.length, 1);
  assert.equal(db.calls.length, before, 'not one more write');
});

// An ingredient already in Mise whose stored invoice history holds a change nobody recorded: a first zip imported
// it, then an OLDER invoice point was added by hand (the shape of «last year's zips loaded after this year's»).
async function dbWithUnrecordedChange() {
  const db = makeDb();
  let root = await openWithZip(db, [invoiceZip([FLOUR_LINE])]);
  await toIngredients(root);
  await press(root, 'Import 1 ingredient');
  await closeOverlay(root);
  const id = db.ingredients[0].id;
  db.points[id].push('inv-1-1');
  db.pointDocs[id]['inv-1-1'] = { invoiceId: '1', invoiceDate: '2000-01-01', pricePerUnit: 0.4, priceUnit: 'kg', source: 'invoice' };
  db.changes = [];
  return { db, id };
}

test('⚠️ nothing is written without a confirmation: «Done» on a file with nothing new only closes, the price-change button asks first', async () => {
  const { db, id } = await dbWithUnrecordedChange();
  const written = db.calls.length;
  let root = await openWithZip(db, [invoiceZip([FLOUR_LINE])]);
  await toIngredients(root);
  assert.match(textOf(root), /1 unchanged ingredient/);
  assert.ok(buttonWith(root, 'Record price changes'), 'the zip path offers it');
  await press(root, 'Done');
  assert.equal(overlay(), null, 'Done closes');
  assert.equal(db.calls.length, written, 'and writes nothing');
  assert.equal(db.changes.length, 0);

  root = await openWithZip(db, [invoiceZip([FLOUR_LINE])]);
  await toIngredients(root);
  globalThis.__confirmAnswer = false;
  await press(root, 'Record price changes');
  assert.equal(globalThis.__dialogs.at(-1).message, 'No ingredient or price changes: only the price changes found in the invoices are recorded.');
  assert.equal(db.calls.length, written, 'declined: nothing written');
  assert.ok(overlay(), 'and the screen stays');

  globalThis.__confirmAnswer = true;
  await press(root, 'Record price changes');
  assert.match(textOf(root), /Price changes recorded: 1/);
  assert.deepEqual(db.changes.map(c => [c.ingredientId, c.oldPrice, c.newPrice, c.oldDate]), [[id, 0.4, 0.57, '2000-01-01']]);
  await press(root, 'Done');

  root = await openWithZip(db, [invoiceZip([FLOUR_LINE])]);
  await toIngredients(root);
  await press(root, 'Record price changes');
  assert.match(textOf(root), /Price changes recorded: 0/, 'the second time adds nothing');
  assert.equal(db.changes.length, 1);
  assert.ok(!db.calls.some(c => c[0] === 'remove'));
});

test('⚠️ a late invoice makes a stored change wrong: the import REMOVES it and writes the two right ones', async () => {
  const { db, id } = await dbWithUnrecordedChange();
  // A stale change that compares the wrong two prices (recorded before an older invoice existed).
  const flourPoint = Object.values(db.pointDocs[id]).find(p => p.invoiceDate !== '2000-01-01');
  db.changes.push({
    id: `${Object.keys(db.pointDocs[id]).find(k => k !== 'inv-1-1')}-${id}`, ingredientId: id, oldPrice: 0.3, newPrice: 0.57, oldDate: '1999-01-01',
    date: flourPoint.invoiceDate, priceUnit: 'kg',
  });
  const root = await openWithZip(db, [invoiceZip([FLOUR_LINE])]);
  await toIngredients(root);
  await press(root, 'Record price changes');
  assert.ok(db.calls.some(c => c[0] === 'remove'), 'the wrong change was deleted');
  assert.ok(db.calls.findIndex(c => c[0] === 'remove') < db.calls.findIndex(c => c[0] === 'write' && c[1].startsWith('price-changes/')), 'before the new one is created');
  assert.deepEqual(db.changes.map(c => [c.oldPrice, c.newPrice]), [[0.4, 0.57]]);
});

test('the summary shows the changes recorded, also when there are none', async () => {
  const db = makeDb();
  const root = await open(db, fileText());
  await toIngredients(root);
  await press(root, 'Import 2 ingredients');
  assert.match(textOf(root), /Price changes recorded: 0/);
  assert.equal(db.changes.length, 0);
  assert.equal(db.changeReads, 0, 'a new ingredient reads no stored changes');
});

const isChangeBatch = (batches) => batches[0][0].type === 'add-price-change' || batches[0][0].type === 'remove-price-change';
const twoStepRows = () => fileText([
  ing({ key: 'k-a', name: 'Burro', prices: [stepPrice('18000000001', 1, '2026-01-10'), stepPrice('18000000002', 1.1, '2026-02-10')] }),
  ing({ key: 'k-b', name: 'Panna', prices: [stepPrice('18000000003', 2, '2026-01-10'), stepPrice('18000000004', 2.2, '2026-02-10')] }),
]);

test('⚠️ a refused price change never fails the row nor stops the run: the summary counts it and says to load the file again', async () => {
  const db = makeDb();
  const root = await open(db, twoStepRows());
  await toIngredients(root);
  db.failOn = (n, batches) => (isChangeBatch(batches) ? 'permission-denied' : null);
  await press(root, 'Import 2 ingredients');
  assert.equal(db.ingredients.length, 2, 'both rows were written, the second after the first change was refused');
  db.ingredients.forEach(i => assert.equal(db.points[i.id].length, 2, 'the prices are in'));
  assert.equal(db.changes.length, 0);
  assert.match(textOf(root), /2 ingredients created/);
  assert.doesNotMatch(textOf(root), /not imported/);
  assert.doesNotMatch(textOf(root), /Mise was not allowed to save this/);
  assert.doesNotMatch(textOf(root), /were not tried/);
  assert.match(textOf(root), /Price changes could not be recorded for 2 ingredients: load the same file again to complete them\./);
});

test('a lost connection while recording the changes of rows already in Mise fails no row either', async () => {
  const { db } = await dbWithUnrecordedChange();
  const root = await openWithZip(db, [invoiceZip([FLOUR_LINE])]);
  await toIngredients(root);
  db.failOn = (n, batches) => (isChangeBatch(batches) ? 'unavailable' : null);
  await press(root, 'Record price changes');
  assert.doesNotMatch(textOf(root), /not imported/);
  assert.match(textOf(root), /1 unchanged/);
  assert.match(textOf(root), /Price changes could not be recorded for 1 ingredient: load the same file again to complete them\./);
  assert.doesNotMatch(textOf(root), /There is no connection/);
});

test('the progress line never says «1 of 0» when only rows already in Mise are looked at, and it moves', async () => {
  const { db } = await dbWithUnrecordedChange();
  const root = await openWithZip(db, [invoiceZip([FLOUR_LINE])]);
  await toIngredients(root);
  const seen = [];
  const live = () => walk(root).find(n => n.attributes && n.attributes['aria-live'] === 'polite' && n.attributes.role === 'status');
  db.beforeBatch = () => {};
  const read = globalThis.__inv.invoicePointIds;
  globalThis.__inv.invoicePointIds = async (id) => { seen.push(live() && live().textContent); return read(id); };
  globalThis.__inv.storedPriceChangeIds = ((orig) => async (id) => { seen.push(live() && live().textContent); return orig(id); })(globalThis.__inv.storedPriceChangeIds);
  await press(root, 'Record price changes');
  assert.ok(seen.length > 0);
  seen.forEach(text => assert.equal(text, 'Importing 1 of 1…'));
});

// ── One ingredient, several packs (5 Oct 2026) ──────────────────────────────────

const paccoFile = (over = {}) => fileText([ing({
  key: 'IT00000000001|code:PACCO', name: 'Lievito baking pacco', supplierCode: 'PACCO', weight: '1 kg',
  prices: [price({ invoiceId: '18000000050', line: 1, invoiceDate: '2026-09-10', pricePerUnit: 6 })], ...over,
})]);

test('⚠️ a new pack code answered «Same as» is learnt: the next file matches by it, asks nothing and writes no code again', async () => {
  const db = makeDb();
  db.suppliers.push({ id: 's1', name: 'Fornitore', vatNumber: 'IT00000000001' });
  db.ingredients.push({ id: 'i1', name: 'Lievito baking sacco', shortName: '', supplierId: 's1', kind: 'ingredient', supplierCode: 'SACCO' });

  let root = await open(db, paccoFile());
  await toIngredients(root);
  await pick(selects(root)[0], 'same:i1');
  await press(root, 'Import 1 ingredient');
  assert.equal(db.ingredients.length, 1, 'one ingredient, not two');
  assert.deepEqual(db.ingredients[0].supplierCodes, ['PACCO'], 'the new pack code is remembered');
  assert.equal(db.ingredients[0].supplierCode, 'SACCO', 'the main code stays');
  assert.equal(db.pointDocs.i1['inv-18000000050-1'].packLabel, 'Lievito baking pacco 1 kg', 'the point says which pack it paid for');
  await closeOverlay(root);

  // Another month, another invoice, the supplier's description changed: the code alone finds it.
  const next = paccoFile({ name: 'Lievito secco di birra', prices: [price({ invoiceId: '18000000051', line: 1, invoiceDate: '2026-10-02', pricePerUnit: 6.5 })] });
  const writtenBefore = db.calls.length;
  root = await open(db, next);
  await toIngredients(root);
  assert.doesNotMatch(textOf(root), /To decide/);
  assert.equal(selects(root).length, 0);
  await press(root, 'Import 1 ingredient');
  assert.equal(db.ingredients.length, 1);
  assert.deepEqual(db.ingredients[0].supplierCodes, ['PACCO'], 'no second copy of the code');
  assert.ok(db.calls.length > writtenBefore);
  assert.ok(db.pointDocs.i1['inv-18000000051-1'], 'the price went to the same ingredient');
});

test('a price change between two packs carries both pack names', async () => {
  const db = makeDb();
  db.suppliers.push({ id: 's1', name: 'Fornitore', vatNumber: 'IT00000000001' });
  db.ingredients.push({ id: 'i1', name: 'Lievito baking sacco', shortName: '', supplierId: 's1', kind: 'ingredient', supplierCode: 'SACCO' });
  db.points.i1 = ['inv-18000000001-1'];
  db.pointDocs.i1 = { 'inv-18000000001-1': {
    invoiceId: '18000000001', invoiceDate: '2026-08-10', pricePerUnit: 4, priceUnit: 'kg', source: 'invoice', packLabel: 'Lievito baking sacco 5 kg',
  } };
  const root = await open(db, paccoFile());
  await toIngredients(root);
  await pick(selects(root)[0], 'same:i1');
  await press(root, 'Import 1 ingredient');
  const [change] = db.changes;
  assert.equal(change.oldPack, 'Lievito baking sacco 5 kg');
  assert.equal(change.newPack, 'Lievito baking pacco 1 kg');
});

// ── The name on the invoice: a renamed product is a choice of the person ───────────────────────────────────────

const OLD_NAME = 'FARINA TIPO 00 SACCO KG 25';
const NEW_NAME = 'Farina 00 sacco da kg 25 (nuova ricetta)';

// A venue that already holds the product (main code F00-25, its first invoice price recorded) and a file that
// brings the same price again under a NEW invoice name.
function renamedVenue(fileOver = {}, priceOver = {}) {
  const db = makeDb();
  db.suppliers.push({ id: 's9', name: 'FORNITORE ESEMPIO SRL', shortName: '', vatNumber: 'IT00000000001' });
  db.ingredients.push({
    id: 'ing-9', name: 'Farina tipo 00', shortName: '', supplierId: 's9', supplierCode: 'F00-25', invoiceName: OLD_NAME,
    weight: '25 kg', kind: 'ingredient', active: true,
  });
  db.points['ing-9'] = ['inv-18000000001-5'];
  db.prices['ing-9'] = { priceUnit: 'kg', pricePerUnit: 0.57, priceUpdatedAt: '2026-08-31T12:00:00.000Z', ...priceOver };
  const text = fileText([ing({
    key: 'IT00000000001|code:F00-25', supplierCode: 'F00-25', invoiceName: NEW_NAME, ...fileOver,
  })]);
  return { db, text };
}
const renameSelect = (root) => selects(root).find(s => s.options.some(o => o.textContent === 'Save the new name'));

test('⚠️ a renamed product writes nothing by default; choosing «Save the new name» is a write of the primary action, and the summary says so', async () => {
  const { db, text } = renamedVenue();
  const root = await open(db, text);
  await press(root, 'Next');
  await press(root, 'Next');
  assert.match(textOf(root), /The name on the invoice has changed: «FARINA TIPO 00 SACCO KG 25» → «Farina 00 sacco da kg 25 \(nuova ricetta\)»/);
  assert.match(textOf(root), /To check \(1\)/, 'visible, not held');
  const select = renameSelect(root);
  assert.deepEqual(select.options.map(o => o.textContent), ['Keep the old name', 'Save the new name']);
  assert.equal(select.value, 'keep', 'the old name is the default');
  assert.ok(!buttonWith(root, 'Import'), 'a kept name is nothing to import');

  await pick(select, 'save');
  assert.ok(buttonWith(root, 'Import 1 ingredient'), 'a name-only write counts as a write');
  await press(root, 'Import 1 ingredient');
  assert.match(globalThis.__dialogs.at(-1).message, /1 name on the invoice will be saved/);
  assert.equal(db.ingredients[0].invoiceName, NEW_NAME);
  assert.equal(db.calls.filter(c => c[0] === 'write' && c[1] === 'ingredients/ing-9').length, 1, 'written once, not twice');
  assert.match(textOf(root), /1 name on the invoice saved/);
  assert.equal(db.ingredients[0].name, 'Farina tipo 00', 'nothing else changed');
});

test('a renamed product left on «Keep the old name» is never written', async () => {
  const { db, text } = renamedVenue();
  const root = await open(db, text);
  await press(root, 'Next');
  await press(root, 'Next');
  await press(root, 'Done');
  assert.equal(db.ingredients[0].invoiceName, OLD_NAME);
  assert.equal(db.calls.length, 0);
});

test('a chosen rename whose old name changed while importing is not written, and the summary says it', async () => {
  const { db, text } = renamedVenue();
  const root = await open(db, text);
  await press(root, 'Next');
  await press(root, 'Next');
  await pick(renameSelect(root), 'save');
  db.ingredients[0].invoiceName = 'SOMEBODY ELSE CHANGED IT';
  await press(root, 'Import 1 ingredient');
  assert.equal(db.ingredients[0].invoiceName, 'SOMEBODY ELSE CHANGED IT');
  assert.match(textOf(root), /1 name on the invoice not saved: it changed while importing — load the file again/);
});

test('⚠️ a held price with a chosen rename saves the NAME and leaves the price held', async () => {
  const { db, text } = renamedVenue({
    prices: [price({ line: 6, invoiceId: '18000000002', invoiceDate: '2026-10-01', pricePerUnit: 1.4, reliability: 'media' })],
  }, { pricePerUnit: 1, priceUpdatedAt: '2026-08-31T12:00:00.000Z' });
  db.points['ing-9'] = [];
  const root = await open(db, text);
  await press(root, 'Next');
  await press(root, 'Next');
  assert.ok(renameSelect(root), 'the rename is offered next to the held price');
  await pick(renameSelect(root), 'save');
  await press(root, 'Import 1 ingredient');
  assert.equal(db.ingredients[0].invoiceName, NEW_NAME);
  assert.equal(db.prices['ing-9'].pricePerUnit, 1, 'the held price was not applied');
  assert.deepEqual(db.points['ing-9'], [], 'and no price point leaked');
});
