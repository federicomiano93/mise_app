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
  STAFF_CARDS, HIDEABLE_IDS, HIDDEN_FIELD, isHiddenForStaff, cardVisibleTo,
} from '../js/home-cards.js';

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

test('⚠️⚠️ the server\'s list and the app\'s list are the same list', () => {
  const m = ONBOARDING.match(/const STAFF_CARD_IDS = Object\.freeze\(\[([^\]]*)\]\)/);
  assert.ok(m, 'functions/onboarding.js must declare STAFF_CARD_IDS');
  const ids = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  assert.deepEqual(ids, [...HIDEABLE_IDS],
    'a deploy uploads only functions/, so its copy can drift — and a drifted id is a switch the server refuses');
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
  assert.match(CALLABLE, /!STAFF_CARD_IDS\.includes\(card\)[\s\S]{0,80}invalid-argument/);
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
  const src = withoutComments(read('js/home-session.js'));
  assert.match(src,
    /if \(session\.canManage\) \{\s*logoutHost\.append\(button\(t\('homeCards\.title'\)[\s\S]{0,200}openHomeCards\(session\)/);
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

test('⚠️ hiding the Catalogue asks first — the allergen sheet is behind it', () => {
  const src = withoutComments(read('js/staff/home-cards-screen.js'));
  const ask = src.search(/if \(hide && card\.id === 'catalogue'\) \{\s*const ok = await confirmDialog\(/);
  assert.ok(ask > 0, 'the confirmation must guard hiding the Catalogue');
  assert.ok(ask < src.indexOf('await setStaffCard('), 'and it must come before the save');
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

test('a switch that is ON still looks and feels tappable', () => {
  assert.match(read('js/staff/home-cards-screen.js'),
    /class: `people-pill people-pill--switch\$\{shown \? ' people-pill--on' : ''\}`/);
  const css = read('tokens.css');
  assert.match(css, /\.people-pill--switch\.people-pill--on\s*\{[^}]*cursor:\s*pointer/);
  assert.match(css, /\.people-pill--switch\.people-pill--on:active\s*\{[^}]*scale\(\.97\)/);
});
