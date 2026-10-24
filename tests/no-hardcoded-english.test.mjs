// English written straight into the code, where the dictionary should be.
//
// ⚠️⚠️ THIS FIXES THE CLASS, NOT THE OCCURRENCES — the same reasoning
// tests/english-text.test.mjs states about itself. Seven strings were hard-coded on the
// day this was written; correcting only those leaves the eighth to be written wrong, and
// a literal is invisible in review because it looks exactly like every other string.
//
// WHAT IT COST BEFORE IT EXISTED. Four i18n suites already guard this app — the HTML's
// `data-i18n`, the keys existing, the label/interface separation, the English grammar —
// and **not one of them looks at a literal passed to `text:`**. So on an Italian phone:
//
//   Order · Stock   the labels on EVERY row of EVERY order, the two words read most
//   Management      the title of the Settings screen itself
//   Alerts · Price  two headings inside it
//
// None of that is a style slip. It is the screen somebody works on all day, in the wrong
// language, on the app's own account.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_WORDS } from '../js/i18n.js';

const ROOT = new URL('../js/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// ⚠️ DATA WORDS ARE NOT PHRASES. 'Monday' is a Firestore document id and a stored
// supplier field; translating one is a lockout, not a rename. The list is imported
// rather than copied, so the two can never disagree about what is data.
const SAFE = new Set(DATA_WORDS.map(w => w.toLowerCase()));

// Files that legitimately hold English because they ARE the English: the dictionary
// itself, and the model that builds push text (it carries its own small table because
// the server cannot import the app's).
const EXEMPT = new Set(['i18n.js', 'i18n-dom.js', 'push-model.js']);

// ⚠️⚠️ THE DEBT THIS TEST INHERITED, AND WHY IT IS A LIST RATHER THAN A CLEAN PASS.
// Turning the scan on found 22 more strings beyond the seven it was written for, across
// FIVE features — the Catalogue, Staff, Food Cost, Pastries and the Log. Every one is a
// screen that stays English on an Italian phone.
//
// They are NOT fixed here, and the reason is not laziness:
//   * each needs an Italian translation somebody should actually read, and 22 written in
//     one sitting by the person who also wrote the code is how a half-translated app
//     happens;
//   * at least one is constrained — js/log-model.js is a PURE model, and this project
//     already has a test forbidding label models from importing the interface language,
//     so "wrap it in t()" may be the wrong answer there and needs its own thought.
//
// ⚠️ THE LIST MAY ONLY EVER SHRINK. A new literal is not on it, so it fails. That is the
// whole job: this test exists to stop the twenty-third, not to pretend the twenty-two
// are not there. Delete a line as you fix it; never add one.
// ⚠️ WIDENING THE SCAN ADDS TO THIS LIST ONCE, AND ONLY THE SCAN MAY DO SO. That is
// exactly what happened when it was first switched on (the note above), and again on
// 22 Aug 2026 when `field(` and `message:` were added: four features turned out to be
// asking a confirmation question in English. The four Orders and five records strings
// the same widening found were FIXED rather than listed, because they are in the files
// that PR owned — a debt entry for a file you are already editing is just a dodge.
// ⚠️⚠️ EMPTIED 23 Aug 2026, AND THAT IS THE POINT OF THE RELEASE IT BELONGS TO.
// Fourteen files sat here for a month, each one a screen that stayed English on an
// Italian phone. Federico opened Panificio Miano — his first venue with country IT
// and language it — and said so.
//
// ⚠️ IT MAY ONLY EVER SHRINK, and it is empty now, which means the next literal
// added anywhere in the app fails. Do not put a file back: fix the string.
const KNOWN_DEBT = new Set([]);

function jsFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return jsFiles(full);
    return name.endsWith('.js') && !EXEMPT.has(name) ? [full] : [];
  });
}

// A capitalised word inside a string handed to `text:` — the shape every one of the
// seven had — or handed as the LABEL argument of a helper that builds one.
//
// ⚠️⚠️ THE SECOND SHAPE WAS ADDED AFTER LOOKING AT A SCREENSHOT, and it is the honest
// limit of this test. The first version caught only `text:`, so it passed while the
// Settings panel's own three tabs still read «Suppliers · Ingredients · General» on an
// Italian phone — they are `tabButton('Suppliers', …)`, a literal in an ARGUMENT, which
// the first pattern could not see. Measuring found nothing; looking found it in a second.
//
// 📌 It cannot catch every shape a string can be passed in, and pretending otherwise
// would be worse than saying so: it catches the two that this app actually uses. A third
// shape will be found the same way this one was — by opening the screen in Italian.
const LITERAL = /(?:text:\s*|tabButton\(\s*|okLabel:\s*|cancelLabel:\s*)'([A-Z][a-z][^']*)'/g;

// ⚠️⚠️ THE THIRD AND FOURTH SHAPES, ADDED 21 Aug 2026 — and found exactly the way the
// note above predicted: by opening the screen in Italian and looking at it.
//
//   okLabel: 'Discard'          46 of these, across 22 files. The dialog asked its
//                               question in Italian and offered its answer in English.
//   `All (${n})`                the two filter buttons above every Orders list, and the
//                               hint under every quantity box, assigned to .textContent.
//   text: `Heads up: ${s.name} delivers on ${wd}, but…`   the whole bank-holiday warning.
//
// A template literal needs its interpolations REMOVED before it is judged, or every
// `${result.foodCostPct}%` reads as English because a variable name is capitalised.
// What is left after that is real prose, or nothing.
const TEMPLATE = /(?:text:\s*|textContent\s*=\s*)`([^`]*)`/g;
const prose = (tpl) => tpl.replace(/\$\{[^}]*\}/g, '').trim();

// ⚠️ THE FIFTH SHAPE, AND IT WAS FOUND BY MUTATION TESTING THE OTHER FOUR — not by
// reading, and not by looking. `el('button', { … }, 'Discard')` passes the words as
// el()'s THIRD ARGUMENT, its children, so no `text:` and no backtick appear at all.
// It is the shape the Orders reminder actually used, and a deliberate re-break of it
// came back GREEN while three other probes went red. A guard that survives its own
// mutation is not a guard.
const CHILD = /\}\s*,\s*'([A-Z][a-z][^']*)'\s*\)/g;

// ⚠️⚠️ THE SIXTH AND SEVENTH SHAPES, ADDED 22 Aug 2026, and the sixth is the same
// hole `tabButton(` was: a literal passed as a helper's ARGUMENT.
//
//   field('Name', input)        every label on the ingredient form — Name, Supplier,
//                               Brand, Weight, Category — and on the supplier form.
//                               The screen the whole allergen job happens on, in
//                               English, on an Italian phone, while four i18n suites
//                               and this very test passed.
//   message: `Delete “${n}”?`   confirmDialog's question. okLabel/cancelLabel were
//                               already covered, so the dialog offered its ANSWERS in
//                               Italian and asked its QUESTION in English.
//
// 📌 Naming `field(` rather than "any helper" is deliberate: a pattern that matched
// every `foo('Bar'` would fire on document ids, class names and CSS values, and a
// guard that cries wolf gets an exception added to it until it guards nothing.
// ⚠️ THE EIGHTH SHAPE, 23 Aug 2026: the SAME helper, called with a BACKTICK.
// `field(\`Selling price, including VAT (${CURRENCY})\`, …)` on the Food Cost editor
// walked past this pattern for a month because it only knew the quoted form — the
// interpolation is what made somebody reach for a template literal, and that is exactly
// the label most likely to need one.
const ARG = /(?:field\(\s*)'([A-Z][a-z][^']*)'/g;
const ARG_TEMPLATE = /(?:field\(\s*)`([^`]*)`/g;
const MESSAGE = /message:\s*(?:'([A-Z][a-z][^']*)'|`([^`]*)`)/g;

// ⚠️⚠️ THE NINTH AND TENTH SHAPES, 11 Oct 2026 — found on Panificio Miano, by opening the
// Pastries editor in Italian, exactly the way the note above says the next shape would be:
//
//   countEl.textContent = n === 1 ? '1 pastry' : `${n} pastries`;
//   'aria-label': `How many ${row.name || 'pastries'}`,
//
// WHY EACH EARLIER SHAPE MISSED IT.
//   * The count: TEMPLATE needs a backtick right AFTER `textContent =`, and here a TERNARY
//     stood there. Its literals were also lowercase («1 pastry», «pastries»), and every shape
//     above asks for `[A-Z][a-z]`. The English PLURAL RULE (one / other) had been written at
//     the call site, which is wrong in its own right: the dictionary's { one, other }
//     entries exist so that no screen has to know a language's plural rule.
//   * The label: no shape looks at `'aria-label':` at all. tests/nothing-stays-english.test.mjs
//     does, but only single-quoted, and its sentence scan strips the `${…}` hole, leaving
//     «How many» and «Remove» — both ARE dictionary phrases (`co.howMany`, `ui.remove`), so
//     English glued to a pastry's name passed as translated.
//
// ATTR_TEMPLATE reads a template literal handed to a name a person hears or sees (an
// aria-label, a title, a placeholder), and flags ANY two letters left once the holes are
// removed, not only a capitalised word: a lowercase attribute is just as English.
// HAND_PLURAL reads `x === 1 ? 'a' : 'b'` with a literal on both sides. One literal branch
// (`i === 1 ? 'tomorrow' : wd`) is not a plural rule; it is left alone on purpose.
const ATTR_TEMPLATE = /(?:'aria-label'\s*:\s*|\b(?:title|placeholder)\s*:\s*|setAttribute\(\s*'(?:aria-label|title|placeholder)'\s*,\s*)`([^`]*)`/g;
const HAND_PLURAL = /[!=]==?\s*1\s*\?\s*(?:'[^']*'|`[^`]*`)\s*:\s*(?:'[^']*'|`[^`]*`)/g;

// ⚠️ ONE FILE CANNOT USE THE DICTIONARY, and only the plural shape is told so.
const HAND_PLURAL_EXEMPT = new Map([
  ['js/join-code.js', 'copied byte-for-byte into functions/ — it cannot import the dictionary '
    + '(tests/nothing-stays-english.test.mjs exempts it for the same reason)'],
]);

// A whole line of comment is history or explanation, not a screen: a note that QUOTES the old
// code (`n === 1 ? 'ingredient is' : …`) must not be reported as that code — the same call
// tests/helpers/strings-in.mjs makes.
const isCommentLine = (line) => line.trim().startsWith('//');

test('⚠️ no English is written straight into a screen — it all goes through the dictionary', () => {
  const found = [];

  for (const file of jsFiles(ROOT)) {
    const src = readFileSync(file, 'utf8');
    src.split(/\r?\n/).forEach((line, i) => {
      if (isCommentLine(line)) return;
      const where = file.split(/[\\/]/).slice(-2).join('/');
      for (const m of line.matchAll(LITERAL)) {
        const phrase = m[1];
        if (SAFE.has(phrase.toLowerCase())) continue;
        if (KNOWN_DEBT.has(where)) continue;
        found.push(`${where}:${i + 1}  '${phrase}'`);
      }
      for (const m of line.matchAll(TEMPLATE)) {
        const phrase = prose(m[1]);
        if (!/[A-Z][a-z]/.test(phrase)) continue;      // nothing but values and symbols
        if (SAFE.has(phrase.toLowerCase())) continue;
        if (KNOWN_DEBT.has(where)) continue;
        found.push(`${where}:${i + 1}  \`${phrase}\``);
      }
      for (const m of line.matchAll(CHILD)) {
        const phrase = m[1];
        if (SAFE.has(phrase.toLowerCase())) continue;
        if (KNOWN_DEBT.has(where)) continue;
        found.push(`${where}:${i + 1}  el(…, '${phrase}')`);
      }
      for (const m of line.matchAll(ARG)) {
        const phrase = m[1];
        if (SAFE.has(phrase.toLowerCase())) continue;
        if (KNOWN_DEBT.has(where)) continue;
        found.push(`${where}:${i + 1}  field('${phrase}')`);
      }
      for (const m of line.matchAll(ARG_TEMPLATE)) {
        const phrase = prose(m[1]);
        if (!/[A-Z][a-z]/.test(phrase)) continue;      // nothing but values and symbols
        if (SAFE.has(phrase.toLowerCase())) continue;
        if (KNOWN_DEBT.has(where)) continue;
        found.push(`${where}:${i + 1}  field(\`${phrase}\`)`);
      }
      for (const m of line.matchAll(MESSAGE)) {
        const phrase = m[1] !== undefined ? m[1] : prose(m[2]);
        if (!/[A-Z][a-z]/.test(phrase)) continue;      // nothing but values and symbols
        if (SAFE.has(phrase.toLowerCase())) continue;
        if (KNOWN_DEBT.has(where)) continue;
        found.push(`${where}:${i + 1}  message: '${phrase}'`);
      }
      for (const m of line.matchAll(ATTR_TEMPLATE)) {
        const phrase = prose(m[1]);
        if (!/[A-Za-z]{2}/.test(phrase)) continue;     // nothing but values and symbols
        if (SAFE.has(phrase.toLowerCase())) continue;
        if (KNOWN_DEBT.has(where)) continue;
        found.push(`${where}:${i + 1}  attribute \`${phrase}\``);
      }
      for (const m of line.matchAll(HAND_PLURAL)) {
        if (HAND_PLURAL_EXEMPT.has(where)) continue;
        if (!/[A-Za-z]/.test(m[0].replace(/\$\{[^}]*\}/g, ''))) continue;   // nothing but values and symbols
        found.push(`${where}:${i + 1}  plural by hand: ${m[0]}`);
      }
    });
  }

  assert.deepEqual(found, [],
    'these are shown to a person and never translated — put them in js/i18n.js, in BOTH '
    + 'languages, and pass them through t(). A literal here is a screen that stays English '
    + 'on an Italian phone, and no other i18n test in this project looks for it.');
});

// ⚠️ THE SCAN MUST BE PROVED TO FIND ANYTHING AT ALL. A regex that quietly matches
// nothing — a renamed prop, a reformatted call — passes for ever and guards nothing. It
// is the same trap as a mutation that comes back green.
test('the scan actually finds this shape when it is there', () => {
  const sample = `el('h3', { class: 'x', text: 'Alerts' })`;
  const hits = [...sample.matchAll(LITERAL)].map(m => m[1]);
  assert.deepEqual(hits, ['Alerts']);
});

// ⚠️ THE TWO NEW SHAPES GET THE SAME TREATMENT, and they need it more: both were
// added because the four already here passed while a whole form and nine dialogs sat
// in English. A pattern that matched nothing would restore exactly that state.
test('the scan finds a label passed as an argument', () => {
  const sample = `field('Brand', brand),`;
  assert.deepEqual([...sample.matchAll(ARG)].map(m => m[1]), ['Brand']);
});

test('…and finds it when the label is a template literal', () => {
  const sample = 'field(`Selling price, including VAT (${CURRENCY})`, priceInput,';
  assert.deepEqual([...sample.matchAll(ARG_TEMPLATE)].map(m => prose(m[1])),
    ['Selling price, including VAT ()']);
  const translated = "field(t('fc.sellingPriceVat', { currency: CURRENCY }), priceInput,";
  assert.deepEqual([...translated.matchAll(ARG_TEMPLATE)], [], 'a t() call is not a literal');
});

test('the scan finds a dialog QUESTION, quoted or interpolated', () => {
  const quoted = `message: 'Delete this?',`;
  assert.deepEqual([...quoted.matchAll(MESSAGE)].map(m => m[1]), ['Delete this?']);
  const tpl = 'message: `Permanently delete “${name}”?`,';
  assert.deepEqual([...tpl.matchAll(MESSAGE)].map(m => prose(m[2])), ['Permanently delete “”?']);
});

test('…and leaves a translated one alone', () => {
  const sample = "message: t('orders.deleteConfirm', { name }),";
  assert.deepEqual([...sample.matchAll(MESSAGE)], [], 'a t() call is not a literal');
});

test('…and leaves a data word alone', () => {
  const sample = `el('span', { text: 'Monday' })`;
  const hits = [...sample.matchAll(LITERAL)].map(m => m[1]).filter(p => !SAFE.has(p.toLowerCase()));
  assert.deepEqual(hits, [], 'Monday is a document id, not a phrase');
});

// ⚠️ THE NINTH AND TENTH SHAPES GET THE SAME PROOF. Both were added because the eight above
// passed while a whole editor sat in English on Panificio Miano.
test('the scan finds an English sentence glued to a name inside an aria-label', () => {
  const how = "'aria-label': `How many ${row.name || 'pastries'}`,";
  assert.deepEqual([...how.matchAll(ATTR_TEMPLATE)].map(m => prose(m[1])), ['How many']);
  const remove = "'aria-label': `Remove ${row.name || 'this row'}`,";
  assert.deepEqual([...remove.matchAll(ATTR_TEMPLATE)].map(m => prose(m[1])), ['Remove']);
  const set = "node.setAttribute('aria-label', `Step ${i + 1} speed`);";
  assert.deepEqual([...set.matchAll(ATTR_TEMPLATE)].map(m => prose(m[1])), ['Step  speed']);
});

test('the scan finds a plural rule written by hand, in either of its shapes', () => {
  const ternary = "countEl.textContent = n === 1 ? '1 pastry' : `${n} pastries`;";
  assert.equal([...ternary.matchAll(HAND_PLURAL)].length, 1);
  const suffix = "`${days} day${days === 1 ? '' : 's'}`";
  assert.equal([...suffix.matchAll(HAND_PLURAL)].length, 1);
});

test('…and leaves a translated attribute, a plural through t() and a lone branch alone', () => {
  const translated = "'aria-label': t('past.howManyOf', { name: label }),";
  assert.deepEqual([...translated.matchAll(ATTR_TEMPLATE)], [], 'a t() call is not a literal');
  const onlyValues = "'aria-label': `${row.name} — ${t('orders.field.order')}`,";
  assert.deepEqual([...onlyValues.matchAll(ATTR_TEMPLATE)].map(m => /[A-Za-z]{2}/.test(prose(m[1]))), [false],
    'nothing but a value and a dash is left once the holes are removed');
  const counted = "countEl.textContent = t('past.count', { n });";
  assert.deepEqual([...counted.matchAll(HAND_PLURAL)], []);
  const oneBranch = "if (days.includes(wd)) return i === 1 ? 'tomorrow' : wd;";
  assert.deepEqual([...oneBranch.matchAll(HAND_PLURAL)], [], 'one literal branch is not a plural rule');
  const notOne = "disabled: i === steps.length - 1 ? 'disabled' : null,";
  assert.deepEqual([...notOne.matchAll(HAND_PLURAL)], [], 'comparing with length - 1 is not comparing with 1');

  // The comment that sits above the FIXED line in js/catalogue/catalogue-editor.js quotes the old
  // code. The shape would match it, so the proof is that the loop's own skip catches it first.
  const quoted = "    // `skipped === 1 ? 'ingredient is' : 'ingredients are'` — English grammar";
  assert.equal([...quoted.matchAll(HAND_PLURAL)].length, 1, 'the shape alone would report this comment');
  assert.ok(isCommentLine(quoted), 'a line of comment is skipped before any shape reads it');
  assert.ok(!isCommentLine("countEl.textContent = n === 1 ? '1 pastry' : `${n} pastries`; // note"),
    'a trailing comment does not hide the code in front of it');
});

// ⚠️ And it must be looking at real files, or "nothing found" means "nothing read".
test('the scan reads the app, not an empty folder', () => {
  const files = jsFiles(ROOT);
  assert.ok(files.length > 40, `only ${files.length} files scanned — the walk is broken`);
  assert.ok(files.some(f => f.endsWith('management.js')), 'the Settings screen must be in scope');
});

// ---------------------------------------------------------------------------
// Every confirm dialog names its own Cancel button
// ---------------------------------------------------------------------------

test('⚠ every confirm dialog passes cancelLabel', () => {
  // confirm-dialog.js defaults cancelLabel to the English literal 'Cancel', so a
  // dialog that does not pass one shows «Cancel» beside an Italian confirm button.
  // That was true of FIFTY-TWO dialogs across six features, and it was found by
  // screenshotting ONE of them — no i18n suite looks at a default parameter, and the
  // literal lives in a file this suite exempts anyway.
  //
  // ⚠⚠ THE DEFAULT ITSELF IS DELIBERATELY NOT FIXED, and the reason is the point.
  // All SEVEN copies of confirm-dialog.js have NO IMPORTS AT ALL — that is what makes
  // it the most liftable file in the project ("a feature folder never imports from
  // another feature's folder"), and tests/copie-allineate.test.mjs pins the copies
  // byte-identical. Adding `import { t }` would couple a deliberately dependency-free
  // file to i18n AND give each folder a different relative path, breaking that pin.
  // The CALLERS carry the label, and this test is what stops the next one forgetting.
  //
  // An alert has no cancel button at all, so alertOnly dialogs are exempt.
  const offenders = [];
  for (const file of jsFiles(ROOT)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:confirmDialog|app\.confirm)\(\{/g)) {
      const start = m.index + m[0].length - 1;
      let depth = 0;
      let end = start;
      for (let j = start; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
      }
      const call = src.slice(start, end + 1);
      if (call.includes('alertOnly') || call.includes('cancelLabel')) continue;
      offenders.push(`${file.slice(file.indexOf('js'))}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepEqual(offenders, [],
    "these dialogs fall back to the English default — pass cancelLabel: t('ui.cancel')");
});
