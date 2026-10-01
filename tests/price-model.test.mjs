// price-model.test.mjs — the ingredient price maths.
//
// The owner cannot read code, so these tests are the safety net (P15). What they
// are really guarding is a specific kind of silent wrongness: a cost that looks
// perfectly plausible on screen and is out by a factor of a thousand, or a zero
// that reads as "free" when it means "nobody has filled this in yet".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setCurrency, currentCurrency } from '../js/currency.js';
import {
  PRICE_UNITS, PRICE_FIELDS, INGREDIENT_DRAINED_FIELDS,
  roundTo, positiveNumber, isPriceUnit,
  normalizePrice, pricePerKg, costState, isCostable, costReasonText,
  formatMoney, formatRate, formatPricePerUnit,
  pricePatch, priceChanged, priceRecord,
  splitPriceFields,
  withPrices,
} from '../js/price-model.js';

const AT = '2026-08-10T09:00:00.000Z';

// ── The typed rate becomes a stored rate ─────────────────────────────────────

test('the rate is taken as typed — £7.20 a kilo is £7.20 a kilo', () => {
  const r = normalizePrice({ priceUnit: 'kg', pricePerUnit: 7.2 });
  assert.equal(r.ok, true);
  assert.equal(r.pricePerUnit, 7.2);
  assert.equal(r.reason, null);
});

test('a rate with more precision than money is kept, not rounded to the penny', () => {
  // A gelatine leaf at a third of a penny. Rounded to the penny this ingredient
  // would cost nothing at all, and a free ingredient looks like a working one.
  assert.equal(normalizePrice({ priceUnit: 'pcs', pricePerUnit: 0.035 }).pricePerUnit, 0.035);
  assert.equal(normalizePrice({ priceUnit: 'kg', pricePerUnit: 3.3333 }).pricePerUnit, 3.3333);
});

test('a rate pasted with floating-point noise is cleaned up', () => {
  // What a spreadsheet hands over for 10/3. Stored raw it would never compare
  // equal to a later 3.3333, so every save would look like a price change.
  assert.equal(normalizePrice({ priceUnit: 'kg', pricePerUnit: 3.3333333333333335 }).pricePerUnit, 3.3333);
});

test('an incomplete form names the box that is missing', () => {
  assert.equal(normalizePrice({}).reason, 'unit');
  assert.equal(normalizePrice({ priceUnit: 'litres' }).reason, 'unit');
  assert.equal(normalizePrice({ priceUnit: 'kg' }).reason, 'price');
});

test('zero and negative numbers are refused, never treated as free', () => {
  assert.equal(normalizePrice({ priceUnit: 'kg', pricePerUnit: 0 }).ok, false);
  assert.equal(normalizePrice({ priceUnit: 'kg', pricePerUnit: -7.2 }).ok, false);
});

test('rubbish in the number box does not produce a rate', () => {
  for (const bad of ['', ' ', 'abc', null, undefined, NaN, Infinity, {}]) {
    assert.equal(normalizePrice({ priceUnit: 'kg', pricePerUnit: bad }).ok, false, String(bad));
  }
});

test('a number typed as text still works — every input arrives as a string', () => {
  const r = normalizePrice({ priceUnit: 'kg', pricePerUnit: '7.20' });
  assert.equal(r.ok, true);
  assert.equal(r.pricePerUnit, 7.2);
});

// ── What a kilo costs ────────────────────────────────────────────────────────

test('priced by weight, the rate IS the price per kilo', () => {
  assert.equal(pricePerKg({ priceUnit: 'kg', pricePerUnit: 7.2 }), 7.2);
});

test('priced by volume, one litre is treated as one kilo', () => {
  // The declared 1:1 approximation, and the same one catalogue-model.js uses when
  // it converts a recipe row in millilitres into grams. The two must agree.
  assert.equal(pricePerKg({ priceUnit: 'l', pricePerUnit: 1.2 }), 1.2);
});

test('priced by the piece, the weight of one piece turns it into a price per kilo', () => {
  // A vanilla pod at £2.10 weighing 3.5 g → £600/kg. This is the number that makes
  // vanilla worth writing in grams in a recipe rather than as "1 pod".
  assert.equal(pricePerKg({ priceUnit: 'pcs', pricePerUnit: 2.1, unitWeightKg: 0.0035 }), 600);
});

test('priced by the piece with no piece weight, a price per kilo cannot be known', () => {
  // The important half: it returns null rather than falling back to the raw rate,
  // which would say a 55g egg costs £0.30 a KILO.
  assert.equal(pricePerKg({ priceUnit: 'pcs', pricePerUnit: 0.3 }), null);
  assert.equal(pricePerKg({ priceUnit: 'pcs', pricePerUnit: 0.3, unitWeightKg: 0 }), null);
});

test('an ingredient with no price at all has no price per kilo', () => {
  assert.equal(pricePerKg({}), null);
  assert.equal(pricePerKg(null), null);
  assert.equal(pricePerKg({ priceUnit: 'kg' }), null);
  assert.equal(pricePerKg({ pricePerUnit: 7.2 }), null);           // no unit
  assert.equal(pricePerKg({ priceUnit: 'crate', pricePerUnit: 7.2 }), null);
});

// ── Costable or not — flagged, never blocked ─────────────────────────────────

test('an ingredient with a complete price is costable', () => {
  assert.deepEqual(costState({ priceUnit: 'kg', pricePerUnit: 7.2 }), { costable: true, reason: null });
  assert.equal(isCostable({ priceUnit: 'kg', pricePerUnit: 7.2 }), true);
  assert.equal(costReasonText({ priceUnit: 'kg', pricePerUnit: 7.2 }), '');
});

test('the 65 ingredients that exist today are simply "no price yet"', () => {
  // The real shape in production before this feature: a name, a supplier, a
  // free-text weight. Nothing about them may look broken — they are just unpriced.
  const live = { name: 'Bacon', supplierId: 'SUP_1', weight: '2.27kg', unit: 'casse', active: true };
  assert.deepEqual(costState(live), { costable: false, reason: 'no-price' });
  assert.equal(costReasonText(live), 'No price yet');
});

test('priced by the piece without a piece weight says exactly what is missing', () => {
  const egg = { priceUnit: 'pcs', pricePerUnit: 0.3 };
  assert.deepEqual(costState(egg), { costable: false, reason: 'no-piece-weight' });
  assert.match(costReasonText(egg), /weight of one piece/);
});

// ── Formatting ───────────────────────────────────────────────────────────────

test('money is shown to the penny, in whatever the venue counts in', () => {
  // The fallback, which is what every screen shows before a venue is open.
  assert.equal(currentCurrency(), '£');
  assert.equal(formatMoney(180), '£180.00');
  assert.equal(formatMoney(7.2), '£7.20');
  assert.equal(formatMoney(0), '£0.00');
  assert.equal(formatMoney('nonsense'), '£0.00');
});

// ⚠️⚠️ THE ONE THAT WOULD HAVE CAUGHT THE DEFECT FEDERICO PHOTOGRAPHED. The currency
// used to be `const CURRENCY = '£'` in price-model.js, so an Italian bakery's ten
// prices — typed in euros — were shown as pounds on every row and in every form.
// Reading it INSIDE the formatter is the whole fix, and this is what pins it: if
// anybody ever hoists it back to a module constant, the second half fails.
test('⚠️ the currency is read when money is FORMATTED, not when the module loads', () => {
  try {
    setCurrency('€');
    assert.equal(formatMoney(6.5), '€6.50', 'formatMoney must follow the venue');
    assert.equal(formatRate(0.0035), '€0.0035', 'so must a rate, decimals and all');
    assert.equal(formatPricePerUnit({ priceUnit: 'kg', pricePerUnit: 6.5 }), '€6.50 / kg');
    // And back, in the same process: nothing may have been captured on first import.
    setCurrency('£');
    assert.equal(formatMoney(6.5), '£6.50', 'it must change back — nothing is frozen');
  } finally {
    setCurrency('£');
  }
});

// ⚠️ NOTHING CONVERTS. The symbol is a label on a number that is never touched — the
// property that made this change safe to ship against ten real prices in production.
test('⚠️⚠️ changing the currency changes the SYMBOL and never the number', () => {
  try {
    setCurrency('£');
    const pounds = formatMoney(6.5);
    setCurrency('€');
    const euros = formatMoney(6.5);
    assert.equal(pounds.replace('£', ''), euros.replace('€', ''),
      'the digits must be identical — a conversion here would silently restate every price');
  } finally {
    setCurrency('£');
  }
});

test('a corrupt or missing currency falls back rather than blanking the price', () => {
  try {
    for (const bad of [null, undefined, '', 0, {}, []]) {
      setCurrency(bad);
      assert.equal(currentCurrency(), '£', `${JSON.stringify(bad)} must fall back`);
      assert.equal(formatMoney(1), '£1.00');
    }
  } finally {
    setCurrency('£');
  }
});

test('a rate keeps the decimals it needs, and never fewer than two', () => {
  assert.equal(formatRate(7.2), '£7.20');
  assert.equal(formatRate(600), '£600.00');
  assert.equal(formatRate(0.3), '£0.30');
  // The two that matter: rounded to the penny these read as 4p and as free.
  assert.equal(formatRate(0.035), '£0.035');
  assert.equal(formatRate(0.0035), '£0.0035');
  assert.equal(formatRate('nonsense'), '');
});

test('the headline rate reads "£7.20 / kg", and "each" for pieces', () => {
  assert.equal(formatPricePerUnit({ priceUnit: 'kg', pricePerUnit: 7.2 }), '£7.20 / kg');
  assert.equal(formatPricePerUnit({ priceUnit: 'l', pricePerUnit: 1.2 }), '£1.20 / l');
  assert.equal(formatPricePerUnit({ priceUnit: 'pcs', pricePerUnit: 0.3 }), '£0.30 / each');
  assert.equal(formatPricePerUnit({}), '');
});

// ── The patch written to Firestore ───────────────────────────────────────────

test('a complete form produces every field, so nothing stale is left behind', () => {
  const patch = pricePatch({ priceUnit: 'kg', pricePerUnit: '7.20' }, AT);
  assert.deepEqual(patch, {
    priceUnit: 'kg', pricePerUnit: 7.2, packPrice: null, packSize: null,
    unitWeightKg: null, priceUpdatedAt: AT, vatRate: null,
    casePrice: null, caseCount: null, caseItemSize: null, caseItemUnit: null,
  });
  // Every field this module owns is present in the patch — a merge write leaves
  // out what it does not mention, so an omitted field would keep its old value.
  assert.deepEqual(Object.keys(patch).sort(), [...PRICE_FIELDS].sort());
});

test('saving clears the retired pack fields off an ingredient that still carries them', () => {
  // The rate used to be packPrice ÷ packSize. Left in place they would sit under a
  // rate somebody has since corrected, saying £180 for 25kg beside £7.50 a kilo —
  // and a merge write cannot remove a field by leaving it out.
  const patch = pricePatch({ priceUnit: 'kg', pricePerUnit: 7.5 }, AT);
  assert.equal(patch.packPrice, null);
  assert.equal(patch.packSize, null);
});

test('clearing the price box really clears the stored price', () => {
  const patch = pricePatch({ priceUnit: 'kg', pricePerUnit: '' }, AT);
  assert.equal(patch.pricePerUnit, null);
  assert.equal(patch.priceUpdatedAt, null);
  assert.deepEqual(Object.keys(patch).sort(), [...PRICE_FIELDS].sort());
});

test('the weight of one piece survives a half-filled price', () => {
  // It describes the article, not the money. Losing it while someone is still
  // typing the price would mean typing it again.
  const patch = pricePatch({ priceUnit: 'pcs', unitWeightKg: 0.0035 }, AT);
  assert.equal(patch.unitWeightKg, 0.0035);
  assert.equal(patch.pricePerUnit, null);
});

test('switching away from pieces clears the piece weight', () => {
  // A leftover divisor nothing shows on screen is the kind of number that later
  // gets divided by without anyone knowing it is there.
  const patch = pricePatch({ priceUnit: 'kg', pricePerUnit: 7.2, unitWeightKg: 0.0035 }, AT);
  assert.equal(patch.unitWeightKg, null);
});

test('a piece weight keeps enough decimals for a gelatine leaf', () => {
  // 1.7 g. At four decimals this would be 0.0017 — a 2% error; six keeps it exact.
  const patch = pricePatch({ priceUnit: 'pcs', pricePerUnit: 0.035, unitWeightKg: 0.0017 }, AT);
  assert.equal(patch.unitWeightKg, 0.0017);
});

// ── When a history entry is worth writing ────────────────────────────────────

test('re-saving an ingredient without touching its price writes no history', () => {
  const before = { priceUnit: 'kg', pricePerUnit: 7.2, unitWeightKg: null };
  const after = pricePatch({ priceUnit: 'kg', pricePerUnit: 7.2 }, AT);
  assert.equal(priceChanged(before, after), false);
});

test('opening an old two-box price and saving it writes no history', () => {
  // Its packPrice/packSize get cleared by the save. If that counted as a change,
  // every ingredient priced before this rework would plant a history entry
  // recording a rate that never moved, the first time anyone opened it.
  const before = { priceUnit: 'kg', pricePerUnit: 7.2, packPrice: 180, packSize: 25, unitWeightKg: null };
  const after = pricePatch({ priceUnit: 'kg', pricePerUnit: 7.2 }, AT);
  assert.equal(after.packPrice, null);
  assert.equal(priceChanged(before, after), false);
});

test('a real price change is recorded', () => {
  const before = { priceUnit: 'kg', pricePerUnit: 7.2, unitWeightKg: null };
  const after = pricePatch({ priceUnit: 'kg', pricePerUnit: 7.6 }, AT);
  assert.equal(priceChanged(before, after), true);
});

test('a first price on an ingredient that never had one is recorded', () => {
  const after = pricePatch({ priceUnit: 'kg', pricePerUnit: 7.2 }, AT);
  assert.equal(priceChanged({ name: 'Flour' }, after), true);
  assert.equal(priceChanged(null, after), true);
});

test('changing only the piece weight counts as a price change', () => {
  // No money moved, but every recipe using it just changed cost, so the history
  // has to be able to explain the step.
  const before = { priceUnit: 'pcs', pricePerUnit: 2.1, unitWeightKg: 0.0035 };
  const after = pricePatch({ priceUnit: 'pcs', pricePerUnit: 2.1, unitWeightKg: 0.004 }, AT);
  assert.equal(priceChanged(before, after), true);
});

test('a missing field and a null field are the same absence', () => {
  // The stored document omits a field it never had; the patch writes null. Without
  // this, every first save after the feature ships would look like a change.
  assert.equal(priceChanged({ priceUnit: 'kg', pricePerUnit: 7.2 },
                            { priceUnit: 'kg', pricePerUnit: 7.2, unitWeightKg: null }),
               false);
});

// ── The history entry ────────────────────────────────────────────────────────

test('a history entry carries the supplier and a date FIELD', () => {
  const ing = { name: 'Flour', supplierId: 'SUP_1' };
  const patch = pricePatch({ priceUnit: 'kg', pricePerUnit: 7.2 }, AT);
  const record = priceRecord(ing, patch, AT);

  assert.equal(record.supplierId, 'SUP_1');
  assert.equal(record.source, 'manual');
  assert.equal(record.pricePerUnit, 7.2);
  // recordedAt must be a field: Firestore refuses to order a query descending by
  // document id, so a history without it could never be read newest-first.
  assert.equal(record.recordedAt, AT);
});

test('a history entry carries no retired pack fields — not even as nulls', () => {
  // The rules accept them for records written by a phone still on the old code,
  // so a null would pass; it would just be a permanent empty column in an
  // append-only archive nobody can go back and tidy.
  const record = priceRecord({ supplierId: 'SUP_1' }, pricePatch({ priceUnit: 'kg', pricePerUnit: 7.2 }, AT), AT);
  assert.deepEqual(Object.keys(record).sort(),
    ['pricePerUnit', 'priceUnit', 'recordedAt', 'source', 'supplierId', 'unitWeightKg']);
});

test('a history entry for an ingredient with no supplier still records', () => {
  const patch = pricePatch({ priceUnit: 'kg', pricePerUnit: 7.2 }, AT);
  assert.equal(priceRecord({}, patch, AT).supplierId, '');
  assert.equal(priceRecord(null, patch, AT).supplierId, '');
});

// ── Small guards ─────────────────────────────────────────────────────────────

test('the list of price units is closed and frozen', () => {
  assert.deepEqual([...PRICE_UNITS], ['kg', 'l', 'pcs']);
  assert.throws(() => { PRICE_UNITS.push('crate'); });
  assert.equal(isPriceUnit('kg'), true);
  assert.equal(isPriceUnit('casse'), false);
  assert.equal(isPriceUnit(''), false);
});

test('rounding survives the classic floating-point traps', () => {
  assert.equal(roundTo(1.005, 2), 1.01);
  assert.equal(roundTo(0.1 + 0.2, 2), 0.3);
  assert.equal(roundTo('nonsense', 2), 0);
});

test('positiveNumber accepts only a real number above zero', () => {
  assert.equal(positiveNumber('7.2'), 7.2);
  assert.equal(positiveNumber(0), null);
  assert.equal(positiveNumber(-1), null);
  assert.equal(positiveNumber(''), null);
  assert.equal(positiveNumber(null), null);
  assert.equal(positiveNumber(Infinity), null);
});

// ── The price lives beside the ingredient, not on it ─────────────────────────
//
// ⚠️ THE WHOLE POINT: Orders must read every ingredient to work, so a rate on the
// ingredient document is a rate everybody in the building can read. Hiding the
// Food Cost screen hid the margin and left "what a sack of flour costs" in plain
// view — half an answer pretending to be a whole one.

test('a saved form splits into the ingredient and its price', () => {
  const { ingredient, price } = splitPriceFields({
    name: 'Flour', supplierId: 'S1', active: true,
    priceUnit: 'kg', pricePerUnit: 7.2, unitWeightKg: null, priceUpdatedAt: '2026-08-12',
    packPrice: null, packSize: null,
  });
  assert.equal(ingredient.name, 'Flour');
  assert.equal(ingredient.supplierId, 'S1');
  assert.equal(price.priceUnit, 'kg');
  assert.equal(price.pricePerUnit, 7.2);
  assert.equal(price.priceUpdatedAt, '2026-08-12');
});

// ⚠️ THE KEYS STAY ON THE INGREDIENT, SET TO null. Omitting them would leave the
// old rate on documents written before this change — readable by everybody, for
// ever — which is the exact thing the split exists to stop.
test('the ingredient keeps every price key it may carry, emptied', () => {
  const { ingredient } = splitPriceFields({ name: 'Flour', priceUnit: 'kg', pricePerUnit: 7.2, vatRate: 4 });
  for (const key of INGREDIENT_DRAINED_FIELDS) {
    assert.ok(key in ingredient, `${key} missing`);
    assert.equal(ingredient[key], null, key);
  }
  // ⚠️ But never vatRate: the ingredients rule does not accept it, and one key it
  // refuses fails the whole save (tests/price-fields-whitelist.test.mjs).
  assert.equal('vatRate' in ingredient, false);
});

test('a form with no price at all still empties the keys', () => {
  const { ingredient, price } = splitPriceFields({ name: 'Flour' });
  assert.equal(ingredient.pricePerUnit, null);
  assert.deepEqual(price, {});
});

test('splitting nothing does not throw', () => {
  for (const bad of [null, undefined, {}]) {
    const { ingredient, price } = splitPriceFields(bad);
    assert.deepEqual(price, {});
    assert.equal(ingredient.pricePerUnit, null);
  }
});

// ⚠️ A MISSING PRICE IS NOT AN ERROR. An employee cannot read that collection at
// all, so for them withPrices returns the ingredients untouched — and every
// screen already knows what an unpriced ingredient looks like, because most
// ingredients have never had a price. No new failure mode to handle.
test('an ingredient with no price comes back unchanged', () => {
  const ings = [{ id: 'I1', name: 'Flour' }];
  assert.deepEqual(withPrices(ings, {}), ings);
  assert.deepEqual(withPrices(ings, null), ings);
});

test('a price is merged onto its own ingredient only', () => {
  const merged = withPrices(
    [{ id: 'I1', name: 'Flour' }, { id: 'I2', name: 'Butter' }],
    { I1: { priceUnit: 'kg', pricePerUnit: 7.2 } });
  assert.equal(merged[0].pricePerUnit, 7.2);
  assert.equal(merged[1].pricePerUnit, undefined);
  assert.equal(merged[0].name, 'Flour', 'the ingredient survives the merge');
});

test('a price for an ingredient that is not there is simply not used', () => {
  const merged = withPrices([{ id: 'I1' }], { GHOST: { pricePerUnit: 9 } });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].pricePerUnit, undefined);
});

// ⚠️⚠️ THE HOLE THE SECURITY AUDIT OF 23 SEP 2026 FOUND. The ingredient document is
// writable by any employee who may edit ingredients; a price on IT — left over, or
// made up — became the price a manager's Food cost used whenever the ingredient had
// no price document of its own. The rules now refuse anything but null there, and
// this refuses to read one, so neither half leans on the other.
test('a price sitting on the ingredient itself is never used', () => {
  const planted = { id: 'I1', name: 'Flour', priceUnit: 'kg', pricePerUnit: 0.01, packPrice: 1, packSize: 100, unitWeightKg: 1, priceUpdatedAt: 'x', vatRate: 4, casePrice: 1, caseCount: 1, caseItemSize: 1, caseItemUnit: 'kg' };
  const [alone] = withPrices([planted], {});
  for (const key of PRICE_FIELDS) assert.equal(alone[key], null, `${key} leaked through from the ingredient`);
  assert.equal(alone.name, 'Flour', 'everything else on the ingredient survives');

  const [priced] = withPrices([planted], { I1: { priceUnit: 'kg', pricePerUnit: 7.2 } });
  assert.equal(priced.pricePerUnit, 7.2, 'the price document wins');
  assert.equal(priced.packPrice, null, 'and nothing of the planted price is left beside it');
});

test('merging into nothing gives nothing', () => {
  assert.deepEqual(withPrices(null, { I1: { pricePerUnit: 1 } }), []);
  assert.deepEqual(withPrices(undefined, null), []);
});

// The two halves are inverses for the fields that matter, which is what makes a
// round trip through the form safe.
test('split then merge restores what the form had', () => {
  const form = { id: 'I1', name: 'Flour', priceUnit: 'kg', pricePerUnit: 7.2, unitWeightKg: null };
  const { ingredient, price } = splitPriceFields(form);
  const [back] = withPrices([{ ...ingredient, id: 'I1' }], { I1: price });
  assert.equal(back.priceUnit, 'kg');
  assert.equal(back.pricePerUnit, 7.2);
  assert.equal(back.name, 'Flour');
});

// ── «Confezione» and the ONE price box (1 Oct 2026) ──────────────────────────
// What the card's price box means follows the format and the weight; these are the pure halves
// of it (js/price-model.js). The DOM half is pinned in case-price-form.test.mjs.
import * as PM from '../js/price-model.js';

const CARTON = (count, inner = 'busta') => ({ kind: 'carton', count, inner });
const SINGLE = { kind: 'single', count: null, inner: '' };
const NOW = '2026-10-01T10:00:00.000Z';

test('the price box means: carton + weight → cartone; carton alone → pieces; single + weight → confezione; loose → typed', () => {
  assert.equal(PM.priceFormOf(CARTON(4), '2.5kg'), PM.PRICE_FORMS.cartonPack);
  assert.equal(PM.priceFormOf(CARTON(50), ''), PM.PRICE_FORMS.cartonPieces);
  assert.equal(PM.priceFormOf(CARTON(50), '6x1kg'), PM.PRICE_FORMS.cartonPieces);
  assert.equal(PM.priceFormOf(SINGLE, '25kg'), PM.PRICE_FORMS.singlePack);
  assert.equal(PM.priceFormOf(SINGLE, '500 ml'), PM.PRICE_FORMS.singlePack);
  assert.equal(PM.priceFormOf(SINGLE, ''), PM.PRICE_FORMS.typed);
  assert.equal(PM.priceFormOf(SINGLE, 'sacco'), PM.PRICE_FORMS.typed);
});

test('20 for a case of 4 × 2.5 kg is 2 a kilo and 5 a busta', () => {
  const input = PM.formatPriceInput(CARTON(4), '2.5kg', { price: '20', vat: '' });
  const patch = PM.pricePatch(input, NOW, '2.5kg');
  assert.deepEqual([patch.priceUnit, patch.pricePerUnit, patch.caseItemUnit, patch.caseItemSize, patch.caseCount, patch.casePrice],
    ['kg', 2, 'pack', 2.5, 4, 20]);
  assert.equal(patch.casePrice / patch.caseCount, 5);
});

test('a carton with no readable weight is a case of PIECES: a rate per piece, the piece weight kept', () => {
  const input = PM.formatPriceInput(CARTON(50, 'pezzo'), '', { price: '20', pieceKg: '0.06', vat: '22' });
  const patch = PM.pricePatch(input, NOW, '');
  assert.deepEqual([patch.priceUnit, patch.pricePerUnit, patch.caseItemUnit, patch.caseCount, patch.unitWeightKg, patch.vatRate],
    ['pcs', 0.4, 'pcs', 50, 0.06, 22]);
});

test('a single with a weight that reads is a case of ONE package: 20 for a 25 kg sack is 0.80 a kilo', () => {
  const input = PM.formatPriceInput(SINGLE, '25kg', { price: '20', vat: '' });
  const patch = PM.pricePatch(input, NOW, '25kg');
  assert.deepEqual([patch.priceUnit, patch.pricePerUnit, patch.caseCount, patch.caseItemUnit, patch.caseItemSize],
    ['kg', 0.8, 1, 'pack', 25]);
  assert.deepEqual(PM.storedCaseOf(patch), { casePrice: 20, caseCount: 1, caseItemSize: 25, caseItemUnit: 'pack' });
});

test('a loose single keeps today\'s typed rate, exactly as it was', () => {
  const input = PM.formatPriceInput(SINGLE, '', { rate: '7.2', unit: 'kg', pieceKg: '', vat: '' });
  const patch = PM.pricePatch(input, NOW, '');
  assert.deepEqual([patch.priceUnit, patch.pricePerUnit, patch.caseCount], ['kg', 7.2, null]);
  const none = PM.pricePatch(PM.formatPriceInput(SINGLE, '', { rate: '', unit: null, vat: '' }), NOW, '');
  assert.equal(none.pricePerUnit, null);
});

test('an empty carton count prices nothing (the card refuses the save before it gets here)', () => {
  const patch = PM.pricePatch(PM.formatPriceInput(CARTON(null), '2.5kg', { price: '20', vat: '' }), NOW, '2.5kg');
  assert.equal(patch.pricePerUnit, null);
  assert.equal(patch.caseCount, null);
});

test('the box starts on the stored case price for a carton, and on one package\'s price for a single', () => {
  const stored = { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
  assert.equal(PM.priceBoxPrefill(stored, CARTON(4), '2.5kg'), 20);
  assert.equal(PM.priceBoxPrefill(stored, CARTON(5), '2.5kg'), 20, 'the invoice figure stays when the count changes');
  assert.equal(PM.priceBoxPrefill(stored, SINGLE, '2.5kg'), 5, 'case price ÷ count');
});

test('with only a typed rate the box starts at rate × count × size, so the rate is kept', () => {
  const typed = { priceUnit: 'kg', pricePerUnit: 2 };
  assert.equal(PM.priceBoxPrefill(typed, CARTON(4), '2.5kg'), 20);
  assert.equal(PM.priceBoxPrefill(typed, SINGLE, '2.5kg'), 5);
  assert.equal(PM.priceBoxPrefill(typed, SINGLE, '500g'), 1);
  assert.equal(PM.priceBoxPrefill({ priceUnit: 'pcs', pricePerUnit: 0.4 }, CARTON(50, 'pezzo'), ''), 20);
  assert.equal(PM.priceBoxPrefill({ priceUnit: 'pcs', pricePerUnit: 1.2 }, SINGLE, '500g'), 1.2, 'a rate per piece is one package');
  // nothing to start from: empty, never a guess
  assert.equal(PM.priceBoxPrefill(typed, CARTON(null), '2.5kg'), null);
  assert.equal(PM.priceBoxPrefill({}, CARTON(4), '2.5kg'), null);
  assert.equal(PM.priceBoxPrefill(null, CARTON(4), '2.5kg'), null);
  assert.equal(PM.priceBoxPrefill(typed, SINGLE, ''), null, 'a loose single uses the rate box, not this one');
  assert.equal(PM.priceBoxPrefill(typed, CARTON(4), ''), null, 'a rate per kilo cannot become a price per piece');
});

test('over a grid of rates, sizes and counts the pre-filled box gives back the same rate', () => {
  const rates = [0.8, 1.25, 3.49, 7.2, 12.5, 0.035, 0.0035, 18];
  const weights = ['25kg', '2.5kg', '500g', '250 g', '1l', '750ml', '100g', '5kg'];
  for (const rate of rates) {
    for (const weight of weights) {
      for (const count of [1, 4, 12, 50]) {
        const item = { priceUnit: 'kg', pricePerUnit: rate };
        const fmt = count === 1 ? SINGLE : CARTON(count);
        const box = PM.priceBoxPrefill(item, fmt, weight);
        const patch = PM.pricePatch(PM.formatPriceInput(fmt, weight, { price: String(box), vat: '' }), NOW, weight);
        // ⚠️ THE CASE PRICE IS KEPT TO FOUR DECIMALS (caseOf), so the rate can only move by half a
        // hundredth of a cent divided by what the case weighs — nothing at a realistic price, a
        // fraction of a percent on a price that is itself under a cent; a rate typed to the penny
        // must come back EXACTLY
        const kilos = count * PM.packBaseOf(weight).size;
        assert.ok(Math.abs(patch.pricePerUnit - rate) <= 5.1e-5 / kilos + 1e-9, `${rate} × ${count} × ${weight}: ${patch.pricePerUnit}`);
        if (rate >= 0.8 && Number.isInteger(rate * 100)) {
          assert.equal(patch.pricePerUnit, rate, `${rate} × ${count} × ${weight} must be exact`);
        }
      }
    }
  }
});

test('a case price round-trips: re-typing the pre-filled box gives the stored rate (several shapes)', () => {
  for (const [weight, rate] of [['2.5kg', 2], ['500g', 10], ['750ml', 4], ['25kg', 0.8]]) {
    const first = PM.pricePatch(
      PM.formatPriceInput(CARTON(4), weight, { price: String(PM.priceBoxPrefill({ priceUnit: 'kg', pricePerUnit: rate }, CARTON(4), weight)), vat: '' }),
      NOW, weight,
    );
    assert.equal(first.pricePerUnit, rate, weight);
    // and the stored case itself, re-read, starts the box on the same case price
    assert.equal(PM.priceBoxPrefill({ ...first }, CARTON(4), weight), first.casePrice);
  }
});

test('a price document written verbatim by the untouched path equals the stored one, for any stored case', () => {
  for (const stored of [
    { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' },
    { priceUnit: 'kg', pricePerUnit: 10, casePrice: 20, caseCount: 4, caseItemSize: 500, caseItemUnit: 'g' },
    { priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 500, caseItemUnit: 'ml' },
    { priceUnit: 'l', pricePerUnit: 3.2, casePrice: 12.8, caseCount: 4, caseItemSize: 1, caseItemUnit: 'pack' },
    { priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' },
    { priceUnit: 'pcs', pricePerUnit: 3.333333, casePrice: 10, caseCount: 3, caseItemUnit: 'pcs' },
    { priceUnit: 'kg', pricePerUnit: 7.2 },
    { priceUnit: 'pcs', pricePerUnit: 0.3, unitWeightKg: 0.05 },
  ]) {
    // whatever the weight says now — the stored case is its own authority
    for (const weight of ['2.5kg', '3kg', '', 'sacco']) {
      const patch = PM.pricePatch(PM.storedPriceInput(stored, ''), NOW, weight);
      for (const key of ['priceUnit', 'pricePerUnit', 'casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit', 'unitWeightKg']) {
        assert.equal(patch[key] ?? null, stored[key] ?? null, `${key} (${JSON.stringify(stored)}, weight "${weight}")`);
      }
      assert.equal(PM.priceChanged(stored, patch), false);
    }
  }
});

test('a STALE case (a rate typed over it) is not written back: the stored rate is', () => {
  const stale = { priceUnit: 'kg', pricePerUnit: 3, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
  const patch = PM.pricePatch(PM.storedPriceInput(stale, ''), NOW, '2.5kg');
  assert.equal(patch.pricePerUnit, 3);
  assert.equal(patch.caseCount, null, 'and the dead case goes out as null, as every typed-rate save does');
});

test('only the VAT is read live on the untouched path', () => {
  const stored = { priceUnit: 'kg', pricePerUnit: 7.2, vatRate: 4 };
  assert.equal(PM.pricePatch(PM.storedPriceInput(stored, '10'), NOW, '').vatRate, 10);
  assert.equal(PM.pricePatch(PM.storedPriceInput(stored, ''), NOW, '').vatRate, null);
  assert.equal(PM.pricePatch(PM.storedPriceInput(stored, '4'), NOW, '').priceUnit, 'kg');
});

test('a weight-priced case cannot be re-priced once its weight stops reading; pieces and empty boxes can', () => {
  const kgCase = { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
  const base = { item: kgCase, fmt: CARTON(4), weightText: 'sacco', dirty: true, priceBox: '22' };
  assert.equal(PM.weightNeededForPrice(base), true);
  assert.equal(PM.weightNeededForPrice({ ...base, weightText: '2.5kg' }), false, 'a readable weight is fine');
  assert.equal(PM.weightNeededForPrice({ ...base, dirty: false }), false, 'untouched writes the stored case');
  assert.equal(PM.weightNeededForPrice({ ...base, priceBox: '' }), false, 'an emptied box is no price');
  assert.equal(PM.weightNeededForPrice({ ...base, fmt: SINGLE }), false);
  const pieces = { priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' };
  assert.equal(PM.weightNeededForPrice({ ...base, item: pieces }), false);
  assert.equal(PM.weightNeededForPrice({ ...base, item: { priceUnit: 'kg', pricePerUnit: 2 } }), false, 'a typed rate has no case to protect');
});
