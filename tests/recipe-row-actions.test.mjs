// A recipe row's menu (Federico, 7 Nov 2026): «Split into 2 parts» (display only) and «Order»,
// and the full-screen view opening from a button only. The pure parts are executed; the screens
// (they need a browser) are pinned by reading their source.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitAmount, splitBlockReason, orderTargetOf, rowKeysOf } from '../js/catalogue/row-actions-model.js';
import {
  ordersHref, ordersIngredientHref, orderIngredientFromHash, catalogueOriginFromHash, recipeHref,
} from '../js/recipe-link.js';
import { _dictionaries } from '../js/i18n.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8').replace(/\r\n/g, '\n');
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── splitAmount ─────────────────────────────────────────────────────────────

test('splitAmount: two parts that add up to the amount shown, in the row\'s own unit', () => {
  assert.deepEqual(splitAmount(1250, 'g'), { a: 625, b: 625 });
  assert.deepEqual(splitAmount(1251, 'g'), { a: 626, b: 625 });
  assert.deepEqual(splitAmount(1.251, 'kg'), { a: 0.626, b: 0.625 });
  assert.deepEqual(splitAmount(3, 'pcs'), { a: 2, b: 1 });
});

test('splitAmount: null when there is nothing to split', () => {
  assert.equal(splitAmount(1, 'pcs'), null, 'one piece cannot be halved');
  assert.equal(splitAmount(1, 'g'), null);
  assert.equal(splitAmount(0, 'g'), null);
  assert.equal(splitAmount(-5, 'g'), null);
  assert.equal(splitAmount(null, 'g'), null);
  assert.equal(splitAmount(undefined, 'g'), null);
  assert.equal(splitAmount(NaN, 'g'), null);
  assert.equal(splitAmount(Infinity, 'g'), null);
  assert.equal(splitAmount(null, 'to taste'), null);
});

test('splitBlockReason: null when splittable, toTaste without an amount, else tooSmall', () => {
  assert.equal(splitBlockReason(1250, 'g'), null);
  assert.equal(splitBlockReason(null, 'to taste'), 'toTaste');
  assert.equal(splitBlockReason(null, 'g'), 'toTaste');
  assert.equal(splitBlockReason(5, 'to taste'), 'toTaste');
  assert.equal(splitBlockReason(1, 'pcs'), 'tooSmall');
  assert.equal(splitBlockReason(0, 'g'), 'tooSmall');
  assert.equal(splitBlockReason(NaN, 'g'), 'tooSmall');
});

// ── orderTargetOf ───────────────────────────────────────────────────────────

const INGREDIENTS = {
  flour: { supplierId: 'mill' },
  salt: { supplierId: 'mill', active: false },
  yeast: { supplierId: 'gone' },
  water: {},
  oil: { supplierId: 'deli' },
};
const SUPPLIERS = { mill: { name: 'Mill' }, deli: { name: 'Deli', active: false } };

test('orderTargetOf: an ingredient with an active supplier can be ordered', () => {
  assert.deepEqual(orderTargetOf({ label: 'Flour', refId: 'flour' }, INGREDIENTS, SUPPLIERS),
    { ok: true, ingredientId: 'flour' });
  assert.deepEqual(orderTargetOf({ label: 'Flour', kind: 'ingredient', refId: 'flour' }, INGREDIENTS, SUPPLIERS),
    { ok: true, ingredientId: 'flour' });
});

test('orderTargetOf: each reason it cannot', () => {
  const why = (row) => orderTargetOf(row, INGREDIENTS, SUPPLIERS);
  assert.deepEqual(why({ kind: 'recipe', refId: 'some-recipe' }), { ok: false, reason: 'recipe' });
  assert.deepEqual(why({ refId: 'salt' }), { ok: false, reason: 'notInUse' });
  assert.deepEqual(why({ label: 'typed by hand' }), { ok: false, reason: 'noSupplier' }, 'unlinked row');
  assert.deepEqual(why({ refId: 'missing' }), { ok: false, reason: 'noSupplier' }, 'ingredient gone');
  assert.deepEqual(why({ refId: 'water' }), { ok: false, reason: 'noSupplier' }, 'no supplier id');
  assert.deepEqual(why({ refId: 'yeast' }), { ok: false, reason: 'noSupplier' }, 'supplier missing');
  assert.deepEqual(why({ refId: 'oil' }), { ok: false, reason: 'noSupplier' }, 'supplier inactive');
  assert.deepEqual(orderTargetOf({ refId: 'flour' }, null, null), { ok: false, reason: 'noSupplier' });
});

// ── The address ─────────────────────────────────────────────────────────────

test('ordersIngredientHref: the recipe address plus the ingredient, and the fallback', () => {
  assert.equal(ordersIngredientHref('r1', 'i1'), 'orders.html#from=recipe:r1&order=i1');
  assert.equal(ordersIngredientHref('a b&c', 'x y&z'), 'orders.html#from=recipe:a%20b%26c&order=x%20y%26z');
  assert.equal(ordersIngredientHref('r1', 'a/b'), ordersHref('r1'));
  assert.equal(ordersIngredientHref('r1', ''), ordersHref('r1'));
  assert.equal(ordersIngredientHref('a/b', 'i1'), ordersHref('a/b'));
  assert.equal(ordersIngredientHref(null, 'i1'), 'orders.html#from=catalogue');
});

test('the longer address round-trips, ids with spaces and & included', () => {
  const sent = ordersIngredientHref('a b&c', 'x y&z').slice('orders.html'.length);
  assert.deepEqual(catalogueOriginFromHash(sent), { href: recipeHref('a b&c') });
  assert.equal(orderIngredientFromHash(sent), 'x y&z');
  assert.equal(orderIngredientFromHash('#from=recipe:r1&order=i1'), 'i1');
});

test('the longer address is as strict as the short one', () => {
  const bad = [
    '#from=catalogue&order=x', '#from=recipe:a&b', '#from=recipe:a&order=', '#from=recipe:&order=x',
    '#from=recipe:a&order=x/y', '#from=recipe:a&order=x%2Fy', '#from=recipe:a&order=x%23y',
    '#from=recipe:a&order=x%3Fy', '#from=recipe:a&order=x#y', '#from=recipe:a&order=x?y',
    '#from=recipe:a&order=%E0%A4%A', '#from=recipe:a&order=%20', `#from=recipe:a&order=${'x'.repeat(201)}`,
    '#from=recipe:a&order=x&extra=1', '#from=recipe:a&extra=1&order=x', '#from=recipe:a&order=x&order=y',
    '#order=x&from=recipe:a', '#from=recipe:a%2Fb&order=x', '#from=recipe:a&order=x ',
  ];
  for (const hash of bad) {
    assert.equal(catalogueOriginFromHash(hash), null, `origin ${hash}`);
    assert.equal(orderIngredientFromHash(hash), null, `ingredient ${hash}`);
  }
  for (const hash of ['', '#', null, undefined, '#from=catalogue', '#from=recipe:r1', '#from=home']) {
    assert.equal(orderIngredientFromHash(hash), null, String(hash));
  }
});

// ── The screens, by their source ────────────────────────────────────────────

const DETAIL = codeOf(read('js/catalogue/catalogue-detail.js'));
const CSS = read('catalogue.css');

test('full screen opens from a button only: the list is no longer a button', () => {
  const list = DETAIL.slice(DETAIL.indexOf("const ingList = el("), DETAIL.indexOf("const zoomControls"));
  assert.doesNotMatch(DETAIL, /setZoom\(!zoomed\)/);
  assert.doesNotMatch(list, /role: 'button'|tabindex|aria-pressed|onclick|onkeydown/);
  assert.doesNotMatch(CSS, /cursor: zoom-in|cursor: zoom-out/);
  assert.match(DETAIL, /class: 'cat-zoom-open', type: 'button',\s*'aria-label': t\('cat\.fullScreen'\), title: t\('cat\.fullScreen'\)/);
  assert.match(DETAIL, /catSection\(t\('cat\.ingredients'\), \[ingList\], openBtn\)/);
  assert.match(DETAIL, /class: 'cat-sec-top'/);
});

test('the full-screen view is a labelled dialog while open, with Escape and a Tab cycle', () => {
  assert.match(DETAIL, /setAttribute\('role', 'dialog'\)/);
  assert.match(DETAIL, /setAttribute\('aria-modal', 'true'\)/);
  assert.match(DETAIL, /removeAttribute\('role'\)/);
  assert.match(DETAIL, /e\.key === 'Escape'/);
  assert.match(DETAIL, /e\.key !== 'Tab'/);
  assert.match(DETAIL, /\(on \? closeBtn : openBtn\)\.focus/);
});

test('rows are buttons with a menu; items are menuitems and a disabled one stays focusable', () => {
  assert.match(DETAIL, /el\('button', \{\s*type: 'button',\s*class: 'cat-ing-row cat-ing-row-btn'/);
  assert.match(DETAIL, /'aria-haspopup': 'menu', 'aria-expanded': 'false'/);
  assert.match(DETAIL, /class: 'cat-row-menu', role: 'menu', 'aria-label': t\('cat\.rowMenu\.label', \{ name: ing\.label \}\)/);
  assert.match(DETAIL, /role: 'menuitem'/);
  assert.match(DETAIL, /'aria-disabled': enabled \? null : 'true'/);
  assert.doesNotMatch(DETAIL, /disabled: /, 'never the disabled attribute');
  assert.doesNotMatch(DETAIL, /popover|showPopover/i);
  assert.match(DETAIL, /class: 'cat-ing-row cat-ing-total'/, 'the Total row stays a plain row');
  assert.match(DETAIL, /app\.mayOpenOrders && app\.mayOpenOrders\(\)/);
  assert.match(DETAIL, /app\.orderIngredient\(recipe\.id, target\.ingredientId\)/);
  assert.match(DETAIL, /e\.key === 'ArrowDown'/);
  assert.match(DETAIL, /'pointerdown', onPointerDown, true/);
  assert.match(DETAIL, /'scroll', onAnyScroll, true/);
  assert.match(DETAIL, /menu\.style\.top = /, 'positioned through the CSSOM, no style attribute');
});

test('rowKeysOf: the key stays with the ingredient when a row is added above it', () => {
  const before = [{ label: 'Farina', refId: 'F' }, { label: 'Sale' }, { label: 'Acqua', refId: 'A' }];
  const after = [{ label: 'Lievito', refId: 'L' }, ...before];
  const k0 = rowKeysOf(before);
  const k1 = rowKeysOf(after);
  assert.deepEqual(k0, ['ingredient:F#1', 'name:Sale#1', 'ingredient:A#1']);
  assert.equal(k1.indexOf(k0[2]), 3, 'Acqua keeps its key one row down');
  assert.deepEqual(rowKeysOf([{ refId: 'F' }, { refId: 'F' }]), ['ingredient:F#1', 'ingredient:F#2'], 'a row listed twice');
  assert.deepEqual(rowKeysOf([{ kind: 'recipe', refId: 'R' }]), ['recipe:R#1']);
  assert.deepEqual(rowKeysOf(null), []);
});

test('the split is display only: nothing is saved, the export model is untouched', () => {
  assert.match(DETAIL, /exportModelOf\(recipe, amounts, total\)/);
  assert.doesNotMatch(DETAIL, /setScaledTarget\([^)]*split/i);
  assert.match(DETAIL, /splitRows: \(\) => \[\.\.\.splitSet\]/);
  const main = codeOf(read('js/catalogue/catalogue-main.js'));
  assert.match(main, /activeDetail\?\.splitRows\?\.\(\)[^;]*;\s*activeDetail\?\.destroy\?\.\(\)/, 'the old screen lets go of its listeners');
  assert.match(DETAIL, /const rowKeys = rowKeysOf\(recipe\.ingredients\)/);
  assert.match(DETAIL, /splitSet\.has\(rowKeys\[i\]\)/);
  assert.doesNotMatch(DETAIL, /splitSet\.(has|add|delete)\(i\)/, 'never by row number');
  // Every document/window listener the screen adds is taken off again.
  for (const [target, name] of [['document', 'scroll'], ['window', 'resize'], ['document', 'pointerdown'], ['document', 'keydown']]) {
    const adds = DETAIL.split(`${target}.addEventListener('${name}'`).length - 1;
    const removes = DETAIL.split(`${target}.removeEventListener('${name}'`).length - 1;
    assert.ok(adds > 0 && removes >= adds, `${target} ${name}: ${adds} added, ${removes} removed`);
  }
  assert.match(main, /renderDetail\(\{ recipe, app, split \}\)/);
  const order = main.slice(main.indexOf('orderIngredient(recipeId, ingredientId) {'), main.indexOf('orderIngredient(recipeId, ingredientId) {') + 300);
  assert.match(order, /history\.replaceState\(null, '', recipeHref\(recipeId\)\)[\s\S]*window\.location\.href = ordersIngredientHref\(recipeId, ingredientId\)/,
    'the page’s own address names the recipe first, so the phone’s Back lands on it');
  assert.match(main, /mayOpenOrders: \(\) =>/);
});

test('the CSS: button row, menu, split line, full-screen button', () => {
  assert.match(CSS, /\.cat-zoom-open \{[^}]*width: 44px; height: 44px;[^}]*border-radius: 50%/);
  assert.match(CSS, /\.cat-ing-row-btn \{[^}]*min-height: 44px/);
  assert.ok(CSS.indexOf('.cat-ing-row-btn {') > CSS.indexOf('.cat-ing-row {'));
  assert.match(CSS, /\.cat-row-menu \{[^}]*position: fixed; z-index: 5;/);
  assert.match(CSS, /\.cat-row-menu-item\[aria-disabled="true"\]/);
  assert.match(CSS, /\.cat-ing-split \{[^}]*flex-basis: 100%/);
  // Hover only for a real mouse: on a touch screen it sticks after the tap.
  assert.doesNotMatch(CSS.replace(/@media \(hover: hover\) \{[^\n]*\}/g, ''), /\.cat-ing-row-btn:hover|\.cat-row-menu-item:hover/);
  assert.match(CSS, /@media \(hover: hover\) \{ \.cat-ing-row-btn:hover/);
  assert.match(CSS, /@media \(hover: hover\) \{ \.cat-row-menu-item:hover/);
});

test('Orders reads the ingredient, focuses its quantity box, and Back returns to the recipe', () => {
  const main = codeOf(read('js/orders/orders-main.js'));
  assert.match(main, /orderIngredientFromHash\(window\.location\.hash\)/);
  assert.match(main, /drawPart\('wanted ingredient', openWantedIngredient\)/);
  assert.match(main, /\.ing-row\[data-ing="\$\{CSS\.escape\(id\)\}"\] \.ing-qty/);
  assert.match(main, /box\.focus\(/);
  assert.match(main, /setStatus\(t\('orders\.fromRecipe\.notFound'\)/);
  const leave = main.slice(main.indexOf('function leaveSupplier'), main.indexOf('function leaveSupplier') + 3200);
  // A refused save ASKS (nothing else holds that quantity); «Resta qui» stays and the next Back retries.
  assert.match(leave, /if \(result === 'refused'\) \{[\s\S]*?confirmDialog\(\{[\s\S]*?orders\.fromRecipe\.refusedTitle[\s\S]*?okLabel: t\('orders\.fromRecipe\.leaveAnyway'\)[\s\S]*?cancelLabel: t\('unsent\.stay'\)/,
    'a refused save asks before leaving');
  assert.match(leave, /if \(!leave \|\| !stillLeavingFrom\(openerId\)\) \{ leavingForRecipe = false; return; \}/);
  // The wait left the screen usable: somebody who moved on meanwhile is never taken away.
  assert.match(leave, /if \(!stillLeavingFrom\(openerId\)\) \{ leavingForRecipe = false; return; \}/);
  const still = main.slice(main.indexOf('function stillLeavingFrom'), main.indexOf('function goToRecipe'));
  assert.match(still, /state\.openSupplier === openerId && openedFromRecipe === openerId/);
  assert.match(still, /state\.summaryOverSupplier !== true/);
  assert.match(still, /\.missing-overlay, \.app-dialog/);
  assert.match(still, /history-overlay/);
  assert.match(leave, /leavingForRecipe = false;\s*goToRecipe\(toRecipe, result\)/, 'Back works again if Orders comes back from the cache');
  const go = main.slice(main.indexOf('function goToRecipe'), main.indexOf('function leaveSupplier'));
  assert.match(go, /closeSupplier\(\);\s*if \(result !== 'late' && cameFromPage\(toRecipe\)\) history\.back\(\);\s*else window\.location\.replace\(toRecipe\)/,
    'back in the history to the recipe’s own entry, else forward replacing Orders');
  const came = main.slice(main.indexOf('function cameFromPage'), main.indexOf('function stillLeavingFrom'));
  assert.match(came, /history\.length < 2 \|\| !document\.referrer/);
  assert.match(came, /before\.origin === target\.origin && before\.pathname === target\.pathname/);
  assert.match(leave, /sendBeforeLeaving\(\)\.then\(async result =>/, 'what was typed reaches the server before the page goes');
  assert.match(leave, /const saving = t\('orders\.fromRecipe\.saving'\);\s*setStatus\(saving, undefined, 9000\)/);
  assert.match(leave, /if \(leavingForRecipe\) return;/, 'a second tap does not leave twice');
  assert.doesNotMatch(main, /location\.hash\s*=/);
  // Only live lists, and never over a screen somebody chose while they arrived.
  const wanted = main.slice(main.indexOf('function openWantedIngredient'), main.indexOf('function openWantedIngredient') + 1600);
  assert.match(wanted, /state\.showingCopy/);
  assert.match(wanted, /state\.openSupplier !== null \|\| heldSupplierId !== null/);
  // A snapshot repaint gives the focus back to the same box of the same row.
  assert.match(main, /detailView\.repaint\(ctx\)[\s\S]{0,900}\.focus\(/);
  const firstSubscription = main.search(/^(onSession|onLanguageChange)\(/m);
  assert.ok(firstSubscription < 0 || main.indexOf('let wantedIngredientId') < firstSubscription, 'declared above the first subscription');
});

test('every new word exists in English and Italian, exactly as agreed', () => {
  const d = _dictionaries();
  const words = {
    'cat.fullScreen': ['Full screen', 'Schermo intero'],
    'cat.rowMenu.label': ['Actions for {name}', 'Azioni per {name}'],
    'cat.split.do': ['Split into 2 parts', 'Dividi in 2 parti'],
    'cat.split.undo': ['Remove the split', 'Togli la divisione'],
    'cat.split.toTaste': ['There is no amount to split', 'Non c’è una quantità da dividere'],
    'cat.split.tooSmall': ['Too small to split', 'Troppo poco da dividere'],
    'cat.split.line': ['→ {a} + {b}', '→ {a} + {b}'],
    'cat.order.do': ['Order', 'Ordina'],
    'cat.order.noSupplier': ['No supplier linked to this ingredient', 'Nessun fornitore collegato a questo ingrediente'],
    'cat.order.isRecipe': ['A recipe from the Recipe book: not ordered', 'È una ricetta del Ricettario: non si ordina'],
    'cat.order.notInUse': ['Marked “not in use” in Suppliers', 'Segnato “non in uso” in Fornitori'],
    'orders.fromRecipe.notFound': ['This ingredient is not in any order list', 'Questo ingrediente non è in nessun elenco d’ordine'],
    'orders.fromRecipe.saving': ['Saving the quantity, then back to the recipe…', 'Salvo la quantità e torno alla ricetta…'],
    'orders.fromRecipe.refusedTitle': ['Quantity not saved', 'Quantità non salvata'],
    'orders.fromRecipe.refusedMessage': ['The quantity you typed could not be saved in Orders. If you go back to the recipe now, it will be lost.',
      'Non sono riuscito a salvare in Ordini la quantità che hai scritto. Se torni adesso alla ricetta, andrà persa.'],
    'orders.fromRecipe.leaveAnyway': ['Back to the recipe anyway', 'Torna comunque alla ricetta'],
    'unsent.stay': ['Stay', 'Resta qui'],
  };
  for (const [key, [en, it]] of Object.entries(words)) {
    assert.equal(d.en[key], en, `en ${key}`);
    assert.equal(d.it[key], it, `it ${key}`);
  }
});

test('the supplier screen repeats the page’s status line, so a save error is seen where quantities are typed', () => {
  const main = codeOf(read('js/orders/orders-main.js'));
  const detail = codeOf(read('js/orders/supplier-detail.js'));
  assert.match(detail, /el\('p', \{ class: 'orders-status supplier-detail-status', role: 'status', hidden: true \}\),\s*body,/,
    'between the header and the rows');
  const mirror = main.slice(main.indexOf('function supplierStatusMirror'), main.indexOf('function setStatus'));
  assert.match(mirror, /if \(target !== document\.getElementById\('orders-status'\)\) return null;/, 'only a page-line message, never History’s');
  const set = main.slice(main.indexOf('function setStatus'), main.indexOf('function liveDataLost'));
  assert.match(set, /const lines = \[target, supplierStatusMirror\(target\)\]\.filter\(Boolean\)/, 'the page line is still written');
  assert.match(set, /for \(const elStatus of lines\) if \(elStatus\.textContent === text\) elStatus\.hidden = true;/);
  const clear = main.slice(main.indexOf('function clearStatusIf'), main.indexOf('function setupOfflineIndicator'));
  assert.match(clear, /\.supplier-detail > \.supplier-detail-status/);
  assert.match(main, /!pageLine\.hidden && pageLine\.classList\.contains\('error'\)/, 'an error already showing is repeated on a new screen');
  assert.match(read('orders.css'), /\.supplier-detail > \.supplier-detail-status \{ flex: none;/);
});

test('a rotation or the session landing keeps the split rows and lets the old screen go', () => {
  const main = codeOf(read('js/catalogue/catalogue-main.js'));
  const rot = main.slice(main.indexOf('watchTablet((isTablet) =>'), main.indexOf('watchTablet((isTablet) =>') + 700);
  assert.match(rot, /const split = activeDetail\?\.splitRows\?\.\(\) \|\| \[\];\s*activeDetail\?\.destroy\?\.\(\);/);
  assert.match(rot, /showDetailTablet\(latest, split\)/);
  assert.match(rot, /showDetailPhone\(latest, split\)/);
  assert.match(main, /const split = activeDetail\.splitRows\?\.\(\) \|\| \[\];\s*activeDetail\.destroy\?\.\(\);[\s\S]{0,120}renderDetail\(\{ recipe: latest, app, split \}\)/);
  assert.doesNotMatch(main, /renderDetail\(\{ recipe: latest, app \}\)/);
  assert.match(read('catalogue.css'), /@media \(hover: hover\) \{ \.cat-zoom-open:hover/);
});
