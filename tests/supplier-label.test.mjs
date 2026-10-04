// A supplier's «name to show» (shortName): the ONE rule for which name the app displays.
//
// Invoices carry long legal names that do not fit a phone; the supplier card gets an optional
// shorter one and every screen that SHOWS a supplier goes through supplierLabel(). The stored
// `name` is untouched. These tests pin the rule, the form's payload, the search, and — by
// reading the sources — that no screen was left showing the invoice name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { supplierLabel, supplierMatches } from '../js/supplier-label.js';
import { filterSuppliers, flatRows, matchesQuery, normalizeText } from '../js/orders/ingredient-search.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ── The rule ─────────────────────────────────────────────────────────────────

test('the short name wins, trimmed', () => {
  assert.equal(supplierLabel({ name: 'Aldo Legacy Foods Ltd Wholesale', shortName: '  Aldo ' }), 'Aldo');
});

test('a blank, whitespace or missing short name falls back to the name', () => {
  assert.equal(supplierLabel({ name: 'Aldo Ltd', shortName: '' }), 'Aldo Ltd');
  assert.equal(supplierLabel({ name: 'Aldo Ltd', shortName: '   ' }), 'Aldo Ltd');
  assert.equal(supplierLabel({ name: 'Aldo Ltd' }), 'Aldo Ltd');
  assert.equal(supplierLabel({ name: 'Aldo Ltd', shortName: 42 }), 'Aldo Ltd');
});

test('never throws on nothing, and answers an empty string', () => {
  for (const bad of [null, undefined, 'text', 7, {}, { name: null }]) {
    assert.doesNotThrow(() => supplierLabel(bad));
  }
  assert.equal(supplierLabel(null), '');
  assert.equal(supplierLabel({}), '');
});

// ── Search finds a supplier by either name ───────────────────────────────────

const ALDO = { id: 'aldo', name: 'Aldo Legacy Foods Ltd Wholesale', shortName: 'Aldo', category: 'Dry' };
const ALBA = { id: 'alba', name: 'Alba', category: 'Dairy' };

test('supplierMatches: by short name, by invoice name, empty query matches all', () => {
  assert.ok(supplierMatches(ALDO, 'aldo', normalizeText));
  assert.ok(supplierMatches(ALDO, 'wholesale', normalizeText));
  assert.ok(!supplierMatches(ALDO, 'alba', normalizeText));
  assert.ok(supplierMatches(ALBA, '', normalizeText));
});

test('filterSuppliers finds by short name, invoice name and category', () => {
  const all = [ALDO, ALBA];
  assert.deepEqual(filterSuppliers(all, 'aldo').map(s => s.id), ['aldo']);
  assert.deepEqual(filterSuppliers(all, 'legacy').map(s => s.id), ['aldo']);
  assert.deepEqual(filterSuppliers(all, 'dairy').map(s => s.id), ['alba']);
});

test('ingredient search rows carry the label and match either name', () => {
  const ing = { id: 'flour', name: 'Flour', weight: '1kg', supplierId: 'aldo' };
  const { rows } = flatRows({ ingredients: [ing], suppliers: [ALDO, ALBA], query: '', only: null });
  assert.equal(rows[0].supplierName, 'Aldo');
  assert.ok(matchesQuery(rows[0], 'aldo'));
  assert.ok(matchesQuery(rows[0], 'legacy'));
  assert.ok(!matchesQuery(rows[0], 'alba'));
});

// ── The supplier card's payload ──────────────────────────────────────────────

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
  globalThis.document = {
    createElement: tag => new FakeNode(tag),
    createTextNode: text => ({ text }),
  };
}

// The text inputs of the form, in the order they are drawn: name, short name, category…
function textInputs(form) {
  return form.all(n => n.tagName === 'input' && n.attrs.type !== 'checkbox');
}

async function submit({ item, typed }) {
  installFakeDom();
  const { buildSupplierForm } = await import('../js/supplier-record-form.js');
  const saved = [];
  const done = [];
  const form = buildSupplierForm({
    item,
    save: async (id, payload) => { saved.push(payload); return id || 'new-id'; },
    onDone: d => done.push(d),
  });
  const [name, shortName] = textInputs(form);
  name.value = typed.name;
  shortName.value = typed.shortName;
  const save = form.headerSave;
  await save.listeners.click();
  return { saved, done, shortName };
}

test('the form saves a trimmed shortName, and hands back the label to show', async () => {
  const { saved, done, shortName } = await submit({
    item: null, typed: { name: ' Aldo Legacy Foods Ltd ', shortName: '  Aldo  ' },
  });
  assert.equal(saved[0].name, 'Aldo Legacy Foods Ltd');
  assert.equal(saved[0].shortName, 'Aldo');
  assert.equal(done[0].name, 'Aldo');
  assert.equal(shortName.attrs.maxlength, '40');
});

test('⚠️ a blank short name is saved as an empty string, so a merge write CLEARS it', async () => {
  const { saved, done } = await submit({
    item: { id: 's1', name: 'Aldo Ltd', shortName: 'Aldo', active: true },
    typed: { name: 'Aldo Ltd', shortName: '   ' },
  });
  assert.ok('shortName' in saved[0], 'the key must be present, or the old value survives the merge');
  assert.equal(saved[0].shortName, '');
  assert.equal(done[0].name, 'Aldo Ltd');
});

test('the form opens showing the stored short name', async () => {
  installFakeDom();
  const { buildSupplierForm } = await import('../js/supplier-record-form.js');
  const form = buildSupplierForm({ item: { id: 's1', name: 'Aldo Ltd', shortName: 'Aldo' }, save: async () => 's1' });
  assert.equal(textInputs(form)[1].value, 'Aldo');
});

// ── Nobody was left showing the invoice name ─────────────────────────────────

const DISPLAY_FILES = [
  'js/orders/registry.js', 'js/orders/ingredient-search.js', 'js/orders/order-summary.js',
  'js/orders/order-summary-view.js', 'js/orders/supplier-detail.js', 'js/orders/supplier-items.js',
  'js/orders/suppliers.js', 'js/orders/reminder-view.js', 'js/orders/reminders.js',
  'js/orders/notifications.js', 'js/orders/deliveries-view.js', 'js/orders/preview.js',
  'js/orders/send-chooser.js', 'js/orders/order-request-model.js', 'js/orders/untold-changes.js',
  'js/orders/archive.js', 'js/orders/history.js', 'js/orders/orders-main.js',
  'js/ingredient-record-form.js', 'js/supplier-record-form.js',
  'js/catalogue/catalogue-model.js', 'js/catalogue/catalogue-editor.js',
];

for (const file of DISPLAY_FILES) {
  test(`${file} shows a supplier through supplierLabel, never its raw name`, () => {
    // A line that shows the INVOICE name on purpose says so with this marker (the supplier's
    // own screen keeps it in sight, to match a delivery note); every other .name is a slip.
    const src = read(file).split('\n')
      .filter(l => !l.trim().startsWith('//') && !/\/\/ invoice name, on purpose$/.test(l.trimEnd()))
      .join('\n');
    assert.match(src, /import \{[^}]*\bsupplierLabel\b[^}]*\} from '(\.\.\/|\.\/)supplier-label\.js';/);
    assert.doesNotMatch(src, /\b(?:supplier|sup|s)\??\.name\b/,
      "a supplier variable's .name is the invoice name — use supplierLabel(supplier)");
  });
}

test("the calculator's own order text is NOT a supplier document and is left alone", () => {
  assert.doesNotMatch(read('js/calculator-order-text.js'), /supplier-label/);
});

test('the new labels exist in both languages', () => {
  const src = read('js/i18n.js');
  assert.equal((src.match(/'orders\.field\.shortName':/g) || []).length, 2);
  assert.equal((src.match(/'orders\.field\.shortNameHint':/g) || []).length, 2);
});

test('supplier-label.js is precached', () => {
  assert.match(read('sw.js'), /'\.\/js\/supplier-label\.js'/);
});
