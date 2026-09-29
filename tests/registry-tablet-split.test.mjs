// Suppliers & ingredients on a tablet: the list on the left, what a row opens on the right
// (suppliers.html, js/orders/registry.js). P15.
//
// Two halves: the PURE form-dirty helper is unit-tested; the wiring in registry.js is pinned
// at source level (this project has no jsdom), naming the things a later edit could quietly
// break — the pane chosen by isTabletNow() only, Settings never in it, typed work never lost
// without asking, words never frozen at load, the phone path left alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { snapshotFields, snapshotChanged } from '../js/orders/form-dirty.js';
import { _dictionaries } from '../js/i18n.js';

const DICT = _dictionaries();

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// A stand-in for a form: querySelectorAll hands back plain objects shaped like fields.
const fakeForm = (fields) => ({ querySelectorAll: () => fields });
const text = (value = '') => ({ type: 'text', value, checked: false });
const box = (checked = false) => ({ type: 'checkbox', value: 'on', checked });
const select = (value = 'kg') => ({ type: 'select-one', value, checked: false });

// ── The pure helper ──────────────────────────────────────────────────────────

test('a form nobody touched is not dirty', () => {
  const snap = snapshotFields(fakeForm([text('Flour'), box(false), select('kg')]));
  assert.equal(snap.length, 3);
  assert.equal(snapshotChanged(snap), false);
});

test('a typed value makes it dirty', () => {
  const name = text('Flour');
  const snap = snapshotFields(fakeForm([name, box()]));
  name.value = 'Flours';
  assert.equal(snapshotChanged(snap), true);
});

test('a ticked box makes it dirty, and unticking it again makes it clean', () => {
  const gluten = box(false);
  const snap = snapshotFields(fakeForm([text('x'), gluten]));
  gluten.checked = true;
  assert.equal(snapshotChanged(snap), true);
  gluten.checked = false;
  assert.equal(snapshotChanged(snap), false);
});

test('a changed select makes it dirty', () => {
  const unit = select('kg');
  const snap = snapshotFields(fakeForm([unit]));
  unit.value = 'pcs';
  assert.equal(snapshotChanged(snap), true);
});

test('a field drawn AFTER the snapshot is not a change', () => {
  const fields = [text('a')];
  const snap = snapshotFields({ querySelectorAll: () => fields });
  fields.push(text('late'));
  assert.equal(snapshotChanged(snap), false);
});

test('buttons and file pickers carry no typed value and are not snapshotted', () => {
  const snap = snapshotFields(fakeForm([
    { type: 'button', value: '', checked: false },
    { type: 'submit', value: '', checked: false },
    { type: 'file', value: '', checked: false },
    text('kept'),
  ]));
  assert.equal(snap.length, 1);
});

test('nothing to snapshot never throws and is never dirty', () => {
  assert.deepEqual(snapshotFields(null), []);
  assert.equal(snapshotChanged(null), false);
  assert.equal(snapshotChanged([]), false);
});

// ── The wiring in registry.js ────────────────────────────────────────────────

const REGISTRY = codeOf(read('js/orders/registry.js'));

// The body of `function name(...) { ... }`, found by balanced braces.
function bodyOf(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found`);
  let i = src.indexOf(') {', start) + 2;
  const open = i;
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  return src.slice(open, i + 1);
}

test('push() picks the pane only through isTabletNow(), and never for a full-screen level', () => {
  const push = bodyOf(REGISTRY, 'push');
  assert.match(push, /pane\s*&&\s*!fullScreen\s*&&\s*isTabletNow\(\)\s*\?\s*pane\s*:\s*document\.body/);
  // The pane is not appended to anywhere else.
  const outside = REGISTRY.replace(push, '');
  assert.doesNotMatch(outside.replace(/moveOverlay[\s\S]*?\n {2}}\n/, ''), /pane\.appendChild\(/);
});

test('Settings is pushed full screen, at every size', () => {
  const settings = bodyOf(REGISTRY, 'openSettings');
  assert.match(settings, /\{\s*fullScreen:\s*true\s*\}/);
});

test('the phone path still appends to document.body', () => {
  assert.match(bodyOf(REGISTRY, 'push'), /document\.body/);
  // And a phone tap opens straight away, with no dialog and no clearing.
  const open = bodyOf(REGISTRY, 'openFromList');
  assert.match(open, /if \(!pane \|\| !isTabletNow\(\)\) \{ open\(\); return; \}/);
});

test('a row tapped on a tablet checks for typed work BEFORE it clears the pane', () => {
  const open = bodyOf(REGISTRY, 'openFromList');
  assert.ok(open.indexOf('paneDirty()') >= 0, 'openFromList must ask paneDirty()');
  assert.ok(open.indexOf('paneDirty()') < open.indexOf('clearPane()'), 'the dirty check comes first');
  // The dialog is the app's own, dangerous, and clearing only follows a yes.
  assert.match(open, /confirmDialog\(\{[\s\S]*danger:\s*true[\s\S]*\}\)\.then\(\(ok\) => \{\s*if \(!ok\) return;\s*clearPane\(\);/);
  assert.match(REGISTRY, /import \{ confirmDialog \} from '\.\/confirm-dialog\.js'/);
  assert.doesNotMatch(REGISTRY, /\bwindow\.confirm\(|[^.\w]confirm\(|[^.\w]alert\(/);
});

test('the header «+» and every list row go through openFromList()', () => {
  assert.match(bodyOf(REGISTRY, 'addCurrent'), /openFromList\(/);
  assert.match(REGISTRY, /openFromList\(\(\) => openSupplier\(s\.id\)\)/);
  assert.match(REGISTRY, /openFromList\(\(\) => openIngredientForm\(item, null\)\)/);
});

test('clearing the pane leaves each level by its own Back, so no promise is left pending', () => {
  const clear = bodyOf(REGISTRY, 'clearPane');
  assert.match(clear, /backOf\.get\(top\.overlay\)/);
  assert.match(bodyOf(REGISTRY, 'overlay'), /backOf\.set\(node, onBack\)/);
});

test('every level of a form snapshots its fields once it is built', () => {
  assert.match(bodyOf(REGISTRY, 'push'), /snapshotFields\(form\)/);
  assert.match(bodyOf(REGISTRY, 'paneDirty'), /snapshotChanged\(entry\.snapshot\)/);
});

test('the open row is marked with aria-current and re-marked after every repaint', () => {
  assert.match(bodyOf(REGISTRY, 'paintSelection'), /setAttribute\('aria-current', 'true'\)/);
  assert.match(bodyOf(REGISTRY, 'paintSelection'), /removeAttribute\('aria-current'\)/);
  assert.match(bodyOf(REGISTRY, 'paintList'), /paintSelection\(\)/);
  assert.match(bodyOf(REGISTRY, 'stackChanged'), /paintSelection\(\)/);
});

test('the placeholder words are asked with t() inside a function, and re-asked when the language arrives', () => {
  const paint = bodyOf(REGISTRY, 'paintPane');
  assert.match(paint, /t\(`orders\.registry\.pane\.\$\{which\}\.title`\)/);
  assert.match(paint, /t\(`orders\.registry\.pane\.\$\{which\}\.text`\)/);
  assert.match(REGISTRY, /onLanguageChange\(paintPane\)/);
  // ⚠️ Nothing at the top level of the module asks t(), or the boot language would be frozen.
  const topLevel = REGISTRY.replace(bodyOf(REGISTRY, 'buildRegistry'), '');
  assert.doesNotMatch(topLevel, /\bt\(/);
  // The words follow the active tab.
  assert.match(paint, /tab === 'suppliers' \? 'suppliers' : tab === 'packaging' \? 'packaging' : 'ingredients'/);
});

test('crossing the width moves live levels between pane and body, watched through watchTablet', () => {
  assert.match(REGISTRY, /watchTablet\(placeOverlays\)/);
  const place = bodyOf(REGISTRY, 'placeOverlays');
  assert.match(place, /moveOverlay\(entry\.overlay, pane\)/);
  assert.match(place, /moveOverlay\(entry\.overlay, document\.body\)/);
  // A move restores focus and caret, like Orders' moveDetail.
  const move = bodyOf(REGISTRY, 'moveOverlay');
  assert.match(move, /active\.focus\(/);
  assert.match(move, /setSelectionRange\(/);
  // Both subscriptions come AFTER every declaration they can reach (TDZ).
  assert.ok(REGISTRY.lastIndexOf('watchTablet(placeOverlays)') > REGISTRY.lastIndexOf('paintList();'));
});

test('registry-main hands the pane in, and suppliers.html carries the three pieces', () => {
  assert.match(read('js/orders/registry-main.js'), /pane:\s*document\.getElementById\('registry-pane'\)/);
  const page = read('suppliers.html');
  assert.match(page, /<div class="app-split" id="registry-split">/);
  assert.match(page, /id="registry-host" class="reg-page app-split-list"/);
  assert.match(page, /id="registry-pane" class="app-split-pane"/);
  assert.match(page, /class="scroll-area scroll-with-bar app-split-area"/);
});

test('the pane keeps the feature boundary: it imports only from its own folder and js/ root', () => {
  const imports = [...read('js/orders/registry.js').matchAll(/from '([^']+)'/g)].map(m => m[1]);
  assert.ok(imports.includes('./tablet-layout.js') && imports.includes('./form-dirty.js'));
  assert.ok(imports.every(p => !/\.\.\/(catalogue|foodcost|pastries|inventory|staff)\//.test(p)), imports.join(', '));
});

// ── The words exist in both languages ────────────────────────────────────────

const KEYS = [
  'orders.registry.pane.ingredients.title', 'orders.registry.pane.ingredients.text',
  'orders.registry.pane.packaging.title', 'orders.registry.pane.packaging.text',
  'orders.registry.pane.suppliers.title', 'orders.registry.pane.suppliers.text',
  'orders.registry.discardTitle', 'orders.registry.discardMessage',
];

test('the new words exist in English and in Italian, and differ', () => {
  for (const key of KEYS) {
    assert.ok(DICT.en[key], `en is missing ${key}`);
    assert.ok(DICT.it[key], `it is missing ${key}`);
    assert.notEqual(DICT.en[key], DICT.it[key], `${key} is untranslated`);
  }
});
