// The ingredient card's price block after «Confezione: Singola | Cartone» (1 Oct 2026). No DOM
// is available under node --test, so this pins the wiring a pure test cannot reach; what the
// card DECIDES lives in pack-format.js and price-model.js and is tested in pack-format.test.mjs,
// price-model.test.mjs and pack-case.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const FORM = codeOf(read('js/ingredient-record-form.js'));
const I18N = read('js/i18n.js');
const CSS = read('orders.css');

const KEYS = [
  'orders.case.price', 'orders.case.packPrice', 'orders.case.contains', 'orders.case.count',
  'orders.case.summaryUnit', 'orders.case.summaryPiece', 'orders.case.perItem',
  'orders.case.packChanged', 'orders.case.recompute',
  'orders.format.single', 'orders.format.carton', 'orders.format.countInvalid', 'orders.format.innerAria',
  'orders.format.priceAgain',
];

test('every new phrase exists once in English and once in Italian, and the card or pack-format uses it', () => {
  const formatModule = read('js/pack-format.js');
  for (const key of [...KEYS, 'orders.format.summary', 'orders.format.summaryNoWeight']) {
    assert.equal(I18N.split(`'${key}':`).length - 1, 2, `${key} should be defined in both languages`);
    assert.ok(FORM.includes(`'${key}'`) || formatModule.includes(`'${key}'`), `${key} is not used`);
  }
});

test('the retired phrases are gone from both languages and from the code', () => {
  for (const key of ['orders.priceByCase', 'orders.case.size', 'orders.case.unit', 'orders.case.pcs', 'orders.orderUnit',
    'orders.choice.newUnit', 'orders.choice.unitPlaceholder', 'orders.choice.unitBlank', 'orders.choice.unitAria',
    'orders.case.packOf', 'orders.case.packWord']) {
    assert.equal(I18N.includes(`'${key}':`), false, `${key} is retired`);
    assert.equal(FORM.includes(`'${key}'`), false, `${key} is still asked for`);
  }
});

test('«Come si acquista» has no «A cartone» choice any more, and its menu is only the three price units', () => {
  assert.doesNotMatch(FORM, /CASE_MODE|CASE_ITEM_UNITS|PACK_ITEM/, 'the case mode is an internal input of pricePatch now');
  assert.match(FORM, /PRICE_UNITS\.forEach\(u => \{/);
  assert.doesNotMatch(FORM, /caseSizeBox|caseUnitSelect|caseCountBox|syncPackOption|packOption/, 'the «Contiene count × size × unit» row is gone');
});

test('the price box means what the format and the weight say, and shows only the boxes that mean something', () => {
  assert.match(FORM, /const form = priceFormOf\(fmt, weight\);/);
  assert.match(FORM, /const typedForm = form === PRICE_FORMS\.typed;/);
  assert.match(FORM, /unitField\.hidden = !typedForm;\s*rateField\.hidden = !typedForm;\s*casePriceField\.hidden = typedForm;/);
  assert.match(FORM, /const pricePair = el\('div', \{ class: 'mgmt-pair' \}, \[unitField, rateField, casePriceField\]\);/);
  assert.match(FORM, /casePriceLabel\.textContent = fmt\.kind === 'carton'\s*\? t\('orders\.case\.price'/);
  assert.match(FORM, /: t\('orders\.case\.packPrice'/);
  assert.match(FORM, /pieceField\.hidden = needsSize \|\| !\(\(typedForm && unit === 'pcs'\) \|\| form === PRICE_FORMS\.cartonPieces\);/);
});

test('⚠️ UNTOUCHED MEANS UNCHANGED: read() hands pricePatch the stored price until a person touches something', () => {
  assert.match(FORM, /if \(!dirty\(\)\) return storedPriceInput\(item, vat\);/);
  assert.match(FORM, /return formatPriceInput\(now\(\)\.fmt, now\(\)\.weight, \{/);
  // dirty() is: a new item, a typed price box, «Ricalcola» — and NOTHING else (review, rule B): moving the
  // format or the weight never rewrites a stored price
  assert.match(FORM, /const dirty = \(\) => !item \|\| priceTyped \|\| recomputed;/);
  assert.doesNotMatch(FORM, /ctx\.formatTouched|initialWeight/);
});

test('every price box a person can type in sets the flag, BEFORE the live line refreshes', () => {
  assert.match(FORM, /\[unitSelect, rate, pieceWeight, casePriceBox\]\.forEach\(input => \{\s*input\.addEventListener\('input', \(\) => \{ priceTyped = true; \}\);\s*input\.addEventListener\('change', \(\) => \{ priceTyped = true; \}\);/);
  assert.ok(FORM.indexOf('priceTyped = true') < FORM.indexOf("[unitSelect, rate, pieceWeight, vatSelect, casePriceBox].forEach"));
  // VAT is independent of the price: moving it must not make the price dirty
  assert.doesNotMatch(FORM, /vatSelect\.addEventListener\('(input|change)', \(\) => \{ priceTyped/);
});

test('the box shows the stored figure only while it still means the same thing; otherwise empty, with the carried price as placeholder', () => {
  assert.match(FORM, /const start = priceBoxStart\(item, fmt, weight, Boolean\(changed\)\);/);
  assert.match(FORM, /const shown = recomputed \? start\.suggestion : start\.value;/);
  assert.match(FORM, /casePriceBox\.setAttribute\('placeholder', shown === null && start\.suggestion !== null \? String\(start\.suggestion\) : ''\);/);
  assert.match(FORM, /keepsNote\.hidden = !keeps;/);
});

test('the format-changed note shows both formats and offers «Ricalcola», which only sets the flag', () => {
  assert.match(FORM, /const changed = formatChanged\(item, fmt, weight\);/);
  assert.match(FORM, /t\('orders\.case\.packChanged', \{ old: changed\.old, new: changed\.new \}\)/);
  assert.match(FORM, /onClick: \(\) => \{ recomputed = true; refresh\(\); \}/);
  assert.match(FORM, /recomputeBtn\.hidden = dirty\(\) \|\| needsSize \|\| start\.suggestion === null;/, 'once the price is being recomputed the button has done its job');
  assert.match(I18N, /'orders\.case\.packChanged': 'Il formato è cambiato dall’ultimo prezzo: salvato \{old\}, con questo formato \{new\}\. Ricontrolla il prezzo\.'/);
  assert.match(I18N, /'orders\.case\.recompute': 'Ricalcola'/);
  assert.match(I18N, /'orders\.case\.keepsPrice': 'Il prezzo salvato resta \{price\} finché non scrivi il nuovo prezzo o tocchi Ricalcola\.'/);
});

test('a price that existed and has no number under the new format is said, never saved empty in silence', () => {
  assert.match(FORM, /priceAgainNote\.hidden = !\(dirty\(\) && !typedForm && casePriceBox\.value === '' && positiveNumber\(item\?\.pricePerUnit\) !== null\);/);
});

test('the live summary names the rate and what ONE item costs; the VAT line prices the unit the card would save', () => {
  assert.match(FORM, /t\('orders\.case\.perItem', \{\s*price: formatMoney\(draft\.casePrice \/ draft\.caseCount\), item: inner,/);
  assert.match(FORM, /unitCost\(\{ \.\.\.\(item \|\| \{\}\), \.\.\.ctx\.order\(\) \}, draft\)/);
  assert.match(I18N, /'orders\.case\.summaryUnit': '= \{rate\} \/ \{unit\}'/);
  assert.match(I18N, /'orders\.case\.perItem': '\{price\} a \{item\}'/);
});

test('a weight-priced case with an unreadable weight is refused on the weight box', () => {
  assert.match(FORM, /const needsWeight = \(\) => weightNeededForPrice\(\{\s*item, fmt: now\(\)\.fmt, weightText: now\(\)\.weight, dirty: dirty\(\), priceBox: casePriceBox\.value,/);
  assert.match(FORM, /if \(price && price\.needsWeight\(\)\) \{ weight\.markNeeded\(\); return; \}/);
});

test('the card reopens from a case only when it still matches its rate', () => {
  assert.doesNotMatch(FORM, /[^d]caseOf\(item\)/);
  assert.match(FORM, /storedCaseOf\(item\)\?\.caseItemUnit === 'pcs'/);
});

test('the phrases are read when the form is drawn, never at module level', () => {
  const raw = read('js/ingredient-record-form.js');
  assert.doesNotMatch(raw, /^const [A-Z_]+ = .*t\('orders\.(case|format)/m);
});

test('the contains row styles exist and let the boxes shrink at a narrow width', () => {
  assert.match(CSS, /\.mgmt-case-row \.mgmt-input \{[^}]*min-width: 0/);
  assert.match(CSS, /\.mgmt-case-row \{[^}]*display: flex[^}]*align-items: center/);
  assert.match(CSS, /\.mgmt-case-row > \.mgmt-choice \{ flex: 1 1 0; min-width: 0; \}/);
  assert.match(CSS, /\.mgmt-case-row \.mgmt-choice \.mgmt-input \{ flex: none; \}/);
});

test('the contains row gives its number box slim padding', () => {
  assert.match(CSS, /\.mgmt-case-row \.mgmt-input \{[^}]*padding-left: 8px; padding-right: 8px;/);
});
