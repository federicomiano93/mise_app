// The Calculator's «work view» changes (4 Oct 2026), one block per slice.
// S1 — the «Ask which day the dough is for» switch and what Confirm does with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runConfirm } from '../js/confirm-flow.js';
import { _dictionaries, translate } from '../js/i18n.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const D = _dictionaries();

// ── S1: the switch ──────────────────────────────────────────────────────────────────
test('S1: the switch is a real switch, right after the Orders-button one, saved on the tap', () => {
  const html = read('calculator.html');
  assert.match(html, /<input type="checkbox" role="switch" id="ask-day-switch" aria-labelledby="ask-day-title" aria-describedby="ask-day-sub"/);
  assert.match(html, /data-i18n="settings\.calc\.askDay"/);
  assert.match(html, /data-i18n="settings\.calc\.askDay\.sub"/);
  assert.ok(html.indexOf('id="ask-day-switch"') > html.indexOf('id="orders-button-switch"'), 'after it');
  assert.ok(html.indexOf('id="ask-day-switch"') < html.indexOf('id="open-recipes-btn"'), 'same section');
  const js = read('js/calculator-settings.js');
  assert.match(js, /cfg\.askDoughDay = wanted/);
  assert.match(js, /askDaySwitch\.addEventListener\('change', onAskDaySwitch\)/);
  assert.match(js, /saveConfigOrSay\(cfg, \{ onFail: \(\) => \{ cb\.checked = !wanted; \} \}\)/);
  assert.match(js, /cb\.checked = asksDoughDay\(getConfig\(\)\)/);
  assert.match(js, /paintAskDaySwitch\(\);\s*show\('settings-overlay'\)/, 'repainted every time Settings opens');
});

test('S1: the words, in both languages', () => {
  assert.equal(D.en['settings.calc.askDay'], 'Ask which day the dough is for');
  assert.equal(D.en['settings.calc.askDay.sub'], 'When off, Confirm saves the dough for today without asking.');
  assert.equal(D.it['settings.calc.askDay'], 'Chiedi per quale giorno è l’impasto');
  assert.equal(D.it['settings.calc.askDay.sub'], 'Se è spento, Conferma salva l’impasto per oggi senza chiedere.');
  assert.equal(translate(D, 'it', 'settings.calc.askDay'), 'Chiedi per quale giorno è l’impasto');
});

// ── S1: Confirm ─────────────────────────────────────────────────────────────────────
function probe(config) {
  const calls = [];
  const answer = runConfirm('focaccia', {
    config,
    openDayPicker: id => calls.push(['picker', id]),
    saveToday: id => calls.push(['today', id]),
  });
  return { answer, calls };
}

test('S1: switch ON (or never set, or corrupt) → the day picker opens and nothing is saved', () => {
  for (const config of [{ askDoughDay: true }, {}, null, undefined, { askDoughDay: 'no' }, { askDoughDay: 0 }]) {
    const { answer, calls } = probe(config);
    assert.equal(answer, 'asked', JSON.stringify(config));
    assert.deepEqual(calls, [['picker', 'focaccia']]);
  }
});

test('S1: switch OFF → saved for today at once and the picker never opens', () => {
  const { answer, calls } = probe({ askDoughDay: false });
  assert.equal(answer, 'today');
  assert.deepEqual(calls, [['today', 'focaccia']]);
});

test('S1: app.js wires Confirm through runConfirm, and «today» is the same save the Today button makes', () => {
  const app = read('js/app.js');
  assert.match(app, /confirmBtn\.addEventListener\('click', \(\) => runConfirm\(id, \{\s*config: getConfig\(\),\s*openDayPicker: openDayModal,\s*saveToday: saveForToday,/);
  assert.match(app, /function saveForToday\(recipeId\) \{\s*saveDay\(recipeId, 'today'\);\s*touchTab\(recipeId\);/);
  assert.doesNotMatch(app, /addEventListener\('click', \(\) => openDayModal\(id\)\)/);
});
