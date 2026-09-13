// link-suggestions.test.mjs — the little list under a recipe row's name.
//
// Federico, 13 Sep 2026: «digito burro subito dopo mi si apre la piccola finestra dove
// scelgo tra i burri che abbiamo a disposizione» — and «il nome dell'ingrediente lo scrivo
// io perché potrebbe essere diverso dall'ingrediente a cui è collegato». So what matters,
// and is pinned: the right things offered in a sensible order, and a tap that links the
// row WITHOUT touching the name somebody typed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { suggestLinks, applyLink, SUGGEST_MIN_CHARS, SUGGEST_LIMIT } from '../js/catalogue/catalogue-model.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const SUPPLIERS = { S1: { name: 'Brava Fresh' }, S2: { name: 'Latteria' } };
const INGREDIENTS = {
  B1: { id: 'B1', name: 'Burro Occelli', weight: '1 kg', supplierId: 'S1' },
  B2: { id: 'B2', name: 'Burro chiarificato', weight: '500 g', supplierId: 'S2' },
  P1: { id: 'P1', name: 'Pasta sfoglia al burro', supplierId: 'S1' },
  F1: { id: 'F1', name: 'Farina 00', supplierId: 'S1' },
  OLD: { id: 'OLD', name: 'Burro vecchio', active: false },
  CR: { id: 'CR', name: 'Crème fraîche', supplierId: 'S2' },
};
const RECIPES = [
  { id: 'R1', name: 'Crema al burro' },
  { id: 'SELF', name: 'Burro montato' },
];
const base = (over = {}) => ({
  ingredients: INGREDIENTS, recipes: RECIPES, suppliers: SUPPLIERS, excludeRecipeId: 'SELF', ...over,
});
const names = result => result.items.map(i => i.name);

test('nothing is offered below two characters', () => {
  assert.equal(SUGGEST_MIN_CHARS, 2);
  for (const query of ['', 'b', ' b ', null, undefined]) {
    assert.deepEqual(suggestLinks(base({ query })), { items: [], total: 0 }, String(query));
  }
  assert.ok(suggestLinks(base({ query: 'bu' })).items.length > 0);
});

test('«burro» offers the butters first, then a product with a butter word, then recipes', () => {
  const out = suggestLinks(base({ query: 'burro' }));
  assert.deepEqual(names(out), [
    'Burro chiarificato', 'Burro Occelli',   // the name starts with it
    'Pasta sfoglia al burro',                // one of its words does
    'Crema al burro',                        // a recipe, after every ingredient
  ]);
  assert.equal(out.total, 4);
});

test('starts-with, then a word that starts with it, then anywhere inside', () => {
  const ingredients = {
    a: { id: 'a', name: 'Insalata' },
    b: { id: 'b', name: 'Olio di semi al sale' },
    c: { id: 'c', name: 'Salmone' },
    d: { id: 'd', name: 'Sale fino' },
  };
  assert.deepEqual(names(suggestLinks({ ingredients, recipes: [], query: 'sal' })),
    ['Sale fino', 'Salmone', 'Olio di semi al sale', 'Insalata']);
});

test('accents and capitals do not matter', () => {
  for (const query of ['creme', 'CRÈME', 'crème fr']) {
    assert.deepEqual(names(suggestLinks(base({ query }))), ['Crème fraîche'], query);
  }
});

test('⚠️ the NAME only — not the supplier, not the pack weight', () => {
  // The full chooser searches those too; a name being typed must not bring up a
  // supplier's whole range.
  assert.deepEqual(suggestLinks(base({ query: 'brava' })).items, []);
  assert.deepEqual(suggestLinks(base({ query: 'latteria' })).items, []);
  assert.deepEqual(suggestLinks(base({ query: '500 g' })).items, []);
});

test('a deactivated ingredient and the recipe being edited are never offered', () => {
  const all = names(suggestLinks(base({ query: 'bu', limit: 50 })));
  assert.ok(!all.includes('Burro vecchio'), 'nobody buys it any more');
  assert.ok(!all.includes('Burro montato'), 'a recipe cannot be made of itself');
});

test('at most five, with the total so the rest can be offered', () => {
  assert.equal(SUGGEST_LIMIT, 5);
  const ingredients = {};
  for (let i = 0; i < 12; i++) ingredients[`X${i}`] = { id: `X${i}`, name: `Zucchero ${i}` };
  const out = suggestLinks({ ingredients, recipes: [], query: 'zucchero' });
  assert.equal(out.items.length, 5);
  assert.equal(out.total, 12);
  assert.equal(suggestLinks({ ingredients, recipes: [], query: 'zucchero', limit: 3 }).items.length, 3);
  assert.equal(suggestLinks({ ingredients, recipes: [], query: 'zucchero', limit: 'junk' }).items.length, 5);
});

test('ingredients come before recipes even when a recipe matches better', () => {
  const out = suggestLinks({
    ingredients: { i: { id: 'i', name: 'Pane al miele' } },
    recipes: [{ id: 'r', name: 'Miele caramellato' }],
    query: 'miele',
  });
  assert.deepEqual(out.items.map(i => i.kind), ['ingredient', 'recipe']);
});

test('each suggestion carries what the screen shows, and a tick on the current link', () => {
  const out = suggestLinks(base({ query: 'burro', linked: { kind: 'ingredient', refId: 'B1' } }));
  const occelli = out.items.find(i => i.refId === 'B1');
  assert.deepEqual(occelli, {
    kind: 'ingredient', refId: 'B1', name: 'Burro Occelli', weight: '1 kg', supplierName: 'Brava Fresh', linked: true,
  });
  assert.equal(out.items.filter(i => i.linked).length, 1, 'only the row\'s own link is ticked');
  assert.equal(suggestLinks(base({ query: 'burro', linked: { kind: 'recipe', refId: 'B1' } }))
    .items.filter(i => i.linked).length, 0, 'the same id of the other kind is not the link');
});

// ── The tap ──────────────────────────────────────────────────────────────────

test('⚠️⚠️ a tap links the row and leaves the typed name exactly as it was', () => {
  const row = { label: 'burro', grams: 250, unit: 'g' };
  applyLink(row, { kind: 'ingredient', refId: 'B1', name: 'Burro Occelli' });
  assert.deepEqual(row, { label: 'burro', grams: 250, unit: 'g', kind: 'ingredient', refId: 'B1' });
});

test('a row with no name at all takes the chosen one', () => {
  for (const label of ['', '   ', undefined]) {
    const row = { label, grams: '', unit: 'g' };
    applyLink(row, { kind: 'recipe', refId: 'R1', name: 'Crema al burro' });
    assert.equal(row.label, 'Crema al burro');
    assert.equal(row.kind, 'recipe');
  }
});

test('null removes the link and keeps the name', () => {
  const row = { label: 'burro', kind: 'ingredient', refId: 'B1' };
  applyLink(row, null);
  assert.deepEqual(row, { label: 'burro' });
});

test('a choice that is not one changes nothing', () => {
  for (const junk of [undefined, {}, { kind: 'supplier', refId: 'S1' }, { kind: 'ingredient', refId: '  ' }]) {
    const row = { label: 'burro', kind: 'ingredient', refId: 'B1' };
    applyLink(row, junk);
    assert.deepEqual(row, { label: 'burro', kind: 'ingredient', refId: 'B1' }, JSON.stringify(junk));
  }
  assert.equal(applyLink(null, { kind: 'ingredient', refId: 'B1' }), null);
});

// ── On the screen ────────────────────────────────────────────────────────────

test('⚠️ the name field has no native suggestion list stacked on top of this one', () => {
  const editor = codeOf(read('js/catalogue/catalogue-editor.js'));
  assert.doesNotMatch(editor, /list: 'cat-ingredient-names'|el\('datalist'/,
    'two lists at once on a phone: the browser\'s own and ours');
  assert.match(editor, /attachLinkSuggestions\(labelInput, \{/, 'the name field carries the suggestion list');
});

test('⚠️ every link in the form goes through applyLink — no second way of writing one', () => {
  const editor = codeOf(read('js/catalogue/catalogue-editor.js'));
  assert.match(editor, /applyLink\(working\.ingredients\[idx\], chosen\)/);
  assert.doesNotMatch(editor, /\.refId\s*=|\.kind\s*=[^=]|\.label\s*=\s*chosen/,
    'a link written by hand here could overwrite a typed name');
});

test('⚠️ the list never chooses by itself, and a tap is not lost to the keyboard', () => {
  const suggest = codeOf(read('js/catalogue/ingredient-suggest.js'));
  assert.match(suggest, /input\.addEventListener\('blur', close\);/, 'leaving the field only closes it');
  assert.match(suggest, /list\.addEventListener\('pointerdown', e => e\.preventDefault\(\)\);/,
    'without it the blur closes the list before the tap lands');
  assert.match(suggest, /e\.key === 'Enter' && active >= 0/, 'Enter chooses only a row the arrows highlighted');
  const onPickCalls = suggest.match(/onPick\(/g) || [];
  assert.equal(onPickCalls.length, 1, 'one way to a link: choose()');
});

test('it is in the precache, or the recipe form breaks offline', () => {
  assert.match(read('sw.js'), /'\.\/js\/catalogue\/ingredient-suggest\.js'/);
});

// Comments stripped before every source check — a guard that fires on its own warning
// comment is a guard people widen. Copied from tests/photo-image-model.test.mjs.
function codeOf(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => { const at = line.indexOf('//'); return at === -1 ? line : line.slice(0, at); })
    .join('\n');
}
