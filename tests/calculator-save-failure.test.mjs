// Review fixes on the Calculator + Recipes work (4 Oct 2026). P15.
//   • a config save that does not reach the server is told to the person, in ONE place, and
//     the screen keeps its edits; the local copy goes back to what the server has;
//   • the empty-Calculator card stays centred on a tablet;
//   • the single entry of the Dough history is «dough» / «impasto»;
//   • the quarter-shrink of the phone tabs applies to FOUR tabs only;
//   • the Recipes list gives focus back to the row it returns to.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveFailureKey } from '../js/calculator-config.js';
import { _dictionaries } from '../js/i18n.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// A Windows checkout serves CRLF; the CSS assertions below are written with \n.
const read = f => readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n');
const D = _dictionaries();

// ── The failure helper ────────────────────────────────────────────────────────────────
test('saveFailureKey: a refusal says the app is out of date, any other failure says check the connection', () => {
  assert.equal(saveFailureKey({ synced: false, reason: 'write-failed', code: 'permission-denied' }), 'calc.notSavedOutOfDate');
  for (const code of ['unavailable', 'deadline-exceeded', 'failed-precondition', undefined, null, 42]) {
    assert.equal(saveFailureKey({ synced: false, reason: 'write-failed', code }), 'calc.notSavedCheckConnection', String(code));
  }
});

test('saveFailureKey: a stored change, no answer yet (already explained) and junk say nothing', () => {
  assert.equal(saveFailureKey({ synced: true }), null);
  assert.equal(saveFailureKey({ synced: false, reason: 'no-server-answer' }), null);
  assert.equal(saveFailureKey(undefined), null);
  assert.equal(saveFailureKey(null), null);
});

test('the two messages exist in English and Italian, as agreed', () => {
  assert.equal(D.en['calc.notSavedOutOfDate'], 'Not saved: this app is out of date. Reload it and try again.');
  assert.equal(D.it['calc.notSavedOutOfDate'], 'Non salvato: l’app su questo dispositivo è da aggiornare. Ricaricala e riprova.');
  assert.equal(D.en['calc.notSavedCheckConnection'], 'Not saved: check the connection and try again.');
  assert.equal(D.it['calc.notSavedCheckConnection'], 'Non salvato: controlla la connessione e riprova.');
  for (const lang of Object.keys(D)) assert.equal(D[lang]['calc.savedNotSent'], undefined, `${lang} savedNotSent is gone`);
});

test('saveConfig exposes the Firestore code and takes the local copy back on a failed write', () => {
  const store = read('js/calculator-config-store.js');
  assert.match(store, /reason: 'write-failed', code: err && err\.code/);
  const catchBlock = store.slice(store.indexOf('.catch(err => {'), store.indexOf('export async function saveConfigOrSay'));
  assert.match(catchBlock, /if \(current === mine\) \{\s*current = previous;\s*writeCache\(current\);\s*if \(notify\) notify\(current\);/);
  assert.match(store, /export async function saveConfigOrSay\(config, \{ onFail \} = \{\}\)/);
  assert.match(store, /await alertDialog\(t\(key\)\)/);
});

test('every caller of saveConfig goes through saveConfigOrSay', () => {
  for (const f of ['js/recipes.js', 'js/calculator-settings.js', 'js/calculator-whatsapp-settings.js', 'js/log-settings.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /\bsaveConfig\(/, `${f} calls saveConfig directly`);
    assert.doesNotMatch(src, /import \{[^}]*\bsaveConfig\b[^}]*\} from/, `${f} imports saveConfig directly`);
    assert.match(src, /saveConfigOrSay\(/, f);
    assert.doesNotMatch(src, /calc\.savedNotSent/, f);
  }
});

test('a screen that fails to save returns before touching its state; the switches go back', () => {
  const settings = read('js/calculator-settings.js');
  for (const call of ['working', 'extraWorking', 'divisorWorking']) {
    assert.match(settings, new RegExp(`if \\(!\\(await saveConfigOrSay\\(${call}\\)\\)\\) return;`), call);
  }
  assert.match(settings, /saveConfigOrSay\(cfg, \{ onFail: \(\) => \{ cb\.checked = !wanted; \} \}\)/);
  assert.match(settings, /if \(saved && canSyncConfig\(\)\) flashOrdersButtonSaved\(\)/);
  const wa = read('js/calculator-whatsapp-settings.js');
  assert.match(wa, /if \(!\(await saveConfigOrSay\(working\)\)\) return;/);
  assert.match(wa, /onFail: \(\) => \{ sel\.value = before; \}/);
  assert.match(read('js/log-settings.js'), /if \(!\(await saveConfigOrSay\(cfg\)\)\) return;/);
});

// ── The tablet empty state and the phone tabs ─────────────────────────────────────────────
const css = read('style.css');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '');

test('on a tablet the recipe column, the Log and the tab bar are one centred 620px column (5 Oct 2026)', () => {
  const rules = strip(css);
  assert.match(rules, /#recipe-tabs > \.content,\s*body\[data-card="calculator"\] #tab-log,\s*body\[data-card="calculator"\] \.scroll-area > #tab-bar \{\s*width: 100%;\s*max-width: 620px;\s*margin-inline: auto;\s*\}/);
  // No rule pushes a recipe tab's column back to the left.
  assert.doesNotMatch(rules, /#recipe-tabs > \.content[^{]*\{ margin-inline: 0 auto; \}/);
  assert.match(read('js/calculator-render.js'), /id: 'tab-empty'/);
});

test('the phone shrink (quarter, 12px, breaking) applies to a bar of FOUR tabs only', () => {
  const rules = strip(css);
  const block = rules.slice(rules.indexOf('@media (max-width: 420px) {\n  #tab-bar'));
  const rule = block.slice(0, block.indexOf('}') + 1);
  assert.match(rule, /#tab-bar \.tab:first-child:nth-last-child\(4\),\s*#tab-bar \.tab:first-child:nth-last-child\(4\) ~ \.tab \{/);
  assert.match(rule, /min-width: 0;/);
  assert.match(rule, /overflow-wrap: anywhere;/);
  // No unconditional `#tab-bar .tab` inside a phone media block.
  assert.doesNotMatch(rules, /@media \(max-width: 420px\) \{\s*#tab-bar \.tab \{/);
});

// ── «Dough», not «log», for one entry ──────────────────────────────────────────────────
test('the entry of the Dough history is called a dough, in both languages', () => {
  const expected = {
    en: {
      'calc.addLog': '+ Add dough', 'calc.deleteLog': 'Delete dough', 'ui.editLog': 'Edit dough',
      'ui.addLog': 'Add dough', 'calc.saveThisLog': 'Save this dough?', 'calc.logNotFound': 'Dough not found.',
      'calc.editThisLog': 'Edit this dough?', 'ui.doughFallback': 'Dough',
    },
    it: {
      'calc.addLog': '+ Aggiungi impasto', 'calc.deleteLog': 'Elimina impasto', 'ui.editLog': 'Modifica impasto',
      'ui.addLog': 'Aggiungi impasto', 'calc.saveThisLog': 'Vuoi salvare questo impasto?', 'calc.logNotFound': 'Impasto non trovato.',
      'calc.editThisLog': 'Vuoi modificare questo impasto?', 'ui.doughFallback': 'Impasto',
    },
  };
  for (const lang of ['en', 'it']) {
    for (const [k, v] of Object.entries(expected[lang])) assert.equal(D[lang][k], v, `${lang} ${k}`);
  }
  assert.match(D.en['calc.deleteDoughConfirm'], /\{name\}/);
  assert.match(D.it['calc.deleteDoughConfirm'], /\{name\}/);
  for (const lang of ['en', 'it']) {
    assert.equal(D[lang]['calc.deleteThis'], undefined);
    assert.equal(D[lang]['calc.logThisCannotBe'], undefined);
  }
});

test('no entry title is built from «dough + log», and the fallback name is not the list name', () => {
  for (const f of ['js/log.js', 'js/log-edit.js']) assert.doesNotMatch(read(f), /\.dough \+ ' log'/, f);
  assert.match(read('js/log.js'), /t\('calc\.deleteDoughConfirm', \{ name: /);
  const view = read('js/log-view.js');
  assert.match(view, /t\('ui\.doughFallback'\)/);
  assert.doesNotMatch(view, /t\('ui\.log'\)/);
});

// ── The Recipes list ──────────────────────────────────────────────────────────────────────
test('«Tap one to open it» — the rows open in place now', () => {
  for (const form of ['one', 'other']) {
    assert.match(D.en['calc.recipesIntro'][form], /Tap one to open it/);
    assert.match(D.it['calc.recipesIntro'][form], /Toccane una per aprirla/);
    assert.doesNotMatch(D.en['calc.recipesIntro'][form], /to edit it/);
    assert.match(D.en['calc.recipesIntro'][form], /Up to \{n\}/);
  }
});

test('Back and Save give focus back to the head of the row they return to', () => {
  const js = read('js/recipes.js');
  assert.match(js, /openRow = activeRecipe;\s*focusRow = activeRecipe;/);
  assert.match(js, /focusRow = activeRecipe;\s*activeRecipe = null;\s*openRow = null;/);
  assert.match(js, /if \(focusRow !== null && rows\[focusRow\]\) rows\[focusRow\]\.head\.focus\(\);\s*focusRow = null;/);
});
