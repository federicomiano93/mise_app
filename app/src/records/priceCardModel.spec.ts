import { describe, expect, test } from 'vitest';
import { moneyOf } from '@mise/shared/currency';
import type { Money } from '@mise/shared/currency';
import { moneyLayoutOf } from '@mise/shared/market';
import { usesLegacyCard } from '@mise/shared/pack-format';
import { PRICE_FIELDS, pricePatch, pricePerKg, priceChanged, priceRecord } from '@mise/shared/price-model';
import { unitCost } from '@mise/shared/order-cost';
import { vatRatesFor } from '@mise/shared/vat-rates';
import { en } from '../i18n/en';
import type { MessageKey } from '../i18n/en';
import { format } from '../i18n/i18n';
import type { MessageParams } from '../i18n/i18n';
import { it as italian } from '../i18n/it';
import {
  buildSave, firstRefusal, formState, isDirty, weightText, withFormat, withInner, workingFrom,
} from './ingredientCardModel';
import type { CardKind, ItemLike, Working } from './ingredientCardModel';
import {
  chooseVat, followFormat, isPriceDirty, isPriceEdited, keepsMoney, priceCtxOf, priceRefusal, priceStateFrom, priceView, readPrice,
  recompute, sharedTranslate, tapBasis, typeBox, typePieceKg, typeRate, typeUnit, weightHintOf,
} from './priceCardModel';
import type { PriceCtx, PriceFacts, PriceState } from './priceCardModel';

// The price on the ingredient card, with no screen in the way (parity C58–C79, C84–C86). The current app's tests of this
// block drive its DOM; here the same cases are driven through the model, by a small stand-in for the card: `openCard` holds a
// working copy and a price the way IngredientCard will, and `save()` runs the card's own order (firstRefusal, then
// priceRefusal, then buildSave over the price patch). Each test is named after the original it ports.
//
// An Italian venue seen through an English screen, as the originals: the FOOD words (cartone, busta, pz) come from the
// country, the words that say what to tap from the interface language; the money is « € » in the app's historical layout.

const NOW = '2026-10-22T09:00:00.000Z';
const MONEY: Money = moneyOf('€', null);
const SUPPLIERS = ['S1'];

type T = (key: MessageKey, params?: MessageParams) => string;
const tEn: T = (key, params) => format('en', en[key], params);
const tIt: T = (key, params) => format('it', italian[key], params);

const BASE: ItemLike = { id: 'I1', name: 'Farina', supplierId: 'S1', brand: '', category: 'Other', active: true, kind: 'ingredient' };

interface OpenOptions {
  item?: ItemLike | null;
  mayPrice?: boolean;
  kind?: CardKind;
  money?: Money;
  country?: string;
  t?: T;
  locale?: string;
}

function openCard({
  item = null, mayPrice = true, kind = 'ingredient', money = MONEY, country = 'IT', t = tEn, locale = 'en-GB',
}: OpenOptions = {}) {
  const lang = 'it';
  const baseline = workingFrom(item, { supplierIds: SUPPLIERS, preset: null, mayPrice, lang });
  let working: Working = baseline;
  const facts: PriceFacts = {
    item, lang, money, locale, country, openedKind: baseline.format, initialWeight: weightText(baseline),
  };
  let price: PriceState | null = null;
  const ctx = (): PriceCtx => priceCtxOf(working, facts, price ? isPriceDirty(price, item) : false);
  if (mayPrice) price = priceStateFrom(item, kind === 'packaging' && !item ? 'pcs' : null, ctx());
  const refusals: string[] = [];
  const saves: Array<ReturnType<typeof savedOf>> = [];

  // What the card would hand the store.
  function savedOf() {
    const priceDirty = price ? isPriceDirty(price, item) : false;
    const wrong = firstRefusal(working, item, { mayPrice, lang, priceDirty });
    const refused = wrong ?? (price ? priceRefusal(price, ctx()) : null);
    if (refused) return { refused } as const;
    const patch = price ? pricePatch(readPrice(price, ctx()), NOW, weightText(working)) : null;
    const built = buildSave({
      working, item, kind, lang, startSupplierId: baseline.supplierId, mayPrice, priceDirty, pricePatch: patch,
    });
    const payload = { ...built.payload, ...(patch ?? {}) } as Record<string, unknown>;
    const record = patch && patch.pricePerUnit !== null && priceChanged(item, patch)
      ? priceRecord({ ...item, supplierId: payload.supplierId }, patch, NOW)
      : null;
    return { refused: null, payload, record, meta: built.unitChangedFrom, patch } as const;
  }

  const card = {
    get working() { return working; },
    get price() { return price as PriceState; },
    ctx,
    view: () => priceView(price as PriceState, ctx(), t),
    // The card's own edits: every change of the format or the weight tells the price (followFormat).
    edit(change: (current: Working) => Working) {
      working = change(working);
      if (price) price = followFormat(price, ctx());
    },
    name: (value: string) => card.edit(w => ({ ...w, name: value })),
    weight: (amount: string) => card.edit(w => ({ ...w, weight: { ...w.weight, amount } })),
    weightUnit: (unit: Working['weight']['unit']) => card.edit(w => ({ ...w, weight: { ...w.weight, unit } })),
    count: (value: string) => card.edit(w => ({ ...w, count: value })),
    carton: () => card.edit(w => withFormat(w, 'carton', lang)),
    single: () => card.edit(w => withFormat(w, 'single', lang)),
    inner: (word: string) => card.edit(w => withInner(w, { choice: word, typed: '' })),
    box: (text: string) => { price = typeBox(price as PriceState, ctx(), text); },
    rate: (text: string) => { price = typeRate(price as PriceState, ctx(), text); },
    unit: (unit: string) => { price = typeUnit(price as PriceState, ctx(), unit); },
    pieceKg: (text: string) => { price = typePieceKg(price as PriceState, ctx(), text); },
    vat: (value: string) => { price = chooseVat(price as PriceState, ctx(), value); },
    recompute: () => { price = recompute(price as PriceState, ctx()); },
    tap(label: string) {
      const segment = card.view().segments.find(one => one.label === label);
      if (!segment) throw new Error(`no segment «${label}»`);
      price = tapBasis(price as PriceState, ctx(), segment.value);
    },
    labels: () => card.view().segments.map(one => one.label),
    pressed: () => card.view().segments.filter(one => one.pressed).map(one => one.label),
    // Every note the section draws as a sentence under the boxes.
    notes: () => {
      const view = card.view();
      return [view.changedNote?.text, view.keepsNote, view.priceAgainNote, view.summary.note].filter((one): one is string => Boolean(one));
    },
    save() {
      const saved = savedOf();
      refusals.push(saved.refused ?? '');
      saves.push(saved);
      return saved;
    },
    // The save that must have gone through.
    saved() {
      const saved = card.save();
      if (saved.refused) throw new Error(`the save was refused on «${saved.refused}»`);
      return saved;
    },
    isCarton: () => working.format === 'carton',
    dirty: () => isDirty(working, baseline, price ? isPriceEdited(price, ctx()) : false),
  };
  return card;
}

// ── The stored shapes of the original's «existing data» table ────────────────
const PACK_CASE: ItemLike = {
  ...BASE, unit: 'cartone', packUnit: 'busta', weight: '2.5kg',
  priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack',
  vatRate: 4, priceUpdatedAt: '2026-09-30T08:00:00.000Z',
};
const LEGACY_KG: ItemLike = { ...BASE, unit: 'cartone', weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' };
const LEGACY_G: ItemLike = { ...BASE, unit: 'kg', weight: '500g', priceUnit: 'kg', pricePerUnit: 10, casePrice: 20, caseCount: 4, caseItemSize: 500, caseItemUnit: 'g', vatRate: 10 };
const PIECES: ItemLike = { ...BASE, unit: 'cartone', packUnit: 'pezzo', weight: '', priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs', unitWeightKg: 0.06, vatRate: 22 };
const TYPED_KG: ItemLike = { ...BASE, unit: 'kg', weight: '', priceUnit: 'kg', pricePerUnit: 7.2, vatRate: 4 };
const TYPED_SACK: ItemLike = { ...BASE, unit: 'sacco', weight: '25kg', priceUnit: 'kg', pricePerUnit: 0.8 };
const TYPED_PIECE: ItemLike = { ...BASE, unit: 'pz', weight: '', priceUnit: 'pcs', pricePerUnit: 0.3, unitWeightKg: 0.05, vatRate: 22 };
const CUSTOM: ItemLike = { ...BASE, unit: 'vassoio', weight: '', priceUnit: 'pcs', pricePerUnit: 2.5 };
const BUSTA_UNIT: ItemLike = { ...BASE, unit: 'busta', weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2 };
// ⚠️ REDUCED SCOPE (2 Oct 2026): LEGACY_KG, LEGACY_G and PIECES are old price shapes WITHOUT a packCount, so the card of before
// opens for them. The same documents WITH a packCount are what the NEW card has written over them: these are the Cartone fixtures.
const LEGACY_KG_COUNTED: ItemLike = { ...LEGACY_KG, packCount: 4 };
const LEGACY_G_COUNTED: ItemLike = { ...LEGACY_G, packCount: 4 };
const PIECES_COUNTED: ItemLike = { ...PIECES, packCount: 50 };

const SACK: ItemLike = { ...BASE, vatRate: 4, unit: 'sacco', weight: '10kg', priceUnit: 'pcs', pricePerUnit: 9.6, unitWeightKg: 10, priceUpdatedAt: '2026-10-01T08:00:00.000Z' };
const CARTON: ItemLike = {
  ...BASE, vatRate: 4, unit: 'cartone', packUnit: 'busta', packCount: 6, weight: '500g',
  priceUnit: 'pcs', pricePerUnit: 5, unitWeightKg: 0.5, casePrice: 30, caseCount: 6, caseItemUnit: 'pcs',
  priceUpdatedAt: '2026-10-01T08:00:00.000Z',
};

const PRICE_KEYS = ['priceUnit', 'pricePerUnit', 'casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit', 'unitWeightKg'];
const FORMAT_KEYS = ['unit', 'packUnit', 'packCount'];
const ALL_STORED = [PACK_CASE, LEGACY_KG_COUNTED, LEGACY_G_COUNTED, PIECES_COUNTED, TYPED_KG, TYPED_SACK, TYPED_PIECE, CUSTOM, BUSTA_UNIT];
const spaceless = (value: unknown) => String(value).replace(/\s+/g, '');

// ═══════════════════════════════════════════════════════════════════════════════
// tests/ingredient-card-save.test.mjs — the price and the format parts
// ═══════════════════════════════════════════════════════════════════════════════

describe('ingredient-card-save: an untouched save', () => {
  test('an untouched save sends NO format keys, for every kind of stored product', () => {
    for (const item of ALL_STORED) {
      const { payload } = openCard({ item }).saved();
      for (const key of FORMAT_KEYS) expect(key in payload, `${key} must not be sent for ${String(item.unit)}/${String(item.packUnit)}`).toBe(false);
      expect(spaceless(payload.weight)).toBe(item.weight);
    }
  });

  test('an untouched save writes the stored price verbatim and records no history entry', () => {
    for (const item of ALL_STORED) {
      const { payload, record } = openCard({ item }).saved();
      for (const key of PRICE_KEYS) expect(payload[key] ?? null, `${key} of ${String(item.unit)}/${String(item.caseItemUnit)}`).toBe(item[key] ?? null);
      expect(payload.vatRate).toBe(item.vatRate ?? null);
      expect(record).toBeNull();
      expect(priceChanged(item, payload)).toBe(false);
    }
  });

  test('an untouched pack case keeps its own stored size even when the weight on the card has changed', () => {
    // an employee re-weighed it 2.5kg → 3kg; a manager opens the card to fix a typo
    const { payload, record } = openCard({ item: { ...PACK_CASE, weight: '3kg' } }).saved();
    expect(payload.caseItemSize).toBe(2.5);
    expect(payload.pricePerUnit).toBe(2);
    expect(payload.casePrice).toBe(20);
    expect(record).toBeNull();
    expect(spaceless(payload.weight)).toBe('3kg');
  });

  test('without price access an untouched save sends no price field at all, whatever the product is', () => {
    for (const item of [PACK_CASE, PIECES, TYPED_KG, { ...BASE, unit: 'cartone', packUnit: 'busta', weight: '2.5kg' }, { ...BASE, unit: 'cartone', weight: '10kg' }]) {
      const { payload, patch } = openCard({ item, mayPrice: false }).saved();
      for (const key of PRICE_FIELDS) expect(key in payload, key).toBe(false);
      for (const key of FORMAT_KEYS) expect(key in payload, `${key} for ${String(item.unit)}/${String(item.packUnit)}`).toBe(false);
      expect(patch).toBeNull();
    }
  });
});

describe('ingredient-card-save: how each row reopens', () => {
  test('a price reader sees Cartone, with the count from the stored case or packCount, for every carton-shaped product', () => {
    for (const [item, count, inner] of [[PACK_CASE, '4', 'busta'], [LEGACY_KG_COUNTED, '4', ''], [LEGACY_G_COUNTED, '4', ''], [PIECES_COUNTED, '50', 'pezzo']] as const) {
      const card = openCard({ item });
      expect(card.isCarton(), `${String(item.unit)} ${String(item.caseItemUnit)}`).toBe(true);
      expect(card.working.count).toBe(count);
      expect(card.working.inner.choice).toBe(inner);
    }
  });

  test('C51: a stored case of PIECES whose ingredient names no package opens showing «pezzo» (the venue\'s word), the stored word staying empty', () => {
    const item = { ...PIECES_COUNTED, packUnit: '' };
    const card = openCard({ item });
    expect(card.working.inner.choice).toBe('pezzo');
    // Shown, not written: an untouched save sends no package word at all.
    const { payload } = card.saved();
    expect('packUnit' in payload).toBe(false);
    // The same item for an employee shows no word (no price is read for them).
    expect(openCard({ item, mayPrice: false }).working.inner.choice).toBe('');
  });

  test('typed prices and plain units reopen as Singola, with no count', () => {
    for (const item of [TYPED_KG, TYPED_SACK, TYPED_PIECE, CUSTOM, BUSTA_UNIT]) {
      const card = openCard({ item });
      expect(card.isCarton(), String(item.unit)).toBe(false);
    }
  });

  test('an employee sees a carton (unit cartone + a package word) with an EMPTY count; with no package word it is a Singola', () => {
    const carton = openCard({ item: { ...BASE, unit: 'cartone', packUnit: 'busta', weight: '2.5kg' }, mayPrice: false });
    expect(carton.isCarton()).toBe(true);
    expect(carton.working.count).toBe('');
    expect(openCard({ item: { ...BASE, unit: 'cartone', weight: '10kg' }, mayPrice: false }).isCarton()).toBe(false);
  });
});

describe('ingredient-card-save: choosing Cartone on a new ingredient', () => {
  test('Cartone, 4 × a 2.5 kg weight, a case price of 20 → stored PER ITEM: 5 a busta, 2.5 kg each, 2 a kilo through pricePerKg', () => {
    const card = openCard();
    card.name('Farina 00');
    card.carton();
    expect(card.working.inner.choice).toBe('busta');   // the venue's default package, from its COUNTRY (Italy)
    card.count('4');
    card.weight('2.5');
    card.box('20');
    expect(card.view().summary.main).toMatch(/= .*2\.00 \/ kg/);
    const { payload, record } = card.saved();
    expect([payload.packCount, payload.packUnit, payload.unit]).toEqual([4, 'busta', 'cartone']);
    expect([payload.priceUnit, payload.pricePerUnit, payload.casePrice, payload.caseCount, payload.caseItemUnit, payload.caseItemSize, payload.unitWeightKg])
      .toEqual(['pcs', 5, 20, 4, 'pcs', null, 2.5]);
    expect(record, 'a new price is a history entry').not.toBeNull();
    expect(spaceless(payload.weight)).toBe('2.5kg');
  });

  test('the price box of a carton is named «Case price», of a single with a weight «Pack price»', () => {
    const card = openCard();
    card.weight('25');
    expect(card.view().box.label).toMatch(/^Pack price/);
    expect(card.view().typedForm, 'the typed rate gives way').toBe(false);
    card.carton();
    expect(card.view().box.label).toMatch(/^Case price/);
  });

  test('a carton with an EMPTY count is refused on the count box, and nothing is written', () => {
    const card = openCard();
    card.name('Farina 00');
    card.carton();
    expect(card.save().refused).toBe('count');
    card.count('4');
    expect(card.save().refused).toBeNull();
  });

  test('a count that is not a whole number is refused too (2.5, 0, -3)', () => {
    for (const bad of ['2.5', '0', '-3']) {
      const card = openCard();
      card.name('Farina');
      card.carton();
      card.count(bad);
      expect(card.save().refused, bad).toBe('count');
    }
  });

  test('an untouched legacy carton with no count is NOT refused: nothing is being written', () => {
    const card = openCard({ item: { ...BASE, unit: 'cartone', packUnit: 'busta', weight: '2.5kg' }, mayPrice: false });
    expect(card.save().refused).toBeNull();
  });

  test('but typing a price under a carton whose count is empty IS refused: it would erase the price', () => {
    const stored = { ...BASE, unit: 'cartone', packUnit: 'busta', weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2 };
    const card = openCard({ item: stored });
    expect(card.working.count, 'a typed rate has no case to read a count from').toBe('');
    card.box('22');
    expect(card.save().refused).toBe('count');
  });
});

describe('ingredient-card-save: an employee\'s changes to the product data', () => {
  test('an employee typing a count into a legacy carton writes packCount and keeps the carton words — no price fields', () => {
    const card = openCard({ item: { ...BASE, unit: 'cartone', packUnit: 'busta', weight: '2.5kg' }, mayPrice: false });
    card.count('6');
    const { payload } = card.saved();
    expect([payload.packCount, payload.packUnit, payload.unit]).toEqual([6, 'busta', 'cartone']);
    for (const key of PRICE_FIELDS) expect(key in payload, key).toBe(false);
  });

  test('switching to Cartone and back to Singola writes nothing', () => {
    const card = openCard({ item: TYPED_SACK });
    card.carton();
    card.single();
    const { payload } = card.saved();
    for (const key of FORMAT_KEYS) expect(key in payload, key).toBe(false);
    expect(payload.pricePerUnit).toBe(0.8);
  });
});

describe('ingredient-card-save: the price box follows the format and the weight', () => {
  test('a typed rate under a weight that reads: Peso touched keeps the rate, and no history entry is planted', () => {
    const card = openCard({ item: { ...TYPED_SACK, weight: '2.5kg', pricePerUnit: 2 } });
    expect(card.view().box.value, 'rate × size').toBe('5');
    card.weight('3');
    expect(card.view().box.value, 'the box follows the weight while nobody typed in it').toBe('6');
    const { payload, record } = card.saved();
    expect(payload.pricePerUnit).toBe(2);
    expect(record).toBeNull();
  });

  test('a typed rate turned into a Cartone: the box SHOWS the same price (2 a kilo × 4 × 2.5 kg = 20) and the save leaves it verbatim', () => {
    const card = openCard({ item: { ...BASE, unit: 'sacco', weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2 } });
    card.carton();
    card.count('4');
    expect(card.view().box.value).toBe('20');
    const { payload, record } = card.saved();
    // ⚠️ nobody typed in the price box, so the stored rate is written back exactly — no case invented
    expect([payload.priceUnit, payload.pricePerUnit, payload.casePrice, payload.caseCount]).toEqual(['kg', 2, null, null]);
    expect(record).toBeNull();
    expect([payload.packCount, payload.unit]).toEqual([4, 'cartone']);
  });

  test('defect 4: a per-kilo item with no readable weight turned into a Cartone keeps its price on an untouched price box', () => {
    const card = openCard({ item: TYPED_KG });
    card.carton();
    card.count('4');
    expect(card.view().box.value, 'nothing to carry a per-kilo rate to without a weight').toBe('');
    expect(card.notes()).toContain('The saved price stays €7.20 / kg until you write a new price.');
    const { payload, record } = card.saved();
    expect([payload.priceUnit, payload.pricePerUnit], 'the price is NOT deleted').toEqual(['kg', 7.2]);
    expect(record).toBeNull();
    expect([payload.packCount, payload.unit]).toEqual([4, 'cartone']);
  });

  test('defect 1: an egg priced 0.25 a piece, weight edited to 60 g, keeps «a piece» and its piece weight', () => {
    const egg = { ...BASE, unit: 'pz', weight: '', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
    const card = openCard({ item: egg });
    card.weight('60');
    card.weightUnit('g');
    expect(card.view().box.value, 'the box shows the same price per item').toBe('0.25');
    const { payload, record } = card.saved();
    expect([payload.priceUnit, payload.pricePerUnit, payload.unitWeightKg]).toEqual(['pcs', 0.25, 0.06]);
    expect(record).toBeNull();
    expect(spaceless(payload.weight)).toBe('60g');
  });

  test('a price typed for a single with a weight that reads is one item: 0.25 for a 60 g egg', () => {
    const card = openCard();
    card.name('Uovo');
    card.weight('60');
    card.weightUnit('g');
    card.box('0.25');
    const { payload } = card.saved();
    expect([payload.priceUnit, payload.pricePerUnit, payload.unitWeightKg]).toEqual(['pcs', 0.25, 0.06]);
    for (const key of ['casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit']) expect(payload[key], key).toBeNull();
  });

  test('a loose item (no readable weight) keeps «How it is bought» and the typed rate', () => {
    const card = openCard({ item: TYPED_KG });
    expect(card.view().typedForm).toBe(true);
    card.rate('7.5');
    const { payload, record } = card.saved();
    expect([payload.priceUnit, payload.pricePerUnit]).toEqual(['kg', 7.5]);
    expect(record).not.toBeNull();
    expect('unit' in payload, 'an existing item\'s order unit is never touched by its price').toBe(false);
  });

  test('«How it is bought» offers no «by the case» choice any more', () => {
    expect(openCard({ item: TYPED_KG }).view().unit.options.map(one => one.value)).toEqual(['', 'kg', 'l', 'pcs']);
  });

  test('a carton with no readable weight is a case of PIECES, asks the piece weight, and prices per piece', () => {
    const card = openCard();
    card.name('Cannucce');
    card.carton();
    card.inner('pezzo');
    card.count('50');
    expect(card.view().pieceWeight.shown).toBe(true);
    card.box('20');
    const { payload } = card.saved();
    expect([payload.priceUnit, payload.pricePerUnit, payload.caseItemUnit, payload.caseCount]).toEqual(['pcs', 0.4, 'pcs', 50]);
    expect([payload.packCount, payload.packUnit, payload.unit]).toEqual([50, 'pezzo', 'cartone']);
  });
});

describe('ingredient-card-save: a new loose item takes its order unit from its price (C55)', () => {
  test('a NEW single with no weight, priced by kilo / litre / piece, gets kg / l / pz (the venue\'s word)', () => {
    for (const [priceUnit, word] of [['kg', 'kg'], ['l', 'l'], ['pcs', 'pz']] as const) {
      const card = openCard();
      card.name('Zucchine');
      card.unit(priceUnit);
      card.rate('3');
      if (priceUnit === 'pcs') card.pieceKg('0.2');
      const { payload } = card.saved();
      expect(payload.unit, priceUnit).toBe(word);
      expect('packCount' in payload).toBe(false);
    }
  });

  test('a NEW single with no price, or priced by a pack, gets an empty unit', () => {
    const none = openCard();
    none.name('Sale');
    expect(none.saved().payload.unit).toBe('');
    const pack = openCard();
    pack.name('Farina');
    pack.weight('25');
    pack.box('20');
    const { payload } = pack.saved();
    expect(payload.unit).toBe('');
    expect([payload.priceUnit, payload.pricePerUnit, payload.unitWeightKg, payload.caseCount, payload.caseItemUnit]).toEqual(['pcs', 20, 25, null, null]);
  });

  test('an EXISTING item with an empty unit is not given one by editing its price', () => {
    const card = openCard({ item: { ...TYPED_KG, unit: '' } });
    card.rate('8');
    expect('unit' in card.saved().payload).toBe(false);
  });

  test('a NEW single whose price is removed (empty box) gets an empty unit, not a loose word', () => {
    const card = openCard();
    card.name('Zucchine');
    card.unit('kg');
    expect(card.saved().payload.unit).toBe('');
  });
});

describe('ingredient-card-save: the format changed since the last price', () => {
  test('a weight changed since the price is said, with both formats; untouched, the stored price stands', () => {
    const card = openCard({ item: { ...PACK_CASE, weight: '3kg' } });
    expect(card.notes()).toContain('The format has changed since the last price: saved 4 × 2.5 kg, with this format 4 × 3 kg. Check the price.');
    expect(card.view().changedNote?.showRecompute).toBe(true);
    const { payload } = card.saved();
    expect([payload.pricePerUnit, payload.casePrice, payload.caseItemSize]).toEqual([2, 20, 2.5]);
  });

  test('«Recalculate» carries the stored price to the format now on the card', () => {
    const card = openCard({ item: { ...PACK_CASE, weight: '3kg' } });
    expect(card.view().box.value, 'the changed format shows NO stored figure…').toBe('');
    expect(card.view().box.placeholder, '…and offers the carried price as a placeholder').toBe('24');
    card.recompute();
    expect(card.view().box.value).toBe('24');
    expect(card.view().changedNote?.showRecompute, 'its job is done').toBe(false);
    const { payload, record } = card.saved();
    // the same per-kilo rate carried to the new weight: 2 a kilo × 3 kg × 4 = 24, stored per item (6 a bag, 3 kg each)
    expect([payload.casePrice, payload.caseCount, payload.caseItemUnit, payload.pricePerUnit, payload.unitWeightKg]).toEqual([24, 4, 'pcs', 6, 3]);
    expect(record, 'the money did not move: 2 a kilo is 2 a kilo however it is stored').toBeNull();
  });

  test('no note when the format agrees with the price', () => {
    expect(openCard({ item: PACK_CASE }).notes().some(note => /format has changed/.test(note))).toBe(false);
    expect(openCard({ item: LEGACY_G_COUNTED }).notes().some(note => /format has changed/.test(note))).toBe(false);
  });

  test('a price typed and then emptied under a new format says so: saving would remove it', () => {
    const card = openCard({ item: TYPED_KG });
    card.carton();
    card.count('4');
    card.box('30');
    card.box('');
    expect(card.view().priceAgainNote).toBe('This format has no price yet: type the price');
  });
});

describe('ingredient-card-save: the VAT line prices the unit the card would save', () => {
  test('the VAT line prices one CARTON for a carton (20 net, 20.80 at 4%)', () => {
    const card = openCard();
    card.carton();
    card.count('4');
    card.weight('2.5');
    card.box('20');
    card.vat('4');
    expect(card.view().vatLine).toBe('€20.00 without VAT, €20.80 with VAT at 4%');
  });

  test('the line follows the order unit the card would save: ordered by the bag it prices ONE bag', () => {
    const card = openCard({ item: { ...PACK_CASE, vatRate: 4 } });
    expect(card.view().vatLine).toBe('€20.00 without VAT, €20.80 with VAT at 4%');
    card.single();
    // the Single is saved with the package word as its unit: one busta of the case at 20 / 4
    expect(card.ctx().order.unit).toBe('busta');
    expect(card.view().vatLine).toBe('€5.00 without VAT, €5.20 with VAT at 4%');
  });

  test('the VAT line goes with the price', () => {
    const card = openCard({ item: { ...TYPED_KG, vatRate: 4 } });
    expect(card.view().vatLine).not.toBe('');
    card.rate('');
    expect(card.view().vatLine).toBe('');
    expect(card.view().summary.muted).toBe(true);
  });
});

describe('ingredient-card-save: a legacy explicit-size case on a card whose weight does not read', () => {
  // 4 × 2.5 kg at 20: without the weight, a touched price would become a case of PIECES and the € / kg every recipe uses would
  // silently go. The size is hinted, never written.
  const NO_WEIGHT: ItemLike = { ...LEGACY_KG_COUNTED, weight: '' };

  test('reopening hints the stored size (never a value) and says what the price was for', () => {
    const card = openCard({ item: NO_WEIGHT });
    expect(weightHintOf(NO_WEIGHT, weightText(card.working))).toEqual({ size: 2.5, unit: 'kg' });
    expect(card.working.weight.amount).toBe('');
    expect(card.notes()).toContain('This price was for 4 × 2.5 kg: write the weight of one item to recalculate it.');
    expect(card.view().pieceWeight.shown, 'no piece weight').toBe(false);
    expect(card.view().changedNote?.showRecompute).toBe(false);
  });

  test('the same for grams and millilitres, in the stored unit', () => {
    const g = openCard({ item: { ...LEGACY_G_COUNTED, weight: '' } });
    expect(weightHintOf({ ...LEGACY_G_COUNTED, weight: '' }, weightText(g.working))).toEqual({ size: 500, unit: 'g' });
    const ml: ItemLike = { ...BASE, weight: '', priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 500, caseItemUnit: 'ml', packCount: 6 };
    const card = openCard({ item: ml });
    expect(weightHintOf(ml, '')).toEqual({ size: 500, unit: 'ml' });
    expect(card.notes().some(note => /6 × 500 ml/.test(note))).toBe(true);
  });

  test('no hint once the weight reads, and none for an item priced any other way', () => {
    expect(weightHintOf(NO_WEIGHT, '2.5 kg')).toBeNull();
    expect(weightHintOf(PACK_CASE, '')).toBeNull();
    expect(weightHintOf(TYPED_KG, '')).toBeNull();
    expect(weightHintOf(null, '')).toBeNull();
  });

  test('an untouched save with the hint showing is still verbatim', () => {
    const { payload, record } = openCard({ item: NO_WEIGHT }).saved();
    for (const key of PRICE_KEYS) expect(payload[key] ?? null, key).toBe(NO_WEIGHT[key] ?? null);
    expect(record).toBeNull();
    expect(payload.weight, 'the hint was never written as the weight').toBe('');
    for (const key of FORMAT_KEYS) expect(key in payload, key).toBe(false);
  });

  test('a touched price without the weight is refused on the weight box, never stored as pieces', () => {
    const card = openCard({ item: NO_WEIGHT });
    card.inner('busta');   // the legacy card names no package: a person writing a price must say what the carton holds
    card.box('22');
    expect(card.save().refused).toBe('weight');
  });

  test('with the weight typed, the price is stored per item and still means the right € / kg', () => {
    const card = openCard({ item: NO_WEIGHT });
    card.inner('busta');
    card.weight('2.5');
    card.box('22');
    const { payload } = card.saved();
    expect([payload.caseItemUnit, payload.caseCount, payload.priceUnit, payload.pricePerUnit, payload.unitWeightKg]).toEqual(['pcs', 4, 'pcs', 5.5, 2.5]);
    expect(pricePerKg(payload)).toBe(2.2);
  });
});

describe('ingredient-card-save: editing the format or the weight never rewrites a stored price (review, rule B)', () => {
  test('B: a count change on a stored case leaves the price EXACTLY as saved, and says so', () => {
    const card = openCard({ item: PACK_CASE });
    card.count('5');
    expect(card.view().box.value, 'the figure no longer means the same thing').toBe('');
    expect(card.view().box.placeholder, '2 a kilo × 2.5 kg × 5').toBe('25');
    expect(card.notes()).toContain('The format has changed since the last price: saved 4 × 2.5 kg, with this format 5 × 2.5 kg. Check the price.');
    expect(card.notes()).toContain('The saved price stays €2.00 / kg until you write the new price or tap Recalculate.');
    const { payload, record } = card.saved();
    expect([payload.priceUnit, payload.pricePerUnit, payload.casePrice, payload.caseCount, payload.caseItemUnit, payload.caseItemSize]).toEqual(['kg', 2, 20, 4, 'pack', 2.5]);
    expect(record).toBeNull();
    expect(payload.packCount, 'the product data did change').toBe(5);
  });

  test('B: «Recalculate» after a count change fills the box with the carried price, and saving stores it per item', () => {
    const card = openCard({ item: PACK_CASE });
    card.count('5');
    card.recompute();
    expect(card.view().box.value).toBe('25');
    const { payload, record } = card.saved();
    expect([payload.casePrice, payload.caseCount, payload.caseItemUnit, payload.pricePerUnit, payload.unitWeightKg]).toEqual([25, 5, 'pcs', 5, 2.5]);
    // the stored UNIT moved from «per kilo» to «per item», the money did not: 2 a kilo is 5 for a 2.5 kg bag
    expect(record).toBeNull();
  });

  test('B: a weight edit alone never rewrites a stored case either', () => {
    const card = openCard({ item: PACK_CASE });
    card.weight('3');
    const { payload, record } = card.saved();
    expect([payload.pricePerUnit, payload.casePrice, payload.caseItemSize, payload.caseItemUnit]).toEqual([2, 20, 2.5, 'pack']);
    expect(record).toBeNull();
  });
});

describe('ingredient-card-save: a format change that replaces the order unit is told to the caller (D)', () => {
  test('5th review F3: the case ordered with NO unit, turned into a Singola, freezes the open line in the carton word', () => {
    // the one 'pack' case in production: unit '', a case of 4 bags priced 20
    const sugar = { ...BASE, unit: '', packUnit: 'busta', weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
    const card = openCard({ item: sugar });
    expect(card.isCarton(), 'a manager sees the stored case as a Cartone').toBe(true);
    card.single();
    const { payload, meta } = card.saved();
    expect(payload.unit, 'the package word: a line now counts bags (6th review)').toBe('busta');
    expect(meta, '«2» meant two cases: it stays two cases').toBe('cartone');
    // and the same case turned into a Cartone the person names keeps «2» as two cases: nothing frozen
    const toCarton = openCard({ item: sugar });
    toCarton.inner('sacco');
    const saved = toCarton.saved();
    expect(saved.payload.unit).toBe('cartone');
    expect(saved.meta).toBe('');
  });
});

describe('ingredient-card-save: the word for ONE item inside is required like the count, when the carton is being written', () => {
  test('a carton being written with no inner word is refused on the inner menu', () => {
    // a legacy 4 × 2.5 kg case names no package; the person moves the count
    const card = openCard({ item: LEGACY_KG_COUNTED });
    expect(card.working.inner.choice).toBe('');
    card.count('5');
    expect(card.save().refused).toBe('innerEmpty');
    card.inner('busta');
    const { payload } = card.saved();
    expect([payload.packCount, payload.packUnit, payload.unit]).toEqual([5, 'busta', 'cartone']);
  });

  test('typing a price under a carton with no inner word is refused on the inner menu too', () => {
    const card = openCard({ item: LEGACY_KG_COUNTED });
    card.box('22');
    expect(card.save().refused).toBe('innerEmpty');
  });

  test('the count is checked first, then the inner word', () => {
    const card = openCard();
    card.name('Farina');
    card.carton();
    card.inner('');
    expect(card.save().refused).toBe('count');
    card.count('4');
    expect(card.save().refused).toBe('innerEmpty');
  });

  test('switching to Cartone pre-selects the default word (busta on an Italian venue), so the normal path is never refused', () => {
    const card = openCard();
    card.name('Farina');
    card.carton();
    expect(card.working.inner.choice).toBe('busta');
    card.count('4');
    expect(card.save().refused).toBeNull();
  });

  test('an untouched legacy card with no package word is never blocked, and neither is an employee one', () => {
    expect(openCard({ item: LEGACY_KG_COUNTED }).save().refused).toBeNull();
    expect(openCard({ item: LEGACY_G_COUNTED }).save().refused).toBeNull();
    expect(openCard({ item: { ...BASE, unit: 'cartone', packUnit: 'busta', weight: '2.5kg' }, mayPrice: false }).save().refused).toBeNull();
  });

  test('a Singola never needs an inner word', () => {
    const card = openCard({ item: TYPED_SACK });
    card.box('1');
    expect(card.save().refused).toBeNull();
  });
});

describe('ingredient-card-save: 2nd deep review', () => {
  // What the card writes, merged over what was stored, is the document the readers then see.
  const asStored = (item: ItemLike, payload: Record<string, unknown>) => ({ ...item, ...payload });

  test('review 2: retyping the SAME 20 on a live pack carton writes the full format, and every line still prices', () => {
    const card = openCard({ item: PACK_CASE });
    card.box('20');
    const { payload, record } = card.saved();
    // ⚠️ 4th review: a price never moves the order unit, so `unit` stays as stored («cartone») and is not even sent
    expect([payload.packCount, payload.packUnit, 'unit' in payload], 'packCount is written too, the unit is left alone').toEqual([4, 'busta', false]);
    expect([payload.priceUnit, payload.pricePerUnit, payload.casePrice, payload.caseCount, payload.caseItemUnit, payload.unitWeightKg])
      .toEqual(['pcs', 5, 20, 4, 'pcs', 2.5]);
    expect(record, 'a representation change with the same money: no history entry (3rd review)').toBeNull();
    const ing = asStored(PACK_CASE, payload);
    expect(unitCost(ing, ing), 'a carton').toBe(20);
    expect(unitCost({ ...ing, unit: 'busta' }, ing), 'a bag').toBe(5);
  });

  test('review 2: «Recalculate» writes the full format as well', () => {
    const card = openCard({ item: { ...PACK_CASE, weight: '3kg' } });
    card.recompute();
    const { payload } = card.saved();
    expect([payload.packCount, payload.packUnit, 'unit' in payload], 'the unit stays as stored (4th review)').toEqual([4, 'busta', false]);
  });

  test('review 3 (manager): Cartone → Singola turns the case into the SAME money per item, with no history entry and no false note', () => {
    const card = openCard({ item: PACK_CASE });
    card.single();
    expect(card.view().box.value, 'the price of one bag, shown as it will be written').toBe('5');
    expect(card.notes().some(note => /saved price stays/.test(note))).toBe(false);
    expect(card.notes().some(note => /format has changed/.test(note))).toBe(false);
    const { payload, record } = card.saved();
    expect([payload.priceUnit, payload.pricePerUnit, payload.unitWeightKg]).toEqual(['pcs', 5, 2.5]);
    for (const key of ['casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit']) expect(payload[key], key).toBeNull();
    expect(record, 'the cost per item did not move').toBeNull();
    expect([payload.packCount, payload.unit]).toEqual([null, 'busta']);
    const ing = asStored(PACK_CASE, payload);
    expect(unitCost(ing, ing), 'Orders prices one bag').toBe(5);
    expect(pricePerKg(ing), 'recipes still get 2 a kilo').toBe(2);
  });

  test('review 3 (manager): a legacy explicit-size case and a case of pieces convert the same way', () => {
    const through = (item: ItemLike) => { const card = openCard({ item }); card.single(); return card.saved(); };
    const kg = through(LEGACY_KG_COUNTED);
    expect([kg.payload.priceUnit, kg.payload.pricePerUnit, kg.payload.unitWeightKg, kg.payload.caseCount, kg.record]).toEqual(['pcs', 5, 2.5, null, null]);
    const g = through(LEGACY_G_COUNTED);
    expect([g.payload.pricePerUnit, g.payload.unitWeightKg, g.record]).toEqual([5, 0.5, null]);
    const pcs = through(PIECES_COUNTED);
    expect([pcs.payload.pricePerUnit, pcs.payload.unitWeightKg, pcs.payload.caseCount, pcs.record]).toEqual([0.4, 0.06, null, null]);
  });

  test('review 3 (employee): Cartone → Singola leaves the case alone — no price field at all', () => {
    const card = openCard({ item: { ...BASE, unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg' }, mayPrice: false });
    card.single();
    const { payload } = card.saved();
    expect([payload.packCount, payload.unit]).toEqual([null, 'busta']);
    for (const key of PRICE_FIELDS) expect(key in payload, key).toBe(false);
  });

  test('review 3 (manager after an employee): the card reopens as a Singola, says the format changed, and Ricalcola converts it to per-item', () => {
    // what is stored after an employee turned a 'pack' carton of 4 into a Singola (unit = «busta», no packCount)
    const stored: ItemLike = { ...PACK_CASE, packCount: null, unit: 'busta' };
    const card = openCard({ item: stored });
    expect(card.isCarton(), 'a Singola, not a carton read back from the case').toBe(false);
    expect(card.notes().some(note => /^The format has changed since the last price: saved 4 × 2\.5 kg/.test(note))).toBe(true);
    expect(card.view().changedNote?.showRecompute).toBe(true);
    // untouched: the stored price verbatim (nothing guessed on the manager's behalf)
    const untouched = card.saved();
    for (const key of PRICE_KEYS) expect(untouched.payload[key] ?? null, key).toBe(stored[key] ?? null);
    expect(untouched.record).toBeNull();
    // Ricalcola: the same price per item carried to a single (2 a kilo × 2.5 kg = 5), stored per item
    const recalc = openCard({ item: stored });
    recalc.recompute();
    expect(recalc.view().box.value).toBe('5');
    const { payload, record } = recalc.saved();
    expect([payload.priceUnit, payload.pricePerUnit, payload.unitWeightKg, payload.caseCount]).toEqual(['pcs', 5, 2.5, null]);
    expect(record, 'a representation change with the same money: no history entry (3rd review)').toBeNull();
    const ing = asStored(stored, payload);
    expect(unitCost(ing, ing), 'now Orders prices one bag').toBe(5);
    expect(pricePerKg(ing)).toBe(2);
  });

  test('review 3 (manager after an employee): a typed price converts it too', () => {
    const card = openCard({ item: { ...PACK_CASE, packCount: null, unit: 'busta' } });
    card.box('5');
    const { payload } = card.saved();
    expect([payload.priceUnit, payload.pricePerUnit, payload.unitWeightKg, payload.caseCount]).toEqual(['pcs', 5, 2.5, null]);
    const ing = asStored(PACK_CASE, payload);
    expect(unitCost(ing, ing)).toBe(5);
  });

  test('review 3: only a case ordered by its OWN package word stays on the new card; the same case ordered otherwise is an old shape', () => {
    for (const unit of ['sacco', 'kg', 'pz']) expect(usesLegacyCard({ ...PACK_CASE, packCount: null, unit }), unit).toBe(true);
    expect(usesLegacyCard({ ...PACK_CASE, packCount: null, unit: 'busta' }), 'its own package word: the new card').toBe(false);
  });

  test('review 4 (3rd: history): a corrected weight on a per-item price moves the piece weight, not the price — and the history says so', () => {
    const egg = { ...BASE, unit: '', weight: '60g', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
    const card = openCard({ item: egg });
    card.weight('70');
    const { payload, record } = card.saved();
    expect([payload.priceUnit, payload.pricePerUnit, payload.unitWeightKg]).toEqual(['pcs', 0.25, 0.07]);
    // the piece weight is the divisor of the price per kilo every recipe cost is built from: it IS a price change
    expect([record?.priceUnit, record?.pricePerUnit, record?.unitWeightKg]).toEqual(['pcs', 0.25, 0.07]);
    expect(card.notes().some(note => /format has changed/.test(note)), 'nothing to warn about: it is handled').toBe(false);
  });

  test('review 4: the same for a Cartone\'s stored case of pieces', () => {
    const stored = { ...BASE, unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg', priceUnit: 'pcs', pricePerUnit: 5, casePrice: 20, caseCount: 4, caseItemUnit: 'pcs', unitWeightKg: 2.5 };
    const card = openCard({ item: stored });
    card.weight('3');
    const { payload, record } = card.saved();
    expect([payload.unitWeightKg, payload.pricePerUnit, payload.casePrice, payload.caseCount]).toEqual([3, 5, 20, 4]);
    expect(record?.unitWeightKg, 'a changed piece weight is a price change').toBe(3);
  });

  test('review 4: a piece weight that was never the pack weight is left alone', () => {
    const tray = { ...BASE, unit: '', weight: '360g', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
    const card = openCard({ item: tray });
    card.weight('400');
    expect(card.saved().payload.unitWeightKg).toBe(0.06);
  });

  test('3rd review 1: a weight changed by an employee on a per-piece price is NOT flagged (it cannot be told from an own piece weight)', () => {
    const stale = { ...BASE, unit: '', weight: '70g', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
    const card = openCard({ item: stale });
    expect(card.notes().some(note => /format has changed/.test(note))).toBe(false);
    expect(card.view().changedNote).toBeNull();
  });

  test('review 6: «each» is an interface word — «al pezzo» in an Italian note', () => {
    const card = openCard({ item: PIECES_COUNTED, t: tIt, locale: 'it-IT' });
    card.count('40');
    expect(card.notes()).toContain('Il prezzo salvato resta €0.40 al pezzo finché non scrivi il nuovo prezzo o tocchi Ricalcola.');
  });

  test('review 7: «Recalculate» hides itself once the price is being recomputed', () => {
    const card = openCard({ item: PACK_CASE });
    card.count('5');
    expect(card.view().changedNote?.showRecompute).toBe(true);
    card.recompute();
    expect(card.view().changedNote?.showRecompute).toBe(false);
  });
});

describe('ingredient-card-save: 3rd deep review', () => {
  // An old per-piece price: `weight` is the PACK, `unitWeightKg` is ONE PIECE.
  const EGGS: ItemLike = { ...BASE, unit: 'vaschetta', weight: '360g', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
  const GELATINE: ItemLike = { ...BASE, unit: 'busta', weight: '1kg', priceUnit: 'pcs', pricePerUnit: 0.03, unitWeightKg: 0.002 };
  const PACKAGING: ItemLike = { ...BASE, kind: 'packaging', unit: '', weight: '500ml', priceUnit: 'pcs', pricePerUnit: 0.12 };

  test('3rd review 1: eggs (360 g pack, 0.06 kg a piece) open with NO note, the piece-weight box visible and pre-filled, and save verbatim', () => {
    for (const item of [EGGS, GELATINE]) {
      const card = openCard({ item });
      expect(card.notes().some(note => /format has changed|saved price stays/.test(note)), card.notes().join(' | ')).toBe(false);
      expect(card.view().changedNote, 'Ricalcola is not offered').toBeNull();
      expect(card.view().pieceWeight.shown, 'the «Peso di un pezzo» box is visible').toBe(true);
      expect(card.view().pieceWeight.value, 'pre-filled with the stored piece weight').toBe(String(item.unitWeightKg));
      expect(card.view().typedForm, 'the price is «per piece», as today').toBe(true);
      const { payload, record } = card.saved();
      for (const key of PRICE_KEYS) expect(payload[key] ?? null, key).toBe(item[key] ?? null);
      expect(record).toBeNull();
    }
  });

  test('3rd review 1: a retyped price keeps the visible piece weight (0.26 for the eggs, still 0.06 kg a piece)', () => {
    const card = openCard({ item: EGGS });
    card.rate('0.26');
    const { payload } = card.saved();
    expect([payload.priceUnit, payload.pricePerUnit, payload.unitWeightKg]).toEqual(['pcs', 0.26, 0.06]);
    expect(pricePerKg(payload), 'per kilo stays a real per-kilo price, not 0.26 / 0.36 kg').toBe(4.3333);
  });

  test('3rd review 1: editing the pack weight never touches the piece weight of an own-piece-weight price', () => {
    const card = openCard({ item: EGGS });
    card.weight('400');
    const { payload, record } = card.saved();
    expect([payload.pricePerUnit, payload.unitWeightKg]).toEqual([0.25, 0.06]);
    expect(record).toBeNull();
  });

  test('3rd review 1: a legacy per-piece PACKAGING with a readable weight keeps «a price per piece»', () => {
    const card = openCard({ item: PACKAGING, kind: 'packaging' });
    expect(card.view().typedForm).toBe(true);
    expect(card.view().rate.value).toBe('0.12');
  });

  test('3rd review 1: a price whose piece weight IS the weight (what the new card writes) still tracks it', () => {
    const mine = { ...BASE, unit: '', weight: '60g', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
    const card = openCard({ item: mine });
    expect(card.view().typedForm, '«Pack price» for one item').toBe(false);
    expect(card.view().box.value).toBe('0.25');
  });

  test('3rd review 2: Cartone ↔ Singola is a change the leave question sees, both ways, for an employee and for an unpriced item', () => {
    for (const [name, options] of [
      ['an employee carton', { item: { ...BASE, unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg' }, mayPrice: false }],
      ['an employee single', { item: { ...BASE, unit: 'sacco', weight: '10kg' }, mayPrice: false }],
      ['an unpriced item with a price section', { item: { ...BASE, unit: 'sacco', weight: '10kg' } }],
      ['a new item', {}],
    ] as const) {
      const card = openCard(options);
      expect(card.dirty(), `${name}: nothing yet`).toBe(false);
      const toCarton = !card.isCarton();
      if (toCarton) card.carton(); else card.single();
      expect(card.dirty(), `${name}: the format change is seen`).toBe(true);
      if (toCarton) card.single(); else card.carton();
      expect(card.dirty(), `${name}: and put back, it is not`).toBe(false);
    }
  });

  test('3rd review 5: Ricalcola on an employee-made Singola over a case of 3 at 10 keeps 3.333333 and plants no history entry', () => {
    const stored = {
      ...BASE, unit: 'busta', packUnit: 'busta', weight: '1kg', priceUnit: 'pcs', pricePerUnit: 3.333333,
      casePrice: 10, caseCount: 3, caseItemUnit: 'pcs', unitWeightKg: 1,
    };
    const card = openCard({ item: stored });
    expect(card.isCarton()).toBe(false);
    card.recompute();
    const { payload, record } = card.saved();
    expect([payload.priceUnit, payload.pricePerUnit, payload.unitWeightKg, payload.caseCount]).toEqual(['pcs', 3.333333, 1, null]);
    expect(record, 'the same money').toBeNull();
  });
});

describe('ingredient-card-save: «12,5» and «12.5» both mean twelve and a half (4 Oct 2026)', () => {
  test('a price typed with a comma is saved as the same number as with a point', () => {
    for (const typed of ['7,5', '7.5', ' 7,5 ']) {
      const card = openCard({ item: TYPED_KG });
      card.rate(typed);
      expect(card.saved().payload.pricePerUnit, `typed «${typed}»`).toBe(7.5);
    }
    const card = openCard();
    card.name('Farina 00');
    card.carton();
    card.count('4');
    card.weight('2,5');
    card.box('20,40');
    expect(card.saved().payload.casePrice, 'the case price box reads the comma too').toBe(20.4);
  });

  test('a price box holding something that is not a number is refused on Save, never saved as no price', () => {
    for (const typed of ['1.234,5', 'abc', '12,50 x', '-5', '0']) {
      const card = openCard({ item: TYPED_KG });
      card.rate(typed);
      expect(card.save().refused, `«${typed}» is pointed at`).toBe('rate');
      card.rate('7,5');
      expect(card.save().refused, 'typing clears the refusal').toBeNull();
    }
    // An EMPTY box is still how a price is removed.
    const card = openCard({ item: TYPED_KG });
    card.rate('');
    expect(card.saved().payload.pricePerUnit).toBeNull();
  });

  test('the refusal names the box that SHOWS the text: the price box of a pack, the piece weight of a loose piece', () => {
    const pack = openCard({ item: SACK });
    pack.box('abc');
    expect(pack.save().refused).toBe('box');
    const loose = openCard({ item: TYPED_PIECE });
    loose.pieceKg('x');
    expect(loose.save().refused).toBe('pieceKg');
    // a box that is not showing is not judged (the rate box of a pack price)
    const hidden = openCard({ item: SACK });
    hidden.rate('abc');
    expect(hidden.save().refused).toBeNull();
  });

  test('the boxes show the stored figures in the venue\'s layout: an Italian venue shows the comma', () => {
    const italy = moneyOf('€', moneyLayoutOf({ country: 'IT' }));
    const card = openCard({ item: TYPED_KG, money: italy });
    expect(card.view().rate.value, 'the stored 7.2 shown the Italian way').toBe('7,2');
    expect(card.view().keepsNote).toBeNull();
    card.carton();
    card.count('4');
    expect(card.notes().every(note => !/€7\.20/.test(note)), 'no British-layout money left on the card').toBe(true);
    expect(card.notes().join(' ')).toMatch(/7,20/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// tests/price-basis-card.test.mjs
// ═══════════════════════════════════════════════════════════════════════════════

describe('price-basis-card', () => {
  // An old stored shape: the card of before opens, and it has no selector.
  const OLD: ItemLike = { ...BASE, vatRate: 4, unit: 'cartone', weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' };

  test('a Singola with a readable weight offers «per pack | per kg», opens on «per pack», and says «Pack price»', () => {
    const card = openCard({ item: SACK });
    expect(card.labels()).toEqual(['per pack', 'per kg']);
    expect(card.pressed()).toEqual(['per pack']);
    expect(card.view().box.label).toBe('Pack price (€)');
    expect(card.view().box.value).toBe('9.6');
  });

  test('a litre weight says «per litre», and its price label follows', () => {
    const card = openCard({ item: { ...SACK, weight: '750ml', unitWeightKg: 0.75, pricePerUnit: 2.5275 } });
    expect(card.labels()).toEqual(['per pack', 'per litre']);
    card.tap('per litre');
    expect(card.view().box.label).toBe('Price per litre (€)');
    expect(card.view().box.value).toBe('3.37');
  });

  test('a Cartone offers «per case | per pack | per kg» and opens on «per case» with its price', () => {
    const card = openCard({ item: CARTON });
    expect(card.labels()).toEqual(['per case', 'per pack', 'per kg']);
    expect(card.pressed()).toEqual(['per case']);
    expect(card.view().box.label).toBe('Case price (€)');
    expect(card.view().box.value).toBe('30');
  });

  test('the typed form (no readable weight) shows no selector, and the old shapes are the card of before', () => {
    expect(openCard({ item: TYPED_KG }).labels()).toEqual([]);
    expect(usesLegacyCard(OLD), 'the old card draws none at all').toBe(true);
  });

  test('tapping a segment on an untouched price re-shows the SAME money in the new basis', () => {
    const card = openCard({ item: CARTON });
    card.tap('per pack');
    expect(card.view().box.label).toBe('Pack price (€)');
    expect(card.view().box.value).toBe('5');
    card.tap('per kg');
    expect(card.view().box.label).toBe('Price per kg (€)');
    expect(card.view().box.value).toBe('10');
    expect(card.view().summary.main).toMatch(/= €30\.00 per case/);
    expect(card.view().summary.main).toMatch(/= €5\.00 per pack/);
    card.tap('per case');
    expect(card.view().box.value).toBe('30');
    expect(isPriceDirty(card.price, CARTON), 'a tap never makes the price dirty').toBe(false);
  });

  test('tapping a segment on a number being typed CONVERTS it, never keeps the digits', () => {
    const card = openCard({ item: SACK });
    card.box('12');
    card.tap('per kg');
    expect(card.view().box.value).toBe('1.2');
    card.box('1.5');
    card.tap('per pack');
    expect(card.view().box.value).toBe('15');
  });

  test('a basis-only change saves priceBasis, the same money, and NO history record', () => {
    const card = openCard({ item: SACK });
    card.tap('per kg');
    const { payload, record } = card.saved();
    expect(payload.priceBasis).toBe('rate');
    expect(payload.priceUnit).toBe('pcs');
    expect(payload.pricePerUnit).toBe(9.6);
    expect(payload.unitWeightKg).toBe(10);
    expect(record, 'nothing moved in the money, so nothing is written to the history').toBeNull();
  });

  test('a basis-only change on a Cartone keeps the case verbatim and records nothing', () => {
    const card = openCard({ item: CARTON });
    card.tap('per pack');
    const { payload, record } = card.saved();
    expect(payload.priceBasis).toBe('pack');
    expect(payload.casePrice).toBe(30);
    expect(payload.caseCount).toBe(6);
    expect(payload.pricePerUnit).toBe(5);
    expect(record).toBeNull();
  });

  test('an untouched save with nothing chosen writes priceBasis null (the default)', () => {
    for (const item of [SACK, CARTON]) {
      const { payload, record } = openCard({ item }).saved();
      expect(payload.priceBasis).toBeNull();
      expect(record).toBeNull();
    }
  });

  test('a number typed per kg is saved as the pack price, a new price records history, and the choice is kept', () => {
    const card = openCard({ item: SACK });
    card.tap('per kg');
    card.box('0.97');
    const { payload, record } = card.saved();
    expect(payload.priceBasis).toBe('rate');
    expect(payload.pricePerUnit).toBe(9.7);
    expect(payload.priceUnit).toBe('pcs');
    expect(payload.unitWeightKg).toBe(10);
    expect(record, 'the money moved: one history record').not.toBeNull();
    expect(record?.pricePerUnit).toBe(9.7);
  });

  test('a Cartone typed per pack is saved as the case, per kg likewise', () => {
    const byPack = openCard({ item: CARTON });
    byPack.tap('per pack');
    byPack.box('5.5');
    const a = byPack.saved().payload;
    expect(a.casePrice).toBe(33);
    expect(a.priceBasis).toBe('pack');

    const byKg = openCard({ item: CARTON });
    byKg.tap('per kg');
    byKg.box('11');
    const b = byKg.saved().payload;
    expect(b.casePrice).toBe(33);
    expect(b.caseCount).toBe(6);
    expect(b.priceBasis).toBe('rate');
  });

  test('reopening an ingredient saved per kg shows 0.96 again, and per pack 9.6 on a tap', () => {
    const card = openCard({ item: { ...SACK, priceBasis: 'rate' } });
    expect(card.pressed()).toEqual(['per kg']);
    expect(card.view().box.label).toBe('Price per kg (€)');
    expect(card.view().box.value).toBe('0.96');
    card.tap('per pack');
    expect(card.view().box.value).toBe('9.6');
  });

  test('a stored basis this form does not offer falls back to the default', () => {
    const card = openCard({ item: { ...SACK, priceBasis: 'case' } });
    expect(card.pressed()).toEqual(['per pack']);
    expect(card.view().box.value).toBe('9.6');
  });

  test('a person with no price access (no price block) has no selector: there is no price state at all', () => {
    const card = openCard({ item: SACK, mayPrice: false });
    expect(() => card.view()).toThrow();
  });

  test('Cartone 1.00 → per kg → per case comes back as exactly 1 (6 × 25 kg), and saves 1', () => {
    const item: ItemLike = {
      ...BASE, unit: 'cartone', packUnit: 'busta', packCount: 6, weight: '25kg',
      priceUnit: 'pcs', pricePerUnit: 0.166667, unitWeightKg: 25, casePrice: 1, caseCount: 6, caseItemUnit: 'pcs',
    };
    const card = openCard({ item });
    card.box('1');
    card.tap('per kg');
    expect(card.view().box.value).not.toBe('1');
    card.tap('per pack');
    card.tap('per kg');
    card.tap('per case');
    expect(card.view().box.value).toBe('1');
    card.tap('per kg');
    const { payload } = card.saved();
    expect(payload.casePrice).toBe(1);
    expect(payload.priceBasis).toBe('rate');
  });

  test('a 750-piece carton at 23.47, shown per pack, stays 23.47 when only the piece weight changes', () => {
    const item: ItemLike = {
      ...BASE, unit: 'cartone', packUnit: 'pezzo', packCount: 750, weight: '',
      priceUnit: 'pcs', pricePerUnit: 0.031293, unitWeightKg: 0.06, casePrice: 23.47, caseCount: 750, caseItemUnit: 'pcs',
      priceBasis: 'pack',
    };
    const card = openCard({ item });
    expect(card.pressed()).toEqual(['per pack']);
    card.pieceKg('0.05');
    const { payload } = card.saved();
    expect(payload.casePrice).toBe(23.47);
    expect(payload.unitWeightKg).toBe(0.05);
    expect(payload.priceBasis).toBe('pack');
  });

  test('a tap that cannot convert (empty carton count) does nothing: the SAME state, the number and the segment stay', () => {
    const card = openCard({ item: CARTON });
    card.box('30');
    card.count('');
    const before = card.price;
    card.tap('per pack');
    expect(card.price).toBe(before);
    expect(card.view().box.value).toBe('30');
    expect(card.pressed()).toEqual(['per case']);
  });

  test('choosing a segment counts as a change for the leave-without-saving check (P20)', () => {
    const card = openCard({ item: SACK });
    expect(card.dirty()).toBe(false);
    card.tap('per kg');
    expect(card.dirty()).toBe(true);
  });

  // ── The box shows a ROUNDED figure (8 Oct 2026): what is saved and what is shown must still agree ──────────
  const CASE_12: ItemLike = {
    ...BASE, unit: 'cartone', packUnit: 'busta', packCount: 12, weight: '2.27kg',
    priceUnit: 'pcs', pricePerUnit: 2, unitWeightKg: 2.27, casePrice: 24, caseCount: 12, caseItemUnit: 'pcs',
  };
  const CUPS: ItemLike = {
    ...BASE, unit: 'cartone', packUnit: 'busta', packCount: 1000, weight: '5g',
    priceUnit: 'pcs', pricePerUnit: 0.01, unitWeightKg: 0.005, casePrice: 10, caseCount: 1000, caseItemUnit: 'pcs',
  };
  const POUND_NINE: ItemLike = { ...BASE, unit: 'sacco', weight: '2.27kg', priceUnit: 'pcs', pricePerUnit: 9, unitWeightKg: 2.27 };

  test('a pack of 2.27 kg at 10 shows 4.41 per kg, and comes back to exactly 10', () => {
    const card = openCard({ item: POUND_NINE });
    card.box('10');
    card.tap('per kg');
    expect(card.view().box.value).toBe('4.41');
    card.tap('per pack');
    expect(card.view().box.value).toBe('10');
    card.tap('per kg');
    const { payload } = card.saved();
    expect(payload.pricePerUnit, 'the rounded 4.41 never reaches the price').toBe(10);
    expect(payload.priceBasis).toBe('rate');
  });

  test('a case typed, shown per kg, then made a Singola saves the exact pack price, not the rounded box', () => {
    const card = openCard({ item: CASE_12 });
    card.box('30');
    card.tap('per kg');
    expect(card.view().box.value).toBe('1.1');
    card.single();
    const { payload } = card.saved();
    expect(payload.priceBasis).toBe('rate');
    expect(payload.pricePerUnit, 'not 2.497 from the shown 1.1').toBe(2.5);
  });

  test('a case of 1000 cups typed, shown per pack, then made a Singola saves 0.012 and shows it', () => {
    const card = openCard({ item: CUPS });
    card.box('12');
    card.tap('per pack');
    expect(card.view().box.value).toBe('0.012');
    card.single();
    const { payload } = card.saved();
    expect(payload.priceUnit).toBe('pcs');
    expect(payload.pricePerUnit).toBe(0.012);
  });

  test('after Cartone → Singola a tap still CONVERTS: «per kg» shows 2.4 and saves 0.012 a pack', () => {
    const card = openCard({ item: CUPS });
    card.box('12');
    card.tap('per pack');
    card.single();
    expect(card.view().box.value).toBe('0.012');
    card.tap('per kg');
    expect(card.view().box.value, 'the label changed, so the number must too').toBe('2.4');
    const { payload } = card.saved();
    expect(payload.pricePerUnit).toBe(0.012);
    expect(payload.priceBasis).toBe('rate');
  });

  test('a case price left in the box by Cartone → Singola is read as shown, and a tap converts it', () => {
    const card = openCard({ item: CUPS });
    card.box('12');
    card.single();
    expect(card.view().box.value).toBe('12');
    card.tap('per kg');
    expect(card.view().box.value).toBe('2400');
    const { payload } = card.saved();
    expect(payload.pricePerUnit, 'what the box said a pack costs, before the tap').toBe(12);
  });

  test('control: the same case shown per kg and saved as a Cartone keeps 30', () => {
    const card = openCard({ item: CASE_12 });
    card.box('30');
    card.tap('per kg');
    const { payload } = card.saved();
    expect(payload.casePrice).toBe(30);
    expect(payload.pricePerUnit).toBe(2.5);
    expect(payload.priceBasis).toBe('rate');
  });

  test('typed per kg, shown per pack, then the weight changes: the box follows and agrees with the save', () => {
    const card = openCard({ item: POUND_NINE });
    card.tap('per kg');
    expect(card.view().box.value).toBe('3.96');
    card.box('4.40');
    card.tap('per pack');
    expect(card.view().box.value).toBe('9.99');
    card.weight('2.5');
    expect(card.view().box.value, 'the box says what Save will write').toBe('11');
    const { payload } = card.saved();
    expect(payload.pricePerUnit).toBe(11);
    expect(payload.unitWeightKg).toBe(2.5);
  });

  test('typed per case, shown per pack, then the count changes: the box follows and the case stays 30', () => {
    const card = openCard({ item: CARTON });
    card.box('30');
    card.tap('per pack');
    expect(card.view().box.value).toBe('5');
    card.count('10');
    expect(card.view().box.value).toBe('3');
    const { payload } = card.saved();
    expect(payload.casePrice).toBe(30);
    expect(payload.pricePerUnit).toBe(3);
  });

  test('a number typed over a figure a tap wrote is what the person typed', () => {
    const card = openCard({ item: POUND_NINE });
    card.box('10');
    card.tap('per kg');
    card.box('5');
    card.weight('2');
    expect(card.view().box.value, 'a typed box is never refilled').toBe('5');
    const { payload } = card.saved();
    expect(payload.pricePerUnit).toBe(10);
    expect(payload.unitWeightKg).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// tests/case-price-form.test.mjs and tests/ingredient-form-guards.test.mjs — the behaviours
// ═══════════════════════════════════════════════════════════════════════════════

describe('case-price-form', () => {
  test('the price box means what the format and the weight say, and shows only the boxes that mean something (C58, C63)', () => {
    // loose: «How it is bought» + the rate; the piece weight only for a price by the piece
    const loose = openCard({ item: TYPED_KG });
    expect(loose.view()).toMatchObject({ typedForm: true });
    expect(loose.view().pieceWeight.shown).toBe(false);
    loose.unit('pcs');
    expect(loose.view().pieceWeight.shown).toBe(true);
    // a Single with a weight: the pack price alone
    expect(openCard({ item: SACK }).view()).toMatchObject({ typedForm: false, box: { label: 'Pack price (€)' } });
    // a Case with no readable weight: a case of PIECES, the piece weight asked
    const pieces = openCard({ item: PIECES_COUNTED });
    expect(pieces.view()).toMatchObject({ typedForm: false, form: 'carton-pieces', box: { label: 'Case price (€)' } });
    expect(pieces.view().pieceWeight.shown).toBe(true);
    // a Case with a weight: the case price, no piece weight
    const sized = openCard({ item: CARTON });
    expect(sized.view().pieceWeight.shown).toBe(false);
  });

  test('«How it is bought» is None plus the three units, with the words of the screen', () => {
    expect(openCard({ item: TYPED_KG }).view().unit.options).toEqual([
      { value: '', label: 'None' }, { value: 'kg', label: 'by kg' }, { value: 'l', label: 'by litre' }, { value: 'pcs', label: 'by piece' },
    ]);
  });

  test('C60: the rate box is labelled and exampled by the unit, and an unknown unit gets a generic label and NO example', () => {
    const card = openCard({ item: TYPED_KG });
    expect(card.view().rate).toMatchObject({ label: 'Price per kg (€)', placeholder: 'e.g. 7.20 (one kilo)' });
    card.unit('l');
    expect(card.view().rate).toMatchObject({ label: 'Price per litre (€)', placeholder: 'e.g. 6.00 (one litre)' });
    card.unit('pcs');
    expect(card.view().rate).toMatchObject({ label: 'Price per piece (€)', placeholder: 'e.g. 0.035 (one piece)' });
    card.unit('');
    expect(card.view().rate).toMatchObject({ label: 'Price (€)', placeholder: '' });
  });

  test('C59: a NEW packaging item starts on «by piece»; a new ingredient on None', () => {
    expect(openCard({ kind: 'packaging' }).price.unit).toBe('pcs');
    expect(openCard().price.unit).toBe('');
    // an existing packaging item keeps its own unit
    expect(openCard({ item: { ...BASE, kind: 'packaging', priceUnit: 'kg', pricePerUnit: 1 }, kind: 'packaging' }).price.unit).toBe('kg');
  });

  test('⚠️ UNTOUCHED MEANS UNCHANGED: the price stays clean while the format and the weight move, and every price box dirties it', () => {
    const card = openCard({ item: PACK_CASE });
    expect(isPriceDirty(card.price, PACK_CASE)).toBe(false);
    card.count('5');
    card.weight('4');
    card.single();
    expect(isPriceDirty(card.price, PACK_CASE), 'moving the format or the weight never re-prices').toBe(false);
    for (const touch of [(c: ReturnType<typeof openCard>) => c.box('1'), (c: ReturnType<typeof openCard>) => c.rate('1'),
      (c: ReturnType<typeof openCard>) => c.unit('kg'), (c: ReturnType<typeof openCard>) => c.pieceKg('1'),
      (c: ReturnType<typeof openCard>) => c.recompute()]) {
      const fresh = openCard({ item: PACK_CASE });
      touch(fresh);
      expect(isPriceDirty(fresh.price, PACK_CASE)).toBe(true);
    }
    // VAT is independent of the price: moving it must not make the price dirty
    const vat = openCard({ item: PACK_CASE });
    vat.vat('22');
    expect(isPriceDirty(vat.price, PACK_CASE)).toBe(false);
    // and a new item is always dirty
    expect(isPriceDirty(openCard().price, null)).toBe(true);
  });

  test('a VAT-only change keeps the price verbatim and writes the new rate', () => {
    const card = openCard({ item: PACK_CASE });
    card.vat('10');
    const { payload, record } = card.saved();
    expect(payload.vatRate).toBe(10);
    for (const key of PRICE_KEYS) expect(payload[key] ?? null, key).toBe(PACK_CASE[key] ?? null);
    expect(record).toBeNull();
  });

  test('«— not stated» clears the VAT (null), 0 is a real answer', () => {
    const card = openCard({ item: PACK_CASE });
    card.vat('');
    expect(card.saved().payload.vatRate).toBeNull();
    const zero = openCard({ item: { ...PACK_CASE, vatRate: undefined }, country: 'GB' });
    zero.vat('0');
    expect(zero.saved().payload.vatRate).toBe(0);
  });

  test('«Recalculate» only sets the flag and lets the box speak', () => {
    const card = openCard({ item: { ...PACK_CASE, weight: '3kg' } });
    expect(card.price.recomputed).toBe(false);
    card.recompute();
    expect(card.price.recomputed).toBe(true);
    expect(card.price.priceTyped).toBe(false);
    expect(card.price.boxTyped).toBe(false);
    expect(card.view().box.value).toBe('24');
  });

  test('the live summary names the rate and what ONE item costs', () => {
    const card = openCard({ item: PACK_CASE });
    // an untouched case is shown as it is stored: priced by the kilo, with what one busta costs beside it
    expect(card.view().summary.main).toBe('= €2.00 / kg  ·  €5.00 per busta');
    // the same case once it is a per-item price: «each», what one busta costs, and the kilo
    const perItem = openCard({ item: CARTON });
    expect(perItem.view().summary.main).toBe('= €5.00 each  ·  €5.00 per busta  ·  €10.00 / kg');
    expect(card.view().summary.muted).toBe(false);
    // a typed rate per kilo: the rate alone
    expect(openCard({ item: TYPED_KG }).view().summary.main).toBe('€7.20 / kg');
  });

  test('the summary of an unpriced item is muted and says why; a per-piece price with no piece weight says what is missing', () => {
    const empty = openCard({ item: { ...BASE, unit: 'kg', weight: '' } });
    expect(empty.view().summary).toEqual({ main: 'No price yet', note: '', muted: true });
    expect(empty.view().vatLine).toBe('');
    const piece = openCard({ item: { ...BASE, unit: 'pz', weight: '', priceUnit: 'pcs', pricePerUnit: 0.3 } });
    expect(piece.view().summary.main).toBe('€0.30 / each');
    expect(piece.view().summary.note).toBe('Add the weight of one piece to use this in a recipe');
  });

  test('the price-again note: a price that existed and has no number under the new format', () => {
    const card = openCard({ item: PACK_CASE });
    expect(card.view().priceAgainNote).toBeNull();
    card.box('20');
    card.box('');
    expect(card.view().priceAgainNote).toBe('This format has no price yet: type the price');
    // a NEW item has no price to lose
    const fresh = openCard();
    fresh.box('');
    expect(fresh.view().priceAgainNote).toBeNull();
  });

  test('the keeps-price note has two wordings: with «Recalculate» on offer, and without', () => {
    const card = openCard({ item: { ...PACK_CASE, weight: '3kg' } });
    expect(card.view().keepsNote).toBe('The saved price stays €2.00 / kg until you write the new price or tap Recalculate.');
    card.recompute();
    expect(card.view().keepsNote, 'recomputing fills the box: nothing left to keep').toBeNull();
    expect(openCard({ item: PACK_CASE }).view().keepsNote, 'the box shows the price: nothing to say').toBeNull();
  });

  test('a case with a stale rate is not a case: the card reopens in the typed-rate terms', () => {
    // an old phone saved a new rate over the case of 4 at 20: 20 / 4 = 5 is not the stored 6
    const stale: ItemLike = { ...BASE, unit: 'sacco', weight: '', priceUnit: 'pcs', pricePerUnit: 6, casePrice: 20, caseCount: 4, caseItemUnit: 'pcs' };
    const card = openCard({ item: stale });
    expect(card.isCarton()).toBe(false);
    expect(card.view().typedForm).toBe(true);
    expect(card.view().rate.value).toBe('6');
  });

  test('a weight-priced case with an unreadable weight is refused on the weight box (C70), an emptied box needs nothing', () => {
    const card = openCard({ item: { ...PACK_CASE, weight: '' } });
    card.box('22');
    expect(priceRefusal(card.price, card.ctx())).toBe('weight');
    card.box('');
    expect(priceRefusal(card.price, card.ctx())).toBeNull();
  });

  test('the price view is a function of the language it is handed: Italian words, the venue\'s money', () => {
    const card = openCard({ item: CARTON, t: tIt, locale: 'it-IT' });
    const view = card.view();
    expect(view.box.label).toBe('Prezzo cartone (€)');
    expect(card.labels()).toEqual(['a cartone', 'a confezione', 'al kg']);
    expect(view.exVatNote).toBe('I prezzi sono al netto dell’IVA.');
    expect(view.vat.label).toBe('IVA');
    expect(view.unit.options.map(one => one.label)).toEqual(['Nessuno', 'al kg', 'al litro', 'al pezzo']);
  });

  test('every phrase the model asks for exists in both languages, and the shared model\'s own keys are all mapped', () => {
    const all = new Set<MessageKey>();
    const spy: T = (key, params) => { all.add(key); return tEn(key, params); };
    for (const item of [null, TYPED_KG, SACK, CARTON, PACK_CASE, { ...PACK_CASE, weight: '' }, { ...PACK_CASE, weight: '3kg' }]) {
      const card = openCard({ item, t: spy });
      card.view();
      card.carton();
      card.count('5');
      card.view();
      card.recompute();
      const segment = card.view().segments.at(-1);
      if (segment) card.tap(segment.label);
      card.view();
    }
    sharedTranslate(spy)('price.byWeight');
    sharedTranslate(spy)('price.perEach', { rate: '1' });
    for (const key of all) {
      expect(typeof en[key], key).toMatch(/string|object/);
      expect(italian[key], key).toBeDefined();
    }
    expect(() => sharedTranslate(tEn)('price.somethingNew')).toThrow();
    for (const country of ['GB', 'IT', 'XX', null]) {
      for (const choice of vatRatesFor(country)) expect(en[choice.key as MessageKey], choice.key).toBeDefined();
    }
  });
});

describe('ingredient-form-guards: the VAT menu (C75) and the money typing (C61)', () => {
  test('the menu is «— not stated», then the rates of the venue\'s COUNTRY, whatever the screen\'s language', () => {
    const italy = openCard({ item: TYPED_KG, country: 'IT' }).view().vat;
    expect(italy.options.map(one => one.value)).toEqual(['', '22', '10', '4']);
    expect(italy.options[0]?.label).toBe('— not stated');
    expect(italy.options[1]?.label).toBe('22% — standard');
    const unstated = { ...TYPED_KG, vatRate: null };
    const britain = openCard({ item: unstated, country: 'GB' }).view().vat;
    expect(britain.options.map(one => one.value)).toEqual(['', '20', '5', '0']);
    // an unknown country falls to the UK's list
    expect(openCard({ item: unstated, country: 'XX' }).view().vat.options.map(one => one.value)).toEqual(['', '20', '5', '0']);
    // the Italian screen words the same rates in Italian
    expect(openCard({ item: unstated, country: 'IT', t: tIt }).view().vat.options[1]?.label).toBe('22% — ordinaria');
  });

  test('a stored rate that is not in the country\'s list is ADDED and stays selected: opening never erases it', () => {
    const card = openCard({ item: { ...TYPED_KG, vatRate: 21 }, country: 'IT' });
    expect(card.view().vat.options.map(one => one.value)).toEqual(['', '22', '10', '4', '21']);
    expect(card.view().vat.options.at(-1)?.label).toBe('21%');
    expect(card.view().vat.value).toBe('21');
    // (the rules close the stored rate to 0, 4, 5, 10, 20, 22: price-model turns any other into «not stated», as the original does)
    expect(card.saved().payload.vatRate).toBeNull();
  });

  test('the selected rate is the stored one; none stored is «not stated»', () => {
    expect(openCard({ item: TYPED_KG }).view().vat.value).toBe('4');
    expect(openCard({ item: { ...TYPED_KG, vatRate: null } }).view().vat.value).toBe('');
    expect(openCard().view().vat.value).toBe('');
  });

  test('the VAT line follows the order unit, package, count and weight as they stand in the open card', () => {
    const card = openCard({ item: PIECES_COUNTED });
    expect(card.view().vatLine).toBe('€20.00 without VAT, €24.40 with VAT at 22%');
    // ordered by the piece instead: the count of the format moves what one ordered unit is
    expect(card.ctx().order).toMatchObject({ unit: 'cartone', packUnit: 'pezzo', packCount: 50 });
    card.count('40');
    expect(card.ctx().order).toMatchObject({ packCount: 40 });
  });

  test('C61: the boxes show the figures in the venue\'s layout and the typed text is read with either mark', () => {
    const italy = moneyOf('€', moneyLayoutOf({ country: 'IT' }));
    const card = openCard({ item: TYPED_PIECE, money: italy });
    expect(card.price.rate).toBe('0,3');
    expect(card.price.pieceKg).toBe('0,05');
    card.rate('1,5');
    expect(readPrice(card.price, card.ctx())).toMatchObject({ pricePerUnit: '1.5' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// tests/legacy-card.test.mjs — only the choice of the card
// ═══════════════════════════════════════════════════════════════════════════════

describe('legacy-card: which card opens', () => {
  test('the old price shapes without a packCount are the card of before for a price writer', () => {
    for (const item of [LEGACY_KG, LEGACY_G, PIECES]) expect(usesLegacyCard(item), String(item.caseItemUnit)).toBe(true);
    expect(usesLegacyCard({ ...BASE, unit: 'kg', weight: '6x1kg', priceUnit: 'kg', pricePerUnit: 2 }), 'a rate on a weight that does not read').toBe(true);
  });

  test('the same documents WITH a packCount, and the plain shapes, are the new card', () => {
    for (const item of [LEGACY_KG_COUNTED, LEGACY_G_COUNTED, PIECES_COUNTED, PACK_CASE, TYPED_KG, TYPED_SACK, TYPED_PIECE, CUSTOM, BUSTA_UNIT, SACK, CARTON]) {
      expect(usesLegacyCard(item), `${String(item.unit)}/${String(item.caseItemUnit)}`).toBe(false);
    }
  });

  test('an employee always gets the new card: the same legacy documents open as ordinary product data, with no price read', () => {
    for (const item of [LEGACY_KG, LEGACY_G, PIECES]) {
      const card = openCard({ item, mayPrice: false });
      expect(card.price, 'no price state for an employee').toBeNull();
      const { payload, patch } = card.saved();
      expect(patch).toBeNull();
      for (const key of PRICE_FIELDS) expect(key in payload, key).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// New in Mise 2: the state's own rules
// ═══════════════════════════════════════════════════════════════════════════════

describe('the working copy of the price', () => {
  test('a card opens clean: the leave question has nothing to ask, the state is not dirty', () => {
    for (const item of [null, ...ALL_STORED]) {
      const card = openCard({ item });
      expect(isPriceEdited(card.price, card.ctx()), String(item?.unit)).toBe(false);
    }
  });

  test('typing in any box, picking a unit, a VAT rate or a segment is an edit for the leave question', () => {
    const edits: Array<(card: ReturnType<typeof openCard>) => void> = [
      card => card.box('1'), card => card.rate('1'), card => card.unit('l'), card => card.pieceKg('0.1'), card => card.vat('10'),
      card => card.tap('per kg'),
    ];
    for (const edit of edits) {
      const card = openCard({ item: SACK });
      edit(card);
      expect(isPriceEdited(card.price, card.ctx())).toBe(true);
    }
  });

  test('a tap on the segment already pressed, or on one the form does not offer, changes nothing', () => {
    const card = openCard({ item: SACK });
    const before = card.price;
    card.tap('per pack');
    expect(card.price).toBe(before);
    expect(tapBasis(before, card.ctx(), 'case')).toBe(before);
  });

  test('followFormat gives back the SAME state when nothing about the box changes', () => {
    const card = openCard({ item: SACK });
    expect(followFormat(card.price, card.ctx())).toBe(card.price);
  });

  test('keepsMoney: a Cartone turned into a Singola, and a corrected weight on a tracking piece weight, keep the money', () => {
    const a = openCard({ item: PACK_CASE });
    expect(keepsMoney(a.price, a.ctx())).toBe(false);
    a.single();
    expect(keepsMoney(a.price, a.ctx())).toBe(true);
    const b = openCard({ item: { ...BASE, unit: '', weight: '60g', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 } });
    b.weight('70');
    expect(keepsMoney(b.price, b.ctx())).toBe(true);
    b.box('0.3');
    expect(keepsMoney(b.price, b.ctx()), 'a typed price is the person\'s').toBe(false);
  });

  test('readPrice always carries the priceBasis, and the piece weight that followed a corrected weight', () => {
    const card = openCard({ item: { ...BASE, unit: '', weight: '60g', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 } });
    expect(readPrice(card.price, card.ctx())).toMatchObject({ priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06, priceBasis: null });
    card.weight('70');
    expect(readPrice(card.price, card.ctx())).toMatchObject({ unitWeightKg: 0.07 });
  });

  test('a new item\'s weight and a typed rate: the loose item prices by the rate and the unit', () => {
    const card = openCard();
    card.unit('kg');
    card.rate('7,20');
    expect(readPrice(card.price, card.ctx())).toMatchObject({ priceUnit: 'kg', pricePerUnit: '7.20' });
    expect(pricePatch(readPrice(card.price, card.ctx()), NOW, '').pricePerUnit).toBe(7.2);
  });

  test('the price refusal is none for a clean card and for text that reads', () => {
    expect(priceRefusal(openCard({ item: SACK }).price, openCard({ item: SACK }).ctx())).toBeNull();
    const card = openCard({ item: SACK });
    card.box('12,5');
    expect(priceRefusal(card.price, card.ctx())).toBeNull();
    card.box('1.234,5');
    expect(priceRefusal(card.price, card.ctx())).toBe('box');
  });
});

describe('what the card does with the state (the card model\'s side of the price)', () => {
  test('the working copy opened for a price writer shows the case\'s count, the same item for an employee does not', () => {
    const item = { ...BASE, unit: 'cartone', packUnit: 'busta', weight: '2.5kg', priceUnit: 'pcs', pricePerUnit: 5, casePrice: 20, caseCount: 4, caseItemUnit: 'pcs', unitWeightKg: 2.5 };
    const writer = workingFrom(item, { supplierIds: SUPPLIERS, preset: null, mayPrice: true, lang: 'it' });
    const employee = workingFrom(item, { supplierIds: SUPPLIERS, preset: null, mayPrice: false, lang: 'it' });
    expect(writer).toMatchObject({ format: 'carton', count: '4' });
    expect(employee).toMatchObject({ format: 'carton', count: '' });
  });

  test('formState of a card with a non-whole count is NaN, never empty (so it is refused, not ignored)', () => {
    const working = { ...workingFrom(null, { supplierIds: SUPPLIERS, preset: null }), format: 'carton' as const, count: '2.5' };
    expect(Number.isNaN(formState(working).count)).toBe(true);
  });
});
