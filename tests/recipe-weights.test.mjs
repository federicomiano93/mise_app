// The oven loss, worked out from two weighings instead of typed as a percentage.
//
// ⚠️⚠️ WHAT THESE GUARD IS NOT THE ARITHMETIC — that is in catalogue-model.test.mjs.
// It is the one property nothing on screen can show and no amount of using the app
// reveals: A RECIPE SOMEBODY ONLY OPENS MUST COME OUT OF THE DATABASE UNCHANGED.
//
// Every recipe written before this feature has a stored `lossPct` and no weights. The
// editor DERIVES a cooked weight from that percentage so the box is not blank — and if
// anything wrote that derived number back, opening a recipe to fix a typo in the flour
// would move the number that decides what every product built on it costs. The split
// between "derived for display" and "typed by a person" is the whole safety of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
// Comments are where this project explains itself, and they name the very things these
// tests forbid. Judge the CODE.
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const EDITOR = codeOf(read('js/catalogue/catalogue-editor.js'));
const STORE = codeOf(read('js/catalogue/catalogue-store.js'));
const MODEL = codeOf(read('js/catalogue/catalogue-model.js'));
const RULES = read('firestore.rules');

// ── 1. Nothing is written back unless a person typed it ──────────────────────

test('⚠️⚠️ the store writes the weights ONLY when both have real values', () => {
  assert.match(STORE, /if \(rawG > 0 && cookedG > 0\) \{\s*data\.rawGrams = rawG;\s*data\.cookedGrams = cookedG;/,
    'a half-filled pair must write neither: one weight alone cannot make a percentage, '
    + 'and storing it would make the next reader think the recipe had been weighed');
});

test('⚠️ the store still lists every field BY HAND, and now lists these two', () => {
  // Its own comment is the warning: a field the model carries and this list does not
  // is dropped on every save, silently. And a field the rules do not know refuses the
  // WHOLE save with a permission error nothing on screen can explain.
  assert.match(STORE, /const data = \{[\s\S]*?lossPct: normalizeLossPct\(recipe\.lossPct\)/,
    'lossPct is still what the document stores — the weights do not replace it');
  assert.ok(!/\.\.\.recipe/.test(STORE.slice(STORE.indexOf('const data = {'), STORE.indexOf('const id = recipe.id'))),
    'the document must never be built by spreading the recipe: `id` would go with it');
});

test('⚠️⚠️ the editor only recomputes the loss once a PERSON has typed', () => {
  // `weighed` is false for a recipe nobody has weighed. While it is false the screen
  // shows a derived cooked weight and the stored percentage, and assigns neither.
  assert.match(EDITOR, /if \(!weighed\) \{[\s\S]*?cookedFromLossPct\(before, working\.lossPct\)/,
    'an unweighed recipe must DERIVE its cooked box from the stored percentage');
  // Forward from the branch, and proved non-empty — see the note on the null branch
  // below for what an unanchored indexOf() costs.
  const derivedStart = EDITOR.indexOf('if (!weighed) {');
  assert.ok(derivedStart !== -1, 'the derived branch must exist to be guarded');
  const derivedBranch = EDITOR.slice(derivedStart, EDITOR.indexOf('const { pct, problem }', derivedStart));
  assert.ok(derivedBranch.length > 20, 'the slice must actually contain the branch');
  assert.ok(!/working\.lossPct\s*=/.test(derivedBranch),
    'and that branch must never ASSIGN lossPct — deriving a number and writing it back '
    + 'is how opening a recipe would silently change what it costs');
  assert.ok(!/working\.(raw|cooked)Grams\s*=/.test(derivedBranch),
    'nor may it invent the weights it is only displaying');
  assert.match(EDITOR, /weighed = true;/,
    'typing in either box is what flips it');
});

test('⚠️ an unanswered pair leaves the stored loss alone', () => {
  // weightLoss() returns pct: null for an empty or impossible pair, and null is NOT
  // zero: zero would declare «this recipe loses nothing».
  assert.match(EDITOR, /if \(pct === null\) \{[\s\S]*?t\('cat\.lossNotYet'\)/,
    'a null percentage must say so rather than being stored');
  // ⚠️ SEARCH FORWARD FROM THE BRANCH, NOT FROM THE TOP OF THE FILE. The first draft
  // used indexOf('} else {') with no offset, which found an earlier one, produced an
  // EMPTY slice and passed on anything. A mutation is what exposed it: the suite going
  // red is not the same as this guard firing.
  const nullStart = EDITOR.indexOf('if (pct === null) {');
  assert.ok(nullStart !== -1, 'the null branch must exist to be guarded');
  const nullBranch = EDITOR.slice(nullStart, EDITOR.indexOf('} else {', nullStart));
  assert.ok(nullBranch.length > 20, 'the slice must actually contain the branch');
  assert.ok(!/working\.lossPct\s*=/.test(nullBranch),
    'and it must not write anything into lossPct');
});

test('the raw box follows the recipe total until somebody overrides it', () => {
  assert.match(EDITOR, /if \(!rawTyped\) \{[\s\S]*?working\.rawGrams = total;/,
    'untyped, it mirrors the live total');
  assert.match(EDITOR, /rawTyped = String\(e\.target\.value\)\.trim\(\) !== '';/,
    'clearing the box hands it back to the total — the way out of an override');
  assert.match(EDITOR, /countEl\.textContent = String\(working\.ingredients\.length\);\s*refreshLoss\(\);/,
    'and it is refreshed from updateTotal(), the one function that already runs on '
    + 'every keystroke');
});

// ── 2. The cap that keeps the cost per kilo finite ───────────────────────────

test('⚠️⚠️ every route to lossPct still goes through the 99 cap', () => {
  assert.match(MODEL, /const pct = normalizeLossPct\(exact\);/,
    'weightLoss must cap like every other route: a stored 100 divides the price per '
    + 'kilo by zero and makes every product built on the recipe cost Infinity');
  assert.match(MODEL, /problem: exact > MAX_LOSS_PCT \? 'capped' : null/,
    'and the screen has to admit the cap rather than quietly storing something other '
    + 'than what was typed');
});

test('the model refuses a cooked weight heavier than the raw one', () => {
  assert.match(MODEL, /if \(after > before\) return \{ pct: null, problem: 'cookedHeavier' \};/,
    'nothing gains weight in an oven, and answering 0 would turn a typo into '
    + '«this recipe loses nothing»');
});

// ── 3. The database will actually accept it ──────────────────────────────────

test('⚠️⚠️ the rules whitelist carries both new keys', () => {
  // A recipe carries a CLOSED key list. One key the rules do not know refuses the
  // WHOLE save — not just the field — with a permission error nothing explains.
  const block = RULES.slice(RULES.indexOf('match /recipes/{id}'), RULES.indexOf('match /recipes/{id}') + 3000);
  assert.match(block, /hasOnly\(\['bakery', 'name', 'ingredients', 'lossPct', 'steps', 'endNote',\s*'rawGrams', 'cookedGrams'\]\)/,
    'both weights must be in the recipe whitelist');
  for (const key of ['rawGrams', 'cookedGrams']) {
    assert.match(block, new RegExp(`!\\('${key}' in request\\.resource\\.data\\)`),
      `${key} must be OPTIONAL: rules reach every phone the instant they deploy while `
      + 'code arrives one device at a time, so a phone on the old build sends neither '
      + 'and must keep saving');
    assert.match(block, new RegExp(`request\\.resource\\.data\\.${key} is number`),
      `${key} must still be type-checked when it IS sent`);
  }
});

test('⚠️ the photo reader still may not invent either key', () => {
  // Its own comment already carries the rule; this pins the code. A key it added would
  // make every save of that recipe fail.
  const photo = codeOf(read('functions/recipe-photo-model.js'));
  for (const key of ['rawGrams', 'cookedGrams', 'lossPct']) {
    assert.ok(!photo.includes(key), `the reader must never set ${key}`);
  }
});

// ── 4. The screen stopped asking for a percentage ────────────────────────────

test('the percentage input is gone, and its dictionary keys with it', () => {
  assert.ok(!EDITOR.includes('catRecipeLoss'),
    'the percentage box is replaced by the two weighings');
  const i18n = codeOf(read('js/i18n.js'));
  for (const dead of ['cat.weightLostWhileCooking', 'cat.leaveAt0If']) {
    assert.ok(!i18n.includes(dead), `${dead} was retired — remove it, do not leave it`);
    assert.ok(!EDITOR.includes(dead), `and the editor must not still ask for ${dead}`);
  }
  for (const key of ['cat.rawDoughWeight', 'cat.cookedDoughWeight', 'cat.lossIs']) {
    assert.ok(EDITOR.includes(key), `the editor must use ${key}`);
  }
});

// ── 5. The row: one frame around the amount and its unit ─────────────────────

test('⚠️ the amount and the unit sit in ONE wrapper, and the total matches it', () => {
  assert.match(EDITOR, /el\('div', \{ class: 'cat-amount' \}, \[gramsInput, unitSelect\]\)/,
    'one frame around both — two separate ones cost ~24px and truncate the ingredient '
    + 'name at 320px');
  assert.match(EDITOR, /class: 'cat-amount cat-amount--plain'/,
    'the Total shares the row grid, so it needs the same cell shape or «Totale 8380 g» '
    + 'stops lining up with the column of numbers it is the sum of');
  const css = read('catalogue.css');
  assert.match(css, /\.cat-amount \{[\s\S]*?border: 1\.5px solid var\(--cat-border\)/,
    'the frame reuses the border this file already defines, not a new one');
  assert.match(css, /\.cat-amount:focus-within \{ border-color: var\(--cat-accent\); \}/,
    'colour only — the row already draws a ring and :has() cannot suppress it');
  assert.ok(!/\.cat-amount:focus-within \{[^}]*box-shadow/.test(css),
    'a second ring inside the first would be noise');
});

test('the cache version moved, or no phone will ever fetch any of this', () => {
  const sw = read('sw.js');
  const m = sw.match(/CACHE_NAME = 'theitalianclub-v(\d+)'/);
  assert.ok(m, 'sw.js must name a cache version');
  assert.ok(Number(m[1]) >= 330, `still on v${m[1]} — a changed cached file without a bump `
    + 'is the one failure in this project that does not self-heal');
});
