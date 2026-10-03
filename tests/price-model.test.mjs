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
    // An Italian venue also WRITES the amount the Italian way (4 Oct 2026), read when
    // formatting like the symbol.
    setCurrency('€', { decimal: ',', group: '.', symbolAfter: true });
    assert.equal(formatMoney(1234.5), '1.234,50 €');
    assert.equal(formatMoney(6.5), '6,50 €');
    assert.equal(formatRate(0.0035), '0,0035 €');
    assert.equal(formatPricePerUnit({ priceUnit: 'kg', pricePerUnit: 6.5 }), '6,50 € / kg');
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

// ── «Confezione» and the ONE price box (1 Oct 2026, reworked after the deep review) ───────────
// What the card's price box means follows the format and the weight; these are the pure halves
// of it (js/price-model.js). The DOM half is executed in ingredient-card-save.test.mjs.
//
// ⚠️ THE STORAGE POLICY: a price typed for formatted goods is stored PER ITEM — priceUnit 'pcs', the
// rate is ONE item's price, unitWeightKg is one item's weight in kilos when the weight reads (litres
// 1:1). A carton is a case of that many pieces (casePrice, caseCount, caseItemUnit 'pcs'). The first
// build stored a case of ONE package priced per kilo, and an egg at 0.25 a piece became 4.03 a kilo
// with no piece weight — Food cost's «in pieces» lines and packaging lost their cost.
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

test('a carton priced 20 for 4 × 2.5 kg is stored per item: 5 a busta, a case of 4 pieces, 2.5 kg each', () => {
  const patch = PM.pricePatch(PM.formatPriceInput(CARTON(4), '2.5kg', { price: '20', vat: '' }), NOW, '2.5kg');
  assert.deepEqual(
    [patch.priceUnit, patch.pricePerUnit, patch.caseItemUnit, patch.caseItemSize, patch.caseCount, patch.casePrice, patch.unitWeightKg],
    ['pcs', 5, 'pcs', null, 4, 20, 2.5],
  );
  assert.ok(PM.storedCaseOf(patch), 'the case stands on its own rate (casePrice ÷ count)');
  assert.equal(PM.pricePerKg(patch), 2, 'and the per-kilo consumers still get 2 a kilo');
});

test('litres read 1:1 as kilos, grams as thousandths: 12 for 6 × 750 ml is 2 a bottle, 2.6667 a litre', () => {
  const patch = PM.pricePatch(PM.formatPriceInput(CARTON(6), '750ml', { price: '12', vat: '' }), NOW, '750ml');
  assert.deepEqual([patch.priceUnit, patch.pricePerUnit, patch.unitWeightKg], ['pcs', 2, 0.75]);
  assert.equal(PM.pricePerKg(patch), 2.6667);
  const grams = PM.pricePatch(PM.formatPriceInput(CARTON(4), '500g', { price: '20', vat: '' }), NOW, '500g');
  assert.deepEqual([grams.pricePerUnit, grams.unitWeightKg], [5, 0.5]);
});

test('a carton with no readable weight is a case of PIECES: a rate per piece, the piece weight kept', () => {
  const input = PM.formatPriceInput(CARTON(50, 'pezzo'), '', { price: '20', pieceKg: '0.06', vat: '22' });
  const patch = PM.pricePatch(input, NOW, '');
  assert.deepEqual([patch.priceUnit, patch.pricePerUnit, patch.caseItemUnit, patch.caseCount, patch.unitWeightKg, patch.vatRate],
    ['pcs', 0.4, 'pcs', 50, 0.06, 22]);
  // a readable weight wins over the piece-weight box
  const weighed = PM.pricePatch(PM.formatPriceInput(CARTON(50, 'pezzo'), '60g', { price: '20', pieceKg: '0.5', vat: '' }), NOW, '60g');
  assert.equal(weighed.unitWeightKg, 0.06);
});

test('defect 1: a single with a weight that reads keeps «a piece»: an egg at 0.25 with 60 g stays 0.25 a piece', () => {
  const patch = PM.pricePatch(PM.formatPriceInput(SINGLE, '60g', { price: '0.25', vat: '' }), NOW, '60g');
  assert.deepEqual([patch.priceUnit, patch.pricePerUnit, patch.unitWeightKg], ['pcs', 0.25, 0.06]);
  for (const key of ['casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit']) assert.equal(patch[key], null, `${key} is written null`);
  assert.equal(PM.pricePerKg(patch), 4.1667, 'per kilo it is derived, never stored as the price');
  assert.equal(PM.costState(patch).costable, true);
  // a packaging «vaschetta 500 ml» ends per piece as well
  const tub = PM.pricePatch(PM.formatPriceInput(SINGLE, '500ml', { price: '0.12', vat: '' }), NOW, '500ml');
  assert.deepEqual([tub.priceUnit, tub.pricePerUnit, tub.unitWeightKg], ['pcs', 0.12, 0.5]);
});

test('a single priced 20 for a 25 kg sack is 20 a piece weighing 25 kg — 0.80 a kilo through pricePerKg', () => {
  const patch = PM.pricePatch(PM.formatPriceInput(SINGLE, '25kg', { price: '20', vat: '' }), NOW, '25kg');
  assert.deepEqual([patch.priceUnit, patch.pricePerUnit, patch.unitWeightKg, patch.caseCount], ['pcs', 20, 25, null]);
  assert.equal(PM.pricePerKg(patch), 0.8);
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

// ── What the price box shows: the stored figure only while it still means the same thing ─────────

test('priceBoxStart: a stored case in its own format shows its price; changed, it is EMPTY with the suggestion', () => {
  const pcsCase = { priceUnit: 'pcs', pricePerUnit: 5, casePrice: 20, caseCount: 4, caseItemUnit: 'pcs', unitWeightKg: 2.5 };
  assert.deepEqual(PM.priceBoxStart(pcsCase, CARTON(4), '2.5kg', false), { value: 20, suggestion: 20 });
  assert.deepEqual(PM.priceBoxStart(pcsCase, CARTON(5), '2.5kg', true), { value: null, suggestion: 25 }, 'the same price per item, five of them');
  assert.deepEqual(PM.priceBoxStart(pcsCase, SINGLE, '2.5kg', true), { value: null, suggestion: 5 });
});

test('priceBoxStart: a legacy per-kilo case carries its RATE to the new weight', () => {
  const packCase = { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
  assert.deepEqual(PM.priceBoxStart(packCase, CARTON(4), '2.5kg', false), { value: 20, suggestion: 20 });
  assert.deepEqual(PM.priceBoxStart(packCase, CARTON(4), '3kg', true), { value: null, suggestion: 24 }, '2 a kilo × 3 kg × 4');
  assert.deepEqual(PM.priceBoxStart(packCase, SINGLE, '2.5kg', false), { value: 5, suggestion: 5 }, 'a case of one has the case price ÷ count');
  assert.deepEqual(PM.priceBoxStart(packCase, CARTON(4), '', true), { value: null, suggestion: null }, 'no weight, no suggestion');
});

test('priceBoxStart: with only a typed rate the box shows that rate carried over', () => {
  assert.deepEqual(PM.priceBoxStart({ priceUnit: 'kg', pricePerUnit: 2 }, CARTON(4), '2.5kg'), { value: 20, suggestion: 20 });
  assert.deepEqual(PM.priceBoxStart({ priceUnit: 'kg', pricePerUnit: 2 }, SINGLE, '500g'), { value: 1, suggestion: 1 });
  assert.deepEqual(PM.priceBoxStart({ priceUnit: 'pcs', pricePerUnit: 0.4 }, CARTON(50, 'pezzo'), ''), { value: 20, suggestion: 20 });
  assert.deepEqual(PM.priceBoxStart({ priceUnit: 'pcs', pricePerUnit: 1.2 }, SINGLE, '500g'), { value: 1.2, suggestion: 1.2 });
  // nothing to carry: empty, never a guess
  for (const [item, fmt, weight] of [
    [{ priceUnit: 'kg', pricePerUnit: 2 }, CARTON(null), '2.5kg'],
    [{}, CARTON(4), '2.5kg'],
    [null, CARTON(4), '2.5kg'],
    [{ priceUnit: 'kg', pricePerUnit: 2 }, SINGLE, ''],
    [{ priceUnit: 'kg', pricePerUnit: 2 }, CARTON(4), ''],
  ]) {
    assert.deepEqual(PM.priceBoxStart(item, fmt, weight), { value: null, suggestion: null }, JSON.stringify([item, fmt, weight]));
  }
});

test('a price carried to a new format is the same per-item price: typing the suggestion keeps the per-kilo rate', () => {
  for (const [item, fmt, weight] of [
    [{ priceUnit: 'kg', pricePerUnit: 2 }, CARTON(4), '2.5kg'],
    [{ priceUnit: 'kg', pricePerUnit: 0.8 }, SINGLE, '25kg'],
    [{ priceUnit: 'l', pricePerUnit: 4 }, CARTON(6), '500ml'],
    [{ priceUnit: 'kg', pricePerUnit: 10 }, CARTON(12), '250 g'],
  ]) {
    const box = PM.priceBoxStart(item, fmt, weight).suggestion;
    const patch = PM.pricePatch(PM.formatPriceInput(fmt, weight, { price: String(box), vat: '' }), NOW, weight);
    assert.ok(Math.abs(PM.pricePerKg(patch) - item.pricePerUnit) < 1e-3, `${JSON.stringify(item)} ${weight}: ${PM.pricePerKg(patch)}`);
  }
});

test('a price document written verbatim by the untouched path equals the stored one, for any stored case', () => {
  for (const stored of [
    { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' },
    { priceUnit: 'kg', pricePerUnit: 10, casePrice: 20, caseCount: 4, caseItemSize: 500, caseItemUnit: 'g' },
    { priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 500, caseItemUnit: 'ml' },
    { priceUnit: 'l', pricePerUnit: 3.2, casePrice: 12.8, caseCount: 4, caseItemSize: 1, caseItemUnit: 'pack' },
    { priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' },
    { priceUnit: 'pcs', pricePerUnit: 5, casePrice: 20, caseCount: 4, caseItemUnit: 'pcs', unitWeightKg: 2.5 },
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

test('defect 6: a tiny rate retouched through the card writes no history entry — the stored price is verbatim', () => {
  // 0.0123 a kilo on a 250 g pack: a typed price (0.003075) would not survive four decimals; untouched, it never goes through one
  const stored = { priceUnit: 'kg', pricePerUnit: 0.0123 };
  const patch = PM.pricePatch(PM.storedPriceInput(stored, ''), NOW, '250g');
  assert.equal(patch.pricePerUnit, 0.0123);
  assert.equal(PM.priceChanged(stored, patch), false);
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

// ── 2nd deep review (1 Oct 2026): a Cartone turned into a Singola keeps the money ───────────────
test('singleFromCaseInput: the same cost per item, in the per-item shape, with six decimals kept', () => {
  const pack = { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
  const a = PM.pricePatch(PM.singleFromCaseInput(pack, ''), NOW, '2.5kg');
  assert.deepEqual([a.priceUnit, a.pricePerUnit, a.unitWeightKg, a.caseCount, a.casePrice], ['pcs', 5, 2.5, null, null]);
  assert.equal(PM.pricePerKg(a), 2, 'per kilo is unchanged');
  const grams = PM.pricePatch(PM.singleFromCaseInput({ priceUnit: 'kg', pricePerUnit: 10, casePrice: 20, caseCount: 4, caseItemSize: 500, caseItemUnit: 'g' }, ''), NOW, '');
  assert.deepEqual([grams.pricePerUnit, grams.unitWeightKg], [5, 0.5]);
  const litres = PM.pricePatch(PM.singleFromCaseInput({ priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 500, caseItemUnit: 'ml' }, ''), NOW, '');
  assert.deepEqual([litres.pricePerUnit, litres.unitWeightKg], [2, 0.5]);
  // a case of pieces keeps the piece weight the price already remembers, and an odd division keeps six decimals
  const odd = PM.pricePatch(PM.singleFromCaseInput({ priceUnit: 'pcs', pricePerUnit: 3.333333, casePrice: 10, caseCount: 3, caseItemUnit: 'pcs', unitWeightKg: 0.2 }, ''), NOW, '');
  assert.deepEqual([odd.pricePerUnit, odd.unitWeightKg], [3.333333, 0.2]);
  // no stored case: the stored price as it is
  assert.deepEqual(PM.singleFromCaseInput({ priceUnit: 'kg', pricePerUnit: 7.2 }, '4'), PM.storedPriceInput({ priceUnit: 'kg', pricePerUnit: 7.2 }, '4'));
});

test('a rate typed without keepRate is still rounded to four decimals (only the converter keeps six)', () => {
  assert.equal(PM.pricePatch({ priceUnit: 'pcs', pricePerUnit: 3.333333 }, NOW, '').pricePerUnit, 3.3333);
});

test('«each» is an interface word: one phrase with a hole, in English and in Italian', async () => {
  assert.equal(PM.formatPricePerUnit({ priceUnit: 'pcs', pricePerUnit: 0.3 }), '£0.30 / each');
  const { setLanguage } = await import('../js/i18n.js');
  setLanguage('it');
  try { assert.equal(PM.formatPricePerUnit({ priceUnit: 'pcs', pricePerUnit: 0.3 }), '£0.30 al pezzo'); }
  finally { setLanguage('en'); }
  assert.equal(PM.formatPricePerUnit({ priceUnit: 'kg', pricePerUnit: 7.2 }), '£7.20 / kg');
});

// ── 3rd deep review (1 Oct 2026) ─────────────────────────────────────────────

test('ownPieceWeight: only a per-piece price whose piece weight is the weight tracks it', () => {
  const pcs = (uwk) => ({ priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: uwk });
  assert.equal(PM.ownPieceWeight(pcs(0.06), '60g'), false, 'what the new card writes');
  assert.equal(PM.ownPieceWeight(pcs(0.06), '0.06 kg'), false);
  assert.equal(PM.ownPieceWeight(pcs(0.06), '360g'), true, 'eggs: weight is the PACK');
  assert.equal(PM.ownPieceWeight({ priceUnit: 'pcs', pricePerUnit: 0.03, unitWeightKg: 0.002 }, '1kg'), true, 'gelatine');
  assert.equal(PM.ownPieceWeight(pcs(undefined), '500ml'), true, 'no piece weight: today\'s per-piece form');
  assert.equal(PM.ownPieceWeight(pcs(0.06), ''), true, 'nothing to compare with');
  // a weight EDITED later must not flip a tracking price: the weight it opened with decides
  assert.equal(PM.ownPieceWeight(pcs(0.06), '70g', '60g'), false);
  assert.equal(PM.ownPieceWeight(pcs(0.06), '400g', '360g'), true);
  // not a per-piece price, or a new item
  assert.equal(PM.ownPieceWeight({ priceUnit: 'kg', pricePerUnit: 2 }, '2.5kg'), false);
  assert.equal(PM.ownPieceWeight(null, '2.5kg'), false);
});

test('ownPiece keeps today\'s typed form and never writes the pack weight as the piece weight', () => {
  const single = { kind: 'single', count: null, inner: '' };
  assert.equal(PM.priceFormOf(single, '360g', true), PM.PRICE_FORMS.typed);
  assert.equal(PM.priceFormOf({ kind: 'carton', count: 4, inner: 'x' }, '360g', true), PM.PRICE_FORMS.cartonPieces);
  const patch = PM.pricePatch(PM.formatPriceInput(single, '360g', { rate: '0.26', unit: 'pcs', pieceKg: '0.06', ownPiece: true, vat: '' }), NOW, '360g');
  assert.deepEqual([patch.priceUnit, patch.pricePerUnit, patch.unitWeightKg], ['pcs', 0.26, 0.06]);
  const carton = PM.pricePatch(PM.formatPriceInput({ kind: 'carton', count: 4, inner: 'x' }, '360g', { price: '1', pieceKg: '0.06', ownPiece: true, vat: '' }), NOW, '360g');
  assert.equal(carton.unitWeightKg, 0.06);
});

test('3rd review 4: priceChanged compares the MONEY, not the stored representation', () => {
  const kg2 = { priceUnit: 'kg', pricePerUnit: 2 };
  // the same money in another shape: no change
  assert.equal(PM.priceChanged(kg2, { priceUnit: 'pcs', pricePerUnit: 5, unitWeightKg: 2.5 }), false, '2 a kilo is 5 for 2.5 kg');
  assert.equal(PM.priceChanged({ priceUnit: 'pcs', pricePerUnit: 5, unitWeightKg: 2.5 }, kg2), false);
  assert.equal(PM.priceChanged({ priceUnit: 'pcs', pricePerUnit: 3.333333, unitWeightKg: 1 }, { priceUnit: 'pcs', pricePerUnit: 3.3333, unitWeightKg: 1 }), false, 'within rounding');
  assert.equal(PM.priceChanged(kg2, { priceUnit: 'l', pricePerUnit: 2 }), false, 'a litre is read as a kilo');
  // a real change in either dimension
  assert.equal(PM.priceChanged(kg2, { priceUnit: 'pcs', pricePerUnit: 6, unitWeightKg: 2.5 }), true);
  assert.equal(PM.priceChanged(kg2, { priceUnit: 'kg', pricePerUnit: 2.1 }), true);
  assert.equal(PM.priceChanged({ priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 }, { priceUnit: 'pcs', pricePerUnit: 0.26, unitWeightKg: 0.06 }), true);
  // a changed piece weight IS a change (the divisor of the cost per kilo), and so is one appearing
  assert.equal(PM.priceChanged({ priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 }, { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.07 }), true);
  assert.equal(PM.priceChanged({ priceUnit: 'pcs', pricePerUnit: 0.25 }, { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 }), true);
  // nothing to compare: the representation decides, as it always did
  assert.equal(PM.priceChanged(null, { priceUnit: 'kg', pricePerUnit: 2 }), true);
  assert.equal(PM.priceChanged({}, {}), false);
  assert.equal(PM.priceChanged({ priceUnit: 'pcs', pricePerUnit: 1 }, { priceUnit: 'pcs', pricePerUnit: 1.5 }), true);
  assert.equal(PM.priceChanged({ priceUnit: 'pcs', pricePerUnit: 1 }, { priceUnit: 'pcs', pricePerUnit: 1 }), false);
});

test('3rd review 5: a per-item price carried from a case keeps six decimals when the card writes it', () => {
  const single = { kind: 'single', count: null, inner: '' };
  const patch = PM.pricePatch(PM.formatPriceInput(single, '1kg', { price: '3.333333', vat: '' }), NOW, '1kg');
  assert.equal(patch.pricePerUnit, 3.333333);
});
