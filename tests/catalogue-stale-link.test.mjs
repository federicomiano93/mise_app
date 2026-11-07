// catalogue-stale-link.test.mjs — a linked row whose name was retyped says so (7 Nov 2026).
//
// Federico: «quando cambio ingrediente il prezzo non si aggiorna». Retyping the name of a linked
// row left its link (and so its cost) on the old ingredient, silently. The editor now WARNS on the
// link line; it never unlinks by itself. These tests pin the pure rule and the shape of the wiring.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  labelResemblesLink, staleLinkName, linkedItemNames, normalizeNameForCompare, moveRow, removeRow,
} from '../js/catalogue/catalogue-model.js';
import { t, setLanguage } from '../js/i18n.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const ingredients = {
  f1: { id: 'f1', name: 'Farina 0 Caputo', shortName: 'Farina' },
  b1: { id: 'b1', name: 'Unsalted Butter 250g' },
  t1: { id: 't1', name: 'Crème fraîche', shortName: '' },
};
const recipes = [{ id: 'r1', name: 'Crema pasticcera' }];
const link = (kind, refId) => ({ kind, refId });
const stale = (label, openedLabel, l) => staleLinkName({ label, openedLabel, link: l, ingredients, recipes });

test('resembles: either normalised string contains the other', () => {
  assert.equal(labelResemblesLink('farina', ['Farina 0 Caputo']), true);
  assert.equal(labelResemblesLink('  FARINA  0 ', ['farina 0 caputo']), true);
  assert.equal(labelResemblesLink('Farina 0 Caputo extra', ['Farina']), true);
  assert.equal(labelResemblesLink('Burro', ['Farina 0 Caputo']), false);
});

test('resembles: accents and spacing do not matter', () => {
  assert.equal(labelResemblesLink('creme   fraiche', ['Crème fraîche']), true);
  assert.equal(normalizeNameForCompare('  Crème\t FRAÎCHE '), 'creme fraiche');
});

test('resembles: any of the names counts, an empty typed name never resembles', () => {
  assert.equal(labelResemblesLink('Caputo', ['Farina', 'Farina 0 Caputo']), true);
  assert.equal(labelResemblesLink('', ['Farina']), false);
  assert.equal(labelResemblesLink('Farina', []), false);
});

test('linkedItemNames: display, full and short name of an ingredient; the name of a recipe', () => {
  assert.deepEqual(linkedItemNames(link('ingredient', 'f1'), ingredients, recipes), ['Farina', 'Farina 0 Caputo']);
  assert.deepEqual(linkedItemNames(link('recipe', 'r1'), ingredients, recipes), ['Crema pasticcera']);
  assert.deepEqual(linkedItemNames(link('ingredient', 'gone'), ingredients, recipes), []);
});

test('warns when the retyped name moved to something else, with the linked name to show', () => {
  assert.equal(stale('Burro', 'Farina', link('ingredient', 'f1')), 'Farina');
  assert.equal(stale('Burro', 'Crema pasticcera', link('recipe', 'r1')), 'Crema pasticcera');
});

test('no warning: unlinked, empty, original name typed back, or a name that still resembles', () => {
  assert.equal(stale('Burro', 'Farina', null), '');
  assert.equal(stale('  ', 'Farina', link('ingredient', 'f1')), '');
  assert.equal(stale('farina', 'Farina', link('ingredient', 'f1')), '');
  assert.equal(stale('Farin', 'Farina', link('ingredient', 'f1')), '');
  assert.equal(stale('Caputo', 'Farina', link('ingredient', 'f1')), '');
});

test('no warning on opening: a saved name unlike its link equals its opened label', () => {
  assert.equal(stale('Unsalted butter', 'Unsalted butter', link('ingredient', 'f1')), '');
  assert.equal(stale('Burro', 'Burro', link('ingredient', 'b1')), '');
});

test('no warning when the linked item cannot be named (not loaded, no name)', () => {
  assert.equal(stale('Burro', 'Farina', link('ingredient', 'gone')), '');
});

test('moveRow and removeRow keep the very same row objects (the editor remembers per object)', () => {
  const a = { label: 'a' }, b = { label: 'b' }, c = { label: 'c' };
  const moved = moveRow([a, b, c], 0, 2);
  assert.deepEqual(moved.map(r => r), [b, c, a]);
  assert.ok(moved.every(r => r === a || r === b || r === c));
  const removed = removeRow([a, b, c], 1);
  assert.equal(removed[0], a);
  assert.equal(removed[1], c);
});

test('both dictionaries say it, with the name in the sentence', () => {
  setLanguage('en');
  assert.equal(t('cat.nameChangedStillLinked', { name: 'Flour' }),
    'The name changed, but this row is still linked to “Flour” — tap to change');
  setLanguage('it');
  assert.equal(t('cat.nameChangedStillLinked', { name: 'Farina' }),
    'Il nome è cambiato, ma questa riga è ancora collegata a «Farina» — tocca per cambiare');
  setLanguage('en');
});

test('editor wiring: live in oninput without a rebuild, memory refreshed by a pick, never on the saved row', () => {
  const src = read('js/catalogue/catalogue-editor.js');
  const oninput = src.match(/oninput: \(e\) => \{\s*openedLabelOf\(ing\);[\s\S]*?\n        \},/);
  assert.ok(oninput, 'the name box oninput remembers the opened label first');
  assert.match(oninput[0], /paintStaleLink\(ing, e\.target\)/);
  assert.doesNotMatch(oninput[0], /renderIngredientRows/);
  const linkTo = src.match(/function linkTo\(idx, chosen\) \{[\s\S]*?\n  \}/)[0];
  assert.match(linkTo, /openedLabels\.set\(row,/);
  assert.match(src, /async function createAndLink[\s\S]*?linkTo\(idx,/, 'createAndLink goes through linkTo');
  assert.match(src, /cat-ing-link--stale/);
  assert.match(src, /const openedLabels = new WeakMap\(\)/);
  const clean = src.match(/function cleanWorking\(\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(clean, /openedLabel/, 'the memory never reaches the saved rows');
  // only the text span is rewritten, so the crossed-out euro mark survives
  const paint = src.match(/function paintStaleLink[\s\S]*?\n  \}/)[0];
  assert.match(paint, /text\.textContent/);
  assert.doesNotMatch(paint, /replaceChildren|innerHTML|button\.textContent/);
});

test('the stale style exists in the stylesheet, from tokens only', () => {
  const css = read('catalogue.css');
  const rule = css.match(/\.cat-ing-link\.cat-ing-link--stale \{[^}]*\}/)[0];
  assert.match(rule, /var\(--warn\)/);
  assert.match(rule, /var\(--warn-bg\)/);
  assert.doesNotMatch(rule, /#[0-9a-f]{3,8}/i);
});
