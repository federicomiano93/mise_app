// «Peso di un pezzo» is typed in GRAMS and stored in KILOS — the port of the current app's #489 (8 Nov 2026).
//
// The box said «(kg)» and an egg was saved as 50 — fifty kilos — so every recipe priced its eggs at 0,0033 €/kg. The card now
// shows and reads grams; `unitWeightKg` stays in kilos for every reader. Ported from tests/piece-weight-grams.test.mjs (all 7 of
// its tests): the conversion, the new card (priceCardModel.ts) and the card of before (legacyPriceModel.ts), and both dictionaries.
// The original runs the cards in a fake DOM; here the same cases run through the two models, which hold what the boxes hold.
//
// ⚠️ NOT RUN AGAINST js/ingredient-record-form.js: that file is the whole ingredient screen (DOM, session, dialogs), so the two
// small functions are compared case for case with the original's test, not by importing it.

import { describe, expect, test } from 'vitest';
import { moneyOf } from '@mise/shared/currency';
import { moneyLayoutOf } from '@mise/shared/market';
import { pricePatch } from '@mise/shared/price-model';
import { en } from '../i18n/en';
import type { MessageKey } from '../i18n/en';
import { format } from '../i18n/i18n';
import type { MessageParams } from '../i18n/i18n';
import { it as italian } from '../i18n/it';
import { workingFrom, weightText } from './ingredientCardModel';
import type { ItemLike } from './ingredientCardModel';
import { legacyStateFrom, legacyView, readLegacy } from './legacyPriceModel';
import type { LegacyCtx } from './legacyPriceModel';
import { gramsOfKg, kgTextOfGrams } from './pieceWeight';
import { isPriceDirty, priceCtxOf, priceStateFrom, priceView, readPrice, typePieceKg } from './priceCardModel';
import type { PriceCtx, PriceFacts, PriceState } from './priceCardModel';

const MONEY = moneyOf('€', moneyLayoutOf({ country: 'GB' }));
const ITALY = moneyOf('€', moneyLayoutOf({ country: 'IT' }));
const tEn = (key: MessageKey, params?: MessageParams): string => format('en', en[key], params);
const NOW = '2026-11-08T10:00:00.000Z';

const BASE: ItemLike = { id: 'I1', name: 'Uova', supplierId: 'S1', brand: '', category: 'Other', active: true, kind: 'ingredient' };
// A per-piece price with its own piece weight: the form that shows «Weight of one piece».
const EGG: ItemLike = { ...BASE, unit: 'pz', weight: '', priceUnit: 'pcs', pricePerUnit: 0.167, unitWeightKg: 0.05, vatRate: 10 };
// An old per-piece case with no packCount: the card of before opens for it.
const LEGACY_PIECES: ItemLike = {
  ...BASE, unit: 'cartone', packUnit: 'pezzo', weight: '', priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50,
  caseItemUnit: 'pcs', unitWeightKg: 0.06, vatRate: 22,
};

// The new card, as far as the piece weight goes: open, type in the box, what Save hands the store.
function openNewCard(item: ItemLike, money = MONEY) {
  const working = workingFrom(item, { supplierIds: ['S1'], preset: null, mayPrice: true, lang: 'it' });
  const facts: PriceFacts = { item, lang: 'it', money, locale: 'en-GB', country: 'IT', openedKind: working.format, initialWeight: weightText(working) };
  let price: PriceState | null = null;
  const ctx = (): PriceCtx => priceCtxOf(working, facts, price ? isPriceDirty(price, item) : false);
  price = priceStateFrom(item, null, ctx());
  return {
    view: () => priceView(price as PriceState, ctx(), tEn),
    type: (text: string) => { price = typePieceKg(price as PriceState, ctx(), text); },
    payload: () => pricePatch(readPrice(price as PriceState, ctx()), NOW, weightText(working)),
  };
}

// The card of before: its price block alone.
function openLegacyCard(item: ItemLike) {
  const ctx: LegacyCtx = { item, weight: '', packUnit: 'pezzo', orderUnit: 'cartone', locale: 'en-GB', money: MONEY, country: 'IT' };
  let state = legacyStateFrom(item, null, MONEY);
  const opened = state;
  return {
    view: () => legacyView(state, ctx, tEn, opened),
    type: (text: string) => { state = { ...state, pieceKg: text }; },
    payload: () => pricePatch(readLegacy(state, opened), NOW, ''),
  };
}

test('kilos → grams for the box, and back to the kilo text the model reads', () => {
  expect(gramsOfKg(0.05)).toBe('50');
  expect(gramsOfKg(0.055)).toBe('55');
  expect(gramsOfKg(0.0035)).toBe('3.5');
  expect(gramsOfKg(50), 'a weight saved as 50 kg shows as 50000 g: the mistake is visible').toBe('50000');
  expect(gramsOfKg(null)).toBe('');
  expect(gramsOfKg(undefined)).toBe('');
  expect(gramsOfKg('')).toBe('');
  expect(kgTextOfGrams('55')).toBe('0.055');
  expect(kgTextOfGrams('3,5'), 'a comma is read like a point').toBe('0.0035');
  expect(kgTextOfGrams(' 50 ')).toBe('0.05');
  expect(kgTextOfGrams('')).toBe('');
  expect(kgTextOfGrams('abc'), 'text that is not a number passes through, so Save refuses it').toBe('abc');
  // The price model reads the box with Number(), which takes these too — unconverted they would be saved as KILOS, the very
  // mistake this fix is for.
  expect(kgTextOfGrams('55,'), 'a trailing comma is still grams').toBe('0.055');
  expect(kgTextOfGrams('55.'), 'a trailing point is still grams').toBe('0.055');
  expect(kgTextOfGrams(',5'), 'a leading comma is still grams').toBe('0.0005');
  expect(kgTextOfGrams('1e2'), 'an exponent is still grams').toBe('0.1');
});

describe('the new card', () => {
  test('the box is captioned in grams and shows the stored weight in grams', () => {
    const card = openNewCard(EGG);
    expect(card.view().pieceWeight.shown).toBe(true);
    expect(card.view().pieceWeight.label).toMatch(/\(g\)$/);
    expect(card.view().pieceWeight.value).toBe('50');
    expect(openNewCard(EGG, ITALY).view().pieceWeight.value, 'in the venue\'s layout').toBe('50');
    expect(openNewCard({ ...EGG, unitWeightKg: 0.0035 }, ITALY).view().pieceWeight.value).toBe('3,5');
  });

  test('55 typed is saved as 0.055 kg, the price untouched', () => {
    const card = openNewCard(EGG);
    card.type('55');
    const payload = card.payload();
    expect(payload.priceUnit).toBe('pcs');
    expect(payload.pricePerUnit).toBe(0.167);
    expect(payload.unitWeightKg).toBe(0.055);
  });

  test('an untouched box saves the stored kilos unchanged', () => {
    expect(openNewCard(EGG).payload().unitWeightKg).toBe(0.05);
  });

  test('«55,» typed (a digit still to come) is saved as 0.055 kg, never as 55 kg', () => {
    const card = openNewCard(EGG);
    card.type('55,');
    expect(card.payload().unitWeightKg).toBe(0.055);
  });
});

test('the card of before: grams shown, grams typed, kilos saved', () => {
  const card = openLegacyCard(LEGACY_PIECES);
  expect(card.view().pieceWeight.shown, 'the legacy card has the piece weight box').toBe(true);
  expect(card.view().pieceWeight.value).toBe('60');
  card.type('65');
  expect(card.payload().unitWeightKg).toBe(0.065);
});

test('both dictionaries say grams, with examples in grams', () => {
  expect(en['sup.price.weightOfOnePiece']).toBe('Weight of one piece (g)');
  expect(italian['sup.price.weightOfOnePiece']).toBe('Peso di un pezzo (g)');
  for (const lang of [en, italian]) {
    expect(lang['sup.price.weightOfOnePiece']).not.toMatch(/\(kg\)/);
    expect(lang['sup.price.eg.pieceWeight']).not.toMatch(/0[.,]0/);
    expect(lang['sup.price.neededOnlyToUse']).not.toMatch(/0[.,]0/);
  }
  expect(en['sup.price.eg.pieceWeight']).toBe('e.g. 55');
  expect(italian['sup.price.eg.pieceWeight']).toBe('es. 55');
});
