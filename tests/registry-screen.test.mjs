// The «Fornitori» screen — the supplier and ingredient records, lifted out from
// behind the Orders gear onto a page of their own.
//
// ⚠️⚠️ WHAT THESE GUARD IS THE ACCESS STORY, not the layout. The move looks like a
// navigation tidy-up and is not: the ingredient form behind this screen is where
// the fourteen allergens are declared, and it is the one screen in this app that
// can send somebody to hospital. Two things must stay true, and neither is visible
// by using the app:
//
//   1. NO NEW SECTION NAME. `suppliers` must never appear in js/sections.js
//      SECTIONS. A name added there defaults to ALLOWED for every location
//      document written before today — so inventing one would silently switch a
//      screen on for every existing venue AND let them write its collections.
//   2. NO ROLE GATE ON THE WAY IN. The records were open to everybody in the
//      location when they lived behind the gear, deliberately. v1.62.0 cost this
//      project exactly once already: a bar gated for one reason walled off
//      everything later put inside it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECTIONS } from '../js/sections.js';
import { SECTIONS as HELP_SECTIONS } from '../js/help-content.js';
import { _dictionaries } from '../js/i18n.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
// Comments are where this project explains itself, and they name the very words
// these tests forbid. Judge the CODE.
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PAGE = read('suppliers.html');
const REGISTRY = read('js/orders/registry.js');
const FORM = read('js/orders/ingredient-form.js');
const MGMT = read('js/orders/management.js');
const SW = read('sw.js');
const ORDERS_CSS = read('orders.css');

// ── 1. The access story ──────────────────────────────────────────────────────

test('⚠️ the page rides the `orders` section — no new section name was invented', () => {
  assert.match(PAGE, /<body[^>]*\bdata-section="orders"/,
    'suppliers.html must declare data-section="orders": same collections, same gate');
  assert.ok(!SECTIONS.includes('suppliers'),
    'adding `suppliers` to SECTIONS would switch it ON for every venue that already '
    + 'exists — allowedSections defaults a missing key to allowed, and so do the rules');
});

test('⚠️ the Home card rides the same section, so the two cards live and die together', () => {
  const home = read('index.html');
  const card = home.match(/<a class="home-card" href="suppliers\.html"[^>]*>/);
  assert.ok(card, 'index.html must carry a card pointing at suppliers.html');
  assert.match(card[0], /data-section="orders"/,
    'a venue without Orders must lose this card with the Orders card, not keep an empty screen');
});

test('⚠️⚠️ nothing on the way IN reads a role — only Delete is gated, inside', () => {
  // The two doors, in the markup.
  for (const [name, src] of [['index.html', read('index.html')], ['orders.html', read('orders.html')]]) {
    const door = src.match(/<a[^>]*href="suppliers\.html"[^>]*>/);
    assert.ok(door, `${name} must carry a door to suppliers.html`);
    assert.doesNotMatch(door[0], /hidden/,
      `${name}: the door must not start hidden — the allergen form is behind it`);
  }
  // And the screen itself. It may ask canManageHere() nowhere: the ONE gate lives in
  // mgmtRow (Delete) and in the ingredient form (the price), and a second place to
  // ask is a second place to get it wrong.
  assert.doesNotMatch(codeOf(REGISTRY), /\bcanManageHere\b|\bisOwner\b|\bcanManage\b/,
    'registry.js must not gate anything itself');
});

test('the one Delete gate, and the one price gate, are still where they were', () => {
  assert.match(codeOf(read('js/orders/mgmt-ui.js')), /if\s*\(\s*canManageHere\(\)\s*\)/,
    'mgmtRow must still draw Delete only for a manager or owner');
  assert.match(codeOf(FORM), /const mayPrice = canManageHere\(\);/,
    'the ingredient form must still draw the price only for somebody who may see money');
  assert.match(codeOf(FORM), /mayPrice \? priceBlock\(/,
    'an employee gets NO price block at all — not a disabled one');
});

// ── 1b. The price section Federico asked to fit one screen ───────────────────
//
// ⚠️⚠️ EVERY CLASS THIS SECTION USES MUST BE DEFINED SOMEWHERE. `.mgmt-btn` is defined
// in NO stylesheet and never was, so «Leggilo e spunta le caselle» was a bare grey
// browser rectangle from 22 August until v1.67.0 noticed. Nothing warns about an
// undefined class — it is as silent as an undefined custom property, one level up.
test('the two price fields share a row, and the classes doing it exist', () => {
  const code = codeOf(FORM);
  assert.match(code, /class: 'mgmt-pair'/,
    'Federico: «come si acquista e Prezzo al kg… uno accanto all’altro»');
  assert.match(ORDERS_CSS, /\.mgmt-pair \{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    '.mgmt-pair must be DEFINED, and with the same two-column values .alg-nutrition '
    + 'already uses three sections down the same form — no new number was chosen');
  assert.match(ORDERS_CSS, /\.mgmt-pair \.mgmt-input \{[^}]*min-width:\s*0/,
    'without min-width:0 a <select> sizes to its widest option and shoves the other '
    + 'column off — the flex/grid trap this project has paid for once already');
  assert.match(ORDERS_CSS, /\.mgmt-history > \.mgmt-link \{[^}]*align-self:\s*flex-start/,
    'and «Mostrali» must line up left with everything else in the card');
  assert.match(code, /class: 'mgmt-field mgmt-history'/,
    'the rule above needs the class actually on the element');
});

// ⚠️ «IVA esclusa» CANNOT GO. Typing the invoice total where the rate belongs makes
// every recipe using that ingredient cost twenty-five times too much, and nothing on
// any screen would look wrong. It moved, it was not dropped — once, under the pair,
// because it is true of both boxes.
test('⚠️ the ex-VAT warning survives, once, under the pair', () => {
  const code = codeOf(FORM);
  assert.match(code, /t\('orders\.exVatNote'\)/, 'the note must still be shown');
  assert.equal((code.match(/orders\.exVatNote/g) || []).length, 1,
    'and exactly once — it applies to both boxes, so twice is noise');
  for (const dict of Object.values(_dictionaries())) {
    assert.ok(!/[£€$]/.test(dict['orders.exVatNote'] || ''),
      'the note carries no currency symbol of its own — the venue’s country decides it');
  }
});

// ── 2. The safety rule the whole allergen feature rests on ───────────────────

test('⚠️⚠️ the form still never writes the verification stamp', () => {
  // ⚠️ THE CODE, NOT THE FILE. The phrase appears in this file's comments saying it
  // is never written, and a naive grep over the whole source came back red for
  // exactly that reason on 22 Aug — the check was wrong, not the code.
  const code = codeOf(FORM);
  assert.doesNotMatch(code, /allergensCheckedAt/,
    'nothing in the ingredient form may set the stamp: a suggestion must stay inert '
    + 'until a person ticks «I have checked this»');
  assert.match(code, /const stamp = checked\.checked \? \(previous \|\| new Date\(\)/,
    'the stamp comes from the tick box, and an existing one is kept rather than moved');
});

// ⚠️⚠️ AND THE HOLE THAT LEFT, WHICH WAS FOUND BY LOOKING AT A SCREENSHOT AND THEN
// PROVED AGAINST THE EMULATOR DATABASE BEFORE A LINE WAS WRITTEN.
//
// «The form never writes the stamp» is not the same as «the app cannot declare». On an
// ingredient somebody verified on 20 August, the app read the pack text, ticked MILK by
// itself, and Save kept the 20 August stamp — so the saved document read
// `[gluten-wheat, milk]`, verified, by a person who never saw the milk. The one thing
// this whole feature promises is that a proposal is inert; that made it a declaration.
//
// The rule now: THE APP MOVING A BOX CLEARS THE TICK THAT MEANS «I checked this».
// Both directions — an added tick was never checked, and a withdrawn one means the
// stamp describes a list that no longer exists.
test('⚠️⚠️ a box the app moves clears the verification, in both directions', () => {
  const code = codeOf(FORM);
  assert.match(code, /if \(\(next\.added \|\| next\.removed\) && checked\.checked\) \{[\s\S]{0,120}?checked\.checked = false;[\s\S]{0,120}?stampVoided = true;/,
    'when reconcileTicks reports it moved anything on a verified record, the tick box '
    + 'must be cleared — an unenforced «verify it again» warning is worse than none');
  // ⚠️ AND THE OLD DATE MUST NOT COME BACK WITH THE NEXT CONFIRMATION. Re-using it
  // would date a declaration made today to before the allergen was in it.
  assert.match(code, /const previous = stampVoided \? null : checkedAt\(item\);/,
    'a confirmation after a lapse is stamped TODAY, never with the superseded date');
});

// ⚠️ THE PERSON HAS TO BE TOLD, AND KEEP BEING TOLD. The ticks land inside a fold that
// is shut, so the line lives outside it — and it must survive the app withdrawing its
// own ticks again, or the screen would show «Non ancora verificato» with nothing left
// on it to explain why the verification went.
test('⚠️ the lapse is announced outside the fold, and does not vanish', () => {
  const code = codeOf(FORM);
  assert.match(code, /proposedNote\.hidden = proposedCount === 0 && !stampVoided;/,
    'the note must outlive the proposal that caused the lapse');
  assert.match(code, /stampVoided \? 'orders\.pack\.proposedAfterCheck' : 'orders\.pack\.proposedTicks'/,
    'the stronger sentence follows the LAPSE, not the tick box — which this very '
    + 'change now clears, so a note keyed on checked.checked could never appear again');
  assert.match(code, /t\('orders\.pack\.checkVoided'\)/,
    'and there is a wording for a lapse with no proposal left to count');
  assert.match(code, /above: \[status, proposedNote\]/,
    'both of them stay OUTSIDE the fold — the v1.60.0 rule');
});

// ⚠️⚠️ THIS RULE CHANGED IN v1.70.0, AND THE OLD ONE IS WRITTEN DOWN HERE BECAUSE
// DELETING IT WOULD LOOK LIKE A SAFETY CHECK BEING DROPPED.
//
// It used to read «the pack reader only ever ADDS a tick», and that was right while
// suggesting was a BUTTON you pressed once, at the end: a box the app added could only
// be something you then checked, and unticking anything would have overruled a person.
//
// Federico asked for it to run by itself as the list is typed, and that inverts the
// danger. «latte» ticks MILK; correcting it to «latte di mandorla» leaves the milk
// behind for ever — a declaration the automation invented, that nobody typed and
// nothing on screen explains. Never-untick would now be the UNSAFE rule.
//
// The rule that replaces it is one sentence: THE APP MAY TAKE BACK ONLY WHAT THE APP
// PUT THERE. Its logic is pure and lives in reconcileTicks (tests/allergen-match);
// what this file pins is that the FORM obeys it rather than deciding for itself.
test('⚠️⚠️ the form never decides tick ownership itself — it asks the pure model', () => {
  const code = codeOf(FORM);
  assert.match(code, /reconcileTicks\(\{[\s\S]{0,200}?appOwned[\s\S]{0,200}?humanTouched/,
    'the boxes must be moved by reconcileTicks, with both ownership sets handed in');
  // ⚠️ AND THE CALL MUST EXIST AT ALL. A guard on the shape of a call is satisfied by
  // deleting the call (the v1.68.0 lesson), which here would leave the app ticking
  // boxes with no rule about taking them back.
  assert.equal((code.match(/reconcileTicks\(/g) || []).length, 1,
    'exactly one place may reconcile the ticks');
});

test('⚠️⚠️ a box a PERSON moves becomes untouchable, in both directions', () => {
  const code = codeOf(FORM);
  const listener = code.slice(code.indexOf('for (const column of'));
  assert.ok(listener.length > 100, 'the slice must actually hold the listener');
  assert.match(listener, /humanTouched\.add\(key\)/,
    'moving a box must record that a person did it');
  assert.match(listener, /appOwned\.delete\(key\)/,
    'and must take it out of what the app may later withdraw — without this the next '
    + 'keystroke puts a cleared suggestion straight back and the person cannot win');
  // Both columns, not just «has»: a trace somebody ticked by hand is a declaration too.
  assert.match(code, /\['contains', 'may'\]/);
});

// ⚠️⚠️ OPENING A RECORD MUST NOT MOVE A SINGLE BOX. A saved ingredient can hold pack
// text saying «latte» and a milk box somebody deliberately UNTICKED. Re-running the
// matcher on open would put that tick back every time the record was looked at, in
// silence. Federico asked for it «quando compilo l'elenco» — when the list is typed.
test('⚠️⚠️ the first draw shows what the text says and ticks nothing', () => {
  const code = codeOf(FORM);
  assert.match(code, /suggest\(\{ touchBoxes: false \}\)/,
    'the initial call must be the read-only one');
  // ⚠️ THE SHAPE CHANGED IN v1.70.0 AND THE PROPERTY DID NOT. It used to read
  // `const added = touchBoxes ? applyTicks(out) : null`, because the count was printed
  // in a line under the box; that line moved into the «?» sheet, so nothing needs the
  // number here any more (it is said once, outside the fold, by proposedNote).
  // What must stay true is that `touchBoxes` gates EVERY call that moves a box.
  assert.match(code, /if \(touchBoxes\) applyTicks\(out\);/,
    'and touchBoxes must actually gate the only place boxes are moved');
  const calls = [...code.matchAll(/applyTicks\(/g)].length;
  assert.equal(calls, 3, `applyTicks is called ${calls} times; each must be inside a `
    + 'touchBoxes gate — the definition, the empty-box path and the matched path');
  for (const m of code.matchAll(/^(.*)applyTicks\(/gm)) {
    if (m[1].includes('function ')) continue;      // the definition itself
    assert.match(m[1], /touchBoxes/,
      `a call to applyTicks with no touchBoxes gate on its line: «${m[1].trim()}»`);
  }
});

// The button is gone; typing is the interaction. A button left behind would teach
// people that nothing happens until they press it.
// ── The «?» beside each section, and what may NOT go behind it ───────────────
//
// ⚠️⚠️ EVERY ASSERTION BELOW EXISTS BECAUSE A MUTATION SURVIVED WITHOUT IT. Seven of
// fourteen probes came back green on the first run: the explanations could come back
// onto the screen, the findings could be deleted, the «?» could be nested inside the
// head button, and nothing was left to fill the buttons in. «The suite went red» was
// never the question — these are the guards, and they did not exist.
test('⚠️ the «?» is a SIBLING of the head, never inside it', () => {
  const code = codeOf(FORM);
  // A button may not contain a button: nested, the «?» is unreachable and tapping near
  // it folds the section instead of explaining it.
  assert.match(code, /const row = el\('div', \{ class: 'mgmt-fold-head-row' \}, \[\s*\n\s*btn,\s*\n\s*el\('span', \{ class: 'mgmt-fold-help', 'data-help': help \}\),/,
    'the row holds the head and the «?» side by side');
  const btnBlock = code.slice(code.indexOf("const btn = el('button'"), code.indexOf('const row ='));
  assert.ok(btnBlock.length > 100, 'the slice must actually hold the head button');
  assert.doesNotMatch(btnBlock, /data-help/,
    'the head button must not contain the help host — a button inside a button');
});

test('⚠️ the help buttons are actually mounted, or every «?» is an empty span', () => {
  const code = codeOf(FORM);
  assert.match(code, /mountHelpButtons\(root\);/,
    'this overlay is built after page load, so it must ask for its own buttons — '
    + 'without the call the hosts stay empty and nothing on screen looks broken');
  assert.match(code, /import \{ mountHelpButtons \} from '\.\.\/help-button\.js';/);
  // Three sections, three sheets, and each id must exist in help-content.js.
  const ids = [...code.matchAll(/help: '([a-z-]+)'/g)].map(m => m[1]);
  assert.deepEqual(ids, ['pack-list', 'allergens', 'nutrition'],
    'the three folding sections each carry their own sheet');
  // ⚠️ AND NOT JUST NAMED — REAL. `ids` is a hand-written list, so deleting an
  // entry from HELP in help-content.js (mutation M8: the 'pack-list' entry was
  // removed) left this list unchanged and the test green, while the «?» on the
  // pack section would mount an EMPTY sheet. Asking the dictionary itself closes
  // that hole — a removed entry now fails here, not silently on the app.
  for (const id of ids) {
    assert.ok(HELP_SECTIONS.includes(id),
      `help-content.js has no entry for '${id}' — the «?» would open an empty sheet`);
  }
});

// ⚠️⚠️ WHAT MAY NOT GO BEHIND THE «?». The rule Federico's request resolves to: a
// sentence true of every product is an explanation and may be hidden; a sentence about
// THIS product is a finding and may not. A mutation deleted the findings and every
// test stayed green — on the one screen in this app that can send somebody to hospital.
test('⚠️⚠️ the findings about THIS pack stay on the screen', () => {
  const code = codeOf(FORM);
  assert.match(code, /packResult\.appendChild\(el\('p', \{ class: 'alg-pack-question', text: line \}\)\);/,
    'the «the pack says frutta a guscio, nothing was ticked» line must be drawn — '
    + 'behind a «?» nobody would ever see the one moment the app goes quiet');
  assert.match(code, /if \(!out\.recognisedAnything\) \{[\s\S]{0,200}?orders\.pack\.recognisedNothing/,
    'recognising nothing is an answer and must look like one: silence there reads as '
    + '«this pack contains nothing», the worst thing this feature could say');
});

// ⚠️ AND WHAT MUST NOT COME BACK. The instructions are in the sheet now; a paragraph
// re-added here is how the section fills up again one line at a time.
test('⚠️ the section holds the box and the findings, not the instructions', () => {
  const code = codeOf(FORM);
  // ⚠️⚠️ THE WHOLE FILE, NOT A SLICE, AND THAT IS THE WHOLE POINT OF THIS GUARD.
  // It was written as a slice of the pack section and every slice ever tried has had
  // a way in behind it. The fold() object literal alone missed suggest(), which is
  // where packResult is actually filled — mutation M5b walked straight through it.
  // Widened to start at `function suggest(`, it then missed the DECLARATIONS above:
  // packBox and packResult are built ~60 lines earlier, so a paragraph declared
  // there and merely referenced inside the fold body is on the screen with neither
  // key inside the slice. That was demonstrated, with the suite green.
  // There is no correct boundary, because a paragraph can be built anywhere in the
  // file and appended anywhere else. These two keys have NO legitimate use in this
  // file at all — they live in the «?» sheet — so the honest assertion is that they
  // do not appear in it, full stop. Same shape as the sibling check below.
  for (const key of ['orders.pack.help', 'orders.pack.stillYours']) {
    assert.ok(!code.includes(key),
      `${key} belongs in the «?» sheet, not on the screen — Federico: «c'è scritto troppo»`);
  }
  // The intros above the other two panels went the same way.
  assert.ok(!code.includes("text: t('orders.copyThisFromThe')"),
    'the allergen panel intro is in its sheet now');
});

test('the «read it and tick the boxes» button is gone, and typing runs it', () => {
  const code = codeOf(FORM);
  assert.doesNotMatch(code, /orders\.pack\.suggest/,
    'the key is retired — see tests/i18n for the ban on its return');
  assert.match(code, /packBox\.addEventListener\('input'/);
  assert.match(code, /packBox\.addEventListener\('change'/,
    'a paste and leaving the box must not have to wait for the timer');
});

// ── 3. The move actually happened, and left nothing behind ───────────────────

test('the settings panel kept the settings and gave up the records', () => {
  const code = codeOf(MGMT);
  for (const gone of ['supplierForm', 'ingredientForm', 'renderSearchableList', 'allergenBlock', 'priceBlock']) {
    assert.doesNotMatch(code, new RegExp(`\\b${gone}\\b`),
      `${gone} moved out of management.js — a second copy is a second thing to fix`);
  }
  assert.doesNotMatch(code, /tabBar|tabButton/,
    'with the two lists gone, a tab bar of one tab is a control that appears to do nothing');
  // …and it kept what it is for.
  for (const kept of ['buildStockToggle', 'buildWeekStart', 'buildSendRoutes', 'buildHistoryDaysField']) {
    assert.match(code, new RegExp(`\\b${kept}\\b`), `${kept} is a real setting and stays`);
  }
});

test('each moved piece has exactly one home, and one importer', () => {
  const importers = (needle) => ['js/orders/registry.js', 'js/orders/registry-main.js',
    'js/orders/management.js', 'js/orders/orders-main.js', 'js/orders/ingredient-form.js']
    .filter(f => new RegExp(`from '\\./${needle}'`).test(read(f)));
  assert.deepEqual(importers('ingredient-form.js'), ['js/orders/registry.js'],
    'the ingredient form is reached from the records screen and nowhere else');
  assert.deepEqual(importers('registry.js'), ['js/orders/registry-main.js']);
});

test('⚠️ the page and its four modules are precached, or an offline install gets nothing', () => {
  // install() is all-or-nothing: one missing entry and NOTHING is cached for this
  // version. This is the single failure in this project that does not self-heal.
  for (const asset of ['./suppliers.html', './js/orders/registry.js', './js/orders/registry-main.js',
    './js/orders/ingredient-form.js', './js/orders/mgmt-ui.js']) {
    assert.ok(SW.includes(`'${asset}'`), `sw.js must precache ${asset}`);
  }
  // Every script the page loads has to be in there too — a new one added later would
  // otherwise be fetched from the network on a phone that has none.
  for (const m of PAGE.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) {
    assert.ok(SW.includes(`'./${m[1]}'`), `suppliers.html loads ${m[1]}, which sw.js does not precache`);
  }
});

test('the cache version moved, or no phone will ever fetch the new page', () => {
  const version = SW.match(/CACHE_NAME = 'theitalianclub-v(\d+)'/);
  assert.ok(version, 'sw.js must name a numbered cache');
  assert.ok(Number(version[1]) >= 327, `CACHE_NAME is still v${version[1]} — bump it`);
});

// ── 4. The screen says what it knows, in words ───────────────────────────────

test('⚠️ an undeclared ingredient is flagged with a WORD, not a colour', () => {
  const code = codeOf(REGISTRY);
  assert.match(code, /allergenState\(item\) === 'unknown'/,
    'the flag is driven by the three-state model, never by an empty allergens array');
  assert.match(code, /t\('orders\.notDeclaredShort'\)/,
    'and it is a phrase from the dictionary — a colour alone is invisible to a '
    + 'colour-blind reader and to a screen reader (P18)');
});

test('the plural of «product» comes from the dictionary, not from an if', () => {
  assert.match(codeOf(REGISTRY), /t\('orders\.productsCount', \{ n:/);
  assert.doesNotMatch(codeOf(REGISTRY), /=== 1 \?/,
    'Italian and English do not agree about when one form becomes the other');
});

// ⚠️⚠️ THE EIGHTH SHAPE OF THE FROZEN-PHRASE DEFECT, and it shipped in the first
// draft of this screen: the two switch labels read «Suppliers · All ingredients» on
// an Italian phone, for the life of the page.
//
// tests/frozen-phrases.test.mjs asks whether a top-level CONST calls t(). These
// calls sat inside a function, which is normally the fix — except registry-main.js
// calls that function at MODULE LOAD, before a venue is open and therefore before
// the app knows what language it speaks. A t() there answers in the starting
// language and never answers again. Found by driving the app in Italian; every
// suite was green.
test('⚠️ the chrome takes its words at PAINT time, not when the module loads', () => {
  const code = codeOf(REGISTRY);
  const build = code.slice(0, code.indexOf('function paintChrome'));
  for (const key of ['orders.tab.suppliers', 'ui.ingredients', 'orders.searchASupplier']) {
    assert.ok(!build.includes(key),
      `${key} is resolved while buildRegistry() runs — and registry-main.js runs it at `
      + 'module load, so the word freezes in the app\'s starting language');
  }
  assert.match(code, /function paintList\(\) \{\s*paintChrome\(\);/,
    'paintChrome must run on every repaint, which is the only thing that happens '
    + 'again after the venue\'s language arrives');
  assert.match(code, /search\.input\.setAttribute\('aria-label'/,
    'buildSearchBox copies the placeholder into aria-label at build time, when there '
    + 'was none — so the field would be announced unlabelled (P18)');
});

// ⚠️ TWO MORE THAT 34 DRIVEN CHECKS PASSED AND A SCREENSHOT CAUGHT.
test('a product on its own supplier\'s screen names no supplier at all', () => {
  const code = codeOf(REGISTRY);
  assert.match(code, /supplierName === undefined \? null :/,
    'omitting the supplier must mean "do not print it", never fall through to '
    + '«No supplier» — on the one screen that exists to say whose product it is');
  assert.match(code, /ingredientRow\(i\)\)/,
    'the supplier screen calls it with the name omitted, not with null');
});

test('the delivery days are the same words the Orders list prints', () => {
  const code = codeOf(REGISTRY);
  assert.match(code, /import \{ dayShort \}/,
    'the mapping is imported, not copied: two screens printing one supplier’s days '
    + 'must not be able to disagree');
  assert.doesNotMatch(code, /\.slice\(0, 3\)/,
    'slicing the stored English key prints «Tue, Fri» under an Italian heading');
});

test('the two lists share ONE search box, mounted once', () => {
  const code = codeOf(REGISTRY);
  assert.equal((code.match(/buildSearchBox\(/g) || []).length, 1,
    'a second box would be a second place for the debounce and the wiping bug to live');
  assert.match(code, /onInput: text => \{ query = text; \}/,
    'the text is stored on every keystroke: a live snapshot must find the CURRENT text');
});

// ── 5. The name on the door ──────────────────────────────────────────────────
//
// ⚠️ TWO KEYS FOR ONE DESTINATION, AND THAT IS THE DESIGN. The long name goes
// everywhere somebody is CHOOSING what to open; the short one stays where three
// buttons share a 320px phone. Both halves need pinning: unify them and the Orders
// bar wraps, split them further and the card and the screen drift apart.

test('⚠️ the card you tap and the screen you land on carry the SAME name', () => {
  const home = read('index.html');
  const card = home.match(/<a class="home-card" href="suppliers\.html"[\s\S]*?<\/a>/);
  assert.ok(card, 'index.html must carry a card pointing at suppliers.html');
  const KEY = 'section.suppliersAndIngredients';
  assert.match(card[0], new RegExp(`class="home-card-title" data-i18n="${KEY}"`),
    `the Home card's title must be ${KEY} — «Fornitori» alone never told anybody the `
    + 'ingredients, and the allergen work, were behind it');
  assert.match(PAGE, new RegExp(`<h1 data-i18n="${KEY}"`),
    'the page must announce itself with the same key, or the rename only moves the '
    + 'confusion one screen along');
});

test('⚠️⚠️ the Orders bottom bar keeps the SHORT label', () => {
  const bar = read('orders.html').match(/<a[^>]*id="suppliers-footer-btn"[\s\S]*?<\/a>/);
  assert.ok(bar, 'orders.html must still carry the second door');
  assert.match(bar[0], /data-i18n="section\.suppliers"/,
    'three buttons share a 320px phone here and this bar has already shipped a broken '
    + 'release from a tab that wrapped by 3px — «Fornitori e ingredienti» would wrap it. '
    + 'Inside Orders the context is given and the button has an icon; the Home card has '
    + 'nothing but its words');
});

test('⚠️ the two view switches say the SAME word, and it is the plain one', () => {
  // Federico, looking at the screen: «tutti gli ingredienti chiamalo semplicemente
  // ingredienti». The identical control exists on BOTH the Orders screen and this
  // one, so a word changed on one and not the other is the two-names-one-thing
  // muddle v1.65.0 was built to remove. ui.ingredients already existed — no key was
  // invented, and ui.allIngredients was retired rather than reworded.
  assert.match(codeOf(REGISTRY), /ingredientsBtn\.textContent = t\('ui\.ingredients'\)/,
    'the Fornitori switch must use the plain key');
  assert.match(read('orders.html'), /id="view-all-ingredients"[^>]*data-i18n="ui\.ingredients"/,
    'and the Orders switch must use the very same one');
});

// ── 6. Which list the screen opens on ────────────────────────────────────────

test('⚠️⚠️ the screen opens on the INGREDIENTS, and all three parts of that agree', () => {
  // Federico: «adesso quando apro la schermata vedo prima i fornitori, invece voglio
  // vedere prima gli ingredienti». 67 ingredients, 0 declared — that list is the work.
  //
  // ⚠️ ALL THREE ASSERTED TOGETHER BECAUSE ANY ONE ALONE IS A DEFECT. paintChrome()
  // recomputes `active` from `tab` on every paint, so the default changed alone lights
  // the wrong tab on the FIRST FRAME — a flash on every open — and the order changed
  // alone leaves the left-hand tab dark, which reads as broken.
  const code = codeOf(REGISTRY);
  assert.match(code, /let tab = 'ingredients';/,
    'the default list must be the ingredients');
  assert.match(code, /role: 'tablist' \}, \[ingredientsBtn, suppliersBtn\]/,
    'the ingredients button must be built FIRST, so it sits on the left');
  const built = code.slice(0, code.indexOf('const viewSwitch'));
  const ing = built.indexOf('const ingredientsBtn');
  const sup = built.indexOf('const suppliersBtn');
  assert.ok(ing !== -1 && sup !== -1, 'both buttons must exist');
  assert.match(built.slice(ing, sup), /class: 'view-switch-btn active'[\s\S]*?'aria-selected': 'true'/,
    'the ingredients button is the one built already lit, matching the default');
  assert.doesNotMatch(built.slice(sup), /'aria-selected': 'true'/,
    'and the suppliers button must NOT also claim to be selected');
});

test('the Orders screen deliberately keeps «Per fornitore» first', () => {
  // ⚠️ NOT AN OVERSIGHT. On the Order tab you are placing an order, and an order is
  // placed supplier by supplier. Same control, different job — swapping it there would
  // put the wrong list under the thumb of somebody mid-order.
  const orders = read('orders.html');
  const bySupplier = orders.indexOf('id="view-by-supplier"');
  const byIngredient = orders.indexOf('id="view-all-ingredients"');
  assert.ok(bySupplier !== -1 && byIngredient !== -1, 'both Orders view buttons must exist');
  assert.ok(bySupplier < byIngredient,
    'Orders keeps the supplier view first — only the records screen was inverted');
});

test('the retired subtitles are gone from the markup AND from both dictionaries', () => {
  // ⚠️ A KEY LEFT BEHIND IS NOT HARMLESS: the next person reads it as live, and its
  // English no longer describes anything the app shows.
  // ⚠️ THE CODE, NOT THE FILE — this file's own comment records the rename by name,
  // which is exactly the shape that made an earlier check in this suite go red on a
  // correct app.
  const i18n = codeOf(read('js/i18n.js'));
  for (const dead of ['ui.whoYouBuyFrom', 'ui.suppliersWeeklyOrder', 'ui.allIngredients']) {
    assert.ok(!i18n.includes(dead), `${dead} was replaced — remove it, do not leave it`);
    for (const page of ['index.html', 'suppliers.html', 'orders.html']) {
      assert.ok(!read(page).includes(dead), `${page} still points at ${dead}`);
    }
  }
});

// ── The purchase-unit picker has half a row, and a <select> lies about it ─────
//
// ⚠️⚠️ A NATIVE <select> TRUNCATES WITHOUT REPORTING AN OVERFLOW. That is the v1.66.0
// lesson and it caught this release too: putting «Come si acquista» and «Prezzo» side
// by side halved the picker, and at 320px it rendered «— Nessun prezzo` with the last
// characters eaten by the native arrow. Every measurement passed — scrollWidth equals
// clientWidth on a clipped <select> — and only a screenshot showed it.
//
// MEASURED IN THE REAL BROWSER, 23 Aug 2026, Manrope 15px at 320px:
//   the column is 125.3px · padding 24 · border 3 · the native arrow ~20
//   → 78.7px of room for the text
// «— Nessun prezzo —» wanted 132.1 and «a volume (litri)» 99.1. Both were clipped.
// The words were shortened rather than the column widened, because «a volume (litri)»
// was already the widest thing in a 78.7px box and no ratio makes that fit honestly.
//
// This guard is a character budget, which is a proxy — but a proxy that fires. Manrope
// 15px averages ~7.2px per character, so 11 characters is ~79px: the whole budget.
test('⚠️ the purchase-unit words fit a half-width select at 320px', () => {
  const dict = _dictionaries();
  const KEYS = ['orders.noPrice2', 'price.byWeight', 'price.byVolume', 'price.byPiece'];
  const BUDGET = 11;
  const tooLong = [];
  for (const lang of ['en', 'it']) {
    for (const key of KEYS) {
      const word = dict[lang][key];
      assert.ok(typeof word === 'string' && word.length > 0, `${lang} ${key} is missing`);
      if (word.length > BUDGET) tooLong.push(`${lang} ${key} = «${word}» (${word.length} chars)`);
    }
  }
  assert.deepEqual(tooLong, [],
    `these would be silently truncated in the picker at 320px — a <select> reports no `
    + `overflow, so nothing but a screenshot would show it`);
});

// Proof the budget can fire, using the exact wording it was written to catch.
test('and that budget would have caught the wording it replaced', () => {
  const before = ['— Nessun prezzo —', 'a volume (litri)', 'by volume (litres)'];
  assert.deepEqual(before.filter(w => w.length <= 11), [],
    'the retired words must all exceed the budget, or the budget proves nothing');
});
