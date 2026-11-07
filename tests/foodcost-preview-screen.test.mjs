// The product preview and the list search, pinned at source level (no DOM library here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const view = read('../js/foodcost/preview-view.js');
const list = read('../js/foodcost/foodcost-list.js');
const main = read('../js/foodcost/foodcost-main.js');
const editor = read('../js/foodcost/foodcost-editor.js');

test('the panel reads every figure from the preview and adds nothing up', () => {
  assert.doesNotMatch(view, /productionCost|costProduct|suggestedGrossPrice|suggestedNetPrice/);
  assert.match(view, /import \{ blockerText \} from '\.\/foodcost-model\.js'/);
  // Comments and string literals (the icon's SVG holds «w3.org/2000») are not arithmetic.
  const code = view.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    .replace(/'[^'\n]*'/g, "''");
  assert.doesNotMatch(code, /\d\s*[*/]\s*\w|\w\s*[*/]\s*\d/);
});

test('the labour row exists only when the labour figure is known; unknown is a dash', () => {
  assert.match(view, /hasLabour = preview\.labourUnitCost !== null/);
  assert.match(view, /hasLabour \? row\(t\('fc\.preview\.labour'\)/);
  assert.match(view, /const DASH = '—'/);
  assert.match(view, /value === null \|\| value === undefined \? DASH/);
});

test('the list mounts the search once and filters after the margin sort', () => {
  const paintRows = /function paintRows\(([\s\S]*?)\n  \}\n/.exec(list)[1];
  assert.doesNotMatch(paintRows, /el\('input'/);
  assert.match(list, /const searchInput = el\('input'/);
  assert.ok(paintRows.indexOf('sortByMargin') < paintRows.indexOf('nameMatches'));
  assert.match(paintRows, /searchBox\.hidden = all\.length === 0/);
  assert.match(list, /onQuery\?\.\(query\)/);
});

test('the page opens the dialog only on the phone, and re-reads the product after it', () => {
  const body = /async function openFromList\(product\) \{([\s\S]*?)\n\}\n/.exec(main)[1];
  assert.match(body, /if \(splitOn\) \{ requestOpen\(product\); return; \}/);
  assert.ok(body.indexOf('splitOn') < body.indexOf('confirmDialog'));
  assert.match(body, /view !== 'list'/);
  assert.match(body, /getProducts\(\)\.find/);
  assert.match(main, /onOpen: openFromList/);
});

test('listQuery is declared before the first language or session callback', () => {
  const decl = main.indexOf('let listQuery');
  assert.ok(decl > -1);
  const first = Math.min(...['onLanguageChange(', 'onSession('].map((s) => {
    const m = new RegExp('^\\s*' + s.replace('(', '\\('), 'm').exec(main);
    return m ? m.index : Infinity;
  }));
  assert.ok(decl < first);
});

test('the card shows the summary first and repaints it with the answer', () => {
  const root = /const root = el\('div', \{ class: 'fc-view fc-editor' \}, \[([\s\S]*?)\n    answer,/.exec(editor)[1];
  assert.ok(root.indexOf('summary,') > -1 && root.indexOf('summary,') < root.indexOf('prodCost,'));
  assert.match(/function paintAnswer\(\) \{([\s\S]{0,500})/.exec(editor)[1], /paintSummary\(tables\)/);
  assert.match(/function paintSummary\(tables\) \{([\s\S]*?)\n  \}\n/.exec(editor)[1], /catch/);
});

test('every preview and search key used exists in both languages', async () => {
  const { _dictionaries } = await import('../js/i18n.js');
  const dicts = _dictionaries();
  const keys = new Set();
  for (const src of [view, list, main, editor]) {
    for (const m of src.matchAll(/'(fc\.(?:preview\.[A-Za-z]+|search[A-Za-z]*))'/g)) keys.add(m[1]);
  }
  assert.ok(keys.size >= 20);
  for (const key of keys) {
    for (const lang of Object.keys(dicts)) assert.ok(dicts[lang][key], `${key} missing in ${lang}`);
  }
});

test('four figures in sight, the rest behind «Dettagli» — a real button, closed by default (7 Nov 2026)', () => {
  // Federico on the tablet: «ci sono troppe voci». His choice: price, cost, food cost, ideal price.
  const sight = /const list = el\('dl', \{ class: 'fc-preview-list' \}, \[([\s\S]*?)\n  \]\);/.exec(view)[1];
  const labels = [...sight.matchAll(/row\(t\('(fc\.preview\.[a-zA-Z]+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['fc.preview.price', 'fc.preview.cost', 'fc.preview.foodCost', 'fc.preview.ideal']);
  assert.match(view, /fc\.preview\.idealSub/);
  // In the dialog the Tab trap walks buttons only, so «Dettagli» is a button, not <details>.
  assert.doesNotMatch(view, /el\('details'|el\('summary'/);
  assert.match(view, /'aria-expanded', String\(open\)/);
  assert.match(view, /let open = !!moreOpen/);
  // The card keeps it open across its repaints.
  assert.match(editor, /moreOpen: summaryMoreOpen, onMoreToggle: \(open\) => \{ summaryMoreOpen = open; \}/);
});
