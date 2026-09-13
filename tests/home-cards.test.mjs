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
  STAFF_CARDS, HIDEABLE_IDS, HIDDEN_FIELD, isHiddenForStaff, cardVisibleTo, mayBeTold,
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
});

// ── 1. The judgement ─────────────────────────────────────────────────────────

test('a venue that has never heard of the field hides nothing', () => {
  for (const doc of [null, undefined, {}, { name: 'Bakery' }, 'corrupt', 42]) {
    for (const id of HIDEABLE_IDS) {
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
  for (const id of HIDEABLE_IDS) {
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
  const doc = { [HIDDEN_FIELD]: { foodcost: true, inventory: true, toString: true } };
  for (const id of [undefined, '', 'foodcost', 'inventory', 'toString', '__proto__']) {
    assert.equal(cardVisibleTo(doc, false, id), true, String(id));
  }
  assert.ok(!HIDEABLE_IDS.includes('foodcost') && !HIDEABLE_IDS.includes('inventory'),
    'an employee never sees Food cost or Stocktake, so there is nothing to hide');
});

test('the ids are exactly the five cards an employee can be shown', () => {
  assert.deepEqual([...HIDEABLE_IDS], ['calculator', 'catalogue', 'orders', 'suppliers', 'pastries']);
  assert.ok(Object.isFrozen(STAFF_CARDS) && STAFF_CARDS.every(Object.isFrozen));
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
  for (const page of ['foodcost.html', 'inventory.html']) {
    const tag = home.match(new RegExp(`<a class="home-card" href="${page.replace('.', '\\.')}"[^>]*>`));
    assert.ok(tag && !/data-card=/.test(tag[0]), `${page} is not hideable and must carry no data-card`);
  }
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
  assert.match(ONBOARDING, /import \{ HIDEABLE_IDS \} from '\.\/home-cards\.js';/);
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
  assert.match(src, /import \{ cardVisibleTo \} from '\.\/home-cards\.js';/);
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
  assert.match(src, /sectionsFor\(session\.location, 'staff'\)/);
  const call = src.indexOf('await setStaffCard(');
  const remember = src.indexOf('override[card.id] = hide');
  assert.ok(call > 0 && remember > call,
    'remembering the switch before the server agrees shows a change the venue never got');
});

test('⚠️ every hide asks first — and showing never does', () => {
  // Federico, 13 Sep 2026: «tutte le impostazioni quando le vuoi nascondere devono chiedere conferma».
  const src = withoutComments(read('js/staff/home-cards-screen.js'));
  const ask = src.search(/if \(hide\) \{[\s\S]{0,400}?const ok = await confirmDialog\(/);
  assert.ok(ask > 0, 'hiding any card must ask');
  assert.ok(ask < src.indexOf('await setStaffCard('), 'and it must come before the save');
  assert.equal((src.match(/confirmDialog\(/g) || []).length, 1,
    'one dialog, inside the hide branch — showing a card again never asks');
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
  assert.match(read('js/home-session.js'), /function filterCards\(\{ location, role, canManage \}\)/,
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
