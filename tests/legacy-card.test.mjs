// The card of BEFORE (2 Oct 2026, reduced scope): an ingredient whose stored price has an old shape keeps the
// ingredient card that shipped before «Confezione: Singola | Cartone» — «Unità d'ordine», «Come si acquista» with
// «A cartone», the case row, «busta da 2,5 kg». Four deep reviews each found another old shape the new card
// misread into wrong money; the owner agreed that the new card opens only for the shapes that exist in
// production (pack-format.js usesLegacyCard) and EVERYTHING ELSE opens the card of before, unchanged.
//
// Two halves. The first EXECUTES the card against a small fake DOM (tests/helpers/form-dom.mjs): which card
// opens for which stored shape, and that the card of before writes back exactly what it always wrote — an
// untouched save sends the stored price verbatim, no packCount, no history entry, no «unit changed» report.
// The second pins, as source text, the wiring that card had on the branch before the new one (its tests,
// brought back to assert the legacy path): the regexes are the old ones, aimed at the legacy functions.
//
// It proves what the card decides, not how it looks (that is the ui-check skill's job).

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

import { installDom, walk, type, choose, click, shown } from './helpers/form-dom.mjs';
import { newCardSource, legacyCardSource } from './helpers/card-source.mjs';

// ⚠️ THE CARD'S OWN `./firebase.js` IS REPLACED — only for that one importer (as in ingredient-card-save.test.mjs).
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
const { usesLegacyCard } = await import('../js/pack-format.js');
before(() => setCurrency('€'));

// ── The stored shapes ────────────────────────────────────────────────────────
const BASE = { id: 'I1', name: 'Farina', supplierId: 'S1', brand: '', category: 'Other', active: true, kind: 'ingredient' };
const PACK = {
  ...BASE, unit: 'cartone', packUnit: 'busta', weight: '2.5kg',
  priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack',
  vatRate: 4, priceUpdatedAt: '2026-09-30T08:00:00.000Z',
};
const KG_CASE = { ...BASE, unit: 'cartone', weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' };
const G_CASE = { ...BASE, unit: 'kg', weight: '500g', priceUnit: 'kg', pricePerUnit: 10, casePrice: 20, caseCount: 4, caseItemSize: 500, caseItemUnit: 'g', vatRate: 10 };
const ML_CASE = { ...BASE, unit: 'l', weight: '', priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 500, caseItemUnit: 'ml' };
const PIECES = { ...BASE, unit: 'cartone', packUnit: 'pezzo', weight: '', priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs', unitWeightKg: 0.06, vatRate: 22 };
const PACK_BY_KG = { ...PACK, unit: 'kg' };
const PACK_BY_BUSTA = { ...PACK, unit: 'busta' };
const PACK_BY_PIECE = { ...PACK, unit: 'pz' };
const MULTIPLIER = { ...BASE, unit: 'sacco', weight: '6x1kg', priceUnit: 'kg', pricePerUnit: 2, vatRate: 4 };
const WORD_WEIGHT = { ...BASE, unit: 'sacco', weight: 'sacco', priceUnit: 'pcs', pricePerUnit: 2 };

// Every shape that must open the card of before (the same list as pack-format.test.mjs «reduced scope»).
const LEGACY_SHAPES = {
  'a case by an explicit size (kg)': KG_CASE,
  'a case by an explicit size (g)': G_CASE,
  'a case by an explicit size (ml)': ML_CASE,
  'a case of pieces with no packCount': PIECES,
  'a pack case ordered by weight': PACK_BY_KG,
  'a pack case ordered by the package word': PACK_BY_BUSTA,
  'a pack case ordered by the piece': PACK_BY_PIECE,
  'a rate on a multiplier weight («6x1kg»)': MULTIPLIER,
  'a rate on a word («sacco»)': WORD_WEIGHT,
};
// Every shape that must still open the NEW card.
const NEW_SHAPES = {
  'no price': { ...BASE, unit: 'sacco', weight: '25kg' },
  'a rate per kilo, no weight': { ...BASE, unit: 'kg', weight: '', priceUnit: 'kg', pricePerUnit: 7.2, vatRate: 4 },
  'a rate per kilo on a readable weight': { ...BASE, unit: 'sacco', weight: '25kg', priceUnit: 'kg', pricePerUnit: 0.8 },
  'a rate per litre': { ...BASE, weight: '1l', priceUnit: 'l', pricePerUnit: 3 },
  'per piece, no piece weight': { ...BASE, weight: '60g', priceUnit: 'pcs', pricePerUnit: 0.25 },
  'eggs: a per-piece price with its own piece weight': { ...BASE, weight: '360g', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 },
  'a pack case ordered with no unit': { ...PACK, unit: '' },
  'a pack case ordered by the carton': PACK,
  'a pack case ordered by any carton word': { ...PACK, unit: 'Cassa' },
  'a case of pieces WITH packCount': { ...PIECES, packCount: 50 },
  'an explicit-size case WITH packCount': { ...KG_CASE, packCount: 4 },
  'a weight that does not read and no price': { ...BASE, weight: '6x1kg' },
};

const ORDER_UNITS = ['cartone', 'kg', 'l', 'pz'];
const PACKS = ['barattolo', 'bottiglia', 'busta', 'pezzo', 'sacco', 'scatola', 'vaschetta'];
const CATEGORIES = ['Panetteria', 'Pasticceria', 'Vendita'];

function openCard({ item = null, mayPrice = true } = {}) {
  const saves = [];
  const root = buildIngredientForm({
    item,
    suppliers: [{ id: 'S1', name: 'Molino' }],
    mayPrice,
    categories: CATEGORIES,
    orderUnits: ORDER_UNITS,
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
  const card = {
    root, saves, all, byAria, labelled,
    // the new card's two buttons — absent on the card of before
    segButtons: () => all().filter(n => n.tagName === 'BUTTON' && n.classList.contains('set-seg-btn')),
    get orderUnit() { return labelled(/^(Order unit|Unità d’ordine)/); },
    get howBought() { return labelled(/^(How it is bought|Come si acquista)/); },
    get packMenu() { return labelled(/^(Package|Confezione)$/); },
    get casePrice() { return labelled(/^(Case price|Prezzo cartone)/); },
    get rate() { return labelled(/^Price( per| \()/); },
    caseCount: byAria('How many in the case'),
    caseSize: byAria('Size of each one'),
    caseUnit: byAria('Unit of each one'),
    weightAmount: byAria('Weight amount'),
    weightUnit: byAria('Weight unit'),
    saveBtn: all().find(n => n.tagName === 'BUTTON' && n.classList.contains('btn-primary')),
    notes: () => all().filter(n => n.classList.contains('mgmt-price-note') && shown(n) && n.textContent).map(n => n.textContent),
    summary: () => all().filter(n => n.classList.contains('mgmt-price-main') && shown(n)).map(n => n.textContent).join(' '),
    async save() { click(card.saveBtn); await new Promise(r => setImmediate(r)); return saves[saves.length - 1]; },
  };
  return card;
}

const isLegacyCard = (card) => card.segButtons().length === 0 && card.orderUnit !== undefined
  && card.byAria('What is inside the case') === undefined
  && card.howBought !== undefined && card.howBought.options.some(o => o.value === 'case');
const isNewCard = (card) => card.segButtons().length === 2 && card.orderUnit === undefined
  && !(card.howBought && card.howBought.options.some(o => o.value === 'case'));

const spaceless = (text) => String(text).replace(/\s+/g, '');
const PRICE_KEYS = ['priceUnit', 'pricePerUnit', 'casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit', 'unitWeightKg'];

// ── (i) which card opens ─────────────────────────────────────────────────────

test('the card the form opens agrees with the gate (usesLegacyCard) for every shape', () => {
  for (const [name, item] of Object.entries(LEGACY_SHAPES)) assert.equal(usesLegacyCard(item), true, name);
  for (const [name, item] of Object.entries(NEW_SHAPES)) assert.equal(usesLegacyCard(item), false, name);
});

test('each old price shape opens the card of before: «Unità d\'ordine», «Come si acquista» with «A cartone», no Singola / Cartone', () => {
  for (const [name, item] of Object.entries(LEGACY_SHAPES)) {
    const card = openCard({ item });
    assert.equal(isLegacyCard(card), true, name);
    assert.deepEqual(card.howBought.options.map(o => o.value), ['', 'kg', 'l', 'pcs', 'case'], `${name}: the menu offers the «By the case» mode`);
    assert.equal(card.howBought.options.at(-1).textContent, 'By the case', name);
    assert.ok(card.packMenu, `${name}: «Package» is the menu of package words`);
    // the order-unit menu opens on the stored word, even one the list does not offer
    assert.equal(card.orderUnit.value, item.unit, name);
  }
});

test('a stored case reopens in case mode with the values as typed; a typed rate reopens in the rate mode', () => {
  const kg = openCard({ item: KG_CASE });
  assert.equal(kg.howBought.value, 'case');
  assert.deepEqual([kg.casePrice.value, kg.caseCount.value, kg.caseSize.value, kg.caseUnit.value], ['20', '4', '2.5', 'kg']);
  const pack = openCard({ item: PACK_BY_BUSTA });
  assert.equal(pack.caseUnit.value, 'pack', 'a case of packages');
  assert.equal(shown(pack.caseSize), false, '«busta da 2,5 kg» has no size box: the size is the weight');
  const pieces = openCard({ item: PIECES });
  assert.equal(pieces.caseUnit.value, 'pcs');
  assert.equal(shown(pieces.caseSize), false);
  const multi = openCard({ item: MULTIPLIER });
  assert.equal(multi.howBought.value, 'kg');
  assert.equal(multi.rate.value, '2');
});

test('each in-scope shape still opens the NEW card: Singola | Cartone, no «Unità d\'ordine», no «A cartone»', () => {
  for (const [name, item] of Object.entries(NEW_SHAPES)) {
    const card = openCard({ item });
    assert.equal(isNewCard(card), true, name);
  }
  assert.equal(isNewCard(openCard()), true, 'a new item');
});

test('an employee (no price access) always gets the new card, whatever the stored shape', () => {
  for (const [name, item] of Object.entries({ ...LEGACY_SHAPES, ...NEW_SHAPES })) {
    const card = openCard({ item, mayPrice: false });
    assert.equal(isNewCard(card), true, name);
    assert.equal(card.howBought, undefined, `${name}: an employee has no price block at all`);
  }
});

// ── (ii) an untouched save writes everything back as it was ──────────────────

test('an untouched save writes the stored price back verbatim: same unit, rate, case keys and piece weight', async () => {
  for (const [name, item] of Object.entries(LEGACY_SHAPES)) {
    const card = openCard({ item });
    const result = await card.save();
    assert.ok(result, `${name}: it saved`);
    const { payload } = result;
    for (const key of PRICE_KEYS) assert.equal(payload[key] ?? null, item[key] ?? null, `${name}: ${key}`);
    assert.equal(payload.vatRate, item.vatRate ?? null, `${name}: vatRate`);
    assert.equal(spaceless(payload.weight), item.weight, `${name}: the weight is written as stored`);
  }
});

test('an untouched save writes no packCount, no history record, and reports no unit change', async () => {
  for (const [name, item] of Object.entries(LEGACY_SHAPES)) {
    const card = openCard({ item });
    const { payload, record, writePrice, meta } = await card.save();
    assert.equal('packCount' in payload, false, `${name}: no packCount`);
    assert.equal(record, null, `${name}: no history record`);
    assert.equal(meta, undefined, `${name}: no unit change reported`);
    assert.equal(writePrice, true);
    // the card of before always sent the order unit and the package word, from its two menus: here they are as stored
    assert.equal(payload.unit, item.unit, `${name}: unit`);
    if (item.packUnit) assert.equal(payload.packUnit, item.packUnit, `${name}: packUnit`);
    else assert.equal('packUnit' in payload, false, `${name}: no blank packUnit key`);
  }
});

// ── (iii) how the card of before behaves ─────────────────────────────────────

test('«By the case» on a rate: count × size × unit and the case price write the case and the derived rate', async () => {
  const card = openCard({ item: MULTIPLIER });
  choose(card.howBought, 'case');
  assert.equal(shown(card.casePrice.parentNode), true);
  assert.equal(shown(card.rate.parentNode), false, 'the rate gives way to the case price');
  type(card.casePrice, '22');
  type(card.caseCount, '4');
  type(card.caseSize, '2.5');
  choose(card.caseUnit, 'kg');
  assert.ok(/= .*2\.20 \/ kg · .*22\.00 per case/.test(card.summary()), card.summary());
  const { payload, record, meta } = await card.save();
  assert.deepEqual(
    [payload.priceUnit, payload.pricePerUnit, payload.casePrice, payload.caseCount, payload.caseItemSize, payload.caseItemUnit],
    ['kg', 2.2, 22, 4, 2.5, 'kg'],
  );
  assert.equal('packCount' in payload, false);
  assert.equal(meta, undefined);
  assert.ok(record && record.pricePerUnit === 2.2, 'the rate moved, so the history says so');
});

test('the history keeps its rule: a rate retyped to the same money plants nothing, a different one plants an entry', async () => {
  const same = openCard({ item: MULTIPLIER });
  type(same.rate, '2');
  assert.equal((await same.save()).record, null);
  const higher = openCard({ item: MULTIPLIER });
  type(higher.rate, '3');
  const { payload, record } = await higher.save();
  assert.equal(payload.pricePerUnit, 3);
  assert.equal(record.pricePerUnit, 3);
});

test('a case of packages with no readable weight is refused on the weight box, in the card of before\'s words', async () => {
  const card = openCard({ item: PACK_BY_BUSTA });
  type(card.weightAmount, '');
  assert.equal(await card.save(), undefined, 'nothing was written');
  assert.ok(card.weightAmount.focused > 0, 'jumped to the weight box');
  assert.equal(card.weightAmount.attributes['aria-invalid'], 'true');
  const errors = card.all().filter(n => n.classList.contains('mgmt-field-error') && shown(n)).map(n => n.textContent);
  assert.deepEqual(errors, ['The package weight is needed for the case price']);
});

test('a weight edited since a «busta da 2,5 kg» case was saved is said in the card of before\'s line, and the price follows on save', async () => {
  const card = openCard({ item: PACK_BY_BUSTA });
  assert.equal(card.notes().some(n => /package weight has changed/.test(n)), false);
  type(card.weightAmount, '3');
  assert.deepEqual(card.notes().filter(n => /changed/.test(n)), ['The package weight has changed: the price updates when you save']);
  assert.equal(card.notes().some(n => /format has changed/.test(n)), false, 'not the new card\'s wording');
  const { payload } = await card.save();
  assert.equal(payload.caseItemSize, 3, 'saving by somebody with the price section re-sizes the case');
  assert.equal(payload.pricePerUnit, 1.666667, '20 / (4 × 3 kg), six decimals');
});

test('the live line says the rate and the case price, in the card of before\'s wording; a piece case says «each»', () => {
  assert.ok(/= .*2\.00 \/ kg · .*20\.00 per case/.test(openCard({ item: PACK_BY_BUSTA }).summary()));
  assert.ok(/= .*0\.40 each · .*20\.00 per case/.test(openCard({ item: PIECES }).summary()), openCard({ item: PIECES }).summary());
});

test('«Unità d\'ordine» is a menu with «+ New unit…»: an empty new box is refused on that box, a typed word is saved', async () => {
  const card = openCard({ item: MULTIPLIER });
  choose(card.orderUnit, '__mise_new__');
  const typed = card.byAria('New order unit');
  assert.equal(shown(typed), true);
  assert.equal(await card.save(), undefined);
  assert.ok(typed.focused > 0);
  assert.equal(typed.attributes['aria-invalid'], 'true');
  assert.ok(card.all().some(n => n.classList.contains('mgmt-field-error') && shown(n) && n.textContent === 'Write the new unit’s name'));
  type(typed, 'vassoio');
  assert.equal(typed.attributes['aria-invalid'], undefined, 'typing clears the refusal');
  const { payload, meta } = await card.save();
  assert.equal(payload.unit, 'vassoio');
  assert.equal(meta, undefined, 'the unit is a menu a person chose, not something the card rewrote');
});

test('the order unit and the package word feed the VAT line: «20 per case of 4» is 20 by the case, 5 by the bag', () => {
  const vatLine = (card) => card.all().filter(n => n.classList.contains('mgmt-price-vat-summary')).map(n => n.textContent).join('');
  const card = openCard({ item: PACK_BY_BUSTA });
  assert.equal(vatLine(card), '€5.00 without VAT, €5.20 with VAT at 4%', 'ordered by the bag (busta)');
  choose(card.orderUnit, 'cartone');
  assert.equal(vatLine(card), '€20.00 without VAT, €20.80 with VAT at 4%', 'ordered by the case');
});

test('changing the order unit is a change the open-card snapshot sees (P20)', () => {
  const card = openCard({ item: MULTIPLIER });
  const snapshot = snapshotFields(card.root);
  assert.equal(snapshotChanged(snapshot), false);
  choose(card.orderUnit, 'kg');
  assert.equal(snapshotChanged(snapshot), true);
  choose(card.orderUnit, 'sacco');
  assert.equal(snapshotChanged(snapshot), false);
});

test('the words of the card of before are the old ones, in Italian too', () => {
  setLanguage('it');
  try {
    const card = openCard({ item: PACK_BY_BUSTA });
    assert.ok(card.orderUnit, '«Unità d’ordine»');
    assert.equal(card.howBought.options.at(-1).textContent, 'A cartone');
    assert.ok(card.all().some(n => n.attributes['aria-label'] === 'Misura di ciascuno'));
    type(card.byAria('Quantità del peso'), '3');
    assert.ok(card.notes().includes('Il peso della confezione è cambiato: il prezzo si aggiorna quando salvi'), card.notes().join(' | '));
    // (the weight just became 3 kg: 20 / (4 × 3), so the line says so, in the old Italian wording)
    assert.ok(/= .*1\.666667 \/ kg · .*20\.00 a cartone/.test(card.summary()), card.summary());
  } finally { setLanguage('en'); }
});

test('the things both cards share are still there on the card of before: supplier, brand, category, weight', async () => {
  const card = openCard({ item: KG_CASE });
  for (const word of ['Name', 'Supplier', 'Brand', 'Category', 'Weight']) {
    assert.ok(card.all().some(n => n.classList.contains('mgmt-field-label') && n.textContent === word), word);
  }
  const { payload } = await card.save();
  assert.equal(payload.supplierId, 'S1');
  assert.equal(payload.category, 'Other');
});

// ── (iv) source text: the wiring the card of before had, aimed at its legacy functions ────────────────────

const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const LEGACY = codeOf(legacyCardSource());
const NEW = codeOf(newCardSource());
const I18N = read('js/i18n.js');
const CSS = read('orders.css');

test('which card opens is decided ONCE, from the price reader\'s merged item, and never for an employee', () => {
  assert.match(NEW, /const legacyCard = Boolean\(mayPrice && item && usesLegacyCard\(item\)\);/);
  assert.match(NEW, /\.\.\.\(legacyCard \? legacyRows : formatRows\)/);
  assert.match(NEW, /if \(legacyCard\) \{ await saveLegacyCard\(\); return; \}/);
});

test('the new card\'s machinery never starts on the card of before', () => {
  // the price block, the wiring and the first draw of the new card sit behind the same switch
  assert.match(NEW, /if \(!legacyCard\) \{\s*price = mayPrice \? priceBlock\(/);
  assert.match(NEW, /syncFormat\(\);\s*\}/);
  // …and the card of before has its own price block, never the new one's
  assert.match(LEGACY, /price = legacyPriceBlock\(item, actions, startKind === 'packaging' \? 'pcs' : null,/);
  assert.doesNotMatch(LEGACY, /priceBlock\(item, actions, startKind[^)]*\{\s*now:/);
  assert.doesNotMatch(LEGACY, /formatPatch|formatTouched|unitChangedFrom|syncFormat|setKind|formState/, 'no format machinery in the card of before');
});

test('the menu gains a case mode that is not a stored unit; the form hands all four case boxes to pricePatch', () => {
  assert.match(LEGACY, /value: CASE_MODE, text: t\('orders\.priceByCase'\)/);
  assert.match(LEGACY, /priceUnit: unitSelect\.value \|\| null/);
  for (const key of ['casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit']) {
    assert.match(LEGACY, new RegExp(key + ': [a-zA-Z]+\.value'), key);
  }
});

test('the count, size and unit boxes each carry an aria-label; pieces hide the size box, and a case reopens as typed', () => {
  assert.match(LEGACY, /caseCountBox\.setAttribute\('aria-label', t\('orders\.case\.count'\)\)/);
  assert.match(LEGACY, /caseSizeBox\.setAttribute\('aria-label', t\('orders\.case\.size'\)\)/);
  assert.match(LEGACY, /'aria-label': t\('orders\.case\.unit'\)/);
  assert.match(LEGACY, /caseSizeBox\.hidden = itemsArePieces/);
  assert.match(LEGACY, /const storedCase = item \? storedCaseOf\(item\) : null/);
  assert.match(LEGACY, /rateField\.hidden = inCase/);
  assert.doesNotMatch(LEGACY, /[^d]caseOf\(item\)/, 'a stale case (an old phone saved a new rate over it) is never reopened');
});

test('the price box is the right cell of the same row in every mode', () => {
  assert.match(LEGACY, /const pricePair = el\('div', \{ class: 'mgmt-pair' \}, \[\s*field\(t\('orders\.howItIsBought'\), unitSelect\),\s*rateField,\s*casePriceField,\s*\]\);/);
  assert.match(LEGACY, /rateField\.hidden = inCase;\s*casePriceField\.hidden = !inCase;/);
});

test('the short fields: «Peso» + «Confezione» in one pair, «Unità d\'ordine» in the next', () => {
  assert.match(LEGACY, /mgmt-pair mgmt-pair--data' \}, \[\s*field\(t\('orders\.field\.weight'\), weight\.node\),\s*field\(t\('orders\.field\.pack'\), legacyPack\.node\),\s*\]\)/);
  assert.match(LEGACY, /mgmt-pair mgmt-pair--data' \}, \[\s*field\(t\('orders\.orderUnit'\), legacyUnit\.node\),\s*\]\)/);
});

test('«Confezione» and «Unità d\'ordine» are menus with «+ Nuova…», saved as packUnit only when there is something to say', () => {
  assert.match(LEGACY, /const legacyPack = legacyCard \? choiceControl\(\{\s*values: packs, current: item\?\.packUnit,/);
  assert.match(LEGACY, /const legacyUnit = legacyCard \? choiceControl\(\{\s*values: orderUnits, current: item\?\.unit,/);
  assert.match(LEGACY, /maxLength: PACK_WORD_MAX,/);
  assert.match(LEGACY, /const refused = \[weight, category, pack, unit\]\.find\(control => control\.invalid\(\)\);/, 'an empty «+ Nuova…» blocks the save');
  assert.match(LEGACY, /unit: unit\.read\(\),/);
  assert.match(LEGACY, /\.\.\.\(packUnit \|\| item\?\.packUnit \? \{ packUnit \} : \{\}\),/);
  const guard = LEGACY.indexOf('[weight, category, pack, unit].find(control => control.invalid())');
  assert.ok(guard > 0 && guard < LEGACY.indexOf('await actions.saveIngredient('), 'before anything is written');
  assert.match(LEGACY, /await actions\.saveIngredient\(item\?\.id \|\| null, payload, record, mayPrice\);/, 'and never a unit-change report');
});

test('«busta da 2,5 kg» reads the LIVE weight and package word, and gives no size box', () => {
  assert.match(LEGACY, /function syncPackOption\(\) \{/);
  assert.match(LEGACY, /const \{ weight, packUnit \} = now\(\);/);
  assert.match(LEGACY, /if \(!w && !selected\) \{ packOption\.remove\(\); return; \}/, 'only while readable, unless chosen');
  assert.match(LEGACY, /caseSizeBox\.hidden = itemsArePieces \|\| sizeFromWeight;/);
  assert.match(LEGACY, /pricePatch\(read\(\), null, now\(\)\.weight\)/, 'the live line uses the current weight');
  assert.match(LEGACY, /pricePatch\(price\.read\(\), new Date\(\)\.toISOString\(\), weight\.read\(\)\)/, 'and so does the save');
  assert.match(LEGACY, /packUnit: legacyPack\.read\(\) \}\)\);/, 'the VAT line hears the package word');
  assert.match(LEGACY, /legacyPack\.onChange\(price\.refresh\);/);
  assert.match(LEGACY, /packChangedNote/, 'a weight changed since the save is said, not silently priced');
  assert.match(LEGACY, /class: 'mgmt-price-note', hidden: 'hidden', text: t\('orders\.legacyCard\.packChanged'\)/);
});

test('the VAT line follows the order unit and weight as they stand in the open card', () => {
  assert.match(LEGACY, /unitCost\(\{ \.\.\.\(item \|\| \{\}\), \.\.\.now\(\) \}, draft\)/);
  assert.match(LEGACY, /const now = \(\) => \(currentOrder \? currentOrder\(\) :/, 'now() is the card as it stands');
  assert.match(LEGACY, /legacyUnit\.onChange\(price\.refresh\)/);
  assert.match(LEGACY, /weight\.onChange\(price\.refresh\)/);
});

test('R4: a case of packages with no readable weight blocks the save on the weight box, in its own words', () => {
  assert.match(LEGACY, /if \(price && price\.needsPackWeight\(\)\) \{ weight\.markNeededAs\(t\('orders\.legacyCard\.packNeeded'\)\); return; \}/);
  assert.match(LEGACY, /unitSelect\.value === CASE_MODE\s*&& caseUnitSelect\.value === PACK_ITEM && packBaseOf\(now\(\)\.weight\) === null/);
  assert.ok(I18N.includes("'orders.legacyCard.packNeeded': 'The package weight is needed for the case price'"));
  assert.ok(I18N.includes("'orders.legacyCard.packNeeded': 'Serve il peso della confezione per il prezzo a cartone'"));
  assert.ok(I18N.includes("'orders.legacyCard.packChanged': 'Il peso della confezione è cambiato: il prezzo si aggiorna quando salvi'"));
  assert.ok(I18N.includes("'orders.legacyCard.packChanged': 'The package weight has changed: the price updates when you save'"));
  // …while the new card keeps ITS wording of the two keys it reused
  assert.ok(I18N.includes("'orders.weight.packNeeded': 'The weight of one item is needed for the case price'"));
  assert.ok(I18N.includes("'orders.case.packChanged': 'The format has changed since the last price: saved {old}, with this format {new}. Check the price.'"));
});

test('the card of before\'s phrases exist once in each language, are asked for by it, and are read when the form is drawn', () => {
  for (const key of ['orders.orderUnit', 'orders.priceByCase', 'orders.case.packOf', 'orders.case.packWord', 'orders.case.size',
    'orders.case.unit', 'orders.case.pcs', 'orders.choice.newUnit', 'orders.choice.unitPlaceholder', 'orders.choice.unitBlank',
    'orders.choice.unitAria', 'orders.legacyCard.packChanged', 'orders.legacyCard.packNeeded', 'orders.legacyCard.summaryUnit',
    'orders.legacyCard.summaryPiece']) {
    assert.equal(I18N.split(`'${key}':`).length - 1, 2, `${key} should be defined in both languages`);
    assert.ok(LEGACY.includes(`'${key}'`), `${key} is not used by the card of before`);
  }
  // the old wording, word for word
  assert.ok(I18N.includes("'orders.legacyCard.summaryUnit': '= {rate} / {unit} · {price} a cartone'"));
  assert.ok(I18N.includes("'orders.legacyCard.summaryPiece': '= {rate} each · {price} per case'"));
  assert.ok(I18N.includes("'orders.priceByCase': 'A cartone'"));
  assert.ok(I18N.includes("'orders.orderUnit': 'Unità d’ordine'"));
  assert.doesNotMatch(read('js/ingredient-record-form.js'), /^const [A-Z_]+ = .*t\('orders\.(case|priceByCase|legacyCard)/m);
});

test('the case row styles exist for both stylesheets', () => {
  assert.match(CSS, /\.mgmt-case \{ display: flex; flex-direction: column; gap: var\(--space-3\); \}/);
  assert.match(read('records.css'), /\.rec-host \.mgmt-case \{\s*display: flex;\s*flex-direction: column;/);
});

test('all callers hand the order-unit words in, as they did before the new card', () => {
  assert.match(read('js/orders/registry.js'), /orderUnits: data\.orderUnits\?\.\(item\?\.unit\) \|\| \[\],/);
  assert.match(read('js/orders/registry-main.js'), /orderUnits: \(current\) => unitChoices\(\{/);
  assert.match(read('js/orders/registry-main.js'), /import \{ categoryChoices, unitChoices, packChoices \} from '\.\.\/record-choices\.js';/);
  const create = read('js/ingredient-create.js');
  assert.match(create, /import \{ categoryChoices, unitChoices, packChoices \} from '\.\/record-choices\.js';/);
  assert.match(create, /orderUnits: unitChoices\(\{ ingredients: known, language \}\),/, 'the create path');
  assert.match(create, /orderUnits: unitChoices\(\{ ingredients: known, language, current: stored\.unit \}\),/, 'the edit path');
});
