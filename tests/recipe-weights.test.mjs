// The oven loss, worked out from two weighings instead of typed as a percentage.
//
// ⚠️⚠️ WHAT THESE GUARD IS NOT THE ARITHMETIC — that is in catalogue-model.test.mjs.
// It is the one property nothing on screen can show and no amount of using the app
// reveals: A RECIPE SOMEBODY ONLY OPENS MUST COME OUT OF THE DATABASE UNCHANGED.
//
// Every recipe written before this feature has a stored `lossPct` and no weights. The
// editor leaves the cooked box EMPTY for those and prints the stored percentage under
// it — and if anything wrote a number back, opening a recipe to fix a typo in the flour
// would move the number that decides what every product built on it costs. The split
// between "shown" and "typed by a person" is the whole safety of it.

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
  // `weighed` is false for a recipe nobody has weighed. While it is false the cooked
  // box stays EMPTY and the stored percentage is printed underneath, and neither the
  // percentage nor the weights are assigned.
  assert.match(EDITOR, /if \(!weighed\) \{[\s\S]*?cookedInput\.value = '';/,
    'an unweighed recipe must leave its cooked box empty');
  // Forward from the branch, and proved non-empty — see the note on the null branch
  // below for what an unanchored indexOf() costs.
  const derivedStart = EDITOR.indexOf('if (!weighed) {');
  assert.ok(derivedStart !== -1, 'the unweighed branch must exist to be guarded');
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

test('⚠️ a half-filled pair still shows the percentage the recipe already carries', () => {
  // Typing only the raw weight flips `weighed`, so the screen leaves the branch above
  // and lands on pct === null. Until 24 Aug 2026 that printed «weigh the cooked dough
  // to work it out» OVER a recipe that already had a real stored percentage — true
  // about the boxes, and a lie about the recipe.
  assert.match(EDITOR, /function storedLossText\(pct\) \{[\s\S]*?pct > 0 \? t\('cat\.lossStored'/,
    'a stored percentage above zero is named');
  assert.match(EDITOR, /function storedLossText\(pct\) \{[\s\S]*?: t\('cat\.lossNotYet'\)/,
    '⚠️ and a stored 0 is NOT: the document cannot tell «nobody has said» from '
    + '«measured zero», and printing «loses 0%» is the false one that costs money');
  const nullStart = EDITOR.indexOf('if (pct === null) {');
  const nullBranch = EDITOR.slice(nullStart, EDITOR.indexOf('} else {', nullStart));
  assert.ok(nullBranch.length > 20, 'the slice must actually contain the branch');
  assert.match(nullBranch, /storedLossText\(working\.lossPct\)/,
    'the half-filled branch must go through it too, or it hides a real percentage');

  const dicts = _dictionaries();
  for (const [lang, dict] of Object.entries(dicts)) {
    assert.ok(dict['cat.lossStored'], `cat.lossStored is missing in ${lang}`);
    assert.match(dict['cat.lossStored'], /\{pct\}/, `${lang} must carry the number`);
  }
});

test('⚠️ an unanswered pair leaves the stored loss alone', () => {
  // weightLoss() returns pct: null for an empty or impossible pair, and null is NOT
  // zero: zero would declare «this recipe loses nothing».
  assert.match(EDITOR, /if \(pct === null\) \{[\s\S]*?storedLossText\(working\.lossPct\)/,
    'a null percentage must say so rather than being stored — and storedLossText is '
    + 'what decides whether «so» is «0%» or «nobody has weighed it»');
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

test('⚠️ the ingredient name keeps its autocomplete, however tight the row gets', () => {
  // ⚠️⚠️ 17px OF THAT BOX BELONGS TO THE DATALIST PICKER, and the tempting way to win
  // it back is to drop `list=`. Measured on the real screen: removing the attribute in
  // the debugger takes the input's reported content from 115px to 98 and un-truncates
  // «Strong flour» at 320px. It would also take away the suggestion list that makes an
  // ingredient name match the one Orders knows — which is what links a row to a price
  // and to an allergen. Four CSS ways of hiding the indicator were tried on the live
  // element and all four changed nothing, so the space is simply not for sale.
  assert.match(EDITOR, /list: 'cat-ingredient-names'/,
    'the name field must keep its datalist: 17px of width is not worth an ingredient '
    + 'nobody can link');
  assert.match(read('catalogue.css'), /17px OF THIS BOX IS SPENT ON A BUTTON/,
    'and the reason it is not reclaimed stays written down where the width is decided, '
    + 'or the next person measures it all over again');
});

test('⚠️ «no price yet» under an ingredient row is a key, not English', () => {
  // Seen on a SCREENSHOT of an Italian venue, under an Italian heading:
  // «→ Farina 0 · Brava Fresh · no price yet». The key has existed in both languages
  // all along and ingredient-picker.js has always used it.
  // ⚠️ NO GUARD COULD SEE IT: nothing-stays-english skips an all-lowercase string with
  // no punctuation, because that is exactly the shape of a CSS class list.
  assert.ok(!/'no price yet'/.test(EDITOR), 'the editor must not write the English out');
  assert.match(EDITOR, /rate === null \? t\('cat\.noPriceYet'\)/,
    'it asks the dictionary, like its sibling ingredient-picker.js always has');
  assert.match(codeOf(read('js/catalogue/ingredient-picker.js')), /t\('cat\.noPriceYet'\)/,
    'and the sibling still does, so the two screens cannot disagree');
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
