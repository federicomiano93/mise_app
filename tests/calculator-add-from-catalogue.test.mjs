// Panificio Miano, 29 Oct 2026: «controlla aggiungi una ricetta nel calcolatore, mi chiede di
// aggiungere una ricetta nuova». The Calculator's «+ Add recipe» opened a blank recipe to type
// out — the Recipe catalogue could only be reached through «Where the ingredients come from»,
// the second field of that blank form, and choosing there left the name empty. «+ Add recipe»
// now opens a choice first: the Recipe catalogue's recipes, or a new one written here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogueChoices, rowsToStamp } from '../js/calculator-recipe-source.js';
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
  assert.match(src, /const r = \{ \.\.\.newRecipe\(addHidden\), logic: 'total' \};\s*let failed = null;\s*const linked = await link\(r, catalogueId, \{ quiet: true, onFail/);
  assert.match(src, /if \(linked\) \{ openAdded\(r\); return; \}/);
  // link() names a recipe that has no name yet — the source box too.
  assert.match(src, /if \(isBlank\(recipe\.name\)\) recipe\.name = String\(source\.name \|\| ''\)\.trim\(\);/);
  // A recipe just chosen is not watched until Save: the editor shows the listed copy instead of
  // «cannot be read from the Recipe catalogue», in the ingredients and in the leavening box.
  assert.match(src, /if \(live\.problem !== 'missing' \|\| !catalogueList\) return live;/);
  assert.match(src, /return source \? resolveRecipe\(recipe, \{ \[source\.id\]: source \}\) : live;/);
  assert.match(src, /const resolved = editorRecipe\(r\);/);
  assert.match(src, /const src = editorRecipe\(recipe\);/);
  assert.equal(src.match(/effectiveRecipe\(/g).length, 1, 'only editorRecipe asks the live link');
  // Back from the choice goes to the list, one level up (or to the empty Calculator it came from).
  assert.match(src, /if \(choosingSource\) \{\s*leaveChooser\(\);[\s\S]*?renderEditor\(\);\s*contentEl\(\)/);
});

test('the choice speaks both languages', () => {
  const d = _dictionaries();
  for (const key of ['calc.addFrom.intro', 'calc.addFrom.blank', 'calc.addFrom.catalogue', 'calc.addFrom.used',
    'calc.addFrom.loading', 'calc.addFrom.none', 'calc.addFrom.failed', 'calc.addFrom.linking']) {
    assert.ok(d.en[key] && d.it[key], key);
    assert.match(read('js/recipes.js'), new RegExp(`t\\('${key.replace(/\./g, '\\.')}'\\)`), key);
  }
  assert.equal(translate(d, 'it', 'calc.addFrom.blank'), '+ Ricetta nuova, scritta qui');
  assert.equal(translate(d, 'it', 'calc.addFrom.catalogue'), 'Dal Ricettario');
});

// ── The code review, 30 Oct 2026 ────────────────────────────────────────────────────────
test('linking writes the Recipe catalogue only where a row lacks its id — never a copy read earlier', () => {
  const kept = [{ rid: 'a', label: 'Farina', grams: 1000 }, { rid: 'b', label: 'Acqua', grams: 650 }];
  assert.equal(rowsToStamp(kept), null, 'every row has its id: nothing to write');
  const old = [{ label: 'Farina', grams: 1000 }, { rid: 'b', label: 'Acqua', grams: 650 }];
  const stamped = rowsToStamp(old);
  assert.equal(stamped.length, 2);
  assert.ok(stamped[0].rid && stamped[0].rid !== 'b');
  assert.equal(stamped[1], old[1], 'a row that had its id is the same row');
  assert.equal(rowsToStamp(null), null);
  // The write is a transaction on the recipe as the server holds it NOW.
  for (const f of ['js/firebase.js', 'js/firebase.example.js']) {
    const src = read(f);
    assert.match(src, /export function stampRecipeRowIds\(id, stamp\) \{\s*return authReady\.then\(\(\) => runTransaction\(db, async \(tx\) => \{/, f);
    assert.match(src, /const stamped = stamp\(rows\);\s*if \(!stamped\) return rows;\s*tx\.set\(ref, \{ ingredients: stamped \}, \{ merge: true \}\);/, f);
    assert.match(src, /if \(!snap\.exists\(\)\) return null;/, f);
  }
  const recipes = read('js/recipes.js');
  assert.match(recipes, /stampRecipeRowIds\(catalogueId, rowsToStamp\)/);
  assert.match(recipes, /setTimeout\(\(\) => reject\(new Error\('link timed out'\)\), LINK_TIMEOUT_MS\)/);
  assert.match(recipes, /if \(rows === null\) return fail\('calc\.sourceMissing'\);/);
  assert.match(recipes, /return fail\('calc\.sourceLinkFailed'\);/);
  assert.match(recipes, /if \(onFail\) onFail\(key\); else alertDialog\(t\(key\)\);/);
  assert.match(recipes, /source\.ingredients = rows;/);
});

test('one pick at a time; a pick left behind changes nothing; Back from the empty Calculator goes back there', () => {
  const src = read('js/recipes.js');
  assert.match(src, /const mine = \+\+pickToken;/);
  assert.match(src, /if \(mine !== pickToken\) return;/);
  // A pick being linked holds the whole choice: every button off, a line saying so, and link()
  // neither marks the list as edited nor redraws — the pick decides both when it answers.
  assert.match(src, /link\(r, catalogueId, \{ quiet: true, onFail/);
  assert.match(src, /if \(!quiet\) \{\s*markDirty\(\);\s*renderEditor\(\);\s*\}/);
  assert.match(src, /blank\.disabled = busy;/);
  assert.doesNotMatch(src, /dirty = wasDirty/);
  // Every way out of the choice — and reopening the screen — makes a late answer stale.
  assert.match(src, /function leaveChooser\(\) \{\s*choosingSource = false;\s*pickToken\+\+;\s*addingBusy = false;\s*\}/);
  assert.equal(src.match(/^\s+choosingSource = false;/gm).length, 1, 'only leaveChooser leaves the choice');
  assert.match(src, /freshlyAdded = false;\s*leaveChooser\(\);\s*chooserFromCalculator = false;\s*catalogueGen\+\+;/);
  // The list's own «+ Add recipe»: Back from that choice is the list.
  assert.match(src, /catalogueFailed = false;\s*chooserFromCalculator = false;\s*choosingSource = true;/);
  // A list read from before the screen was reopened is dropped, and redraws nothing.
  assert.match(src, /if \(gen === catalogueGen\) catalogueList = list;/);
  assert.match(src, /if \(gen !== catalogueGen\) return false;/);
  assert.match(src, /loadCatalogue\(\)\.then\(\(\) => \{ if \(gen === catalogueGen && choosingSource && activeRecipe === null\) renderEditor\(\); \}\);/);
});

// ── The third code review, 30 Oct 2026 ──────────────────────────────────────────────────
test('every way out of the choice leaves it, and the waiting choice is drawn as waiting', () => {
  const src = read('js/recipes.js');
  const body = name => {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start !== -1, name);
    const next = src.indexOf('\nfunction ', start + 1);
    const nextAsync = src.indexOf('\nasync function ', start + 1);
    const ends = [next, nextAsync, src.indexOf('\nexport ', start + 1)].filter(i => i !== -1);
    return src.slice(start, Math.min(...ends));
  };
  // Both refused saves, the saved one, the added recipe, Back, reopening the screen.
  assert.equal(body('doSaveRecipes').match(/leaveChooser\(\);/g).length, 3, 'two refused saves and the saved one');
  assert.match(body('openAdded'), /leaveChooser\(\);/);
  assert.match(body('closeRecipes'), /if \(choosingSource\) \{\s*leaveChooser\(\);/);
  assert.match(body('openRecipes'), /leaveChooser\(\);/);
  // The pick draws the waiting choice before it waits.
  assert.match(body('addCatalogueRecipe'), /const mine = \+\+pickToken;\s*renderEditor\(\);/);
  const chooser = body('renderSourceChooser');
  assert.match(chooser, /btn\.disabled = busy;/);
  assert.match(chooser, /blank\.disabled = busy;/);
  assert.match(chooser, /role: 'status', tabindex: '-1' \}, t\('calc\.addFrom\.linking'\)\)/);
  assert.match(chooser, /if \(status\) \{\s*content\.appendChild\(status\);\s*status\.focus\(\);/);
  assert.match(chooser, /if \(!catalogueDenied\) content\.appendChild\(el\('p', \{ class: 'extra-help' \}, t\('calc\.addFrom\.intro'\)\)\);/);
});

test('Save during a pick drops it; a failed pick speaks only if still current, after the redraw', () => {
  const src = read('js/recipes.js');
  // Save drops the pick before its first wait (the confirm), as Back does.
  assert.match(src, /async function doSaveRecipes\(\) \{[\s\S]*?if \(addingBusy\) \{\s*pickToken\+\+;\s*addingBusy = false;\s*renderEditor\(\);\s*\}\s*const invalid = findInvalid\(\);/);
  // The failure message waits for the stale check, and comes after the redraw so its OK
  // gives focus back to the choice instead of the choice taking it from behind the message.
  assert.match(src, /link\(r, catalogueId, \{ quiet: true, onFail: key => \{ failed = key; \} \}\)/);
  assert.match(src, /if \(mine !== pickToken\) return;[\s\S]*?if \(linked\) \{ openAdded\(r\); return; \}[\s\S]*?renderEditor\(\);\s*if \(failed\) alertDialog\(t\(failed\)\);/);
  assert.match(src, /if \(chooserFromCalculator && !dirty\) \{/);
  assert.match(src, /contentEl\(\)\.querySelector\('\.cp-add-client'\)\?\.focus\(\);/);
  // A Recipe catalogue the rules refuse is not «check the connection».
  assert.match(src, /if \(err && err\.code === 'permission-denied'\) catalogueDenied = true;/);
  // The empty Calculator's button opens the choice; «Choose which to show» still the list.
  assert.match(read('js/app.js'), /buildEmptyPanel\(emptyReason, emptyReason === 'no-recipes' \? addRecipe : openRecipes\)/);
});
