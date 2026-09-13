// foodcost-from-recipe.test.mjs — a recipe's «Apri nel Food cost», end to end on paper.
//
// Federico, 13 Sep 2026: «aggiungi un tasto nella scheda ricetta che mi porta
// direttamente alla sua scheda food cost corrispondente». His answers, asked before the
// work: no product uses the recipe → a NEW product with it on the first line; several
// do → the list narrowed to them; the button stands where the cost card stood.
//
// What can go wrong unseen, and is therefore pinned: a button shown to somebody the page
// then throws out; a decision taken on a product list that has not arrived; an address
// the service worker cannot find offline; a new product that arrives with invented
// numbers in it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  recipeHash, foodCostHref, recipeHref, recipeIdFromHash, mayOpenFoodCost,
} from '../js/recipe-link.js';
import { productsUsingRecipe, draftFromRecipe, normalizeProduct } from '../js/foodcost/foodcost-model.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// ── The address ──────────────────────────────────────────────────────────────

test('⚠️ the address is a FRAGMENT, so the cached page is found offline', () => {
  // sw.js looks a page up by the exact request; a ?query is part of it, a #fragment is not.
  assert.equal(foodCostHref('abc123'), 'foodcost.html#recipe=abc123');
  assert.equal(recipeHref('abc123'), 'catalogue.html#recipe=abc123');
  assert.ok(!foodCostHref('abc').includes('?'));
});

test('an id survives the trip, whatever it contains', () => {
  for (const id of ['abc123', 'a b&c=d', 'crème#1', 'x'.repeat(200)]) {
    assert.equal(recipeIdFromHash(recipeHash(id)), id);
  }
});

test('anything that is not a usable id reads as no recipe at all', () => {
  for (const hash of ['', '#', '#recipe=', '#other=abc', '#recipe=a/b', `#recipe=${'x'.repeat(201)}`, null, undefined]) {
    assert.equal(recipeIdFromHash(hash), null, String(hash));
  }
  assert.equal(recipeHash(''), '');
  assert.equal(foodCostHref(null), 'foodcost.html', 'no id, no fragment — the plain page');
});

// ── Who is shown the button ─────────────────────────────────────────────────

test('⚠️ the button is offered exactly to whoever the Food cost page lets in', () => {
  const venue = { sections: {} };
  assert.equal(mayOpenFoodCost(venue, true), true, 'an owner or a manager');
  assert.equal(mayOpenFoodCost(venue, false), false,
    'an employee: the Food cost card is hidden from staff until the venue shows it');
  assert.equal(mayOpenFoodCost({ sections: {}, staffShownCards: { foodcost: true } }, false), true,
    'an employee in a venue that chose to show them Food cost');
  assert.equal(mayOpenFoodCost({ sections: { foodcost: false } }, true), false,
    'nobody, in a venue that does not use Food cost at all');
});

test('⚠️ before a venue is open, nobody is shown it', () => {
  // allowedSections() alone would answer «allowed» for a document that is not there.
  for (const loc of [null, undefined, 'bakery']) {
    assert.equal(mayOpenFoodCost(loc, true), false);
  }
  assert.equal(mayOpenFoodCost({ sections: {} }, 'true'), false, 'only a real true is a manager');
});

test('the rule is the auth gate\'s own, section AND card', () => {
  const gate = read('js/auth-gate.js');
  assert.match(gate, /isSectionAllowed\(session\.location, pageSection\)/);
  assert.match(gate, /cardVisibleTo\(session\.location, session\.canManage, pageCard\)/);
  assert.match(read('foodcost.html'), /<body data-section="foodcost" data-card="foodcost">/,
    'the page is judged by the section foodcost and the card foodcost — the two this mirrors');
  const link = codeOf(read('js/recipe-link.js'));
  assert.match(link, /isSectionAllowed\(locationDoc, 'foodcost'\)/);
  assert.match(link, /cardVisibleTo\(locationDoc, canManage === true, 'foodcost'\)/);
});

// ── What Food cost opens ────────────────────────────────────────────────────

const P = (id, ...recipeIds) => ({ id, name: id, components: recipeIds.map(r => ({ recipeId: r, qtyKg: 1 })) });

test('the products using a recipe are found on any of their lines, and handed back as given', () => {
  const brioche = P('Brioche', 'DOUGH');
  const filled = P('Filled brioche', 'CREAM', 'DOUGH');
  const bread = P('Bread', 'BREAD');
  const all = [brioche, filled, bread];
  const found = productsUsingRecipe(all, 'DOUGH');
  assert.deepEqual(found.map(p => p.id), ['Brioche', 'Filled brioche']);
  assert.equal(found[0], brioche, 'the very object the store holds, so it opens that product');
  assert.deepEqual(productsUsingRecipe(all, 'NOTHING'), []);
});

test('junk finds nothing and throws nothing', () => {
  assert.deepEqual(productsUsingRecipe(null, 'DOUGH'), []);
  assert.deepEqual(productsUsingRecipe([null, 7, {}, P('x', 'DOUGH')], ''), []);
  assert.deepEqual(productsUsingRecipe([null, 7, {}, P('x', 'DOUGH')], 'DOUGH').length, 1);
});

test('⚠️ a new product from a recipe carries its name and its line — and no invented number', () => {
  const draft = draftFromRecipe({ id: 'DOUGH', name: '  Brioche dough ', ingredients: [] });
  assert.equal(draft.id, null, 'not saved: it has no id');
  assert.equal(draft.name, 'Brioche dough');
  assert.deepEqual(draft.components, [{ recipeId: 'DOUGH', qtyKg: 0 }]);
  assert.deepEqual(draft.packaging, []);
  for (const key of ['sellingMode', 'piecesPerBatch', 'sellingPrice', 'vatRate', 'foodCostTarget']) {
    assert.equal(draft[key], null, `${key} must be left for a person to say`);
  }
  // The editor normalises what it is handed; the recipe line must survive that with no kilos.
  assert.deepEqual(normalizeProduct(draft).components, [{ recipeId: 'DOUGH', qtyKg: 0 }]);
});

test('no recipe, no new product', () => {
  for (const junk of [null, undefined, {}, { name: 'no id' }, { id: '  ' }]) {
    assert.equal(draftFromRecipe(junk), null);
  }
});

// ── Wired on both sides ─────────────────────────────────────────────────────

test('the recipe screen shows the card only to whoever may open Food cost, first in its host', () => {
  const detail = codeOf(read('js/catalogue/catalogue-detail.js'));
  const panel = detail.slice(detail.indexOf('function foodCostPanel('), detail.indexOf('function foodCostPanel(') + 900);
  assert.ok(panel.length > 100, 'foodCostPanel is gone');
  assert.match(panel, /if \(!app\.mayOpenFoodCost \|\| !app\.mayOpenFoodCost\(\)\) return null;/,
    'asked on every build, before anything is drawn');
  assert.match(panel, /onclick: \(\) => app\.openFoodCost\(recipe\)/);
  const main = codeOf(read('js/catalogue/catalogue-main.js'));
  assert.match(main, /mayOpenFoodCost\(s\.location, s\.canManage\)/);
  assert.match(main, /foodCostHref\(recipe\.id\)/);
});

test('⚠️ the recipe screen asks again when the session arrives', () => {
  // A recipe can be on screen before the venue is open, when nobody may open anything.
  const main = codeOf(read('js/catalogue/catalogue-main.js'));
  const handler = main.slice(main.indexOf('onSession((s) =>'), main.indexOf('onSession((s) =>') + 1200);
  assert.match(handler, /view === 'detail' && activeDetail/, 'an open recipe is rebuilt when the session lands');
});

test('the catalogue opens the recipe the address names, once', () => {
  const main = codeOf(read('js/catalogue/catalogue-main.js'));
  assert.match(main, /recipeIdFromHash\(window\.location\.hash\)/);
  assert.match(main, /history\.replaceState\(/, 'spent once used, or every reload reopens it');
});

test('⚠️⚠️ Food cost decides only once the products can be trusted, and never behind sign-in', () => {
  const main = codeOf(read('js/foodcost/foodcost-main.js'));
  const settle = main.slice(main.indexOf('function settleRecipeLink()'), main.indexOf('function clearAddress()'));
  assert.ok(settle.length > 100, 'settleRecipeLink is gone');
  assert.match(settle, /hasLiveProducts\(\)/, 'it must wait for the products');
  assert.ok(settle.indexOf('recipeLinkDeadlinePassed') < settle.indexOf('productsUsingRecipe('),
    'the wait is checked BEFORE anything is decided');
  assert.match(settle, /productsUsingRecipe\(getProducts\(\), id\)/);
  assert.match(settle, /openProduct\(null, draft\)/, 'none: a new product, from the recipe');
  assert.match(settle, /listFilter = id;/, 'several: the list narrowed to them');
  assert.match(main, /authReady\.then\(\(\) => \{\s*setTimeout\(/,
    'the deadline starts once the venue is open, never while the sign-in screen is up');
});

test('⚠️ Back from the first screen a recipe opened returns to that recipe', () => {
  const main = codeOf(read('js/foodcost/foodcost-main.js'));
  const back = main.slice(main.indexOf('async function handleBack()'), main.indexOf('function toast('));
  assert.ok(back.indexOf('await leaveGuard()') < back.indexOf('recipeHref(fromRecipe)'),
    'unsaved edits are asked about BEFORE leaving for the recipe');
  // ⚠️ replace, never href: an added history entry sends the phone's back gesture forward
  // into Food cost again (found by the code review).
  assert.match(back, /window\.location\.replace\(recipeHref\(fromRecipe\)\);/);
  assert.doesNotMatch(back, /location\.href\s*=/);
  assert.match(main, /renderEditor\(\{ product, draft, app \}\)/);
});

// ── What the code review found ───────────────────────────────────────────────

test('⚠️⚠️ a new product opened too early gives way to the real one — while untouched', () => {
  // On a slow first open the deadline can pass before the products arrive, or the phone's
  // copy can predate a product made elsewhere. Saved, that new product is a DUPLICATE.
  const main = codeOf(read('js/foodcost/foodcost-main.js'));
  const fn = main.slice(main.indexOf('function reconsiderDraft()'), main.indexOf('function clearAddress()'));
  assert.ok(fn.length > 50, 'reconsiderDraft is gone');
  assert.match(fn, /!activeEditor\.isUntouched\(\)/, 'only while nothing has been typed — never over somebody\'s work');
  assert.match(fn, /productsUsingRecipe\(getProducts\(\), id\)/);
  assert.match(main, /if \(reconsiderDraft\(\)\) return;/, 'asked on every data update');
  assert.match(main, /openProduct\(null, draft\); entryEditor = true; draftRecipeId = id;/);
  const editor = codeOf(read('js/foodcost/foodcost-editor.js'));
  assert.match(editor, /isUntouched: \(\) => !touched && !busy,/, 'a Save under way is not untouched');
  assert.match(editor, /const markDirty = \(\) => \{ dirty = true; touched = true; \};/);
});

test('⚠️ Back from Food cost really reopens the recipe, and only once the session knows the role', () => {
  // Deleting either call left every other test green while Back silently landed on the list.
  const main = codeOf(read('js/catalogue/catalogue-main.js'));
  const init = main.slice(main.indexOf('initCatalogue('), main.indexOf('initCatalogue(') + 300);
  assert.match(init, /openWantedRecipe\(\);/, 'recipes arriving later must still open it');
  const handler = main.slice(main.indexOf('onSession((s) =>'), main.indexOf('onLanguageChange('));
  assert.match(handler, /openWantedRecipe\(\);/, 'the session landing must open it');
  const fn = main.slice(main.indexOf('function openWantedRecipe()'), main.indexOf('function forgetWantedRecipe()'));
  const gate = fn.indexOf("currentSession().status !== 'ready'");
  assert.ok(gate !== -1 && gate < fn.indexOf('openDetail('),
    'never before the session: a recipe built then draws no «Elimina ricetta» for its owner');
  assert.match(handler, /activeDetail = renderDetail\(\{ recipe: latest, app \}\);/,
    'a recipe opened before the session is rebuilt WHOLE — its buttons, not only its cards');
  assert.match(main, /sessionReady\.then\(\(\) => setTimeout\(forgetWantedRecipe, WANTED_RECIPE_WAIT_MS\)\)/,
    'the give-up clock starts when the session does, or a slow sign-in forgets the recipe');
});

test('the chooser\'s Back is named in the venue\'s language', () => {
  const picker = codeOf(read('js/catalogue/ingredient-picker.js'));
  assert.doesNotMatch(picker, /'aria-label': 'Back'/);
  assert.match(picker, /'aria-label': t\('ui\.back'\)/);
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
