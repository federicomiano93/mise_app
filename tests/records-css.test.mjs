// records-css.test.mjs — the record cards look the same in the Catalogue as in «Fornitori e
// ingredienti».
//
// The ingredient card opens in the Catalogue since 13 Sep 2026 (Federico: «semplicemente apri
// una scheda ingrediente come in fornitori ed ingredienti»). catalogue.html loads neither
// style.css nor orders.css, so the card's styles reach it as records.css: a GENERATED copy of
// exactly the rules the cards need. A copy nobody regenerates is a card that looks right on
// one page and slowly wrong on the other, with nothing broken anywhere — so the copy is
// judged against its sources, not trusted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildRecordsCss } from '../scripts/build-records-css.mjs';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const CSS = read('records.css').replace(/\r\n/g, '\n');

test('⚠️⚠️ records.css is exactly what its sources say — nothing stale, nothing hand-made', () => {
  assert.equal(CSS, buildRecordsCss(read),
    'records.css has drifted from orders.css / style.css or from the classes the cards draw: '
    + 'run `node scripts/build-records-css.mjs`');
});

test('every rule is scoped to the layer that holds a card, so nothing else on the page changes', () => {
  const heads = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)]
    .map(m => m[1].trim()).filter(h => h && !h.startsWith('@'));
  assert.ok(heads.length > 40, `the copy looks empty: ${heads.length} rules`);
  for (const head of heads) {
    for (const part of head.split(',').map(p => p.trim())) {
      // `:where(.rec-host .mgmt-scroll) …` carries style.css's page-wide rules at their own
      // zero-class weight; everything else is `.rec-host …`.
      assert.ok(part === '.rec-host' || part.startsWith('.rec-host ') || part.startsWith(':where(.rec-host .mgmt-scroll) '),
        `unscoped selector in records.css: ${part}`);
    }
  }
});

test('the rules the card cannot do without are in it', () => {
  for (const cls of ['mgmt-scroll', 'mgmt-form', 'mgmt-field', 'mgmt-input', 'mgmt-fold', 'mgmt-fold-head',
    'mgmt-pair', 'mgmt-add-inline', 'alg-row', 'alg-tick', 'day-check', 'btn-primary', 'btn-secondary']) {
    assert.match(CSS, new RegExp(`\\.rec-host [^{]*\\.${cls}(?![\\w-])`), `no rule for .${cls}`);
  }
});

test('⚠️ loaded by the Catalogue, precached, and by no page that already loads orders.css', () => {
  assert.match(read('catalogue.html'), /<link rel="stylesheet" href="records\.css">/);
  assert.match(read('sw.js'), /'\.\/records\.css'/);
  for (const page of readdirSync(new URL('../', import.meta.url)).filter(n => n.endsWith('.html'))) {
    const html = read(page);
    if (/href="orders\.css"/.test(html)) {
      assert.doesNotMatch(html, /href="records\.css"/,
        `${page} loads orders.css: a second copy of the same rules there would only fight it`);
    }
  }
});

test('the Catalogue\'s card layer carries the class the copy is scoped to', () => {
  assert.match(read('js/catalogue/ingredient-create.js'), /class: 'pick-overlay rec-host'/);
});
