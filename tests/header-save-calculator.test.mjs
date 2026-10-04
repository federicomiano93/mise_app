// The Calculator's ONE Save per screen lives in the green header (4 Oct 2026), not at the
// bottom of the form. Source-reading pins, because the owner cannot read the code:
//   • every overlay header that has a Save holds an `.app-header-save`, with an id;
//   • no screen builds a `cp-save-bottom` Save any more (the one «Restore this version»
//     button in the log history is not a save and keeps the class);
//   • the shared style exists in tokens.css with the 44px touch area and the on-brand ring;
//   • the title gives way to the Save (style.css), and Home is hidden with `hidden`
//     (that rule reads it through :has()).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const html = read('calculator.html');

// overlay id -> the id of the header Save inside it
const SAVES = {
  'recipe-overlay': 'recipe-save-btn',
  'extra-overlay': 'extra-save-btn',
  'divisor-overlay': 'divisor-save-btn',
  'cosettings-overlay': 'cosettings-save-btn',
  'logsettings-overlay': 'logsettings-save-btn',
  'wa-overlay': 'wa-save-btn',
  'cp-overlay': 'cp-save-btn',
  'logedit-overlay': 'logedit-save-btn',
  'logadd-overlay': 'logadd-save-btn',
};

function overlayHeader(id) {
  const start = html.indexOf(`<div id="${id}"`);
  assert.ok(start >= 0, `${id} exists in calculator.html`);
  const open = html.indexOf('<div class="recipe-overlay-header">', start);
  const close = html.indexOf('<div class="recipe-scroll">', open);
  assert.ok(open > start && close > open, `${id} has a header`);
  return html.slice(open, close);
}

test('every Calculator overlay with a Save has it in the header, once', () => {
  for (const [overlay, saveId] of Object.entries(SAVES)) {
    const header = overlayHeader(overlay);
    const saves = header.match(/class="app-header-save"/g) || [];
    assert.equal(saves.length, 1, `${overlay} header holds exactly one .app-header-save`);
    assert.ok(header.includes(`id="${saveId}"`), `${overlay} header Save has id ${saveId}`);
    assert.ok(header.includes('data-i18n="ui.save"'), `${overlay} header Save says ui.save`);
    // order on the right: Save, then Home
    const save = header.indexOf('app-header-save');
    const home = header.search(/aria-label="Home"/);
    if (home >= 0) assert.ok(save < home, `${overlay}: Save comes before Home`);
  }
});

test('no Save sits outside a header in calculator.html', () => {
  const total = (html.match(/app-header-save/g) || []).length;
  assert.equal(total, Object.keys(SAVES).length, 'one header Save per screen, none elsewhere');
  assert.ok(!/<button[^>]*cp-save-bottom/.test(html), 'no static cp-save-bottom button');
});

test('no module builds a bottom Save any more', () => {
  const files = [
    'js/calculator-settings.js', 'js/calculator-whatsapp-settings.js', 'js/recipes.js',
    'js/log-settings.js', 'js/log-add.js', 'js/log-edit.js', 'js/calculator-client-orders.js',
  ];
  for (const f of files) {
    const src = read(f);
    const uses = (src.match(/cp-save-bottom/g) || []).length;
    // log-edit keeps ONE: «Restore this version» is an action, not a Save.
    const allowed = f === 'js/log-edit.js' ? 1 : 0;
    assert.equal(uses, allowed, `${f} builds ${allowed} cp-save-bottom button(s)`);
    assert.ok(!/saveBottom/.test(src), `${f} has no saveBottom helper`);
  }
  assert.match(read('js/log-edit.js'), /cp-save-bottom[^\n]*calc\.restoreThisVersion/);
});

test('each header Save is wired to its handler in the module that owns the screen', () => {
  const wires = [
    ['js/calculator-settings.js', /getElementById\('cp-save-btn'\)\.addEventListener\('click', saveClients\)/],
    ['js/calculator-settings.js', /getElementById\('divisor-save-btn'\)\.addEventListener\('click', saveDivisor\)/],
    ['js/calculator-settings.js', /getElementById\('extra-save-btn'\)\.addEventListener\('click', saveExtra\)/],
    ['js/app.js', /getElementById\('recipe-save-btn'\)\.addEventListener\('click', saveRecipes\)/],
    ['js/calculator-whatsapp-settings.js', /getElementById\('wa-save-btn'\)\.addEventListener\('click', saveDetail\)/],
    ['js/log-settings.js', /getElementById\('logsettings-save-btn'\)\.addEventListener\('click', saveAll\)/],
    ['js/log-add.js', /getElementById\('logadd-save-btn'\)\.addEventListener\('click', commit\)/],
    ['js/log-edit.js', /getElementById\('logedit-save-btn'\)\.addEventListener\('click', save\)/],
    ['js/calculator-client-orders.js', /getElementById\('cosettings-save-btn'\)/],
  ];
  for (const [f, re] of wires) assert.match(read(f), re, `${f} wires ${re}`);
});

test('Save shows only on the levels that save (WhatsApp, Divisor, Add log)', () => {
  const wa = read('js/calculator-whatsapp-settings.js');
  assert.equal((wa.match(/setSaveVisible\(true\)/g) || []).length, 3, 'three WhatsApp detail levels turn it on');
  assert.match(wa, /function renderEditor\(\) \{[^}]*setSaveVisible\(false\)/s, 'every redraw starts with it off');
  const div = read('js/calculator-settings.js');
  assert.match(div, /setDivisorSaveVisible\(false\)/);
  assert.match(div, /setDivisorSaveVisible\(true\)/);
  const add = read('js/log-add.js');
  assert.match(add, /saveBtn\.hidden = true/);
  assert.match(add, /saveBtn\.hidden = false/);
});

test('the title is the last child of every header with a Save (the sibling rule needs it)', () => {
  for (const overlay of Object.keys(SAVES)) {
    const header = overlayHeader(overlay);
    const title = header.indexOf('recipe-overlay-title');
    assert.ok(title > header.indexOf('app-header-save'), `${overlay}: title after Save`);
    assert.ok(title > header.search(/aria-label="Home"|aria-label="Back"/), `${overlay}: title after Back`);
    const home = header.search(/aria-label="Home"/);
    if (home >= 0) assert.ok(title > home, `${overlay}: title after Home`);
  }
});

test('Home is hidden with the hidden attribute so the header title rule can see it', () => {
  for (const f of ['js/calculator-settings.js', 'js/calculator-whatsapp-settings.js', 'js/recipes.js']) {
    assert.ok(!/btn\.style\.display = visible/.test(read(f)), `${f} does not hide Home with a style`);
    assert.match(read(f), /btn\.hidden = !visible/);
  }
});

test('the shared header Save style: 36px pill, 44px touch area, on-brand ring', () => {
  const css = read('tokens.css');
  const rule = css.match(/^\.app-header-save \{[^}]*\}/m)[0];
  assert.match(rule, /height: 36px/);
  assert.match(rule, /border-radius: 999px/);
  assert.match(rule, /background: var\(--surface\)/);
  assert.match(rule, /color: var\(--brand\)/);
  assert.match(rule, /white-space: nowrap/);
  assert.match(css, /\.app-header-save::before \{[^}]*inset: -4px/);
  assert.match(css, /\.app-header-save:focus-visible \{ outline: 2px solid var\(--on-brand\)/);
  assert.match(css, /\.app-header-save:disabled \{ opacity: \.5/);
  assert.match(css, /\.app-header-save\[hidden\] \{ display: none; \}/);
});

test('the overlay title gives way to the header Save', () => {
  const css = read('style.css');
  assert.match(css, /\.app-header-save:not\(\[hidden\]\) ~ \.recipe-overlay-title/);
  assert.match(css, /\.app-header-save:not\(\[hidden\]\) ~ \.app-icon-btn:not\(\[hidden\]\) ~ \.recipe-overlay-title/);
  assert.ok(!/\.recipe-overlay-title[^{]*:has\(|:has\([^)]*app-header-save/.test(css), 'no :has() (see calculator-tablet.test.mjs)');
});

test('the Orders history editor uses the shared header Save', () => {
  assert.match(read('js/orders/history-edit.js'), /class: 'app-header-save'/);
  assert.ok(!/hist-edit-save/.test(read('orders.css')));
});
