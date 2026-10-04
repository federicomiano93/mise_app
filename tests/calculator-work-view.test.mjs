// The Calculator's «work view» changes (4 Oct 2026), one block per slice.
// S1 — the «Ask which day the dough is for» switch and what Confirm does with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runConfirm } from '../js/confirm-flow.js';
import { _dictionaries, translate } from '../js/i18n.js';
import { installDom, Node, walk } from './helpers/form-dom.mjs';

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

// ── S2: the four bottom sheets are centred dialogs on a tablet ───────────────────────
const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
function ruleBodies(css, selectorPart) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].includes(selectorPart)) out.push({ sel: m[1], body: m[2] });
  }
  return out;
}

test('S2: under the tablet query the four sheets centre; on a phone they stay bottom sheets', () => {
  const css = strip(read('style.css'));
  // phone rule: anchored to the bottom edge
  const phone = css.match(/\n#loaf-modal, #list-select-modal, #day-modal, #send-who-modal \{[^}]*\}/);
  assert.ok(phone);
  assert.match(phone[0], /align-items: flex-end/);
  // tablet block
  const at = css.indexOf('body[data-card="calculator"] #loaf-modal, ');
  assert.ok(at > 0, 'tablet rule exists');
  const query = css.lastIndexOf('@media (min-width: 900px) and (min-height: 600px)', at);
  assert.ok(query > css.indexOf('#loaf-modal-box, #list-select-box'), 'after the phone rules, so it wins');
  const centred = ruleBodies(css.slice(query), '#day-modal,')[0];
  assert.match(centred.body, /align-items: center/);
  const box = ruleBodies(css.slice(query), '#day-modal-box')[0];
  assert.match(box.body, /border-radius: var\(--radius\)(?!\s+var)/, 'full radius, not top-only');
  assert.match(box.body, /padding: 20px/);
  for (const id of ['#loaf-modal', '#list-select-modal', '#day-modal', '#send-who-modal']) {
    assert.ok(centred.sel.includes(id), id);
  }
  for (const id of ['#loaf-modal-box', '#list-select-box', '#day-modal-box', '#send-who-box']) {
    assert.ok(box.sel.includes(id), id);
  }
});

test('S2: the centred box arrives with the dialog fade + scale (killed by reduced-motion in tokens.css)', () => {
  const css = strip(read('style.css'));
  assert.match(css, /#day-modal\.visible #day-modal-box \{ animation: app-dialog-in \.16s ease-out; \}/);
  assert.match(strip(read('tokens.css')), /@keyframes app-dialog-in/);
  assert.match(strip(read('tokens.css')), /prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{\s*animation-duration: \.01ms !important/);
});

// ── S3: the boxes of the param rows end on one edge ──────────────────────────────────
// The project's small fake DOM (tests/helpers/form-dom.mjs), plus the SVG factory the send arrow needs.
function useDom() {
  installDom();
  globalThis.document.createElementNS = (ns, tag) => new Node(tag);
}
const classesOf = n => n.className.split(' ').filter(Boolean);

test('S3: no unit span follows the box of a leavening, trays or total row', async () => {
  useDom();
  const { buildRecipePanel } = await import('../js/calculator-render.js');
  const recipe = {
    id: 'r1', name: 'Pizza', logic: 'both', trayWeight: 1000,
    ingredients: [{ key: 'flour', label: 'Flour', grams: 600 }, { key: 'yeast', label: 'Yeast', grams: 6 }],
    leaveningKey: 'yeast', leaveningDefaultPct: 1, showLeavening: true,
  };
  for (const logic of ['both', 'traysTotal']) {
    const panel = buildRecipePanel({ ...recipe, logic });
    const rows = [];
    walk(panel).forEach(n => { if (classesOf(n).includes('param-row')) rows.push(n); });
    assert.ok(rows.length >= 2, `${logic}: param rows drawn`);
    for (const row of rows) {
      for (const n of walk(row)) {
        if (n.className === 'qty-group') {
          assert.deepEqual(n.children.map(c => c.tagName), ['INPUT'], `${logic}: only the input in the group`);
        }
        assert.notEqual(n.className, 'unit', `${logic}: no .unit inside a param row`);
      }
    }
  }
  delete globalThis.document;
});

test('S3: render source has no unit span in the param rows, and the tablet width applies to every param row', () => {
  const js = read('js/calculator-render.js');
  const panel = js.slice(js.indexOf('export function buildRecipePanel'), js.indexOf("if (hasOrders) {"));
  assert.doesNotMatch(panel, /class: 'unit'/);
  const css = strip(read('style.css'));
  assert.match(css, /body\[data-card="calculator"\] #recipe-tabs \.param-row \{[^}]*width: calc\(1\.5/);
  // the group is right-aligned, so a lone input ends at the row's right padding
  assert.match(css, /\.qty-group \{[^}]*justify-content: flex-end/);
});
