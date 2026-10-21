// Unit tests for «Confezione: Singola | Cartone» (P15), run against BOTH implementations: the TypeScript port in
// shared/ and js/pack-format.js, which the live app uses today. Ported from tests/pack-format.test.mjs.
//
// pack-format.ts is an ADAPTED port, so parity.spec.ts does not pair it: `formatSummary` and `formatChanged` take the
// translate function and the locale tag as arguments (the original reads the interface dictionary and the language of
// the page), so their arity differs by design. Here each of them is run for the original as it is, after
// `setLanguage(...)`, and for the port with the original's own `t` and `localeTag()` handed in — and both must give
// the same text. (The pure functions are also compared input by input in odd-inputs.spec.ts.)
//
// The six tests of the «existing data» table that replay the card's untouched save as
// pricePatch(storedPriceInput(item)) need the WRITING half of price-model: each implementation is run with its
// OWN price-model (the port's with the port's pack-format, js/ with js/) — `pm` below.
// Everything of the original is ported, under its own name.

import { describe, expect, test } from 'vitest';
import * as ported from './pack-format';
import * as priceModel from './price-model';
import * as legacyJs from '../../js/pack-format.js';
import * as legacyPriceModelJs from '../../js/price-model.js';
import { localeTag, setLanguage, t } from '../../js/i18n.js';
import type { PackFormat } from './pack-format';

const legacy = legacyJs as unknown as typeof ported;
const legacyPriceModel = legacyPriceModelJs as unknown as typeof priceModel;

// The two adapted functions, behind one signature: the original reads the dictionary itself, the port is handed it.
type Fmt = Partial<PackFormat> | null;
interface Impl {
  readonly m: typeof ported;
  readonly pm: typeof priceModel;
  summary(fmt: Fmt, weight: unknown, lang: unknown): string;
  changed(price: unknown, fmt: PackFormat, weight: unknown): ported.FormatChange | null;
}
const IMPLS: ReadonlyArray<readonly [string, Impl]> = [
  ['shared/ (TypeScript)', {
    m: ported,
    pm: priceModel,
    summary: (fmt, weight, lang) => ported.formatSummary(fmt, weight, lang, t, localeTag()),
    changed: (price, fmt, weight) => ported.formatChanged(price, fmt, weight, localeTag()),
  }],
  ['js/ (current app)', {
    m: legacy,
    pm: legacyPriceModel,
    summary: (fmt, weight, lang) => (legacyJs.formatSummary as (...a: unknown[]) => string)(fmt, weight, lang),
    changed: (price, fmt, weight) => (legacyJs.formatChanged as (...a: unknown[]) => ported.FormatChange | null)(price, fmt, weight),
  }],
];

// ── The stored shapes of the brief's «existing data» table ───────────────────
const PACK_CASE = {                          // unit cartone + packUnit busta + a 'pack' case
  unit: 'cartone', packUnit: 'busta', weight: '2.5kg',
  priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack',
  vatRate: 4, priceUpdatedAt: '2026-09-30T08:00:00.000Z',
};
const LEGACY_KG_CASE = {                     // 4 × 2.5 kg typed with an explicit size
  unit: 'cartone', weight: '2.5kg',
  priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg', vatRate: null,
};
const LEGACY_G_CASE = {                      // 4 × 500 g, grams as typed
  unit: 'kg', weight: '500g',
  priceUnit: 'kg', pricePerUnit: 10, casePrice: 20, caseCount: 4, caseItemSize: 500, caseItemUnit: 'g', vatRate: 10,
};
const PIECES_CASE = {                        // 50 pieces, a rate per piece
  unit: 'cartone', packUnit: 'pezzo', weight: '',
  priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs', unitWeightKg: 0.06, vatRate: 22,
};
const TYPED_KG = { unit: 'kg', weight: '', priceUnit: 'kg', pricePerUnit: 7.2, vatRate: 4 };
const TYPED_SACK = { unit: 'sacco', weight: '25kg', priceUnit: 'kg', pricePerUnit: 0.8, vatRate: null };
const TYPED_PIECE = { unit: 'pz', weight: '', priceUnit: 'pcs', pricePerUnit: 0.3, unitWeightKg: 0.05, vatRate: 22 };
const CUSTOM_UNIT = { unit: 'vassoio', weight: '', priceUnit: 'pcs', pricePerUnit: 2.5 };

const AT = '2026-10-01T10:00:00.000Z';
const STORED_KEYS = ['priceUnit', 'pricePerUnit', 'casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit', 'unitWeightKg'];
type Stored = Record<string, unknown> & { weight?: string; vatRate?: unknown };
const at = (object: unknown, key: string): unknown => (object as Record<string, unknown>)[key];

describe.each(IMPLS)('%s', (_name, impl) => {
  const m = impl.m;
  const pm = impl.pm;

  // What the card's untouched read() hands pricePatch, replayed.
  const untouchedPatch = (item: Stored, weight: unknown = item.weight): priceModel.PricePatch =>
    pm.pricePatch(pm.storedPriceInput(item, item.vatRate ?? ''), AT, weight);
  function assertVerbatim(item: Stored, weightNow: unknown = item.weight): void {
    const patch = untouchedPatch(item, weightNow);
    for (const key of STORED_KEYS) {
      expect(at(patch, key) ?? null, `${key} must come back as stored`).toBe(at(item, key) ?? null);
    }
    expect(patch.vatRate, 'vat').toBe(item.vatRate ?? null);
    expect(pm.priceChanged(item, patch), 'no history entry for an untouched save').toBe(false);
  }

  // ── formatOf: the four rules ───────────────────────────────────────────────

  test('rule 1: a packCount of a whole number ≥ 1 is a carton with that count', () => {
    expect(m.formatOf({ unit: 'cartone', packUnit: 'busta', packCount: 4 })).toStrictEqual({ kind: 'carton', count: 4, inner: 'busta' });
    expect(m.formatOf({ unit: 'sacco', packCount: 1 })).toStrictEqual({ kind: 'carton', count: 1, inner: '' });
    for (const bad of [0, -2, 2.5, '4', null, undefined, NaN, 10001]) {
      expect(m.formatOf({ packCount: bad }).kind, `packCount ${String(bad)} is not a carton`).toBe('single');
    }
  });

  test('rule 2: a unit choice with a carton word is a carton — count empty for an employee, from the case for a price reader', () => {
    const employee = m.formatOf({ unit: 'cartone', packUnit: 'busta' }, null);
    expect(employee).toStrictEqual({ kind: 'carton', count: null, inner: 'busta' });
    expect(m.formatOf(PACK_CASE, PACK_CASE)).toStrictEqual({ kind: 'carton', count: 4, inner: 'busta' });
    expect(m.formatOf(PACK_CASE, null), 'no price access, no count').toStrictEqual({ kind: 'carton', count: null, inner: 'busta' });
  });

  test('rule 3: a price reader whose stored case holds more than one is a carton, whatever the order unit says', () => {
    expect(m.formatOf(LEGACY_KG_CASE, LEGACY_KG_CASE)).toStrictEqual({ kind: 'carton', count: 4, inner: '' });
    expect(m.formatOf(LEGACY_G_CASE, LEGACY_G_CASE)).toStrictEqual({ kind: 'carton', count: 4, inner: '' });
    expect(m.formatOf(PIECES_CASE, PIECES_CASE)).toStrictEqual({ kind: 'carton', count: 50, inner: 'pezzo' });
    // the same legacy document seen by somebody who cannot read prices is a single: nothing says otherwise
    expect(m.formatOf(LEGACY_KG_CASE, null).kind).toBe('single');
  });

  test('rule 4: everything else is a single — a missing field is never read as a carton', () => {
    for (const item of [TYPED_KG, TYPED_SACK, TYPED_PIECE, CUSTOM_UNIT, {}, null, undefined]) {
      expect(m.formatOf(item, item).kind, JSON.stringify(item)).toBe('single');
    }
    // «unit cartone» with no package word has no unit CHOICE: for an employee it stays a single
    expect(m.formatOf({ unit: 'cartone' }, null).kind).toBe('single');
    // a stale case (a rate typed over it) does not stand, so it does not make a carton either
    expect(m.formatOf({ ...PACK_CASE, unit: 'kg', packUnit: '', pricePerUnit: 3 }, { ...PACK_CASE, pricePerUnit: 3 }).kind).toBe('single');
    // a case of ONE is a single
    const one = { priceUnit: 'kg', pricePerUnit: 2, casePrice: 5, caseCount: 1, caseItemSize: 2.5, caseItemUnit: 'pack' };
    expect(m.formatOf({ unit: 'kg', ...one }, one).kind).toBe('single');
  });

  test('carton words are the carton ones — never scatola, box, confezione or pack', () => {
    for (const w of ['cartone', 'Cartoni', 'cassa', 'collo', 'case', 'CARTON', 'crate', ' cartone ', 'case.']) expect(m.isCartonWord(w), w).toBe(true);
    for (const w of ['scatola', 'box', 'confezione', 'pack', 'busta', 'kg', '', null, undefined]) expect(m.isCartonWord(w), String(w)).toBe(false);
  });

  // ── formatPatch: {} unless a person moved it ───────────────────────────────

  const beforeOf = (item: { unit?: string; packUnit?: string }, price: unknown = item) =>
    ({ ...m.formatOf(item, price), unit: item.unit || '', packUnit: item.packUnit || '' });
  const formOf = (before: PackFormat, over: Partial<ported.FormatForm> = {}): ported.FormatForm =>
    ({ kind: before.kind, count: before.count, inner: before.inner, cartonWord: 'cartone', ...over });

  test('untouched writes nothing, for every row of the existing-data table', () => {
    for (const item of [PACK_CASE, LEGACY_KG_CASE, LEGACY_G_CASE, PIECES_CASE, TYPED_KG, TYPED_SACK, TYPED_PIECE, CUSTOM_UNIT]) {
      const before = beforeOf(item);
      expect(m.formatPatch(before, formOf(before)), JSON.stringify(item)).toStrictEqual({});
      expect(m.formatTouched(before, formOf(before))).toBe(false);
    }
    // an employee's legacy carton: the count is empty and stays unwritten
    const employee = beforeOf({ unit: 'cartone', packUnit: 'busta' }, null);
    expect(m.formatPatch(employee, formOf(employee))).toStrictEqual({});
    // an employee's «cartone» with no package word is a single: its unit is kept, nothing written
    const bare = beforeOf({ unit: 'cartone' }, null);
    expect(m.formatPatch(bare, formOf(bare))).toStrictEqual({});
  });

  test('switching to Cartone and back again changes nothing', () => {
    const before = beforeOf(TYPED_SACK);
    const there = formOf(before, { kind: 'carton', count: 4, inner: 'busta' });
    expect(m.formatTouched(before, there)).toBe(true);
    expect(m.formatPatch(before, formOf(before, { kind: 'single' }))).toStrictEqual({});
  });

  test('Cartone writes packCount, the inner word and a carton unit — keeping a carton word already stored', () => {
    const fresh: ported.FormatBefore = { kind: 'single', count: null, inner: '', unit: '', packUnit: '' };
    expect(m.formatPatch(fresh, { kind: 'carton', count: 4, inner: 'busta', cartonWord: 'cartone' }))
      .toStrictEqual({ packCount: 4, packUnit: 'busta', unit: 'cartone' });
    expect(m.formatPatch(fresh, { kind: 'carton', count: 6, inner: 'bottle', cartonWord: 'case' }))
      .toStrictEqual({ packCount: 6, packUnit: 'bottle', unit: 'case' });
    // «cassa» is already a carton word: it stays, it is not overwritten by «cartone»
    const cassa: ported.FormatBefore = { kind: 'single', count: null, inner: '', unit: 'cassa', packUnit: '' };
    expect(m.formatPatch(cassa, { kind: 'carton', count: 2, inner: 'busta', cartonWord: 'cartone' }).unit).toBe('cassa');
    // any other stored unit (sacco, kg) is replaced: that is what a person asked for by picking Cartone
    const sack: ported.FormatBefore = { kind: 'single', count: null, inner: '', unit: 'sacco', packUnit: '' };
    expect(m.formatPatch(sack, { kind: 'carton', count: 2, inner: 'busta', cartonWord: 'cartone' }).unit).toBe('cartone');
  });

  test('changing only the count or only the inner word of an opened carton is a touch', () => {
    const before = beforeOf(PACK_CASE);
    expect(m.formatPatch(before, formOf(before, { count: 6 }))).toStrictEqual({ packCount: 6, packUnit: 'busta', unit: 'cartone' });
    expect(m.formatPatch(before, formOf(before, { inner: 'sacco' }))).toStrictEqual({ packCount: 4, packUnit: 'sacco', unit: 'cartone' });
    // an employee typing a count into a legacy carton
    const employee = beforeOf({ unit: 'cartone', packUnit: 'busta' }, null);
    expect(m.formatPatch(employee, formOf(employee, { count: 12 }))).toStrictEqual({ packCount: 12, packUnit: 'busta', unit: 'cartone' });
  });

  test('a packUnit key is written only when there is a word to say or one to clear', () => {
    const none: ported.FormatBefore = { kind: 'single', count: null, inner: '', unit: '', packUnit: '' };
    expect('packUnit' in m.formatPatch(none, { kind: 'carton', count: 3, inner: '', cartonWord: 'cartone' })).toBe(false);
    const had: ported.FormatBefore = { kind: 'single', count: null, inner: 'busta', unit: '', packUnit: 'busta' };
    expect(m.formatPatch(had, { kind: 'carton', count: 3, inner: '', cartonWord: 'cartone' }).packUnit).toBe('');
  });

  test('Singola after Cartone: packCount null, the carton word becomes the PACKAGE word (one busta), any other unit stays', () => {
    const stored = { unit: 'cartone', packUnit: 'busta', packCount: 4 };
    const before = beforeOf(stored, null);
    // ⚠️ NOT '': an empty unit reads «the whole case» to the readers, so a bag was priced as the carton (review defect 2b)
    expect(m.formatPatch(before, formOf(before, { kind: 'single' }))).toStrictEqual({ packCount: null, unit: 'busta' });
    const keeps = beforeOf({ unit: 'sacco', packUnit: 'busta', packCount: 2 } as { unit: string; packUnit: string }, null);
    expect(m.formatPatch(keeps, formOf(keeps, { kind: 'single' }))).toStrictEqual({ packCount: null, unit: 'sacco' });
    // a carton that was only inferred from a stored case (no packCount): still null, harmless on a merge
    const inferred = beforeOf(LEGACY_KG_CASE);
    expect(m.formatPatch(inferred, formOf(inferred, { kind: 'single' }))).toStrictEqual({ packCount: null, unit: '' });
  });

  test('a count that is not a whole number is a touch that parseCount refuses', () => {
    const employee = beforeOf({ unit: 'cartone', packUnit: 'busta' }, null);
    expect(m.formatTouched(employee, formOf(employee, { count: NaN })), 'typed rubbish is not «still empty»').toBe(true);
    for (const bad of ['', ' ', '2.5', '-1', '0', '1e3', 'abc', '10001', null, undefined]) expect(m.parseCount(bad), String(bad)).toBeNull();
    for (const [raw, n] of [['4', 4], [' 12 ', 12], ['10000', 10000], [7, 7]] as const) expect(m.parseCount(raw)).toBe(n);
  });

  test('a new loose item priced by kilo, litre or piece takes that order unit; anything else none', () => {
    const base = { kind: 'single', weightReadable: false };
    expect(m.looseUnit({ ...base, priceUnit: 'kg', lang: 'it' })).toBe('kg');
    expect(m.looseUnit({ ...base, priceUnit: 'l', lang: 'it' })).toBe('l');
    expect(m.looseUnit({ ...base, priceUnit: 'pcs', lang: 'it' })).toBe('pz');
    expect(m.looseUnit({ ...base, priceUnit: 'pcs', lang: 'en' })).toBe('pcs');
    expect(m.looseUnit({ ...base, priceUnit: null, lang: 'it' })).toBe('');
    expect(m.looseUnit({ ...base, kind: 'carton', priceUnit: 'kg', lang: 'it' })).toBe('');
    expect(m.looseUnit({ ...base, weightReadable: true, priceUnit: 'kg', lang: 'it' })).toBe('');
  });

  // ── The existing-data table: an untouched save leaves the price exactly as stored ──

  test('table row: unit kg / pz / sacco / busta / custom, no packCount → a single, price verbatim', () => {
    for (const item of [TYPED_KG, TYPED_SACK, TYPED_PIECE, CUSTOM_UNIT]) assertVerbatim(item);
    expect(m.formatOf({ unit: 'busta', weight: '2.5kg' }, null).kind).toBe('single');
  });

  test('table row: unit cartone + packUnit busta + a pack case → Cartone, count from the case, price verbatim', () => {
    expect(m.formatOf(PACK_CASE, PACK_CASE).count).toBe(4);
    assertVerbatim(PACK_CASE);
  });

  test('a pack case writes back its OWN stored size even when the weight has since been re-weighed', () => {
    // an employee changed 2.5kg to 3kg; the manager opens the card and fixes a typo: the price must not move
    assertVerbatim(PACK_CASE, '3kg');
    const patch = untouchedPatch(PACK_CASE, '3kg');
    expect(patch.caseItemSize).toBe(2.5);
    expect(patch.pricePerUnit).toBe(2);
    // and only a person re-pricing it (no packBasis) copies the new weight
    const retyped = pm.pricePatch({ priceUnit: 'case', casePrice: 20, caseCount: 4, caseItemUnit: 'pack' }, AT, '3kg');
    expect(retyped.caseItemSize).toBe(3);
    expect(retyped.pricePerUnit).toBe(1.666667);
  });

  test('table row: a legacy explicit-size case (4 × 2.5 kg, 4 × 500 g) → Cartone, price verbatim, storedCaseOf stays valid', () => {
    for (const item of [LEGACY_KG_CASE, LEGACY_G_CASE]) {
      expect(m.formatOf(item, item).count).toBe(4);
      assertVerbatim(item);
      const patch = untouchedPatch(item);
      expect(pm.storedCaseOf(patch), 'the written case is the stored case').toStrictEqual(pm.storedCaseOf(item));
    }
    // the legacy case keeps its explicit unit — it is never rewritten as a 'pack' case
    expect(untouchedPatch(LEGACY_G_CASE).caseItemUnit).toBe('g');
    expect(untouchedPatch(LEGACY_G_CASE).caseItemSize).toBe(500);
  });

  test('table row: a case of pieces (50 pz) → Cartone 50 × pezzo, price verbatim, the piece weight kept', () => {
    expect(m.formatOf(PIECES_CASE, PIECES_CASE)).toStrictEqual({ kind: 'carton', count: 50, inner: 'pezzo' });
    assertVerbatim(PIECES_CASE);
    expect(untouchedPatch(PIECES_CASE).unitWeightKg).toBe(0.06);
  });

  test('table row: unit cartone with no package word, seen by an employee → a single, unit kept, no format keys', () => {
    const stored = { unit: 'cartone', weight: '10kg' };
    const before = beforeOf(stored, null);
    expect(before.kind).toBe('single');
    expect(m.formatPatch(before, formOf(before))).toStrictEqual({});
  });

  test('an untouched save never touches an item with no price at all', () => {
    const none = { unit: 'sacco', weight: '25kg' };
    const patch = untouchedPatch(none);
    expect(patch.pricePerUnit).toBe(null);
    expect(patch.priceUnit).toBe(null);
    // (priceBasis is the ingredient card's own: absent unless the card names it, so no other writer resets it)
    for (const key of pm.PRICE_FIELDS.filter(k => k !== 'priceBasis')) {
      expect(key in patch, `${key} is written as null so a merge cannot keep an old value`).toBe(true);
    }
  });

  // ── The summary line ───────────────────────────────────────────────────────

  test('«Case of 4 bags of 2.5 kg (10 kg)» in English', () => {
    setLanguage('en');
    expect(impl.summary({ kind: 'carton', count: 4, inner: 'bag' }, '2.5kg', 'en')).toBe('Case of 4 bags of 2.5 kg (10 kg)');
    expect(impl.summary({ kind: 'carton', count: 1, inner: 'bag' }, '2.5kg', 'en')).toBe('Case of 1 bag of 2.5 kg (2.5 kg)');
  });

  test('«Cartone da 4 buste da 2,5 kg (10 kg)» in Italian — decimal comma, plural of the venue word', () => {
    setLanguage('it');
    try {
      expect(impl.summary({ kind: 'carton', count: 4, inner: 'busta' }, '2.5kg', 'it')).toBe('Cartone da 4 buste da 2,5 kg (10 kg)');
      expect(impl.summary({ kind: 'carton', count: 12, inner: 'bottiglia' }, '750 ml', 'it')).toBe('Cartone da 12 bottiglie da 750 ml (9 l)');
      expect(impl.summary({ kind: 'carton', count: 3, inner: 'sacco' }, '', 'it')).toBe('Cartone da 3 sacchi');
    } finally { setLanguage('en'); }
  });

  test('without a readable weight the summary names only the count; no carton, no count or no word is empty', () => {
    setLanguage('en');
    expect(impl.summary({ kind: 'carton', count: 4, inner: 'bag' }, '', 'en')).toBe('Case of 4 bags');
    expect(impl.summary({ kind: 'carton', count: 4, inner: 'bag' }, 'sack', 'en')).toBe('Case of 4 bags');
    expect(impl.summary({ kind: 'carton', count: 4, inner: 'bag' }, '6x1kg', 'en')).toBe('Case of 4 bags');
    expect(impl.summary({ kind: 'single', count: null, inner: 'bag' }, '2kg', 'en')).toBe('');
    expect(impl.summary({ kind: 'carton', count: null, inner: 'bag' }, '2kg', 'en')).toBe('');
    expect(impl.summary({ kind: 'carton', count: 4, inner: '' }, '2kg', 'en')).toBe('');
    expect(impl.summary(null, '2kg', 'en')).toBe('');
  });

  test('a custom package word is never pluralised: «4 × parola»', () => {
    setLanguage('en');
    expect(impl.summary({ kind: 'carton', count: 4, inner: 'sleeve' }, '2kg', 'en')).toBe('Case of 4 × sleeve of 2 kg (8 kg)');
    expect(impl.summary({ kind: 'carton', count: 4, inner: 'busta' }, '2kg', 'en'), 'an Italian word on an English venue is custom')
      .toBe('Case of 4 × busta of 2 kg (8 kg)');
  });

  test('grams and millilitres total in kilos and litres once they pass a thousand', () => {
    setLanguage('en');
    expect(impl.summary({ kind: 'carton', count: 4, inner: 'bag' }, '500g', 'en')).toBe('Case of 4 bags of 500 g (2 kg)');
    expect(impl.summary({ kind: 'carton', count: 2, inner: 'bag' }, '250g', 'en')).toBe('Case of 2 bags of 250 g (500 g)');
  });

  // ── «The format changed since the last price» ──────────────────────────────

  const carton = (count: number | null): PackFormat => ({ kind: 'carton', count, inner: 'busta' });

  test('no stored case, or a format that agrees, says nothing', () => {
    setLanguage('en');
    expect(impl.changed(null, carton(4), '2.5kg')).toBeNull();
    expect(impl.changed(TYPED_KG, carton(4), '2.5kg'), 'a typed rate has no format to disagree with').toBeNull();
    expect(impl.changed(PACK_CASE, carton(4), '2.5kg')).toBeNull();
    expect(impl.changed(PACK_CASE, carton(4), '2,5 kg'), 'the same weight written another way').toBeNull();
    expect(impl.changed(LEGACY_KG_CASE, carton(4), '2.5kg')).toBeNull();
    expect(impl.changed(LEGACY_G_CASE, carton(4), '500 g')).toBeNull();
    expect(impl.changed(LEGACY_G_CASE, carton(4), '0.5 kg'), '500 g and 0.5 kg are one weight').toBeNull();
    expect(impl.changed(PIECES_CASE, carton(50), '')).toBeNull();
  });

  test('a different count is said, with both formats (an employee changed it)', () => {
    setLanguage('en');
    expect(impl.changed(PACK_CASE, carton(5), '2.5kg')).toStrictEqual({ old: '4 × 2.5 kg', new: '5 × 2.5 kg' });
    expect(impl.changed(PIECES_CASE, carton(40), '')).toStrictEqual({ old: '50', new: '40' });
  });

  test('a different weight is said — for a pack case and for a legacy explicit-size case alike', () => {
    setLanguage('en');
    expect(impl.changed(PACK_CASE, carton(4), '3kg')).toStrictEqual({ old: '4 × 2.5 kg', new: '4 × 3 kg' });
    expect(impl.changed(LEGACY_KG_CASE, carton(4), '3kg')).toStrictEqual({ old: '4 × 2.5 kg', new: '4 × 3 kg' });
    expect(impl.changed(LEGACY_G_CASE, carton(4), '250 g')).toStrictEqual({ old: '4 × 0.5 kg', new: '4 × 0.25 kg' });
    // kilos against litres is a different unit of price
    expect(impl.changed(PACK_CASE, carton(4), '2.5 l')).toBeTruthy();
  });

  test('the numbers follow the language: a decimal comma in Italian', () => {
    setLanguage('it');
    try {
      expect(impl.changed(PACK_CASE, carton(4), '3kg')).toStrictEqual({ old: '4 × 2,5 kg', new: '4 × 3 kg' });
    } finally { setLanguage('en'); }
  });

  test('switching a carton to Singola is a count change (the case held 4)', () => {
    expect(impl.changed(PACK_CASE, { kind: 'single', count: null, inner: 'busta' }, '2.5kg')).toBeTruthy();
  });

  test('an unreadable weight or an empty count cannot be compared, so nothing is said', () => {
    expect(impl.changed(PACK_CASE, carton(4), 'sacco')).toBeNull();
    expect(impl.changed(PACK_CASE, carton(null), '2.5kg')).toBeNull();
  });

  test('a case of pieces is the NORMAL shape: it agrees while the count agrees, whatever the weight says', () => {
    expect(impl.changed(PIECES_CASE, carton(50), '60g')).toBeNull();
    expect(impl.changed(PIECES_CASE, carton(50), '0.06 kg')).toBeNull();
    expect(impl.changed(PIECES_CASE, carton(50), 'sacco'), 'an unreadable weight says nothing').toBeNull();
    // ⚠️ THE WEIGHT IS NOT COMPARED (3rd review): an old per-piece price keeps the PACK weight in `weight` and ONE
    // PIECE's in unitWeightKg, so a difference between them says nothing
    expect(impl.changed(PIECES_CASE, carton(50), '2kg')).toBeNull();
    expect(impl.changed(PIECES_CASE, carton(40), '60g')).toStrictEqual({ old: '50', new: '40' });
  });

  // ── 2nd deep review (1 Oct 2026) ───────────────────────────────────────────

  test('review 3b: a package word as the unit, with no packCount, is a Singola whatever the stored case says', () => {
    // what an employee leaves behind after turning a Cartone into a Singola, seen by a manager
    const left = { ...PACK_CASE, unit: 'busta', packUnit: 'busta' };
    expect(m.formatOf(left, left).kind).toBe('single');
    const pcs = { ...PIECES_CASE, unit: 'pezzo', packUnit: 'pezzo' };
    expect(m.formatOf(pcs, pcs).kind).toBe('single');
    // …but a carton word, a different word or an explicit packCount still read as before
    expect(m.formatOf({ ...left, unit: 'cartone' }, left).kind).toBe('carton');
    expect(m.formatOf({ ...left, unit: 'sacco' }, left).kind, 'a stored case of 4 under another word (rule 3)').toBe('carton');
    expect(m.formatOf({ ...left, packCount: 4 }, left).kind, 'rule 1 comes first').toBe('carton');
    expect(m.formatOf({ ...left, unit: ' Busta ', packUnit: 'busta' }, left).kind, 'matched ignoring case and spaces').toBe('single');
  });

  test('review 2: force writes the full carton format even when the format was not touched; never for a Singola', () => {
    const before = beforeOf(PACK_CASE);
    expect(m.formatPatch(before, formOf(before)), 'untouched, no price typed: nothing').toStrictEqual({});
    expect(m.formatPatch(before, formOf(before), { force: true })).toStrictEqual({ packCount: 4, packUnit: 'busta' });
    const single = beforeOf(TYPED_SACK);
    expect(m.formatPatch(single, formOf(single), { force: true }), 'a price typed under Singola adds no format keys').toStrictEqual({});
    // a carton word already stored is kept — by not being written at all
    const cassa = beforeOf({ ...PACK_CASE, unit: 'cassa' });
    expect('unit' in m.formatPatch(cassa, formOf(cassa), { force: true })).toBe(false);
  });

  // ── 4th deep review (2 Oct 2026) and the reduced scope ─────────────────────

  test('6th review: an employee’s Singola on a case ordered with NO unit writes the package word', () => {
    const before = beforeOf({ ...PACK_CASE, unit: '' });
    expect(before.kind).toBe('carton');
    expect(m.formatPatch(before, formOf(before, { kind: 'single' }))).toStrictEqual({ packCount: null, unit: 'busta' });
    // an employee sees no price: the same item opens as a Singola for them and nothing changes
    const employee = beforeOf({ ...PACK_CASE, unit: '', packCount: 4 } as { unit: string; packUnit: string }, null);
    expect(m.formatPatch(employee, formOf(employee, { kind: 'single' }))).toStrictEqual({ packCount: null, unit: 'busta' });
    // a Singola that opened as a Singola keeps its empty unit
    const single = beforeOf({ unit: '', packUnit: 'busta', weight: '1kg' } as { unit: string; packUnit: string }, null);
    expect(single.kind).toBe('single');
    expect(m.formatPatch(single, formOf(single, { kind: 'carton', count: 3, inner: 'busta' })).unit).toBe('cartone');
  });

  test('4th review 1: a price-only edit never writes the order unit', () => {
    // the 'pack' case ordered with NO unit (the one case in production): '' already reads «the whole case»
    const noUnit = { ...PACK_CASE, unit: '' };
    const before = beforeOf(noUnit);
    expect(before.kind).toBe('carton');
    expect(m.formatPatch(before, formOf(before), { force: true })).toStrictEqual({ packCount: 4, packUnit: 'busta' });
    // a legacy unit choice ordered by a carton word, no case: the count typed IS a touch, and the word is kept
    const choice = beforeOf({ unit: 'cartone', packUnit: 'busta', priceUnit: 'kg', pricePerUnit: 2, weight: '2.5kg' } as { unit: string; packUnit: string });
    expect(m.formatPatch(choice, formOf(choice, { count: 6 }), { force: true })).toStrictEqual({ packCount: 6, packUnit: 'busta', unit: 'cartone' });
    // a format the PERSON moved still writes the carton word over a weight unit (that line is frozen in kg)
    const kgSingle = beforeOf({ unit: 'kg', weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2 } as { unit: string });
    expect(m.formatPatch(kgSingle, formOf(kgSingle, { kind: 'carton', count: 4, inner: 'busta' })).unit).toBe('cartone');
  });

  test('reduced scope: only the shapes found in production open the new card', () => {
    const old = (item: unknown): boolean => m.usesLegacyCard(item);
    // the new card
    expect(old({}), 'a new item').toBe(false);
    expect(old({ weight: '25kg', unit: 'sacco' }), 'no price').toBe(false);
    expect(old(TYPED_KG), 'a rate per kilo, no weight').toBe(false);
    expect(old(TYPED_SACK), 'a rate per kilo on a readable weight').toBe(false);
    expect(old({ weight: '1l', priceUnit: 'l', pricePerUnit: 3 }), 'a rate per litre').toBe(false);
    expect(old({ weight: '60g', priceUnit: 'pcs', pricePerUnit: 0.25 }), 'per piece, no piece weight').toBe(false);
    expect(old({ weight: '60g', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 }), 'per piece = the weight').toBe(false);
    expect(old({ weight: '360g', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 }), 'eggs: own piece weight, today\'s typed form').toBe(false);
    expect(old(TYPED_PIECE), 'per piece with a piece weight and no weight').toBe(false);
    expect(old({ ...PACK_CASE, unit: '' }), 'a pack case ordered with no unit (Zucchero di canna)').toBe(false);
    expect(old(PACK_CASE), 'a pack case ordered by the carton').toBe(false);
    expect(old({ ...PACK_CASE, unit: 'Cassa' }), 'any carton word').toBe(false);
    expect(old({ ...PIECES_CASE, packCount: 50 }), 'what the new card writes for a Cartone').toBe(false);
    expect(old({ ...LEGACY_KG_CASE, packCount: 4 }), 'packCount wins: only the new card writes it').toBe(false);
    // the card of before
    expect(old(LEGACY_KG_CASE), 'a case by an explicit size').toBe(true);
    expect(old(LEGACY_G_CASE), 'grams').toBe(true);
    expect(old(PIECES_CASE), 'a case of pieces with no packCount').toBe(true);
    expect(old({ ...PACK_CASE, unit: 'kg' }), 'a pack case ordered by weight').toBe(true);
    // …except a case ordered by its OWN package word: the new card's Cartone turned into a Singola by an employee
    expect(old({ ...PACK_CASE, unit: 'busta' }), 'a pack case ordered by its own package word').toBe(false);
    expect(old({ ...PIECES_CASE, unit: 'pezzo', weight: '60g' }), 'a pieces case ordered by its own package word, piece = weight').toBe(false);
    expect(old({ ...PIECES_CASE, unit: 'pezzo' }), '…but not with no readable weight').toBe(true);
    expect(old({ ...PIECES_CASE, unit: 'vaschetta', packUnit: 'vaschetta', weight: '360g' }), '30 eggs in a tray are not one egg').toBe(true);
    expect(old({ ...PACK_CASE, unit: 'busta', packUnit: 'sacco' }), 'a package word that is not its own').toBe(true);
    expect(old({ ...PACK_CASE, unit: 'pz' }), 'a pack case ordered by the piece').toBe(true);
    expect(old({ weight: '6x1kg', priceUnit: 'kg', pricePerUnit: 2 }), 'a rate on a multiplier weight').toBe(true);
    expect(old({ weight: 'sacco', priceUnit: 'pcs', pricePerUnit: 2 }), 'a rate on a word').toBe(true);
    // a weight that does not read, with no price, is no money to misread
    expect(old({ weight: '6x1kg' })).toBe(false);
    // a case that no longer matches its rate is stale: storedCaseOf ignores it, and so does this
    expect(old({ ...LEGACY_KG_CASE, pricePerUnit: 3 })).toBe(false);
  });

  test('3rd review 1: a per-piece price never flags its weight (own piece weight ≠ pack weight is normal)', () => {
    setLanguage('en');
    const egg = { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
    const single: PackFormat = { kind: 'single', count: null, inner: '' };
    for (const weight of ['60g', '70g', '360g', 'sacco', '']) expect(impl.changed(egg, single, weight), weight).toBeNull();
  });

  // ── 3rd deep review (1 Oct 2026) ───────────────────────────────────────────

  test('3rd review 5: the format note shows the unit right for litres and millilitres', () => {
    setLanguage('en');
    const litres = { priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 0.5, caseItemUnit: 'pack' };
    expect(impl.changed(litres, carton(6), '750ml')).toStrictEqual({ old: '6 × 0.5 l', new: '6 × 0.75 l' });
    const ml = { priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 500, caseItemUnit: 'ml' };
    expect(impl.changed(ml, carton(6), '1l')).toStrictEqual({ old: '6 × 0.5 l', new: '6 × 1 l' });
    expect(impl.changed(ml, carton(6), '500ml')).toBeNull();
  });
});

// ── What only the port can be asked: it must not read any language of its own ──

describe('shared/ (TypeScript): the adapted functions use only what they are handed', () => {
  test('the translate function and the locale come from the caller', () => {
    const echo = (key: string, params?: Readonly<Record<string, string | number>>): string =>
      params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${String(v)}`).join(',')})` : key;
    const fmt: PackFormat = { kind: 'carton', count: 4, inner: 'bag' };
    expect(ported.formatSummary(fmt, '', 'en', echo, 'en')).toBe('orders.format.summaryNoWeight(items=4 bags)');
    expect(ported.formatSummary(fmt, '2.5kg', 'en', echo, 'de')).toBe('orders.format.summary(items=4 bags,size=2,5 kg,total=10 kg)');
    expect(ported.formatChanged(PACK_CASE, { kind: 'carton', count: 5, inner: 'busta' }, '2.5kg', 'de')).toStrictEqual({ old: '4 × 2,5 kg', new: '5 × 2,5 kg' });
  });
});
