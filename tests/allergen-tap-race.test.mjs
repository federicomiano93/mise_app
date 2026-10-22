// The ingredient card's allergen and nutrition sections, EXECUTED (23 Oct 2026), for two defects
// that could put a wrong declaration on a printed label.
//
// 1. THE TAP RACE. On a phone a tap runs pointerdown → pointerup → mousedown (the pack text box
//    blurs) → click (the browser flips the box) → change. The card used to propose ticks on that
//    blur, so typing «…latte» and tapping «Milk has» at once ticked Milk on the blur and the
//    click flipped it straight back OFF — and a box a person flipped is theirs for good. Now:
//    leaving the text box proposes nothing; a press inside the sections holds a proposal until
//    its click; an untick of a box the app ticked under 800 ms ago keeps it ticked; Save runs
//    whatever is still waiting.
// 2. «1.550» kJ. The nutrition boxes were type="number", which hands the page 1.55 for «1.550»
//    (measured on Chromium) — a thousandth of the energy on the label. Now they are text boxes
//    and such a figure is refused on its box.
//
// The tap is replayed event by event on the small fake DOM (tests/helpers/form-dom.mjs), with the
// timers and the clock mocked. It proves what the card DECIDES; whether the tap feels right on a
// real phone is the drive on the emulator and Federico's.

import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

import { installDom, walk, type, click, shown } from './helpers/form-dom.mjs';
import { keepsAppTick, RECENT_APP_TICK_MS, tickKey } from '../js/allergen-match.js';
import { nutritionRefusal, allergenState } from '../js/allergen-model.js';
import { usesLegacyCard } from '../js/pack-format.js';

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
// An Italian venue through an English screen: the allergen names are Italian («Latte»), the
// messages English.
globalThis.__miseTestSession = { location: { id: 'loc-test', country: 'IT', language: 'en' } };

// The window the press hold listens on (capture listeners, added and removed per press).
const win = {
  listeners: {},
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); },
  fire(type, event = {}) { [...(this.listeners[type] || [])].forEach(fn => fn({ type, ...event })); },
  count() { return Object.values(this.listeners).reduce((n, list) => n + list.length, 0); },
};
globalThis.window = win;

const { buildIngredientForm } = await import('../js/ingredient-record-form.js');
const { setCurrency } = await import('../js/currency.js');
const { allergenName } = await import('../js/market.js');

const realNow = performance.now;
beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  // The card stamps its own ticks on performance.now(); here it moves with the mocked clock.
  performance.now = () => Date.now();
  win.listeners = {};
});
afterEach(() => {
  mock.timers.reset();
  performance.now = realNow;
});

const BASE = { id: 'I1', name: 'Latte intero', supplierId: 'S1', brand: '', category: 'Other', active: true, kind: 'ingredient' };
const VERIFIED_NONE = { ...BASE, allergens: [], mayContain: [], allergensCheckedAt: '2026-08-20T09:00:00.000Z' };

function openCard({ item = BASE, panels = { allergens: true, nutrition: true }, presetKind = null, mayPrice = false } = {}) {
  const saves = [];
  const root = buildIngredientForm({
    item,
    suppliers: [{ id: 'S1', name: 'Molino' }],
    presetKind,
    mayPrice,
    categories: ['Panetteria'],
    packs: ['busta'],
    panels,
    actions: {
      saveIngredient: async (id, payload) => { saves.push(payload); },
      priceHistory: async () => [],
      packPhotoOn: () => false,
    },
    onDone: () => {},
  });
  const all = () => walk(root);
  const block = all().find(n => n.classList.contains('alg-block'));
  const tick = (code, column = 'contains') => {
    const row = all().find(n => n.classList.contains('alg-row')
      && n.children[0].textContent === allergenName(code, 'it'));
    return row.children[column === 'contains' ? 1 : 2].children[0];
  };
  const checkedBox = all().find(n => n.classList.contains('alg-checked')).children[0];
  const nutritionBoxes = all().filter(n => n.classList.contains('alg-num'));
  return {
    root, block, saves, tick, checkedBox,
    pack: all().find(n => n.classList.contains('alg-pack-text')),
    kj: nutritionBoxes[0],
    kcal: nutritionBoxes[1],
    fat: nutritionBoxes[2],
    errors: () => all().filter(n => n.classList.contains('alg-nut-error') && shown(n)).map(n => n.textContent),
    nutritionFoldOpen: () => shown(nutritionBoxes[0]),
    async save() {
      click(root.headerSave);
      await new Promise(r => setImmediate(r));
      return saves[saves.length - 1];
    },
  };
}

// Typing into the pack box: only `input`, as the keyboard raises it.
function typePack(card, text) {
  card.pack.value = text;
  card.pack.fire('input');
}

// A finger on a tick box, in the order a phone raises the events. `between` runs after the finger
// is down and before it lifts (the moment the pause can end under it).
function tap(card, box, { between = () => {} } = {}) {
  card.block.fire('pointerdown', { target: box });
  between();
  win.fire('pointerup', { target: box });
  card.pack.fire('change');                 // mousedown: the text box blurs
  box.checked = !box.checked;               // the browser flips the box before dispatching click
  win.fire('click', { target: box });       // the window's capture listener runs first…
  box.fire('change');                       // …then the box's own change
}

// ── The pure rules ────────────────────────────────────────────────────────────

test('keepsAppTick: only an UNtick of a box the app ticked under 800 ms ago is kept', () => {
  const key = tickKey('milk', 'contains');
  const owned = new Set([key]);
  const at = new Map([[key, 1000]]);
  assert.equal(RECENT_APP_TICK_MS, 800);
  assert.equal(keepsAppTick({ key, on: false, appOwned: owned, tickedAt: at, now: 1000 + 799 }), true);
  assert.equal(keepsAppTick({ key, on: false, appOwned: owned, tickedAt: at, now: 1000 + 800 }), false,
    'an older app tick is the person’s to remove');
  assert.equal(keepsAppTick({ key, on: true, appOwned: owned, tickedAt: at, now: 1001 }), false, 'a tick on is what was asked');
  assert.equal(keepsAppTick({ key, on: false, appOwned: new Set(), tickedAt: at, now: 1001 }), false,
    'a box the app does not own is the person’s');
  assert.equal(keepsAppTick({ key, on: false, appOwned: owned, tickedAt: new Map(), now: 1001 }), false);
  assert.equal(keepsAppTick({ key, on: false, appOwned: owned, tickedAt: at, now: 900 }), false,
    'a clock that went backwards proves nothing');
});

test('nutritionRefusal: a kJ or kcal figure with a thousands separator is refused, never guessed', () => {
  const empty = {};
  for (const text of ['1.550', '1,550', '2.000', '999,999', ' 1.550 ']) {
    assert.deepEqual(nutritionRefusal({ kj: text }, empty), { key: 'kj', reason: 'thousands' }, text);
    assert.deepEqual(nutritionRefusal({ kcal: text }, empty), { key: 'kcal', reason: 'thousands' }, text);
  }
  // Ordinary figures, and a leading zero (never a thousands group), are read.
  for (const text of ['1550', '370', '12,5', '12.5', '0,125', '0', '.5', '']) {
    assert.equal(nutritionRefusal({ kj: text, kcal: text }, empty), null, text);
  }
  // On grams a dot is a decimal: 1.550 g of fat is 1.55 g.
  assert.equal(nutritionRefusal({ fat: '1.550', salt: '1,550' }, empty), null);
});

test('nutritionRefusal: text that is not a plain number of 0 or more is refused', () => {
  for (const text of ['abc', '1.234,5', '-3', '1e3', '0x10', 'Infinity', '12,5 g', '1..5']) {
    assert.deepEqual(nutritionRefusal({ protein: text }, {}), { key: 'protein', reason: 'invalid' }, text);
  }
});

test('nutritionRefusal: only a box somebody changed is judged, first in label order', () => {
  assert.equal(nutritionRefusal({ kj: '1.550' }, { kj: '1.550' }), null, 'what the card opened with never blocks');
  assert.deepEqual(nutritionRefusal({ kj: '1.550', kcal: 'abc' }, {}), { key: 'kj', reason: 'thousands' });
});

// ── 1. The tap race ───────────────────────────────────────────────────────────

test('leaving the pack box proposes nothing; the pause does', () => {
  const card = openCard();
  typePack(card, 'latte');
  card.pack.fire('change');
  assert.equal(card.tick('milk').checked, false, 'a blur must not move a box under a finger');
  mock.timers.tick(449);
  assert.equal(card.tick('milk').checked, false);
  mock.timers.tick(1);
  assert.equal(card.tick('milk').checked, true, 'the pause proposes');
});

test('⚠️ type «…latte», tap «Milk has» at once: Milk ends TICKED (the blur used to tick it and the tap untick it)', () => {
  const card = openCard();
  typePack(card, 'farina di grano tenero, latte');
  mock.timers.tick(100);
  tap(card, card.tick('milk'));
  mock.timers.tick(0);
  assert.equal(card.tick('milk').checked, true, 'the person ticked Milk and Milk is ticked');
  mock.timers.tick(450);
  assert.equal(card.tick('gluten-wheat').checked, true, 'the rest of the pack is still proposed, after the tap');
  assert.equal(card.tick('milk').checked, true);
});

test('⚠️ a pause that ends while the finger is down waits for the click', () => {
  const card = openCard();
  typePack(card, 'farina di grano tenero, latte');
  mock.timers.tick(300);
  let duringPress;
  tap(card, card.tick('milk'), {
    between: () => {
      mock.timers.tick(200);                  // the pause ends with the finger down
      duringPress = card.tick('gluten-wheat').checked;
    },
  });
  assert.equal(duringPress, false, 'nothing moves inside a tap');
  assert.equal(card.tick('milk').checked, true, 'the tap ticked Milk, as meant');
  mock.timers.tick(0);
  assert.equal(card.tick('gluten-wheat').checked, true, 'the held proposal runs right after the click');
  assert.equal(card.tick('milk').checked, true, 'and leaves the person’s Milk alone');
  assert.equal(win.count(), 0, 'the press listeners are gone');
});

test('⚠️ a tap that lands just as the app ticked the same box keeps it ticked, and makes it the person’s', () => {
  const card = openCard();
  typePack(card, 'latte');
  mock.timers.tick(450);                      // the app ticks Milk…
  assert.equal(card.tick('milk').checked, true);
  mock.timers.tick(150);                      // …and the finger lands 150 ms later
  tap(card, card.tick('milk'));
  mock.timers.tick(0);
  assert.equal(card.tick('milk').checked, true, 'the tap meant «tick it»');
  // It is the person's now: a second, deliberate tap unticks it, and the text never puts it back.
  mock.timers.tick(2000);
  tap(card, card.tick('milk'));
  mock.timers.tick(0);
  assert.equal(card.tick('milk').checked, false, 'a second tap is a correction');
  typePack(card, 'latte, zucchero');
  mock.timers.tick(450);
  assert.equal(card.tick('milk').checked, false, 'and the app does not argue with it');
});

test('an untick of an app tick from more than 800 ms ago is the person’s correction', () => {
  const card = openCard();
  typePack(card, 'latte');
  mock.timers.tick(450);
  mock.timers.tick(RECENT_APP_TICK_MS);
  tap(card, card.tick('milk'));
  mock.timers.tick(0);
  assert.equal(card.tick('milk').checked, false);
});

test('⚠️ type, then tap «I have checked» at once: the proposal lands AFTER the tap and the check is cleared', async () => {
  const card = openCard();
  typePack(card, 'latte');
  mock.timers.tick(100);
  tap(card, card.checkedBox);
  assert.equal(card.checkedBox.checked, true, 'the tap ticked it, and nothing moved inside the tap…');
  assert.equal(card.tick('milk').checked, false);
  mock.timers.tick(350);                      // the pause ends after the tap
  assert.equal(card.tick('milk').checked, true, '…then the pack ticked Milk…');
  assert.equal(card.checkedBox.checked, false, '…and a list nobody saw is not verified');
  const payload = await card.save();
  assert.deepEqual(payload.allergens, ['milk']);
  assert.equal(allergenState(payload), 'unknown', 'saved as still to check, never stamped');
});

test('⚠️ on a verified record, the same tap cannot keep the old stamp on a new list', async () => {
  const card = openCard({ item: VERIFIED_NONE });
  assert.equal(card.checkedBox.checked, true);
  typePack(card, 'latte');
  mock.timers.tick(100);
  tap(card, card.checkedBox);                 // unticks it…
  tap(card, card.checkedBox);                 // …and ticks it again, all inside the pause
  mock.timers.tick(350);
  assert.equal(card.tick('milk').checked, true);
  assert.equal(card.checkedBox.checked, false, 'the app moved a box: the verification lapses');
  const payload = await card.save();
  assert.equal(payload.allergensCheckedAt, '');
});

test('⚠️ Save runs a proposal that is still waiting on the pause', async () => {
  const card = openCard();
  typePack(card, 'farina di grano tenero, latte');
  mock.timers.tick(100);
  const payload = await card.save();
  assert.deepEqual([...payload.allergens].sort(), ['gluten-wheat', 'milk']);
  assert.equal(payload.packIngredients, 'farina di grano tenero, latte');
  assert.equal(allergenState(payload), 'unknown', 'proposed, never declared');
});

test('Save runs a proposal held by a press that never ended', async () => {
  const card = openCard();
  typePack(card, 'latte');
  card.block.fire('pointerdown', { target: card.tick('eggs') });
  mock.timers.tick(450);
  assert.equal(card.tick('milk').checked, false, 'held');
  const payload = await card.save();
  assert.deepEqual(payload.allergens, ['milk']);
  assert.equal(win.count(), 0);
});

test('a press that ends without a click (a scroll, a release off the box) lets the proposal through', () => {
  const card = openCard();
  typePack(card, 'latte');
  card.block.fire('pointerdown', { target: card.tick('eggs') });
  mock.timers.tick(450);
  win.fire('pointercancel');
  mock.timers.tick(0);
  assert.equal(card.tick('milk').checked, true, 'pointercancel ends the press');

  const again = openCard();
  typePack(again, 'latte');
  again.block.fire('pointerdown', { target: again.tick('eggs') });
  mock.timers.tick(450);
  win.fire('pointerup');
  mock.timers.tick(699);
  assert.equal(again.tick('milk').checked, false);
  mock.timers.tick(1);
  assert.equal(again.tick('milk').checked, true, '700 ms after the finger lifted with no click');
  assert.equal(win.count(), 0);
});

test('Space on a focused tick box is a press too', () => {
  const card = openCard();
  const milk = card.tick('milk');
  typePack(card, 'latte');
  mock.timers.tick(100);
  card.block.fire('keydown', { key: ' ', target: milk });
  mock.timers.tick(400);                      // the pause ends with the key down
  assert.equal(milk.checked, false, 'held');
  win.fire('keyup', { key: ' ' });
  milk.checked = true;
  win.fire('click', { target: milk });
  milk.fire('change');
  mock.timers.tick(0);
  assert.equal(milk.checked, true);
  // Space anywhere else (typing a space in the pack box) holds nothing.
  typePack(card, 'latte, uova');
  card.block.fire('keydown', { key: ' ', target: card.pack });
  mock.timers.tick(450);
  assert.equal(card.tick('eggs').checked, true);
});

test('opening a saved ingredient still moves no box', () => {
  const card = openCard({ item: { ...VERIFIED_NONE, packIngredients: 'latte' } });
  mock.timers.tick(5000);
  assert.equal(card.tick('milk').checked, false, 'a stored untick is never re-proposed on open');
  assert.equal(card.checkedBox.checked, true);
});

// ── 2. The nutrition boxes ──────────────────────────────────────────────────────

test('the nutrition boxes are text boxes with the decimal keyboard, shown in the venue’s layout', () => {
  setCurrency('€', { decimal: ',', group: '.', symbolAfter: true });
  try {
    const card = openCard({ item: { ...BASE, nutrition: { kj: 1550, kcal: 370, fat: 12.5 } } });
    assert.equal(card.kj.attributes.type, 'text');
    assert.equal(card.kj.attributes.inputmode, 'decimal');
    assert.equal(card.kj.value, '1550', 'never grouped: a thousands dot typed back would not read');
    assert.equal(card.fat.value, '12,5');
  } finally { setCurrency(null); }
});

test('an untouched save writes the stored nutrition back unchanged', async () => {
  setCurrency('€', { decimal: ',', group: '.', symbolAfter: true });
  try {
    const nutrition = { kj: 1550, kcal: 370, fat: 12.5, saturates: 0, carbs: null, sugars: 0.25, protein: 8, salt: 1.2 };
    const card = openCard({ item: { ...BASE, nutrition } });
    const payload = await card.save();
    assert.deepEqual(payload.nutrition, nutrition);
  } finally { setCurrency(null); }
});

test('⚠️ «1.550» kJ is refused on its box, with the reason, and nothing is saved', async () => {
  const card = openCard();
  type(card.kj, '1.550');
  assert.equal(await card.save(), undefined, 'nothing saved');
  assert.deepEqual(card.errors(), ['Write it without the thousands separator — e.g. 1550.']);
  assert.equal(card.kj.attributes['aria-invalid'], 'true');
  assert.ok(card.kj.focused > 0, 'the box is focused');
  assert.ok(card.nutritionFoldOpen(), 'the folded section is opened to show it');
  type(card.kj, '1550');
  assert.deepEqual(card.errors(), [], 'typing clears it');
  const payload = await card.save();
  assert.equal(payload.nutrition.kj, 1550);
});

test('«1,550» kcal is refused too; a comma decimal is read; unreadable text is refused', async () => {
  const card = openCard();
  type(card.kcal, '1,550');
  assert.equal(await card.save(), undefined);
  assert.deepEqual(card.errors(), ['Write it without the thousands separator — e.g. 1550.']);
  type(card.kcal, '370');
  type(card.fat, 'abc');
  assert.equal(await card.save(), undefined);
  assert.deepEqual(card.errors(), ['Write a number, 0 or more — e.g. 12.5.']);
  type(card.fat, '12,5');
  const payload = await card.save();
  assert.equal(payload.nutrition.kcal, 370);
  assert.equal(payload.nutrition.fat, 12.5);
});

test('a venue with nutrition switched off is never refused for it', async () => {
  const card = openCard({ item: { ...BASE, nutrition: { kj: 1550 } }, panels: { allergens: true, nutrition: false } });
  const payload = await card.save();
  assert.equal(payload.nutrition.kj, 1550, 'kept exactly as stored');
});

test('⚠️ a pause that ends while the finger is on «I have checked» lands after the click, and clears it', () => {
  const card = openCard({ item: VERIFIED_NONE });
  typePack(card, 'latte');
  mock.timers.tick(300);
  tap(card, card.checkedBox, { between: () => mock.timers.tick(200) });
  assert.equal(card.tick('milk').checked, false, 'nothing moved inside the tap');
  mock.timers.tick(0);
  assert.equal(card.tick('milk').checked, true);
  assert.equal(card.checkedBox.checked, false, 'a list with a box nobody saw is never left verified');
});

test('⚠️ a tick of «I have checked» landing just AFTER the app moved a box is undone; a later one verifies', () => {
  const card = openCard({ item: VERIFIED_NONE });
  typePack(card, 'latte');
  mock.timers.tick(450);                      // the app ticks Milk and clears the verification…
  assert.equal(card.checkedBox.checked, false);
  mock.timers.tick(100);                      // …and a finger already on its way lands on it
  tap(card, card.checkedBox);
  mock.timers.tick(0);
  assert.equal(card.checkedBox.checked, false, 'nobody has looked at the new list yet');
  mock.timers.tick(RECENT_APP_TICK_MS);
  tap(card, card.checkedBox);
  mock.timers.tick(0);
  assert.equal(card.checkedBox.checked, true, 'a tap after a look verifies');
});

test('⚠️ the card of before (an old price shape) refuses «1.550» kJ too, and Save runs a waiting proposal', async () => {
  const OLD = { ...BASE, unit: 'sacco', weight: '6x1kg', priceUnit: 'kg', pricePerUnit: 2, vatRate: 4 };
  assert.equal(usesLegacyCard(OLD), true, 'the fixture must open the card of before');
  const card = openCard({ item: OLD, mayPrice: true });
  assert.ok(card.root.headerSave, 'the card of before opens only for somebody who may see prices');
  type(card.kj, '1.550');
  assert.equal(await card.save(), undefined, 'refused');
  assert.deepEqual(card.errors(), ['Write it without the thousands separator — e.g. 1550.']);
  type(card.kj, '1550');
  typePack(card, 'latte');
  const payload = await card.save();
  assert.equal(payload.nutrition.kj, 1550);
  assert.deepEqual(payload.allergens, ['milk']);
});

test('packaging: its hidden block is never refused and never read on Save', async () => {
  const BOX = { ...BASE, kind: 'packaging', nutrition: { kj: 1550 } };
  const card = openCard({ item: BOX });
  type(card.kj, '1.550');                     // unreachable on screen; proves Save does not judge it
  const payload = await card.save();
  assert.ok(payload, 'saved');
  assert.equal('nutrition' in payload, false, 'the stored declaration is left exactly as it was');
});

test('a quick second tap, down before the first one’s held proposal runs, holds it in turn', () => {
  const card = openCard();
  typePack(card, 'farina di grano tenero, latte');
  mock.timers.tick(300);
  tap(card, card.tick('milk'), { between: () => mock.timers.tick(200) });   // the pause ends inside tap 1
  card.block.fire('pointerdown', { target: card.tick('eggs') });           // tap 2 lands before the 0 ms run
  mock.timers.tick(0);
  assert.equal(card.tick('gluten-wheat').checked, false, 'nothing lands inside the second tap');
  win.fire('pointerup');
  card.tick('eggs').checked = true;
  win.fire('click');
  card.tick('eggs').fire('change');
  mock.timers.tick(0);
  assert.equal(card.tick('gluten-wheat').checked, true, 'it runs after the second click');
  assert.equal(card.tick('eggs').checked, true);
  assert.equal(card.tick('milk').checked, true);
});
