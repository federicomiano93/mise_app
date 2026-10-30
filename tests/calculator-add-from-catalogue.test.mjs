// Panificio Miano, 29 Oct 2026: «controlla aggiungi una ricetta nel calcolatore, mi chiede di
// aggiungere una ricetta nuova». The Calculator's «+ Add recipe» opened a blank recipe to type
// out — the Recipe catalogue could only be reached through «Where the ingredients come from»,
// the second field of that blank form, and choosing there left the name empty. «+ Add recipe»
// now opens a choice first: the Recipe catalogue's recipes, or a new one written here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogueChoices } from '../js/calculator-recipe-source.js';
import { _dictionaries, translate } from '../js/i18n.js';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('the choice lists every Recipe catalogue recipe by name, marking those already in the calculator', () => {
  const catalogue = [
    { id: 'c3', name: 'Rame di Napoli' }, { id: 'c1', name: 'pane di Miano' },
    { id: 'c2', name: 'Focaccia' }, { id: 'c4', name: 'Brioche' },
  ];
  const calc = [
    { id: 'r-1', name: 'Focaccia', catalogueId: 'c2' },   // linked
    { id: 'cat-c4', name: 'Brioche' },                    // imported from the Recipe catalogue
    { id: 'r-2', name: 'Own bread', ingredients: [] },    // its own
  ];
  assert.deepEqual(catalogueChoices(catalogue, calc), [
    { id: 'c4', name: 'Brioche', used: true },
    { id: 'c2', name: 'Focaccia', used: true },
    { id: 'c1', name: 'pane di Miano', used: false },
    { id: 'c3', name: 'Rame di Napoli', used: false },
  ]);
});

test('junk never reaches the list; an unnamed recipe sorts last and is still offered', () => {
  assert.deepEqual(catalogueChoices(null, null), []);
  assert.deepEqual(catalogueChoices([null, {}, { name: 'no id' }, { id: 'x', name: '  ' }, { id: 'y', name: 'Pane' }], [null]),
    [{ id: 'y', name: 'Pane', used: false }, { id: 'x', name: '', used: false }]);
});

test('«+ Add recipe» opens the choice; a catalogue recipe is linked, named, and made «from a total»', () => {
  const src = read('js/recipes.js');
  // The add button no longer creates a blank recipe straight away.
  assert.match(src, /add\.addEventListener\('click', async \(\) => \{[\s\S]*?choosingSource = true;[\s\S]*?renderEditor\(\);\s*\}\);/);
  assert.match(src, /if \(choosingSource\) renderSourceChooser\(\);/);
  assert.match(src, /catalogueChoices\(catalogueList, recipes\(\)\)/);
  // Picking one links it through the same link() as the source box (row ids stamped first),
  // and only a link that worked adds the recipe.
  assert.match(src, /const r = \{ \.\.\.newRecipe\(addHidden\), logic: 'total' \};\s*if \(!\(await link\(r, catalogueId\)\)\) return;/);
  // link() names a recipe that has no name yet — the source box too.
  assert.match(src, /if \(isBlank\(recipe\.name\)\) recipe\.name = String\(source\.name \|\| ''\)\.trim\(\);/);
  // Back from the choice goes to the list, one level up.
  assert.match(src, /if \(choosingSource\) \{ choosingSource = false; renderEditor\(\); return; \}/);
});

test('the choice speaks both languages', () => {
  const d = _dictionaries();
  for (const key of ['calc.addFrom.intro', 'calc.addFrom.blank', 'calc.addFrom.catalogue', 'calc.addFrom.used',
    'calc.addFrom.loading', 'calc.addFrom.none', 'calc.addFrom.failed']) {
    assert.ok(d.en[key] && d.it[key], key);
    assert.match(read('js/recipes.js'), new RegExp(`t\\('${key.replace(/\./g, '\\.')}'\\)`), key);
  }
  assert.equal(translate(d, 'it', 'calc.addFrom.blank'), '+ Ricetta nuova, scritta qui');
  assert.equal(translate(d, 'it', 'calc.addFrom.catalogue'), 'Dal Ricettario');
});
