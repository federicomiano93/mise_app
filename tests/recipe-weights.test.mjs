// The oven loss, worked out from two weighings instead of typed as a percentage.
//
// ⚠️⚠️ WHAT THESE GUARD IS NOT THE ARITHMETIC — that is in catalogue-model.test.mjs,
// and the two-state rules of the boxes are RUN in foodcost-weighing.test.mjs. It is
// the one property nothing on screen can show: A RECIPE SOMEBODY ONLY OPENS MUST COME
// OUT OF THE DATABASE UNCHANGED.
//
// ⚠️ SINCE 13 SEP 2026 THE TWO BOXES ARE NOT IN THE RECIPE EDITOR. Federico: «togli dalla
// scheda ricetta il peso crudo e cotto e aggiungilo nella scheda del food cost» — typed
// on a product's recipe line, stored on the recipe exactly as before.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { _dictionaries } from '../js/i18n.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
// Comments are where this project explains itself, and they name the very things these
// tests forbid. Judge the CODE.
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const EDITOR = codeOf(read('js/catalogue/catalogue-editor.js'));
const STORE = codeOf(read('js/catalogue/catalogue-store.js'));
const MODEL = codeOf(read('js/catalogue/catalogue-model.js'));
const FC_EDITOR = codeOf(read('js/foodcost/foodcost-editor.js'));
const FC_DATA = codeOf(read('js/foodcost/firebase-foodcost.js'));
const RULES = read('firestore.rules');

// The `match /recipes/{id}` block, to its real end.
//
// ⚠️ NOT A FIXED NUMBER OF CHARACTERS. Both tests below used to slice 3000 characters
// from the start of the block, and the day the whitelist gained a comment the slice
// stopped short of the field validations — so the assertions failed about rules that
// were perfectly correct. An instrument measured in characters goes wrong the moment
// somebody explains something.
function recipesRules() {
  const start = RULES.indexOf('match /recipes/{id}');
  const next = RULES.indexOf('match /', start + 10);
  return RULES.slice(start, next === -1 ? RULES.length : next);
}

// ── 1. Nothing is written back unless a person typed it ──────────────────────

// The catalogue's save, from the object it builds to the write it makes.
function storeSave() {
  const start = STORE.indexOf('export function saveRecipe(');
  assert.notEqual(start, -1, 'saveRecipe must exist to be guarded');
  const end = STORE.indexOf('saveRecipeDoc(id, data)', start);
  assert.notEqual(end, -1, 'and it must still write through saveRecipeDoc');
  return STORE.slice(start, end);
}

test('⚠️⚠️ the catalogue no longer writes the loss, so it cannot undo a weighing typed in Food cost', () => {
  // saveRecipeDoc MERGES. A recipe opened in the catalogue BEFORE somebody weighed it
  // in Food cost, and saved AFTER, would put the stale copy's loss back if this object
  // carried it — and nobody would ever see the number change back.
  const save = storeSave();
  const data = save.slice(save.indexOf('const data = {'), save.indexOf('const id = recipe.id'));
  assert.ok(data.length > 20, 'the slice must actually contain the document');
  for (const key of ['lossPct', 'rawGrams', 'cookedGrams']) {
    assert.ok(!data.includes(key), `the catalogue's document must not carry ${key}`);
  }
  assert.match(save, /\['lossPct', 'rawGrams', 'cookedGrams'\]\.forEach\(k => \{ if \(prev\[k\] !== undefined\) kept\[k\] = prev\[k\]; \}\);/,
    'and the list on screen keeps the loss it had, rather than dropping it until the next snapshot');
  assert.match(save, /upsertLocal\(\{ \.\.\.kept, id, \.\.\.data \}\)/);
});

test('⚠️ the store still lists every field BY HAND', () => {
  // Its own comment is the warning: a field the rules do not know refuses the WHOLE save
  // with a permission error nothing on screen can explain.
  const save = storeSave();
  assert.ok(!/\.\.\.recipe/.test(save.slice(save.indexOf('const data = {'), save.indexOf('const id = recipe.id'))),
    'the document must never be built by spreading the recipe: `id` would go with it');
});

test('⚠️⚠️ the catalogue store WRITES the label fields the editor lets you type', () => {
  // Found 13 Sep 2026: the editor had net weight and shelf life boxes, the rules
  // accepted both, the label read both — and this document never carried them, so
  // every Save threw away what had just been typed.
  const save = storeSave();
  const data = save.slice(save.indexOf('const data = {'), save.indexOf('const id = recipe.id'));
  assert.match(data, /\.\.\.labelFieldsOf\(recipe\),/, 'the document must carry the label fields');
  for (const key of ['netWeightG', 'shelfLifeDays']) {
    assert.ok(EDITOR.includes(`working.${key}`), `the editor still edits ${key} (else this guard is about nothing)`);
  }
});

test('⚠️ an emptied label box is REMOVED from the document, not left behind by the merge', () => {
  const data = codeOf(read('js/catalogue/firebase-catalogue.js'));
  assert.match(data, /const CLEARABLE_RECIPE_FIELDS = \['netWeightG', 'shelfLifeDays'\];/);
  assert.match(data, /if \(key in out && out\[key\] === null\) out\[key\] = deleteField\(\);/,
    'a null must travel as deleteField(): the rules refuse a stored null');
  assert.match(data, /setDoc\(doc\(db, pathFor\(RECIPES\), id\), withBakery\(out\), \{ merge: true \}\)/,
    'and the write must send the converted object, not the original');
});

test('labelFieldsOf: a number, or null for «nobody has said» — never 0 for a shelf life nobody typed', async () => {
  const { labelFieldsOf } = await import('../js/catalogue/catalogue-model.js');
  assert.deepEqual(labelFieldsOf({ netWeightG: 250, shelfLifeDays: 3 }), { netWeightG: 250, shelfLifeDays: 3 });
  assert.deepEqual(labelFieldsOf({ netWeightG: '250', shelfLifeDays: '0' }), { netWeightG: 250, shelfLifeDays: 0 },
    'a shelf life of 0 is a real answer («today») and must be kept');
  assert.deepEqual(labelFieldsOf({}), { netWeightG: null, shelfLifeDays: null });
  assert.deepEqual(labelFieldsOf({ netWeightG: 0, shelfLifeDays: '' }), { netWeightG: null, shelfLifeDays: null },
    'an emptied box is a removal');
  assert.deepEqual(labelFieldsOf({ netWeightG: -5, shelfLifeDays: true }), { netWeightG: null, shelfLifeDays: null },
    'junk is not a number of grams or days');
  assert.deepEqual(labelFieldsOf(null), { netWeightG: null, shelfLifeDays: null });
});

test('⚠️ the recipe editor no longer asks for the two weighings, nor touches the loss', () => {
  for (const gone of ['catRecipeRaw', 'catRecipeCooked', 'weightLoss', 'refreshLoss', 'MAX_LOSS_PCT']) {
    assert.ok(!EDITOR.includes(gone), `${gone} left the recipe editor with the boxes`);
  }
  assert.ok(!/(lossPct|rawGrams|cookedGrams)\s*[:=]/.test(EDITOR),
    'nothing in the recipe editor may set the loss any more — not even carried on a draft, '
    + 'because the catalogue store no longer writes it and a value here would only mislead');
});

test('⚠️⚠️ the Food cost product is where they are typed, and Save hands them over', () => {
  assert.match(FC_EDITOR, /box\(t\('fc\.rawDough'\), typeRaw\)/, 'the raw box types through the pure model');
  assert.match(FC_EDITOR, /box\(t\('fc\.cookedDough'\), typeCooked\)/, 'and so does the cooked one');
  assert.match(FC_EDITOR, /const patches = weighingPatches\(app\.tables\(\)\.recipes, weighings,\s*clean\.components\.map\(c => c\.recipeId\)\);/,
    'Save asks the model which recipes to write — only those on the product, only real changes');
  assert.match(FC_EDITOR, /app\.saveProduct\(clean, snapshot, patches\);/);
  assert.match(FC_EDITOR, /const result = costProduct\(working, liveTables\(\)\);/,
    'the answer at the top is worked out WITH the weighing being typed, not after Save');
});

test('⚠️⚠️ saving a product really hands every weighing to the database', () => {
  // Found by the code review: every other guard here sits in the editor or in the write
  // itself, so deleting the one line that connects them left the suite green — the
  // screen showed the new cost, Save recorded a margin point with it, and the recipe
  // never received the loss.
  const store = codeOf(read('js/foodcost/foodcost-store.js'));
  const at = store.indexOf('export function saveProduct(');
  assert.notEqual(at, -1, 'saveProduct must exist to be guarded');
  const save = store.slice(at, store.indexOf('\n}', at));
  assert.match(save, /saveRecipeLosses\(lossPatches\);/, 'the product save must write the weighings');
  const lossAt = store.indexOf('function saveRecipeLosses(');
  assert.notEqual(lossAt, -1, 'saveRecipeLosses must exist to be guarded');
  const losses = store.slice(lossAt, store.indexOf('export function deleteProduct', lossAt));
  assert.match(losses, /for \(const \[id, patch\] of Object\.entries\(patches \|\| \{\}\)\)/, 'one write per recipe');
  assert.match(losses, /saveRecipeLoss\(id, patch\)\.catch\(/, 'each one reaches the data layer');
  assert.match(losses, /restoreAfterRefusal\(recipes\[id\], prev, patch\)/,
    'a refusal goes back through the rule the tests run');
  assert.match(losses, /onSyncError\(t\('fc\.couldNotSaveLoss'/, 'and is said out loud');
});

test('⚠️ no weighing boxes where the database would refuse their Save', () => {
  assert.match(FC_EDITOR, /if \(!id \|\| !app\.tables\(\)\.recipes\[id\] \|\| !app\.canWeigh\(\)\) return null;/,
    'a venue with the catalogue off can READ its recipes in Food cost but not write them');
  assert.match(FC_DATA, /export function canWriteRecipes\(\) \{\s*return currentSession\(\)\.sections\?\.catalogue === true;/,
    'the catalogue section, as the session narrowed it — the same default as the rules');
  assert.match(codeOf(read('js/foodcost/foodcost-main.js')), /canWeigh: canWriteRecipes,/);
});

test('⚠️⚠️ Food cost writes three fields and the stamp onto the recipe, never the whole of it', () => {
  const at = FC_DATA.indexOf('export async function saveRecipeLoss(');
  assert.notEqual(at, -1, 'saveRecipeLoss must exist to be guarded');
  const body = FC_DATA.slice(at, FC_DATA.indexOf('\n}', at));
  assert.match(body, /updateDoc\(doc\(db, pathFor\(RECIPES\), id\), withBakery\(\{\s*lossPct: patch\.lossPct,\s*rawGrams: patch\.rawGrams,\s*cookedGrams: patch\.cookedGrams,\s*\}\)\)/,
    'updateDoc, so a deleted recipe fails instead of coming back nameless; three fields, so '
    + 'the catalogue\'s name, rows and steps are never written from a stale copy');
  assert.ok(!/setDoc/.test(body), 'not a setDoc');
});

// ⚠️⚠️ REPO-WIDE, NOT FILE-SCOPED, AND THAT IS THE POINT. Deleting a call satisfies
// every «is it shaped right?» check by having nothing left to check — the v1.68.0
// lesson, four mutations over. This asks the opposite question: is it GONE, everywhere.
test('⚠️⚠️ nothing derives a cooked weight from a stored percentage, anywhere', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(dir, root), { withFileTypes: true })) {
      if (entry.isDirectory()) { walk(`${dir}${entry.name}/`); continue; }
      if (!entry.name.endsWith('.js')) continue;
      // ⚠️ codeOf(), NOT read(). catalogue-model.js carries a comment that names this
      // function to say it must never come back — and a check that reads comments would
      // fail on the very note explaining why it is gone. Same family as the v1.64.0 live
      // check that grepped a whole file for `allergensCheckedAt` and found the sentence
      // saying it is never written.
      if (codeOf(read(`${dir}${entry.name}`)).includes('cookedFromLossPct')) {
        offenders.push(`${dir}${entry.name}`);
      }
    }
  };
  walk('js/');
  assert.deepEqual(offenders, [],
    'cookedFromLossPct returned the RAW total whenever lossPct was 0 — which is every '
    + 'recipe written before the two weighings existed — so the cooked box showed a '
    + 'number identical to the raw one and read as «weighed, and it loses nothing»');
});

test('⚠️ the sentences the boxes speak exist in both languages, with their numbers', () => {
  // The rules that pick them are RUN in foodcost-weighing.test.mjs; this makes sure what
  // they pick is there to be said, number and all.
  const dicts = _dictionaries();
  for (const [lang, dict] of Object.entries(dicts)) {
    for (const key of ['fc.rawDough', 'fc.cookedDough', 'fc.lossNotYet', 'fc.lossCookedHeavier']) {
      assert.ok(dict[key], `${key} is missing in ${lang}`);
    }
    for (const key of ['fc.lossIs', 'fc.lossStored']) {
      assert.match(dict[key], /\{pct\}/, `${key} in ${lang} must carry the number`);
    }
    assert.match(dict['fc.lossCapped'], /\{max\}/, `fc.lossCapped in ${lang} must carry the cap`);
    assert.match(dict['fc.couldNotSaveLoss'], /\{name\}/, `fc.couldNotSaveLoss in ${lang} must name the recipe`);
    for (const form of ['one', 'other']) {
      assert.match(dict['fc.lossSharedWith'][form], /\{n\}/, `fc.lossSharedWith.${form} in ${lang}`);
    }
  }
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
  const block = recipesRules();
  // ⚠️ THE TWO KEYS, NOT THE WHOLE LIST. This used to pin the whitelist character for
  // character and broke the day a later release added two more fields to it — a red
  // test about something that was perfectly correct. What this test is named for is
  // that the WEIGHINGS are in the list; the list itself is allowed to grow.
  const hasOnly = block.slice(block.indexOf('hasOnly(['), block.indexOf('])', block.indexOf('hasOnly([')));
  for (const key of ['bakery', 'name', 'ingredients', 'lossPct', 'rawGrams', 'cookedGrams']) {
    assert.ok(hasOnly.includes(`'${key}'`), `${key} must be in the recipe whitelist`);
  }
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

test('the percentage input is gone, and the recipe editor\'s dictionary keys with it', () => {
  assert.ok(!EDITOR.includes('catRecipeLoss'),
    'the percentage box is replaced by the two weighings');
  const i18n = codeOf(read('js/i18n.js'));
  for (const dead of ['cat.weightLostWhileCooking', 'cat.leaveAt0If',
    // Moved to fc.* with the boxes on 13 Sep 2026, not copied: two names for one sentence
    // is how the two drift apart.
    'cat.rawDoughWeight', 'cat.cookedDoughWeight', 'cat.lossIs', 'cat.lossNotYet',
    'cat.lossStored', 'cat.lossCookedHeavier', 'cat.lossCapped']) {
    assert.ok(!i18n.includes(`'${dead}'`), `${dead} was retired — remove it, do not leave it`);
    assert.ok(!EDITOR.includes(dead), `and the editor must not still ask for ${dead}`);
  }
  const weighing = codeOf(read('js/foodcost/foodcost-weighing.js'));
  for (const key of ['fc.lossIs', 'fc.lossStored', 'fc.lossNotYet', 'fc.lossCookedHeavier', 'fc.lossCapped']) {
    assert.ok(weighing.includes(`'${key}'`), `the weighing model must speak ${key}`);
  }
});

// ── 5. The row: two frames, one row, and the width to do it was bought ───────

// ⚠️⚠️ THE BODY OF ONE RULE, AND NOTHING PAST ITS CLOSING BRACE. Written after two
// guards in this very file survived a mutation: `/\.sel \{[\s\S]*?border: 1.5px/` is
// non-greedy, so when the declaration is deleted it simply keeps scanning into the NEXT
// rule and finds the same words there. catalogue.css has four other `appearance` lines
// and dozens of `border: 1.5px solid var(--cat-border)`. Same family as the v1.66.0
// slice that used indexOf() with no offset: a check that cannot fail is worse than none.
function ruleBody(source, selector) {
  // ⚠️ NORMALISED TO LF FIRST. This tree is mixed: sw.js is CRLF, files written this
  // month are LF, and a multi-line selector written with \n matches nothing in a CRLF
  // file — silently, which is how probes in this project have "passed" while touching
  // nothing at all.
  const css = source.split('\r\n').join('\n');
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `the rule «${selector}» must exist to be guarded`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  assert.notEqual(close, -1, `the rule «${selector}» is not closed`);
  const body = css.slice(open + 1, close);
  assert.ok(body.trim().length > 5, `the slice for «${selector}» must not be empty`);
  return body;
}

test('⚠️ the amount and the unit are two framed cells, and the total matches them', () => {
  assert.match(EDITOR, /el\('div', \{ class: 'cat-amount' \}, \[\s*gramsInput,[\s\S]*?class: 'cat-unit-cell' \}, \[\s*unitSelect,/,
    'the unit gets a cell of its own, because that cell is what carries its frame '
    + 'and positions the chevron');
  assert.match(EDITOR, /class: 'cat-amount cat-amount--plain'/,
    'the Total shares the row grid, so it needs the same cell shape or «Totale 8380 g» '
    + 'stops lining up with the column of numbers it is the sum of');

  const css = read('catalogue.css');
  assert.match(ruleBody(css, '.cat-ing-editrow .cat-amount .cat-grm,\n.cat-ing-editrow .cat-amount .cat-unit-cell'),
    /border: 1\.5px solid var\(--cat-border\)/,
    'both frames reuse the border this file already defines, not a new one');
  assert.match(css, /\.cat-amount--plain > \* \{ border: 1\.5px solid transparent; \}/,
    '⚠️ the Total keeps the SAME frame, invisible, so its number stays in the column '
    + 'of numbers by construction rather than by two paddings agreeing');
  assert.ok(!/\.cat-amount:focus-within \{[^}]*box-shadow/.test(css),
    'a second ring inside the first would be noise');
});

test('⚠️⚠️ the native dropdown arrow is stripped, and the room it took is given back', () => {
  const css = read('catalogue.css');
  const unit = ruleBody(css, '.cat-ing-editrow .cat-amount .cat-unit');
  assert.match(unit, /appearance: none;/,
    'Chromium reserves ~16px for its own arrow, and that width is what pays for the '
    + 'second frame — v1.66.0 refused two frames on a measurement taken WITH it there');
  assert.match(unit, /padding-right: 11px;/,
    '⚠️ the chevron needs its room reserved: a <select> runs its longest option under '
    + 'anything overlapping it WITHOUT reporting an overflow («to tast», v1.66.0)');
  // ⚠️ SCOPED, NOT POSITIONAL. The Total row reuses .cat-amount with a plain <span> in
  // the unit slot; a chevron anchored by child position would grow an arrow there and
  // shift the column of numbers.
  assert.match(css, /\.cat-unit-chev \{[\s\S]*?position: absolute;/,
    'the chevron is positioned inside the unit cell');
  assert.ok(!/\.cat-amount\s*>\s*:(nth-child|last-child)/.test(css),
    'nothing on this row may be selected by its position among its siblings');
  assert.match(EDITOR, /class: 'cat-unit-chev', 'aria-hidden': 'true'/,
    'it is decoration — a screen reader already announces the select');

  // ⚠️ 44px ON THE FIELDS THEMSELVES. min-height on a frame sizes the BORDER box, so
  // the tappable child comes out short — measured at 42px on the first draft of this
  // very change, which is the same trap v1.66.0 recorded and then fell into again.
  assert.match(unit, /min-height: 44px;/,
    'the select itself must clear the tap floor, not the cell around it');
  assert.match(ruleBody(css, '.cat-ing-editrow .cat-amount .cat-grm'),
    /padding: 10px 8px 10px 5px;/,
    'and the amount box keeps its own padding in one declaration');
});

test('⚠️ no <select> in this app strips its arrow without drawing one', () => {
  // foodcost.css stripped `appearance` and reserved 30px for a background-image that
  // was never set — those selects have had NO arrow at all on a live screen. Found
  // while doing the same thing deliberately here; a reserved gap with nothing in it is
  // the CSS version of a guard that guards nothing.
  for (const sheet of ['catalogue.css', 'foodcost.css', 'style.css', 'orders.css', 'order.css']) {
    const css = read(sheet);
    if (!/appearance:\s*none/.test(css)) continue;
    assert.ok(!/background-repeat:\s*no-repeat;\s*background-position:[^;]*;\s*\}/.test(css),
      `${sheet} positions a background image it never sets — 30px of reserved room and `
      + 'no arrow in it');
  }
});

test('the cache version moved, or no phone will ever fetch any of this', () => {
  const sw = read('sw.js');
  const m = sw.match(/CACHE_NAME = 'theitalianclub-v(\d+)'/);
  assert.ok(m, 'sw.js must name a cache version');
  assert.ok(Number(m[1]) >= 330, `still on v${m[1]} — a changed cached file without a bump `
    + 'is the one failure in this project that does not self-heal');
});

// ── 6. The unit box is the SMALLER of the two, and «to taste» carries no number ──

// Federico, 24 Aug 2026, looking at the row on his phone: «la casella dei g può essere
// anche più piccola della quantità, non serve che sia più grande addirittura».
//
// ⚠️⚠️ IT COULD NOT BE, AND THE REASON IS ONE WORD. The unit column was the wider of
// the two because the longest of the twelve labels — «to taste» — had to fit beside a
// number, and a <select> clips its longest option WITHOUT reporting an overflow
// (v1.66.0, «to tast»). The way out was not a smaller font or a shorter word: it was
// that the model has ALWAYS said a «to taste» row has no quantity — scaleRecipe()
// returns null for that unit and for no other — and only this editor still drew a «0».

const cssNumber = (body, name) => {
  const m = new RegExp(`${name}:\\s*([\\d.]+)rem`).exec(body);
  assert.ok(m, `${name} must be declared as a rem value on .cat-amount`);
  return Number(m[1]);
};

test('⚠️ the unit column is NARROWER than the amount column', () => {
  const body = ruleBody(read('catalogue.css'), '.cat-amount');
  const qty = cssNumber(body, '--qty-w');
  const unit = cssNumber(body, '--unit-w');
  assert.ok(qty > unit, `the amount box must be the wider of the two — found ${qty}rem `
    + `against ${unit}rem, which is the thing Federico asked to change`);
  // ⚠️ AND THE UNIT COLUMN HAS A FLOOR, MEASURED IN THE REAL FONT ON THE REAL SCREEN:
  // «pinch» is 36.92px at 14.4px Manrope, and the cell spends 18px before any text
  // (5px padding + 2px frame + the 11px the chevron sits in). Below that the longest
  // label that still shares a row with a number starts being clipped — in silence,
  // which is the whole danger.
  assert.ok(unit * 16 - 18 >= 36.92, `${unit}rem leaves ${(unit * 16 - 18).toFixed(2)}px `
    + 'for «pinch», which needs 36.92 — and a <select> clips without saying so');
  assert.match(body, /grid-template-columns: var\(--qty-w\) var\(--unit-w\)/,
    'the two columns must READ the two names, or the numbers above guard nothing');
});

test('⚠️⚠️ a «to taste» row is one cell exactly as wide as the two it replaces', () => {
  const css = read('catalogue.css');
  const noqty = ruleBody(css, '.cat-amount--noqty');
  // The width is DERIVED, never a third number kept in step by hand — the shape of the
  // v1.66.0 defect where the Total drifted 2px because one padding said 8 and the
  // other 6. If the block ever stopped matching, the bin and the right-hand edge would
  // zig-zag from row to row and the Total would leave the column of numbers it sums.
  assert.match(noqty, /calc\(var\(--qty-w\) \+ var\(--unit-w\) \+ (\d+)px\)/,
    'the single column must be computed from the same two names plus the gap');
  const gapInCalc = /\+ (\d+)px\)/.exec(noqty)[1];
  const gap = /gap:\s*(\d+)px/.exec(ruleBody(css, '.cat-amount'))[1];
  assert.equal(gapInCalc, gap,
    'and the gap it adds back must be the gap the two columns actually leave between them');
});

test('⚠️⚠️ the number box is hidden for «to taste» and for nothing else', () => {
  // ⚠️ THROUGH unitOf(), NOT ing.unit. Every recipe written before units existed has no
  // unit field at all, and unitOf() answers «g» for those — reading ing.unit directly
  // would compare undefined and quietly work, until a row carried a value nobody expected.
  assert.match(EDITOR, /const noQty = unitOf\(ing\) === 'to taste';/,
    'the one unit the model itself treats as having no quantity, asked for by name');
  assert.match(EDITOR, /gramsInput\.hidden = noQty;/, 'the box goes');
  assert.match(EDITOR, /amountCell\.classList\.toggle\('cat-amount--noqty', noQty\)/,
    'and the cell beside it takes the room');

  // ⚠️ HIDDEN, NEVER CLEARED. Switching to «to taste» and back must give the number
  // back; nothing counts it meanwhile, because ingredientGrams() is 0 for every unit
  // that is not weighable. A paint that wrote to the value would destroy real data on
  // a mis-tap, and the screen would look exactly the same either way.
  const at = EDITOR.indexOf('function paintAmount()');
  assert.notEqual(at, -1, 'paintAmount must exist to be guarded');
  const close = EDITOR.indexOf('\n      }', at);
  assert.notEqual(close, -1, 'paintAmount must be closed');
  const bodyOfPaint = EDITOR.slice(at, close);
  assert.ok(bodyOfPaint.length > 60, 'the slice for paintAmount must not be empty');
  assert.ok(!/ing\.grams\s*=/.test(bodyOfPaint) && !/\.value\s*=/.test(bodyOfPaint),
    'painting the row must never write to the amount it is hiding');

  // ⚠️ TWICE, AND BOTH ARE NEEDED. Called only on change, a row that ARRIVES as «to
  // taste» keeps its meaningless 0; called only at build, changing the unit does
  // nothing until the screen is redrawn.
  // ⚠️ NAMED ONE BY ONE, NOT COUNTED. A count of «paintAmount()» is satisfied by the
  // DEFINITION plus a single call — `function paintAmount() {` contains the very string
  // being counted — so removing the build call would have left the count at 2 and this
  // guard green. The same shape as every other count that guards nothing.
  assert.match(EDITOR, /ing\.unit = e\.target\.value; paintAmount\(\);/,
    'on change it must run AFTER the new unit has been stored, or it reads the old one');
  // ⚠️ \s* ON BOTH SIDES: this tree is CRLF, so a bare \n after the `;` matches nothing.
  assert.match(EDITOR, /\n\s*paintAmount\(\);\s*\n/,
    'and once when the row is BUILT, or a row that arrives as «to taste» keeps its '
    + 'meaningless 0 until somebody happens to change the unit');
});

test('⚠️ an Italian warning that used to finish in English', () => {
  // Live on main until 24 Aug 2026: «Sono 175 kg of dough — 10× la ricetta come è
  // scritta (17,5 kg). Check the amount before calculating.» Three fragments glued
  // together, two of them keys and two of them raw English.
  assert.ok(!/of dough|Check the amount before calculating/.test(MODEL),
    'no English may be concatenated onto a translated sentence');
  const i18n = codeOf(read('js/i18n.js'));
  for (const dead of ["'cat.thatIs'", "'cat.theRecipeAsWritten'"]) {
    assert.ok(!i18n.includes(dead),
      `${dead} is a FRAGMENT key — it was retired, not mended: a translator handed `
      + '«That is » has nothing to translate, and those words sit on the other side of '
      + 'the number in some languages');
  }
  assert.match(MODEL, /t\('cat\.batchWarningVsRecipe', \{[\s\S]{0,140}weight:/,
    'one key carries the whole sentence, with the numbers as holes in it');
  const en = _dictionaries().en;
  const it = _dictionaries().it;
  for (const key of ['cat.batchWarning', 'cat.batchWarningVsRecipe']) {
    assert.ok(en[key] && it[key], `${key} must exist in both languages`);
    assert.ok(!/of dough/.test(it[key]), `${key} in Italian must not carry English`);
  }
  for (const hole of ['{weight}', '{times}', '{base}']) {
    assert.ok(en['cat.batchWarningVsRecipe'].includes(hole)
      && it['cat.batchWarningVsRecipe'].includes(hole),
    `both languages must keep the ${hole} hole, or the number vanishes from one of them`);
  }
});

test('⚠️ the ingredient name carries the catalogue\'s suggestion list, not the browser\'s', () => {
  // Until 13 Sep 2026 the field carried a native <datalist> of names used in other
  // recipes, and this test forbade removing it, believing it was what linked a row to a
  // price and an allergen. It never linked anything: it filled in text. Federico then
  // asked for a list that DOES link (tests/link-suggestions.test.mjs); two lists at once
  // cannot work on a phone, so the datalist went — and with it the 17px picker button
  // Chrome reserves inside every input[list], which no CSS could reclaim.
  assert.doesNotMatch(EDITOR, /list: 'cat-ingredient-names'/, 'the native list is back on the name field');
  assert.match(EDITOR, /attachLinkSuggestions\(labelInput,/, 'and the field has the linking list instead');
  assert.match(read('catalogue.css'), /THE 17px CHROME RESERVED/,
    'the width it gave back stays written down where the width is decided');
});

test('⚠️ a linked row and the chooser show no price, and name a sub-recipe in the dictionary', () => {
  // Until 13 Sep 2026 both printed «£x / kg» or «no price yet» — and once, on an Italian
  // venue, the English words. Federico took money off the catalogue: a cost is read in
  // Food cost, where the oven loss and the rest of the product are known.
  const picker = codeOf(read('js/catalogue/ingredient-picker.js'));
  for (const [name, src] of [['the editor', EDITOR], ['the chooser', picker]]) {
    assert.ok(!/noPriceYet|no price yet|\/ kg`/.test(src), `${name} prints no price`);
  }
  // ⚠️ «· recipe» was English written into the link line; nothing-stays-english skips an
  // all-lowercase word with no punctuation, so no guard could see it.
  assert.ok(!/·\s+recipe`/.test(EDITOR), 'the sub-recipe word must come from the dictionary');
  assert.match(EDITOR, /\$\{t\('cat\.recipe'\)\}/);
});

// ── The two fields a FULL label needs ────────────────────────────────────────
//
// ⚠️ Added with the full-label work. They live in this file because they are the
// same shape as the two weighings above and fail the same way: a key the rules do
// not know refuses the WHOLE save, not just the field.

test('⚠️⚠️ the net weight and the shelf life are in the whitelist, and optional', () => {
  const block = recipesRules();
  const hasOnly = block.slice(block.indexOf('hasOnly(['), block.indexOf('])', block.indexOf('hasOnly([')));
  // ⚠️ PLAIN STRING COMPARISON, NOT A BUILT REGEX. The first version built the
  // pattern from a template literal and the backslashes did not survive being
  // written to disk — `\(` inside a template literal is just `(`, which opened a
  // capture group instead of matching a bracket, so the check was quietly asking for
  // something the rules never say. It failed loudly, which is luck; the same slip in
  // a doesNotMatch would have passed for ever.
  for (const key of ['netWeightG', 'shelfLifeDays']) {
    assert.ok(hasOnly.includes(`'${key}'`), `${key} must be in the recipe whitelist`);
    assert.ok(block.includes(`!('${key}' in request.resource.data)`),
      `${key} must be OPTIONAL in both directions, like every field here`);
    assert.ok(block.includes(`request.resource.data.${key} is number`),
      `${key} must be typed as a number by the rules, not only by the app`);
  }
  // ⚠️ TEN YEARS. A mistyped phone number would otherwise become a shelf life.
  assert.match(block, /shelfLifeDays <= 3650/);
});

test('⚠️⚠️ a recipe with no shelf life stays WITHOUT one — absent is not zero', async () => {
  // Zero days means «today». Printing today's date as a use-by on food that keeps
  // for a week is a safety statement nobody made, so a missing value must survive
  // every round trip as missing.
  const { normalizeCatalogueRecipe, normalizeShelfLifeDays } = await import('../js/catalogue/catalogue-model.js');
  const bare = normalizeCatalogueRecipe({ id: 'r', name: 'Bread', ingredients: [] });
  assert.ok(!('shelfLifeDays' in bare), 'a recipe nobody has told must not gain the key');
  assert.ok(!('netWeightG' in bare), 'nor a weight nobody weighed');

  assert.equal(normalizeShelfLifeDays(undefined), null);
  assert.equal(normalizeShelfLifeDays(null), null);
  assert.equal(normalizeShelfLifeDays(''), null);
  assert.equal(normalizeShelfLifeDays('   '), null);
  // ⚠️ A BOOLEAN IS NOT A NUMBER OF DAYS: Number(true) is 1.
  assert.equal(normalizeShelfLifeDays(true), null);
  assert.equal(normalizeShelfLifeDays(-1), null);
  assert.equal(normalizeShelfLifeDays(99999), null);
  // But a real zero, typed on purpose, is «today» and is kept.
  assert.equal(normalizeShelfLifeDays(0), 0);
  assert.equal(normalizeShelfLifeDays('7'), 7);
  assert.equal(normalizeCatalogueRecipe({ id: 'r', name: 'B', ingredients: [], shelfLifeDays: 0 }).shelfLifeDays, 0);
});

test('⚠️ the two label fields appear only for a venue that prints them', () => {
  // A control that changes nothing is one somebody sets wrongly and then trusts —
  // the same rule the printer resolution follows.
  const src = readFileSync(new URL('../js/catalogue/catalogue-editor.js', import.meta.url), 'utf8');
  assert.match(src, /const wantsWeight = labelProfile\.showWeight === true/);
  assert.match(src, /const wantsShelfLife = labelProfile\.showDate === true/);
  assert.match(src, /labelField\.hidden = !wantsWeight && !wantsShelfLife/);
});
