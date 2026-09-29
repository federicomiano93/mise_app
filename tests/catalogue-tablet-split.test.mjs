// The Recipe catalogue on a tablet: the list on the left, a recipe on the right
// (catalogue.html, js/catalogue/catalogue-main.js). P15.
//
// This project has no jsdom, so the wiring is pinned at source level, naming the things a
// later edit could quietly break: the list NOT redrawn when a recipe opens (it is what
// keeps the search text, the scroll and the focus), every other route leaving the split,
// the placeholder's words never frozen at load, and the PHONE path left exactly as it was.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _dictionaries } from '../js/i18n.js';
import { TABLET_QUERY } from '../js/catalogue/tablet.js';
import { TABLET_QUERY as ORDERS_QUERY } from '../js/orders/tablet-layout.js';

const DICT = _dictionaries();
const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MAIN = codeOf(read('js/catalogue/catalogue-main.js'));

// The text of one top-level function, by its name.
function fnBody(name) {
  const start = MAIN.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} is gone`);
  const next = MAIN.slice(start + 1).search(/\n(?:async )?function |\nconst app = |\nlet /);
  return MAIN.slice(start, next < 0 ? undefined : start + 1 + next);
}

test('the catalogue\'s tablet query is the app\'s one query, word for word', () => {
  assert.equal(TABLET_QUERY, ORDERS_QUERY);
  assert.equal(TABLET_QUERY, '(min-width: 900px) and (min-height: 600px)');
  assert.ok(read('tokens.css').includes(`@media (min-width: 900px) and (min-height: 600px)`));
  assert.ok(read('catalogue.css').includes(`@media ${TABLET_QUERY}`));
});

test('the catalogue never imports from another feature\'s folder', () => {
  for (const file of ['js/catalogue/catalogue-main.js', 'js/catalogue/tablet.js']) {
    assert.doesNotMatch(read(file), /from\s+['"]\.\.\/orders\//, `${file} reaches into js/orders/`);
  }
});

test('tablet.js is in the service worker\'s ASSETS and fingerprinted', () => {
  const sw = read('sw.js');
  assert.match(sw, /'\.\/js\/catalogue\/tablet\.js'/);
  assert.match(sw, /"\.\/js\/catalogue\/tablet\.js":/);
});

test('the page holds the split: a hidden list column beside the screen, the split OFF', () => {
  const html = read('catalogue.html');
  assert.match(html, /<div class="app-split cat-split" id="catSplit" data-split="off">/);
  assert.match(html, /<div class="app-split-list" id="catListCol" hidden><\/div>/);
  // The phone's screen: no pane class in the markup, only catalogue-main.js adds it.
  assert.match(html, /<main class="cat-screen" id="catScreen"><\/main>/);
});

// ── The routes ───────────────────────────────────────────────────────────────

test('every route that is not the list or a recipe leaves the split first', () => {
  for (const name of ['openLabel', 'showAllergenSheet', 'openEditor', 'showSettings',
    'showPhotoCapture', 'openGuidedEditor', 'openRun']) {
    const body = fnBody(name);
    assert.match(body, /stopRun\(\);\s*leaveSplit\(\);/, `${name} must call leaveSplit() right after stopRun()`);
  }
});

test('leaving the split empties the list column, hides it and takes the pane class off', () => {
  const setSplit = fnBody('setSplit');
  assert.match(setSplit, /listCol\.hidden = !on/);
  assert.match(setSplit, /classList\.toggle\('app-split-pane', on\)/);
  const leave = fnBody('leaveSplit');
  assert.match(leave, /if \(!splitOn\) return;/, 'on a phone leaving the split must do nothing');
  assert.match(leave, /setSplit\(false\)/);
  assert.match(leave, /listCol\.replaceChildren\(\)/);
});

test('a recipe on a tablet keeps the list alive: it is re-marked, never redrawn', () => {
  const body = fnBody('showDetailTablet');
  assert.match(body, /const listAlive = splitOn && activeList;/);
  assert.match(body, /if \(listAlive\) activeList\.select\(recipe\.id\);\s*else paintListColumn\(recipe\.id\);/);
  assert.doesNotMatch(body, /renderList\(|buildList\(|swap\(/, 'the detail must not redraw the list or swap the whole screen');
  assert.match(body, /setListHeader\(\)/, 'the page header stays the list\'s');
  assert.match(body, /showDetailNode\(recipe, activeDetail\.root\)/);
});

test('openDetail: tapping the open recipe does nothing; otherwise tablet or phone by the width', () => {
  const body = fnBody('openDetail');
  assert.match(body, /if \(splitOn && view === 'detail' && currentRecipe && currentRecipe\.id === recipe\.id\) return;/);
  assert.match(body, /if \(isTabletNow\(\)\) showDetailTablet\(recipe\);\s*else showDetailPhone\(recipe\);/);
  assert.doesNotMatch(body, /leaveGuard = (?!null)/, 'a read-only recipe sets no guard');
});

test('the phone path is what it always was: the whole screen is swapped, Back and Edit in the header', () => {
  const phone = fnBody('showDetailPhone');
  assert.match(phone, /back: true, add: false, edit: true/);
  assert.match(phone, /swap\(activeDetail\.root\)/);
  const list = fnBody('showList');
  assert.match(list, /leaveSplit\(\);\s*activeList = buildList\(null\);\s*swap\(activeList\.root\);/);
  // The pane exists only on a tablet.
  assert.match(list, /if \(isTabletNow\(\)\) \{\s*setSplit\(true\);/);
  assert.match(fnBody('showDetailNode'), /if \(!splitOn\) \{ swap\(node\); return; \}/);
});

test('the pane head: the recipe name, Edit doing what the header pencil does, no Back', () => {
  const head = fnBody('buildPaneHead');
  assert.match(head, /class: 'app-header'/);
  assert.match(head, /onclick: editCurrent/);
  assert.doesNotMatch(head, /Back|back/);
  assert.match(MAIN, /editBtn\.addEventListener\('click', editCurrent\)/);
  assert.match(fnBody('showDetailNode'), /title\.focus\(/, 'focus goes to the pane head');
});

test('a recipe opened from the address bar opens beside the list (it goes through openDetail)', () => {
  assert.match(fnBody('openWantedRecipe'), /openDetail\(recipe\);/);
});

// ── Words, and the order of the file ─────────────────────────────────────────

test('the placeholder is worded at paint time, inside a function, and again on a language change', () => {
  const empty = fnBody('showPaneEmpty');
  assert.match(empty, /t\('cat\.split\.empty\.title'\)/);
  assert.match(empty, /t\('cat\.split\.empty\.text'\)/);
  assert.doesNotMatch(MAIN.split('\nfunction ')[0], /t\('cat\.split/, 'a phrase asked at module load is frozen');
  // The language handler repaints the list (which re-words the placeholder) and, beside a
  // recipe, the list column and the page header.
  const handler = MAIN.slice(MAIN.indexOf('onLanguageChange(() => {'));
  assert.match(handler, /if \(view === 'list'\) showList\(\);/);
  assert.match(handler, /view === 'detail' && splitOn/);
  assert.match(handler, /setListHeader\(\);\s*paintListColumn\(/);
  assert.match(fnBody('showList'), /showPaneEmpty\(\);/);
});

test('every new piece of state is declared BEFORE the first onSession / onLanguageChange', () => {
  const first = MAIN.search(/^(onSession|onLanguageChange)\(/m);
  assert.ok(first > 0);
  for (const decl of ['let splitOn', 'let paneEmpty', 'const listCol', 'const splitEl', 'const POINTER_SVG']) {
    const at = MAIN.indexOf(decl);
    assert.ok(at >= 0 && at < first, `${decl} must come before the first subscription`);
  }
});

test('crossing the width re-lays out the list and a recipe only, and leaves any other route alone', () => {
  const at = MAIN.indexOf('watchTablet((isTablet) => {');
  assert.ok(at > 0);
  const body = MAIN.slice(at, MAIN.indexOf('\n});', at));
  assert.match(body, /if \(view === 'list'\) showList\(\);/);
  assert.match(body, /view === 'detail' && currentRecipe && isTablet !== splitOn/);
  assert.match(body, /if \(isTablet\) showDetailTablet\(latest\);\s*else showDetailPhone\(latest\);/);
  assert.doesNotMatch(body, /openEditor|showSettings|openRun|openLabel/);
});

test('the live list keeps refreshing beside an open recipe', () => {
  assert.match(MAIN, /\(view === 'list' \|\| \(view === 'detail' && splitOn\)\) && activeList\) activeList\.refresh\(/);
});

test('the words exist in English and in Italian', () => {
  for (const key of ['cat.split.empty.title', 'cat.split.empty.text']) {
    assert.ok(DICT.en[key], `en is missing ${key}`);
    assert.ok(DICT.it[key], `it is missing ${key}`);
    assert.notEqual(DICT.en[key], DICT.it[key], `${key} is untranslated`);
  }
});

// ── The list, and the look ───────────────────────────────────────────────────

test('the list marks the open row with aria-current and can move the mark without repainting', () => {
  const list = read('js/catalogue/catalogue-list.js');
  assert.match(list, /'aria-current': recipe\.id === selected \? 'true' : null/);
  const select = list.slice(list.indexOf('select(id) {'));
  assert.doesNotMatch(select.slice(0, select.indexOf('\n    },')), /paint\(\)/, 'select() must not repaint');
});

test('the CSS: the column and the pane exist only inside the tablet query, forms keep 620px', () => {
  const css = codeOf(read('catalogue.css'));
  const at = css.indexOf('@media (min-width: 900px) and (min-height: 600px)');
  assert.ok(at > 0);
  const outside = css.slice(0, at);
  const inside = css.slice(at);
  assert.doesNotMatch(outside, /grid-template-columns:\s*400px/, 'the two columns leak out of the tablet query');
  assert.match(inside, /\.cat-split\[data-split="on"\]\s*\{[^}]*grid-template-columns:\s*400px/);
  assert.match(inside, /\.cat-split\[data-split="off"\] > \.cat-screen > \*\s*\{[^}]*max-width:\s*620px/);
  // The phone: a wrapper that is only the flex child the screen always was, column hidden.
  assert.match(outside, /\.cat-split\s*\{\s*flex:\s*1;[^}]*flex-direction:\s*column/);
  assert.match(outside, /\.app-split-list\[hidden\]\s*\{\s*display:\s*none/);
});

test('the split uses only tokens tokens.css defines', () => {
  const css = read('catalogue.css');
  const at = css.indexOf('The tablet: the list on the left');
  const block = css.slice(at);
  const tokens = read('tokens.css');
  for (const [, name] of block.matchAll(/var\((--[a-z0-9-]+)/g)) {
    assert.ok(tokens.includes(`${name}:`), `${name} is not defined in tokens.css`);
  }
});
