// «Which products take which VAT rate» — the guide beside a product's VAT rate.
//
// Federico, 13 Sep 2026: «accanto alla casella aliquota iva mettimi un tasto che apre una
// lista … secondo la legge», and, asked which countries: Italy AND the United Kingdom.
//
// ⚠️ WHAT THESE GUARD IS THE SHAPE AND THE PROVENANCE, NOT THE LAW. No test can say an
// item is at the right rate; what a test CAN say is that every country has a guide, that
// every rate the menu offers is explained, that each guide names its sources and the day
// they were checked, and that the words follow the venue's country, never the screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VAT_GUIDE_BY_COUNTRY, vatGuideFor } from '../js/foodcost/vat-guide.js';
import { vatRatesFor } from '../js/foodcost/foodcost-model.js';
import { COUNTRIES } from '../js/market.js';
import { _dictionaries } from '../js/i18n.js';

const raw = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('⚠️ every country the app sells in has its own guide', () => {
  for (const country of COUNTRIES) {
    assert.ok(Object.prototype.hasOwnProperty.call(VAT_GUIDE_BY_COUNTRY, country), `${country} needs a VAT guide`);
  }
});

test('⚠️⚠️ every rate the VAT menu offers is explained in that country\'s guide', () => {
  for (const country of COUNTRIES) {
    const explained = vatGuideFor(country).rates.map(r => r.rate);
    for (const { rate } of vatRatesFor(country)) {
      assert.ok(explained.includes(rate), `${country}: the menu offers ${rate}% and the guide says nothing about it`);
    }
  }
});

test('each guide names its official sources and the day they were checked', () => {
  for (const country of COUNTRIES) {
    const guide = vatGuideFor(country);
    assert.match(guide.checkedOn, /^\d{4}-\d{2}-\d{2}$/, `${country}: checkedOn is a date`);
    assert.ok(guide.sources.length >= 1, `${country}: at least one source`);
    for (const source of guide.sources) {
      assert.ok(typeof source.title === 'string' && source.title.trim(), `${country}: every source has a title`);
      assert.match(source.url, /^https:\/\//, `${country}: every source is a link`);
    }
  }
  assert.ok(vatGuideFor('IT').sources.some(s => /normattiva\.it|agenziaentrate\.gov\.it/.test(s.url)),
    'the Italian guide cites the law or the Agenzia delle Entrate');
  assert.ok(vatGuideFor('GB').sources.some(s => /gov\.uk/.test(s.url)), 'the UK guide cites HMRC on gov.uk');
});

test('every rate has at least one item, each a short plain line, and no rate twice', () => {
  for (const country of COUNTRIES) {
    const rates = vatGuideFor(country).rates;
    assert.equal(new Set(rates.map(r => r.rate)).size, rates.length, `${country}: a rate listed twice`);
    for (const group of rates) {
      assert.ok(Number.isFinite(group.rate) && group.rate >= 0 && group.rate <= 100, `${country}: ${group.rate} is a rate`);
      assert.ok(group.items.length >= 1, `${country} ${group.rate}%: at least one example`);
      for (const item of group.items) {
        assert.ok(typeof item === 'string' && item.trim().length >= 3 && item.length <= 160,
          `${country} ${group.rate}%: «${item}» must be a short line`);
      }
    }
    assert.deepEqual(rates.map(r => r.rate), [...rates.map(r => r.rate)].sort((a, b) => b - a),
      `${country}: highest rate first, the order of the VAT menu`);
  }
});

test('a country the app does not know gets the UK guide, never an empty screen', () => {
  for (const unknown of [null, undefined, '', 'FR', '__proto__', 'constructor']) {
    assert.equal(vatGuideFor(unknown), VAT_GUIDE_BY_COUNTRY.GB, String(unknown));
  }
});

test('⚠️ the guide\'s words follow the COUNTRY: the data file cannot reach the interface language', () => {
  const src = codeOf(raw('js/foodcost/vat-guide.js'));
  assert.doesNotMatch(src, /from\s+['"][^'"]*i18n\.js['"]/, 'no dictionary in the data file');
  assert.doesNotMatch(src, /^import /m, 'no imports at all: it is data');
  const it = vatGuideFor('IT').rates.flatMap(r => r.items).join(' ');
  assert.match(it, /\bpane\b/i, 'the Italian guide is written in Italian');
  const gb = vatGuideFor('GB').rates.flatMap(r => r.items).join(' ');
  assert.match(gb, /\bbread\b/i, 'the UK guide is written in English');
});

test('⚠️ the editor opens it beside the VAT rate, and «Use» goes through vatSelection', () => {
  const editor = codeOf(raw('js/foodcost/foodcost-editor.js'));
  assert.match(editor, /openVatGuide\(\{ country, currentRate: working\.vatRate, onUse: applyVat, returnFocus: guideBtn \}\)/);
  assert.match(editor, /function applyVat\(rate\) \{\s*const selection = vatSelection\(rate, country\);/,
    'a rate from the guide that the menu does not offer (5% in Italy) lands in «another rate», unchanged');
  const view = codeOf(raw('js/foodcost/vat-guide-view.js'));
  assert.doesNotMatch(view, /preview-overlay/, 'not a busy marker: closing the guide loses nothing');
  assert.match(view, /vatGuideFor\(country\)/);
  assert.match(view, /rel: 'noopener noreferrer'/, 'a source opens in a new tab without handing it this page');
});

test('the screen around the guide speaks the interface language, in both', () => {
  const { en, it } = _dictionaries();
  for (const key of ['fc.vatGuide.open', 'fc.vatGuide.title', 'fc.vatGuide.disclaimer', 'fc.vatGuide.rate',
    'fc.vatGuide.use', 'fc.vatGuide.inUse', 'fc.vatGuide.notes', 'fc.vatGuide.sources']) {
    assert.ok(en[key] && it[key], `${key} in both languages`);
    assert.notEqual(en[key], it[key], `${key} in Italian must not be the English`);
  }
  for (const lang of [en, it]) {
    assert.match(lang['fc.vatGuide.rate'], /\{rate\}%/);
    assert.match(lang['fc.vatGuide.use'], /\{rate\}%/);
    assert.match(lang['fc.vatGuide.sources'], /\{date\}/);
  }
});

test('the precache carries both files, or the guide is missing offline', () => {
  const sw = raw('sw.js');
  assert.ok(sw.includes("'./js/foodcost/vat-guide.js'"));
  assert.ok(sw.includes("'./js/foodcost/vat-guide-view.js'"));
});
