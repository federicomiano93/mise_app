// ingredient-kind.test.mjs — food or packaging, and the card that files it.
//
// Federico, 13 Sep 2026: «la sezione imballaggio … deve aprire una lista che corrisponde ad
// imballaggi che è una sezione che deve essere aggiunta in fornitori ed ingredienti».

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPackaging, kindOf, INGREDIENT_KINDS } from '../js/ingredient-kind.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('only a literal «packaging» is packaging — absent, junk and «ingredient» are food', () => {
  assert.equal(isPackaging({ kind: 'packaging' }), true);
  for (const item of [{}, { kind: 'ingredient' }, { kind: 'Packaging' }, { kind: null }, { kind: 1 }, null, undefined, 'packaging']) {
    assert.equal(isPackaging(item), false, JSON.stringify(item));
  }
  assert.equal(kindOf({ kind: 'packaging' }), 'packaging');
  assert.equal(kindOf({}), 'ingredient', 'every item written before packaging existed is food');
  assert.deepEqual([...INGREDIENT_KINDS], ['ingredient', 'packaging']);
});

test('the rules accept exactly the same two values', () => {
  const rules = read('firestore.rules');
  const block = rules.slice(rules.indexOf('match /ingredients/{id}'), rules.indexOf('allow delete', rules.indexOf('match /ingredients/{id}')));
  assert.match(block, /request\.resource\.data\.kind in \['ingredient', 'packaging'\]/);
  assert.match(block, /'category', 'unit', 'active', 'kind',/, 'and `kind` is a known key');
});

test('⚠️⚠️ the card files the kind, and packaging neither shows nor WRITES allergens', () => {
  const form = codeOf(read('js/ingredient-record-form.js'));
  assert.match(form, /const startKind = item \? kindOf\(item\) : \(presetKind === 'packaging' \? 'packaging' : 'ingredient'\);/,
    'an existing item opens on its own kind; a new one on the list it was added from');
  assert.match(form, /kind: kindSelect\.value,/, 'the kind travels with the save');
  assert.match(form, /\.\.\.\(isBox\(\) \? \{\} : allergens\.read\(\)\),/,
    '⚠️ not reading the allergens for packaging is what keeps a declaration safe through a wrong filing: the merge never touches it');
  assert.match(form, /const syncKind = \(\) => \{ allergens\.root\.hidden = isBox\(\); \};/, 'hidden, never removed');
  assert.match(form, /priceBlock\(item, actions, startKind === 'packaging' \? 'pcs' : null\)/, 'a new box is priced by the piece');
});

test('the Catalogue never offers packaging to a recipe row, and Food cost keeps the two apart', () => {
  assert.match(codeOf(read('js/catalogue/catalogue-model.js')), /ing\.kind !== 'packaging'/);
  const main = codeOf(read('js/foodcost/foodcost-main.js'));
  assert.match(main, /import \{ isPackaging \} from '\.\.\/ingredient-kind\.js';/);
});
