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
  const make = globalThis.document.createElement;
  globalThis.document.createElement = tag => { const n = make(tag); n.style.setProperty = (k, v) => { n.style[k] = v; }; return n; };
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

// ── S4: names scroll away; one recipe is a title; the confirmed panel opens with the result ──
test('S4: the tab bar is INSIDE the scroll area, at its top', () => {
  const html = read('calculator.html');
  const area = html.indexOf('<div class="scroll-area scroll-with-bar">');
  const bar = html.indexOf('<div class="tab-bar" id="tab-bar"></div>');
  const tabs = html.indexOf('<div id="recipe-tabs"></div>');
  assert.ok(area > 0 && bar > area && tabs > bar, 'scroll-area > tab-bar > recipe-tabs');
  const css = strip(read('style.css'));
  assert.match(css, /\.scroll-area > #tab-bar \{ padding-inline: 16px; \}/, 'no second gutter inside the scroll area');
  assert.match(css, /\.tab-bar \{[^}]*padding-inline: max\(16px, var\(--app-gutter\)\)/, 'the shared bar (Orders) keeps its cap');
});

test('S4: ONE recipe is drawn as a plain title (h2, no button, nothing to tap or focus)', async () => {
  useDom();
  const { buildTabBar } = await import('../js/calculator-render.js');
  const bar = new Node('div');
  const picks = [];
  buildTabBar(bar, [{ id: 'focaccia', name: 'Focaccia' }], id => picks.push(id));
  assert.equal(bar.children.length, 1);
  assert.equal(bar.children[0].tagName, 'H2');
  assert.equal(bar.children[0].className, 'calc-recipe-title');
  assert.equal(bar.children[0].textContent, 'Focaccia');
  assert.equal(bar.children[0].attributes.tabindex, undefined);
  assert.equal(walk(bar).filter(n => n.tagName === 'BUTTON').length, 0);
  delete globalThis.document;
});

test('S4: two or more recipes stay tabs, and a tap picks that recipe', async () => {
  useDom();
  const { buildTabBar } = await import('../js/calculator-render.js');
  const bar = new Node('div');
  const picks = [];
  buildTabBar(bar, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], id => picks.push(id));
  const tabs = bar.children;
  assert.deepEqual(tabs.map(n => n.tagName), ['BUTTON', 'BUTTON', 'BUTTON']);
  assert.ok(tabs.every(n => n.className === 'tab'));
  tabs[1].fire('click');
  assert.deepEqual(picks, ['b']);
  // rebuilding replaces, never appends
  buildTabBar(bar, [{ id: 'a', name: 'A' }], () => {});
  assert.equal(bar.children.length, 1);
  delete globalThis.document;
});

test('S4: app.js hides the title while the Log is open, and draws the bar through buildTabBar', () => {
  const app = read('js/app.js');
  assert.match(app, /if \(bar\) buildTabBar\(bar, recipes, switchTab\);/);
  assert.match(app, /'#tab-bar \.calc-recipe-title'\)\.forEach\(h => \{ h\.hidden = h\.dataset\.recipe !== name; \}\)/);
  assert.match(strip(read('style.css')), /\.calc-recipe-title \{[^}]*font-family: var\(--font-display\)/);
});

// The panel as buildRecipePanel makes it, with a registry for getElementById.
async function panelWorld() {
  useDom();
  const registry = new Map();
  globalThis.document.getElementById = id => registry.get(id) || null;
  const scroll = new Node('div');
  scroll.scrollTop = 99;
  globalThis.document.querySelector = sel => (sel === '.scroll-area' ? scroll : null);
  const { buildRecipePanel } = await import('../js/calculator-render.js');
  const { placeResult } = await import('../js/result-place.js');
  const showResult = id => { placeResult(registry.get(id), true); scroll.scrollTop = 0; };
  const hideResult = id => placeResult(registry.get(id), false);
  const panel = buildRecipePanel({
    id: 'r1', name: 'Pizza', logic: 'both', trayWeight: 1000,
    ingredients: [{ key: 'flour', label: 'Flour', grams: 600 }, { key: 'yeast', label: 'Yeast', grams: 6 }],
    leaveningKey: 'yeast', leaveningDefaultPct: 1, showLeavening: true,
  });
  for (const n of walk(panel)) if (n.attributes && n.attributes.id) registry.set(n.attributes.id, n);
  return { panel, scroll, showResult, hideResult };
}
// A real insertBefore MOVES a node that is already in the tree; the shared fake only adds it.
const fakeInsertBefore = Node.prototype.insertBefore;
Node.prototype.insertBefore = function (child, ref) {
  if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(c => c !== child);
  return fakeInsertBefore.call(this, child, ref);
};
const order = panel => panel.children.map(n => n.attributes.id || n.className.split(' ')[0]);

test('S4: before Confirm the panel keeps its order; the confirmed one opens with the result', async () => {
  const { panel, scroll, showResult, hideResult } = await panelWorld();
  const before = order(panel);
  assert.equal(before[before.length - 2], 'r1-result', 'result sits just above Reset, hidden');
  assert.equal(before[before.length - 1], 'reset-btn');

  showResult('r1-result');
  const shown = order(panel);
  assert.equal(shown[0], 'r1-result', 'result FIRST');
  assert.deepEqual(shown.slice(1), before.filter(x => x !== 'r1-result'), 'everything else keeps its relative order');
  const rest = shown.slice(1);
  assert.ok(rest.indexOf('param-row') < rest.indexOf('r1-edit-btn'), 'entries, then Edit');
  assert.ok(rest.indexOf('r1-edit-btn') < rest.indexOf('reset-btn'), 'Edit, then Reset');
  assert.equal(scroll.scrollTop, 0, 'the page is brought to the top so the recipe is in view');

  showResult('r1-result'); // a recalculation while shown: nothing moves
  assert.deepEqual(order(panel), shown);

  hideResult('r1-result'); // Edit: back where it was
  assert.deepEqual(order(panel), before);
  delete globalThis.document;
});

test('S4: the «fields cleared» note stays above the result', async () => {
  const { panel, showResult } = await panelWorld();
  const note = new Node('div');
  note.className = 'tab-cleared-note';
  panel.insertBefore(note, panel.children[0]);
  showResult('r1-result');
  assert.deepEqual(order(panel).slice(0, 2), ['tab-cleared-note', 'r1-result']);
  delete globalThis.document;
});

test('S4: the DOM is moved, never reordered with CSS `order` (keyboard order = visual order)', () => {
  const css = strip(read('style.css'));
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => /#recipe-tabs|result-block|\.content/.test(m[1]));
  for (const m of rules) assert.doesNotMatch(m[2], /(^|[;\s])order:/, m[1].trim());
});

test('S4: calc.js moves the result on show and hide, and scrolls to the top on the first show', () => {
  const calcJs = read('js/calc.js');
  assert.match(calcJs, /import \{ placeResult \} from '\.\/result-place\.js';/);
  assert.match(calcJs, /e\.classList\.add\('visible'\);\s*placeResult\(e, true\);/);
  assert.match(calcJs, /e\.classList\.remove\('visible'\);\s*placeResult\(e, false\);/);
  assert.match(calcJs, /if \(wasHidden\) \{\s*const scroll = document\.querySelector\('\.scroll-area'\);\s*if \(scroll\) scroll\.scrollTop = 0;/);
  assert.match(read('sw.js'), /'\.\/js\/result-place\.js'/);
});

// ── S5: the full-screen recipe and the − / + text size ────────────────────────────────
import {
  ZOOM_SCALES, DEFAULT_ZOOM_STEP, clampStep, parseStep, readZoomStep, saveZoomStep, stepBy, canStep, scaleOf,
  buildZoomControls,
} from '../js/zoom-steps.js';

// A localStorage that holds what it is told, or throws on every call.
function useStorage(kind, seed = {}) {
  const data = { ...seed };
  globalThis.localStorage = kind === 'throws'
    ? { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } }
    : { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
  return data;
}

test('S5: six steps, 1× is the default, the largest is 2.1×', () => {
  assert.deepEqual([...ZOOM_SCALES], [0.8, 1, 1.2, 1.45, 1.75, 2.1]);
  assert.equal(ZOOM_SCALES[DEFAULT_ZOOM_STEP], 1);
  assert.ok(Object.isFrozen(ZOOM_SCALES));
});

test('S5: steps clamp at both ends and never leave the range', () => {
  assert.equal(stepBy(0, -1), 0);
  assert.equal(stepBy(5, 1), 5);
  assert.equal(stepBy(1, 1), 2);
  assert.equal(stepBy(1, -1), 0);
  assert.equal(stepBy(99, 0), 5);
  assert.equal(stepBy(-9, 0), 0);
  assert.equal(canStep(0, -1), false);
  assert.equal(canStep(0, 1), true);
  assert.equal(canStep(5, 1), false);
  assert.equal(canStep(5, -1), true);
  for (const junk of [null, undefined, '', 'x', NaN, 1.5, true, {}, []]) assert.equal(clampStep(junk), DEFAULT_ZOOM_STEP, String(junk));
  assert.equal(scaleOf(0), 0.8);
  assert.equal(scaleOf(5), 2.1);
  assert.equal(scaleOf('nonsense'), 1);
});

test('S5: a stored value that is corrupt or out of range answers the default, never an extreme', () => {
  for (const raw of [null, undefined, '', 'abc', '-1', '6', '99', '1.5', '1e1', '{"a":1}', '  ', 'NaN']) {
    assert.equal(parseStep(raw), DEFAULT_ZOOM_STEP, JSON.stringify(raw));
  }
  for (let n = 0; n <= 5; n++) assert.equal(parseStep(String(n)), n);
});

test('S5: the step is remembered per key, and a throwing or corrupt storage is survived', () => {
  const data = useStorage('ok');
  saveZoomStep('mise.calcZoomStep', 3);
  saveZoomStep('mise.catZoomStep', 5);
  assert.deepEqual(data, { 'mise.calcZoomStep': '3', 'mise.catZoomStep': '5' });
  assert.equal(readZoomStep('mise.calcZoomStep'), 3);
  assert.equal(readZoomStep('mise.catZoomStep'), 5);
  assert.equal(readZoomStep('mise.other'), DEFAULT_ZOOM_STEP);
  saveZoomStep('mise.calcZoomStep', 42); // clamped before it is written
  assert.equal(data['mise.calcZoomStep'], '5');
  useStorage('ok', { 'mise.calcZoomStep': 'banana' });
  assert.equal(readZoomStep('mise.calcZoomStep'), DEFAULT_ZOOM_STEP);
  useStorage('throws');
  assert.equal(readZoomStep('mise.calcZoomStep'), DEFAULT_ZOOM_STEP);
  assert.doesNotThrow(() => saveZoomStep('mise.calcZoomStep', 2));
  delete globalThis.localStorage;
  assert.equal(readZoomStep('mise.calcZoomStep'), DEFAULT_ZOOM_STEP, 'no storage at all');
});

function zoomWorld(kind = 'ok', seed = {}) {
  useDom();
  const data = useStorage(kind, seed);
  const target = new Node('div');
  const props = {};
  target.style = { setProperty: (k, v) => { props[k] = v; } };
  const controls = buildZoomControls({
    storageKey: 'mise.calcZoomStep', target,
    labels: { group: 'Text size', smaller: 'Smaller text', larger: 'Larger text' },
  });
  const [smaller, larger] = controls.node.children;
  const press = (btn) => {
    let stopped = false;
    btn.fire('click', { stopPropagation() { stopped = true; } });
    return { stopped };
  };
  return { data, target, props, controls, smaller, larger, press };
}

test('S5: the pair is labelled, starts at 1×, and − / + move the size and save it', () => {
  const w = zoomWorld();
  assert.equal(w.smaller.attributes['aria-label'], 'Smaller text');
  assert.equal(w.larger.attributes['aria-label'], 'Larger text');
  assert.equal(w.controls.node.attributes['aria-label'], 'Text size');
  assert.equal(w.props['--zoom-scale'], '1');
  w.press(w.larger);
  assert.equal(w.props['--zoom-scale'], '1.2');
  assert.equal(w.data['mise.calcZoomStep'], '2');
  w.press(w.smaller); w.press(w.smaller);
  assert.equal(w.props['--zoom-scale'], '0.8');
  assert.equal(w.target.attributes['data-zoom-step'], '0');
  assert.equal(w.data['mise.calcZoomStep'], '0');
});

test('S5: − is inert at the smallest step and + at the largest (aria-disabled, never `disabled`)', () => {
  const w = zoomWorld('ok', { 'mise.calcZoomStep': '0' });
  assert.equal(w.smaller.attributes['aria-disabled'], 'true');
  assert.equal(w.larger.attributes['aria-disabled'], 'false');
  w.press(w.smaller);
  assert.equal(w.props['--zoom-scale'], '0.8', 'a press at the end does nothing');
  for (let i = 0; i < 9; i++) w.press(w.larger);
  assert.equal(w.props['--zoom-scale'], '2.1');
  assert.equal(w.larger.attributes['aria-disabled'], 'true');
  assert.equal(w.smaller.attributes['aria-disabled'], 'false');
  assert.equal(w.data['mise.calcZoomStep'], '5');
  assert.equal(w.larger.disabled, false, 'the attribute stays off so keyboard focus is kept');
});

test('S5: a stored step is applied when the controls are built and again on sync()', () => {
  const w = zoomWorld('ok', { 'mise.calcZoomStep': '4' });
  assert.equal(w.props['--zoom-scale'], '1.75');
  w.data['mise.calcZoomStep'] = 'junk';
  w.controls.sync();
  assert.equal(w.props['--zoom-scale'], '1', 'corrupt → default');
});

test('S5: the buttons work with a storage that throws', () => {
  const w = zoomWorld('throws');
  assert.equal(w.props['--zoom-scale'], '1');
  assert.doesNotThrow(() => w.press(w.larger));
  assert.equal(w.props['--zoom-scale'], '1.2', 'the size still changes for this view');
});

test('S5: taps and keys on − / + never reach the view behind (the Ricettario closes on a tap or Enter)', () => {
  const w = zoomWorld();
  assert.equal(w.press(w.larger).stopped, true);
  assert.equal(w.press(w.smaller).stopped, true);
  let stopped = false;
  w.larger.fire('keydown', { key: 'Enter', stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  delete globalThis.localStorage;
});

// The Calculator's view.
function viewWorld() {
  useDom();
  useStorage('ok');
  globalThis.document.createElementNS = (ns, tag) => new Node(tag);
  const listeners = {};
  globalThis.document.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  globalThis.document.removeEventListener = (type, fn) => { listeners[type] = (listeners[type] || []).filter(f => f !== fn); };
  globalThis.document.body = new Node('body');
  const key = (k, extra = {}) => (listeners.keydown || []).slice().forEach(fn => fn({ key: k, preventDefault() {}, ...extra }));
  const opener = new Node('button');
  return { listeners, key, opener };
}
const ROWS = [{ name: 'Flour', grams: 600.4 }, { name: 'Water', grams: 380 }];

test('S5: the full-screen view shows only the rows and the total, as a labelled modal dialog', async () => {
  const w = viewWorld();
  const { openRecipeFullScreen } = await import('../js/calc-fullscreen.js');
  const api = openRecipeFullScreen({ name: 'Pizza', rows: ROWS, totalG: 980.4, opener: w.opener });
  const view = api.node;
  assert.equal(view.attributes.role, 'dialog');
  assert.equal(view.attributes['aria-modal'], 'true');
  assert.equal(view.attributes['aria-label'], 'Pizza');
  const rows = walk(view).filter(n => classesOf(n).includes('calc-zoom-row'));
  assert.deepEqual(rows.map(r => r.textContent), ['Flour600 g', 'Water380 g', 'Total dough980 g']);
  assert.ok(walk(view).some(n => n.className === 'zoom-steps'), 'the − / + pair is inside');
  assert.ok(globalThis.document.body.classList.contains('calc-zoom-lock'), 'the page behind is locked');
  assert.ok(globalThis.document.body.children.includes(view));
  const again = openRecipeFullScreen({ name: 'Pizza', rows: ROWS, totalG: 1, opener: w.opener });
  assert.equal(again, api, 'one view at a time');
  api.close();
  delete globalThis.localStorage;
});

test('S5: × and Escape close it, the page unlocks, and focus goes back to the opener', async () => {
  const w = viewWorld();
  const { openRecipeFullScreen } = await import('../js/calc-fullscreen.js');
  for (const how of ['x', 'escape']) {
    const api = openRecipeFullScreen({ name: 'Pizza', rows: ROWS, totalG: 980, opener: w.opener });
    const closeBtn = api.node.children[0];
    assert.equal(closeBtn.attributes['aria-label'], 'Exit full screen');
    assert.equal(closeBtn.focused, 1, 'focus moved in, onto ×');
    const before = w.opener.focused;
    if (how === 'x') closeBtn.fire('click'); else w.key('Escape');
    assert.equal(globalThis.document.body.children.length, 0, `${how}: removed`);
    assert.equal(globalThis.document.body.classList.contains('calc-zoom-lock'), false, `${how}: unlocked`);
    assert.equal(w.opener.focused, before + 1, `${how}: focus back on the opener`);
    assert.equal((w.listeners.keydown || []).length, 0, `${how}: key listener removed`);
  }
  delete globalThis.localStorage;
});

test('S5: Tab stays inside the dialog (× → − → + → ×)', async () => {
  const w = viewWorld();
  const { openRecipeFullScreen } = await import('../js/calc-fullscreen.js');
  const api = openRecipeFullScreen({ name: 'Pizza', rows: ROWS, totalG: 980, opener: w.opener });
  const stops = [api.node.children[0], ...api.controls.node.children];
  assert.equal(stops.length, 3);
  const order = [];
  let at = 0; // the × holds focus when the view opens
  for (let i = 0; i < 4; i++) {
    globalThis.document.activeElement = stops[at];
    const before = stops.map(s => s.focused);
    w.key('Tab', { shiftKey: false });
    at = stops.findIndex((s, j) => s.focused > before[j]);
    order.push(at);
  }
  assert.deepEqual(order, [1, 2, 0, 1]);
  // and backwards from the first stop lands on the last
  globalThis.document.activeElement = stops[0];
  const before = stops.map(s => s.focused);
  w.key('Tab', { shiftKey: true });
  assert.equal(stops.findIndex((s, j) => s.focused > before[j]), 2);
  api.close();
  delete globalThis.localStorage;
});

test('S5: the copy and send buttons cannot open it — only the button, the list and the total line do', () => {
  const app = read('js/app.js');
  const wired = app.slice(app.indexOf("const fsBtn = document.getElementById(id + '-fullscreen-btn');"), app.indexOf("const waBtn = document.getElementById(id + '-wa-recipe-btn');"));
  assert.ok(wired.length > 100, 'wiring block found');
  assert.match(wired, /fsBtn\.addEventListener\('click', openFullScreen\)/);
  assert.match(wired, /getElementById\(id \+ '-ingredients'\)/);
  assert.match(wired, /'#tab-' \+ id \+ ' \.total-dough-row'/);
  assert.doesNotMatch(wired.replace(/\/\/.*$/gm, ''), /copy|wa-recipe|send/i);
  // the copy row is a SIBLING of the list and of the total line, never inside them
  const render = read('js/calculator-render.js');
  const card = render.slice(render.indexOf("el('div', { class: 'result-card' }"), render.indexOf("el('div', { class: 'crate-boxes'"));
  assert.ok(card.indexOf("class: 'copy-row'") > card.indexOf("class: 'total-dough-row'"));
});

test('S5: the visible button is in the result header, labelled, and a real icon', async () => {
  useDom();
  globalThis.document.createElementNS = (ns, tag) => new Node(tag);
  const { buildRecipePanel } = await import('../js/calculator-render.js');
  const panel = buildRecipePanel({
    id: 'r1', name: 'Pizza', logic: 'both', trayWeight: 1000,
    ingredients: [{ key: 'flour', label: 'Flour', grams: 600 }], leaveningKey: null, leaveningDefaultPct: 0, showLeavening: false,
  });
  const nodes = walk(panel);
  const btn = nodes.find(n => n.attributes && n.attributes.id === 'r1-fullscreen-btn');
  assert.ok(btn);
  assert.equal(btn.attributes['aria-label'], 'Full screen');
  assert.equal(btn.tagName, 'BUTTON');
  assert.ok(walk(btn).some(n => n.tagName === 'SVG'));
  const header = nodes.find(n => n.className === 'result-header');
  assert.ok(header.children.includes(btn));
  const copyRow = nodes.find(n => n.className === 'copy-row');
  assert.ok(!walk(copyRow).includes(btn));
  delete globalThis.document;
});

test('S5: the full-screen CSS — wrap, bottom room for the pair, locked page, tablet column', () => {
  const css = strip(read('style.css'));
  assert.match(css, /\.calc-zoom \{[^}]*position: fixed;[^}]*inset: 0;[^}]*padding-bottom: var\(--zoom-steps-room\)/);
  assert.match(css, /\.calc-zoom-row \{[^}]*flex-wrap: wrap;[^}]*font-size: calc\(1em \* var\(--zoom-scale, 1\)\)/);
  assert.match(css, /\.calc-zoom-close \{[^}]*width: 48px;[^}]*height: 48px;/);
  assert.match(css, /body\.calc-zoom-lock \.scroll-area \{ overflow: hidden; \}/);
  assert.match(css, /body\[data-card="calculator"\] \.calc-zoom-rows \{ max-width: 620px;/);
  const tokens = strip(read('tokens.css'));
  assert.match(tokens, /\.zoom-step-btn \{[^}]*width: 48px;[^}]*height: 48px;[^}]*border-radius: 50%;[^}]*background: var\(--brand\)/);
  assert.match(tokens, /\.zoom-steps \{[^}]*position: fixed;[^}]*right: var\(--space-4\);[^}]*bottom: calc\(var\(--space-4\)/);
  assert.match(tokens, /--zoom-steps-room: calc\(48px \+ 2 \* var\(--space-4\)/);
  assert.match(tokens, /\.zoom-step-btn\[aria-disabled="true"\] \{ opacity: \.4/);
});

test('S5: the Ricettario gets the same pair on its zoom view, and − / + do not close it', () => {
  const detail = read('js/catalogue/catalogue-detail.js');
  assert.match(detail, /import \{ buildZoomControls \} from '\.\/zoom-steps\.js';/);
  assert.match(detail, /storageKey: 'mise\.catZoomStep',\s*target: ingList,/);
  assert.match(detail, /ingList\.appendChild\(zoomControls\.node\);/);
  assert.match(detail, /zoomed = on;\s*if \(on\) zoomControls\.sync\(\);/);
  // the view's own tap-to-close and × are still there
  assert.match(detail, /onclick: \(\) => setZoom\(!zoomed\)/);
  assert.match(detail, /onclick: \(e\) => \{ e\.stopPropagation\(\); setZoom\(false\); \}/);
  const css = strip(read('catalogue.css'));
  assert.match(css, /\.cat-ing-list--zoom \{ padding-bottom: var\(--zoom-steps-room\); \}/);
  assert.match(css, /font-size: calc\(clamp\(1\.4rem, 6\.4vw, 2\.2rem\) \* var\(--zoom-scale, 1\)\)/);
  assert.match(css, /\.cat-ing-list:not\(\.cat-ing-list--zoom\) \.zoom-steps \{ display: none; \}/);
  assert.equal(read('js/zoom-steps.js').replace(/\r\n/g, '\n'), read('js/catalogue/zoom-steps.js').replace(/\r\n/g, '\n'));
});

test('S5: the words, in both languages; each feature has its own storage key', () => {
  const pairs = {
    'calc.fullScreen': ['Full screen', 'Schermo intero'],
    'calc.exitFullScreen': ['Exit full screen', 'Esci dallo schermo intero'],
    'ui.textSize': ['Text size', 'Dimensione del testo'],
    'ui.textSmaller': ['Smaller text', 'Testo più piccolo'],
    'ui.textLarger': ['Larger text', 'Testo più grande'],
  };
  for (const [k, [en, it]] of Object.entries(pairs)) {
    assert.equal(D.en[k], en, k);
    assert.equal(D.it[k], it, k);
  }
  assert.match(read('js/calc-fullscreen.js'), /ZOOM_STORAGE_KEY = 'mise\.calcZoomStep'/);
  assert.match(read('js/catalogue/catalogue-detail.js'), /'mise\.catZoomStep'/);
  const sw = read('sw.js');
  for (const f of ['./js/zoom-steps.js', './js/calc-fullscreen.js', './js/catalogue/zoom-steps.js']) assert.ok(sw.includes(`'${f}'`), f);
});
