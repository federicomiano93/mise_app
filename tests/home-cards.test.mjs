// Which Home cards a venue shows its ordinary employees, and who may change that.
//
// Federico, 13 Sep 2026: owner, manager and head chef choose the cards, HIDE ONLY, and
// ONLY FOR EMPLOYEES. The judgement is pure (js/home-cards.js) and is executed here;
// the wiring around it — the server's copy of the list, the markup, the gate, the
// screen — is read from source, because nothing else can see it without a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STAFF_CARDS, HIDEABLE_IDS, OPT_IN_IDS, HIDDEN_FIELD, SHOWN_FIELD, ORDER_FIELD,
  isHiddenForStaff, cardVisibleTo, mayBeTold, cleanOrder, isValidOrder, orderedCardIds,
} from '../js/home-cards.js';
import { PUSH_KINDS, cardForKind, targetPage } from '../js/push-model.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const withoutComments = src => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

const PAGE_OF = Object.freeze({
  calculator: 'calculator.html',
  catalogue: 'catalogue.html',
  orders: 'orders.html',
  suppliers: 'suppliers.html',
  pastries: 'pastries.html',
  foodcost: 'foodcost.html',
  inventory: 'inventory.html',
});

// The work, as opposed to the money: visible to employees unless hidden.
const EVERYDAY = HIDEABLE_IDS.filter(id => !OPT_IN_IDS.includes(id));

// ── 1. The judgement ─────────────────────────────────────────────────────────

test('a venue that has never heard of the field hides no everyday card', () => {
  for (const doc of [null, undefined, {}, { name: 'Bakery' }, 'corrupt', 42]) {
    for (const id of EVERYDAY) {
      assert.equal(isHiddenForStaff(doc, id), false, `${JSON.stringify(doc)} hid ${id}`);
    }
  }
});

test('⚠️ only a literal true hides a card', () => {
  for (const value of [false, 'true', 1, null, {}, [], 'yes']) {
    const doc = { [HIDDEN_FIELD]: { pastries: value } };
    assert.equal(isHiddenForStaff(doc, 'pastries'), false,
      `${JSON.stringify(value)} must read as visible — a cosmetic switch must never empty a Home`);
  }
  assert.equal(isHiddenForStaff({ [HIDDEN_FIELD]: { pastries: true } }, 'pastries'), true);
});

test('a corrupt map hides nothing', () => {
  for (const map of [true, 'pastries', ['pastries'], 7]) {
    assert.equal(isHiddenForStaff({ [HIDDEN_FIELD]: map }, 'pastries'), false);
  }
});

test('hiding one card hides that card and no other', () => {
  const doc = { [HIDDEN_FIELD]: { orders: true } };
  for (const id of EVERYDAY) {
    assert.equal(isHiddenForStaff(doc, id), id === 'orders', id);
  }
  // ⚠️ Suppliers shares the `orders` SECTION — and must not share its switch.
  assert.equal(cardVisibleTo(doc, false, 'suppliers'), true);
});

test('⚠️⚠️ owners, managers and head chefs see every card, whatever is hidden', () => {
  const everything = { [HIDDEN_FIELD]: Object.fromEntries(HIDEABLE_IDS.map(id => [id, true])) };
  for (const id of HIDEABLE_IDS) {
    assert.equal(cardVisibleTo(everything, true, id), true, `a manager lost ${id}`);
    assert.equal(cardVisibleTo(everything, false, id), false, `an employee still sees ${id}`);
  }
});

test('only a literal canManage === true passes the switch', () => {
  const doc = { [HIDDEN_FIELD]: { pastries: true } };
  for (const canManage of [undefined, null, 'true', 1, false]) {
    assert.equal(cardVisibleTo(doc, canManage, 'pastries'), false, String(canManage));
  }
});

test('a card with no id, or one this layer does not know, is never hidden', () => {
  const doc = { [HIDDEN_FIELD]: { toString: true }, [SHOWN_FIELD]: {} };
  for (const id of [undefined, '', 'toString', '__proto__', 'nothing']) {
    assert.equal(cardVisibleTo(doc, false, id), true, String(id));
  }
});

test('the ids are the seven Home cards, and the two money cards are the opt-in ones', () => {
  assert.deepEqual([...HIDEABLE_IDS],
    ['calculator', 'catalogue', 'orders', 'suppliers', 'pastries', 'foodcost', 'inventory']);
  assert.deepEqual([...OPT_IN_IDS], ['foodcost', 'inventory']);
  assert.ok(Object.isFrozen(STAFF_CARDS) && STAFF_CARDS.every(Object.isFrozen));
});

test('⚠️⚠️ a money card is HIDDEN from employees until the venue shows it — and only a literal true shows it', () => {
  for (const doc of [null, undefined, {}, { name: 'Bakery' }, 'corrupt']) {
    for (const id of OPT_IN_IDS) {
      assert.equal(isHiddenForStaff(doc, id), true, `${JSON.stringify(doc)} showed ${id}`);
    }
  }
  for (const value of [false, 'true', 1, null, {}, []]) {
    assert.equal(cardVisibleTo({ [SHOWN_FIELD]: { foodcost: value } }, false, 'foodcost'), false, JSON.stringify(value));
  }
  assert.equal(cardVisibleTo({ [SHOWN_FIELD]: { foodcost: true } }, false, 'foodcost'), true);
  assert.equal(cardVisibleTo({ [SHOWN_FIELD]: { foodcost: true } }, false, 'inventory'), false,
    'showing Food cost does not show the Stocktake');
});

test('⚠️ the two maps do not cross: «hidden» cannot touch a money card, nor «shown» an everyday one', () => {
  assert.equal(isHiddenForStaff({ [HIDDEN_FIELD]: { foodcost: false } }, 'foodcost'), true,
    'a false in the hidden map is not a way to show the accounts');
  assert.equal(isHiddenForStaff({ [SHOWN_FIELD]: { pastries: false } }, 'pastries'), false);
});

// ── 2. The markup agrees ─────────────────────────────────────────────────────

test('every hideable card carries its id on the Home, exactly once, on the right link', () => {
  const home = read('index.html');
  for (const card of STAFF_CARDS) {
    const tags = home.match(new RegExp(`<a class="home-card"[^>]*\\bdata-card="${card.id}"[^>]*>`, 'g')) || [];
    assert.equal(tags.length, 1, `index.html: data-card="${card.id}" must appear on exactly one card`);
    assert.match(tags[0], new RegExp(`href="${PAGE_OF[card.id].replace('.', '\\.')}"`));
    assert.match(tags[0], new RegExp(`data-section="${card.section}"`),
      `${card.id}: the card's section and the list's section disagree`);
  }
  // ⚠️ EVERY card, because a card without one is judged by nobody: the Home would show it
  // to everybody, the money cards included.
  const tags = home.match(/<a class="home-card"[^>]*>/g) || [];
  assert.equal(tags.length, HIDEABLE_IDS.length, 'one card on the Home per id, and no other');
  for (const tag of tags) assert.match(tag, /\bdata-card="/, `${tag} carries no data-card`);
});

test('⚠️ every hideable page declares its card on <body>, or an address typed by hand walks past', () => {
  for (const card of STAFF_CARDS) {
    const page = read(PAGE_OF[card.id]);
    assert.match(page, new RegExp(`<body[^>]*\\bdata-card="${card.id}"`), PAGE_OF[card.id]);
    assert.match(page, new RegExp(`<body[^>]*\\bdata-section="${card.section}"`), PAGE_OF[card.id]);
  }
});

// ── 3. The server ────────────────────────────────────────────────────────────

const ONBOARDING = read('functions/onboarding.js');
const CALLABLE = (() => {
  const start = ONBOARDING.indexOf('export const setStaffCard');
  assert.ok(start > 0, 'functions/onboarding.js must export setStaffCard');
  const next = ONBOARDING.indexOf('export const', start + 10);
  return withoutComments(next === -1 ? ONBOARDING.slice(start) : ONBOARDING.slice(start, next));
})();

test('⚠️⚠️ the server refuses cards by the app\'s own list, not a second one', () => {
  // functions/home-cards.js is a byte copy of js/home-cards.js (tests/copie-allineate.test.mjs).
  assert.match(ONBOARDING, /import \{ HIDEABLE_IDS, OPT_IN_IDS, isValidOrder \} from '\.\/home-cards\.js';/);
  assert.doesNotMatch(ONBOARDING, /STAFF_CARD_IDS/, 'a hand-kept second list is the one that drifts');
});

test('the callable writes one key of the field the app reads, by merge, with no spread', () => {
  assert.doesNotMatch(CALLABLE, /\.\.\.request\.data|\.\.\.data\b/,
    'a spread would carry anything the caller sent onto the document holding `sections`');
  assert.match(CALLABLE,
    new RegExp(`\\.set\\(\\{ ${HIDDEN_FIELD}: \\{ \\[card\\]: hidden \\} \\}, \\{ merge: true \\}\\)`),
    'one card, merged — a whole write would erase the venue name, its sections and its country');
  assert.doesNotMatch(CALLABLE, /sections|users\/|delete|batch/,
    'hiding a card must touch no access and no data');
});

test('the callable refuses an unknown card, a non-boolean, and an employee', () => {
  assert.match(CALLABLE, /!HIDEABLE_IDS\.includes\(card\)[\s\S]{0,80}invalid-argument/);
  assert.match(CALLABLE, /typeof hidden !== 'boolean'[\s\S]{0,80}invalid-argument/);
  assert.match(CALLABLE, /requireAuth\(request\)/);
  assert.match(CALLABLE, /access !== 'owner' && access !== 'manager'[\s\S]{0,160}permission-denied/,
    'hiding the button is courtesy; this is the half that refuses');
});

test('⚠️ a callable missing from index.js is not deployed at all', () => {
  assert.match(read('functions/index.js'), /\bsetStaffCard\b/);
});

// ── 4. The wiring ────────────────────────────────────────────────────────────

test('the Home filters on the card, and passes the session\'s canManage', () => {
  const src = withoutComments(read('js/home-session.js'));
  assert.match(src, /import \{ cardVisibleTo, orderedCardIds \} from '\.\/home-cards\.js';/);
  assert.match(src, /cardVisibleTo\(location, canManage, card\.dataset\.card\)/);
  assert.match(src, /filterCards\(session\);/);
});

test('⚠️ the button is drawn only for somebody who can manage the venue', () => {
  // Since 13 Sep 2026 it is a row of the Home's Settings screen, not a line under the cards.
  const src = withoutComments(read('js/home-settings.js'));
  assert.match(src,
    /if \(session\.canManage\) \{\s*scroll\.append\(item\(t\('homeCards\.title'\)[\s\S]{0,200}openHomeCards\(session\)/);
});

test('⚠️ the page gate asks too, after the section check and before the page is shown', () => {
  const src = read('js/auth-gate.js');
  assert.match(src, /import \{ cardVisibleTo \} from '\.\/home-cards\.js';/);
  const ready = src.slice(src.indexOf("case 'ready':"), src.indexOf('clearGate();', src.indexOf("case 'ready':")));
  assert.ok(ready.length > 100, 'the slice must hold the ready case');
  assert.match(ready,
    /if \(pageCard && !cardVisibleTo\(session\.location, session\.canManage, pageCard\)\) \{\s*location\.replace\(HOME\);\s*return;/);
});

test('the screen lists only the cards the venue has, and writes only after the server agrees', () => {
  const src = withoutComments(read('js/staff/home-cards-screen.js'));
  assert.match(src, /const venueSections = allowedSections\(session\.location\);/);
  assert.match(src, /STAFF_CARDS\.filter\(card => venueSections\[card\.section\] === true\)/);
  const call = src.indexOf('await setStaffCard(');
  const remember = src.indexOf('override[card.id] = hide');
  assert.ok(call > 0 && remember > call,
    'remembering the switch before the server agrees shows a change the venue never got');
});

test('⚠️ every hide asks first; showing asks only for a money card', () => {
  // Federico, 13 Sep 2026: «tutte le impostazioni quando le vuoi nascondere devono chiedere
  // conferma» — and showing Food cost or the Stocktake gives employees the accounts.
  const src = withoutComments(read('js/staff/home-cards-screen.js'));
  const q = src.slice(src.indexOf('function questionFor('), src.indexOf('export function openHomeCards('));
  assert.match(q, /if \(hide\) \{[\s\S]*?danger: true,\s*\};\s*\}/, 'hiding any card asks, as a danger');
  assert.match(q, /if \(card\.optIn\) \{\s*return \{\s*title: t\('homeCards\.show\.title'/, 'showing a money card asks');
  assert.match(q, /return null;\s*\}\s*$/, 'showing an everyday card back asks nothing');
  const toggle = src.slice(src.indexOf('async function toggle('));
  const ask = toggle.search(/const ask = questionFor\(card, hide\);\s*if \(ask\) \{\s*const ok = await confirmDialog\(/);
  assert.ok(ask > 0 && ask < toggle.indexOf('await setStaffCard('), 'asked before the save');
  assert.equal((src.match(/confirmDialog\(/g) || []).length, 1, 'one dialog, built from the question');
});

test('the dialog names the allergen sheet on the Catalogue, and notifications where there are any', () => {
  const src = withoutComments(read('js/staff/home-cards-screen.js'));
  assert.match(src, /if \(card\.id === 'catalogue'\) lines\.push\(t\('homeCards\.catalogue\.body'\)\);/);
  assert.match(src, /if \(card\.employeePush\) lines\.push\(t\('homeCards\.hide\.push'\)\);/);
});

test('the client call waits for the venue, like every call made inside one', () => {
  assert.match(read('js/staff/firebase-staff.js'),
    /export async function setStaffCard\(locationId, card, hidden\) \{\s*await sessionReady;/);
});

test('both new files are precached — auth-gate.js imports one of them on every page', () => {
  const sw = read('sw.js');
  assert.match(sw, /'\.\/js\/home-cards\.js'/);
  assert.match(sw, /'\.\/js\/staff\/home-cards-screen\.js'/);
});

// ── 5. What the code review found (13 Sep 2026) ──────────────────────────────

test('⚠️⚠️ the callable checks the role BEFORE it writes', () => {
  const role = CALLABLE.indexOf("access !== 'owner' && access !== 'manager'");
  const write = CALLABLE.indexOf('.set(');
  assert.ok(role > 0 && write > role,
    'a write placed before the check would let an employee change what everybody sees — '
    + 'and every other assertion here would still match');
});

test('the callable refuses a location id that could never name a folder', () => {
  assert.match(CALLABLE, /!\/\^\[A-Za-z0-9\]\[A-Za-z0-9_-\]\{0,63\}\$\/\.test\(locationId\)/);
});

test('⚠️ the Home filter reads canManage by that name, not another flag under it', () => {
  assert.match(read('js/home-session.js'), /function filterCards\(\{ location, canManage \}\)/,
    '`isOwner: canManage` would still match every other check and take the cards away from managers');
});

test('⚠️ the «order to place today» banner is no door to a hidden Orders card', () => {
  const src = withoutComments(read('js/home-orders-badge.js'));
  assert.match(src, /import \{ cardVisibleTo \} from '\.\/home-cards\.js';/);
  const guard = src.search(/if \(!cardVisibleTo\(session\.location, session\.canManage, 'orders'\)\) return;/);
  assert.ok(guard > 0 && guard < src.indexOf('showOrdersHome();', guard),
    'the guard must stop it before anything is read, painted or notified');
});

test('after a save, focus goes back to the switch that was tapped', () => {
  const src = withoutComments(read('js/staff/home-cards-screen.js'));
  assert.match(src, /const hadFocus = document\.activeElement\?\.id === pillId;/);
  assert.match(src, /paint\(\);\s*if \(hadFocus\) list\.querySelector\(`#\$\{pillId\}`\)\?\.focus\(\);/);
});

// ── 6. Hidden means silent, for employees ────────────────────────────────────
//
// Federico, 13 Sep 2026: «se le nascondo i dipendenti non ricevono le notifiche perche'
// vuol dire che non voglio che usino quella scheda».

test('⚠️ every notification kind belongs to the card whose page it opens', () => {
  for (const kind of PUSH_KINDS) {
    const card = cardForKind(kind);
    assert.ok(HIDEABLE_IDS.includes(card), `${kind} → ${card} is not a card this app can hide`);
    assert.equal(targetPage(kind), `./${PAGE_OF[card]}`, `${kind} opens a page that is not its card's`);
  }
});

test('employeePush is true exactly for the cards an employee can be notified about', () => {
  // A client order goes to every phone; a timer to whoever set it; an order list only to
  // whoever runs the place (managersAmong), so an employee has nothing to silence there.
  const reachesEmployees = { order: true, timer: true, orderRequest: false };
  for (const kind of PUSH_KINDS) {
    const card = STAFF_CARDS.find(c => c.id === cardForKind(kind));
    assert.equal(card.employeePush, reachesEmployees[kind], `${kind} → ${card.id}`);
  }
  for (const card of STAFF_CARDS.filter(c => !PUSH_KINDS.some(k => cardForKind(k) === c.id))) {
    assert.equal(card.employeePush, false, `${card.id} receives no notification at all`);
  }
});

const INDEX = read('functions/index.js');
function serverFn(head) {
  const start = INDEX.indexOf(head);
  assert.ok(start >= 0, `${head} not found in functions/index.js`);
  const ends = [INDEX.indexOf('\nexport const', start + 10), INDEX.indexOf('\nasync function', start + 10)]
    .filter(i => i > 0);
  return withoutComments(INDEX.slice(start, ends.length ? Math.min(...ends) : undefined));
}
const HELPER = serverFn('async function uidsPastHiddenCard(');

// The decision, RUN — the server hands mayBeTold() the two documents it read.
test('⚠️⚠️ mayBeTold: nothing hidden means everybody, and no role is needed', () => {
  for (const doc of [null, {}, { [HIDDEN_FIELD]: { orders: true } }, { [HIDDEN_FIELD]: { calculator: false } }]) {
    assert.equal(mayBeTold(doc, 'calculator', ['a', 'b'], new Map()), null, JSON.stringify(doc));
  }
});

test('⚠️⚠️ mayBeTold: a hidden card silences employees and nobody else', () => {
  const doc = { [HIDDEN_FIELD]: { calculator: true } };
  const access = new Map([['emp', true], ['mgr', 'manager'], ['own', 'owner'], ['typo', 'manager ']]);
  const told = mayBeTold(doc, 'calculator', ['emp', 'mgr', 'own', 'typo', 'unread'], access);
  assert.deepEqual([...told].sort(), ['mgr', 'own'],
    'owner and manager (a head chef holds manager) are told; an employee, a corrupt role and an unreadable one are not');
});

test('mayBeTold: no uid, a non-string uid and a missing map tell nobody and do not throw', () => {
  const doc = { [HIDDEN_FIELD]: { catalogue: true } };
  assert.deepEqual([...mayBeTold(doc, 'catalogue', ['', null, undefined, 42], new Map([['42', 'owner']]))], []);
  assert.deepEqual([...mayBeTold(doc, 'catalogue', ['x'], undefined)], []);
  assert.deepEqual([...mayBeTold(doc, 'catalogue', 'x', new Map())], []);
});

test('⚠️⚠️ the server hands the decision to the app\'s own model, and reads the role for THIS venue', () => {
  assert.match(INDEX, /import \{ isHiddenForStaff, mayBeTold \} from '\.\/home-cards\.js';/);
  assert.match(HELPER, /const card = cardForKind\(kind\);/);
  assert.match(HELPER, /accessByUid\.set\(uid, \(snap\.data\(\)\.locations \|\| \{\}\)\[lid\]\)/,
    'the membership value of THIS venue — another key would silence its managers');
  assert.match(HELPER, /return mayBeTold\(location, card, uids, accessByUid\);\s*\}\s*$/,
    'the helper must END by returning the model\'s answer, not one of its own');
});

test('nothing hidden: one read, and nobody silenced', () => {
  const gate = HELPER.indexOf('if (!isHiddenForStaff(location, card)) return null;');
  assert.ok(gate > 0 && gate < HELPER.indexOf('users/'), 'no role is read unless the card IS hidden (P14)');
});

test('⚠️ a venue that cannot be read silences nobody; a role that cannot be read is not told', () => {
  assert.match(HELPER,
    /catch \(err\) \{\s*logger\.warn\('Could not read the hidden Home cards[^']*', \{ lid \}\);\s*return null;/);
  const roleCatch = HELPER.slice(HELPER.lastIndexOf('catch (err)'), HELPER.indexOf('return mayBeTold('));
  assert.doesNotMatch(roleCatch, /accessByUid\.set/, 'an unreadable role must be left out, never guessed');
});

test('⚠️ a client order is not sent to an employee whose Calculator card is hidden', () => {
  const fn = serverFn('export const notifyClientOrder');
  const gate = fn.indexOf("await uidsPastHiddenCard(lid, 'order', targets.map(d => d.data().uid))");
  assert.ok(gate > fn.indexOf('awaySet(lid)') && gate < fn.indexOf('sendTo('),
    'after the holiday filter, before anything is sent');
  assert.match(fn, /const told = allowed \? targets\.filter\(d => allowed\.has\(d\.data\(\)\.uid\)\) : targets;/,
    'the phones told are the ones the card check let through');
  assert.match(fn, /told\.map\(d => sendTo\(/, 'and the send goes to the filtered phones, not all of them');
  assert.match(fn, /if \(!told\.length\) \{\s*logger\.info\([^)]*\);\s*return;/,
    'it stops only when NOBODY is left — flipped, an order would reach no phone whenever somebody could be told');
});

test('⚠️ a timer is not sent to an employee whose Catalogue card is hidden', () => {
  const fn = serverFn('export const sendTimerPush');
  const gate = fn.indexOf("await uidsPastHiddenCard(lid, 'timer', [timer.uid])");
  assert.ok(gate > 0 && gate < fn.indexOf('sendTo('), 'checked before the send');
  assert.ok(gate > fn.indexOf('isStillDue('), 'and after isStillDue, so a cancelled timer costs no extra read');
  assert.match(fn, /if \(allowed && !allowed\.has\(timer\.uid\)\) \{[\s\S]{0,140}return;/);
});

test('a switch that is ON still looks and feels tappable', () => {
  assert.match(read('js/staff/home-cards-screen.js'),
    /class: `people-pill people-pill--switch\$\{shown \? ' people-pill--on' : ''\}`/);
  const css = read('tokens.css');
  assert.match(css, /\.people-pill--switch\.people-pill--on\s*\{[^}]*cursor:\s*pointer/);
  assert.match(css, /\.people-pill--switch\.people-pill--on:active\s*\{[^}]*scale\(\.97\)/);
});

// ── 7. The order, and the money cards (13 Sep 2026) ──────────────────────────
//
// Federico: «devo poter cambiare l'ordine trascinandole» (for the whole venue), and
// «voglio poter decidere tutto dall'app tutte le card che ci sono nella home».

test('⚠️ a saved order keeps known ids once each and drops everything else', () => {
  assert.deepEqual(cleanOrder(['orders', 'orders', 'nope', 7, null, 'calculator']), ['orders', 'calculator']);
  for (const bad of [null, undefined, 'orders', {}, 42]) assert.deepEqual(cleanOrder(bad), []);
});

test('the server accepts only a clean, non-empty list of known ids', () => {
  assert.equal(isValidOrder(['pastries', 'orders']), true);
  assert.equal(isValidOrder([...HIDEABLE_IDS]), true);
  for (const bad of [[], ['orders', 'orders'], ['orders', 'nope'], 'orders', null, [...HIDEABLE_IDS, 'calculator'], [1]]) {
    assert.equal(isValidOrder(bad), false, JSON.stringify(bad));
  }
});

test('⚠️⚠️ the Home follows the saved order, and a card the order does not name keeps its place after it', () => {
  const markup = ['calculator', 'catalogue', 'orders', 'suppliers', 'pastries'];
  assert.deepEqual(orderedCardIds({}, markup), markup, 'no order: the markup order');
  assert.deepEqual(orderedCardIds(null, markup), markup);
  assert.deepEqual(orderedCardIds({ [ORDER_FIELD]: ['pastries', 'orders'] }, markup),
    ['pastries', 'orders', 'calculator', 'catalogue', 'suppliers']);
  assert.deepEqual(orderedCardIds({ [ORDER_FIELD]: ['foodcost', 'orders'] }, ['calculator', 'orders']),
    ['orders', 'calculator'], 'a card the Home does not show is simply not there');
  assert.deepEqual(orderedCardIds({ [ORDER_FIELD]: 'corrupt' }, markup), markup);
});

const ONBOARDING_ORDER = (() => {
  const start = ONBOARDING.indexOf('export const setHomeCardOrder');
  assert.ok(start > 0, 'functions/onboarding.js must export setHomeCardOrder');
  const next = ONBOARDING.indexOf('export const', start + 10);
  return withoutComments(next === -1 ? ONBOARDING.slice(start) : ONBOARDING.slice(start, next));
})();

test('⚠️ setHomeCardOrder refuses a bad list and an employee, and checks the role before it writes', () => {
  assert.match(ONBOARDING_ORDER, /if \(!isValidOrder\(order\)\) \{\s*throw new HttpsError\('invalid-argument'/);
  assert.match(ONBOARDING_ORDER, /!\/\^\[A-Za-z0-9\]\[A-Za-z0-9_-\]\{0,63\}\$\/\.test\(locationId\)/);
  const role = ONBOARDING_ORDER.indexOf("access !== 'owner' && access !== 'manager'");
  assert.ok(role > 0 && role < ONBOARDING_ORDER.indexOf('.set('), 'the role is checked before the write');
  assert.match(ONBOARDING_ORDER, /\.set\(\{ homeCardOrder: \[\.\.\.order\] \}, \{ merge: true \}\)/,
    'the whole list, merged into the document');
  assert.match(read('functions/index.js'), /\bsetHomeCardOrder\b/, 'a callable missing from index.js is never deployed');
  assert.match(ONBOARDING, /import \{ HIDEABLE_IDS, OPT_IN_IDS, isValidOrder \} from '\.\/home-cards\.js';/);
});

test('⚠️⚠️ setStaffCard writes a money card as SHOWN, into the field the rules read', () => {
  assert.match(CALLABLE,
    /if \(OPT_IN_IDS\.includes\(card\)\) \{\s*await db\(\)\.doc\(`locations\/\$\{locationId\}`\)\.set\(\{ staffShownCards: \{ \[card\]: !hidden \} \}, \{ merge: true \}\);/);
  assert.match(read('firestore.rules'), /l\.data\.get\('staffShownCards', \{\}\)\.get\(card, false\) == true/,
    'the rules read the same field, with the same «only true» meaning');
});

test('the Home applies the order after filtering, by moving the cards it still shows', () => {
  const src = withoutComments(read('js/home-session.js'));
  assert.match(src, /orderedCardIds\(location, cards\.map\(card => card\.dataset\.card\)\)/);
  assert.ok(src.indexOf('filterCards(session);') < src.indexOf('orderCards(session.location);'));
  assert.match(src, /const allowed = allowedSections\(location\);/,
    'the venue decides the sections; the card, not the role, decides the money');
});

test('⚠️ a page that names its card is judged by the card, so a shown employee is not sent away', () => {
  assert.match(read('js/auth-gate.js'),
    /if \(pageSection && \(pageCard\s*\? !isSectionAllowed\(session\.location, pageSection\)\s*: !isSectionAllowedFor\(session\.location, session\.role, pageSection\)\)\)/);
});

test('⚠️ the order is dragged with a hold on touch, never from the switch, and saved only once the server agrees', () => {
  const src = withoutComments(read('js/staff/home-cards-screen.js'));
  assert.match(src, /import Sortable from '\.\.\/vendor\/sortable\.esm\.js';/);
  assert.match(src, /delay: 200,\s*delayOnTouchOnly: true,/);
  assert.match(src, /filter: '\.people-pill',\s*preventOnFilter: false,/);
  const save = src.slice(src.indexOf('async function saveOrder('), src.indexOf('function moveWithKeys('));
  assert.ok(save.indexOf('await setHomeCardOrder(') < save.indexOf('orderOverride = next;'));
  assert.match(save, /catch \(err\) \{[\s\S]*order = previous;\s*paint\(\);/, 'a failed save puts the order back');
});

test('the order can be changed without a pointer: the grip moves its row with the arrow keys', () => {
  const src = withoutComments(read('js/staff/home-cards-screen.js'));
  assert.match(src, /onKeydown: \(event\) => moveWithKeys\(card\.id, event\)/);
  assert.match(src, /if \(event\.key !== 'ArrowUp' && event\.key !== 'ArrowDown'\) return;/);
  assert.match(read('tokens.css'), /\.home-cards-grip\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/);
});

test('⚠️⚠️ the Stocktake shows an employee no money and no end of month', () => {
  const main = withoutComments(read('js/inventory/inventory-main.js'));
  assert.match(main, /let mayManage = false;/, 'nothing that is money is drawn before the session is known');
  assert.match(main, /costBtn\.hidden = !mayManage;\s*closeBtn\.hidden = !mayManage;/);
  assert.match(main, /onCarry: mayManage \? handleCarry : null,/);
  assert.match(main, /money: mayManage,/);
  assert.match(main, /function showUsage\(\) \{\s*if \(!mayManage\) \{ showList\(\); return; \}/);
  assert.match(main, /async function handleClose\(\) \{\s*if \(!mayManage\) return;/);
  assert.match(main, /const next = currentSession\(\)\.canManage === true;/);
  const detail = withoutComments(read('js/inventory/inventory-detail.js'));
  assert.match(detail, /if \(money\) \{\s*const \{ value, blocker \} = lineValue\(/);
  assert.match(detail, /const packField = !money \|\| ingredient\.priceUnit === 'pcs' \? null/);
});
