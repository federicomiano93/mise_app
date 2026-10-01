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
      saveIngredient: async (id, payload, record, writePrice) => { saves.push({ id, payload, record, writePrice }); },
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

test('Cartone, 4 × a 2.5 kg weight, a case price of 20 → 2 a kilo, 5 a busta, the carton word of the venue', async () => {
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
    [payload.priceUnit, payload.pricePerUnit, payload.casePrice, payload.caseCount, payload.caseItemUnit, payload.caseItemSize],
    ['kg', 2, 20, 4, 'pack', 2.5],
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

test('Singola after Cartone: packCount null and the carton unit leaves; a price reader\'s price is not re-derived by it alone', async () => {
  const stored = { ...BASE, unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg' };
  const card = openCard({ item: stored, mayPrice: false });
  click(card.single);
  const { payload } = await card.save();
  assert.equal(payload.packCount, null);
  assert.equal(payload.unit, '');
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

test('a typed rate turned into a Cartone keeps its rate: 2 a kilo × 4 × 2.5 kg starts the box at 20', async () => {
  const card = openCard({ item: { ...BASE, unit: 'sacco', weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2 } });
  click(card.carton);
  type(card.count, '4');
  assert.equal(card.casePrice.value, '20');
  const { payload, record } = await card.save();
  assert.deepEqual([payload.pricePerUnit, payload.casePrice, payload.caseCount], [2, 20, 4]);
  assert.equal(record, null, 'same rate, so no history entry');
  assert.deepEqual([payload.packCount, payload.unit], [4, 'cartone']);
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
  assert.deepEqual([payload.priceUnit, payload.pricePerUnit, payload.caseCount, payload.caseItemUnit], ['kg', 0.8, 1, 'pack']);
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

test('«Recalculate» prices the stored case price under the format now on the card', async () => {
  const card = openCard({ item: { ...PACK_CASE, weight: '3kg' } });
  click(card.recompute);
  assert.equal(shown(card.recompute), false, 'its job is done');
  const { payload, record } = await card.save();
  assert.deepEqual([payload.casePrice, payload.caseCount, payload.caseItemSize, payload.pricePerUnit], [20, 4, 3, 1.666667]);
  assert.ok(record, 'the rate moved, so the history says so');
});

test('no note when the format agrees with the price', () => {
  assert.equal(openCard({ item: PACK_CASE }).notes().some(n => /format has changed/.test(n)), false);
  assert.equal(openCard({ item: LEGACY_G }).notes().some(n => /format has changed/.test(n)), false);
});

test('a price that existed and has no number under the new format says so', () => {
  const card = openCard({ item: TYPED_KG });
  click(card.carton);
  type(card.count, '4');
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
  type(card.casePrice, '22');
  assert.equal(await card.save(), undefined);
  assert.ok(card.weightAmount.focused > 0);
  assert.equal(card.weightAmount.attributes['aria-invalid'], 'true');
});

test('with the weight typed, the normal Cartone pack path stores the right € / kg', async () => {
  const card = openCard({ item: LEGACY_NO_WEIGHT });
  type(card.weightAmount, '2.5');
  type(card.casePrice, '22');
  const { payload } = await card.save();
  assert.deepEqual([payload.caseItemUnit, payload.caseItemSize, payload.caseCount, payload.priceUnit, payload.pricePerUnit], ['pack', 2.5, 4, 'kg', 2.2]);
});
