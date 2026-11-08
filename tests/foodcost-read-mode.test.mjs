// A Food cost product opens to READ; the pencil turns it into the form (Federico, 7 Nov 2026).
// Pinned at source level (no DOM library here), plus the pure helpers run for real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// Comments stripped before the source checks — a guard that fires on its own warning comment
// is a guard people widen.
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
const readSections = read('../js/foodcost/read-sections.js');
const editor = read('../js/foodcost/foodcost-editor.js');
const main = read('../js/foodcost/foodcost-main.js');
const html = read('../foodcost.html');
// A function's source: from its line to the closing brace at the SAME indentation.
const fnBody = (src, name) => {
  const m = new RegExp(`^( *)(async )?function ${name}\\(`, 'm').exec(src);
  assert.ok(m, `${name} exists`);
  const rest = src.slice(m.index);
  const end = rest.indexOf(`\n${m[1]}}\n`);
  return rest.slice(0, end + 3);
};

test('the read sections create no input, select or textarea — they are text', () => {
  const code = codeOf(readSections);
  assert.doesNotMatch(code, /el\(\s*['"](input|select|textarea|button)['"]/);
  assert.doesNotMatch(code, /createElement/);
  assert.doesNotMatch(code, /onclick|oninput|onchange/);
  // Every label/value row is a real description list.
  assert.match(code, /el\('dl', \{ class: 'fc-read' \}/);
  assert.match(code, /el\('div', \{ class: 'fc-read-row' \}/);
  assert.match(code, /el\('dt'/);
  assert.match(code, /el\('dd'/);
});

test('a missing value is «Not set», never 0 or a zero price', () => {
  const code = codeOf(readSections);
  assert.match(code, /t\('fc\.notSet'\)/);
  assert.match(code, /t\('fc\.read\.nothingYet'\)/);
  assert.match(code, /positive\(price\) \? fcMoney\(price\) : null/);
});

test('the read sections import only models and formatters, never the editor or another feature', () => {
  const imports = [...readSections.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['../currency.js', '../i18n.js', './dom.js', './fc-number.js', './foodcost-weighing.js'].sort());
});

test('perKgWeightText and showsPiecesField: grams under a kilo, kilos from a kilo; pieces only where sold so', async () => {
  const { perKgWeightText, showsPiecesField } = await import('../js/foodcost/read-sections.js');
  assert.equal(perKgWeightText(0.25), '250.00 g');
  assert.equal(perKgWeightText(0.0042), '4.20 g');
  assert.equal(perKgWeightText(0.999999), '1.00 kg', '999.999 g reads «1.00 kg», never «1000.00 g»');
  assert.equal(perKgWeightText(1.5), '1.50 kg');
  assert.equal(showsPiecesField({ sellingMode: 'piece' }), true);
  assert.equal(showsPiecesField({ sellingMode: 'pack', packUnit: 'pcs' }), true);
  assert.equal(showsPiecesField({ sellingMode: 'pack', packUnit: 'g' }), false);
  assert.equal(showsPiecesField({ sellingMode: 'weight' }), false);
  assert.match(codeOf(editor), /import \{[^}]*perKgWeightText[^}]*\} from '\.\/read-sections\.js'/, 'one rule, imported by the editor');
});

test('«Scheda completa»: the summary above the box, the sections in the agreed order, actions last', () => {
  const code = codeOf(editor);
  assert.match(code, /const root = el\('div', \{ class: 'fc-view fc-editor' \}, \[summary, full\]\);/);
  const order = (src) => ['fc.section.product', "'fc.madeOf'", "'fc.packaging'", "'fc.labour'", 'fc.section.price', 'fc.section.results']
    .map((k) => src.indexOf(`card(${k.startsWith("'") ? k : `'${k}'`}`));
  const readStart = code.indexOf('const cards = isRead ? [');
  const editStart = code.indexOf('] : [', readStart);
  const readPart = code.slice(readStart, editStart);
  const editPart = code.slice(editStart, code.indexOf('const actions'));
  for (const part of [readPart, editPart]) {
    const at = order(part);
    assert.ok(at.every((i) => i > -1), 'all six cards');
    assert.deepEqual([...at].sort((a, b) => a - b), at, 'Prodotto, Composto da, Imballaggio, Lavoro, Prezzo, Costi calcolati');
  }
  assert.match(code, /const body = el\('div', \{ class: 'fc-full-body' \}, \[\.\.\.cards, actions\]\);/);
  // Inside the form's cards, inputs are in the order they are filled: name, how sold, pack, pieces…
  assert.ok(editPart.indexOf('nameInput') < editPart.indexOf('modeSelect')
    && editPart.indexOf('modeSelect') < editPart.indexOf('packField')
    && editPart.indexOf('packField') < editPart.indexOf('piecesField'));
  // …the VAT before the target before the price, the suggestion under it.
  assert.ok(editPart.indexOf('vatField') < editPart.indexOf('targetInput')
    && editPart.indexOf('targetInput') < editPart.indexOf('priceInput')
    && editPart.indexOf('priceInput') < editPart.indexOf('suggestion,'));
  // The results card keeps the three nodes drivers outside the repo read.
  assert.match(code, /card\('fc\.section\.results', \[prodCost, answer, perKg\]\)/);
  assert.match(code, /el\('section', \{ class: 'fc-card' \}/);
  assert.match(code, /el\('h2', \{ class: 'fc-section', text: t\(titleKey\) \}\)/);
});

test('read: a details closed by default, open only without a summary; edit: a non-collapsible section', () => {
  const code = codeOf(editor);
  assert.match(code, /el\('details', \{ class: 'fc-full', open: summaryShows \? null : '' \}/);
  assert.match(code, /el\('summary', \{ class: 'fc-full-summary' \}/);
  assert.match(code, /el\('section', \{ class: 'fc-full fc-full--edit' \}/);
  assert.match(code, /el\('h2', \{ class: 'fc-full-summary', text: t\('fc\.fullCard'\) \}\)/);
  const edit = code.slice(code.indexOf("el('section', { class: 'fc-full fc-full--edit' }"));
  assert.doesNotMatch(edit.slice(0, 250), /details|CHEVRON/, 'no chevron, nothing to close');
  const css = read('../foodcost.css');
  assert.match(css, /\.fc-full-summary \{[^}]*min-height: 44px/);
  assert.match(css, /\.fc-full-summary:focus-visible \{ outline: 2px solid var\(--fc-accent\)/);
  assert.doesNotMatch(css.slice(css.indexOf('«Scheda completa»')), /:has\(|container-type|@container/, 'the lab tablet runs Chrome 101');
});

test('the mode: auto reads a stored product that has a summary, edits a new one and one with nothing priced', () => {
  const code = codeOf(editor);
  assert.match(code, /export function renderEditor\(\{ product, draft = null, app, mode: wanted = 'auto' \}\)/);
  assert.match(code, /productionCost\(working, liveTables\(\)\)\.batchCost !== null/);
  assert.match(code, /const mode = wanted === 'read' \|\| wanted === 'edit' \? wanted : \(product && summaryShows \? 'read' : 'edit'\);/);
  assert.match(code, /const isRead = mode === 'read';/);
});

test('«Use this price» exists only in the form', () => {
  const body = fnBody(codeOf(editor), 'paintSuggestion');
  const read = body.indexOf('if (isRead)');
  assert.ok(read > -1 && read < body.indexOf("'fc-use-price'"), 'the read view returns before the button is built');
  assert.match(body.slice(read, body.indexOf("'fc-use-price'")), /return;/);
});

test('Save goes back to the READ view of the saved product, with the id saveProduct returns', () => {
  const save = fnBody(codeOf(editor), 'onSave');
  assert.match(save, /const savedId = app\.saveProduct\(clean, snapshot, patches\);/);
  assert.match(save, /app\.showSaved\(savedId\);/);
  assert.doesNotMatch(save, /app\.showList\(\)/);
  assert.match(save, /mise:action/);
  assert.match(save, /t\('fc\.productSaved'\) : t\('fc\.productAdded'\)/);
  // Delete still goes to the list.
  assert.match(fnBody(codeOf(editor), 'onDelete'), /app\.showList\(\)/);
});

test('showSaved opens the fresh product in READ (forced), refreshing the tablet list first', () => {
  const body = fnBody(codeOf(main), 'showSaved');
  assert.match(body, /getProducts\(\)\.find\(\(p\) => p && p\.id === id\)/);
  assert.match(body, /if \(!fresh\) \{ showList\(\); return; \}/);
  assert.ok(body.indexOf('activeList.refresh(listedProducts(), tables())') < body.indexOf("openProduct(fresh, null, { mode: 'read' })"));
  assert.match(main, /^\s*showSaved,$/m, 'offered to the editor on app');
});

test('the pencil opens the form from the read view; Back from it returns to the read view', () => {
  const code = codeOf(main);
  assert.match(fnBody(code, 'startEdit'), /openProduct\(fresh \|\| currentProduct, null, \{ mode: 'edit', fromRead: true \}\)/);
  assert.match(fnBody(code, 'startEdit'), /activeEditor\.mode !== 'read'/);
  const stop = fnBody(code, 'stopEdit');
  assert.match(stop, /if \(!\(await askLeave\(\)\)\) return;/, 'the usual «discard changes?» question first');
  assert.match(stop, /openProduct\(fresh, null, \{ mode: 'read' \}\)/);
  assert.match(stop, /\|\| currentProduct/, 'the fresh stored product, else the one on screen');
  // handleBack: the FIRST rule (phone); the pane head has its own Back on a tablet.
  const back = fnBody(code, 'handleBack');
  assert.ok(back.indexOf('stopEdit()') > -1 && back.indexOf('stopEdit()') < back.indexOf("view === 'history' && heldEditor"));
  assert.match(back, /if \(!splitOn && view === 'editor' && editFromRead/);
  assert.match(fnBody(code, 'buildPaneHead'), /withSave && editFromRead \? stopEdit : null/);
  // Only a form opened by the pencil has a read view below it.
  assert.match(code, /editFromRead = fromRead && activeEditor\.mode === 'edit';/);
  assert.match(fnBody(code, 'showList'), /editFromRead = false;/);
});

test('the read view follows the stored product: redrawn in place, a deletion leaves it on any screen', () => {
  const code = codeOf(main);
  const cb = code.slice(code.indexOf('initFoodCost('));
  assert.match(cb, /view === 'editor' && activeEditor && activeEditor\.mode === 'read' && currentProduct && currentProduct\.id/);
  assert.match(cb, /if \(!fresh && hasLiveProducts\(\)\) \{ toast\(t\('fc\.productDeleted'\)\); showList\(\); return; \}/, 'no splitOn condition: phone too');
  assert.match(cb, /JSON\.stringify\(fresh\) !== JSON\.stringify\(currentProduct\)\) refreshRead\(fresh\)/);
  assert.match(cb, /else activeEditor\.refreshData\(\);/);
  // The form keeps its working copy: its branch is the old one.
  assert.match(cb, /\} else if \(view === 'editor' && activeEditor\) \{\s*if \(openProductWasDeleted\(activeEditor\)\)/);
  const body = fnBody(code, 'refreshRead');
  assert.match(body, /quietFocus = true;/);
  assert.match(body, /openProduct\(fresh, null, \{ mode: 'read' \}\)/);
  assert.match(body, /\.fc-full\[open\]/);
  assert.match(body, /scrollTop/);
  assert.match(body, /\.fc-pane-body/);
  assert.match(body, /\.fc-full-summary'\)\.focus/);
  assert.doesNotMatch(body, /entryEditor|listFilter|fromRecipe|editFromRead/);
});

test('the pencil refuses a product deleted elsewhere; the phone read view is redrawn when the language arrives', () => {
  const code = codeOf(main);
  const edit = fnBody(code, 'startEdit');
  assert.match(edit, /!fresh && currentProduct\.id && hasLiveProducts\(\)\) \{ toast\(t\('fc\.productDeleted'\)\); showList\(\); return; \}/);
  assert.ok(edit.indexOf('productDeleted') < edit.indexOf("mode: 'edit'"));
  const lang = code.slice(code.indexOf('onLanguageChange(() => {'));
  assert.match(lang, /!splitOn && view === 'editor' && activeEditor && activeEditor\.mode === 'read' && currentProduct\) \{\s*refreshRead\(currentProduct\);/);
});

test('the no-loss switch row keeps its padding and dashed line inside the «Composto da» card', () => {
  const css = read('../foodcost.css');
  assert.match(css, /\.fc-card \.fc-weighs \.fc-noloss \{ padding: 10px 2px; border-top: 1px dashed var\(--fc-border\); \}/);
  assert.doesNotMatch(css, /\.fc-madeof \.fc-noloss/, 'the weighings are no longer inside .fc-madeof');
  assert.match(css, /\.fc-read-row dd\.fc-read-invalid \{ color: var\(--fc-danger\); \}/);
});

test('the header: the phone shows the pencil in read and Save in the form; the tablet pane head draws the same', () => {
  assert.match(html, /<button class="app-icon-btn" id="fcEdit" data-i18n="fc\.editProduct" data-i18n-attr="aria-label" aria-label="Edit product" hidden>/);
  assert.match(html, /<path d="M12 20h9"\/><path d="M16\.5 3\.5a2\.1 2\.1 0 0 1 3 3L7 19l-4 1 1-4z"\/>/);
  const code = codeOf(main);
  assert.match(code, /editBtn\.addEventListener\('click', startEdit\);/);
  assert.match(fnBody(code, 'setHeader'), /editBtn\.hidden = true;/);
  const phone = fnBody(code, 'setEditorHeaderPhone');
  assert.match(phone, /const reading = !!activeEditor && activeEditor\.mode === 'read';/);
  assert.match(phone, /saveBtn\.hidden = reading;/);
  assert.match(phone, /editBtn\.hidden = !reading;/);
  const head = fnBody(code, 'buildPaneHead');
  assert.match(head, /const withPencil = showing === 'read';/);
  assert.match(head, /'aria-label': t\('fc\.editProduct'\)/);
  // The phone header of a held editor / a moved editor matches its mode (set after activeEditor is).
  assert.ok(fnBody(code, 'backToProduct').indexOf('activeEditor = heldEditor;') < fnBody(code, 'backToProduct').indexOf('setEditorHeaderPhone'));
  assert.match(fnBody(code, 'moveEditor'), /setEditorHeaderPhone\(currentProduct\);\s*swap\(node\);/);
});

test('editFromRead is declared before the first language or session callback (no TDZ)', () => {
  const decl = main.indexOf('let editFromRead');
  assert.ok(decl > -1);
  const first = Math.min(...['onLanguageChange(', 'onSession('].map((s) => {
    const m = new RegExp('^\\s*' + s.replace('(', '\\('), 'm').exec(main);
    return m ? m.index : Infinity;
  }));
  assert.ok(decl < first);
});

test('the new words exist in both languages', async () => {
  const { _dictionaries } = await import('../js/i18n.js');
  const dicts = _dictionaries();
  const keys = ['fc.fullCard', 'fc.editProduct', 'fc.section.product', 'fc.section.weighing', 'fc.section.price',
    'fc.section.results', 'fc.notSet', 'fc.read.nothingYet'];
  for (const key of keys) {
    for (const lang of ['en', 'it']) assert.ok(dicts[lang][key], `${key} missing in ${lang}`);
  }
  assert.equal(dicts.it['fc.fullCard'], 'Scheda completa');
  assert.equal(dicts.it['fc.notSet'], 'Non inserito');
});
