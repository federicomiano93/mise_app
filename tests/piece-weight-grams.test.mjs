// «Peso di un pezzo» is typed in GRAMS and stored in KILOS (8 Nov 2026).
//
// The box said «(kg)» and an egg was saved as 50 — fifty kilos — so every recipe priced its eggs at 0,0033 €/kg.
// The card now shows and reads grams; `unitWeightKg` stays in kilos for every reader (price-model.js, order-cost.js,
// Food cost, Mise 2). What is asserted: the figure the box shows for a stored weight, and the payload the card hands
// to saveIngredient for a typed one — on the new card AND on the card of before (pack-format.js usesLegacyCard).

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

import { installDom, walk, type, click } from './helpers/form-dom.mjs';

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
const { buildIngredientForm, gramsOfKg, kgTextOfGrams } = await import('../js/ingredient-record-form.js');
const { setCurrency } = await import('../js/currency.js');
before(() => setCurrency('€'));

const BASE = { id: 'I1', name: 'Uova', supplierId: 'S1', brand: '', category: 'Other', active: true, kind: 'ingredient' };
// A per-piece price with its own piece weight: the form that shows «Weight of one piece».
const EGG = { ...BASE, unit: 'pz', weight: '', priceUnit: 'pcs', pricePerUnit: 0.167, unitWeightKg: 0.05, vatRate: 10 };
// An old per-piece case with no packCount: the card of before opens for it.
const LEGACY_PIECES = { ...BASE, unit: 'cartone', packUnit: 'pezzo', weight: '', priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs', unitWeightKg: 0.06, vatRate: 22 };

function openCard(item) {
  const saves = [];
  const root = buildIngredientForm({
    item,
    suppliers: [{ id: 'S1', name: 'Molino' }],
    presetKind: null,
    mayPrice: true,
    categories: ['Other'],
    packs: ['pezzo'],
    panels: { allergens: false, nutrition: false },
    actions: {
      saveIngredient: async (id, payload, record, writePrice, meta) => { saves.push({ id, payload, record, writePrice, meta }); },
      priceHistory: async () => [],
      packPhotoOn: () => false,
    },
    onDone: () => {},
  });
  const label = walk(root).find(n => n.tagName === 'LABEL'
    && walk(n).some(c => c.classList.contains('mgmt-field-label') && /^Weight of one piece/.test(c.textContent)));
  const box = label && walk(label).find(n => n.tagName === 'INPUT');
  const caption = label && walk(label).find(n => n.classList.contains('mgmt-field-label'));
  return {
    box, caption,
    async save() { click(root.headerSave); await new Promise(r => setImmediate(r)); return saves[saves.length - 1]; },
  };
}

test('kilos → grams for the box, and back to the kilo text the model reads', () => {
  assert.equal(gramsOfKg(0.05), '50');
  assert.equal(gramsOfKg(0.055), '55');
  assert.equal(gramsOfKg(0.0035), '3.5');
  assert.equal(gramsOfKg(50), '50000', 'a weight saved as 50 kg shows as 50000 g: the mistake is visible');
  assert.equal(gramsOfKg(null), '');
  assert.equal(gramsOfKg(undefined), '');
  assert.equal(gramsOfKg(''), '');
  assert.equal(kgTextOfGrams('55'), '0.055');
  assert.equal(kgTextOfGrams('3,5'), '0.0035', 'a comma is read like a point');
  assert.equal(kgTextOfGrams(' 50 '), '0.05');
  assert.equal(kgTextOfGrams(''), '');
  assert.equal(kgTextOfGrams('abc'), 'abc', 'text that is not a number passes through, so Save refuses it');
  // Review, 8 Nov 2026: the price model reads the box with Number(), which takes these too — unconverted they
  // would be saved as KILOS, the very mistake this fix is for.
  assert.equal(kgTextOfGrams('55,'), '0.055', 'a trailing comma is still grams');
  assert.equal(kgTextOfGrams('55.'), '0.055', 'a trailing point is still grams');
  assert.equal(kgTextOfGrams(',5'), '0.0005', 'a leading comma is still grams');
  assert.equal(kgTextOfGrams('1e2'), '0.1', 'an exponent is still grams');
});

test('the new card: the box is captioned in grams and shows the stored weight in grams', () => {
  const card = openCard(EGG);
  assert.ok(card.box, 'the piece weight box is on the card');
  assert.match(card.caption.textContent, /\(g\)$/);
  assert.equal(card.box.value, '50');
});

test('the new card: 55 typed is saved as 0.055 kg, the price untouched', async () => {
  const card = openCard(EGG);
  type(card.box, '55');
  const { payload } = await card.save();
  assert.equal(payload.priceUnit, 'pcs');
  assert.equal(payload.pricePerUnit, 0.167);
  assert.equal(payload.unitWeightKg, 0.055);
});

test('the new card: an untouched box saves the stored kilos unchanged', async () => {
  const card = openCard(EGG);
  const { payload } = await card.save();
  assert.equal(payload.unitWeightKg, 0.05);
});

test('the new card: «55,» typed (a digit still to come) is saved as 0.055 kg, never as 55 kg', async () => {
  const card = openCard(EGG);
  type(card.box, '55,');
  const { payload } = await card.save();
  assert.equal(payload.unitWeightKg, 0.055);
});

test('the card of before: grams shown, grams typed, kilos saved', async () => {
  const card = openCard(LEGACY_PIECES);
  assert.ok(card.box, 'the legacy card has the piece weight box');
  assert.equal(card.box.value, '60');
  type(card.box, '65');
  const { payload } = await card.save();
  assert.equal(payload.unitWeightKg, 0.065);
});

test('both dictionaries say grams, with examples in grams', () => {
  const i18n = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
  assert.match(i18n, /'orders\.weightOfOnePiece': 'Weight of one piece \(g\)'/);
  assert.match(i18n, /'orders\.weightOfOnePiece': 'Peso di un pezzo \(g\)'/);
  assert.doesNotMatch(i18n, /'orders\.weightOfOnePiece': '[^']*\(kg\)'/);
  assert.doesNotMatch(i18n, /'orders\.eg\.pieceWeight': '[^']*0[.,]0/);
  assert.doesNotMatch(i18n, /'orders\.neededOnlyToUse': '[^']*0[.,]0/);
});
