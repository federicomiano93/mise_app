// Three Calculator defects found while driving Settings → Recipes on the emulator (29 Oct 2026),
// as miano@club.test (an Italian venue). P15 — the owner cannot read code.
//   • the «unsaved changes» question came up in ENGLISH over Italian buttons: the text was a
//     constant computed when js/calculator-confirm.js loaded, before the venue's language
//     arrived. These tests EXECUTE the real module with its dialog replaced by a stand-in,
//     switch the language AFTER it has loaded, and read the question it asks;
//   • the icon-only Back buttons of the Calculator's overlays had no name (axe `button-name`);
//   • the grams fields and the leavening % field of a recipe's detail had no label (axe
//     `label`). js/recipes.js needs Firestore and a page to run, so those are pinned in its
//     source; the screen itself was measured with axe on the emulator (the PR says how).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setLanguage, translate, _dictionaries } from '../js/i18n.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');

const CONFIRM = new URL('../js/calculator-confirm.js', import.meta.url).href;
const DIALOG_STAND_IN = `
  export function confirmDialog(opts) { globalThis.__confirmAsked.push(opts); return Promise.resolve(true); }`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((context.parentURL || '').startsWith(`${CONFIRM}?case=`) && specifier === './confirm-dialog.js') {
      return { url: `data:text/javascript,${encodeURIComponent(DIALOG_STAND_IN)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

async function freshConfirm(name) {
  globalThis.__confirmAsked = [];
  return import(`${CONFIRM}?case=${encodeURIComponent(name)}`);
}

// ── 1. The unsaved-changes question follows the language it is ASKED in ─────────────────────
test('confirmDiscard asks in the venue language even when that arrives after the module loaded', async () => {
  setLanguage('en');
  const { confirmDiscard } = await freshConfirm('late-italian');
  setLanguage('it');
  try {
    assert.equal(await confirmDiscard(true), true);
    const [asked] = globalThis.__confirmAsked;
    const it = _dictionaries().it;
    assert.equal(asked.message, it['calc.youHaveUnsavedChanges']);
    assert.equal(asked.okLabel, it['ui.discard']);
    assert.equal(asked.cancelLabel, it['ui.cancel']);
  } finally {
    setLanguage('en');
  }
});

test('confirmDiscard follows a later switch back to English, and asks nothing when nothing changed', async () => {
  setLanguage('it');
  const { confirmDiscard } = await freshConfirm('back-to-english');
  setLanguage('en');
  assert.equal(await confirmDiscard(false), true);
  assert.equal(globalThis.__confirmAsked.length, 0, 'no edits: no question');
  await confirmDiscard(true);
  assert.equal(globalThis.__confirmAsked[0].message, _dictionaries().en['calc.youHaveUnsavedChanges']);
});

test('calculator-confirm.js translates nothing at module load', () => {
  const src = read('js/calculator-confirm.js').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /^(export\s+)?(const|let|var)\s+\w+\s*=\s*\n?\s*t\(/m,
    'a translated constant is frozen in the language the page started in');
  assert.doesNotMatch(src, /UNSAVED_MESSAGE/);
});

// ── 2. Every icon-only button of the Calculator page has a translated name ──────────────────
test('calculator.html: every button with no visible text carries a translated aria-label', () => {
  const html = read('calculator.html');
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  assert.ok(buttons.length > 20, 'the button scan found the buttons');
  const dict = _dictionaries();
  let iconOnly = 0;
  for (const [, attrs, inner] of buttons) {
    const text = inner.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim();
    if (text || /\bdata-i18n="[^"]+"/.test(attrs) && !/data-i18n-attr=/.test(attrs)) continue;
    iconOnly += 1;
    const where = attrs.trim();
    assert.match(attrs, /\baria-label="[^"]+"/, `no aria-label: <button ${where}>`);
    assert.match(attrs, /\bdata-i18n-attr="aria-label"/, `aria-label not translated: <button ${where}>`);
    const key = attrs.match(/\bdata-i18n="([^"]+)"/);
    assert.ok(key && dict.en[key[1]] && dict.it[key[1]], `aria-label key missing in en or it: <button ${where}>`);
  }
  assert.ok(iconOnly >= 14, `found ${iconOnly} icon-only buttons`);
});

test('the Back buttons of every Calculator overlay are named «Back» / «Indietro»', () => {
  const html = read('calculator.html');
  for (const cls of ['recipe', 'extra', 'divisor', 'logsettings', 'wa', 'cp', 'logview', 'logedit', 'logadd', 'loghistory']) {
    const tag = html.match(new RegExp(`<button[^>]*\\b${cls}-back-btn\\b[^>]*>`));
    assert.ok(tag, `${cls}-back-btn is on the page`);
    assert.match(tag[0], /data-i18n="ui\.back" data-i18n-attr="aria-label" aria-label="Back"/, cls);
    assert.match(tag[0], /type="button"/, cls);
  }
});

// ── 3. The grams and leavening % fields of a recipe's detail are labelled ──────────────────
const fnBody = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const next = src.indexOf('\nfunction ', start + 1);
  return src.slice(start, next < 0 ? undefined : next);
};

test('ingredientRow: the grams field is named after its ingredient, and follows the name as it is typed', () => {
  const body = fnBody(read('js/recipes.js'), 'ingredientRow');
  assert.match(body, /class: 'cp-prod-weight', type: 'number'[\s\S]*?'aria-label': gramsLabel\(ing\),[\s\S]*?\}\);/);
  assert.match(body, /nameInput\.addEventListener\('input', \(\) => \{[\s\S]*?grams\.setAttribute\('aria-label', gramsLabel\(ing\)\);[\s\S]*?\}\);/);
  const helper = fnBody(read('js/recipes.js'), 'gramsLabel');
  assert.match(helper, /const name = \(ing\.label \|\| ''\)\.trim\(\);\s*return name \? t\('calc\.gramsOf', \{ name \}\) : t\('calc\.gramsOfUnnamed'\);/);
});

test('leaveningBox: the percentage field has its own translated name', () => {
  const body = fnBody(read('js/recipes.js'), 'leaveningBox');
  assert.match(body, /max: '100', step: '0\.05',[\s\S]*?'aria-label': t\('calc\.leaveningStartPct'\),/);
});

test('the new field names read right in English and Italian', () => {
  const d = _dictionaries();
  assert.equal(translate(d, 'en', 'calc.gramsOf', { name: 'Flour' }), 'Grams of Flour');
  assert.equal(translate(d, 'it', 'calc.gramsOf', { name: 'Farina' }), 'Grammi di Farina');
  assert.equal(translate(d, 'en', 'calc.gramsOfUnnamed'), 'Grams of an unnamed ingredient');
  assert.equal(translate(d, 'it', 'calc.gramsOfUnnamed'), 'Grammi di un ingrediente senza nome');
  // The spoken name starts with the words shown beside the field, for voice control.
  assert.equal(translate(d, 'en', 'calc.leaveningStartPct'), 'Start at: leavening percentage');
  assert.equal(translate(d, 'it', 'calc.leaveningStartPct'), 'Parti da: percentuale di lievito');
});
