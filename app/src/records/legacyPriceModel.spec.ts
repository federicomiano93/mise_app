import { describe, expect, test } from 'vitest';
import { moneyOf } from '@mise/shared/currency';
import type { Money } from '@mise/shared/currency';
import { moneyLayoutOf } from '@mise/shared/market';
import { usesLegacyCard } from '@mise/shared/pack-format';
import { CASE_MODE } from '@mise/shared/price-model';
import { en } from '../i18n/en';
import type { MessageKey } from '../i18n/en';
import { format } from '../i18n/i18n';
import type { MessageParams } from '../i18n/i18n';
import { it as italian } from '../i18n/it';
import { priceWriteOf } from '../suppliers/priceSave';
import { NEW_CHOICE, weightText, workingFrom } from './ingredientCardModel';
import type { ItemLike, Working } from './ingredientCardModel';
import {
  UNIT_MAX, buildLegacySave, isLegacyEdited, isLegacyProductEdited, legacyPatch, legacyProductFrom, legacyProductRefusal,
  legacyRefusal, legacySends, legacyStateFrom, legacyView, readLegacy,
} from './legacyPriceModel';
import type { LegacyCtx, LegacyPriceState, LegacyProduct } from './legacyPriceModel';

// The card of before (step 3e-5, parity C82–C83): the cases of the current app's tests/legacy-card.test.mjs, driven through the
// model. `openCard` holds the card's working copy, the two menus and the price the way IngredientCard does; `save()` runs the
// card of before's order (legacyProductRefusal, then legacyRefusal, then buildLegacySave and — only when legacySends — the
// price patch, through the store's priceWriteOf).

const NOW = '2026-10-24T09:00:00.000Z';
const MONEY: Money = moneyOf('€', null);
const ITALY: Money = moneyOf('€', moneyLayoutOf({ country: 'IT' }));

type T = (key: MessageKey, params?: MessageParams) => string;
const tEn: T = (key, params) => format('en', en[key], params);
const tIt: T = (key, params) => format('it', italian[key], params);

// ── The stored shapes (the original's own list) ────────────────────────────────
const BASE: ItemLike = { id: 'I1', name: 'Farina', supplierId: 'S1', brand: '', category: 'Other', active: true, kind: 'ingredient' };
const PACK: ItemLike = {
  ...BASE, unit: 'cartone', packUnit: 'busta', weight: '2.5kg',
  priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack',
  vatRate: 4, priceUpdatedAt: '2026-09-30T08:00:00.000Z',
};
const KG_CASE: ItemLike = { ...BASE, unit: 'cartone', weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' };
const G_CASE: ItemLike = { ...BASE, unit: 'kg', weight: '500g', priceUnit: 'kg', pricePerUnit: 10, casePrice: 20, caseCount: 4, caseItemSize: 500, caseItemUnit: 'g', vatRate: 10 };
const ML_CASE: ItemLike = { ...BASE, unit: 'l', weight: '', priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 500, caseItemUnit: 'ml' };
const PIECES: ItemLike = { ...BASE, unit: 'cartone', packUnit: 'pezzo', weight: '', priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs', unitWeightKg: 0.06, vatRate: 22 };
const PACK_BY_KG: ItemLike = { ...PACK, unit: 'kg' };
const PACK_BY_OTHER_WORD: ItemLike = { ...PACK, unit: 'sacco' };
const PACK_BY_PIECE: ItemLike = { ...PACK, unit: 'pz' };
const MULTIPLIER: ItemLike = { ...BASE, unit: 'sacco', weight: '6x1kg', priceUnit: 'kg', pricePerUnit: 2, vatRate: 4 };
const WORD_WEIGHT: ItemLike = { ...BASE, unit: 'sacco', weight: 'sacco', priceUnit: 'pcs', pricePerUnit: 2 };
// A rate with six decimals, which a rounded box would move (the price of a gelatine leaf by a stale-case shape).
const FINE_RATE: ItemLike = { ...BASE, unit: 'sacco', weight: '6x1kg', priceUnit: 'kg', pricePerUnit: 1.666667, vatRate: 10 };
// A stale case: a newer rate saved by an old phone over a case that no longer works out to it.
const STALE_CASE: ItemLike = { ...KG_CASE, pricePerUnit: 3 };

const LEGACY_SHAPES: Readonly<Record<string, ItemLike>> = {
  'a case by an explicit size (kg)': KG_CASE,
  'a case by an explicit size (g)': G_CASE,
  'a case by an explicit size (ml)': ML_CASE,
  'a case of pieces with no packCount': PIECES,
  'a pack case ordered by weight': PACK_BY_KG,
  'a pack case ordered by another package word (not its own)': PACK_BY_OTHER_WORD,
  'a pack case ordered by the piece': PACK_BY_PIECE,
  'a rate on a multiplier weight («6x1kg»)': MULTIPLIER,
  'a rate on a word («sacco»)': WORD_WEIGHT,
  'a case of pieces ordered by its own package word, piece ≠ the weight': { ...PIECES, unit: 'vaschetta', packUnit: 'vaschetta', weight: '360g' },
  'a case of pieces ordered by its own package word, no readable weight': { ...PIECES, unit: 'pezzo' },
  'a six-decimal rate on a multiplier weight': FINE_RATE,
};

const PRICE_KEYS = ['priceUnit', 'pricePerUnit', 'casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit', 'unitWeightKg'] as const;

function openCard(item: ItemLike, { money = MONEY, t = tEn, locale = 'en-GB', country = 'IT' }: { money?: Money; t?: T; locale?: string; country?: string } = {}) {
  // The card of before opens the product data as for an employee (no format from the price): mayPrice false here.
  const baseline = workingFrom(item, { supplierIds: ['S1'], preset: null, mayPrice: false, lang: 'it' });
  let working: Working = baseline;
  const openedProduct = legacyProductFrom(item);
  let product: LegacyProduct = openedProduct;
  const openedPrice = legacyStateFrom(item, null, money);
  let price: LegacyPriceState = openedPrice;
  const ctx = (): LegacyCtx => ({
    item, weight: weightText(working), packUnit: product.pack.choice === NEW_CHOICE ? product.pack.typed.trim() : product.pack.choice,
    orderUnit: product.unit.choice === NEW_CHOICE ? product.unit.typed.trim() : product.unit.choice, locale, money, country,
  });
  return {
    get price() { return price; },
    get working() { return working; },
    set(next: Partial<LegacyPriceState>) { price = { ...price, ...next }; },
    setWorking(next: Partial<Working>) { working = { ...working, ...next }; },
    setProduct(next: Partial<LegacyProduct>) { product = { ...product, ...next }; },
    view: () => legacyView(price, ctx(), t, openedPrice),
    edited: () => isLegacyEdited(price, openedPrice) || isLegacyProductEdited(product, openedProduct),
    // The card's Save: refusals in order, then what reaches the store.
    save() {
      const refusedProduct = legacyProductRefusal(working, product);
      if (refusedProduct) return { refused: refusedProduct } as const;
      const refusedPrice = legacyRefusal(price, ctx());
      if (refusedPrice) return { refused: refusedPrice } as const;
      const payload = buildLegacySave({ working, product, item, kind: 'ingredient', startSupplierId: baseline.supplierId });
      const sends = legacySends(price, openedPrice, weightText(working), weightText(baseline), ctx());
      const patch = sends ? legacyPatch(price, openedPrice, ctx(), NOW) : null;
      const write = patch ? priceWriteOf(item, patch, String(payload.supplierId), NOW) : null;
      return { payload, patch, write } as const;
    },
  };
}

function saved(card: ReturnType<typeof openCard>) {
  const result = card.save();
  if ('refused' in result) throw new Error(`refused on ${result.refused}`);
  return result;
}

describe('which shapes open the card of before (the gate is shared/pack-format usesLegacyCard)', () => {
  test('every shape of the list does', () => {
    for (const [name, item] of Object.entries(LEGACY_SHAPES)) expect(usesLegacyCard(item), name).toBe(true);
  });
});

describe('opening', () => {
  test('a stored case reopens in case mode with the values as typed; a typed rate reopens in the rate mode', () => {
    const kg = legacyStateFrom(KG_CASE, null, MONEY);
    expect([kg.unit, kg.casePrice, kg.caseCount, kg.caseSize, kg.caseItemUnit]).toEqual([CASE_MODE, '20', '4', '2.5', 'kg']);
    const pack = openCard(PACK_BY_OTHER_WORD).view();
    expect(pack.caseRow.item.value).toBe('pack');
    expect(pack.caseRow.size.shown, '«bag of 2.5 kg» has no size box: the size is the weight').toBe(false);
    const pieces = openCard(PIECES).view();
    expect(pieces.caseRow.item.value).toBe('pcs');
    expect(pieces.caseRow.size.shown).toBe(false);
    expect(pieces.caseRow.times, 'pieces have no × either').toBe(false);
    const multi = openCard(MULTIPLIER).view();
    expect(multi.unit.value).toBe('kg');
    expect(multi.rate.value).toBe('2');
    expect(multi.caseRow.shown).toBe(false);
  });

  test('«How it is bought» offers None, the three units and «By the case»', () => {
    const view = openCard(MULTIPLIER).view();
    expect(view.unit.options.map(option => option.value)).toEqual(['', 'kg', 'l', 'pcs', CASE_MODE]);
    expect(view.unit.options.at(-1)?.label).toBe('By the case');
    expect(openCard(MULTIPLIER, { t: tIt }).view().unit.options.at(-1)?.label).toBe('A cartone');
  });

  test('a stale case (its rate no longer works out to the stored one) opens in the rate mode, on the rate really stored', () => {
    const state = legacyStateFrom(STALE_CASE, null, MONEY);
    expect(state.unit).toBe('kg');
    expect(state.rate).toBe('3');
    expect(state.casePrice, 'the stale case is not shown').toBe('');
  });

  test('the boxes show the stored figures in the venue\'s layout, every digit of them', () => {
    const state = legacyStateFrom(FINE_RATE, null, ITALY);
    expect(state.rate).toBe('1,666667');
    expect(legacyStateFrom(PIECES, null, ITALY).pieceKg).toBe('0,06');
    expect(legacyStateFrom(KG_CASE, null, ITALY).caseSize).toBe('2,5');
    expect(legacyStateFrom(G_CASE, null, ITALY).vat).toBe('10');
  });

  test('the two menus open on the very word stored, an unknown one included', () => {
    expect(legacyProductFrom(PACK_BY_OTHER_WORD)).toEqual({ pack: { choice: 'busta', typed: '' }, unit: { choice: 'sacco', typed: '' } });
    expect(legacyProductFrom({ ...BASE, unit: '  Vassoio ' }).unit.choice).toBe('Vassoio');
    expect(legacyProductFrom(MULTIPLIER).pack.choice).toBe('');
  });
});

describe('an untouched card', () => {
  test('sends NO price at all (the difference on purpose) — and nothing about the format', () => {
    for (const [name, item] of Object.entries(LEGACY_SHAPES)) {
      const card = openCard(item);
      expect(card.edited(), name).toBe(false);
      const { payload, patch, write } = saved(card);
      expect(patch, `${name}: no price handed to the store`).toBeNull();
      expect(write, name).toBeNull();
      expect('packCount' in payload, `${name}: no packCount`).toBe(false);
      // The card of before always sends the order unit and the package word, from its two menus: here as stored.
      expect(payload.unit, `${name}: unit`).toBe(item.unit);
      if (item.packUnit) expect(payload.packUnit, `${name}: packUnit`).toBe(item.packUnit);
      else expect('packUnit' in payload, `${name}: no blank packUnit key`).toBe(false);
      for (const key of PRICE_KEYS) expect(key in payload, `${name}: ${key} is never in the product payload`).toBe(false);
    }
  });

  test('its boxes read back as the very price stored, in both layouts (so a VAT-only save cannot move the money)', () => {
    for (const money of [MONEY, ITALY]) {
      for (const [name, item] of Object.entries(LEGACY_SHAPES)) {
        const card = openCard(item, { money });
        const patch = legacyPatch(card.price, card.price, { item, weight: String(item.weight ?? ''), packUnit: String(item.packUnit ?? ''), orderUnit: String(item.unit ?? ''), locale: 'en-GB', money, country: 'IT' }, NOW);
        for (const key of PRICE_KEYS) expect(patch[key] ?? null, `${name} (${money.layout.decimal}): ${key}`).toBe(item[key] ?? null);
        expect(patch.vatRate, `${name}: vatRate`).toBe(item.vatRate ?? null);
        expect('priceBasis' in patch, `${name}: the stored basis is left alone`).toBe(false);
      }
    }
  });

  test('a six-decimal rate keeps every decimal until a person types in its box; a typed one is rounded as always', () => {
    const card = openCard(FINE_RATE);
    card.set({ vat: '4' });
    expect(saved(card).patch?.pricePerUnit).toBe(1.666667);
    card.set({ rate: '1,666667' });
    expect(saved(card).patch?.pricePerUnit, 'retyped: four decimals, as the original').toBe(1.6667);
    expect(saved(card).write?.doc.pricePerUnit, 'the store sees the same money and leaves the rate alone').toBeUndefined();
  });

  test('review 24 Oct: switching the unit menu without typing keeps the rate\'s six decimals, and the live line shows that rate', () => {
    const straw: ItemLike = { ...BASE, unit: 'scatola', weight: 'scatola', priceUnit: 'pcs', pricePerUnit: 0.001745, casePrice: 3.49, caseCount: 2000, caseItemUnit: 'pcs' };
    const card = openCard(straw);
    expect(card.price.unit).toBe(CASE_MODE);
    card.set({ unit: 'pcs' });
    expect(card.view().rate.value).toBe('0.001745');
    expect(saved(card).patch?.pricePerUnit, 'not 0.0017').toBe(0.001745);
    expect(saved(card).write?.history, 'the money did not move: no history').toBeNull();
    const fine = openCard(FINE_RATE);
    expect(fine.view().summary.main, 'the line reads as Save will').toMatch(/1\.666667 \/ kg/);
  });

  test('a VAT-only change writes only the VAT: no money, no date, no history', () => {
    const card = openCard(G_CASE);
    card.set({ vat: '4' });
    expect(card.edited()).toBe(true);
    const { write } = saved(card);
    expect(write).toEqual({ doc: { vatRate: 4, packPrice: null, packSize: null }, history: null });
  });
});

describe('editing the price', () => {
  test('«By the case» on a rate: count × size × unit and the case price write the case and the derived rate', () => {
    const card = openCard(MULTIPLIER);
    card.set({ unit: CASE_MODE });
    let view = card.view();
    expect(view.casePrice.shown).toBe(true);
    expect(view.rate.shown, 'the rate gives way to the case price').toBe(false);
    card.set({ casePrice: '22', caseCount: '4', caseSize: '2.5', caseItemUnit: 'kg' });
    view = card.view();
    expect(view.summary.main).toMatch(/= .*2\.20 \/ kg · .*22\.00 per case/);
    const { payload, patch, write } = saved(card);
    expect(patch && [patch.priceUnit, patch.pricePerUnit, patch.casePrice, patch.caseCount, patch.caseItemSize, patch.caseItemUnit])
      .toEqual(['kg', 2.2, 22, 4, 2.5, 'kg']);
    expect('packCount' in payload).toBe(false);
    expect(write?.history?.pricePerUnit, 'the rate moved, so the history says so').toBe(2.2);
    expect(write?.doc.priceUpdatedAt, 'the date moves with the money').toBe(NOW);
  });

  test('the history keeps its rule: a rate retyped to the same money plants nothing, a different one plants an entry', () => {
    const same = openCard(MULTIPLIER);
    same.set({ rate: '2,0' });
    expect(saved(same).write).toBeNull();
    const higher = openCard(MULTIPLIER);
    higher.set({ rate: '3' });
    const { write } = saved(higher);
    expect(write?.doc.pricePerUnit).toBe(3);
    expect(write?.history?.pricePerUnit).toBe(3);
  });

  test('back from a case to a rate clears all four case keys', () => {
    const card = openCard(KG_CASE);
    card.set({ unit: 'kg', rate: '2' });
    const { write } = saved(card);
    expect(write?.doc).toMatchObject({ casePrice: null, caseCount: null, caseItemSize: null, caseItemUnit: null });
    expect(write?.history, 'the same money: no history').toBeNull();
  });

  test('«None» with every box left as it was removes the price (the original\'s only way to clear it)', () => {
    const card = openCard(MULTIPLIER);
    card.set({ unit: '' });
    const { write } = saved(card);
    expect(write?.doc).toMatchObject({ priceUnit: null, pricePerUnit: null, priceUpdatedAt: null });
  });

  test('the piece weight is asked for a price by the piece, and for a case of pieces', () => {
    const card = openCard(MULTIPLIER);
    expect(card.view().pieceWeight.shown).toBe(false);
    card.set({ unit: 'pcs' });
    expect(card.view().pieceWeight.shown).toBe(true);
    expect(openCard(PIECES).view().pieceWeight.shown).toBe(true);
    expect(openCard(KG_CASE).view().pieceWeight.shown).toBe(false);
  });
});

describe('«bag of 2.5 kg» — one package of the weight', () => {
  test('is offered while the weight reads, named by the package word and the size, both live', () => {
    const card = openCard(PACK_BY_OTHER_WORD);
    expect(card.view().caseRow.item.options.find(option => option.value === 'pack')?.label).toBe('busta of 2.5 kg');
    card.setProduct({ pack: { choice: 'sacco', typed: '' } });
    card.setWorking({ weight: { amount: '3', unit: 'kg', legacy: '' } });
    expect(card.view().caseRow.item.options.find(option => option.value === 'pack')?.label).toBe('sacco of 3 kg');
    card.setProduct({ pack: { choice: '', typed: '' } });
    expect(card.view().caseRow.item.options.find(option => option.value === 'pack')?.label, 'no word: «pack»').toBe('pack of 3 kg');
    expect(openCard(PACK_BY_OTHER_WORD, { t: tIt, locale: 'it-IT' }).view().caseRow.item.options[1]?.label).toBe('busta da 2,5 kg');
  });

  test('is not offered on a weight that does not read — but KEPT while chosen', () => {
    const multi = openCard(MULTIPLIER);
    multi.set({ unit: CASE_MODE });
    expect(multi.view().caseRow.item.options.map(option => option.value)).toEqual(['pcs', 'kg', 'g', 'l', 'ml']);
    const card = openCard(PACK_BY_OTHER_WORD);
    card.setWorking({ weight: { amount: '', unit: 'kg', legacy: '' } });
    const options = card.view().caseRow.item.options;
    expect(options[1]).toEqual({ value: 'pack', label: 'busta' });
    expect(card.view().caseRow.item.value).toBe('pack');
  });

  test('a case of packages with no readable weight is refused on the weight box, in the card of before\'s words', () => {
    const card = openCard(PACK_BY_OTHER_WORD);
    card.setWorking({ weight: { amount: '', unit: 'kg', legacy: '' } });
    expect(card.save()).toEqual({ refused: 'packWeight' });
    expect(en['sup.legacy.packNeeded']).toBe('The package weight is needed for the case price');
  });

  test('a weight edited since the case was saved is said, and the price follows on save', () => {
    const card = openCard(PACK_BY_OTHER_WORD);
    expect(card.view().packChangedNote).toBeNull();
    card.setWorking({ weight: { amount: '3', unit: 'kg', legacy: '' } });
    expect(card.view().packChangedNote).toBe('The package weight has changed: the price updates when you save');
    expect(card.edited(), 'the price boxes did not move').toBe(false);
    const { write } = saved(card);
    expect(write?.doc.caseItemSize, 'the save re-sizes the case').toBe(3);
    expect(write?.doc.pricePerUnit, '20 / (4 × 3 kg), six decimals').toBe(1.666667);
    expect(write?.history?.pricePerUnit).toBe(1.666667);
  });

  test('review 24 Oct: a weight changed BEFORE the card opened (an employee\'s card) is said, and an untouched save re-prices it', () => {
    const card = openCard({ ...PACK_BY_OTHER_WORD, weight: '3kg' });
    expect(card.edited(), 'nothing was touched').toBe(false);
    expect(card.view().packChangedNote).toBe('The package weight has changed: the price updates when you save');
    expect(card.view().summary.main).toMatch(/1\.666667 \/ kg/);
    const { write } = saved(card);
    expect(write?.doc.caseItemSize, 'the case now says what the screen said').toBe(3);
    expect(write?.doc.pricePerUnit).toBe(1.666667);
    expect(write?.history?.pricePerUnit).toBe(1.666667);
    // …and a pack case whose weight still matches sends nothing.
    expect(saved(openCard(PACK_BY_OTHER_WORD)).patch).toBeNull();
  });

  test('a weight edited on a shape that does not price by it writes nothing of the price', () => {
    const card = openCard(KG_CASE);
    card.setWorking({ weight: { amount: '3', unit: 'kg', legacy: '' } });
    const { patch, write } = saved(card);
    expect(patch, 'the weight moved, so the price is handed over…').not.toBeNull();
    expect(write, '…and nothing of it differs from the stored price').toBeNull();
  });
});

describe('refusals, in the card of before\'s order', () => {
  test('a price box that is not a positive number is refused on it; an empty one is «no price»', () => {
    const card = openCard(MULTIPLIER);
    card.set({ rate: 'abc' });
    expect(card.save()).toEqual({ refused: 'rate' });
    card.set({ rate: '-2' });
    expect(card.save()).toEqual({ refused: 'rate' });
    card.set({ rate: '' });
    expect('refused' in card.save()).toBe(false);
  });

  test('a hidden box is never refused, and the case boxes go in their order', () => {
    const card = openCard(MULTIPLIER);
    card.set({ rate: 'abc', unit: CASE_MODE, casePrice: '20', caseCount: 'x', caseSize: '0', caseItemUnit: 'kg' });
    expect(card.save()).toEqual({ refused: 'caseCount' });
    card.set({ caseCount: '4' });
    expect(card.save()).toEqual({ refused: 'caseSize' });
    card.set({ caseItemUnit: 'pcs' });
    expect('refused' in card.save(), 'pieces hide the size box').toBe(false);
  });

  test('the product data first: name, weight, category, package, order unit', () => {
    const card = openCard(MULTIPLIER);
    card.set({ rate: 'abc' });
    card.setProduct({ unit: { choice: NEW_CHOICE, typed: '  ' } });
    expect(card.save()).toEqual({ refused: 'legacyUnit' });
    card.setProduct({ pack: { choice: NEW_CHOICE, typed: '' } });
    expect(card.save()).toEqual({ refused: 'legacyPack' });
    card.setWorking({ category: { choice: NEW_CHOICE, typed: '' } });
    expect(card.save()).toEqual({ refused: 'category' });
    card.setWorking({ weight: { amount: 'abc', unit: 'kg', legacy: '' } });
    expect(card.save()).toEqual({ refused: 'weight' });
    card.setWorking({ name: ' ' });
    expect(card.save()).toEqual({ refused: 'name' });
  });
});

describe('«Not in use at the moment» on the card of before', () => {
  test('`active` is sent only when the switch moved, as the opposite of the switch', () => {
    const card = openCard(MULTIPLIER);
    expect('active' in saved(card).payload, 'not moved: absent, so a switch moved elsewhere is not undone').toBe(false);
    card.setWorking({ notInUse: true });
    expect(saved(card).payload.active).toBe(false);
    card.setWorking({ notInUse: false });
    expect('active' in saved(card).payload).toBe(false);
  });
});

describe('the two menus', () => {
  test('«Order unit» with «+ New unit…»: a typed word is saved, capped at the rules\' 100', () => {
    const card = openCard(MULTIPLIER);
    card.setProduct({ unit: { choice: NEW_CHOICE, typed: ' vassoio ' } });
    expect(card.edited(), 'a change the leave question sees (P20)').toBe(true);
    expect(saved(card).payload.unit).toBe('vassoio');
    card.setProduct({ unit: { choice: NEW_CHOICE, typed: 'x'.repeat(150) } });
    expect(String(saved(card).payload.unit)).toHaveLength(UNIT_MAX);
  });

  test('«Package» is saved as packUnit only when there is something to say, capped at 40', () => {
    const none = openCard(MULTIPLIER);
    expect('packUnit' in saved(none).payload).toBe(false);
    none.setProduct({ pack: { choice: 'sacco', typed: '' } });
    expect(saved(none).payload.packUnit).toBe('sacco');
    const cleared = openCard(PACK_BY_OTHER_WORD);
    cleared.setProduct({ pack: { choice: '', typed: '' } });
    expect(saved(cleared).payload.packUnit, 'a stored word can be cleared').toBe('');
    cleared.setProduct({ pack: { choice: NEW_CHOICE, typed: 'b'.repeat(60) } });
    expect(String(saved(cleared).payload.packUnit)).toHaveLength(40);
  });

  test('the order unit and the package word feed the VAT line: «20 per case of 4» is 20 by the case, 5 by the bag', () => {
    const card = openCard(PACK_BY_OTHER_WORD);
    card.setProduct({ unit: { choice: 'busta', typed: '' } });
    expect(card.view().vatLine).toBe('€5.00 without VAT, €5.20 with VAT at 4%');
    card.setProduct({ unit: { choice: 'cartone', typed: '' } });
    expect(card.view().vatLine).toBe('€20.00 without VAT, €20.80 with VAT at 4%');
  });
});

describe('what is said', () => {
  test('the live line says the rate and the case price; a piece case says «each»; the IT words are the old ones', () => {
    expect(openCard(PACK_BY_OTHER_WORD).view().summary.main).toMatch(/= .*2\.00 \/ kg · .*20\.00 per case/);
    expect(openCard(PIECES).view().summary.main).toMatch(/= .*0\.40 each · .*20\.00 per case/);
    expect(openCard(PIECES, { t: tIt, money: ITALY }).view().summary.main).toMatch(/al pezzo · .*a cartone/);
  });

  test('a price by the piece adds what a kilo costs when the piece weight is known', () => {
    const card = openCard(WORD_WEIGHT);
    card.set({ pieceKg: '0.5' });
    expect(card.view().summary.main).toMatch(/2\.00 each\s+·\s+€4\.00 \/ kg|each.*4\.00 \/ kg/);
  });

  test('no price: the reason, muted, and no VAT line', () => {
    const card = openCard(MULTIPLIER);
    card.set({ rate: '' });
    const view = card.view();
    expect(view.summary.muted).toBe(true);
    expect(view.summary.main).not.toBe('');
    expect(view.vatLine).toBe('');
  });

  test('a stored VAT rate the country does not offer stays on the menu', () => {
    const view = openCard({ ...MULTIPLIER, vatRate: 20 }, { country: 'IT' }).view();
    expect(view.vat.options.at(-1)).toEqual({ value: '20', label: '20%' });
    expect(view.vat.value).toBe('20');
  });

  test('every new phrase exists in both languages', () => {
    const keys = (Object.keys(en) as MessageKey[]).filter(key => key.startsWith('sup.legacy.'));
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) expect(italian[key], key).toBeTruthy();
  });
});

describe('the read the save makes', () => {
  test('readLegacy hands pricePatch the boxes, with either decimal mark', () => {
    const state = { ...legacyStateFrom(KG_CASE, null, ITALY), casePrice: '22,5' };
    expect(readLegacy(state)).toMatchObject({ priceUnit: CASE_MODE, casePrice: '22.5', caseCount: '4', caseItemSize: '2.5', caseItemUnit: 'kg' });
  });
});
