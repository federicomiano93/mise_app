// The ingredient card, EXECUTED (1 Oct 2026): «Confezione: Singola | Cartone».
//
// buildIngredientForm runs here against a small fake DOM (tests/helpers/form-dom.mjs), with the
// Firebase session stubbed, and the tests tap it the way a person would. What is asserted is the
// payload the card HANDS TO saveIngredient — the only thing that ever reaches a database — and
// what it refuses. The rule behind almost every case: NOTHING STORED MAY CHANGE UNLESS A PERSON
// CHANGES IT IN THE CARD, so every row of the «existing data» table is opened and saved untouched.
//
// It proves what the card decides, not how it looks (that is the ui-check skill's job).

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

import { installDom, walk, type, choose, click, shown } from './helpers/form-dom.mjs';
import { PRICE_FIELDS, priceChanged } from '../js/price-model.js';
import * as PM from '../js/price-model.js';

// ⚠️ THE CARD'S OWN `./firebase.js` IS REPLACED — only for that one importer.
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
// An Italian venue seen through an English screen: the FOOD words (cartone, busta, pz) come from
// the country, the words that say what to tap from the interface language.
globalThis.__miseTestSession = { location: { id: 'loc-test', country: 'IT', language: 'en' } };
const { buildIngredientForm } = await import('../js/ingredient-record-form.js');
const { setCurrency } = await import('../js/currency.js');
before(() => setCurrency('€'));

// ── The stored shapes of the brief's «existing data» table ───────────────────
const BASE = { id: 'I1', name: 'Farina', supplierId: 'S1', brand: '', category: 'Other', active: true, kind: 'ingredient' };
const PACK_CASE = {
  ...BASE, unit: 'cartone', packUnit: 'busta', weight: '2.5kg',
  priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack',
  vatRate: 4, priceUpdatedAt: '2026-09-30T08:00:00.000Z',
};
const LEGACY_KG = { ...BASE, unit: 'cartone', weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' };
const LEGACY_G = { ...BASE, unit: 'kg', weight: '500g', priceUnit: 'kg', pricePerUnit: 10, casePrice: 20, caseCount: 4, caseItemSize: 500, caseItemUnit: 'g', vatRate: 10 };
const PIECES = { ...BASE, unit: 'cartone', packUnit: 'pezzo', weight: '', priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs', unitWeightKg: 0.06, vatRate: 22 };
const TYPED_KG = { ...BASE, unit: 'kg', weight: '', priceUnit: 'kg', pricePerUnit: 7.2, vatRate: 4 };
const TYPED_SACK = { ...BASE, unit: 'sacco', weight: '25kg', priceUnit: 'kg', pricePerUnit: 0.8 };
const TYPED_PIECE = { ...BASE, unit: 'pz', weight: '', priceUnit: 'pcs', pricePerUnit: 0.3, unitWeightKg: 0.05, vatRate: 22 };
const CUSTOM = { ...BASE, unit: 'vassoio', weight: '', priceUnit: 'pcs', pricePerUnit: 2.5 };
const BUSTA_UNIT = { ...BASE, unit: 'busta', weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2 };

const PACKS = ['barattolo', 'bottiglia', 'busta', 'pezzo', 'sacco', 'scatola', 'vaschetta'];
const CATEGORIES = ['Panetteria', 'Pasticceria', 'Vendita'];

function openCard({ item = null, mayPrice = true, kind = null } = {}) {
  const saves = [];
  const root = buildIngredientForm({
    item,
    suppliers: [{ id: 'S1', name: 'Molino' }],
    presetKind: kind,
    mayPrice,
    categories: CATEGORIES,
    packs: PACKS,
    panels: { allergens: false, nutrition: false },
    actions: {
      saveIngredient: async (id, payload, record, writePrice, meta) => { saves.push({ id, payload, record, writePrice, meta }); },
      priceHistory: async () => [],
      packPhotoOn: () => false,
    },
    onDone: () => {},
    onCancel: () => {},
  });
  const all = () => walk(root);
  const byAria = (label) => all().find(n => n.attributes['aria-label'] === label);
  const labelled = (pattern) => {
    const label = all().find(n => n.tagName === 'LABEL' && walk(n).some(c => c.classList.contains('mgmt-field-label') && pattern.test(c.textContent)));
    return label && walk(label).find(n => n.tagName === 'INPUT' || n.tagName === 'SELECT');
  };
  const notes = () => all().filter(n => n.classList.contains('mgmt-price-note') && shown(n) && n.textContent).map(n => n.textContent);
  const card = {
    root, saves, all,
    count: byAria('How many in the case'),
    inner: byAria('What is inside the case'),
    weightAmount: byAria('Weight amount'),
    weightUnit: byAria('Weight unit'),
    single: all().find(n => n.tagName === 'BUTTON' && n.classList.contains('set-seg-btn') && n.textContent === 'Single'),
    carton: all().find(n => n.tagName === 'BUTTON' && n.classList.contains('set-seg-btn') && n.textContent === 'Case'),
    saveBtn: all().find(n => n.tagName === 'BUTTON' && n.classList.contains('btn-primary')),
    name: all().find(n => n.tagName === 'INPUT' && n.classList.contains('mgmt-input')),
    // ⚠️ LOOKED UP WHEN ASKED: the card renames its price boxes as the format changes.
    get casePrice() { return labelled(/^(Case|Pack) price/); },
    get rate() { return labelled(/^Price( per| \()/); },
    get howBought() { return labelled(/^How it is bought/); },
    get vat() { return labelled(/^VAT/); },
    notes,
    summaryLines: () => all().filter(n => n.classList.contains('notif-note') && shown(n) && n.textContent).map(n => n.textContent),
    recompute: all().find(n => n.tagName === 'BUTTON' && n.textContent === 'Recalculate'),
    async save() { click(card.saveBtn); await new Promise(r => setImmediate(r)); return saves[saves.length - 1]; },
  };
  return card;
}

// The card has always written a weight back as «2.5 kg» (joinWeight): the value is the same.
const spaceless = (text) => String(text).replace(/\s+/g, '');
const PRICE_KEYS = ['priceUnit', 'pricePerUnit', 'casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit', 'unitWeightKg'];
const FORMAT_KEYS = ['unit', 'packUnit', 'packCount'];

// ── Every row of the existing-data table: open it, change nothing, save ──────

test('an untouched save sends NO format keys, for every kind of stored product', async () => {
  for (const item of [PACK_CASE, LEGACY_KG, LEGACY_G, PIECES, TYPED_KG, TYPED_SACK, TYPED_PIECE, CUSTOM, BUSTA_UNIT]) {
    const card = openCard({ item });
    const { payload } = await card.save();
    for (const key of FORMAT_KEYS) assert.equal(key in payload, false, `${key} must not be sent for ${JSON.stringify(item.unit)}/${item.packUnit}`);
    assert.equal(spaceless(payload.weight), item.weight, 'the weight is written as stored');
  }
});

test('an untouched save writes the stored price verbatim and records no history entry', async () => {
  for (const item of [PACK_CASE, LEGACY_KG, LEGACY_G, PIECES, TYPED_KG, TYPED_SACK, TYPED_PIECE, CUSTOM, BUSTA_UNIT]) {
    const card = openCard({ item });
    const { payload, record } = await card.save();
    for (const key of PRICE_KEYS) assert.equal(payload[key] ?? null, item[key] ?? null, `${key} of ${item.unit}/${item.caseItemUnit}`);
    assert.equal(payload.vatRate, item.vatRate ?? null);
    assert.equal(record, null, 'no history entry for an untouched save');
    assert.equal(priceChanged(item, payload), false);
  }
});

test('an untouched pack case keeps its own stored size even when the weight on the card has changed', async () => {
  // an employee re-weighed it 2.5kg → 3kg; a manager opens the card to fix a typo
  const card = openCard({ item: { ...PACK_CASE, weight: '3kg' } });
  const { payload, record } = await card.save();
  assert.equal(payload.caseItemSize, 2.5);
  assert.equal(payload.pricePerUnit, 2);
  assert.equal(payload.casePrice, 20);
  assert.equal(record, null);
  assert.equal(spaceless(payload.weight), '3kg', 'the weight itself is what is stored');
});

test('without price access an untouched save sends no price field at all, whatever the product is', async () => {
  for (const item of [PACK_CASE, PIECES, TYPED_KG, { ...BASE, unit: 'cartone', packUnit: 'busta', weight: '2.5kg' }, { ...BASE, unit: 'cartone', weight: '10kg' }]) {
    const card = openCard({ item, mayPrice: false });
    const { payload, writePrice } = await card.save();
    for (const key of PRICE_FIELDS) assert.equal(key in payload, false, key);
    for (const key of FORMAT_KEYS) assert.equal(key in payload, false, `${key} for ${item.unit}/${item.packUnit}`);
    assert.equal(writePrice, false);
  }
});

// ── How each row reopens ─────────────────────────────────────────────────────

const isCarton = (card) => card.carton.attributes['aria-pressed'] === 'true';
const countRow = (card) => card.count.parentNode.parentNode;

test('a price reader sees Cartone, with the count from the stored case, for every carton-shaped product', () => {
  for (const [item, count, inner] of [[PACK_CASE, '4', 'busta'], [LEGACY_KG, '4', ''], [LEGACY_G, '4', ''], [PIECES, '50', 'pezzo']]) {
    const card = openCard({ item });
    assert.equal(isCarton(card), true, `${item.unit} ${item.caseItemUnit}`);
    assert.equal(card.count.value, count);
    assert.equal(shown(countRow(card)), true);
    assert.equal(card.inner.value, inner);
  }
});

test('typed prices and plain units reopen as Singola, with no count row', () => {
  for (const item of [TYPED_KG, TYPED_SACK, TYPED_PIECE, CUSTOM, BUSTA_UNIT]) {
    const card = openCard({ item });
    assert.equal(isCarton(card), false, `${item.unit}`);
    assert.equal(card.single.attributes['aria-pressed'], 'true');
    assert.equal(shown(countRow(card)), false);
  }
});

test('an employee sees a carton (unit cartone + a package word) with an EMPTY count; with no package word it is a Singola', () => {
  const carton = openCard({ item: { ...BASE, unit: 'cartone', packUnit: 'busta', weight: '2.5kg' }, mayPrice: false });
  assert.equal(isCarton(carton), true);
  assert.equal(carton.count.value, '');
  const bare = openCard({ item: { ...BASE, unit: 'cartone', weight: '10kg' }, mayPrice: false });
  assert.equal(isCarton(bare), false);
});

test('the «Unità d\'ordine» menu is gone from the card', () => {
  const card = openCard({ item: TYPED_SACK });
  assert.equal(card.all().some(n => /Order unit|Unità d/.test(n.textContent)), false);
});

// ── Choosing Cartone on a new ingredient ─────────────────────────────────────

test('Cartone, 4 × a 2.5 kg weight, a case price of 20 → stored PER ITEM: 5 a busta, 2.5 kg each, 2 a kilo through pricePerKg', async () => {
  const card = openCard();
  type(card.name, 'Farina 00');
  click(card.carton);
  assert.equal(shown(countRow(card)), true);
  assert.equal(card.inner.value, 'busta', 'the venue\'s default package, from its COUNTRY (Italy)');
  type(card.count, '4');
  type(card.weightAmount, '2.5');
  type(card.casePrice, '20');
  assert.ok(card.summaryLines().includes('Case of 4 buste of 2.5 kg (10 kg)'), card.summaryLines().join(' | '));
  assert.ok(card.all().some(n => /= .*2\.00 \/ kg/.test(n.textContent) && shown(n)), 'the live rate');
  const { payload, record } = await card.save();
  assert.deepEqual(
    [payload.packCount, payload.packUnit, payload.unit],
    [4, 'busta', 'cartone'],
  );
  assert.deepEqual(
    [payload.priceUnit, payload.pricePerUnit, payload.casePrice, payload.caseCount, payload.caseItemUnit, payload.caseItemSize, payload.unitWeightKg],
    ['pcs', 5, 20, 4, 'pcs', null, 2.5],
  );
  assert.ok(record, 'a new price is a history entry');
  assert.equal(spaceless(payload.weight), '2.5kg');
});

test('the price box of a carton is named «Case price», of a single with a weight «Pack price»', () => {
  const card = openCard();
  type(card.weightAmount, '25');
  assert.match(card.casePrice.parentNode.children[0].textContent, /^Pack price/);
  assert.equal(shown(card.casePrice.parentNode), true);
  assert.equal(shown(card.rate.parentNode), false, 'the typed rate gives way');
  click(card.carton);
  assert.match(card.casePrice.parentNode.children[0].textContent, /^Case price/);
});

test('a carton with an EMPTY count is refused on the count box, and nothing is written', async () => {
  const card = openCard();
  type(card.name, 'Farina 00');
  click(card.carton);
  const result = await card.save();
  assert.equal(result, undefined, 'saveIngredient was never called');
  assert.ok(card.count.focused > 0, 'jumped to the box');
  assert.equal(card.count.attributes['aria-invalid'], 'true', 'and highlighted it');
  assert.ok(card.all().some(n => n.classList.contains('mgmt-field-error') && shown(n) && /whole number/.test(n.textContent)));
  // typing clears the refusal
  type(card.count, '4');
  assert.equal(card.count.attributes['aria-invalid'], undefined);
});

test('a count that is not a whole number is refused too (2.5, 0)', async () => {
  for (const bad of ['2.5', '0', '-3']) {
    const card = openCard();
    type(card.name, 'Farina');
    click(card.carton);
    type(card.count, bad);
    assert.equal(await card.save(), undefined, bad);
    assert.equal(card.count.attributes['aria-invalid'], 'true', bad);
  }
});

test('an untouched legacy carton with no count is NOT refused: nothing is being written', async () => {
  const card = openCard({ item: { ...BASE, unit: 'cartone', packUnit: 'busta', weight: '2.5kg' }, mayPrice: false });
  assert.ok(await card.save(), 'saved');
});

test('but typing a price under a carton whose count is empty IS refused: it would erase the price', async () => {
  const stored = { ...BASE, unit: 'cartone', packUnit: 'busta', weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2 };
  const card = openCard({ item: stored });
  assert.equal(card.count.value, '', 'a typed rate has no case to read a count from');
  type(card.casePrice, '22');
  assert.equal(await card.save(), undefined);
  assert.equal(card.count.attributes['aria-invalid'], 'true');
});

// ── An employee's changes to the product data ───────────────────────────────

test('an employee typing a count into a legacy carton writes packCount and keeps the carton words — no price fields', async () => {
  const card = openCard({ item: { ...BASE, unit: 'cartone', packUnit: 'busta', weight: '2.5kg' }, mayPrice: false });
  type(card.count, '6');
  const { payload } = await card.save();
  assert.deepEqual([payload.packCount, payload.packUnit, payload.unit], [6, 'busta', 'cartone']);
  for (const key of PRICE_FIELDS) assert.equal(key in payload, false, key);
});

test('an employee turning a single into a carton: packCount, the picked package word and the venue\'s carton word', async () => {
  const card = openCard({ item: { ...BASE, unit: 'sacco', weight: '10kg' }, mayPrice: false });
  click(card.carton);
  choose(card.inner, 'sacco');
  type(card.count, '2');
  const { payload } = await card.save();
  assert.deepEqual([payload.packCount, payload.packUnit, payload.unit], [2, 'sacco', 'cartone']);
});

test('a carton word already stored is kept, not overwritten by the venue\'s own', async () => {
  const card = openCard({ item: { ...BASE, unit: 'cassa', weight: '10kg' }, mayPrice: false });
  click(card.carton);
  type(card.count, '3');
  const { payload } = await card.save();
  assert.equal(payload.unit, 'cassa');
});

test('Singola after Cartone: packCount null, the carton word becomes the package word (one busta)', async () => {
  const stored = { ...BASE, unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg' };
  const card = openCard({ item: stored, mayPrice: false });
  click(card.single);
  const { payload } = await card.save();
  assert.equal(payload.packCount, null);
  assert.equal(payload.unit, 'busta', 'an empty unit would read «the whole case»');
  assert.equal('packUnit' in payload, false, 'the package word stays as stored');
});

test('switching to Cartone and back to Singola writes nothing', async () => {
  const card = openCard({ item: TYPED_SACK });
  click(card.carton);
  click(card.single);
  const { payload } = await card.save();
  for (const key of FORMAT_KEYS) assert.equal(key in payload, false, key);
  assert.equal(payload.pricePerUnit, 0.8);
});

// ── The price box follows the format and the weight ──────────────────────────

test('a typed rate under a weight that reads: Peso touched keeps the rate, and no history entry is planted', async () => {
  const card = openCard({ item: { ...TYPED_SACK, weight: '2.5kg', pricePerUnit: 2 } });
  assert.equal(card.casePrice.value, '5', 'rate × size');
  type(card.weightAmount, '3');
  assert.equal(card.casePrice.value, '6', 'the box follows the weight while nobody typed in it');
  const { payload, record } = await card.save();
  assert.equal(payload.pricePerUnit, 2);
  assert.equal(record, null);
});

test('a typed rate turned into a Cartone: the box SHOWS the same price (2 a kilo × 4 × 2.5 kg = 20) and the save leaves it verbatim', async () => {
  const card = openCard({ item: { ...BASE, unit: 'sacco', weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2 } });
  click(card.carton);
  type(card.count, '4');
  assert.equal(card.casePrice.value, '20');
  const { payload, record } = await card.save();
  // ⚠️ nobody typed in the price box, so the stored rate is written back exactly — no case invented
  assert.deepEqual([payload.priceUnit, payload.pricePerUnit, payload.casePrice, payload.caseCount], ['kg', 2, null, null]);
  assert.equal(record, null);
  assert.deepEqual([payload.packCount, payload.unit], [4, 'cartone']);
});

test('defect 4: a per-kilo item with no readable weight turned into a Cartone keeps its price on an untouched price box', async () => {
  const card = openCard({ item: TYPED_KG });
  click(card.carton);
  type(card.count, '4');
  assert.equal(card.casePrice.value, '', 'nothing to carry a per-kilo rate to without a weight');
  assert.ok(card.notes().some(n => n === 'The saved price stays €7.20 / kg until you write a new price.'), card.notes().join(' | '));
  const { payload, record } = await card.save();
  assert.deepEqual([payload.priceUnit, payload.pricePerUnit], ['kg', 7.2], 'the price is NOT deleted');
  assert.equal(record, null);
  assert.deepEqual([payload.packCount, payload.unit], [4, 'cartone']);
});

test('defect 1: an egg priced 0.25 a piece, weight edited to 60 g, keeps «a piece» and its piece weight', async () => {
  const egg = { ...BASE, unit: 'pz', weight: '', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
  const card = openCard({ item: egg });
  type(card.weightAmount, '60');
  choose(card.weightUnit, 'g');
  assert.equal(card.casePrice.value, '0.25', 'the box shows the same price per item');
  const { payload, record } = await card.save();
  assert.deepEqual([payload.priceUnit, payload.pricePerUnit, payload.unitWeightKg], ['pcs', 0.25, 0.06]);
  assert.equal(record, null);
  assert.equal(spaceless(payload.weight), '60g');
});

test('a price typed for a single with a weight that reads is one item: 0.25 for a 60 g egg', async () => {
  const card = openCard();
  type(card.name, 'Uovo');
  type(card.weightAmount, '60');
  choose(card.weightUnit, 'g');
  type(card.casePrice, '0.25');
  const { payload } = await card.save();
  assert.deepEqual([payload.priceUnit, payload.pricePerUnit, payload.unitWeightKg], ['pcs', 0.25, 0.06]);
  for (const key of ['casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit']) assert.equal(payload[key], null, key);
});

test('a loose item (no readable weight) keeps «How it is bought» and the typed rate', async () => {
  const card = openCard({ item: TYPED_KG });
  assert.equal(shown(card.howBought.parentNode), true);
  assert.equal(shown(card.rate.parentNode), true);
  assert.equal(shown(card.casePrice.parentNode), false);
  type(card.rate, '7.5');
  const { payload, record } = await card.save();
  assert.deepEqual([payload.priceUnit, payload.pricePerUnit], ['kg', 7.5]);
  assert.ok(record);
  assert.equal('unit' in payload, false, 'an existing item\'s order unit is never touched by its price');
});

test('«How it is bought» offers no «by the case» choice any more', () => {
  const card = openCard({ item: TYPED_KG });
  assert.deepEqual(card.howBought.options.map(o => o.value), ['', 'kg', 'l', 'pcs']);
});

test('a carton with no readable weight is a case of PIECES, asks the piece weight, and prices per piece', async () => {
  const card = openCard();
  type(card.name, 'Cannucce');
  click(card.carton);
  choose(card.inner, 'pezzo');
  type(card.count, '50');
  type(card.casePrice, '20');
  const { payload } = await card.save();
  assert.deepEqual([payload.priceUnit, payload.pricePerUnit, payload.caseItemUnit, payload.caseCount], ['pcs', 0.4, 'pcs', 50]);
  assert.deepEqual([payload.packCount, payload.packUnit, payload.unit], [50, 'pezzo', 'cartone']);
});

// ── A new loose item takes its order unit from its price ─────────────────────

test('a NEW single with no weight, priced by kilo / litre / piece, gets kg / l / pz (the venue\'s word)', async () => {
  for (const [priceUnit, word] of [['kg', 'kg'], ['l', 'l'], ['pcs', 'pz']]) {
    const card = openCard();
    type(card.name, 'Zucchine');
    choose(card.howBought, priceUnit);
    type(card.rate, '3');
    if (priceUnit === 'pcs') type(card.all().find(n => n.tagName === 'INPUT' && n.attributes.placeholder === 'e.g. 0.055'), '0.2');
    const { payload } = await card.save();
    assert.equal(payload.unit, word, priceUnit);
    assert.equal('packCount' in payload, false);
  }
});

test('a NEW single with no price, or priced by a pack, gets an empty unit', async () => {
  const none = openCard();
  type(none.name, 'Sale');
  assert.equal((await none.save()).payload.unit, '');
  const pack = openCard();
  type(pack.name, 'Farina');
  type(pack.weightAmount, '25');
  type(pack.casePrice, '20');
  const { payload } = await pack.save();
  assert.equal(payload.unit, '');
  assert.deepEqual([payload.priceUnit, payload.pricePerUnit, payload.unitWeightKg, payload.caseCount, payload.caseItemUnit], ['pcs', 20, 25, null, null]);
});

test('an EXISTING item with an empty unit is not given one by editing its price', async () => {
  const card = openCard({ item: { ...TYPED_KG, unit: '' } });
  type(card.rate, '8');
  assert.equal('unit' in (await card.save()).payload, false);
});

// ── The format changed since the last price ──────────────────────────────────

test('a weight changed since the price is said, with both formats; untouched, the stored price stands', async () => {
  const card = openCard({ item: { ...PACK_CASE, weight: '3kg' } });
  assert.ok(card.notes().some(n => n === 'The format has changed since the last price: saved 4 × 2.5 kg, with this format 4 × 3 kg. Check the price.'), card.notes().join(' | '));
  assert.equal(shown(card.recompute), true);
  const { payload } = await card.save();
  assert.deepEqual([payload.pricePerUnit, payload.casePrice, payload.caseItemSize], [2, 20, 2.5]);
});

test('«Recalculate» carries the stored price to the format now on the card', async () => {
  const card = openCard({ item: { ...PACK_CASE, weight: '3kg' } });
  assert.equal(card.casePrice.value, '', 'the changed format shows NO stored figure…');
  assert.equal(card.casePrice.attributes.placeholder, '24', '…and offers the carried price as a placeholder');
  click(card.recompute);
  assert.equal(card.casePrice.value, '24');
  assert.equal(shown(card.recompute), false, 'its job is done');
  const { payload, record } = await card.save();
  // the same per-kilo rate carried to the new weight: 2 a kilo × 3 kg × 4 = 24, stored per item (6 a bag, 3 kg each)
  assert.deepEqual([payload.casePrice, payload.caseCount, payload.caseItemUnit, payload.pricePerUnit, payload.unitWeightKg], [24, 4, 'pcs', 6, 3]);
  assert.ok(record, 'the rate moved, so the history says so');
});

test('no note when the format agrees with the price', () => {
  assert.equal(openCard({ item: PACK_CASE }).notes().some(n => /format has changed/.test(n)), false);
  assert.equal(openCard({ item: LEGACY_G }).notes().some(n => /format has changed/.test(n)), false);
});

test('a price typed and then emptied under a new format says so: saving would remove it', () => {
  const card = openCard({ item: TYPED_KG });
  click(card.carton);
  type(card.count, '4');
  type(card.casePrice, '30');
  type(card.casePrice, '');
  assert.ok(card.notes().some(n => /no price yet: type the price/.test(n)), card.notes().join(' | '));
});

// ── The VAT line prices the unit the card would save ─────────────────────────

test('the VAT line prices one CARTON for a carton (20 net, 20.80 at 4%)', () => {
  const card = openCard();
  click(card.carton);
  type(card.count, '4');
  type(card.weightAmount, '2.5');
  type(card.casePrice, '20');
  choose(card.vat, '4');
  assert.ok(card.all().some(n => n.classList.contains('mgmt-price-vat-summary') && n.textContent === '€20.00 without VAT, €20.80 with VAT at 4%'),
    card.all().filter(n => n.classList.contains('mgmt-price-vat-summary')).map(n => n.textContent).join('|'));
});

// ── A legacy explicit-size case on a card whose weight does not read ─────────
// 4 × 2.5 kg at 20: without the weight, a touched price would become a case of PIECES and the
// € / kg every recipe uses would silently go. The size is hinted, never written.
const LEGACY_NO_WEIGHT = { ...LEGACY_KG, weight: '' };

test('reopening shows the stored size as a placeholder (not a value) and says what the price was for', () => {
  const card = openCard({ item: LEGACY_NO_WEIGHT });
  assert.equal(card.weightAmount.attributes.placeholder, '2.5');
  assert.equal(card.weightAmount.value, '');
  assert.equal(card.weightUnit.value, 'kg');
  assert.ok(card.notes().includes('This price was for 4 × 2.5 kg: write the weight of one item to recalculate it.'), card.notes().join(' | '));
  assert.equal(card.all().some(n => n.textContent === 'Weight of one piece (kg)' && shown(n.parentNode)), false, 'no piece weight');
  assert.equal(shown(card.recompute), false);
});

test('the same for grams and millilitres, in the stored unit', () => {
  const g = openCard({ item: { ...LEGACY_G, weight: '' } });
  assert.equal(g.weightAmount.attributes.placeholder, '500');
  assert.equal(g.weightUnit.value, 'g');
  const ml = openCard({ item: { ...BASE, weight: '', priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 500, caseItemUnit: 'ml' } });
  assert.equal(ml.weightUnit.value, 'ml');
  assert.ok(ml.notes().some(n => /6 × 500 ml/.test(n)));
});

test('an untouched save with the hint showing is still verbatim', async () => {
  const card = openCard({ item: LEGACY_NO_WEIGHT });
  const { payload, record } = await card.save();
  for (const key of PRICE_KEYS) assert.equal(payload[key] ?? null, LEGACY_NO_WEIGHT[key] ?? null, key);
  assert.equal(record, null);
  assert.equal(payload.weight, '', 'the placeholder was never written as the weight');
  for (const key of FORMAT_KEYS) assert.equal(key in payload, false, key);
});

test('a touched price without the weight is refused on the weight box, never stored as pieces', async () => {
  const card = openCard({ item: LEGACY_NO_WEIGHT });
  choose(card.inner, 'busta');   // the legacy card names no package: a person writing a price must say what the carton holds
  type(card.casePrice, '22');
  assert.equal(await card.save(), undefined);
  assert.ok(card.weightAmount.focused > 0);
  assert.equal(card.weightAmount.attributes['aria-invalid'], 'true');
});

test('with the weight typed, the price is stored per item and still means the right € / kg', async () => {
  const card = openCard({ item: LEGACY_NO_WEIGHT });
  choose(card.inner, 'busta');
  type(card.weightAmount, '2.5');
  type(card.casePrice, '22');
  const { payload } = await card.save();
  assert.deepEqual([payload.caseItemUnit, payload.caseCount, payload.priceUnit, payload.pricePerUnit, payload.unitWeightKg], ['pcs', 4, 'pcs', 5.5, 2.5]);
  assert.equal(PM.pricePerKg(payload), 2.2);
});

// ── Editing the format or the weight never rewrites a stored price (review, rule B) ───────────

test('B: an employee-style count change on a stored case leaves the price EXACTLY as saved, and says so', async () => {
  const card = openCard({ item: PACK_CASE });
  type(card.count, '5');
  assert.equal(card.casePrice.value, '', 'the figure no longer means the same thing');
  assert.equal(card.casePrice.attributes.placeholder, '25', '2 a kilo × 2.5 kg × 5');
  assert.ok(card.notes().includes('The format has changed since the last price: saved 4 × 2.5 kg, with this format 5 × 2.5 kg. Check the price.'), card.notes().join(' | '));
  assert.ok(card.notes().includes('The saved price stays €2.00 / kg until you write the new price or tap Recalculate.'), card.notes().join(' | '));
  const { payload, record } = await card.save();
  assert.deepEqual([payload.priceUnit, payload.pricePerUnit, payload.casePrice, payload.caseCount, payload.caseItemUnit, payload.caseItemSize], ['kg', 2, 20, 4, 'pack', 2.5]);
  assert.equal(record, null);
  assert.equal(payload.packCount, 5, 'the product data did change');
});

test('B: «Recalculate» after a count change fills the box with the carried price, and saving stores it per item', async () => {
  const card = openCard({ item: PACK_CASE });
  type(card.count, '5');
  click(card.recompute);
  assert.equal(card.casePrice.value, '25');
  const { payload, record } = await card.save();
  assert.deepEqual([payload.casePrice, payload.caseCount, payload.caseItemUnit, payload.pricePerUnit, payload.unitWeightKg], [25, 5, 'pcs', 5, 2.5]);
  // a person asked for it, and the stored UNIT moved from «per kilo» to «per item»: the history says so
  assert.deepEqual([record.priceUnit, record.pricePerUnit, record.unitWeightKg], ['pcs', 5, 2.5]);
});

test('B: a weight edit alone never rewrites a stored case either', async () => {
  const card = openCard({ item: PACK_CASE });
  type(card.weightAmount, '3');
  const { payload, record } = await card.save();
  assert.deepEqual([payload.pricePerUnit, payload.casePrice, payload.caseItemSize, payload.caseItemUnit], [2, 20, 2.5, 'pack']);
  assert.equal(record, null);
});

// ── D: a format change that replaces the order unit is told to the caller ───────────────────

test('D: turning a sack into a carton says which unit it replaced, so the open draft line can keep it', async () => {
  const card = openCard({ item: { ...BASE, unit: 'sacco', weight: '10kg' }, mayPrice: false });
  click(card.carton);
  type(card.count, '2');
  const { payload, meta } = await card.save();
  assert.equal(payload.unit, 'cartone');
  assert.deepEqual(meta, { unitChangedFrom: 'sacco' });
});

test('D: Cartone → Singola says it replaced «cartone»; an unchanged unit, a new item and an empty old unit say nothing', async () => {
  const toSingle = openCard({ item: { ...BASE, unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg' }, mayPrice: false });
  click(toSingle.single);
  assert.deepEqual((await toSingle.save()).meta, { unitChangedFrom: 'cartone' });
  // only the count changed: «cartone» stays «cartone»
  const sameUnit = openCard({ item: { ...BASE, unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg' }, mayPrice: false });
  type(sameUnit.count, '6');
  assert.equal((await sameUnit.save()).meta, undefined);
  // untouched
  assert.equal((await openCard({ item: TYPED_SACK }).save()).meta, undefined);
  // a new item has no old unit
  const fresh = openCard();
  type(fresh.name, 'Farina');
  click(fresh.carton);
  type(fresh.count, '4');
  assert.equal((await fresh.save()).meta, undefined);
  // an old unit that was EMPTY (every new Singola) meant «one item» per untouched line — one package:
  // the package word the card writes is what is frozen (2nd review, defect 1)
  const empty = openCard({ item: { ...BASE, unit: '', weight: '10kg' }, mayPrice: false });
  click(empty.carton);
  type(empty.count, '3');
  const saved = await empty.save();
  assert.deepEqual([saved.payload.unit, saved.payload.packUnit], ['cartone', 'busta']);
  assert.deepEqual(saved.meta, { unitChangedFrom: 'busta' });
  // no package word to freeze and no unit before: nothing to say
  const none = openCard({ item: { ...BASE, unit: '', weight: '10kg' }, mayPrice: false });
  click(none.carton);
  choose(none.inner, '__mise_new__');
  type(none.all().find(n => n.tagName === 'INPUT' && n.attributes['aria-label'] === 'New package name'), 'cassetta');
  type(none.count, '3');
  assert.deepEqual((await none.save()).meta, { unitChangedFrom: 'cassetta' });
});

// ── The word for ONE item inside is required like the count, when the carton is being written ──

test('a carton being written with no inner word is refused on the inner menu: block, focus, highlight', async () => {
  // a legacy 4 × 2.5 kg case names no package; the person moves the count
  const card = openCard({ item: LEGACY_KG });
  assert.equal(card.inner.value, '');
  type(card.count, '5');
  assert.equal(await card.save(), undefined, 'nothing written');
  assert.ok(card.inner.focused > 0, 'jumped to the menu');
  assert.equal(card.inner.attributes['aria-invalid'], 'true', 'highlighted');
  assert.ok(card.all().some(n => n.classList.contains('mgmt-field-error') && shown(n) && n.textContent === 'Choose what is inside the case'));
  // choosing a word clears the refusal and lets the save through
  choose(card.inner, 'busta');
  assert.equal(card.inner.attributes['aria-invalid'], undefined);
  const { payload } = await card.save();
  assert.deepEqual([payload.packCount, payload.packUnit, payload.unit], [5, 'busta', 'cartone']);
});

test('typing a price under a carton with no inner word is refused on the inner menu too', async () => {
  const card = openCard({ item: LEGACY_KG });
  type(card.casePrice, '22');
  assert.equal(await card.save(), undefined);
  assert.equal(card.inner.attributes['aria-invalid'], 'true');
});

test('the count is checked first, then the inner word', async () => {
  const card = openCard();
  type(card.name, 'Farina');
  click(card.carton);
  choose(card.inner, '');
  assert.equal(await card.save(), undefined);
  assert.equal(card.count.attributes['aria-invalid'], 'true');
  assert.equal(card.inner.attributes['aria-invalid'], undefined);
  type(card.count, '4');
  assert.equal(await card.save(), undefined);
  assert.equal(card.inner.attributes['aria-invalid'], 'true');
});

test('switching to Cartone pre-selects the default word (busta on an Italian venue), so the normal path is never refused', async () => {
  const card = openCard();
  type(card.name, 'Farina');
  click(card.carton);
  assert.equal(card.inner.value, 'busta');
  type(card.count, '4');
  assert.ok(await card.save());
});

test('an untouched legacy card with no package word is never blocked, and neither is an employee one', async () => {
  assert.ok(await openCard({ item: LEGACY_KG }).save());
  assert.ok(await openCard({ item: LEGACY_G }).save());
  assert.ok(await openCard({ item: { ...BASE, unit: 'cartone', packUnit: 'busta', weight: '2.5kg' }, mayPrice: false }).save());
});

test('a Singola never needs an inner word', async () => {
  const card = openCard({ item: TYPED_SACK });
  type(card.rate, '1');
  assert.ok(await card.save());
});

// ── 2nd deep review (1 Oct 2026) ─────────────────────────────────────────────
import { unitCost } from '../js/order-cost.js';
import { packPrice } from '../js/inventory/inventory-value.js';
import { qtyInCardUnit } from '../js/inventory/inventory-purchases.js';
import { formatOf } from '../js/pack-format.js';
import { setLanguage } from '../js/i18n.js';

// What the card writes, merged over what was stored, is the document the readers then see.
const asStored = (item, payload) => ({ ...item, ...payload });

test('review 2: retyping the SAME 20 on a live pack carton writes the full format, and every line still prices', async () => {
  const card = openCard({ item: PACK_CASE });
  type(card.casePrice, '20');
  const { payload, record } = await card.save();
  assert.deepEqual([payload.packCount, payload.packUnit, payload.unit], [4, 'busta', 'cartone'], 'packCount is written too');
  assert.deepEqual([payload.priceUnit, payload.pricePerUnit, payload.casePrice, payload.caseCount, payload.caseItemUnit, payload.unitWeightKg], ['pcs', 5, 20, 4, 'pcs', 2.5]);
  assert.ok(record, 'the stored unit moved from per kilo to per item: the history says so');
  const ing = asStored(PACK_CASE, payload);
  assert.equal(unitCost(ing, ing), 20, 'a carton');
  assert.equal(unitCost({ ...ing, unit: 'busta' }, ing), 5, 'a bag');
  assert.equal(qtyInCardUnit(8, 'busta', ing), 2, '8 bags are 2 cartons');
  assert.equal(packPrice({ packKg: {} }, ing, false), 20);
});

test('review 2: «Recalculate» writes the full format as well', async () => {
  const card = openCard({ item: { ...PACK_CASE, weight: '3kg' } });
  click(card.recompute);
  const { payload } = await card.save();
  assert.deepEqual([payload.packCount, payload.packUnit, payload.unit], [4, 'busta', 'cartone']);
});

test('review 3 (manager): Cartone → Singola turns the case into the SAME money per item, with no history entry and no false note', async () => {
  const card = openCard({ item: PACK_CASE });
  click(card.single);
  assert.equal(card.casePrice.value, '5', 'the price of one bag, shown as it will be written');
  assert.equal(card.notes().some(n => /saved price stays/.test(n)), false, card.notes().join(' | '));
  assert.equal(card.notes().some(n => /format has changed/.test(n)), false);
  const { payload, record } = await card.save();
  assert.deepEqual([payload.priceUnit, payload.pricePerUnit, payload.unitWeightKg], ['pcs', 5, 2.5]);
  for (const key of ['casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit']) assert.equal(payload[key], null, key);
  assert.equal(record, null, 'the cost per item did not move');
  assert.deepEqual([payload.packCount, payload.unit], [null, 'busta']);
  const ing = asStored(PACK_CASE, payload);
  assert.equal(unitCost(ing, ing), 5, 'Orders prices one bag');
  assert.equal(packPrice({ packKg: {} }, ing, false), 5, 'and so does the stocktake');
  assert.equal(PM.pricePerKg(ing), 2, 'recipes still get 2 a kilo');
  assert.equal(formatOf(ing, ing).kind, 'single', 'and it reopens as a Singola');
});

test('review 3 (manager): a legacy explicit-size case and a case of pieces convert the same way', async () => {
  const kg = await (async () => { const c = openCard({ item: LEGACY_KG }); click(c.single); return c.save(); })();
  assert.deepEqual([kg.payload.priceUnit, kg.payload.pricePerUnit, kg.payload.unitWeightKg, kg.payload.caseCount, kg.record], ['pcs', 5, 2.5, null, null]);
  const g = await (async () => { const c = openCard({ item: LEGACY_G }); click(c.single); return c.save(); })();
  assert.deepEqual([g.payload.pricePerUnit, g.payload.unitWeightKg, g.record], [5, 0.5, null]);
  const pcs = await (async () => { const c = openCard({ item: PIECES }); click(c.single); return c.save(); })();
  assert.deepEqual([pcs.payload.pricePerUnit, pcs.payload.unitWeightKg, pcs.payload.caseCount, pcs.record], [0.4, 0.06, null, null]);
});

test('review 3 (employee): Cartone → Singola leaves the case alone, and the line has NO price (refuse rather than guess)', async () => {
  const card = openCard({ item: { ...BASE, unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg' }, mayPrice: false });
  click(card.single);
  const { payload } = await card.save();
  assert.deepEqual([payload.packCount, payload.unit], [null, 'busta']);
  for (const key of PRICE_FIELDS) assert.equal(key in payload, false, key);
  // a price saved under the new policy is a case of PIECES; read with the employee's unit (the package word)
  // it is ambiguous — a bag, or one egg of a tray? — so Orders and the stocktake show NO price, never a guess
  const perItem = { ...PACK_CASE, priceUnit: 'pcs', pricePerUnit: 5, caseItemSize: null, caseItemUnit: 'pcs', unitWeightKg: 2.5, packCount: null, unit: payload.unit };
  assert.equal(unitCost(perItem, perItem), null);
  assert.equal(packPrice({ packKg: {} }, perItem, false), null);
  // (an old case of PACKAGES is the one shape main already prices as one busta: unchanged)
  const legacy = { ...PACK_CASE, packCount: null, unit: payload.unit };
  assert.equal(unitCost(legacy, legacy), 5);
  const pieces = { ...PIECES, unit: 'vaschetta', packUnit: 'vaschetta', packCount: null };
  assert.equal(unitCost(pieces, pieces), null, 'a case of PIECES ordered by its own package word: not one egg');
  assert.equal(packPrice({ packKg: {} }, pieces, false), null);
});

test('review 3 (manager after an employee): the card reopens as a Singola, says the format changed, and Ricalcola converts it to per-item', async () => {
  // what is stored after an employee turned a 'pack' carton of 4 into a Singola (unit = «busta», no packCount)
  const stored = { ...PACK_CASE, packCount: null, unit: 'busta' };
  const card = openCard({ item: stored });
  assert.equal(isCarton(card), false, 'a Singola, not a carton read back from the case');
  assert.ok(card.notes().some(n => /^The format has changed since the last price: saved 4 × 2\.5 kg/.test(n)), card.notes().join(' | '));
  assert.equal(shown(card.recompute), true);
  // untouched: the stored price verbatim (nothing guessed on the manager's behalf)
  const untouched = await card.save();
  for (const key of PRICE_KEYS) assert.equal(untouched.payload[key] ?? null, stored[key] ?? null, key);
  assert.equal(untouched.record, null);
  // Ricalcola: the same price per item carried to a single (2 a kilo × 2.5 kg = 5), stored per item
  const recalc = openCard({ item: stored });
  click(recalc.recompute);
  assert.equal(recalc.casePrice.value, '5');
  const { payload, record } = await recalc.save();
  assert.deepEqual([payload.priceUnit, payload.pricePerUnit, payload.unitWeightKg, payload.caseCount], ['pcs', 5, 2.5, null]);
  assert.ok(record, 'the stored unit moved from per kilo to per item: the history says so');
  const ing = asStored(stored, payload);
  assert.equal(unitCost(ing, ing), 5, 'now Orders prices one bag');
  assert.equal(packPrice({ packKg: {} }, ing, false), 5);
  assert.equal(PM.pricePerKg(ing), 2);
});

test('review 3 (manager after an employee): a typed price converts it too', async () => {
  const card = openCard({ item: { ...PACK_CASE, packCount: null, unit: 'busta' } });
  type(card.casePrice, '5');
  const { payload } = await card.save();
  assert.deepEqual([payload.priceUnit, payload.pricePerUnit, payload.unitWeightKg, payload.caseCount], ['pcs', 5, 2.5, null]);
  const ing = asStored(PACK_CASE, payload);
  assert.equal(unitCost(ing, ing), 5);
});

test('review 4: a corrected weight on a per-item price moves the piece weight, not the price, and plants no history entry', async () => {
  const egg = { ...BASE, unit: '', weight: '60g', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
  const card = openCard({ item: egg });
  type(card.weightAmount, '70');
  const { payload, record } = await card.save();
  assert.deepEqual([payload.priceUnit, payload.pricePerUnit, payload.unitWeightKg], ['pcs', 0.25, 0.07]);
  assert.equal(record, null);
  assert.equal(card.notes().some(n => /format has changed/.test(n)), false, 'nothing to warn about: it is handled');
});

test('review 4: the same for a Cartone\'s stored case of pieces', async () => {
  const stored = { ...BASE, unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg', priceUnit: 'pcs', pricePerUnit: 5, casePrice: 20, caseCount: 4, caseItemUnit: 'pcs', unitWeightKg: 2.5 };
  const card = openCard({ item: stored });
  type(card.weightAmount, '3');
  const { payload, record } = await card.save();
  assert.deepEqual([payload.unitWeightKg, payload.pricePerUnit, payload.casePrice, payload.caseCount], [3, 5, 20, 4]);
  assert.equal(record, null);
});

test('review 4: a piece weight that was never the pack weight is left alone', async () => {
  const tray = { ...BASE, unit: '', weight: '360g', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
  const card = openCard({ item: tray });
  type(card.weightAmount, '400');
  const { payload } = await card.save();
  assert.equal(payload.unitWeightKg, 0.06);
});

test('review 4: a weight changed by an employee is flagged to the manager, whose «Recalculate» writes the new weight at the same price per item', async () => {
  const stale = { ...BASE, unit: '', weight: '70g', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
  const card = openCard({ item: stale });
  assert.ok(card.notes().includes('The format has changed since the last price: saved 0.06 kg, with this format 0.07 kg. Check the price.'), card.notes().join(' | '));
  click(card.recompute);
  assert.equal(card.casePrice.value, '0.25');
  const { payload } = await card.save();
  assert.deepEqual([payload.priceUnit, payload.pricePerUnit, payload.unitWeightKg], ['pcs', 0.25, 0.07]);
});

test('review 6: «each» is an interface word — «al pezzo» in an Italian note', () => {
  setLanguage('it');
  try {
    const card = openCard({ item: PIECES });
    type(card.all().find(n => n.attributes['aria-label'] === 'Quanti nel cartone'), '40');
    assert.ok(card.notes().includes('Il prezzo salvato resta €0.40 al pezzo finché non scrivi il nuovo prezzo o tocchi Ricalcola.'), card.notes().join(' | '));
    assert.equal(PM.formatPricePerUnit({ priceUnit: 'pcs', pricePerUnit: 0.4 }), '€0.40 al pezzo');
  } finally { setLanguage('en'); }
});

test('review 7: «Recalculate» hides itself and focus moves to the price box', () => {
  const card = openCard({ item: PACK_CASE });
  type(card.count, '5');
  const before = card.casePrice.focused;
  click(card.recompute);
  assert.equal(shown(card.recompute), false);
  assert.ok(card.casePrice.focused > before);
});
