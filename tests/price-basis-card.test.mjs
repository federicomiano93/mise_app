// The ingredient card's «what does this number refer to» choice, EXECUTED against the fake DOM
// (tests/helpers/form-dom.mjs): which forms show the selector, what the box and its label say per basis,
// that tapping a segment converts a typed number and re-shows an untouched one, what an untouched or
// basis-only save sends, and that a basis-only change plants no price-history entry.
// The pure conversions are in price-basis.test.mjs. It proves what the card decides, not how it looks.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

import { installDom, walk, type, click, shown } from './helpers/form-dom.mjs';

const STUB = new URL('./helpers/session-stub.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './firebase.js' && String(context.parentURL).endsWith('/js/ingredient-record-form.js')) {
      return { url: STUB, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

installDom();
globalThis.__miseTestSession = { location: { id: 'loc-test', country: 'IT', language: 'en' } };
const { buildIngredientForm } = await import('../js/ingredient-record-form.js');
const { setCurrency } = await import('../js/currency.js');
const { setLanguage } = await import('../js/i18n.js');
const { snapshotFields, snapshotChanged } = await import('../js/form-dirty.js');
before(() => { setCurrency('€'); setLanguage('en'); });

const BASE = { id: 'I1', name: 'Farina', supplierId: 'S1', brand: '', category: 'Other', active: true, kind: 'ingredient', vatRate: 4 };
// A 10 kg sack at 9.60 (what the card writes for a Singola).
const SACK = { ...BASE, unit: 'sacco', weight: '10kg', priceUnit: 'pcs', pricePerUnit: 9.6, unitWeightKg: 10, priceUpdatedAt: '2026-10-01T08:00:00.000Z' };
// A carton of 6 bags of 500 g at 30 (the case is stored per item, as the card writes it).
const CARTON = {
  ...BASE, unit: 'cartone', packUnit: 'busta', packCount: 6, weight: '500g',
  priceUnit: 'pcs', pricePerUnit: 5, unitWeightKg: 0.5, casePrice: 30, caseCount: 6, caseItemUnit: 'pcs',
  priceUpdatedAt: '2026-10-01T08:00:00.000Z',
};
const LOOSE = { ...BASE, unit: 'kg', weight: '', priceUnit: 'kg', pricePerUnit: 7.2 };
// An old stored shape: the card of before opens, and it has no selector.
const OLD = { ...BASE, unit: 'cartone', weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' };

function openCard(item) {
  const saves = [];
  const root = buildIngredientForm({
    item,
    suppliers: [{ id: 'S1', name: 'Molino' }],
    mayPrice: true,
    categories: ['Panetteria', 'Pasticceria', 'Vendita'],
    orderUnits: ['busta', 'cartone', 'kg', 'l', 'pz'],
    packs: ['barattolo', 'bottiglia', 'busta', 'pezzo', 'sacco', 'scatola', 'vaschetta'],
    panels: { allergens: false, nutrition: false },
    actions: {
      saveIngredient: async (id, payload, record, writePrice, meta) => { saves.push({ id, payload, record, writePrice, meta }); },
      priceHistory: async () => [],
      packPhotoOn: () => false,
    },
    onDone: () => {},
  });
  const all = () => walk(root);
  const priceBox = () => {
    const label = all().find(n => n.tagName === 'LABEL' && walk(n).some(c => c.classList.contains('mgmt-field-label')
      && /^(Pack price|Case price|Price per kg|Price per litre)/.test(c.textContent)));
    return label && walk(label).find(n => n.tagName === 'INPUT');
  };
  const priceLabel = () => {
    const box = priceBox();
    return box && walk(box.parentNode).find(n => n.classList.contains('mgmt-field-label')).textContent;
  };
  const basisButtons = () => all().filter(n => n.tagName === 'BUTTON' && n.attributes['data-basis'] !== undefined && shown(n));
  const basisNamed = (text) => basisButtons().find(b => b.textContent === text);
  const summary = () => all().filter(n => n.classList.contains('mgmt-price-main') && shown(n)).map(n => n.textContent).join(' ');
  const card = {
    root, saves, all, priceBox, priceLabel, basisButtons, basisNamed, summary,
    pressed: () => basisButtons().filter(b => b.attributes['aria-pressed'] === 'true').map(b => b.textContent),
    async save() { click(root.headerSave); await new Promise(r => setImmediate(r)); return saves[saves.length - 1]; },
  };
  return card;
}

test('a Singola with a readable weight offers «per pack | per kg», opens on «per pack», and says «Pack price»', () => {
  const card = openCard(SACK);
  assert.deepEqual(card.basisButtons().map(b => b.textContent), ['per pack', 'per kg']);
  assert.deepEqual(card.pressed(), ['per pack']);
  assert.equal(card.priceLabel(), 'Pack price (€)');
  assert.equal(card.priceBox().value, '9.6');
});

test('a litre weight says «per litre», and its price label follows', () => {
  const card = openCard({ ...SACK, weight: '750ml', unitWeightKg: 0.75, pricePerUnit: 2.5275 });
  assert.deepEqual(card.basisButtons().map(b => b.textContent), ['per pack', 'per litre']);
  click(card.basisNamed('per litre'));
  assert.equal(card.priceLabel(), 'Price per litre (€)');
  assert.equal(card.priceBox().value, '3.37');
});

test('a Cartone offers «per case | per pack | per kg» and opens on «per case» with its price', () => {
  const card = openCard(CARTON);
  assert.deepEqual(card.basisButtons().map(b => b.textContent), ['per case', 'per pack', 'per kg']);
  assert.deepEqual(card.pressed(), ['per case']);
  assert.equal(card.priceLabel(), 'Case price (€)');
  assert.equal(card.priceBox().value, '30');
});

test('the typed form (no readable weight) and the card of before show no selector', () => {
  const loose = openCard(LOOSE);
  assert.equal(loose.basisButtons().length, 0);
  const old = openCard(OLD);
  assert.equal(old.all().some(n => n.attributes['data-basis'] !== undefined), false, 'the old card draws none at all');
});

test('tapping a segment on an untouched price re-shows the SAME money in the new basis', () => {
  const card = openCard(CARTON);
  click(card.basisNamed('per pack'));
  assert.equal(card.priceLabel(), 'Pack price (€)');
  assert.equal(card.priceBox().value, '5');
  click(card.basisNamed('per kg'));
  assert.equal(card.priceLabel(), 'Price per kg (€)');
  assert.equal(card.priceBox().value, '10');
  assert.match(card.summary(), /= €30\.00 per case/);
  assert.match(card.summary(), /= €5\.00 per pack/);
  click(card.basisNamed('per case'));
  assert.equal(card.priceBox().value, '30');
});

test('tapping a segment on a number being typed CONVERTS it, never keeps the digits', () => {
  const card = openCard(SACK);
  type(card.priceBox(), '12');
  click(card.basisNamed('per kg'));
  assert.equal(card.priceBox().value, '1.2');
  type(card.priceBox(), '1.5');
  click(card.basisNamed('per pack'));
  assert.equal(card.priceBox().value, '15');
});

test('a basis-only change saves priceBasis, the same money, and NO history record', async () => {
  const card = openCard(SACK);
  click(card.basisNamed('per kg'));
  const { payload, record } = await card.save();
  assert.equal(payload.priceBasis, 'rate');
  assert.equal(payload.priceUnit, 'pcs');
  assert.equal(payload.pricePerUnit, 9.6);
  assert.equal(payload.unitWeightKg, 10);
  assert.equal(record, null, 'nothing moved in the money, so nothing is written to the history');
});

test('a basis-only change on a Cartone keeps the case verbatim and records nothing', async () => {
  const card = openCard(CARTON);
  click(card.basisNamed('per pack'));
  const { payload, record } = await card.save();
  assert.equal(payload.priceBasis, 'pack');
  assert.equal(payload.casePrice, 30);
  assert.equal(payload.caseCount, 6);
  assert.equal(payload.pricePerUnit, 5);
  assert.equal(record, null);
});

test('an untouched save with nothing chosen writes priceBasis null (the default)', async () => {
  for (const item of [SACK, CARTON]) {
    const { payload, record } = await openCard(item).save();
    assert.equal(payload.priceBasis, null);
    assert.equal(record, null);
  }
});

test('a number typed per kg is saved as the pack price, a new price records history, and the choice is kept', async () => {
  const card = openCard(SACK);
  click(card.basisNamed('per kg'));
  type(card.priceBox(), '0.97');
  const { payload, record } = await card.save();
  assert.equal(payload.priceBasis, 'rate');
  assert.equal(payload.pricePerUnit, 9.7);
  assert.equal(payload.priceUnit, 'pcs');
  assert.equal(payload.unitWeightKg, 10);
  assert.ok(record, 'the money moved: one history record');
  assert.equal(record.pricePerUnit, 9.7);
});

test('a Cartone typed per pack is saved as the case, per kg likewise', async () => {
  const byPack = openCard(CARTON);
  click(byPack.basisNamed('per pack'));
  type(byPack.priceBox(), '5.5');
  const a = (await byPack.save()).payload;
  assert.equal(a.casePrice, 33);
  assert.equal(a.priceBasis, 'pack');

  const byKg = openCard(CARTON);
  click(byKg.basisNamed('per kg'));
  type(byKg.priceBox(), '11');
  const b = (await byKg.save()).payload;
  assert.equal(b.casePrice, 33);
  assert.equal(b.caseCount, 6);
  assert.equal(b.priceBasis, 'rate');
});

test('reopening an ingredient saved per kg shows 0.96 again, and per pack 9.6 on a tap', () => {
  const card = openCard({ ...SACK, priceBasis: 'rate' });
  assert.deepEqual(card.pressed(), ['per kg']);
  assert.equal(card.priceLabel(), 'Price per kg (€)');
  assert.equal(card.priceBox().value, '0.96');
  click(card.basisNamed('per pack'));
  assert.equal(card.priceBox().value, '9.6');
});

test('a stored basis this form does not offer falls back to the default', () => {
  const card = openCard({ ...SACK, priceBasis: 'case' });
  assert.deepEqual(card.pressed(), ['per pack']);
  assert.equal(card.priceBox().value, '9.6');
});

test('a person with no price access (no price block) has no selector', () => {
  const root = buildIngredientForm({
    item: SACK, suppliers: [], mayPrice: false, categories: [], orderUnits: [], packs: [],
    panels: { allergens: false, nutrition: false },
    actions: { saveIngredient: async () => {}, priceHistory: async () => [], packPhotoOn: () => false },
    onDone: () => {},
  });
  assert.equal(walk(root).some(n => n.attributes['data-basis'] !== undefined), false);
});

// ── No drift, and a typed number is never wiped (review of 7 Oct 2026) ────────────────────────────────
const cardField = (card, text) => {
  const label = card.all().find(n => n.tagName === 'LABEL' && walk(n).some(c => c.classList.contains('mgmt-field-label') && text.test(c.textContent)));
  return label && walk(label).find(n => n.tagName === 'INPUT');
};

test('Cartone 1.00 → per kg → per case comes back as exactly 1 (6 × 25 kg), and saves 1', async () => {
  const item = {
    ...BASE, unit: 'cartone', packUnit: 'busta', packCount: 6, weight: '25kg',
    priceUnit: 'pcs', pricePerUnit: 0.166667, unitWeightKg: 25, casePrice: 1, caseCount: 6, caseItemUnit: 'pcs',
  };
  const card = openCard(item);
  type(card.priceBox(), '1');
  click(card.basisNamed('per kg'));
  assert.notEqual(card.priceBox().value, '1');
  click(card.basisNamed('per pack'));
  click(card.basisNamed('per kg'));
  click(card.basisNamed('per case'));
  assert.equal(card.priceBox().value, '1');
  click(card.basisNamed('per kg'));
  const { payload } = await card.save();
  assert.equal(payload.casePrice, 1);
  assert.equal(payload.priceBasis, 'rate');
});

test('a 750-piece carton at 23.47, shown per pack, stays 23.47 when only the piece weight changes', async () => {
  const item = {
    ...BASE, unit: 'cartone', packUnit: 'pezzo', packCount: 750, weight: '',
    priceUnit: 'pcs', pricePerUnit: 0.031293, unitWeightKg: 0.06, casePrice: 23.47, caseCount: 750, caseItemUnit: 'pcs',
    priceBasis: 'pack',
  };
  const card = openCard(item);
  assert.deepEqual(card.pressed(), ['per pack']);
  type(cardField(card, /^Weight of one piece/), '0.05');
  const { payload } = await card.save();
  assert.equal(payload.casePrice, 23.47);
  assert.equal(payload.unitWeightKg, 0.05);
  assert.equal(payload.priceBasis, 'pack');
});

test('a tap that cannot convert (empty carton count) does nothing: the number and the segment stay', () => {
  const card = openCard(CARTON);
  type(card.priceBox(), '30');
  const count = card.all().find(n => n.tagName === 'INPUT' && n.attributes['aria-label'] === 'How many in the case');
  type(count, '');
  click(card.basisNamed('per pack'));
  assert.equal(card.priceBox().value, '30');
  assert.deepEqual(card.pressed(), ['per case']);
});

test('choosing a segment counts as a change for the leave-without-saving check (P20)', () => {
  const card = openCard(SACK);
  const snapshot = snapshotFields(card.root);
  assert.equal(snapshotChanged(snapshot), false);
  click(card.basisNamed('per kg'));
  assert.equal(snapshotChanged(snapshot), true);
});
