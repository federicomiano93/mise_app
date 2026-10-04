// The two tray logics of a Calculator recipe (4 Oct 2026). P15 — the owner cannot read code.
//   • 'trays'      → the person types HOW MANY TRAYS; dough = trays × the recipe's tray weight;
//   • 'traysTotal' → trays × tray weight + a typed total in grams;
//   both scale the ingredients pro-rata, with the leavening neutralised, like 'total'.
//   • `trayWeight` (whole grams, default 1000, 1…100000) is kept on the recipe whatever the logic;
//   • a saved dough keeps the trays and the weight it was made with (sheet.trays / trayWeight_g);
//   • configModel is 3, so an app that does not know trays cannot overwrite a trays recipe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOGICS, CONFIG_MODEL, DEFAULT_TRAY_WEIGHT, MAX_TRAY_WEIGHT, MAX_TRAYS,
  computeRecipeTarget, normalizeConfig, normalizeTrayWeight, normalizeTrays, isValidTrayWeight,
  MIN_TRAY_WEIGHT, settledTraysText, traysGrams, formatGrams, showsLeaveningKnob, usesOrders, usesTrays, usesTypedTotal, isProRata,
} from '../js/calculator-config.js';
import { buildSheet, recipeSnapshot, traysEditState, traysSheetRecipe } from '../js/log-model.js';
import { mergeImportedRecipe, importFailureKey } from '../js/catalogue/catalogue-model.js';
import { translate, _dictionaries } from '../js/i18n.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');

const INGS = [
  { key: 'flour', label: 'Flour', grams: 600 },
  { key: 'water', label: 'Water', grams: 380 },
  { key: 'salt', label: 'Salt', grams: 20 },
];
function recipe(over = {}) {
  return {
    id: 'r1', name: 'Pizza', logic: 'trays', trayWeight: 1000, ingredients: INGS,
    leaveningKey: null, leaveningDefaultPct: 0, showLeavening: true, baselinePct: null, ...over,
  };
}
const cfg = {};

// ── The math ────────────────────────────────────────────────────────────────────────
test('the logic list holds the two new logics, and the helpers classify all five', () => {
  assert.deepEqual(LOGICS, ['orders', 'total', 'both', 'trays', 'traysTotal']);
  assert.deepEqual(LOGICS.map(usesOrders), [true, false, true, false, false]);
  assert.deepEqual(LOGICS.map(usesTrays), [false, false, false, true, true]);
  assert.deepEqual(LOGICS.map(usesTypedTotal), [false, true, true, false, true]);
  assert.deepEqual(LOGICS.map(isProRata), [false, true, false, true, true]);
});

test('trays: trays × tray weight, nothing else counts', () => {
  const r = recipe();
  assert.equal(computeRecipeTarget(cfg, r, { trays: 5 }), 5000);
  assert.equal(computeRecipeTarget(cfg, r, { trays: 5, totalInput: 777, extraGrams: 123 }), 5000);
  assert.equal(computeRecipeTarget(cfg, recipe({ trayWeight: 1200 }), { trays: 5 }), 6000);
});

test('traysTotal: trays × tray weight + the typed total', () => {
  const r = recipe({ logic: 'traysTotal' });
  assert.equal(computeRecipeTarget(cfg, r, { trays: 5, totalInput: 500 }), 5500);
  assert.equal(computeRecipeTarget(cfg, r, { trays: 0, totalInput: 500 }), 500);
  assert.equal(computeRecipeTarget(cfg, r, { trays: 2, totalInput: 0 }), 2000);
  assert.equal(computeRecipeTarget(cfg, r, { trays: 5, totalInput: 500, extraGrams: 999 }), 5500, 'no extra-dough box');
});

test('the other logics ignore trays', () => {
  for (const logic of ['total', 'orders', 'both']) {
    const out = computeRecipeTarget(cfg, recipe({ logic }), { trays: 9, totalInput: 100 });
    assert.equal(out, logic === 'orders' ? 0 : 100, logic);
  }
});

test('bad inputs never give NaN or a negative: negative, text, NaN, Infinity, null', () => {
  for (const logic of ['trays', 'traysTotal']) {
    const r = recipe({ logic });
    for (const bad of [-3, 'abc', NaN, Infinity, -Infinity, null, undefined, {}, []]) {
      const out = computeRecipeTarget(cfg, r, { trays: bad, totalInput: bad });
      assert.ok(Number.isFinite(out) && out >= 0, `${logic} / ${String(bad)} → ${out}`);
    }
    assert.equal(computeRecipeTarget(cfg, r, { trays: -3, totalInput: 0 }), 0);
    assert.equal(computeRecipeTarget(cfg, r, { trays: 'abc', totalInput: 0 }), 0);
  }
  assert.equal(computeRecipeTarget(cfg, null, { trays: 5 }), 0);
});

test('whole trays only: a fraction is cut down, a huge number is capped', () => {
  assert.equal(normalizeTrays(2.9), 2);
  assert.equal(normalizeTrays('4'), 4);
  assert.equal(normalizeTrays(''), 0);
  assert.equal(normalizeTrays(-1), 0);
  assert.equal(normalizeTrays(1e9), MAX_TRAYS);
  assert.equal(traysGrams(recipe({ trayWeight: 1500 }), 3), 4500);
});

test('trays recipes show no leavening knob, whatever the flag says', () => {
  for (const logic of ['trays', 'traysTotal', 'total']) {
    assert.equal(showsLeaveningKnob(recipe({ logic, leaveningKey: 'salt', showLeavening: true })), false, logic);
  }
  assert.equal(showsLeaveningKnob(recipe({ logic: 'orders', leaveningKey: 'salt', showLeavening: true })), true);
});

// ── The tray weight on the recipe ───────────────────────────────────────────────────
test('normalizeTrayWeight: missing, text, NaN, zero or negative → 1000; whole grams; capped', () => {
  assert.equal(DEFAULT_TRAY_WEIGHT, 1000);
  for (const bad of [undefined, null, '', 'abc', NaN, 0, -5, 0.2, Infinity, {}]) {
    assert.equal(normalizeTrayWeight(bad), 1000, String(bad));
  }
  assert.equal(normalizeTrayWeight(1200), 1200);
  assert.equal(normalizeTrayWeight('850'), 850);
  assert.equal(normalizeTrayWeight(1200.6), 1201);
  assert.equal(normalizeTrayWeight(1e9), MAX_TRAY_WEIGHT);
});

test('isValidTrayWeight: only a real number from 50 g to the cap is an answer', () => {
  for (const ok of [50, 1000, '750', MAX_TRAY_WEIGHT]) assert.equal(isValidTrayWeight(ok), true, String(ok));
  for (const bad of ['', null, undefined, 0, '0', 1, 1.2, 30, 49.9, -1, 'abc', NaN, MAX_TRAY_WEIGHT + 1]) {
    assert.equal(isValidTrayWeight(bad), false, String(bad));
  }
});

test('the config keeps trayWeight on every recipe, whatever the logic, and defaults it', () => {
  const raw = {
    clients: [],
    recipes: [
      { id: 'a', name: 'A', logic: 'trays', trayWeight: 1200, ingredients: INGS },
      { id: 'b', name: 'B', logic: 'orders', trayWeight: 1500, ingredients: INGS },
      { id: 'c', name: 'C', logic: 'traysTotal', ingredients: INGS },
      { id: 'd', name: 'D', logic: 'trays', trayWeight: 'junk', ingredients: INGS },
    ],
  };
  const byId = Object.fromEntries(normalizeConfig(raw).recipes.map(r => [r.id, r]));
  assert.equal(byId.a.logic, 'trays');
  assert.equal(byId.a.trayWeight, 1200);
  assert.equal(byId.b.logic, 'orders');
  assert.equal(byId.b.trayWeight, 1500, 'kept after switching away from trays');
  assert.equal(byId.c.logic, 'traysTotal');
  assert.equal(byId.c.trayWeight, 1000);
  assert.equal(byId.d.trayWeight, 1000);
  // A round trip changes nothing.
  assert.deepEqual(normalizeConfig(normalizeConfig(raw)).recipes, normalizeConfig(raw).recipes);
});

test('configModel is at least 3: an older app cannot overwrite a trays recipe', () => {
  assert.ok(CONFIG_MODEL >= 3);
  assert.equal(normalizeConfig({ clients: [], configModel: 1 }).configModel, CONFIG_MODEL);
  assert.match(read('js/calculator-config.js'), /3 = adds the 'trays' \/ 'traysTotal'/);
});

// ── The saved dough ─────────────────────────────────────────────────────────────────
test('buildSheet: trays → ingredients exactly ×5, trays and weight stored', () => {
  const sheet = buildSheet({ recipe: recipe(), items: [], trays: 5, leaveningPct: 0 });
  assert.equal(sheet.total_g, 5000);
  assert.equal(sheet.trays, 5);
  assert.equal(sheet.trayWeight_g, 1000);
  assert.deepEqual(sheet.ingredients.map(i => i.grams), [3000, 1900, 100]);
  assert.equal(sheet.param, null);
});

test('buildSheet: a different tray weight, and trays + total', () => {
  const a = buildSheet({ recipe: recipe({ trayWeight: 1200 }), items: [], trays: 5 });
  assert.equal(a.total_g, 6000);
  assert.equal(a.trayWeight_g, 1200);
  const b = buildSheet({ recipe: recipe({ logic: 'traysTotal' }), items: [], trays: 5, totalInput: 500 });
  assert.equal(b.total_g, 5500);
  assert.equal(b.trays, 5);
  assert.deepEqual(b.ingredients.map(i => i.grams), [3300, 2090, 110]);
});

test('buildSheet: leavening is neutralised for a trays recipe even when one is designated', () => {
  const r = recipe({ leaveningKey: 'salt', leaveningDefaultPct: 2, baselinePct: 2 });
  const sheet = buildSheet({ recipe: r, items: [], trays: 5, leaveningPct: 9 });
  assert.deepEqual(sheet.ingredients.map(i => i.grams), [3000, 1900, 100]);
  assert.equal(sheet.param, null);
});

test('buildSheet: bad trays give a zero dough, never NaN; other logics store no trays', () => {
  for (const bad of [-2, 'abc', NaN, null, undefined]) {
    const s = buildSheet({ recipe: recipe(), items: [], trays: bad });
    assert.equal(s.total_g, 0, String(bad));
    assert.ok(s.ingredients.every(i => i.grams === 0));
  }
  const old = buildSheet({ recipe: recipe({ logic: 'total' }), items: [], totalInput: 400, trays: 7 });
  assert.equal(old.total_g, 400);
  assert.equal('trays' in old, false);
  assert.equal('trayWeight_g' in old, false);
});

test('recipeSnapshot freezes the tray weight of a trays recipe only', () => {
  assert.equal(recipeSnapshot(recipe({ trayWeight: 1300 })).trayWeight, 1300);
  assert.equal('trayWeight' in recipeSnapshot(recipe({ logic: 'orders' })), false);
  // The frozen recipe rebuilds the same sheet.
  const frozen = recipeSnapshot(recipe({ logic: 'traysTotal', trayWeight: 900 }));
  assert.equal(buildSheet({ recipe: frozen, items: [], trays: 4, totalInput: 100 }).total_g, 3700);
});

// ── Words ───────────────────────────────────────────────────────────────────────────
test('both dictionaries carry every tray string', () => {
  const d = _dictionaries();
  const keys = [
    'calc.byTray', 'calc.byTrayPlusTotal', 'calc.logicHint.trays', 'calc.logicHint.traysTotal',
    'calc.trayWeightG', 'calc.trayWeightMissing', 'calc.trayCount', 'calc.traysEquals',
    'calc.traysOfWeight', 'calc.traysTypedPart',
  ];
  for (const lang of ['en', 'it']) for (const k of keys) assert.ok(d[lang][k] !== undefined, `${lang} ${k}`);
  assert.equal(d.it['calc.byTray'], 'A teglie');
  assert.equal(d.it['calc.trayCount'], 'Numero di teglie');
  assert.equal(d.it['calc.trayWeightG'], 'Peso per teglia (g)');
  assert.equal(d.en['calc.trayWeightG'], 'Weight per tray (g)');
});

test('«5 trays × 1,000 g»: plural handled by the dictionary, singular too', () => {
  const d = _dictionaries();
  assert.equal(translate(d, 'en', 'calc.traysOfWeight', { n: 5, trays: '5', g: '1,000' }), '5 trays × 1,000 g');
  assert.equal(translate(d, 'en', 'calc.traysOfWeight', { n: 1, trays: '1', g: '1,000' }), '1 tray × 1,000 g');
  assert.equal(translate(d, 'it', 'calc.traysOfWeight', { n: 5, trays: '5', g: '1.000' }), '5 teglie × 1.000 g');
  assert.equal(translate(d, 'it', 'calc.traysOfWeight', { n: 1, trays: '1', g: '1.000' }), '1 teglia × 1.000 g');
});

test('formatGrams groups four-digit numbers (Italian Intl would not by default)', () => {
  assert.equal(formatGrams(5000), '5,000'); // the interface language is English under test
  assert.equal(formatGrams(NaN), '0');
  assert.equal(formatGrams(1234.6), '1,235');
});

// ── Wiring (the DOM cannot run here; the shapes that broke before are pinned) ───────
test('the Calculator tab: trays field, persisted and cleared like the typed total', () => {
  const render = read('js/calculator-render.js');
  assert.match(render, /usesTrays\(recipe\.logic\)/);
  assert.match(render, /id: id \+ '-trays-input'/);
  assert.match(render, /id: id \+ '-trays-grams'/);
  assert.match(render, /t\('calc\.trayCount'\)/);
  const app = read('js/app.js');
  assert.match(app, /localStorage\.getItem\('trays-' \+ id\)/);
  assert.match(app, /localStorage\.setItem\('trays-' \+ id, traysInput\.value\)/);
  assert.match(app, /localStorage\.removeItem\('trays-' \+ recipeId\)/, 'Reset and the new-day sweep forget it');
  const calc = read('js/calc.js');
  assert.match(calc, /trays: traysFor\(id\)/);
  assert.match(calc, /isProRata\(recipe\.logic\)/);
  assert.match(read('js/log.js'), /trays: traysFor\(tab\)/);
});

test('the Recipes row: the weight field, refused when empty, kept when the logic changes', () => {
  const src = read('js/recipes.js');
  assert.match(src, /calc\.trayWeightG/);
  assert.match(src, /isValidTrayWeight\(r\.trayWeight\)/);
  assert.match(src, /revealField\(document\.getElementById\('rc-tray-weight-'/);
  assert.doesNotMatch(src, /delete r\.trayWeight/, 'switching the logic never drops the weight');
  assert.match(src, /usesOrders\(r\.logic\)/, 'the leavening picker follows the orders logics only');
});

test('manual add and edit of a dough know the tray logics', () => {
  const add = read('js/log-add.js');
  assert.match(add, /usesTrays\(recipe\.logic\)/);
  assert.match(add, /trays: num\(state\.trays\)/);
  const edit = read('js/log-edit.js');
  assert.match(edit, /usesTrays\(working\.recipe\.logic\)/);
  assert.match(edit, /totalInput, trays, leaveningPct, divisor/);
  assert.match(read('js/log-view.js'), /calc\.traysOfWeight/);
});

// ── The review fixes ────────────────────────────────────────────────────────────────
test('a tray weight under 50 g is refused on Save and never read as grams per tray', () => {
  assert.equal(MIN_TRAY_WEIGHT, 50);
  assert.equal(isValidTrayWeight(49), false);
  assert.equal(isValidTrayWeight(50), true);
  // A stored weight under 50 (from anywhere but the Recipes screen) reads as the default.
  for (const low of [1, 1.2, 30, 49]) assert.equal(normalizeTrayWeight(low), 1000, String(low));
  assert.equal(normalizeTrayWeight(50), 50);
  assert.equal(normalizeConfig({ clients: [], recipes: [{ id: 'a', name: 'A', logic: 'trays', trayWeight: 1.2, ingredients: INGS }] }).recipes[0].trayWeight, 1000);
  const d = _dictionaries();
  assert.equal(translate(d, 'en', 'calc.trayWeightTooLight'), 'That is very light for a tray: write the weight in grams (e.g. 1000).');
  assert.equal(translate(d, 'it', 'calc.trayWeightTooLight'), 'È molto leggera per una teglia: scrivi il peso in grammi (per es. 1000).');
  assert.match(read('js/recipes.js'), /calc\.trayWeightTooLight/);
});

test('the trays box shows what is computed: a fraction is replaced by the whole number used', () => {
  assert.equal(settledTraysText('2.9'), '2');
  assert.equal(settledTraysText('007'), '7');
  assert.equal(settledTraysText('-3'), '0');
  assert.equal(settledTraysText('99999'), String(MAX_TRAYS));
  assert.equal(settledTraysText('5'), null, 'already whole: left alone');
  assert.equal(settledTraysText(''), null, 'empty is left alone while typing');
  assert.equal(settledTraysText('2.9') === String(normalizeTrays('2.9')), true);
  for (const f of ['js/app.js', 'js/log-add.js', 'js/log-edit.js']) assert.match(read(f), /settledTraysText\(/, f);
});

test('Add and Edit show the «= N g» line under the trays field, outside the label', () => {
  for (const f of ['js/log-add.js', 'js/log-edit.js']) {
    const src = read(f);
    assert.match(src, /calc\.traysEquals/, f);
    assert.match(src, /'aria-describedby': '(logadd|logedit)-trays-grams'/, f);
  }
  const render = read('js/calculator-render.js');
  assert.match(render, /'aria-describedby': id \+ '-trays-grams'/);
  assert.doesNotMatch(render, /el\('label', \{ class: 'param-label', for: id \+ '-trays-input' \}, \[/, 'the label holds text only');
});

test('editing a trays log keeps the weight and the typed part it was made with', () => {
  const sheet = { trays: 4, trayWeight_g: 900, total_g: 3700 };
  const frozen = recipe({ logic: 'traysTotal', trayWeight: 1200 });
  const st = traysEditState(sheet, frozen);
  assert.deepEqual(st, { trays: 4, trayWeight: 900, typedTotal: 100 });
  const rebuild = (trays) => buildSheet({ recipe: traysSheetRecipe(frozen, st.trayWeight), items: [], totalInput: st.typedTotal, trays, leaveningPct: 0 });
  const same = rebuild(st.trays);
  assert.equal(same.total_g, 3700);
  assert.equal(same.trayWeight_g, 900);
  const more = rebuild(5);
  assert.equal(more.total_g, 4600);
  assert.equal(more.trays, 5);
  assert.equal(more.trayWeight_g, 900);
  // A plain «trays» log has no typed part; another logic's recipe is passed through untouched.
  assert.equal(traysEditState({ trays: 2, trayWeight_g: 800, total_g: 1600 }, recipe({ logic: 'trays' })).typedTotal, 0);
  const orders = recipe({ logic: 'orders' });
  assert.equal(traysSheetRecipe(orders, 900), orders);
});

test('re-importing from the Catalogue keeps how the tab calculates, and refreshes the rest', () => {
  const existing = { id: 'cat-x', name: 'Old', logic: 'traysTotal', trayWeight: 1200, order: 3, visible: false, ingredients: INGS };
  const imported = { id: 'cat-x', name: 'New', logic: 'total', ingredients: [INGS[0]] };
  const { config, action } = mergeImportedRecipe({ recipes: [existing] }, imported);
  const r = config.recipes[0];
  assert.equal(action, 'updated');
  assert.equal(r.name, 'New');
  assert.equal(r.ingredients.length, 1);
  assert.equal(r.logic, 'traysTotal');
  assert.equal(r.trayWeight, 1200);
  assert.equal(r.order, 3);
  assert.equal(r.visible, false);
  // A recipe without a stored weight does not get an invented one.
  const bare = mergeImportedRecipe({ recipes: [{ id: 'cat-x', order: 0, visible: true }] }, imported).config.recipes[0];
  assert.equal('trayWeight' in bare, false);
  assert.equal(bare.logic, 'total');
});

test('a refused Catalogue import says «out of date», any other failure says «connection»', () => {
  assert.equal(importFailureKey({ code: 'permission-denied' }), 'calc.notSavedOutOfDate');
  for (const e of [{ code: 'unavailable' }, new Error('x'), null, undefined]) assert.equal(importFailureKey(e), 'cat.importFailedCheckYour');
  assert.match(read('js/catalogue/catalogue-main.js'), /t\(importFailureKey\(err\)\)/);
});

test('the tray count is grouped like grams when it is large', () => {
  assert.match(read('js/log-view.js'), /trays: formatGrams\(trays\)/);
  const d = _dictionaries();
  assert.equal(translate(d, 'en', 'calc.traysOfWeight', { n: 1200, trays: '1,200', g: '1,000' }), '1,200 trays × 1,000 g');
});
