// How the recipe export is wired: the libraries stay out of the Calculator's bundle and load on the
// tap, they are precached for offline use, the words exist in both languages, and the button reads
// the same model the result card draws. (The files themselves: tests/recipe-export.test.mjs.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { translate, _dictionaries } from '../js/i18n.js';
import { exportErrorKey, exportErrorCode } from '../js/recipe-export.js';
import { exportTraysFor } from '../js/calculator-config.js';
import { BUILD_CONFIG } from '../scripts/bundle-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const VENDOR = ['js/vendor/jspdf.esm.js', 'js/vendor/write-excel-file.esm.js'];

function jsFiles(dir) {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) return name === 'vendor' ? [] : jsFiles(rel);
    return name.endsWith('.js') ? [rel] : [];
  });
}

test('the build lists exactly the two export libraries as lazy', () => {
  assert.deepEqual([...BUILD_CONFIG.lazyVendorFiles], VENDOR);
});

test('⚠️ the Calculator bundle holds no library code, only the import() of each file', () => {
  const bundle = read('dist/calculator.js');
  assert.ok(bundle.includes('import("../js/vendor/jspdf.esm.js")'));
  assert.ok(bundle.includes('import("../js/vendor/write-excel-file.esm.js")'));
  assert.ok(!bundle.includes('fast-png') && !bundle.includes('jspdf 4.'), 'jsPDF was inlined into the bundle');
  assert.ok(bundle.length < 600 * 1024, `the Calculator bundle is ${bundle.length} bytes`);
});

test('⚠️ no file under js/ imports a library statically (only import() inside a function)', () => {
  const offenders = [];
  for (const file of jsFiles('js')) {
    const src = read(file);
    if (/(?:^|\n)\s*(?:import|export)\s[^;]*from\s*['"][^'"]*(?:jspdf|write-excel-file)\.esm\.js['"]/.test(src)) offenders.push(file);
    if (/(?:^|\n)\s*import\s*['"][^'"]*(?:jspdf|write-excel-file)\.esm\.js['"]/.test(src)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
  const src = read('js/recipe-export.js');
  assert.match(src, /import\('\.\/vendor\/jspdf\.esm\.js'\)/);
  assert.match(src, /import\('\.\/vendor\/write-excel-file\.esm\.js'\)/);
});

test('both libraries are precached, so Export works offline', () => {
  const sw = read('sw.js');
  for (const f of VENDOR) assert.ok(sw.includes(`'./${f}'`), `${f} missing from ASSETS`);
});

test('every export word exists in English and Italian, and an Italian one differs where it should', () => {
  const keys = ['button', 'title', 'pdf', 'pdfNote', 'excel', 'excelNote', 'preparing', 'ready', 'download', 'share', 'close',
    'needsConnection', 'failed', 'fileFallback', 'sheetFallback'].map(k => `export.${k}`);
  const d = _dictionaries();
  for (const key of keys) {
    for (const lang of ['en', 'it']) {
      const text = translate(d, lang, key);
      assert.ok(text && text !== key, `${key} missing in ${lang}`);
    }
  }
  assert.equal(translate(d, 'en', 'export.title'), 'Export as');
  assert.equal(translate(d, 'it', 'export.title'), 'Esporta come');
  assert.equal(translate(d, 'it', 'export.preparing'), 'Preparo il file…');
  assert.equal(translate(d, 'en', 'export.needsConnection'), 'Export needs a connection the first time. Connect and try again.');
});

test('only a library that would not load WHILE OFFLINE asks for a connection', () => {
  const lib = { code: 'export/library' };
  assert.equal(exportErrorKey(lib, false), 'export.needsConnection');
  assert.equal(exportErrorKey(lib, true), 'export.failed');
  assert.equal(exportErrorKey(lib), 'export.failed');
  assert.equal(exportErrorKey(new Error('boom'), false), 'export.failed');
  assert.equal(exportErrorKey(null, false), 'export.failed');
});

test('the code that goes into the error report is one of two fixed words', () => {
  assert.equal(exportErrorCode({ code: 'export/library' }), 'library');
  assert.equal(exportErrorCode(new Error('Torta di prova secret')), 'build');
  assert.equal(exportErrorCode(undefined), 'build');
});

test('the title names trays only when the dough IS the trays', () => {
  // [logic, trays, typed total, trays named in the title]
  const cases = [
    ['orders', 3, 0, 0], ['total', 3, 0, 0], ['both', 3, 500, 0], ['both', 3, 0, 0],
    ['trays', 3, 0, 3], ['trays', 3, 500, 3], ['trays', 0, 0, 0], ['trays', 2.9, 0, 2],
    ['traysTotal', 3, 0, 3], ['traysTotal', 3, 500, 0], ['traysTotal', 0, 0, 0], ['traysTotal', '4', '', 4],
    ['trays', NaN, 0, 0], ['trays', -2, 0, 0],
  ];
  for (const [logic, trays, typed, want] of cases) {
    assert.equal(exportTraysFor(logic, trays, typed), want, `${logic} trays=${trays} typed=${typed}`);
  }
});

test('the dialog: Download is a real link, Share is for the PDF only and asks canShare with the file', () => {
  const src = read('js/export-sheet.js');
  assert.match(src, /make\('a', 'app-dialog-btn app-dialog-btn-solid'/);
  assert.match(src, /link\.download = fileName/);
  assert.doesNotMatch(src, /\.click\(\)/, 'a download must be the person\'s own tap');
  assert.match(src, /kind\.id !== 'pdf'\) return null/);
  assert.match(src, /navigator\.canShare\(\{ files: \[file\] \}\)/);
  assert.match(src, /AbortError/);
  assert.match(src, /REVOKE_DELAY_MS = 30000/);
  assert.match(src, /e\.key === 'Escape'/);
  assert.match(src, /e\.key !== 'Tab'/);
  // Words are read when the dialog draws, never when the module loads.
  assert.doesNotMatch(src, /^(?:const|let|var) \w+ = t\(/m);
});

test('the Calculator exports the model the card renders, with the trays only when the dough IS the trays', () => {
  const calc = read('js/calc.js');
  assert.match(calc, /export function exportModelFor\(id\) \{\s*const model = lastRecipe\[id\];\s*if \(!model\) return null;/);
  assert.match(calc, /trays: exportTrays\(recipe\) \}/);
  assert.match(calc, /exportTraysFor\(recipe\.logic, traysFor\(recipe\.id\), totalInputFor\(recipe\.id\)\)/);
  // Unrounded grams are copied from lastRecipe, never recomputed.
  const body = calc.slice(calc.indexOf('export function exportModelFor'), calc.indexOf('export function recipeModelFor'));
  assert.match(body, /grams: r\.grams/);
  assert.doesNotMatch(body, /Math\.round|scaleRecipe|computeRecipeTarget/);
});

test('the result card has a full-width secondary Export button under the copy row, wired to the sheet', () => {
  const render = read('js/calculator-render.js');
  assert.match(render, /class: 'copy-btn export-btn', id: id \+ '-export-btn'/);
  assert.match(render, /el\('span', \{\}, t\('export\.button'\)\)/);
  const start = render.indexOf("el('div', { class: 'copy-row' }");
  const rowEnd = render.indexOf('// Its own full-width line');
  const rowOnly = render.slice(start, rowEnd);
  assert.ok(start > 0 && rowEnd > start && render.indexOf("'-export-btn'") > rowEnd, 'the button sits after the copy row closes');
  assert.doesNotMatch(rowOnly, /export/, 'the copy row is as it was on main');
  const app = read('js/app.js');
  assert.match(app, /openExportSheet\(\{ model, totalLabel: t\('calc\.totalDough'\), opener: exportBtn \}\)/);
  assert.match(app, /exportModelFor\(id\)/);
});
