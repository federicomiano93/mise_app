// Slice 2 of «Save moves into the green header» (4 Oct 2026): the Catalogue editors, the
// Food cost product editor and its Settings, and the Pastries editor. Source-reading pins,
// because the owner cannot read the code:
//   • each page's header holds ONE `.app-header-save` (hidden until an editor asks for it);
//   • no editor builds a Save at the bottom of its form any more;
//   • Delete / margin history stay at the bottom, low-key;
//   • Food cost's tablet Save lives in the pane head, never in the list's page header;
//   • the pane's light head repaints the pill as the solid green button.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const count = (s, re) => (s.match(re) || []).length;

const PAGES = [
  ['catalogue.html', 'catSave', 'js/catalogue/catalogue-main.js'],
  ['pastries.html', 'pasSave', 'js/pastries/pastries-main.js'],
  ['foodcost.html', 'fcSave', 'js/foodcost/foodcost-main.js'],
];

for (const [page, id, main] of PAGES) {
  test(`${page}: one hidden header Save, in the right slot, after the other buttons`, () => {
    const html = read(page);
    assert.equal(count(html, /app-header-save/g), 1);
    const header = html.slice(html.indexOf('<header class="app-header">'), html.indexOf('</header>'));
    assert.match(header, new RegExp(`<button type="button" class="app-header-save" id="${id}" data-i18n="ui\.save" hidden>`));
    assert.ok(header.indexOf('app-header-slot" data-help') < header.indexOf(id), 'inside the right slot');
    assert.ok(header.indexOf('app-icon-btn', header.indexOf('data-help')) < header.indexOf(id), 'after the round buttons');
    const js = read(main);
    assert.ok(js.includes(`getElementById('${id}')`));
    assert.match(js, /saveBtn\.hidden = true/, 'every route hides it first');
  });
}

test('Catalogue and Pastries: the editor registers its Save with the page header', () => {
  for (const [main, editors] of [
    ['js/catalogue/catalogue-main.js', ['js/catalogue/catalogue-editor.js', 'js/catalogue/guided-editor.js']],
    ['js/pastries/pastries-main.js', ['js/pastries/pastries-editor.js']],
  ]) {
    const js = read(main);
    assert.match(js, /setHeaderSave: \(fn\) => \{\s*headerSave = fn;\s*saveBtn\.hidden = !fn;/);
    assert.match(js, /saveBtn\.addEventListener\('click', \(\) => headerSave\?\.\(\)\)/);
    // setHeader() clears the handler together with hiding the button
    assert.match(js, /headerSave = null;\s*saveBtn\.hidden = true;\s*headerEl\.classList\.remove/);
    for (const f of editors) assert.match(read(f), /app\.setHeaderSave\(onSave\)/, f);
  }
});

test('no editor of these screens builds a Save at the bottom of its form', () => {
  assert.ok(!/cat-save-btn/.test(read('js/catalogue/catalogue-editor.js')));
  assert.ok(!/cat-save-btn/.test(read('js/catalogue/guided-editor.js')));
  assert.ok(!/pas-save-btn|pas-editor-actions/.test(read('js/pastries/pastries-editor.js')));
  assert.ok(!/pas-save-btn|pas-editor-actions/.test(read('pastries.css')));
  assert.ok(!/fc-save/.test(read('js/foodcost/foodcost-editor.js')));
  assert.ok(!/fc-save/.test(read('js/foodcost/foodcost-settings.js')));
  assert.ok(!/fc-save/.test(read('foodcost.css')));
});

test('the Catalogue photo «Read» button still uses .cat-save-btn (its CSS stays)', () => {
  assert.match(read('js/catalogue/photo-capture.js'), /cat-save-btn cat-photo-read/);
  assert.match(read('catalogue.css'), /^\.cat-save-btn \{/m);
});

test('Catalogue: Delete stays at the bottom, only for an owner, and a new recipe has no empty row', () => {
  const src = read('js/catalogue/catalogue-editor.js');
  assert.match(src, /const actions = recipe && canManageHere\(\)\s*\? el\('div', \{ class: 'cat-editor-actions' \}/);
  assert.match(src, /class: 'cat-del-btn'/);
  assert.match(src, /\)\s*: null;\s*\n\s*renderIngredientRows\(\);/);
});

test('Food cost: the editor exposes save(); Delete and the history stay in .fc-actions', () => {
  const src = read('js/foodcost/foodcost-editor.js');
  assert.match(src, /root,\s*save: onSave,/);
  assert.match(src, /historyBtn \|\| \(product && canManageHere\(\)\) \? el\('div', \{ class: 'fc-actions' \}/);
  assert.match(src, /class: 'fc-delete'/);
});

test('Food cost: phone Save in the page header, tablet Save in the pane head, never both', () => {
  const js = read('js/foodcost/foodcost-main.js');
  // phone: only the editor's own phone header shows it
  const phone = js.slice(js.indexOf('function setEditorHeaderPhone'), js.indexOf('function openProduct'));
  assert.match(phone, /saveBtn\.hidden = false/);
  assert.equal(count(js, /saveBtn\.hidden = false/g), 1);
  const setHeader = js.slice(js.indexOf('function setHeader'), js.indexOf('// The bottom bar.'));
  assert.match(setHeader, /saveBtn\.hidden = true/);
  // tablet: built into the pane head, only while an editor is open
  const head = js.slice(js.indexOf('function buildPaneHead'), js.indexOf('// A node into the pane'));
  assert.match(head, /const withSave = view === 'editor' && !!activeEditor;/);
  assert.match(head, /withSave \? el\('button'/);
  assert.match(head, /class: 'app-header-save'/);
  assert.match(head, /activeEditor\?\.save\(\)/);
  assert.match(js, /saveBtn\.addEventListener\('click', \(\) => activeEditor\?\.save\(\)\)/);
});

test('Food cost Settings: the one Save is in its own overlay header, right slot', () => {
  const src = read('js/foodcost/foodcost-settings.js');
  assert.match(src, /const saveBtn = el\('button', \{ class: 'app-header-save', type: 'button', onclick: save \}, t\('ui\.save'\)\)/);
  assert.match(src, /el\('span', \{ class: 'app-header-slot' \}, \[saveBtn\]\)/);
  assert.equal(count(src, /app-header-save/g), 1);
});

test('a header that holds a Save drops the 84px reserve, so the title never goes under a button', () => {
  const css = read('tokens.css');
  assert.match(css, /body\[data-section="catalogue"\] \.app-header\.app-header--save,\s*body\[data-section="pastries"\] \.app-header\.app-header--save,\s*body\[data-card="foodcost"\] \.app-header\.app-header--save \{\s*--app-header-side: auto;/);
  for (const f of ['js/catalogue/catalogue-main.js', 'js/pastries/pastries-main.js']) {
    const js = read(f);
    assert.match(js, /headerEl\.classList\.remove\('app-header--save'\)/, f);
    assert.match(js, /headerEl\.classList\.toggle\('app-header--save', !!fn\)/, f);
  }
  const fc = read('js/foodcost/foodcost-main.js');
  assert.match(fc, /headerEl\.classList\.add\('app-header--save'\)/);
  assert.match(fc, /headerEl\.classList\.remove\('app-header--save'\)/);
  assert.match(fc, /withSave \? 'app-header app-header--save' : 'app-header'/);
});

test('the pane\'s light head repaints the Save pill as the solid green button', () => {
  const css = read('tokens.css');
  assert.match(css, /\.app-split-pane \.app-header-save \{ background: var\(--brand\); color: var\(--on-brand\); \}/);
  assert.match(css, /\.app-split-pane \.app-header-save:focus-visible \{ outline: 2px solid var\(--accent-2\)/);
});
