// Delete an ingredient from its card (1 Oct 2026).
//
// Federico: «in questo momento non c'è l'opzione di eliminare un ingrediente».
//
// What can go wrong without anything looking broken: a batch that includes a delete the rules
// refuse (the WHOLE delete fails, the ingredient stays), a bin drawn for somebody who may not
// use it, a card that closes as if it had worked when the delete was refused, and a quantity
// left in the order draft for a product that no longer exists. The flow and the choices are
// pure and run here; what only a screen can show is pinned from the source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deletePlan, draftEntryPath, confirmAndDelete } from '../js/ingredient-edit-model.js';

const read = (name) => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── What the batch deletes ───────────────────────────────────────────────────

test('the batch deletes the ingredient and, only where prices may be written, its price document', () => {
  assert.deepEqual(deletePlan({ id: 'flour', mayPrice: true }), [
    { collection: 'ingredients', id: 'flour' },
    { collection: 'ingredient-prices', id: 'flour' },
  ]);
  assert.deepEqual(deletePlan({ id: 'flour', mayPrice: false }), [
    { collection: 'ingredients', id: 'flour' },
  ], 'a price delete the rules refuse would fail the whole batch, and the ingredient with it');
  assert.deepEqual(deletePlan({ id: 'flour' }), [{ collection: 'ingredients', id: 'flour' }],
    'forgetting to say defaults to the safe side');
});

test('the append-only price history is never in the batch — the rules forbid deleting it', () => {
  for (const mayPrice of [true, false]) {
    const names = deletePlan({ id: 'x', mayPrice }).map(d => d.collection);
    assert.ok(!names.some(n => n.includes('prices/') || n === 'prices'), 'no subcollection');
  }
  const rules = read('firestore.rules');
  const at = rules.indexOf('match /prices/{priceId}');
  const block = rules.slice(at, rules.indexOf('match /', at + 10));
  assert.match(block, /allow update, delete: if false;/, 'and the rule that makes it so is still there');
});

test('the two deletes the batch relies on are still granted by the roles the app mirrors', () => {
  const rules = read('firestore.rules');
  const prices = rules.slice(rules.indexOf('match /ingredient-prices/{id}'), rules.indexOf('match /ingredients/{id}'));
  assert.match(prices, /allow delete: if canManage\(lid, 'foodcost'\);/, 'price delete = canManage + Food cost = mayWritePrices()');
  const ing = rules.slice(rules.indexOf('match /ingredients/{id}'), rules.indexOf('match /prices/{priceId}'));
  assert.match(ing, /allow delete: if canManage\(lid, 'orders'\);/, 'ingredient delete = canManage + Orders');
});

test('the ingredient\'s quantity in the draft is one named field, nothing broader', () => {
  assert.equal(draftEntryPath('flour'), 'entries.flour');
});

// ── The flow ──────────────────────────────────────────────────────────────────

function flow({ answer = true, fails = false } = {}) {
  const log = [];
  const run = () => confirmAndDelete({
    item: { id: 'flour', name: 'Strong flour' },
    ask: async () => { log.push('ask'); return answer; },
    remove: async (id) => { log.push(`remove:${id}`); if (fails) throw new Error('permission-denied'); },
    onStart: () => log.push('start'),
    onDone: () => log.push('done'),
    onFail: (err) => log.push(`fail:${err.message}`),
  });
  return { log, run };
}

test('a confirmed delete removes that ingredient, then closes the card', async () => {
  const { log, run } = flow();
  assert.equal(await run(), true);
  assert.deepEqual(log, ['ask', 'start', 'remove:flour', 'done']);
});

test('⚠️ cancelling the question deletes nothing and locks nothing', async () => {
  const { log, run } = flow({ answer: false });
  assert.equal(await run(), false);
  assert.deepEqual(log, ['ask']);
});

test('⚠️ a refused delete says so, leaves the card open, and never reports success', async () => {
  const { log, run } = flow({ fails: true });
  assert.equal(await run(), false);
  assert.deepEqual(log, ['ask', 'start', 'remove:flour', 'fail:permission-denied']);
  assert.ok(!log.includes('done'));
});

test('a card with no stored ingredient has nothing to delete', async () => {
  let asked = false;
  const ok = await confirmAndDelete({ item: null, ask: async () => { asked = true; return true; }, remove: async () => {} });
  assert.equal(ok, false);
  assert.equal(asked, false);
});

// ── The card, the two screens that open it, and the gate ─────────────────────

const FORM = codeOf(read('js/ingredient-record-form.js'));
const MAIN = codeOf(read('js/orders/orders-main.js'));
const REG_MAIN = codeOf(read('js/orders/registry-main.js'));
const DATA = codeOf(read('js/record-data.js'));

test('the bin is drawn only for an existing item with the action handed in, and asks in danger style', () => {
  assert.match(FORM, /const deleteBtn = item && typeof actions\?\.deleteIngredient === 'function'/);
  const at = FORM.indexOf('const deleteBtn');
  const block = FORM.slice(at, FORM.indexOf('return el(\'div\', { class: \'mgmt-form\' }'));
  assert.match(block, /danger: true,/, 'the question is a danger dialog');
  assert.match(block, /confirmDialog\(\{/, 'the copied dialog, never the browser\'s');
  assert.match(block, /'aria-label': t\('orders\.deleteIngredient'\)/, 'an icon button needs its spoken name');
  assert.match(block, /okLabel: t\('ui\.delete'\)/);
  assert.match(block, /reportFailure\('delete', ingredientDisplayName\(item\), err\)/, 'a failure uses the friendly dialog');
  assert.match(FORM, /formActions\(save, onCancel, deleteBtn\),/);
  assert.doesNotMatch(FORM, /\bcanManage\b|\bcanManageHere\b/, 'the card reads no role — the caller decides');
  assert.match(FORM, /const TRASH_SVG = '<svg[^']*stroke-width="2"[^']*stroke="currentColor"|const TRASH_SVG = '<svg[^']*stroke="currentColor"[^']*stroke-width="2"/,
    'inline SVG, stroked 2px, currentColor');
});

test('the bin sits first in the action row, apart from Cancel and Save', () => {
  const ui = codeOf(read('js/record-ui.js'));
  assert.match(ui, /export function formActions\(saveBtn, onCancel, deleteBtn = null\) \{\s*return el\('div', \{ class: 'mgmt-form-actions' \}, \[\s*deleteBtn,/);
  // The supplier card keeps its two buttons: it passes no third argument.
  assert.doesNotMatch(codeOf(read('js/supplier-record-form.js')), /formActions\([^)]*,[^)]*,/);
});

test('the bin is quiet: danger-red icon, no fill, no border, a 44px target', () => {
  const css = read('orders.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const at = css.indexOf('.mgmt-form-actions .mgmt-delete-btn {');
  assert.ok(at >= 0);
  const rule = css.slice(at, css.indexOf('}', at));
  assert.match(rule, /color:\s*var\(--danger\)/);
  assert.match(rule, /background:\s*transparent/);
  assert.match(rule, /border:\s*0/);
  assert.match(rule, /display:\s*flex/);
  assert.match(rule, /align-items:\s*center/);
  assert.match(rule, /width:\s*44px/);
});

test('Fornitori hands the action in only to an owner or manager, read when each card opens', () => {
  assert.match(REG_MAIN, /get deleteIngredient\(\) \{\s*return canManageHere\(\)\s*\? async \(id\) => \{\s*await deleteIngredientWithPrice\(id, mayWritePrices\(\)\);\s*dropDeletedIngredientFromDraft\(id\);\s*\}\s*: undefined;/,
    'Fornitori also takes the line out of the order draft, after the batch and without awaiting it');
  assert.match(REG_MAIN, /import \{ dropDeletedIngredientFromDraft, freezeUnitInDraft \} from '\.\/draft\.js';/);
  // registry.js spreads the actions object each time it opens a card, which runs the getter then.
  const registry = codeOf(read('js/orders/registry.js'));
  assert.match(registry, /actions: \{ \.\.\.actions, capturePackPhoto,/);
  assert.doesNotMatch(registry, /\bcanManageHere\b|\bcanManage\b/, 'registry.js still gates nothing itself');
});

test('Orders hands the action in only to an owner or manager, and the draft row goes with the ingredient', () => {
  assert.match(MAIN, /\.\.\.\(canManageHere\(\) \? \{ deleteIngredient: deleteIngredientAndDraftRow \} : \{\}\),/);
  const fn = MAIN.slice(MAIN.indexOf('async function deleteIngredientAndDraftRow'), MAIN.indexOf('function openEditIngredient'));
  const del = fn.indexOf('await deleteIngredientWithPrice(id, mayWritePrices());');
  const local = fn.indexOf('delete state.entries[id];');
  const draft = fn.indexOf('dropDeletedIngredientFromDraft(id);');
  assert.ok(del > 0 && local > del && draft > local,
    'delete first; the typed quantity is only touched once the delete landed');
  assert.doesNotMatch(fn, /await dropDeleted|await clearIngredientFromDraft/, 'the card must not wait for the draft clean-up');
  const draftJs = codeOf(read('js/orders/draft.js'));
  assert.match(draftJs, /export function dropDeletedIngredientFromDraft\(ingredientId\) \{\s*clearIngredientFromDraft\(ingredientId\)\.catch\(err => \{\s*console\.error\(/,
    'a failed clean-up is logged, never reported as a failed delete');
  assert.match(draftJs, /export function clearIngredientFromDraft\(ingredientId\) \{\s*const paths = \[draftEntryPath\(ingredientId\)\];\s*return clearFields\(COLLECTIONS\.drafts, DRAFT_ID, paths,/);
  assert.match(draftJs, /forgetKnown\(paths\);/, 'the autosave baseline forgets it too, or it is written straight back');
});

test('one place writes the delete, as a single batch built from the plan', () => {
  assert.match(DATA, /export async function deleteIngredientWithPrice\(id, writePrice = false\)/);
  assert.match(DATA, /deletePlan\(\{ id, mayPrice: writePrice \}\)\.forEach\(/);
  assert.match(DATA, /batch\.delete\(doc\(collection\(db, pathFor\(name\)\), docId\)\);/);
  assert.match(DATA, /await batch\.commit\(\);/);
  assert.match(codeOf(read('js/orders/firebase-orders.js')), /deleteIngredientWithPrice,?\s*\} from '\.\.\/record-data\.js'/);
  assert.doesNotMatch(REG_MAIN, /deleteIngredient: \(id\) => removeDoc/, 'the old single-document delete is gone');
});

test('the words exist in English and Italian', () => {
  const dict = read('js/i18n.js');
  for (const key of ['orders.deleteIngredient', 'orders.deleteIngredientTitle', 'orders.deleteIngredientMessage']) {
    assert.equal(dict.split(`'${key}':`).length - 1, 2, `${key} must be defined once in English and once in Italian`);
  }
  assert.match(dict, /'orders\.deleteIngredientTitle': 'Delete “\{name\}”\?'/);
  assert.match(dict, /'orders\.deleteIngredientTitle': 'Eliminare «\{name\}»\?'/);
  assert.match(dict, /'orders\.deleteIngredientMessage': 'Non si può annullare\. Gli ordini passati lo mostrano ancora; nelle ricette e nel food cost comparirà come ingrediente mancante, e le etichette di quelle ricette restano bloccate finché non lo sostituisci\.'/);
  assert.match(dict, /'orders\.deleteIngredientMessage': 'This cannot be undone\. Past orders still show it; in recipes and food cost it will appear as a missing ingredient, and the labels of those recipes stay blocked until you replace it\.'/);
});
