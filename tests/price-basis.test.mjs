// What the number in the ingredient card's price box REFERS to (7 Oct 2026): a pack, a carton, or a
// price per kilo / litre. The choice is only a way of typing and showing one number — the stored price
// keeps its shape — so these tests pin the conversions both ways, the round trip, the defaults, that
// the choice never plants a history entry, and that the typed form and the old card have no selector.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newCardSource, legacyCardSource } from './helpers/card-source.mjs';
import {
  PRICE_FORMS, priceFormOf, basisOptions, defaultBasis, basisOf, basisToStore, rateBaseOf,
  basisToStoredPrice, storedPriceToBasis, convertBasisPrice,
  formatPriceInput, storedPriceInput, pricePatch, priceChanged, priceBoxStart, splitPriceFields,
} from '../js/price-model.js';

const single = { kind: 'single', count: null, inner: '' };
const carton = (count) => ({ kind: 'carton', count, inner: 'busta' });
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('each form offers its own choices, default first; the typed form offers none', () => {
  assert.deepEqual(basisOptions(PRICE_FORMS.singlePack), ['pack', 'rate']);
  assert.deepEqual(basisOptions(PRICE_FORMS.cartonPack), ['case', 'pack', 'rate']);
  assert.deepEqual(basisOptions(PRICE_FORMS.cartonPieces), ['case', 'pack']);
  assert.deepEqual(basisOptions(PRICE_FORMS.typed), []);
  assert.equal(defaultBasis(PRICE_FORMS.singlePack), 'pack');
  assert.equal(defaultBasis(PRICE_FORMS.cartonPack), 'case');
  assert.equal(defaultBasis(PRICE_FORMS.cartonPieces), 'case');
  assert.equal(defaultBasis(PRICE_FORMS.typed), null);
});

test('nothing stored means the default; a basis the form does not offer falls back to the default', () => {
  assert.equal(basisOf(PRICE_FORMS.singlePack, null), 'pack');
  assert.equal(basisOf(PRICE_FORMS.singlePack, undefined), 'pack');
  assert.equal(basisOf(PRICE_FORMS.cartonPack, null), 'case');
  assert.equal(basisOf(PRICE_FORMS.singlePack, 'case'), 'pack');
  assert.equal(basisOf(PRICE_FORMS.cartonPieces, 'rate'), 'case');
  assert.equal(basisOf(PRICE_FORMS.typed, 'rate'), null);
  assert.equal(basisOf(PRICE_FORMS.cartonPack, 'bogus'), 'case');
});

test('the default is stored as null (absent = default), a real choice as itself, a form with none as null', () => {
  assert.equal(basisToStore(PRICE_FORMS.singlePack, 'pack'), null);
  assert.equal(basisToStore(PRICE_FORMS.singlePack, null), null);
  assert.equal(basisToStore(PRICE_FORMS.singlePack, 'rate'), 'rate');
  assert.equal(basisToStore(PRICE_FORMS.cartonPack, 'case'), null);
  assert.equal(basisToStore(PRICE_FORMS.cartonPack, 'pack'), 'pack');
  assert.equal(basisToStore(PRICE_FORMS.cartonPieces, 'pack'), 'pack');
  assert.equal(basisToStore(PRICE_FORMS.typed, 'rate'), null);
});

test('«per kg» or «per litre» follows the weight', () => {
  assert.equal(rateBaseOf('10 kg'), 'kg');
  assert.equal(rateBaseOf('500 g'), 'kg');
  assert.equal(rateBaseOf('0.75 l'), 'l');
  assert.equal(rateBaseOf('750 ml'), 'l');
  assert.equal(rateBaseOf('a bag'), null);
});

// ── The conversions, every form × basis ──────────────────────────────────────────────────────────────
test('Singola: per kilo × the pack size is the pack price; the pack basis passes through untouched', () => {
  const f = PRICE_FORMS.singlePack;
  assert.equal(basisToStoredPrice(f, 'pack', 9.6, single, '10 kg'), 9.6);
  assert.equal(basisToStoredPrice(f, null, 9.6, single, '10 kg'), 9.6);
  assert.equal(basisToStoredPrice(f, 'rate', 0.96, single, '10 kg'), 9.6);
  assert.equal(basisToStoredPrice(f, 'rate', 3.37, single, '750 ml'), 2.5275);
  assert.equal(basisToStoredPrice(f, 'rate', 12, single, '500 g'), 6);
});

test('Cartone with a readable weight: case, pack and per-kilo all land on the case price', () => {
  const f = PRICE_FORMS.cartonPack;
  const fmt = carton(6);
  assert.equal(basisToStoredPrice(f, 'case', 30, fmt, '500 g'), 30);
  assert.equal(basisToStoredPrice(f, 'pack', 5, fmt, '500 g'), 30);
  assert.equal(basisToStoredPrice(f, 'rate', 10, fmt, '500 g'), 30);
  assert.equal(basisToStoredPrice(f, 'rate', 3.33, fmt, '1 kg'), 19.98);
});

test('Cartone with no readable weight: case, or pack × count', () => {
  const f = PRICE_FORMS.cartonPieces;
  assert.equal(basisToStoredPrice(f, 'case', 30, carton(6), ''), 30);
  assert.equal(basisToStoredPrice(f, 'pack', 5, carton(6), ''), 30);
  assert.equal(basisToStoredPrice(f, 'rate', 5, carton(6), ''), 5, 'a basis this form lacks is the default: untouched');
});

test('an empty, zero or unreadable box behaves exactly as without a basis; a missing count refuses to guess', () => {
  const f = PRICE_FORMS.cartonPack;
  assert.equal(basisToStoredPrice(f, 'pack', '', carton(6), '1 kg'), '');
  assert.equal(basisToStoredPrice(f, 'pack', 0, carton(6), '1 kg'), 0);
  assert.equal(basisToStoredPrice(f, 'pack', null, carton(6), '1 kg'), null);
  assert.equal(basisToStoredPrice(f, 'pack', 5, carton(null), '1 kg'), null);
  assert.equal(basisToStoredPrice(f, 'rate', 5, carton(NaN), '1 kg'), null);
});

test('and back: the stored price is shown in the chosen basis', () => {
  assert.equal(storedPriceToBasis(PRICE_FORMS.singlePack, 'rate', 9.6, single, '10 kg'), 0.96);
  assert.equal(storedPriceToBasis(PRICE_FORMS.singlePack, 'pack', 9.6, single, '10 kg'), 9.6);
  assert.equal(storedPriceToBasis(PRICE_FORMS.cartonPack, 'pack', 30, carton(6), '500 g'), 5);
  assert.equal(storedPriceToBasis(PRICE_FORMS.cartonPack, 'rate', 30, carton(6), '500 g'), 10);
  assert.equal(storedPriceToBasis(PRICE_FORMS.cartonPack, 'case', 30, carton(6), '500 g'), 30);
  assert.equal(storedPriceToBasis(PRICE_FORMS.cartonPieces, 'pack', 30, carton(6), ''), 5);
  assert.equal(storedPriceToBasis(PRICE_FORMS.cartonPack, 'pack', 30, carton(null), '500 g'), null);
  assert.equal(storedPriceToBasis(PRICE_FORMS.cartonPack, 'pack', null, carton(6), '500 g'), null);
});

test('switching the segment converts the number so the money does not move', () => {
  const f = PRICE_FORMS.cartonPack;
  const fmt = carton(6);
  assert.equal(convertBasisPrice(f, 'case', 'pack', 30, fmt, '500 g'), 5);
  assert.equal(convertBasisPrice(f, 'case', 'rate', 30, fmt, '500 g'), 10);
  assert.equal(convertBasisPrice(f, 'rate', 'pack', 10, fmt, '500 g'), 5);
  assert.equal(convertBasisPrice(f, 'pack', 'case', 5, fmt, '500 g'), 30);
  assert.equal(convertBasisPrice(PRICE_FORMS.singlePack, 'pack', 'rate', 9.6, single, '10 kg'), 0.96);
  assert.equal(convertBasisPrice(PRICE_FORMS.singlePack, 'rate', 'pack', 0.96, single, '10 kg'), 9.6);
  assert.equal(convertBasisPrice(f, 'case', 'case', 30, fmt, '500 g'), 30);
  assert.equal(convertBasisPrice(f, 'case', 'pack', '', fmt, '500 g'), '', 'an empty box stays empty');
  assert.equal(convertBasisPrice(f, 'case', 'pack', 30, carton(null), '500 g'), null, 'no count: no guess');
});

// ── What is STORED never changes shape ────────────────────────────────────────────────────────────────
function saved(fmt, weight, typed, basis, vat = 4) {
  return pricePatch(formatPriceInput(fmt, weight, { price: typed, basis, vat }), '2026-10-07T10:00:00.000Z', weight);
}

test('a Singola typed per kilo is stored as the same pack price a typed pack price would be', () => {
  const byRate = saved(single, '10 kg', 0.96, 'rate');
  const byPack = saved(single, '10 kg', 9.6, 'pack');
  assert.deepEqual(byRate, byPack);
  assert.equal(byRate.priceUnit, 'pcs');
  assert.equal(byRate.pricePerUnit, 9.6);
  assert.equal(byRate.unitWeightKg, 10);
});

test('a Cartone typed per pack or per kilo is stored as the same case a typed case price would be', () => {
  const byCase = saved(carton(6), '500 g', 30, 'case');
  assert.deepEqual(saved(carton(6), '500 g', 5, 'pack'), byCase);
  assert.deepEqual(saved(carton(6), '500 g', 10, 'rate'), byCase);
  assert.equal(byCase.casePrice, 30);
  assert.equal(byCase.caseCount, 6);
  assert.equal(byCase.caseItemUnit, 'pcs');
  assert.equal(byCase.pricePerUnit, 5);
  const pieces = saved(carton(6), '', 30, 'case');
  assert.deepEqual(saved(carton(6), '', 5, 'pack'), pieces);
  assert.equal(pieces.casePrice, 30);
});

test('an untouched ingredient (no basis) saves exactly as before', () => {
  const none = formatPriceInput(single, '10 kg', { price: 9.6, vat: 4 });
  assert.deepEqual(none, formatPriceInput(single, '10 kg', { price: 9.6, vat: 4, basis: 'pack' }));
  assert.deepEqual(formatPriceInput(carton(6), '500 g', { price: 30, vat: 4 }),
    formatPriceInput(carton(6), '500 g', { price: 30, vat: 4, basis: 'case' }));
});

test('the typed form ignores a basis completely', () => {
  const box = { rate: 7.2, unit: 'kg', vat: 4 };
  assert.deepEqual(formatPriceInput(single, 'loose', { ...box, basis: 'rate' }), formatPriceInput(single, 'loose', box));
  assert.equal(priceFormOf(single, 'loose'), PRICE_FORMS.typed);
});

// ── Round trip: type, save, reopen ────────────────────────────────────────────────────────────────────
test('0.96 per kilo, saved, reopens as 0.96 per kilo (and as 9.6 per pack)', () => {
  const patch = saved(single, '10 kg', 0.96, 'rate');
  const item = { ...patch, priceBasis: 'rate' };
  const form = priceFormOf(single, '10 kg', false);
  const start = priceBoxStart(item, single, '10 kg', false);
  assert.equal(storedPriceToBasis(form, basisOf(form, item.priceBasis), start.value, single, '10 kg'), 0.96);
  assert.equal(storedPriceToBasis(form, 'pack', start.value, single, '10 kg'), 9.6);
});

test('round trip for a Cartone, in every basis it offers', () => {
  const fmt = carton(6);
  const form = priceFormOf(fmt, '500 g', false);
  for (const [basis, typed] of [['case', 30], ['pack', 5], ['rate', 10]]) {
    const patch = saved(fmt, '500 g', typed, basis);
    const start = priceBoxStart({ ...patch, priceBasis: basis }, fmt, '500 g', false);
    assert.equal(storedPriceToBasis(form, basis, start.value, fmt, '500 g'), typed, basis);
  }
});

test('a rate typed with two decimals reads back unchanged for typical pack sizes', () => {
  const form = PRICE_FORMS.singlePack;
  for (const weight of ['10 kg', '2,5 kg', '500 g', '1 kg', '750 ml', '25 kg', '5 l']) {
    for (const typed of [0.96, 1.2, 3.37, 7.2, 12.5]) {
      const stored = basisToStoredPrice(form, 'rate', typed, single, weight);
      assert.equal(storedPriceToBasis(form, 'rate', stored, single, weight), typed, `${typed} per kg of ${weight}`);
    }
  }
});

// ── History ───────────────────────────────────────────────────────────────────────────────────────────
test('a basis-only change keeps the stored money, so priceChanged is false and no history row is written', () => {
  const stored = saved(single, '10 kg', 9.6, 'pack');
  // Not dirty: the card feeds pricePatch the STORED price, whatever the segment says.
  const untouched = pricePatch(storedPriceInput(stored, 4), '2026-10-08T10:00:00.000Z', '10 kg');
  assert.equal(priceChanged(stored, untouched), false);
  // Re-typing the same money in another basis is the same money too.
  assert.equal(priceChanged(stored, saved(single, '10 kg', 0.96, 'rate')), false);
  // A different number is a change.
  assert.equal(priceChanged(stored, saved(single, '10 kg', 0.97, 'rate')), true);
});

// ── Where the choice lives ────────────────────────────────────────────────────────────────────────────
test('priceBasis goes to the price document only, never the ingredient', () => {
  const { ingredient, price } = splitPriceFields({ name: 'Flour', pricePerUnit: 9.6, priceUnit: 'pcs', priceBasis: 'rate' });
  assert.equal(price.priceBasis, 'rate');
  assert.equal('priceBasis' in ingredient, false);
  assert.equal('priceBasis' in splitPriceFields({ name: 'Flour' }).ingredient, false);
});

// ── The card ──────────────────────────────────────────────────────────────────────────────────────────
const FORM = codeOf(newCardSource());
const I18N = read('js/i18n.js');

test('the new phrases exist once in each language and the card uses them', () => {
  for (const key of ['orders.basis.pack', 'orders.basis.case', 'orders.basis.perKg', 'orders.basis.perLitre',
    'orders.basis.packEquals', 'orders.basis.caseEquals']) {
    assert.equal(I18N.split(`'${key}':`).length - 1, 2, `${key} should be defined in both languages`);
    assert.ok(FORM.includes(`'${key}'`), `${key} is not used`);
  }
});

test('the card shows the selector only when its form offers a choice, reads labels while drawing, and saves the choice', () => {
  assert.ok(FORM.includes('basisField.hidden = options.length === 0'), 'the selector hides itself when the form has no choice');
  assert.ok(FORM.includes('basisOptions(form)'), 'the choices come from the model');
  assert.ok(FORM.includes('convertBasisPrice('), 'tapping a segment converts the typed number');
  assert.ok(FORM.includes('const priceBasis = basisToSave();'), 'the choice is read in both paths of read()');
  assert.ok(FORM.includes('priceBasis,\n    };'), 'and handed to pricePatch with a typed price');
  assert.ok(FORM.includes('{ ...input, ...(synced === null ? {} : { unitWeightKg: synced }), priceBasis }'), 'and with an untouched one');
  assert.ok(FORM.includes("'aria-labelledby': casePriceLabelId"), 'the group is named by the price label');
  // Not built at module top level (a frozen language): every t() of the segments sits inside refresh().
  assert.equal(/^const \w+ = t\('orders\.basis/m.test(FORM), false);
});

test('the old card never asks for a basis', () => {
  const legacy = codeOf(legacyCardSource());
  assert.equal(legacy.includes('basis'), false);
  assert.equal(legacy.includes('priceBasis'), false);
});
