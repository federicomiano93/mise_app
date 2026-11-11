// Food cost product card, Nov 2026 — the amount of a recipe line in grams or kilos, the
// «finished product, no weight loss» switch, a wrong weighing kept in red, and the boxes
// wide enough for what is typed in them.
//
// The conversion is RUN (line-quantity.js is pure); what only the screen can do — the select,
// the switch, the order Save does things in — is pinned in the editor's source, the way the
// neighbouring foodcost-*.test.mjs files do, with the comments stripped first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kilosFromTyped, typedFromKilos, KILO_LINE_UNITS, tooMuchOfRecipe, TOO_MUCH_RECIPE_FACTOR } from '../js/foodcost/line-quantity.js';
import { normalizeProduct } from '../js/foodcost/foodcost-model.js';
import { _dictionaries as dictionaries } from '../js/i18n.js';

const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const EDITOR = codeOf(read('js/foodcost/foodcost-editor.js'));
const CSS = read('foodcost.css');
const TOKENS = read('tokens.css');

// ── 1. The unit of a recipe line ─────────────────────────────────────────────

test('a recipe line offers grams and kilos, like an ingredient line', () => {
  assert.deepEqual([...KILO_LINE_UNITS], ['g', 'kg']);
});

test('⚠️ kilos stay kilos: the box on «kg» stores exactly what is typed', () => {
  assert.equal(kilosFromTyped('1.7', 'kg'), 1.7);
  assert.equal(kilosFromTyped('', 'kg'), 0);
  assert.equal(kilosFromTyped('abc', 'kg'), 0);
  assert.equal(typedFromKilos(1.7, 'kg'), '1.7');
  assert.equal(typedFromKilos(0, 'kg'), '', 'nothing yet shows the placeholder, not a 0');
});

test('⚠️ typed in grams, the STORED value is still kilos — and never float noise', () => {
  assert.equal(kilosFromTyped('522', 'g'), 0.522, '522 / 1000 must not become 0.5220000000001');
  assert.equal(kilosFromTyped('1500', 'g'), 1.5);
  assert.equal(kilosFromTyped('0.5', 'g'), 0.0005);
  // Every whole gram up to 100 kg: nothing longer than six decimals is ever stored.
  for (let g = 1; g <= 100000; g++) {
    const kg = kilosFromTyped(String(g), 'g');
    const decimals = (String(kg).split('.')[1] || '').length;
    assert.ok(decimals <= 6 && !/e/.test(String(kg)), `${g} g -> ${kg}`);
  }
});

test('⚠️ a box opens in grams: 3.233 kg shows «3233», 0.522 shows «522»', () => {
  assert.equal(typedFromKilos(3.233, 'g'), '3233');
  assert.equal(typedFromKilos(0.522, 'g'), '522');
  for (const kilos of [0.522, 1.7, 0.001, 12.345678, 0.000001, 25]) {
    const asGrams = typedFromKilos(kilos, 'g');
    assert.equal(kilosFromTyped(asGrams, 'g'), kilos, `${kilos} kg shown as ${asGrams} g and read back`);
  }
});

test('⚠️ switching the unit keeps the typed number and changes its meaning', () => {
  assert.equal(kilosFromTyped('522', 'g'), 0.522);
  assert.equal(kilosFromTyped('522', 'kg'), 522, 'g -> kg: the box still says 522, now kilos');
  assert.equal(kilosFromTyped('522', 'g'), 0.522, 'and back to g: still 522, 0.522 kg stored');
  assert.equal(kilosFromTyped('', 'kg'), kilosFromTyped('', 'g'), 'an empty box changes nothing');
});

test('tooMuchOfRecipe: only beyond 20 whole batches, only when the recipe makes something', () => {
  assert.equal(TOO_MUCH_RECIPE_FACTOR, 20);
  assert.equal(tooMuchOfRecipe(20, 1), false, 'exactly 20x is fine');
  assert.equal(tooMuchOfRecipe(20.001, 1), true, 'just over warns');
  assert.equal(tooMuchOfRecipe(522, 0.522), true, 'grams typed as kilos');
  assert.equal(tooMuchOfRecipe(3, 1), false, 'a real triple batch');
  assert.equal(tooMuchOfRecipe(500, 0), false, 'a recipe of pieces only never warns');
  assert.equal(tooMuchOfRecipe(500, null), false);
  assert.equal(tooMuchOfRecipe(500, undefined), false);
  assert.equal(tooMuchOfRecipe(NaN, 1), false);
  assert.equal(tooMuchOfRecipe(500, NaN), false);
  assert.equal(tooMuchOfRecipe(Infinity, 1), false);
});

test('⚠️ lineNote warns on a recipe line through the new key, first, then the partly-priced note', () => {
  const at = EDITOR.indexOf('function lineNote(');
  const body = EDITOR.slice(at, EDITOR.indexOf("const ingredient = tables.ingredients", at));
  assert.match(body, /tooMuchOfRecipe\(entry\.qtyKg, whole\)/);
  assert.match(body, /t\('fc\.line\.tooMuchRecipe'/);
  assert.match(body, /recipeQtyText\(entry\.qtyKg \/ 1000\)/);
  assert.match(body, /\[tooMuch, partly\]\.filter\(Boolean\)\.join\(' '\)/);
  const { en, it } = dictionaries();
  for (const lang of [en, it]) {
    for (const hole of ['{qty}', '{whole}', '{grams}']) assert.ok(lang['fc.line.tooMuchRecipe'].includes(hole), hole);
  }
});

test('the impossible numbers are still left to product-limits.js: nothing is clamped here', () => {
  assert.equal(kilosFromTyped('-5', 'kg'), -5);
  assert.equal(kilosFromTyped('-5', 'g'), -0.005);
});

test('⚠️ the select is the ingredient line\'s own: same class, same label, never saved', () => {
  const at = EDITOR.indexOf("} else if (kind === 'recipe') {");
  assert.notEqual(at, -1, 'a recipe line has its own unit select');
  const select = EDITOR.slice(at, EDITOR.indexOf('} else {', at));
  assert.match(select, /class: 'fc-input fc-select fc-line-unit-select', 'aria-label': t\('fc\.aria\.unit'\)/);
  assert.match(select, /KILO_LINE_UNITS\.map\(/);
  assert.match(select, /lineUnits\.set\(entry, e\.target\.value\);/);
  assert.match(select, /const typed = qty\.value;/, 'the typed NUMBER is kept');
  assert.match(select, /kilosFromTyped\(typed, shownUnit\(\)\)/, 'and read in the new unit');
  assert.ok(!/qty\.value\s*=/.test(select), 'the box is never rewritten by a switch');
  assert.match(select, /if \(kilos === entry\.qtyKg\) return;/, 'nothing changed (empty box): no dirty mark');
  assert.match(select, /entry\.qtyKg = kilos;\s*markDirty\(\);/);
  assert.match(select, /cost\.textContent = lineCost\(entry, kind\)\.text;\s*note\.textContent = lineNote\(entry, kind\);\s*paintAnswer\(\);/);
  assert.ok(!/repaint/.test(select), 'repaint would steal the focus');
  assert.match(EDITOR, /const lineUnits = new WeakMap\(\);/, 'in memory, keyed by the line, never in the product');
  assert.match(EDITOR, /lineUnits\.get\(entry\) \|\| 'g'/, 'every line opens on grams');
  assert.match(EDITOR, /entry\.qtyKg = kilosFromTyped\(e\.target\.value, shownUnit\(\)\)|entry\[qtyKey\] = kind === 'recipe' \? kilosFromTyped\(e\.target\.value, shownUnit\(\)\)/);
});

// ── 2. «Finished product, no weight loss» ────────────────────────────────────

test('a product saved before the field existed has it OFF; only a literal true switches it on', () => {
  const base = { id: 'p', name: 'Focaccia', components: [{ recipeId: 'r', qtyKg: 1 }] };
  assert.equal(normalizeProduct(base).noWeightLoss, false);
  assert.equal(normalizeProduct({ ...base, noWeightLoss: 'true' }).noWeightLoss, false);
  assert.equal(normalizeProduct({ ...base, noWeightLoss: true }).noWeightLoss, true);
});

test('⚠️ the switch is a real switch on the product copy, dirty-marking, and repainting the card', () => {
  assert.match(EDITOR, /type: 'checkbox', role: 'switch', 'aria-label': t\('fc\.noWeightLoss'\), 'aria-describedby': 'fcNoWeightLossHint',/);
  assert.match(EDITOR, /class: 'set-sub', id: 'fcNoWeightLossHint', text: t\('fc\.noWeightLossHint'\)/,
    'the hint is what the switch\'s aria-describedby points at');
  assert.match(EDITOR, /noLossInput\.checked = working\.noWeightLoss === true;/);
  assert.match(EDITOR, /working\.noWeightLoss = noLossInput\.checked;\s*markDirty\(\);\s*repaint\(\);/);
  assert.match(EDITOR, /class: 'set-switch'/, 'the app\'s own switch kit, not a new control');
  assert.match(EDITOR, /t\('fc\.noWeightLossHint'\)/);
  assert.match(EDITOR, /noWeightLoss: false,\s*\};/, 'a brand-new product starts with it off');
});

test('⚠️ toggling the switch keeps the focus ON the switch (P18): the repaint would drop it to the body', () => {
  assert.match(EDITOR, /working\.noWeightLoss = noLossInput\.checked;\s*markDirty\(\);\s*repaint\(\);\s*try \{ noLossInput\.focus\(\{ preventScroll: true \}\); \}/,
    'focus is put back AFTER the repaint, which takes the row out of the page and puts it back');
});

test('⚠️ a screen reader is told: aria-invalid on the red cooked box, a live region for its warning', () => {
  assert.match(EDITOR, /if \(shown\.warning\) view\.cookedInput\.setAttribute\('aria-invalid', 'true'\);\s*else view\.cookedInput\.removeAttribute\('aria-invalid'\);/);
  assert.match(EDITOR, /el\('p', \{ class: 'fc-weigh-warn', 'aria-live': 'polite' \}\)/);
  assert.match(CSS, /\.fc-weigh-warn\[hidden\]/, 'hidden while empty');
});

test('the Save confirmation puts each warning on its own line', () => {
  assert.match(EDITOR, /\}\)\)\.join\('\\n'\),/);
  const { en, it } = dictionaries();
  for (const lang of [en, it]) assert.match(lang['fc.saveWithWeightWarnings'], /\n\{lines\}\n/);
});

test('the switch is drawn only while the product has a recipe line', () => {
  assert.match(EDITOR, /\.\.\.\(recipeIds\.length \? \[noLossRow\] : \[\]\),/);
});

test('⚠️⚠️ ON: no weighing boxes, no patch to the recipes, on screen or on Save', () => {
  const block = EDITOR.slice(EDITOR.indexOf('function weighBlock('), EDITOR.indexOf('function paintWeighViews'));
  assert.match(block, /if \(working\.noWeightLoss\) return null;/);
  const patches = EDITOR.slice(EDITOR.indexOf('function currentPatches()'), EDITOR.indexOf('function liveTables()'));
  assert.match(patches, /if \(working\.noWeightLoss\) return \{\};/);
  assert.match(EDITOR, /const weighedIds = clean\.noWeightLoss \? \[\] :/, 'Save writes none either');
  assert.match(EDITOR, /costProduct\(working, tables\)/, 'the answer is worked out from the working copy, flag included');
  assert.match(EDITOR, /productionCost\(working, liveTables\(\)\)/);
  assert.match(EDITOR, /costProduct\(clean, live\)/, 'and so is the cost Save records');
});

test('switching it changes the cost, so Save records a margin point for it', () => {
  assert.match(EDITOR, /!!product\.noWeightLoss !== !!clean\.noWeightLoss/);
});

// ── 3. A wrong pair is kept, in red, and never blocks the save ───────────────

test('⚠️ Save points at a wrong weighing, names it, and THEN asks — it never refuses', () => {
  const save = EDITOR.slice(EDITOR.indexOf('async function onSave()'), EDITOR.indexOf('async function onDelete()'));
  const warn = save.indexOf('const weighIssues = weighWarnings();');
  assert.ok(warn > 0, 'Save asks which weighings carry a warning');
  const confirm = save.indexOf("app.confirm({ title: t('fc.saveProduct'), message,");
  assert.ok(warn < confirm, 'before the confirmation');
  const between = save.slice(warn, confirm);
  assert.match(between, /weighIssues\[0\]\.box\.classList\.add\('fc-invalid'\);/);
  assert.match(between, /revealField\(weighIssues\[0\]\.box\);/);
  assert.match(between, /app\.toast\(t\('fc\.checkWeighing', \{ name: weighIssues\[0\]\.name \}\)\);/);
  assert.match(between, /t\('fc\.saveWithWeightWarnings'/, 'the confirmation says so in its own words');
  assert.ok(!/return;/.test(between), 'a wrong weighing must never block the save');
});

test('the cooked box stays framed in red while its warning stands, and is cleared when it goes', () => {
  assert.match(EDITOR, /view\.cookedInput\.classList\.toggle\('fc-invalid', !!shown\.warning\);/);
});

test('both boxes open with the placeholder 0, and nothing is filled in from the recipe total', () => {
  const block = EDITOR.slice(EDITOR.indexOf('function weighBlock('), EDITOR.indexOf('function paintWeighViews'));
  assert.match(block, /placeholder: '0'/);
  assert.ok(!/rawShown|rawTyped|weighableTotalGrams/.test(EDITOR));
});

test('the warning is red with enough contrast on the card it sits on (≥ 4.5:1)', () => {
  const rule = CSS.match(/\.fc-weigh-warn \{([^}]*)\}/)[1];
  assert.match(rule, /color: var\(--fc-danger\)/);
  const hex = name => {
    const m = TOKENS.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
    assert.ok(m, `--${name} in tokens.css`);
    return m[1];
  };
  const lum = h => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(hex('danger')), lum(hex('surface'))].sort((x, y) => y - x);
  assert.ok((a + 0.05) / (b + 0.05) >= 4.5, 'the red on the card surface');
  assert.match(CSS, /--fc-danger:\s*var\(--danger\)/);
  assert.match(CSS, /--fc-surface:\s*var\(--surface\)/);
});

// ── 4. The amount boxes are wide enough ──────────────────────────────────────

test('⚠️ the amount boxes are sized in `ch` for nine characters, not a guessed pixel width', () => {
  const qty = CSS.match(/\.fc-qty \{([^}]*)\}/)[1];
  assert.match(qty, /width: calc\(9ch \+ 19px\)/, '9 digits + 2 × 8px padding + 2 × 1.5px border');
  assert.match(qty, /padding: 0 8px/);
  assert.match(qty, /flex-shrink: 0/);
  assert.match(CSS, /\.fc-weigh-row \.fc-input \{ min-width: 0; padding: 0 8px; \}/);
  assert.match(CSS, /\.fc-number \{ font-variant-numeric: tabular-nums; \}/, 'every digit is exactly 1ch');
});
