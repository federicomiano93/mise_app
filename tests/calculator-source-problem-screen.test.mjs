// A linked Calculator tab that cannot be calculated says WHY, on the tab itself.
//
// ⚠️ THE DEFECT (Panificio Miano, 30 Oct 2026: «Le ricette nel calcolatore non funzionano»):
// calc.js refused a linked tab whose Ricettario recipe could not be weighed — correctly — but
// said nothing. The total was typed, no ingredient appeared, no sentence either; the reason
// came out only after Confirm and a day, in a dialog. The tab read as broken.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRecipe, showsSourceProblem, PROBLEMS } from '../js/calculator-recipe-source.js';
import { installDom, Node, walk } from './helpers/form-dom.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');

const LINKED = { id: 'r1', name: 'Focaccia', logic: 'total', catalogueId: 'cat-1' };
const book = rows => ({ 'cat-1': { name: 'Focaccia', ingredients: rows } });
const FLOUR = { rid: 'a', label: 'Farina', grams: 1000, unit: 'g' };

test('a linked tab whose recipe cannot be weighed shows its problem', () => {
  const resolved = resolveRecipe(LINKED, book([FLOUR, { rid: 'b', label: 'Olio', unit: 'to taste' }]));
  assert.equal(resolved.problem, PROBLEMS.unweighable);
  assert.equal(showsSourceProblem(LINKED, resolved, false), true);
});

test('an empty or deleted Ricettario recipe shows its problem too', () => {
  assert.equal(showsSourceProblem(LINKED, resolveRecipe(LINKED, book([])), false), true);
  assert.equal(showsSourceProblem(LINKED, resolveRecipe(LINKED, {}), false), true);
});

test('a recipe still on its way says nothing yet (not «it is gone»)', () => {
  assert.equal(showsSourceProblem(LINKED, resolveRecipe(LINKED, {}), true), false);
});

test('a tab that calculates, or one with its own ingredients, shows nothing', () => {
  assert.equal(showsSourceProblem(LINKED, resolveRecipe(LINKED, book([FLOUR])), false), false);
  const own = { id: 'r2', name: 'Pane', logic: 'total', ingredients: [] };
  assert.equal(showsSourceProblem(own, resolveRecipe(own, {}), false), false);
  assert.equal(showsSourceProblem(null, null, false), false);
});

test('every panel carries the problem line FIRST, hidden, a polite status', async () => {
  installDom();
  const make = globalThis.document.createElement;
  globalThis.document.createElement = tag => { const n = make(tag); n.style.setProperty = (k, v) => { n.style[k] = v; }; return n; };
  globalThis.document.createElementNS = (ns, tag) => new Node(tag);
  try {
    const { buildRecipePanel } = await import('../js/calculator-render.js');
    for (const logic of ['orders', 'total', 'both', 'trays', 'traysTotal']) {
      const panel = buildRecipePanel({ ...LINKED, logic, trayWeight: 1000 });
      const nodes = walk(panel);
      const box = nodes.find(n => n.getAttribute?.('id') === 'r1-source-problem');
      assert.ok(box, `${logic}: the problem line is drawn`);
      assert.equal(box.hidden, true, `${logic}: hidden until there is a problem`);
      assert.equal(box.getAttribute('role'), 'status', logic);
      assert.ok(box.className.split(' ').includes('cp-source-problem'), `${logic}: the warning look of Settings`);
      // First: under a long list of client orders it would be off-screen, the tab silent again.
      assert.equal(panel.children[0], box, `${logic}: the first thing in the panel`);
    }
  } finally {
    delete globalThis.document;
  }
});

test('calc.js paints the problem before it gives up on a zero total', () => {
  const src = read('js/calc.js');
  const paint = src.indexOf('paintSourceProblem(id, recipe, source)');
  const zero = src.indexOf('if (target <= 0)');
  assert.ok(paint > 0, 'calc.js paints the problem line');
  assert.ok(paint < zero, 'before the empty-total early return, so it shows before anything is typed');
  assert.match(src, /showsSourceProblem\(recipe, source, isStillLoading\(recipe\)\)/);
  assert.match(src, /problemMessage\(source\)/);
  assert.match(src, /if \(box\.textContent !== text\) box\.textContent = text;/, 'written only when it changes');
});

test('a tab that cannot be calculated closes its result card (no empty list under an old total)', () => {
  const src = read('js/calc.js');
  const refuse = src.slice(src.indexOf('if (!canCalculate(source)) {'));
  const body = refuse.slice(0, refuse.indexOf('return;'));
  assert.match(body, /hideResult\(resultId\)/);
});
