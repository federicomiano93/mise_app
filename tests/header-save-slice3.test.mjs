// Slice 3 of «Save moves into the green header» (4 Oct 2026): «What arrived?» and the supplier /
// ingredient / packaging forms, on every host that draws their header (the Suppliers & ingredients
// page, Orders' add / edit ingredient, the Catalogue's «+ new ingredient» and its «+ new supplier»).
//
// Two halves. The ingredient card is EXECUTED on a small fake DOM (what the button does), and the
// hosts are read as source (where the button ends up). The owner cannot read code, so:
//   • a form builds ONE Save, a header pill, and hands it up as `form.headerSave` — it is not in the form;
//   • no Cancel and no btn-primary / btn-secondary is left in the form; Delete stays, alone in its row;
//   • a second tap while a write runs does nothing, and a failed write re-enables the button;
//   • every host puts that button in its header's right slot, and «a save is in flight» is read from the header.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { installDom, walk, type, click } from './helpers/form-dom.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const STUB = new URL('./helpers/session-stub.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './firebase.js' && String(context.parentURL).endsWith('/js/ingredient-record-form.js')) {
      return { url: STUB, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
installDom();
globalThis.__miseTestSession = { location: { id: 'loc-test', country: 'IT', language: 'en' } };
const { buildIngredientForm } = await import('../js/ingredient-record-form.js');

function openCard({ item = null, withDelete = false, saveIngredient } = {}) {
  const saves = [];
  const form = buildIngredientForm({
    item, suppliers: [{ id: 'S1', name: 'Molino' }], mayPrice: false, categories: ['Panetteria'], packs: ['busta'],
    panels: { allergens: false, nutrition: false },
    actions: {
      saveIngredient: saveIngredient || (async (id, payload) => { saves.push(payload); }),
      priceHistory: async () => [], packPhotoOn: () => false,
      ...(withDelete ? { deleteIngredient: async () => {} } : {}),
    },
    onDone: () => {},
  });
  const name = walk(form).find(n => n.tagName === 'INPUT' && n.classList.contains('mgmt-input'));
  return { form, saves, name, save: form.headerSave };
}

const tick = () => new Promise(r => setImmediate(r));
const STORED = { id: 'I1', name: 'Caputo', supplierId: 'S1', brand: '', category: 'Panetteria', active: true, kind: 'ingredient', unit: 'sacco', weight: '25kg' };

test('the ingredient form hands up ONE header Save and draws none inside itself', () => {
  const { form, save } = openCard({ item: STORED });
  assert.ok(save, 'form.headerSave');
  assert.equal(save.tagName, 'BUTTON');
  assert.ok(save.classList.contains('app-header-save'));
  assert.equal(save.textContent, 'Save');
  assert.ok(!walk(form).includes(save), 'it is not in the form: the host puts it in the header');
  const buttons = walk(form).filter(n => n.tagName === 'BUTTON');
  assert.ok(!buttons.some(b => b.classList.contains('btn-primary') || b.classList.contains('btn-secondary')));
  assert.ok(!buttons.some(b => /^Cancel$/.test(b.textContent)), 'no Cancel: Back does what it did');
});

test('no Delete means no actions row at all; Delete alone in its row when it is handed in', () => {
  const plain = openCard({ item: STORED });
  assert.ok(!walk(plain.form).some(n => n.classList.contains('mgmt-form-actions')));
  const owner = openCard({ item: STORED, withDelete: true });
  const row = walk(owner.form).find(n => n.classList.contains('mgmt-form-actions'));
  assert.ok(row);
  assert.equal(row.children.filter(Boolean).length, 1);
  assert.ok(row.children[0].classList.contains('mgmt-delete-btn'));
});

test('an empty name is refused before anything is written, and focuses the name', async () => {
  const card = openCard();
  type(card.name, '   ');
  const before = card.name.focused;
  click(card.save);
  await tick();
  assert.equal(card.saves.length, 0);
  assert.ok(card.name.focused > before);
  assert.equal(card.save.disabled, false);
});

test('the Save disables itself while the write runs, and a second tap saves nothing more', async () => {
  let release;
  const writes = [];
  const card = openCard({
    item: STORED,
    saveIngredient: (id, payload) => { writes.push(payload); return new Promise(r => { release = r; }); },
  });
  click(card.save);
  await tick();
  assert.equal(card.save.disabled, true);
  click(card.save);
  click(card.save);
  await tick();
  assert.equal(writes.length, 1, 'one write, however many taps');
  release();
  await tick();
});

test('a refused write re-enables the button (read as source: the alert needs a real page)', () => {
  const form = code(read('js/ingredient-record-form.js'));
  const again = /save\.disabled = false;[^\n]*\n\s*await reportFailure\('save'/g;
  assert.equal((form.match(again) || []).length, 2, 'new card and card of before');
  assert.match(code(read('js/supplier-record-form.js')), /saveBtn\.disabled = false;[^\n]*\n\s*await reportFailure\('save'/);
});

// ── Source pins: the hosts ───────────────────────────────────────────────────

test('the supplier form: header pill, exposed, ignores a tap while saving, no Cancel', () => {
  const src = code(read('js/supplier-record-form.js'));
  assert.match(src, /const saveBtn = el\('button', \{ type: 'button', class: 'app-header-save'/);
  assert.match(src, /if \(saveBtn\.disabled\) return;/);
  assert.match(src, /form\.headerSave = saveBtn;/);
  assert.doesNotMatch(src, /onCancel|btn-primary|btn-secondary/);
});

test('the ingredient form takes no onCancel, and its Save is the pill', () => {
  const src = code(read('js/ingredient-record-form.js'));
  assert.doesNotMatch(src, /onCancel/);
  assert.match(src, /const save = el\('button', \{ type: 'button', class: 'app-header-save'/);
  assert.match(src, /if \(save\.disabled\) return;/);
  assert.match(src, /form\.headerSave = save;/);
});

test('Suppliers & ingredients: overlay() puts the form\'s Save in the right slot of the level\'s header', () => {
  const src = code(read('js/orders/registry.js'));
  assert.match(src, /el\('span', \{ class: 'app-header-slot' \}, headerAction \? \[headerAction\] : \[\]\)/);
  assert.match(src, /body, close, form\.headerSave\)/);
  assert.match(src, /return overlay\(entry, title, body, undefined, form\.headerSave\)/);
});

test('a save in flight is read from the header, on every host', () => {
  const registry = code(read('js/orders/registry.js'));
  assert.match(registry, /entry\.overlay\.querySelector\('\.app-header-save:disabled'\)/);
  const create = code(read('js/ingredient-create.js'));
  assert.match(create, /layerNode\?\.querySelector\('\.app-header-save:disabled'\)/);
  assert.doesNotMatch(registry + create, /btn-primary:disabled/);
});

test('Orders and the Catalogue share ingredient-create: all three layers draw the pill and Back still resolves', () => {
  const src = code(read('js/ingredient-create.js'));
  assert.match(src, /el\('span', \{ class: 'app-header-slot' \}, action \? \[action\] : \[\]\)/);
  assert.equal((src.match(/action: form\.headerSave,/g) || []).length, 3, 'new supplier, new ingredient, edit ingredient');
  assert.match(src, /close\(null\);\s*\},\s*body: form,/, 'the supplier layer\'s Back resolves null, as Cancel did (after asking, when typed into)');
  assert.match(src, /onBack: leave,/);
});

test('«What arrived?»: the Save is in the header, uses ui.save, and keeps the remove-then-confirm flow', () => {
  const src = code(read('js/orders/deliveries-view.js'));
  const header = src.slice(src.indexOf("el('header', { class: 'app-header orders-header' }"), src.indexOf("el('div', { class: 'scroll-area' }"));
  assert.match(header, /class: 'app-header-save', type: 'button', text: t\('ui\.save'\)/);
  assert.match(header, /overlay\.remove\(\);\s*await confirm\(entry, \[\.\.\.missing\], ctx\);\s*done\(true\);/);
  assert.doesNotMatch(src, /missing-save|saveArrival/);
  for (const dict of ['js/i18n.js']) assert.doesNotMatch(read(dict), /orders\.deliveries\.saveArrival/);
  assert.doesNotMatch(read('orders.css'), /\.missing-save/);
});

test('the actions row styles for Save and Cancel are gone; the Delete ones stay', () => {
  const css = code(read('orders.css'));
  assert.doesNotMatch(css, /\.mgmt-form-actions \.btn-(primary|secondary)/);
  assert.match(css, /\.mgmt-form-actions \.mgmt-delete-btn \{/);
});

test('the invoice-import wizard footer and the people rename keep their own buttons (not a screen Save)', () => {
  assert.match(read('js/orders/invoice-import-screen.js'), /btn-primary/);
});

// P20: the «+ new supplier» layer opened from inside an ingredient card used to close at
// once on Back (and on the Cancel that sat beside Save), losing a half-typed supplier.
test('the «+ new supplier» sub-layer asks before Back throws typing away', () => {
  const src = read('js/ingredient-create.js');
  const at = src.indexOf('function createSupplier');
  const fn = src.slice(at, src.indexOf('\n}\n', at));
  assert.match(fn, /typedInto\(snapshot, node\) && !\(await confirmDiscard\(\)\)/);
  assert.match(fn, /snapshot = snapshotFields\(form\)/);
});
