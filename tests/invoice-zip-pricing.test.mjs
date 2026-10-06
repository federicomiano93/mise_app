// Port of invoice-import/tests/test_pricing.py. Invented invoices only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundHalfUp, unitClass, params as makeParams } from '../js/orders/invoice-zip/pricing.js';
import { evaluate, makeConfig, proposeParams, typeOf, vatOf } from '../js/orders/invoice-zip/products.js';
import { newCase } from './helpers/invoice-builders.mjs';

test('weight and volume units', () => {
  for (const raw of ['KG', 'kg', 'KGM', 'KILOGRAMMI', 'KG.']) assert.deepEqual(unitClass(raw), ['kg', 1.0], raw);
  for (const raw of ['GR', 'G', 'GRAMMI']) assert.deepEqual(unitClass(raw), ['kg', 0.001], raw);
  for (const raw of ['QL', 'QLI', 'QUINTALI']) assert.deepEqual(unitClass(raw), ['kg', 100.0], raw);
  for (const raw of ['LT', 'L', 'LITRI']) assert.deepEqual(unitClass(raw), ['l', 1.0], raw);
  assert.deepEqual(unitClass('ML'), ['l', 0.001]);
  assert.deepEqual(unitClass('CL'), ['l', 0.01]);
});

test('every other unit is pieces', () => {
  for (const raw of ['PZ', 'NR', 'N.', 'CT', 'CF', 'CONF', 'SC', 'BT', '', null, 'constructor', 'toString']) {
    assert.equal(unitClass(raw)[0], 'pc', String(raw));
  }
});

test('rounding is half up', () => {
  assert.equal(roundHalfUp(0.00005, 4), 0.0001);
  assert.equal(roundHalfUp(2.675, 2), 2.68);
});

// One invented invoice (or more) -> the only product, its proposal and its evaluation.
function evaluateOnly(c, options = {}) {
  const [catalogue, product] = c.onlyProduct(c.catalogue(options));
  const p = proposeParams(product, catalogue.config);
  return { catalogue, product, params: p, ev: evaluate(product, p, catalogue) };
}
function priceOf(ev) {
  assert.equal(ev.points.length, 1, ev.note);
  return ev.points[0];
}

test('every spelling of kg gives a price per kg', () => {
  for (const unit of ['KG', 'KGM', 'KILOGRAMMI', 'KILOGRAMMO']) {
    const c = newCase();
    c.add([{ desc: 'FARINA TIPO 00', qty: 25, unit, total: 14.25 }]);
    const { params, ev } = evaluateOnly(c);
    const point = priceOf(ev);
    assert.deepEqual([point.price, point.qty, params.priceUnit], [0.57, 25.0, 'kg'], unit);
    assert.equal(ev.reliability, 'alta');
  }
});

test('quintals become kilograms', () => {
  const c = newCase();
  c.add([{ desc: 'FARINA', qty: 1, unit: 'QL', total: 57 }]);
  const point = priceOf(evaluateOnly(c).ev);
  assert.deepEqual([point.price, point.qty], [0.57, 100.0]);
});

test('grams, litres and millilitres', () => {
  let c = newCase();
  c.add([{ desc: 'LIEVITO SECCO', qty: 500, unit: 'GR', total: 5 }]);
  let { params, ev } = evaluateOnly(c);
  assert.deepEqual([priceOf(ev).price, priceOf(ev).qty, params.priceUnit], [10.0, 0.5, 'kg']);

  c = newCase();
  c.add([{ desc: 'OLIO DI OLIVA', qty: 10, unit: 'LT', total: 50 }]);
  ({ params, ev } = evaluateOnly(c));
  assert.deepEqual([priceOf(ev).price, params.priceUnit], [5.0, 'l']);
  assert.equal(ev.reliability, 'alta');

  c = newCase();
  c.add([{ desc: 'ESSENZA', qty: 500, unit: 'ML', total: 5 }]);
  ({ params, ev } = evaluateOnly(c));
  assert.deepEqual([priceOf(ev).price, priceOf(ev).qty, params.priceUnit], [10.0, 0.5, 'l']);
});

test('kg times count in the description', () => {
  const c = newCase();
  c.add([{ desc: 'PASSATA kg 2,5 x 4', qty: 3, unit: 'CT', total: 60 }]);
  const { params, ev } = evaluateOnly(c);
  assert.equal(params.priceUnit, 'kg');
  assert.deepEqual([params.pack.size, params.pack.unit, params.packCount], [2.5, 'kg', 4]);
  const point = priceOf(ev);
  assert.deepEqual([point.price, point.qty], [2.0, 30.0]); // 3 cartons x 4 x 2.5 kg
  assert.equal(ev.reliability, 'media');
});

test('grams in packs', () => {
  const c = newCase();
  c.add([{ desc: 'LIEVITO GR.250', qty: 10, unit: 'PZ', total: 25 }]);
  const { params, ev } = evaluateOnly(c);
  assert.deepEqual([params.pack.size, params.pack.unit], [250, 'g']);
  assert.deepEqual([priceOf(ev).price, priceOf(ev).qty], [10.0, 2.5]);
});

test('litres in bottles stay litres', () => {
  const c = newCase();
  c.add([{ desc: 'OLIO LT 1', qty: 6, unit: 'NR', total: 30 }]);
  const { params, ev } = evaluateOnly(c);
  assert.equal(params.priceUnit, 'l');
  assert.deepEqual([priceOf(ev).price, priceOf(ev).qty], [5.0, 6.0]);
});

test('eggs are priced per egg', () => {
  const c = newCase();
  c.add([{ desc: 'UOVA FRESCHE DA 30 UOVA', qty: 2, unit: 'CT', total: 36 }]);
  const { params, ev } = evaluateOnly(c, { eggWeightG: 50 });
  assert.deepEqual([params.priceUnit, params.packCount], ['pcs', 30]);
  const point = priceOf(ev);
  assert.deepEqual([point.price, point.qty], [0.6, 60.0]);
  assert.equal(ev.unitWeightKg, 0.05);
  assert.equal(ev.reliability, 'media');
});

test('the egg weight is an option, 50 g by default', () => {
  const c = newCase();
  c.add([{ desc: 'UOVA DA 30 UOVA', qty: 1, unit: 'CT', total: 30 }]);
  assert.equal(evaluateOnly(c, { eggWeightG: 60 }).ev.unitWeightKg, 0.06);
  assert.equal(evaluateOnly(c).ev.unitWeightKg, 0.05);
  for (const bad of [0, -3, NaN, '50', null]) assert.equal(makeConfig({ eggWeightG: bad }).eggWeightG, 50);
});

test('eggs without a count count one per unit', () => {
  const c = newCase();
  c.add([{ desc: 'UOVA CAT. M', qty: 10, unit: 'PZ', total: 3 }]);
  assert.equal(priceOf(evaluateOnly(c).ev).price, 0.3);
});

test('pasta with egg invoiced by kg is not treated as eggs', () => {
  const c = newCase();
  c.add([{ desc: "PASTA ALL'UOVO", qty: 2, unit: 'KG', total: 10 }]);
  const { params, ev } = evaluateOnly(c);
  assert.deepEqual([params.priceUnit, params.egg, priceOf(ev).price], ['kg', false, 5.0]);
});

test('pieces with no weight need checking and have no price', () => {
  const c = newCase();
  c.add([{ desc: 'TEGLIA ALLUMINIO', qty: 4, unit: 'PZ', total: 20 }]);
  const { params, ev } = evaluateOnly(c);
  assert.equal(params.priceUnit, null);
  assert.deepEqual(ev.points, []);
  assert.equal(ev.reliability, 'da verificare');
});

// ── the «X 30» of an egg line may or may not be applied on top of the quantity ──

const UNCLEAR = 'egg-quantity-unclear';

test('eggs: a quantity already in eggs is not divided by the tray size again', () => {
  const c = newCase();
  c.add([{ desc: 'UOVA IN VASSOI X 30L', qty: 180, unit: 'NR', total: 27.27 }]);
  const { params, ev } = evaluateOnly(c);
  assert.equal(params.packCount, 30);
  assert.deepEqual([priceOf(ev).price, priceOf(ev).qty], [0.1515, 180.0]);
  assert.equal(ev.reliability, 'media');
});

test('eggs: a quantity in packs is multiplied by the pack count', () => {
  const c = newCase();
  c.add([{ desc: 'CONFEZIONE DA 4 UOVA FRESCHE', qty: 77, unit: 'pz', total: 90.86 }]);
  const { params, ev } = evaluateOnly(c);
  assert.equal(params.packCount, 4);
  assert.deepEqual([priceOf(ev).price, priceOf(ev).qty], [0.295, 308.0]);
  assert.equal(ev.reliability, 'media');
});

test('eggs: both readings believable counts packs and asks for a check', () => {
  // 4.00 / 10 = 0.40 per egg and 4.00 / 40 = 0.10 per egg: both are egg prices.
  const c = newCase();
  c.add([{ desc: 'CONFEZIONE DA 4 UOVA FRESCHE', qty: 10, unit: 'pz', total: 4 }]);
  const { ev } = evaluateOnly(c);
  assert.deepEqual([priceOf(ev).price, priceOf(ev).qty], [0.1, 40.0]);
  assert.deepEqual([ev.reliability, ev.note], ['da verificare', UNCLEAR]);
});

test('eggs: neither reading believable counts packs and asks for a check', () => {
  // 100 / 1 = 100 per egg and 100 / 30 = 3.33 per egg: neither is an egg price.
  const c = newCase();
  c.add([{ desc: 'UOVA IN VASSOI X 30', qty: 1, unit: 'NR', total: 100 }]);
  const { ev } = evaluateOnly(c);
  assert.deepEqual([priceOf(ev).price, priceOf(ev).qty], [3.3333, 30.0]);
  assert.deepEqual([ev.reliability, ev.note], ['da verificare', UNCLEAR]);
});

test('eggs: a pack count corrected by the owner still drives the packs reading', () => {
  const c = newCase();
  c.add([{ desc: 'UOVA IN VASSOI X 30', qty: 10, unit: 'NR', total: 60 }]);
  const [catalogue, product] = c.onlyProduct();
  const proposal = proposeParams(product, catalogue.config);
  const p = makeParams({ ...proposal, packCount: 20 });
  const ev = evaluate(product, p, catalogue);
  // eggs: 6.00 (out), packs of 20: 0.30 (in)
  assert.deepEqual([priceOf(ev).price, priceOf(ev).qty], [0.3, 200.0]);
});

// ── unit first, then size x count ──

test('millilitre portions are summed into litres', () => {
  const c = newCase();
  c.add([{ desc: 'ML10X102 OLIO EVO MONODOSE', qty: 1, unit: 'NR', total: 15.63 }]);
  const { params, ev } = evaluateOnly(c);
  assert.deepEqual([params.pack.size, params.pack.unit, params.packCount], [10, 'ml', 102]);
  assert.deepEqual([priceOf(ev).price, priceOf(ev).qty], [15.3235, 1.02]);
  assert.equal(ev.reliability, 'media');
});

test('gram portions are summed into kilograms', () => {
  const c = newCase();
  c.add([{ desc: 'GR25X40 ZUCCHERO BUSTINE', qty: 2, unit: 'CT', total: 6 }]);
  const { params, ev } = evaluateOnly(c);
  assert.deepEqual([params.pack.size, params.pack.unit, params.packCount], [25, 'g', 40]);
  assert.deepEqual([priceOf(ev).price, priceOf(ev).qty], [3.0, 2.0]);
});

test('kilograms times count', () => {
  const c = newCase();
  c.add([{ desc: 'KG1X10 FARINA', qty: 3, unit: 'CT', total: 24 }]);
  const { params, ev } = evaluateOnly(c);
  assert.deepEqual([params.pack.size, params.pack.unit, params.packCount], [1, 'kg', 10]);
  assert.deepEqual([priceOf(ev).price, priceOf(ev).qty], [0.8, 30.0]);
});

// ── an implausible price is never «alta» or «media» ──

const OUT_OF_SCALE = 'price-out-of-scale';
function checkOutOfScale(row, expectedPrice) {
  const c = newCase();
  c.add([row]);
  const { ev } = evaluateOnly(c);
  assert.equal(priceOf(ev).price, expectedPrice);
  assert.deepEqual([ev.reliability, ev.note], ['da verificare', OUT_OF_SCALE]);
}

test('too cheap per kg', () => checkOutOfScale({ desc: 'FARINA', qty: 100, unit: 'KG', total: 4 }, 0.04));
test('too dear per kg', () => checkOutOfScale({ desc: 'FARINA', qty: 1, unit: 'KG', total: 350 }, 350.0));
test('too dear per litre from a misread pack', () => {
  checkOutOfScale({ desc: 'OLIO LT 0,01', qty: 1, unit: 'NR', total: 15 }, 1500.0);
});
test('pieces below and above their range', () => {
  checkOutOfScale({ desc: 'UOVA CAT. M', qty: 1000, unit: 'PZ', total: 5 }, 0.005);
  checkOutOfScale({ desc: 'UOVA CAT. M', qty: 1, unit: 'PZ', total: 60 }, 60.0);
});
test('the bounds themselves are fine', () => {
  for (const total of [5, 300]) { // exactly 0.05 and 300 per kg
    const c = newCase();
    c.add([{ desc: 'SPEZIA', qty: total === 5 ? 100 : 1, unit: 'KG', total }]);
    assert.equal(evaluateOnly(c).ev.reliability, 'alta', String(total));
  }
});

// ── document rules ──

test('free goods on a separate line lower the price', () => {
  const c = newCase();
  c.add([
    { desc: 'BURRO PANETTO', code: 'B1', qty: 10, unit: 'KG', total: 100 },
    { desc: 'BURRO PANETTO OMAGGIO', code: 'B1', qty: 1, unit: 'KG', total: 0 },
  ]);
  const point = priceOf(evaluateOnly(c).ev);
  assert.deepEqual([point.price, point.qty, point.line], [9.0909, 11.0, 1]);
});

test('a discount line that names no product flags every product of the document', () => {
  const c = newCase();
  c.add([
    { desc: 'FARINA', qty: 10, unit: 'KG', total: 10 },
    { desc: 'ZUCCHERO', qty: 10, unit: 'KG', total: 12 },
    { desc: 'SCONTO', total: -3 },
  ]);
  const catalogue = c.catalogue();
  assert.equal(catalogue.products.size, 2);
  for (const product of catalogue.products.values()) {
    const ev = evaluate(product, proposeParams(product, catalogue.config), catalogue);
    assert.equal(ev.reliability, 'da verificare');
    assert.equal(ev.note, 'unattributed-discount');
    assert.equal(ev.points.length, 1);
  }
  assert.ok(catalogue.excluded.filter((e) => e.level === 'line').map((e) => e.reason).includes('separate-discount-line'));
});

test('two invoices give two price points, oldest first', () => {
  const c = newCase();
  c.add([{ desc: 'FARINA', code: 'F', qty: 10, unit: 'KG', total: 6 }], { date: '2026-09-10' });
  c.add([{ desc: 'FARINA', code: 'F', qty: 10, unit: 'KG', total: 5 }], { date: '2026-09-01' });
  const { ev } = evaluateOnly(c);
  assert.deepEqual(ev.points.map((p) => p.price), [0.5, 0.6]);
  assert.deepEqual(ev.points.map((p) => p.date), ['2026-09-01', '2026-09-10']);
});

test('zero quantity needs checking', () => {
  const c = newCase();
  c.add([{ desc: 'FARINA', qty: 0, unit: 'KG', total: 5 }]);
  const { ev } = evaluateOnly(c);
  assert.deepEqual([ev.points, ev.reliability, ev.note], [[], 'da verificare', 'quantity-zero-or-negative']);
});

test('the sugar in sacks is an ingredient', () => {
  const c = newCase();
  c.add([{ desc: 'ZUCCHERO SACCHI DA KG 25', qty: 2, unit: 'PZ', total: 50 }]);
  const [, product] = c.onlyProduct();
  assert.equal(typeOf(product), 'ingrediente');
});

test('info lines and costs are listed as excluded', () => {
  const c = newCase();
  c.add([
    { desc: 'FARINA', qty: 1, unit: 'KG', total: 1 },
    { desc: 'LOTTO 1234' },
    { desc: 'SPESE DI TRASPORTO', qty: 1, total: 4 },
  ]);
  const [catalogue] = c.onlyProduct();
  assert.deepEqual(catalogue.excluded.map((e) => e.reason).sort(), ['costs', 'info-line']);
});

test('the VAT rate only when it is a known one', () => {
  assert.equal(vatOf(22.0), 22);
  assert.equal(vatOf(4.0), 4);
  assert.equal(vatOf(0), 0);
  assert.equal(vatOf(21.0), null);
  assert.equal(vatOf(null), null);
});

test('mixed units on one invoice need checking', () => {
  const c = newCase();
  c.add([
    { desc: 'FARINA', code: 'F', qty: 10, unit: 'KG', total: 10 },
    { desc: 'FARINA', code: 'F', qty: 3, unit: 'PZ', total: 3 },
  ]);
  const { ev } = evaluateOnly(c);
  assert.deepEqual([ev.reliability, ev.note], ['da verificare', 'mixed-units']);
});
