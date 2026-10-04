// Calculator + Recipes screen, PR 2 of 3 (4 Oct 2026). P15 — the owner cannot read code.
//   • config/calculator carries `showClientOrdersButton` (missing/corrupt = ON) and a shape
//     number `configModel` that the app ALWAYS writes as its own (so the rules can refuse an
//     older build, which would drop the new keys);
//   • the recipe tabs of the Calculator keep a quarter of the bar, scoped to #tab-bar only;
//   • the total-dough box is compact and left on a tablet only;
//   • Settings → Recipes opens a row in place (aria-expanded / aria-controls), one at a time,
//     with the logic dropdown + its sentence, a switch, and «Edit recipe»; the detail no longer
//     holds the logic rows or the tab checkbox; the 4-recipe warnings go through dialogs;
//   • «Log» is «Dough history» / «Registro» is «Storico impasti» where the list is named.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeConfig, showsClientOrdersButton, CONFIG_MODEL, DEFAULT_CONFIG, LOGICS, MAX_VISIBLE_RECIPES,
} from '../js/calculator-config.js';
import { _dictionaries } from '../js/i18n.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

// ── The config field and the model number ───────────────────────────────────────────────
test('showClientOrdersButton: missing, corrupt or anything but false is ON', () => {
  assert.equal(normalizeConfig({ clients: [] }).showClientOrdersButton, true);
  assert.equal(normalizeConfig(null).showClientOrdersButton, true);
  assert.equal(normalizeConfig({ clients: [], showClientOrdersButton: true }).showClientOrdersButton, true);
  for (const junk of ['false', 0, null, 'no', {}, []]) {
    assert.equal(normalizeConfig({ clients: [], showClientOrdersButton: junk }).showClientOrdersButton, true, String(junk));
  }
  assert.equal(DEFAULT_CONFIG.showClientOrdersButton, true);
});

test('showClientOrdersButton: a literal false stays false, through a normalise round trip', () => {
  const once = normalizeConfig({ clients: [], showClientOrdersButton: false });
  assert.equal(once.showClientOrdersButton, false);
  assert.equal(normalizeConfig(once).showClientOrdersButton, false);
  assert.equal(showsClientOrdersButton(once), false);
  assert.equal(showsClientOrdersButton(undefined), true);
  assert.equal(showsClientOrdersButton({}), true);
});

test('configModel: the app always writes its own number, whatever the document said', () => {
  assert.equal(CONFIG_MODEL, 2);
  for (const stored of [undefined, 0, 1, 2, 99, 'x']) {
    const raw = { clients: [] };
    if (stored !== undefined) raw.configModel = stored;
    assert.equal(normalizeConfig(raw).configModel, CONFIG_MODEL, `stored ${String(stored)}`);
  }
  assert.equal(normalizeConfig(null).configModel, CONFIG_MODEL);
  assert.equal(normalizeConfig({ products: [], clients: [] }).configModel, CONFIG_MODEL, 'catalogue branch');
  assert.equal(normalizeConfig({ focaccia: { clients: [] } }).configModel, CONFIG_MODEL, 'legacy branch');
});

test('saveCalculatorConfig stamps CONFIG_MODEL on the document it writes', () => {
  const src = read('js/firebase.js');
  assert.match(src, /import \{[^}]*\bCONFIG_MODEL\b[^}]*\} from '\.\/calculator-config\.js'/);
  assert.match(src, /tx\.set\(ref, \{[^}]*configModel: CONFIG_MODEL[^}]*\}\)/);
});

test('firebase.example.js describes both new fields (P7)', () => {
  const ex = read('js/firebase.example.js');
  assert.match(ex, /showClientOrdersButton/);
  assert.match(ex, /configModel/);
});

// ── The Orders button in the bottom bar ───────────────────────────────────────────────
test('the Orders footer button follows the config switch; the banner does not', () => {
  const app = read('js/app.js');
  assert.match(app, /getElementById\('clientorders-footer-btn'\)/);
  assert.match(app, /ordersBtn\.hidden = !showsClientOrdersButton\(getConfig\(\)\)/);
  // the banner is painted by calculator-client-orders.js and never reads the switch
  assert.doesNotMatch(read('js/calculator-client-orders.js'), /showClientOrdersButton|showsClientOrdersButton/);
});

test('the Settings switch is a real switch with the sentence, saved on the tap', () => {
  const html = read('calculator.html');
  assert.match(html, /<input type="checkbox" role="switch" id="orders-button-switch"/);
  assert.match(html, /data-i18n="settings\.calc\.ordersButton"/);
  assert.match(html, /data-i18n="settings\.calc\.ordersButton\.sub"/);
  assert.match(html, /id="orders-button-saved"[^>]*data-i18n="settings\.saved"/);
  const js = read('js/calculator-settings.js');
  assert.match(js, /cfg\.showClientOrdersButton = wanted/);
  assert.match(js, /ordersButtonSwitch\.addEventListener\('change'/);
});

// ── Tabs and the total-dough box ──────────────────────────────────────────────────────
test('recipe tabs take a quarter of the bar, for the Calculator tab bar only', () => {
  const css = strip(read('style.css'));
  assert.match(css, /\n#tab-bar \.tab \{[^}]*flex: 0 1 calc\(\(100% - 3 \* 8px\) \/ 4\)/);
  // The shared rule keeps stretching (Orders and the management panel use it).
  assert.match(css, /\n\.tab \{[^}]*flex: 1;/);
});

test('the total-dough box is compact and left only inside the tablet query', () => {
  const css = strip(read('style.css'));
  const rule = css.match(/body\[data-card="calculator"\] #recipe-tabs \.param-row--total \{[^}]*\}/);
  assert.ok(rule, 'rule exists');
  assert.match(rule[0], /margin-right: auto/);
  assert.match(rule[0], /1\.5/);
  const at = css.indexOf(rule[0]);
  const query = css.lastIndexOf('@media (min-width: 900px) and (min-height: 600px)', at);
  assert.ok(query >= 0, 'sits under the tablet query');
  assert.ok(css.indexOf('param-row--total') === at + rule[0].indexOf('param-row--total'), 'no phone rule for it');
  assert.match(read('js/calculator-render.js'), /class: 'param-row param-row--total'/);
});

// ── The Recipes screen ─────────────────────────────────────────────────────────────────
test('a recipe row opens in place, one at a time, with aria-expanded / aria-controls', () => {
  const js = read('js/recipes.js');
  assert.match(js, /'aria-expanded': 'false', 'aria-controls': panelId/);
  assert.match(js, /row\.head\.setAttribute\('aria-expanded', String\(isOpen\)\)/);
  assert.match(js, /openRow = openRow === ri \? null : ri/, 'tapping the open head closes it');
  assert.match(js, /rows\.forEach\(row => \{\s*const isOpen = openRow === row\.ri/, 'one index decides every row');
});

test('the open row holds the logic dropdown with its sentence, the switch and Edit recipe', () => {
  const js = read('js/recipes.js');
  assert.match(js, /el\('select', \{ class: 'cp-prod-dough rc-logic'/);
  assert.match(js, /LOGICS\.forEach\(l => select\.appendChild\(el\('option', \{ value: l \}, t\(LOGIC_LABELS\[l\]\)\)\)\)/);
  assert.match(js, /t\(`calc\.logicHint\.\$\{logicOf\(r\)\}`\)/);
  assert.match(js, /role: 'switch', 'aria-labelledby': titleId/);
  assert.match(js, /t\('calc\.editRecipe'\)/);
  // The switch edits the working copy and never saves on the tap.
  const handler = js.slice(js.indexOf('showCb.addEventListener'), js.indexOf('const edit = el('));
  assert.match(handler, /markDirty\(\)/);
  assert.doesNotMatch(handler, /saveConfig|saveRecipes/);
});

test('the detail screen no longer holds the logic rows or the «show as a tab» checkbox', () => {
  const js = read('js/recipes.js');
  const detail = js.slice(js.indexOf('function renderRecipeDetail'), js.indexOf('// One ingredient row'));
  assert.doesNotMatch(detail, /cp-choice|LOGIC_LABELS|aria-pressed|visCb|showAsACalculator|recipesCanShowAs/);
  assert.match(detail, /leaveningBox\(r\)/, 'the leavening box still follows the logic');
  assert.doesNotMatch(read('style.css'), /\.cp-choice/);
});

test('four shown recipes: the switch alerts and goes back OFF; adding asks first', () => {
  const js = read('js/recipes.js');
  assert.match(js, /showCb\.checked = false;\s*alertDialog\(t\('calc\.recipe\.limitReached', \{ n: MAX_VISIBLE_RECIPES \}\)\)/);
  assert.match(js, /message: t\('calc\.recipe\.addLimitConfirm', \{ n: MAX_VISIBLE_RECIPES \}\)/);
  assert.match(js, /okLabel: t\('calc\.recipe\.createHidden'\)/);
  assert.match(js, /visible: !full/);
  assert.equal(MAX_VISIBLE_RECIPES, 4);
  assert.deepEqual([...LOGICS], ['orders', 'total', 'both']);
});

test('a refused write is told to the person and the screen stays as it was (see calculator-save-failure.test.mjs)', () => {
  assert.match(read('js/recipes.js'), /if \(!\(await saveConfigOrSay\(working\)\)\) return;/);
});

// ── Words, both languages ─────────────────────────────────────────────────────────────
const D = _dictionaries();
const NEW_KEYS = [
  'calc.recipe.showInCalculator', 'calc.recipe.limitReached', 'calc.recipe.addLimitConfirm',
  'calc.recipe.createHidden', 'settings.calc.ordersButton', 'settings.calc.ordersButton.sub',
];

test('the new keys exist in English and Italian; the placeholders carry {n}', () => {
  for (const k of NEW_KEYS) {
    assert.equal(typeof D.en[k], 'string', `en ${k}`);
    assert.equal(typeof D.it[k], 'string', `it ${k}`);
  }
  for (const k of ['calc.recipe.limitReached', 'calc.recipe.addLimitConfirm']) {
    assert.match(D.en[k], /\{n\}/);
    assert.match(D.it[k], /\{n\}/);
  }
});

test('the two keys of the old hardcoded warning are gone from every dictionary', () => {
  for (const lang of Object.keys(D)) {
    assert.equal(D[lang]['calc.recipesCanShowAs'], undefined, lang);
    assert.equal(D[lang]['calc.showAsACalculator'], undefined, lang);
  }
});

test('the list of confirmed doughs is «Dough history» / «Storico impasti»', () => {
  assert.equal(D.en['ui.log'], 'Dough history');
  assert.equal(D.it['ui.log'], 'Storico impasti');
  const html = read('calculator.html');
  assert.doesNotMatch(html, /data-i18n="ui\.log">Log</);
  assert.match(html, /id="log-footer-btn"[\s\S]*?data-i18n="ui\.log">Dough history</);
  for (const k of ['ui.chooseWhichRecipesLogs', 'calc.noLogsToShow', 'calc.noLogsYetCalculate',
    'calc.forEachRecipeChoose', 'calc.logsAreAlwaysKept', 'calc.keepLogsVisible', 'calc.logDurationFor',
    'calc.saveTheseLogSettings', 'help.confirmSavesTheSheet']) {
    assert.doesNotMatch(D.en[k], /\bLog\b/, `en ${k}`);
    assert.doesNotMatch(D.it[k], /\bRegistro\b/, `it ${k}`);
  }
});
