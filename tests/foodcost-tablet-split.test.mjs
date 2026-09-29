// Food cost on a tablet: the list on the left, a product (its editor) or its history on the
// right (foodcost.html, js/foodcost/foodcost-main.js). P15.
//
// This project has no jsdom, so the wiring is pinned at source level, naming the things a
// later edit could quietly break: every way of replacing the open editor asking the editor's
// OWN guard (P20 — typed work is never lost silently), the editor MOVED and never rebuilt
// when the width is crossed, the placeholder's words never frozen at load, Magazzino left
// at its 620px column, and the PHONE path left exactly as it was.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _dictionaries } from '../js/i18n.js';
import { TABLET_QUERY } from '../js/foodcost/tablet.js';
import { TABLET_QUERY as ORDERS_QUERY } from '../js/orders/tablet-layout.js';

const DICT = _dictionaries();
const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MAIN = codeOf(read('js/foodcost/foodcost-main.js'));

// The text of one top-level function, by its name.
function fnBody(name) {
  const start = MAIN.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} is gone`);
  const next = MAIN.slice(start + 1).search(/\n(?:async )?function |\nconst app = |\nlet |\nwatchTablet\(|\nonLanguageChange\(/);
  return MAIN.slice(start, next < 0 ? undefined : start + 1 + next);
}

test('Food cost\'s tablet query is the app\'s one query, word for word', () => {
  assert.equal(TABLET_QUERY, ORDERS_QUERY);
  assert.ok(read('foodcost.css').includes(`@media ${TABLET_QUERY}`));
});

test('Food cost never imports from another feature\'s screens', () => {
  for (const file of ['js/foodcost/foodcost-main.js', 'js/foodcost/tablet.js']) {
    assert.doesNotMatch(read(file), /from\s+['"]\.\.\/(orders|catalogue)\//, `${file} reaches into another feature`);
  }
});

test('tablet.js is in the service worker\'s ASSETS and fingerprinted', () => {
  const sw = read('sw.js');
  assert.match(sw, /'\.\/js\/foodcost\/tablet\.js'/);
  assert.match(sw, /"\.\/js\/foodcost\/tablet\.js":/);
});

test('the page holds the split: a hidden list column beside the screen, the split OFF', () => {
  const html = read('foodcost.html');
  assert.match(html, /<div class="app-split fc-split" id="fcSplit" data-split="off">/);
  assert.match(html, /<div class="app-split-list" id="fcListCol" hidden><\/div>/);
  assert.match(html, /<main class="fc-screen" id="fcScreen"><\/main>/);
});

// ── P20: every way of replacing or leaving the editor asks its own guard ────────

test('every replace path awaits the editor\'s own guard and does nothing on «no»', () => {
  const ask = fnBody('askLeave');
  assert.match(ask, /if \(!leaveGuard\) return true;/);
  assert.match(ask, /await leaveGuard\(\)/);
  assert.match(fnBody('requestOpen'), /if \(!\(await askLeave\(\)\)\) return;\s*(?:\/\/[^\n]*\n\s*)?if \(splitOn\) entryEditor = false;\s*openProduct\(product\);/);
  assert.match(fnBody('requestShowAll'), /if \(!\(await askLeave\(\)\)\) return;\s*listFilter = null;/);
  assert.match(fnBody('handleBack'), /if \(!\(await askLeave\(\)\)\) return;/);
  // Home is a link: intercepted while a guard is registered.
  const home = MAIN.slice(MAIN.indexOf("homeBtn.addEventListener('click'"));
  assert.match(home.slice(0, 260), /if \(!leaveGuard\) return;\s*e\.preventDefault\(\);\s*if \(await askLeave\(\)\) window\.location\.href = homeBtn\.href;/);
});

test('the list, the «+» and «show all» all go through those guarded paths, never openProduct directly', () => {
  const build = fnBody('buildList');
  assert.match(build, /onOpen: requestOpen, onAdd: \(\) => requestOpen\(null\)/);
  assert.match(build, /onShowAll: requestShowAll/);
  assert.match(MAIN, /addBtn\.addEventListener\('click', \(\) => requestOpen\(null\)\);/);
  assert.doesNotMatch(MAIN, /onOpen: openProduct|onAdd: \(\) => openProduct/);
  // (six matches = the definition + the callers) The only direct callers: the guarded path, the way back to the product, and the two
  // recipe-link entries (an untouched product, never a dirty one).
  const callers = [...MAIN.matchAll(/\bopenProduct\(/g)].length;
  assert.equal(callers, 6, 'a new direct call to openProduct: it must be guarded — update this list on purpose');
});

test('tapping the product that is already open does nothing', () => {
  assert.match(fnBody('requestOpen'),
    /if \(splitOn && \(view === 'editor' \|\| view === 'history'\) && product && currentProduct\s*&& currentProduct\.id === product\.id\) return;/);
});

test('only one «discard changes?» question is open at a time', () => {
  assert.match(fnBody('askLeave'), /if \(guardPending\) return false;/);
  assert.match(fnBody('askLeave'), /finally \{ guardPending = false; \}/);
});

// ── The routes ──────────────────────────────────────────────────────────────

test('a product on a tablet keeps the list alive: re-marked, never redrawn, header stays the list\'s', () => {
  const body = fnBody('openProduct');
  assert.match(body, /const listAlive = splitOn && activeList;/);
  assert.match(body, /if \(listAlive\) activeList\.select\(key\);\s*else paintListColumn\(key\);/);
  assert.match(body, /setListChrome\(\);/);
  assert.match(body, /showNode\(activeEditor\.root\)/);
  // The phone path is what it always was.
  assert.match(body, /leaveSplit\(\);\s*activeList = null;\s*setEditorHeaderPhone\(product\);\s*activeEditor = renderEditor\(\{ product, draft, app \}\);\s*swap\(activeEditor\.root\);/);
});

test('the list column: list chrome like the list has it, footer kept, phone path swapped', () => {
  const chrome = fnBody('setListChrome');
  assert.match(chrome, /back: !!listFilter \|\| \(!!fromRecipe && entryEditor\), add: true/);
  assert.match(fnBody('paintFooter'), /footerBar\.hidden = !\(view === 'list' \|\| splitOn\) \|\| settingsBtn\.hidden;/);
  const list = fnBody('showList');
  assert.match(list, /if \(isTabletNow\(\)\) \{\s*setSplit\(true\);\s*paintListColumn\(null\);\s*showPaneEmpty\(\);/);
  assert.match(list, /leaveSplit\(\);\s*activeList = buildList\(null\);\s*swap\(activeList\.root\);/);
});

test('the pane head: the product\'s name, and a Back ONLY while it shows the history', () => {
  const head = fnBody('buildPaneHead');
  assert.match(head, /const inHistory = view === 'history';/);
  assert.match(head, /inHistory \? el\('button'[\s\S]*onclick: backToProduct[\s\S]*\}\) : null/);
  assert.match(head, /t\('fc\.newProduct'\)/);
  assert.match(fnBody('showNode'), /head\.querySelector\('h1'\)\.focus\(/, 'focus goes to the pane head');
});

test('the history in the pane sets the editor ASIDE and Back puts the same node back', () => {
  const hist = fnBody('openHistory');
  assert.match(hist, /if \(splitOn && activeEditor\) heldEditor = activeEditor;/);
  assert.match(hist, /if \(!heldEditor\) leaveGuard = null;/, 'the held editor keeps its guard');
  assert.match(hist, /if \(!splitOn\) setHeader\(/, 'beside the list the page header stays the list\'s');
  const back = fnBody('backToProduct');
  assert.match(back, /activeEditor = heldEditor;/);
  assert.doesNotMatch(back.split('if (!heldEditor)')[1] || '', /renderEditor/, 'the held editor is not rebuilt');
  assert.match(MAIN, /if \(view === 'history' && currentProduct\) \{ backToProduct\(\); return; \}/);
});

test('a recipe link opens the split too: the entry refreshes the page header\'s Back', () => {
  const settle = fnBody('settleRecipeLink');
  assert.match(settle, /openProduct\(using\[0\]\); entryEditor = true; refreshChrome\(\);/);
  assert.match(settle, /listFilter = id; showList\(\);/);
  assert.match(settle, /openProduct\(null, draft\); entryEditor = true; draftRecipeId = id; refreshChrome\(\);/);
  assert.match(fnBody('handleBack'), /if \(fromRecipe && \(listFilter \|\| entryEditor\)\) \{ window\.location\.replace\(recipeHref\(fromRecipe\)\); return; \}/);
});

// ── Crossing the width ──────────────────────────────────────────────────────

test('crossing the width MOVES the editor node and never rebuilds it', () => {
  const at = MAIN.indexOf('watchTablet((isTablet) => {');
  assert.ok(at > 0);
  const watch = MAIN.slice(at, MAIN.indexOf('\n});', at));
  assert.match(watch, /if \(isTablet === splitOn\) return;/);
  assert.match(watch, /if \(view === 'list'\) showList\(\);/);
  assert.match(watch, /view === 'editor' && activeEditor\) moveEditor\(isTablet\)/);
  assert.match(watch, /view === 'history' && currentProduct\) openHistory\(currentProduct\)/);
  assert.doesNotMatch(watch, /openProduct|renderEditor/);
  const move = fnBody('moveEditor');
  assert.match(move, /const node = activeEditor\.root;/);
  assert.doesNotMatch(move, /renderEditor|openProduct/);
  assert.match(move, /showNode\(node\)/);
  assert.match(move, /swap\(node\)/);
  // Focus and caret survive: nothing takes focus while moving, then the field gets it back.
  assert.match(move, /quietFocus = true;/);
  assert.match(move, /inside\.focus\(\{ preventScroll: true \}\);\s*if \(caret\) inside\.setSelectionRange\(caret\[0\], caret\[1\]\);/);
  assert.match(fnBody('swap'), /if \(quietFocus\) return;/);
  assert.match(fnBody('showNode'), /if \(quietFocus\) return;/);
});

// ── Live changes ────────────────────────────────────────────────────────────

test('live: the working copy is never replaced; a product deleted elsewhere empties an UNTOUCHED pane only', () => {
  const gone = fnBody('openProductWasDeleted');
  assert.match(gone, /splitOn && currentProduct && currentProduct\.id && hasLiveProducts\(\)/);
  assert.match(gone, /activeEditor\.isUntouched\(\)/);
  assert.match(MAIN, /if \(openProductWasDeleted\(\)\) \{ toast\(t\('fc\.productDeleted'\)\); showList\(\); return; \}\s*activeEditor\.refreshData\(\);/);
  assert.match(MAIN, /\(view === 'list' \|\| \(splitOn && \(view === 'editor' \|\| view === 'history'\)\)\) && activeList\) \{\s*activeList\.refresh\(/);
  assert.match(MAIN, /if \(heldEditor\) heldEditor\.refreshData\(\);/);
});

// ── Words, and the order of the file ─────────────────────────────────────────

test('the placeholder is worded at paint time, inside a function, and again on a language change', () => {
  const empty = fnBody('showPaneEmpty');
  assert.match(empty, /t\('fc\.split\.empty\.title'\)/);
  assert.match(empty, /t\('fc\.split\.empty\.text'\)/);
  assert.doesNotMatch(MAIN.split('\nfunction ')[0], /t\('fc\.split/, 'a phrase asked at module load is frozen');
  const handler = MAIN.slice(MAIN.indexOf('onLanguageChange(() => {'));
  assert.match(handler, /if \(view === 'list'\) showList\(\);/);
  assert.match(handler, /splitOn && \(view === 'editor' \|\| view === 'history'\)/);
  assert.match(handler, /setListChrome\(\);\s*paintListColumn\(/);
  assert.match(fnBody('showList'), /showPaneEmpty\(\);/);
});

test('every new piece of state is declared BEFORE the first onSession / onLanguageChange', () => {
  const first = MAIN.search(/^(onSession|onLanguageChange)\(/m);
  assert.ok(first > 0);
  for (const decl of ['let splitOn', 'let paneEmpty', 'let heldEditor', 'let guardPending', 'let quietFocus',
    'const listCol', 'const splitEl', 'const POINTER_SVG']) {
    const at = MAIN.indexOf(decl);
    assert.ok(at >= 0 && at < first, `${decl} must come before the first subscription`);
  }
});

test('the words exist in English and in Italian', () => {
  for (const key of ['fc.split.empty.title', 'fc.split.empty.text']) {
    assert.ok(DICT.en[key], `en is missing ${key}`);
    assert.ok(DICT.it[key], `it is missing ${key}`);
    assert.notEqual(DICT.en[key], DICT.it[key], `${key} is untranslated`);
  }
});

// ── The list, and the look ───────────────────────────────────────────────────

test('the list marks the open row with aria-current and can move the mark without repainting', () => {
  const list = read('js/foodcost/foodcost-list.js');
  assert.match(list, /'aria-current': isSelected \? 'true' : null/);
  const select = list.slice(list.indexOf('select(id) {'));
  assert.doesNotMatch(select.slice(0, select.indexOf('\n    },')), /paint\(/, 'select() must not repaint');
});

test('the CSS: the split exists only inside the tablet query; layers keep 620px; Magazzino is not widened', () => {
  const css = codeOf(read('foodcost.css'));
  const at = css.indexOf('@media (min-width: 900px) and (min-height: 600px)');
  assert.ok(at > 0);
  const outside = css.slice(0, at);
  assert.doesNotMatch(outside, /grid-template-columns:\s*400px/, 'the two columns leak out of the tablet query');
  assert.match(outside, /\.fc-split\s*\{\s*flex:\s*1;[^}]*flex-direction:\s*column/);
  assert.match(outside, /\.app-split-list\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.fc-split\[data-split="on"\]\s*\{[^}]*grid-template-columns:\s*400px/);
  const layers = css.slice(css.lastIndexOf('@media (min-width: 900px) and (min-height: 600px)'));
  assert.ok(layers.includes('body[data-card="foodcost"] .fc-overlay'));
  assert.ok(layers.includes('body[data-card="foodcost"] .fc-toast'));
  assert.match(layers, /--app-max-width:\s*620px;/);
  const rootGutter = read('tokens.css').match(/--app-gutter:\s*([^;]+);/)[1].trim();
  assert.ok(layers.includes(`--app-gutter: ${rootGutter};`), 'same gutter expression as :root');
  // Magazzino: data-card="inventory" is not in the wide scope.
  assert.match(read('inventory.html'), /<body data-section="foodcost" data-card="inventory">/);
  assert.doesNotMatch(codeOf(read('tokens.css')), /body\[data-section="foodcost"\]/);
});

test('the split uses only tokens tokens.css defines', () => {
  const css = read('foodcost.css');
  const block = css.slice(css.indexOf('The tablet: the list on the left'));
  const tokens = read('tokens.css');
  const local = read('foodcost.css');
  for (const [, name] of block.matchAll(/var\((--[a-z0-9-]+)/g)) {
    assert.ok(tokens.includes(`${name}:`) || local.includes(`${name}:`), `${name} is not defined`);
  }
});
