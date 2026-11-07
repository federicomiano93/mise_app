// foodcost-preview.test.mjs — the product preview, the ideal price and the list's search.
//
// Federico, 7 Nov 2026 («ok procedi»): a search bar in the Food cost list; tapping a product
// shows, before the whole card, its selling price, raw materials, packaging, labour (only
// where time and rate are known), total cost, food cost against its target, margin on the
// net price and the ideal price with and without VAT; and the ideal price at the top of the
// card, with the same numbers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  productPreview, suggestedNetPrice, suggestedGrossPrice, nameMatches, productionCost, costProduct,
  sortByMargin, blockerText, BLOCKER_TEXT,
} from '../js/foodcost/foodcost-model.js';
import { _dictionaries } from '../js/i18n.js';

const INGREDIENTS = {
  FLOUR: { id: 'FLOUR', priceUnit: 'kg', pricePerUnit: 2 },
  BUTTER: { id: 'BUTTER', priceUnit: 'kg', pricePerUnit: 8 },
  BAG: { id: 'BAG', priceUnit: 'pcs', pricePerUnit: 0.05 },
};
const DOUGH = { id: 'DOUGH', name: 'Dough', lossPct: 0, ingredients: [
  { label: 'Flour', grams: 800, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
  { label: 'Butter', grams: 200, unit: 'g', kind: 'ingredient', refId: 'BUTTER' },
] };
const tables = (over = {}) => ({ ingredients: INGREDIENTS, recipes: { DOUGH }, ...over });
// 10 kg of dough at 3.20/kg = 32.00 a batch, 100 pieces → 0.32 of materials a piece.
const product = (over = {}) => ({
  id: 'P1', name: 'Cornetto', components: [{ recipeId: 'DOUGH', qtyKg: 10 }], packaging: [],
  sellingMode: 'piece', piecesPerBatch: 100, sellingPrice: 1.2, vatRate: 20, foodCostTarget: 30, ...over,
});

test('the net ideal price puts the food cost exactly at its target, without VAT', () => {
  assert.equal(suggestedNetPrice({ unitCost: 0.6, targetPct: 30 }), 2);
  assert.equal(suggestedNetPrice({ unitCost: 1.25, targetPct: 25 }), 5);
  // 0.50 / 0.30 = 1.6666… → 1.67, never 1.66: a price asked for a target must hit it.
  assert.equal(suggestedNetPrice({ unitCost: 0.5, targetPct: 30 }), 1.67);
  // A whole number of cents stays put (floating-point dust is not a cent).
  assert.equal(suggestedNetPrice({ unitCost: 0.72, targetPct: 30 }), 2.4);
});

test('⚠️ no cost or no target is NO ideal price — never 0, never NaN', () => {
  for (const args of [{ unitCost: null, targetPct: 30 }, { unitCost: 0.6, targetPct: null },
    { unitCost: 0, targetPct: 30 }, { unitCost: 'x', targetPct: 30 }, { unitCost: 0.6, targetPct: 0 },
    { unitCost: 0.6, targetPct: 120 }, {}, undefined]) {
    assert.equal(suggestedNetPrice(args), null, JSON.stringify(args));
  }
});

test('the preview shows his eight figures, from the same sums as the card', () => {
  const t = tables();
  const pv = productPreview(product(), t);
  const cost = productionCost(product(), t);
  const answer = costProduct(product(), t);
  assert.equal(pv.unit, 'piece');
  assert.equal(pv.sellingPrice, 1.2, '1 — the price as typed, VAT included');
  assert.equal(pv.materialsUnitCost, 0.32, '2 — raw materials only');
  assert.equal(pv.packagingUnitCost, 0, '3 — no packaging lines: nothing, and it says so');
  assert.equal(pv.hasPackaging, false);
  assert.equal(pv.labourUnitCost, null, '4 — no rate: no labour row');
  assert.equal(pv.totalUnitCost, cost.unitCost, '5 — the total is the card’s cost');
  assert.equal(pv.foodCostPct, answer.foodCostPct, '6 — the food cost is the card’s');
  assert.equal(pv.targetPct, 30);
  assert.equal(pv.status, answer.status);
  assert.equal(pv.margin, answer.margin, '7 — the margin on the net price, the card’s');
  assert.equal(pv.idealGross, suggestedGrossPrice({ unitCost: 0.32, vatRate: 20, targetPct: 30 }), '8 — with VAT, the card’s suggested price');
  assert.equal(pv.idealGross, 1.28);
  assert.equal(pv.idealNet, 1.07, '8 — and without VAT: 0.32 / 30%');
  assert.deepEqual(pv.missing, []);
  assert.equal(pv.partial, false);
});

test('packaging is shown apart from the raw materials, and the total holds both', () => {
  const p = product({ packaging: [{ ingredientId: 'BAG', qtyPcs: 2 }] });
  const pv = productPreview(p, tables());
  assert.equal(pv.materialsUnitCost, 0.32);
  assert.equal(pv.packagingUnitCost, 0.1, 'two bags at 0.05 a piece');
  assert.equal(pv.hasPackaging, true);
  assert.equal(pv.totalUnitCost, 0.42);
  assert.equal(pv.totalUnitCost, productionCost(p, tables()).unitCost);
  assert.equal(pv.idealNet, 1.4, '0.42 / 30%: the food cost counts the packaging, so the price does');
});

test('⚠️ an unpriced box is NOT a free box: no packaging figure, and it is named', () => {
  const t = tables({ ingredients: { ...INGREDIENTS, BOX: { id: 'BOX', priceUnit: 'kg', pricePerUnit: 3 } } });
  const pv = productPreview(product({ packaging: [{ ingredientId: 'BOX', qtyPcs: 1 }] }), t);
  assert.equal(pv.packagingUnitCost, null, 'a box priced by the kilo cannot be counted per piece');
  assert.ok(pv.missing.includes('no-packaging-price'));
  assert.equal(pv.partial, true);
  const gone = productPreview(product({ packaging: [{ ingredientId: 'DELETED', qtyPcs: 1 }] }), tables());
  assert.equal(gone.packagingUnitCost, null, 'a box deleted from Suppliers');
  assert.ok(gone.missing.includes('no-packaging-price'));
  const { en, it } = _dictionaries();
  assert.ok(en['fc.preview.needPackagingPrice'] && it['fc.preview.needPackagingPrice']);
});

test('labour appears only with minutes AND a rate, and goes into the total, never the food cost', () => {
  const p = product({ labourMinutes: 90, labourPeople: 2 });
  const withRate = productPreview(p, tables({ labourCostPerHour: 14 }));
  assert.equal(withRate.labourUnitCost, 0.42, '£42 over 100 pieces');
  assert.equal(withRate.totalUnitCost, 0.74, 'materials + packaging + labour');
  assert.equal(withRate.foodCostPct, productPreview(p, tables()).foodCostPct, 'labour never moves the food cost');
  assert.equal(withRate.idealNet, 1.07, 'the ideal price hits the FOOD COST target, so labour is not in it');
  const noRate = productPreview(p, tables());
  assert.equal(noRate.labourUnitCost, null, 'an employee is sent no rate: no labour figure at all');
  assert.equal(noRate.totalUnitCost, 0.32);
});

test('by weight and by the pack, the figures are per kg and per pack', () => {
  const kilo = productPreview(product({ sellingMode: 'weight', piecesPerBatch: null, sellingPrice: 12 }), tables());
  assert.equal(kilo.unit, 'kg');
  assert.equal(kilo.materialsUnitCost, 3.2);
  const pack = productPreview(product({ sellingMode: 'pack', packSize: 500, packUnit: 'g', piecesPerBatch: null, sellingPrice: 5 }), tables());
  assert.equal(pack.unit, 'pack');
  assert.equal(pack.materialsUnitCost, 1.6, '32.00 over 20 packs of 500 g');
});

test('⚠️⚠️ missing data names what is missing and gives no number', () => {
  const noTarget = productPreview(product({ foodCostTarget: null }), tables());
  assert.equal(noTarget.idealGross, null);
  assert.equal(noTarget.idealNet, null);
  assert.deepEqual(noTarget.missing, ['no-target']);
  assert.notEqual(noTarget.foodCostPct, null, 'the food cost itself needs no target');

  const noVat = productPreview(product({ vatRate: null }), tables());
  assert.equal(noVat.idealGross, null, 'no VAT: no shelf price');
  assert.equal(noVat.idealNet, 1.07, '…but what it must earn net is still known');
  assert.equal(noVat.foodCostPct, null);
  assert.equal(noVat.margin, null);
  assert.ok(noVat.missing.includes('no-vat'));

  const noPrice = productPreview(product({ sellingPrice: null }), tables());
  assert.equal(noPrice.sellingPrice, null);
  assert.equal(noPrice.foodCostPct, null);
  assert.equal(noPrice.idealNet, 1.07, 'the ideal price is exactly what a product with no price needs');
  assert.ok(noPrice.missing.includes('no-price'));

  const noPieces = productPreview(product({ piecesPerBatch: null }), tables());
  assert.equal(noPieces.materialsUnitCost, null);
  assert.equal(noPieces.packagingUnitCost, null);
  assert.equal(noPieces.totalUnitCost, null);
  assert.equal(noPieces.idealNet, null);
  assert.equal(noPieces.unit, 'piece', 'the unit is still the one it is sold by');
  assert.ok(noPieces.missing.includes('no-pieces'));

  const empty = productPreview({ id: 'X', name: 'New' }, tables());
  for (const key of ['sellingPrice', 'materialsUnitCost', 'packagingUnitCost', 'labourUnitCost',
    'totalUnitCost', 'foodCostPct', 'targetPct', 'margin', 'idealGross', 'idealNet', 'unit']) {
    assert.equal(empty[key], null, key);
  }
  assert.deepEqual(empty.missing.slice(0, 2), ['no-components', 'no-selling-mode'], 'in the order a person fills them in');
});

test('a partly priced product says so in the preview too', () => {
  const t = tables({ recipes: { DOUGH: { ...DOUGH, ingredients: [...DOUGH.ingredients,
    { label: 'Salt', grams: 10, unit: 'g', kind: 'ingredient', refId: 'NOPE' }] } } });
  assert.equal(productPreview(product(), t).partial, true);
});

test('junk never throws and never yields NaN', () => {
  for (const raw of [null, undefined, 'x', 42, {}, { components: 'no' }]) {
    const pv = productPreview(raw, {});
    for (const [key, value] of Object.entries(pv)) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} of ${JSON.stringify(raw)}`);
    }
  }
});

test('«no target» has its words in both languages', () => {
  assert.equal(BLOCKER_TEXT['no-target'], 'fc.preview.needTarget');
  const { en, it } = _dictionaries();
  assert.ok(en['fc.preview.needTarget']);
  assert.ok(it['fc.preview.needTarget']);
  assert.notEqual(blockerText('no-target'), 'no-target');
});

test('the search finds a name whatever the accents, capitals and spaces', () => {
  const caffe = { name: 'Cornetto al Caffè' };
  assert.equal(nameMatches(caffe, 'caffe'), true);
  assert.equal(nameMatches(caffe, '  CAFFÈ '), true);
  assert.equal(nameMatches(caffe, 'tto al'), true, 'any part of the name');
  assert.equal(nameMatches(caffe, 'crema'), false);
  assert.equal(nameMatches(caffe, ''), true, 'nothing typed: the whole list');
  assert.equal(nameMatches(caffe, '   '), true);
  assert.equal(nameMatches({}, 'x'), false, 'no name never throws');
  assert.equal(nameMatches(null, 'x'), false);
});

test('⚠️ the search keeps the worst-margin-first order of the rows it leaves', () => {
  const t = tables();
  const products = [
    product({ id: 'A', name: 'Cornetto vuoto', sellingPrice: 2 }),
    product({ id: 'B', name: 'Brioche', sellingPrice: 1 }),
    product({ id: 'C', name: 'Cornetto crema', sellingPrice: 0.9 }),
  ];
  const ids = sortByMargin(products, t).filter(({ product: p }) => nameMatches(p, 'cornetto')).map(r => r.product.id);
  assert.deepEqual(ids, ['C', 'A'], 'the worse margin still first');
});
