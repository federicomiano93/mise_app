// pack-format.test.mjs — «Confezione: Singola | Cartone» (1 Oct 2026).
//
// The rule every test here serves: NOTHING STORED MAY CHANGE UNLESS A PERSON CHANGES IT IN THE
// CARD. Most products in production were saved by the old card (an order-unit menu, a «by the
// case» price mode) and carry no packCount, so the format is READ from what is there and written
// back only when moved. The card's own DOM cannot run under node --test; everything it decides
// lives in pack-format.js and price-model.js, which are pure — so the «existing data» table of
// the brief is asserted here row by row, with the card's untouched read() replayed as
// pricePatch(storedPriceInput(item)).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatOf, formatTouched, formatPatch, formatSummary, formatChanged, isCartonWord, parseCount, looseUnit,
  usesLegacyCard,
} from '../js/pack-format.js';
import {
  pricePatch, priceChanged, storedPriceInput, PRICE_FIELDS, storedCaseOf,
} from '../js/price-model.js';
import { setLanguage } from '../js/i18n.js';

const AT = '2026-10-01T10:00:00.000Z';

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

// What the card's untouched read() hands pricePatch, replayed.
const untouchedPatch = (item, weight = item.weight) => pricePatch(storedPriceInput(item, item.vatRate ?? ''), AT, weight);
const STORED_KEYS = ['priceUnit', 'pricePerUnit', 'casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit', 'unitWeightKg'];

function assertVerbatim(item, weightNow = item.weight) {
  const patch = untouchedPatch(item, weightNow);
  for (const key of STORED_KEYS) {
    assert.equal(patch[key] ?? null, item[key] ?? null, `${key} must come back as stored`);
  }
  assert.equal(patch.vatRate, item.vatRate ?? null, 'vat');
  assert.equal(priceChanged(item, patch), false, 'no history entry for an untouched save');
}

// ── formatOf: the four rules ─────────────────────────────────────────────────

test('rule 1: a packCount of a whole number ≥ 1 is a carton with that count', () => {
  assert.deepEqual(formatOf({ unit: 'cartone', packUnit: 'busta', packCount: 4 }), { kind: 'carton', count: 4, inner: 'busta' });
  assert.deepEqual(formatOf({ unit: 'sacco', packCount: 1 }), { kind: 'carton', count: 1, inner: '' });
  for (const bad of [0, -2, 2.5, '4', null, undefined, NaN, 10001]) {
    assert.equal(formatOf({ packCount: bad }).kind, 'single', `packCount ${String(bad)} is not a carton`);
  }
});

test('rule 2: a unit choice with a carton word is a carton — count empty for an employee, from the case for a price reader', () => {
  const employee = formatOf({ unit: 'cartone', packUnit: 'busta' }, null);
  assert.deepEqual(employee, { kind: 'carton', count: null, inner: 'busta' });
  assert.deepEqual(formatOf(PACK_CASE, PACK_CASE), { kind: 'carton', count: 4, inner: 'busta' });
  assert.deepEqual(formatOf(PACK_CASE, null), { kind: 'carton', count: null, inner: 'busta' }, 'no price access, no count');
});

test('rule 3: a price reader whose stored case holds more than one is a carton, whatever the order unit says', () => {
  assert.deepEqual(formatOf(LEGACY_KG_CASE, LEGACY_KG_CASE), { kind: 'carton', count: 4, inner: '' });
  assert.deepEqual(formatOf(LEGACY_G_CASE, LEGACY_G_CASE), { kind: 'carton', count: 4, inner: '' });
  assert.deepEqual(formatOf(PIECES_CASE, PIECES_CASE), { kind: 'carton', count: 50, inner: 'pezzo' });
  // the same legacy document seen by somebody who cannot read prices is a single: nothing says otherwise
  assert.equal(formatOf(LEGACY_KG_CASE, null).kind, 'single');
});

test('rule 4: everything else is a single — a missing field is never read as a carton', () => {
  for (const item of [TYPED_KG, TYPED_SACK, TYPED_PIECE, CUSTOM_UNIT, {}, null, undefined]) {
    assert.equal(formatOf(item, item).kind, 'single', JSON.stringify(item));
  }
  // «unit cartone» with no package word has no unit CHOICE: for an employee it stays a single
  assert.equal(formatOf({ unit: 'cartone' }, null).kind, 'single');
  // a stale case (a rate typed over it) does not stand, so it does not make a carton either
  assert.equal(formatOf({ ...PACK_CASE, unit: 'kg', packUnit: '', pricePerUnit: 3 }, { ...PACK_CASE, pricePerUnit: 3 }).kind, 'single');
  // a case of ONE is a single
  const one = { priceUnit: 'kg', pricePerUnit: 2, casePrice: 5, caseCount: 1, caseItemSize: 2.5, caseItemUnit: 'pack' };
  assert.equal(formatOf({ unit: 'kg', ...one }, one).kind, 'single');
});

test('carton words are the carton ones — never scatola, box, confezione or pack', () => {
  for (const w of ['cartone', 'Cartoni', 'cassa', 'collo', 'case', 'CARTON', 'crate', ' cartone ', 'case.']) assert.equal(isCartonWord(w), true, w);
  for (const w of ['scatola', 'box', 'confezione', 'pack', 'busta', 'kg', '', null, undefined]) assert.equal(isCartonWord(w), false, String(w));
});

// ── formatPatch: {} unless a person moved it ─────────────────────────────────

const beforeOf = (item, price = item) => ({ ...formatOf(item, price), unit: item.unit || '', packUnit: item.packUnit || '' });
const formOf = (before, over = {}) => ({ kind: before.kind, count: before.count, inner: before.inner, cartonWord: 'cartone', ...over });

test('untouched writes nothing, for every row of the existing-data table', () => {
  for (const item of [PACK_CASE, LEGACY_KG_CASE, LEGACY_G_CASE, PIECES_CASE, TYPED_KG, TYPED_SACK, TYPED_PIECE, CUSTOM_UNIT]) {
    const before = beforeOf(item);
    assert.deepEqual(formatPatch(before, formOf(before)), {}, JSON.stringify(item));
    assert.equal(formatTouched(before, formOf(before)), false);
  }
  // an employee's legacy carton: the count is empty and stays unwritten
  const employee = beforeOf({ unit: 'cartone', packUnit: 'busta' }, null);
  assert.deepEqual(formatPatch(employee, formOf(employee)), {});
  // an employee's «cartone» with no package word is a single: its unit is kept, nothing written
  const bare = beforeOf({ unit: 'cartone' }, null);
  assert.deepEqual(formatPatch(bare, formOf(bare)), {});
});

test('switching to Cartone and back again changes nothing', () => {
  const before = beforeOf(TYPED_SACK);
  const there = formOf(before, { kind: 'carton', count: 4, inner: 'busta' });
  assert.equal(formatTouched(before, there), true);
  assert.deepEqual(formatPatch(before, formOf(before, { kind: 'single' })), {});
});

test('Cartone writes packCount, the inner word and a carton unit — keeping a carton word already stored', () => {
  const fresh = { kind: 'single', count: null, inner: '', unit: '', packUnit: '' };
  assert.deepEqual(
    formatPatch(fresh, { kind: 'carton', count: 4, inner: 'busta', cartonWord: 'cartone' }),
    { packCount: 4, packUnit: 'busta', unit: 'cartone' },
  );
  assert.deepEqual(
    formatPatch(fresh, { kind: 'carton', count: 6, inner: 'bottle', cartonWord: 'case' }),
    { packCount: 6, packUnit: 'bottle', unit: 'case' },
  );
  // «cassa» is already a carton word: it stays, it is not overwritten by «cartone»
  const cassa = { kind: 'single', count: null, inner: '', unit: 'cassa', packUnit: '' };
  assert.equal(formatPatch(cassa, { kind: 'carton', count: 2, inner: 'busta', cartonWord: 'cartone' }).unit, 'cassa');
  // any other stored unit (sacco, kg) is replaced: that is what a person asked for by picking Cartone
  const sack = { kind: 'single', count: null, inner: '', unit: 'sacco', packUnit: '' };
  assert.equal(formatPatch(sack, { kind: 'carton', count: 2, inner: 'busta', cartonWord: 'cartone' }).unit, 'cartone');
});

test('changing only the count or only the inner word of an opened carton is a touch', () => {
  const before = beforeOf(PACK_CASE);
  assert.deepEqual(formatPatch(before, formOf(before, { count: 6 })), { packCount: 6, packUnit: 'busta', unit: 'cartone' });
  assert.deepEqual(formatPatch(before, formOf(before, { inner: 'sacco' })), { packCount: 4, packUnit: 'sacco', unit: 'cartone' });
  // an employee typing a count into a legacy carton
  const employee = beforeOf({ unit: 'cartone', packUnit: 'busta' }, null);
  assert.deepEqual(formatPatch(employee, formOf(employee, { count: 12 })), { packCount: 12, packUnit: 'busta', unit: 'cartone' });
});

test('a packUnit key is written only when there is a word to say or one to clear', () => {
  const none = { kind: 'single', count: null, inner: '', unit: '', packUnit: '' };
  assert.equal('packUnit' in formatPatch(none, { kind: 'carton', count: 3, inner: '', cartonWord: 'cartone' }), false);
  const had = { kind: 'single', count: null, inner: 'busta', unit: '', packUnit: 'busta' };
  assert.equal(formatPatch(had, { kind: 'carton', count: 3, inner: '', cartonWord: 'cartone' }).packUnit, '');
});

test('Singola after Cartone: packCount null, the carton word becomes the PACKAGE word (one busta), any other unit stays', () => {
  const stored = { unit: 'cartone', packUnit: 'busta', packCount: 4 };
  const before = beforeOf(stored, null);
  // ⚠️ NOT '': an empty unit reads «the whole case» to the readers, so a bag was priced as the carton (review defect 2b)
  assert.deepEqual(formatPatch(before, formOf(before, { kind: 'single' })), { packCount: null, unit: 'busta' });
  const keeps = beforeOf({ unit: 'sacco', packUnit: 'busta', packCount: 2 }, null);
  assert.deepEqual(formatPatch(keeps, formOf(keeps, { kind: 'single' })), { packCount: null, unit: 'sacco' });
  // a carton that was only inferred from a stored case (no packCount): still null, harmless on a merge
  const legacy = beforeOf(LEGACY_KG_CASE);
  assert.deepEqual(formatPatch(legacy, formOf(legacy, { kind: 'single' })), { packCount: null, unit: '' });
});

test('a count that is not a whole number is a touch that parseCount refuses', () => {
  const employee = beforeOf({ unit: 'cartone', packUnit: 'busta' }, null);
  assert.equal(formatTouched(employee, formOf(employee, { count: NaN })), true, 'typed rubbish is not «still empty»');
  for (const bad of ['', ' ', '2.5', '-1', '0', '1e3', 'abc', '10001', null, undefined]) assert.equal(parseCount(bad), null, String(bad));
  for (const [raw, n] of [['4', 4], [' 12 ', 12], ['10000', 10000], [7, 7]]) assert.equal(parseCount(raw), n);
});

test('a new loose item priced by kilo, litre or piece takes that order unit; anything else none', () => {
  const base = { kind: 'single', weightReadable: false };
  assert.equal(looseUnit({ ...base, priceUnit: 'kg', lang: 'it' }), 'kg');
  assert.equal(looseUnit({ ...base, priceUnit: 'l', lang: 'it' }), 'l');
  assert.equal(looseUnit({ ...base, priceUnit: 'pcs', lang: 'it' }), 'pz');
  assert.equal(looseUnit({ ...base, priceUnit: 'pcs', lang: 'en' }), 'pcs');
  assert.equal(looseUnit({ ...base, priceUnit: null, lang: 'it' }), '');
  assert.equal(looseUnit({ ...base, kind: 'carton', priceUnit: 'kg', lang: 'it' }), '');
  assert.equal(looseUnit({ ...base, weightReadable: true, priceUnit: 'kg', lang: 'it' }), '');
});

// ── The existing-data table: an untouched save leaves the price exactly as stored ──

test('table row: unit kg / pz / sacco / busta / custom, no packCount → a single, price verbatim', () => {
  for (const item of [TYPED_KG, TYPED_SACK, TYPED_PIECE, CUSTOM_UNIT]) assertVerbatim(item);
  assert.equal(formatOf({ unit: 'busta', weight: '2.5kg' }, null).kind, 'single');
});

test('table row: unit cartone + packUnit busta + a pack case → Cartone, count from the case, price verbatim', () => {
  assert.equal(formatOf(PACK_CASE, PACK_CASE).count, 4);
  assertVerbatim(PACK_CASE);
});

test('a pack case writes back its OWN stored size even when the weight has since been re-weighed', () => {
  // an employee changed 2.5kg to 3kg; the manager opens the card and fixes a typo: the price must not move
  assertVerbatim(PACK_CASE, '3kg');
  const patch = untouchedPatch(PACK_CASE, '3kg');
  assert.equal(patch.caseItemSize, 2.5);
  assert.equal(patch.pricePerUnit, 2);
  // and only a person re-pricing it (no packBasis) copies the new weight
  const retyped = pricePatch({ priceUnit: 'case', casePrice: 20, caseCount: 4, caseItemUnit: 'pack' }, AT, '3kg');
  assert.equal(retyped.caseItemSize, 3);
  assert.equal(retyped.pricePerUnit, 1.666667);
});

test('table row: a legacy explicit-size case (4 × 2.5 kg, 4 × 500 g) → Cartone, price verbatim, storedCaseOf stays valid', () => {
  for (const item of [LEGACY_KG_CASE, LEGACY_G_CASE]) {
    assert.equal(formatOf(item, item).count, 4);
    assertVerbatim(item);
    const patch = untouchedPatch(item);
    assert.deepEqual(storedCaseOf(patch), storedCaseOf(item), 'the written case is the stored case');
  }
  // the legacy case keeps its explicit unit — it is never rewritten as a 'pack' case
  assert.equal(untouchedPatch(LEGACY_G_CASE).caseItemUnit, 'g');
  assert.equal(untouchedPatch(LEGACY_G_CASE).caseItemSize, 500);
});

test('table row: a case of pieces (50 pz) → Cartone 50 × pezzo, price verbatim, the piece weight kept', () => {
  assert.deepEqual(formatOf(PIECES_CASE, PIECES_CASE), { kind: 'carton', count: 50, inner: 'pezzo' });
  assertVerbatim(PIECES_CASE);
  assert.equal(untouchedPatch(PIECES_CASE).unitWeightKg, 0.06);
});

test('table row: unit cartone with no package word, seen by an employee → a single, unit kept, no format keys', () => {
  const stored = { unit: 'cartone', weight: '10kg' };
  const before = beforeOf(stored, null);
  assert.equal(before.kind, 'single');
  assert.deepEqual(formatPatch(before, formOf(before)), {});
});

test('an untouched save never touches an item with no price at all', () => {
  const none = { unit: 'sacco', weight: '25kg' };
  const patch = untouchedPatch(none);
  assert.equal(patch.pricePerUnit, null);
  assert.equal(patch.priceUnit, null);
  for (const key of PRICE_FIELDS) assert.ok(key in patch, `${key} is written as null so a merge cannot keep an old value`);
});

// ── The summary line ─────────────────────────────────────────────────────────

test('«Case of 4 bags of 2.5 kg (10 kg)» in English', () => {
  setLanguage('en');
  assert.equal(formatSummary({ kind: 'carton', count: 4, inner: 'bag' }, '2.5kg', 'en'), 'Case of 4 bags of 2.5 kg (10 kg)');
  assert.equal(formatSummary({ kind: 'carton', count: 1, inner: 'bag' }, '2.5kg', 'en'), 'Case of 1 bag of 2.5 kg (2.5 kg)');
});

test('«Cartone da 4 buste da 2,5 kg (10 kg)» in Italian — decimal comma, plural of the venue word', () => {
  setLanguage('it');
  try {
    assert.equal(formatSummary({ kind: 'carton', count: 4, inner: 'busta' }, '2.5kg', 'it'), 'Cartone da 4 buste da 2,5 kg (10 kg)');
    assert.equal(formatSummary({ kind: 'carton', count: 12, inner: 'bottiglia' }, '750 ml', 'it'), 'Cartone da 12 bottiglie da 750 ml (9 l)');
    assert.equal(formatSummary({ kind: 'carton', count: 3, inner: 'sacco' }, '', 'it'), 'Cartone da 3 sacchi');
  } finally { setLanguage('en'); }
});

test('without a readable weight the summary names only the count; no carton, no count or no word is empty', () => {
  setLanguage('en');
  assert.equal(formatSummary({ kind: 'carton', count: 4, inner: 'bag' }, '', 'en'), 'Case of 4 bags');
  assert.equal(formatSummary({ kind: 'carton', count: 4, inner: 'bag' }, 'sack', 'en'), 'Case of 4 bags');
  assert.equal(formatSummary({ kind: 'carton', count: 4, inner: 'bag' }, '6x1kg', 'en'), 'Case of 4 bags');
  assert.equal(formatSummary({ kind: 'single', count: null, inner: 'bag' }, '2kg', 'en'), '');
  assert.equal(formatSummary({ kind: 'carton', count: null, inner: 'bag' }, '2kg', 'en'), '');
  assert.equal(formatSummary({ kind: 'carton', count: 4, inner: '' }, '2kg', 'en'), '');
  assert.equal(formatSummary(null, '2kg', 'en'), '');
});

test('a custom package word is never pluralised: «4 × parola»', () => {
  setLanguage('en');
  assert.equal(formatSummary({ kind: 'carton', count: 4, inner: 'sleeve' }, '2kg', 'en'), 'Case of 4 × sleeve of 2 kg (8 kg)');
  assert.equal(formatSummary({ kind: 'carton', count: 4, inner: 'busta' }, '2kg', 'en'), 'Case of 4 × busta of 2 kg (8 kg)', 'an Italian word on an English venue is custom');
});

test('grams and millilitres total in kilos and litres once they pass a thousand', () => {
  setLanguage('en');
  assert.equal(formatSummary({ kind: 'carton', count: 4, inner: 'bag' }, '500g', 'en'), 'Case of 4 bags of 500 g (2 kg)');
  assert.equal(formatSummary({ kind: 'carton', count: 2, inner: 'bag' }, '250g', 'en'), 'Case of 2 bags of 250 g (500 g)');
});

// ── «The format changed since the last price» ────────────────────────────────

const carton = (count) => ({ kind: 'carton', count, inner: 'busta' });

test('no stored case, or a format that agrees, says nothing', () => {
  assert.equal(formatChanged(null, carton(4), '2.5kg'), null);
  assert.equal(formatChanged(TYPED_KG, carton(4), '2.5kg'), null, 'a typed rate has no format to disagree with');
  assert.equal(formatChanged(PACK_CASE, carton(4), '2.5kg'), null);
  assert.equal(formatChanged(PACK_CASE, carton(4), '2,5 kg'), null, 'the same weight written another way');
  assert.equal(formatChanged(LEGACY_KG_CASE, carton(4), '2.5kg'), null);
  assert.equal(formatChanged(LEGACY_G_CASE, carton(4), '500 g'), null);
  assert.equal(formatChanged(LEGACY_G_CASE, carton(4), '0.5 kg'), null, '500 g and 0.5 kg are one weight');
  assert.equal(formatChanged(PIECES_CASE, carton(50), ''), null);
});

test('a different count is said, with both formats (an employee changed it)', () => {
  assert.deepEqual(formatChanged(PACK_CASE, carton(5), '2.5kg'), { old: '4 × 2.5 kg', new: '5 × 2.5 kg' });
  assert.deepEqual(formatChanged(PIECES_CASE, carton(40), ''), { old: '50', new: '40' });
});

test('a different weight is said — for a pack case and for a legacy explicit-size case alike', () => {
  assert.deepEqual(formatChanged(PACK_CASE, carton(4), '3kg'), { old: '4 × 2.5 kg', new: '4 × 3 kg' });
  assert.deepEqual(formatChanged(LEGACY_KG_CASE, carton(4), '3kg'), { old: '4 × 2.5 kg', new: '4 × 3 kg' });
  assert.deepEqual(formatChanged(LEGACY_G_CASE, carton(4), '250 g'), { old: '4 × 0.5 kg', new: '4 × 0.25 kg' });
  // kilos against litres is a different unit of price
  assert.ok(formatChanged(PACK_CASE, carton(4), '2.5 l'));
});

test('switching a carton to Singola is a count change (the case held 4)', () => {
  assert.ok(formatChanged(PACK_CASE, { kind: 'single', count: null, inner: 'busta' }, '2.5kg'));
});

test('an unreadable weight or an empty count cannot be compared, so nothing is said', () => {
  assert.equal(formatChanged(PACK_CASE, carton(4), 'sacco'), null);
  assert.equal(formatChanged(PACK_CASE, carton(null), '2.5kg'), null);
});

test('a case of pieces is the NORMAL shape: it agrees while the count agrees, whatever the weight says', () => {
  assert.equal(formatChanged(PIECES_CASE, carton(50), '60g'), null);
  assert.equal(formatChanged(PIECES_CASE, carton(50), '0.06 kg'), null);
  assert.equal(formatChanged(PIECES_CASE, carton(50), 'sacco'), null, 'an unreadable weight says nothing');
  // ⚠️ THE WEIGHT IS NOT COMPARED (3rd review): an old per-piece price keeps the PACK weight in `weight` and ONE
  // PIECE's in unitWeightKg, so a difference between them says nothing
  assert.equal(formatChanged(PIECES_CASE, carton(50), '2kg'), null);
  assert.deepEqual(formatChanged(PIECES_CASE, carton(40), '60g'), { old: '50', new: '40' });
});

// ── 2nd deep review (1 Oct 2026) ─────────────────────────────────────────────

test('review 3b: a package word as the unit, with no packCount, is a Singola whatever the stored case says', () => {
  // what an employee leaves behind after turning a Cartone into a Singola, seen by a manager
  const left = { ...PACK_CASE, unit: 'busta', packUnit: 'busta' };
  assert.equal(formatOf(left, left).kind, 'single');
  const pcs = { ...PIECES_CASE, unit: 'pezzo', packUnit: 'pezzo' };
  assert.equal(formatOf(pcs, pcs).kind, 'single');
  // …but a carton word, a different word or an explicit packCount still read as before
  assert.equal(formatOf({ ...left, unit: 'cartone' }, left).kind, 'carton');
  assert.equal(formatOf({ ...left, unit: 'sacco' }, left).kind, 'carton', 'a stored case of 4 under another word (rule 3)');
  assert.equal(formatOf({ ...left, packCount: 4 }, left).kind, 'carton', 'rule 1 comes first');
  assert.equal(formatOf({ ...left, unit: ' Busta ', packUnit: 'busta' }, left).kind, 'single', 'matched ignoring case and spaces');
});

test('review 2: force writes the full carton format even when the format was not touched; never for a Singola', () => {
  const before = beforeOf(PACK_CASE);
  assert.deepEqual(formatPatch(before, formOf(before)), {}, 'untouched, no price typed: nothing');
  assert.deepEqual(formatPatch(before, formOf(before), { force: true }), { packCount: 4, packUnit: 'busta' });
  const single = beforeOf(TYPED_SACK);
  assert.deepEqual(formatPatch(single, formOf(single), { force: true }), {}, 'a price typed under Singola adds no format keys');
  // a carton word already stored is kept — by not being written at all
  const cassa = beforeOf({ ...PACK_CASE, unit: 'cassa' });
  assert.equal('unit' in formatPatch(cassa, formOf(cassa), { force: true }), false);
});

// ── 4th deep review (2 Oct 2026) and the reduced scope ───────────────────────

test('4th review 1: a price-only edit never writes the order unit', () => {
  // the 'pack' case ordered with NO unit (the one case in production): '' already reads «the whole case»
  const noUnit = { ...PACK_CASE, unit: '' };
  const before = beforeOf(noUnit);
  assert.equal(before.kind, 'carton');
  assert.deepEqual(formatPatch(before, formOf(before), { force: true }), { packCount: 4, packUnit: 'busta' });
  // a legacy unit choice ordered by a carton word, no case: the count typed IS a touch, and the word is kept
  const choice = beforeOf({ unit: 'cartone', packUnit: 'busta', priceUnit: 'kg', pricePerUnit: 2, weight: '2.5kg' });
  assert.deepEqual(formatPatch(choice, formOf(choice, { count: 6 }), { force: true }), { packCount: 6, packUnit: 'busta', unit: 'cartone' });
  // a format the PERSON moved still writes the carton word over a weight unit (that line is frozen in kg)
  const kgSingle = beforeOf({ unit: 'kg', weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2 });
  assert.equal(formatPatch(kgSingle, formOf(kgSingle, { kind: 'carton', count: 4, inner: 'busta' })).unit, 'cartone');
});

test('reduced scope: only the shapes found in production open the new card', () => {
  const legacy = (item) => usesLegacyCard(item);
  // the new card
  assert.equal(legacy({}), false, 'a new item');
  assert.equal(legacy({ weight: '25kg', unit: 'sacco' }), false, 'no price');
  assert.equal(legacy(TYPED_KG), false, 'a rate per kilo, no weight');
  assert.equal(legacy(TYPED_SACK), false, 'a rate per kilo on a readable weight');
  assert.equal(legacy({ weight: '1l', priceUnit: 'l', pricePerUnit: 3 }), false, 'a rate per litre');
  assert.equal(legacy({ weight: '60g', priceUnit: 'pcs', pricePerUnit: 0.25 }), false, 'per piece, no piece weight');
  assert.equal(legacy({ weight: '60g', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 }), false, 'per piece = the weight');
  assert.equal(legacy({ weight: '360g', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 }), false, 'eggs: own piece weight, today\'s typed form');
  assert.equal(legacy(TYPED_PIECE), false, 'per piece with a piece weight and no weight');
  assert.equal(legacy({ ...PACK_CASE, unit: '' }), false, 'a pack case ordered with no unit (Zucchero di canna)');
  assert.equal(legacy(PACK_CASE), false, 'a pack case ordered by the carton');
  assert.equal(legacy({ ...PACK_CASE, unit: 'Cassa' }), false, 'any carton word');
  assert.equal(legacy({ ...PIECES_CASE, packCount: 50 }), false, 'what the new card writes for a Cartone');
  assert.equal(legacy({ ...LEGACY_KG_CASE, packCount: 4 }), false, 'packCount wins: only the new card writes it');
  // the card of before
  assert.equal(legacy(LEGACY_KG_CASE), true, 'a case by an explicit size');
  assert.equal(legacy(LEGACY_G_CASE), true, 'grams');
  assert.equal(legacy(PIECES_CASE), true, 'a case of pieces with no packCount');
  assert.equal(legacy({ ...PACK_CASE, unit: 'kg' }), true, 'a pack case ordered by weight');
  // …except a case ordered by its OWN package word: the new card's Cartone turned into a Singola by an employee
  assert.equal(legacy({ ...PACK_CASE, unit: 'busta' }), false, 'a pack case ordered by its own package word');
  assert.equal(legacy({ ...PIECES_CASE, unit: 'pezzo' }), false, 'a pieces case ordered by its own package word');
  assert.equal(legacy({ ...PACK_CASE, unit: 'busta', packUnit: 'sacco' }), true, 'a package word that is not its own');
  assert.equal(legacy({ ...PACK_CASE, unit: 'pz' }), true, 'a pack case ordered by the piece');
  assert.equal(legacy({ weight: '6x1kg', priceUnit: 'kg', pricePerUnit: 2 }), true, 'a rate on a multiplier weight');
  assert.equal(legacy({ weight: 'sacco', priceUnit: 'pcs', pricePerUnit: 2 }), true, 'a rate on a word');
  // a weight that does not read, with no price, is no money to misread
  assert.equal(legacy({ weight: '6x1kg' }), false);
  // a case that no longer matches its rate is stale: storedCaseOf ignores it, and so does this
  assert.equal(legacy({ ...LEGACY_KG_CASE, pricePerUnit: 3 }), false);
});

test('3rd review 1: a per-piece price never flags its weight (own piece weight ≠ pack weight is normal)', () => {
  const egg = { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
  const single = { kind: 'single', count: null, inner: '' };
  for (const weight of ['60g', '70g', '360g', 'sacco', '']) assert.equal(formatChanged(egg, single, weight), null, weight);
});

// ── 3rd deep review (1 Oct 2026) ─────────────────────────────────────────────

test('3rd review 5: the format note shows the unit right for litres and millilitres', () => {
  const litres = { priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 0.5, caseItemUnit: 'pack' };
  assert.deepEqual(formatChanged(litres, carton(6), '750ml'), { old: '6 × 0.5 l', new: '6 × 0.75 l' });
  const ml = { priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 500, caseItemUnit: 'ml' };
  assert.deepEqual(formatChanged(ml, carton(6), '1l'), { old: '6 × 0.5 l', new: '6 × 1 l' });
  assert.equal(formatChanged(ml, carton(6), '500ml'), null);
});
