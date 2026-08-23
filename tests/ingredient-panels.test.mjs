// The two switches: does this venue track allergens, and does it track nutrition?
//
// ⚠️⚠️ THE PROPERTY EVERYTHING HERE DEFENDS IS THAT IT IS A DISPLAY SWITCH AND NOT A
// DATA ONE. Turning allergens off hides five screens; it must delete nothing, and an
// ordinary rename made while it is off must save every tick, stamp and nutrition
// figure back exactly as it found them. That cannot be seen by using the app — the
// data is invisible by definition while the switch is off — so it is guarded here.
//
// ⚠️ AND THE SECOND: WHEN IT IS OFF, THE LABEL GOES WITH IT. A printed food label
// with no allergen line is worse than no label at all, so the way to it disappears
// and the label screen refuses even if a future door reaches it anyway.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { allergensOn, nutritionOn, FEATURE_KEYS } from '../js/venue-features.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(join(ROOT, name), 'utf8');
// Comments are where this project explains itself, and they name the very things
// these tests forbid. Judge the CODE.
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FORM = codeOf(read('js/orders/ingredient-form.js'));
const REGISTRY = codeOf(read('js/orders/registry.js'));
const DETAIL = codeOf(read('js/catalogue/catalogue-detail.js'));
const CAT_MAIN = codeOf(read('js/catalogue/catalogue-main.js'));
const LABEL = codeOf(read('js/catalogue/label-view.js'));
const ONBOARDING = codeOf(read('functions/onboarding.js'));
const SW = read('sw.js');

// ── 1. The default is ON, and only an explicit `false` moves it ──────────────

test('⚠️⚠️ everything that is not the word false answers ON', () => {
  // A venue that has never heard of these keys, one whose document failed to load,
  // one carrying junk. All three must leave the allergen card exactly where it was:
  // the opposite direction would let a typo remove the one part of this app that can
  // send somebody to hospital, silently.
  for (const doc of [null, undefined, {}, 'nonsense', 42, [],
    { showAllergens: 0 }, { showAllergens: '' }, { showAllergens: 'false' },
    { showAllergens: null }, { showAllergens: undefined }]) {
    assert.equal(allergensOn(doc), true, `${JSON.stringify(doc)} must not hide allergens`);
  }
  assert.equal(allergensOn({ showAllergens: false }), false,
    'and the one value that does turn it off is the boolean somebody chose');
});

test('nutrition answers the same way, and the two are independent', () => {
  assert.equal(nutritionOn(null), true);
  assert.equal(nutritionOn({ showNutrition: false }), false);
  // A bakery may well declare allergens (the law) and never type a kilojoule.
  const doc = { showAllergens: true, showNutrition: false };
  assert.equal(allergensOn(doc), true);
  assert.equal(nutritionOn(doc), false);
  const other = { showAllergens: false, showNutrition: true };
  assert.equal(allergensOn(other), false);
  assert.equal(nutritionOn(other), true);
});

test('the key names are shared with the callable rather than typed twice', () => {
  assert.deepEqual([...FEATURE_KEYS], ['showAllergens', 'showNutrition']);
  for (const key of FEATURE_KEYS) {
    assert.ok(ONBOARDING.includes(key),
      `${key} must be a field the Cloud Function actually writes`);
  }
});

test('⚠️ the judgement lives in ONE file, and it is not inside `sections`', () => {
  // sectionOn() reads a MISSING key as true, so a flag put in there works by accident
  // today and cannot be switched off cleanly later. Same reasoning as recipePhoto.
  assert.doesNotMatch(codeOf(read('js/sections.js')), /showAllergens|showNutrition/,
    'these are not sections — sections decide which Home cards exist');
  // And nobody re-derives the rule by hand.
  const home = 'js/venue-features.js';
  const offenders = [];
  for (const file of allJsFiles()) {
    if (file === home) continue;
    if (/showAllergens\s*!==\s*false|showNutrition\s*!==\s*false/.test(codeOf(read(file)))) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [],
    `these decide the default themselves instead of asking ${home}`);
});

// ── 2. A display switch, never a data switch ─────────────────────────────────

test('⚠️⚠️ the form builds every box even when it does not draw it', () => {
  // The boxes, the nutrition inputs and the pack text are created from the stored
  // ingredient BEFORE `panels` is consulted, so read() hands back what was there.
  // Skipping the build would turn correcting a brand into erasing a declaration.
  const body = FORM.slice(FORM.indexOf('function allergenBlock('), FORM.indexOf('function fold('));
  assert.ok(body.length > 500, 'the slice must actually hold the block');

  const firstPanelUse = body.indexOf('panels.');
  assert.ok(firstPanelUse > 0, 'the block must consult the switches at all');
  const beforeAnySwitch = body.slice(0, firstPanelUse);
  for (const built of ['boxes.set(code', 'nutrients.set(n.key', 'packBox.value = item', 'checked.checked = isDeclared(item)']) {
    assert.ok(beforeAnySwitch.includes(built),
      `${built} must happen before the switches are read, or hiding a panel would wipe its data`);
  }
});

test('⚠️⚠️ read() never asks whether a panel is shown', () => {
  const start = FORM.indexOf('  function read() {', FORM.indexOf('function allergenBlock('));
  const body = FORM.slice(start, FORM.indexOf('  function refresh()', start));
  assert.ok(start > 0 && body.includes('buildAllergenFields'), 'the slice must hold read()');
  assert.doesNotMatch(body, /panels/,
    'what is SAVED must not depend on what is DRAWN — that is the whole difference '
    + 'between a display switch and a data switch');
});

test('⚠️ the server writes the two booleans and nothing else', () => {
  const fn = ONBOARDING.slice(ONBOARDING.indexOf('export const setIngredientPanels'));
  assert.ok(fn.length > 300, 'the slice must hold the callable');
  assert.doesNotMatch(fn, /\.\.\.request\.data|\.\.\.data\b/,
    'a spread would carry anything the caller sent onto the document holding '
    + '`sections` and `country`');
  assert.match(fn, /\{ merge: true \}/,
    'a whole write here would erase the venue name, its sections and its country');
  assert.doesNotMatch(fn, /ingredients|delete|batch/i,
    'nothing about this call may touch an ingredient document');
});

test('the callable refuses a non-boolean, an empty patch, and an employee', () => {
  const fn = ONBOARDING.slice(ONBOARDING.indexOf('export const setIngredientPanels'));
  assert.match(fn, /typeof showAllergens !== 'boolean'/);
  assert.match(fn, /typeof showNutrition !== 'boolean'/);
  // set({}, {merge:true}) succeeds and changes nothing — a screen sending the wrong
  // field name would report success and spring back on the next load.
  assert.match(fn, /if \(!Object\.keys\(patch\)\.length\)[\s\S]{0,120}invalid-argument/);
  assert.match(fn, /access !== 'owner' && access !== 'manager'[\s\S]{0,160}permission-denied/,
    'hiding the switch is courtesy; this is the half that refuses');
});

test('⚠️ a callable missing from index.js is not deployed at all', () => {
  assert.match(read('functions/index.js'), /setIngredientPanels/,
    'and the app\'s call would fail with the client\'s generic "internal"');
});

// ── 3. Off means off in all five places, the label included ──────────────────

test('⚠️⚠️ all five places ask, and the label is one of them', () => {
  const places = [
    ['js/orders/ingredient-form.js', FORM, /allergenBlock\(item, ingredientPanels\(\)\)/],
    ['js/orders/registry.js', REGISTRY, /ingredientPanels\(\)\.allergens && allergenState\(item\)/],
    ['js/catalogue/catalogue-detail.js', DETAIL, /if \(!allergensOn\(currentSession\(\)\.location\)\)/],
    ['js/catalogue/catalogue-main.js', CAT_MAIN, /allergensBtn\.hidden = !allergensOn\(/],
    ['js/catalogue/label-view.js', LABEL, /if \(!allergensOn\(location\)\)/],
  ];
  for (const [name, src, pattern] of places) {
    assert.match(src, pattern, `${name} must obey the switch`);
  }
});

test('⚠️⚠️ the only way to a label is inside the card the switch removes', () => {
  // openLabel has exactly one caller, and it sits inside allergenPanel(). If that
  // ever stops being true the belt in label-view.js is what is left.
  const callers = allJsFiles().filter(f => /app\.openLabel\(/.test(codeOf(read(f))));
  assert.deepEqual(callers, ['js/catalogue/catalogue-detail.js'],
    'a second door to the label would need its own check');
  const panel = DETAIL.slice(DETAIL.indexOf('function allergenPanel('));
  const guardAt = panel.indexOf('allergensOn(');
  const doorAt = panel.indexOf('app.openLabel(');
  assert.ok(guardAt > 0 && doorAt > guardAt,
    'the refusal must come before the button that leads to a label');
});

test('the refusal on the label screen comes before anything is worked out', () => {
  const paint = LABEL.slice(LABEL.indexOf('function paint()'));
  const off = paint.indexOf('allergensOn(location)');
  const built = paint.indexOf('buildLabel(');
  assert.ok(off > 0 && built > off,
    'no label may be computed for a venue that does not track allergens');
});

test('⚠️⚠️ the bottom bars carry no permission — each button carries its own', () => {
  // The v1.62.0 lesson, and it cost this project a release: the catalogue's bar was
  // gated on canManage while a photo switch was the only thing in it, and moving the
  // allergen sheet in would have walled it off from the counter staff it is for.
  for (const [name, src] of [['js/catalogue/catalogue-main.js', CAT_MAIN],
    ['js/orders/registry-main.js', codeOf(read('js/orders/registry-main.js'))]]) {
    assert.match(src, /footerEl\.hidden = !\[\.\.\.footerEl\.children\]\.some\(child => !child\.hidden\)/,
      `${name}: an empty bar hides itself — the rule is derived, never "manager only"`);
    assert.doesNotMatch(src, /footerEl\.hidden = .*canManage/,
      `${name}: a gate on the bar is a gate on everything later put inside it`);
  }
});

test('the allergen button is hidden by the VENUE, never by the person', () => {
  assert.doesNotMatch(CAT_MAIN, /allergensBtn\.hidden = .*canManage/,
    'the sheet has never had a role gate: its first audience is counter staff');
  assert.match(CAT_MAIN, /settingsBtn\.hidden = currentSession\(\)\.canManage !== true;/,
    'and the Settings button keeps its own, unchanged');
});

// ── 4. The card is in sections, and the answer is never behind a tap ─────────

test('⚠️ the status line stays OUTSIDE the fold, the tick boxes go inside', () => {
  const call = FORM.slice(FORM.indexOf('if (panels.allergens) {'), FORM.indexOf('if (panels.nutrition) {'));
  assert.ok(call.includes('above: [status]'),
    'somebody asked «are there nuts in this?» must read the answer without tapping');
  assert.ok(call.includes("el('div', { class: 'alg-list' }, sections)") && call.includes('body: ['),
    'the 52 tick boxes are the JOB, and the job is what folds');
  const bodyAt = call.indexOf('body: [');
  assert.ok(call.indexOf('above: [status]') < bodyAt, 'and the answer comes first');
});

test('both folds open CLOSED, every time', () => {
  const fold = FORM.slice(FORM.indexOf('function fold('));
  assert.match(fold, /class: 'mgmt-fold-body', hidden: 'hidden'/,
    'remembering it open would quietly undo the change on the screen it was made for');
  assert.match(fold, /'aria-expanded': 'false'/);
  // ⚠️ THE STRING 'hidden', NEVER A BOOLEAN. setAttribute('hidden', false) writes the
  // STRING "false" and [hidden] matches on PRESENCE — the v1.60.1 defect.
  assert.doesNotMatch(fold, /hidden: (true|false)\b/);
});

test('the four sections are all named, and each name exists in both languages', () => {
  for (const key of ['orders.section.productData', 'orders.section.price',
    'orders.section.allergens', 'orders.section.nutrition']) {
    assert.ok(FORM.includes(`'${key}'`), `${key} must name a section of the record`);
  }
  const dict = read('js/i18n.js');
  for (const key of ['orders.section.productData', 'orders.section.allergens',
    'orders.section.nutrition', 'orders.declaredShort', 'orders.settings.showAllergens',
    'orders.settings.showNutrition', 'orders.settings.offBody', 'label.blocked.allergensOff']) {
    const hits = dict.split(`'${key}':`).length - 1;
    assert.equal(hits, 2, `${key} must be in BOTH dictionaries, exactly once each`);
  }
});

test('⚠️ the retired label is gone from the code AND from both dictionaries', () => {
  // «Allergens and nutrition» named one block; there are two sections now, each with
  // its own heading, so one label covering both would name neither.
  assert.doesNotMatch(FORM, /allergensAndNutrition/);
  assert.doesNotMatch(read('js/i18n.js'), /'orders\.allergensAndNutrition':/);
});

// ── 5. Precached, or an offline install gets nothing ─────────────────────────

test('⚠️⚠️ EVERY module a precached page STATICALLY needs is precached too', () => {
  // ⚠️ DERIVED, NOT A HAND-WRITTEN LIST. Three tests in v1.65.0 carried hand-written
  // page lists and a whole new page walked past all three. install() is
  // all-or-nothing: one missing entry and NOTHING is cached for this version — the
  // single failure in this project that does not heal itself.
  //
  // ⚠️ IT WALKS THE IMPORT GRAPH RATHER THAN THE DIRECTORY, and that is what makes it
  // right instead of merely strict. Nine modules are deliberately absent from ASSETS
  // and each absence is correct: order.html is the CLIENT's page and is not precached
  // either, firebase.example.js is a template nobody imports, and the app owner's back
  // office is reached only through a dynamic import() so no customer's phone ever asks
  // for it. All three fall out of "start at the precached pages and follow the STATIC
  // imports" — no exemption has to be typed, and none can go stale.
  const missing = [...staticallyReachable()].filter(rel => !SW.includes(`'./${rel}'`)).sort();
  assert.deepEqual(missing, [], 'these would 404 for an installed phone that goes offline');
});

test('the walk actually reaches the app, and stops at what is not precached', () => {
  // ⚠️ A CHECK THAT REACHES NOTHING PASSES EVERYTHING. Sanity-check the check.
  const reached = staticallyReachable();
  assert.ok(reached.size > 60, `the walk found only ${reached.size} modules — it is broken`);
  assert.ok(reached.has('js/orders/registry-settings.js') && reached.has('js/venue-features.js'),
    'this release\'s own new files must be inside the graph, or the test above proves nothing');
  assert.ok(!reached.has('js/client-orders/order-main.js'),
    'order.html is not precached, so nothing behind it should be');
  assert.ok(!reached.has('js/staff/businesses.js'),
    'the back office is reached only by dynamic import()');
});

test('the cache was bumped, because files were added', () => {
  const version = SW.match(/const CACHE_NAME = 'theitalianclub-v(\d+)'/);
  assert.ok(version, 'sw.js must carry a versioned cache name');
  assert.ok(Number(version[1]) >= 331,
    'a deploy that ADDS a file without a bump is the one failure that does not self-heal');
});

// Every .js the browser loads, repo-relative, vendor excluded (it is precached under
// its own name and is not ours to check).
function allJsFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'vendor' || name === 'node_modules') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (name.endsWith('.js')) out.push(full.slice(ROOT.length + 1).replace(/\\/g, '/'));
    }
  };
  walk(join(ROOT, 'js'));
  return out.sort();
}

// Start at every HTML page the service worker precaches, take the modules its
// <script type="module"> tags load, and follow STATIC imports from there.
//
// ⚠️ STATIC ONLY. `await import('./staff/businesses.js')` is deliberately not
// followed: a dynamic import happens when somebody opens a screen, so the fetch
// handler can cache it then — which is exactly why those files may be absent.
function staticallyReachable() {
  const seen = new Set();
  const queue = [];

  for (const page of readdirSync(ROOT).filter(n => n.endsWith('.html'))) {
    if (!SW.includes(`'./${page}'`)) continue;          // order.html stops here
    for (const m of read(page).matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)) {
      queue.push(m[1].replace(/^\.\//, ''));
    }
  }

  while (queue.length) {
    const rel = queue.pop();
    if (seen.has(rel) || !rel.endsWith('.js')) continue;
    seen.add(rel);
    let src;
    try { src = read(rel); } catch { continue; }        // not a file of ours
    const dir = dirname(rel);
    // `import … from '…'`, `import '…'`, and `export … from '…'`.
    for (const m of src.matchAll(/^\s*(?:import|export)[^;'"\n]*?from\s*'([^']+)'|^\s*import\s*'([^']+)'/gm)) {
      const spec = m[1] || m[2];
      if (!spec.startsWith('.')) continue;              // the gstatic SDK
      queue.push(join(dir, spec).replace(/\\/g, '/'));
    }
  }
  return seen;
}
