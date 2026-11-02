// The owner of the sales side and the owner of the kitchen (Federico, 1 Nov 2026).
//
// ⚠️ A MEMBERSHIP VALUE LIVES IN THREE FILES THAT RUN IN THREE PLACES, and one that does not
// know it is a LOCKOUT, not a demotion: that was missed on three separate days with 'manager'
// alone. Nothing about using the app reveals which of the three has drifted, so this reads
// them side by side. What each role may reach is proven against the emulator by the
// partialOwners scenario in tests/rules/firestore-rules-check.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  accessValue, locationsOf, sectionsFor, roleHasCard, ROLE_CARDS, NOT_FOR_ROLE,
  OWNER_SALES, OWNER_KITCHEN, SECTIONS,
} from '../js/sections.js';
import { ROLES, roleOf, canManage, canManageVenue, isOwner, isValidRole } from '../js/roles.js';
import { STAFF_CARDS } from '../js/home-cards.js';
import { readRecipe } from '../functions/recipe-photo-model.js';
import { readPackText } from '../functions/pack-photo-model.js';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const RULES = read('firestore.rules').replace(/^\s*\/\/.*$/gm, '');
const SERVER = read('functions/onboarding.js');

const sorted = list => [...list].map(String).sort();
const values = text => text.split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);

function ruleBody(name) {
  const start = RULES.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `firestore.rules has no ${name}()`);
  return RULES.slice(start, RULES.indexOf('\n    }', start));
}

const doc = value => ({ locations: { main: value } });

test('⚠️ the rules, the server and the app open a location to the same values', () => {
  const inRules = ruleBody('isMemberValue').match(/value in \[([^\]]+)\]/);
  assert.ok(inRules, 'isMemberValue() no longer lists the values');
  const inServer = SERVER.match(/const ACCESS_VALUES = \[([^\]]+)\]/);
  assert.ok(inServer, 'functions/onboarding.js no longer lists the values');

  const wanted = sorted(['true', 'manager', 'owner', 'owner-sales', 'owner-kitchen']);
  assert.deepEqual(sorted(values(inRules[1])), wanted);
  assert.deepEqual(sorted(values(inServer[1])), wanted);
  for (const value of [true, 'manager', 'owner', 'owner-sales', 'owner-kitchen']) {
    assert.equal(accessValue(doc(value), 'main'), value, `js/sections.js refuses ${value}`);
    assert.deepEqual(locationsOf(doc(value)), ['main'], `locationsOf drops ${value}`);
  }
});

test('⚠️ cardAccess() and member() share the list, so neither can fall behind', () => {
  assert.match(ruleBody('member'), /isMemberValue\(/);
  assert.match(ruleBody('cardAccess'), /isMemberValue\(access\)/);
  assert.doesNotMatch(ruleBody('member') + ruleBody('cardAccess'), /in \[true/,
    'a second copy of the list is how one of them falls behind');
});

test('a value that only looks like one of them opens nothing', () => {
  for (const wrong of ['owner-Sales', 'Owner-sales', 'owner_kitchen', 'sales', 'kitchen', 'owner-sales ', ' owner-kitchen']) {
    assert.equal(accessValue(doc(wrong), 'main'), false, wrong);
    assert.deepEqual(locationsOf(doc(wrong)), [], wrong);
    assert.equal(canManage(doc(wrong), 'main'), false, wrong);
    assert.equal(roleOf(doc(wrong), 'main'), 'staff', wrong);
  }
});

test('the server writes the membership value the role names, and nothing wider', () => {
  const fn = SERVER.slice(SERVER.indexOf('function membershipValue'), SERVER.indexOf('\n}', SERVER.indexOf('function membershipValue')));
  assert.match(fn, /if \(role === 'owner-sales'\) return 'owner-sales';/);
  assert.match(fn, /if \(role === 'owner-kitchen'\) return 'owner-kitchen';/);
  assert.match(fn, /return true;/, 'anything unknown stays an ordinary employee');
  assert.match(SERVER, /const WRITABLE_ROLES = \['owner', 'manager', 'owner-sales', 'owner-kitchen', 'staff'\]/);
});

// ⚠️ THE ONE THAT WOULD HAND OVER EVERYTHING. A partial owner who could hire could name a
// second account of their own as the full owner.
test('⚠️ a partial owner hires nobody and changes no venue setting', () => {
  const owner = SERVER.slice(SERVER.indexOf('async function requireOwner'), SERVER.indexOf('\n}', SERVER.indexOf('async function requireOwner')));
  assert.match(owner, /await accessValue\(uid, locationId\) !== 'owner'/,
    'hiring asks for the exact word, which a partial owner does not hold');

  const gates = SERVER.match(/if \(access !== 'owner' && access !== 'manager'\) \{/g) || [];
  assert.ok(gates.length >= 6, `the venue switches ask for owner or manager: found ${gates.length}`);
  assert.doesNotMatch(SERVER, /access === 'owner-|access !== 'owner-/,
    'no switch may start accepting a partial owner by accident');

  for (const value of [OWNER_SALES, OWNER_KITCHEN]) {
    assert.equal(isOwner(doc(value), 'main'), false, value);
    assert.equal(canManageVenue(doc(value), 'main'), false, value);
  }
  assert.equal(canManageVenue(doc('owner'), 'main'), true);
  assert.equal(canManageVenue(doc('manager'), 'main'), true);
  assert.equal(canManageVenue(doc(true), 'main'), false);
});

test('⚠️ the last-owner guard counts only the full owner, so a venue always keeps one', () => {
  assert.match(SERVER, /\.where\('role', '==', 'owner'\)/);
  assert.match(SERVER, /if \(role !== 'owner'\) \{\s*const owners = await tx\.get\(ownersQuery\);/,
    'making the last owner a partial owner is a demotion like any other');
});

test('six digits stay for employees: a partial owner is invited with a link', () => {
  assert.match(SERVER, /if \(kind === 'digits' && role !== 'staff'\) \{/);
});

test('a partial owner runs their own side, and is one of the named roles', () => {
  for (const value of [OWNER_SALES, OWNER_KITCHEN]) {
    assert.equal(isValidRole(value), true, value);
    assert.ok(ROLES.includes(value), value);
    assert.equal(roleOf(doc(value), 'main'), value, value);
    assert.equal(canManage(doc(value), 'main'), true, value);
  }
});

test('⚠️ the app keeps each one out of the same sections the rules refuse', () => {
  const narrowed = ruleBody('narrowedOut');
  const sales = narrowed.match(/value == 'owner-sales' && section in \[([^\]]+)\]/);
  const kitchen = narrowed.match(/value == 'owner-kitchen' && section == '([a-z]+)'/);
  assert.ok(sales && kitchen, 'narrowedOut() changed shape: this test is checking nothing');
  assert.deepEqual(sorted(values(sales[1])), sorted(NOT_FOR_ROLE[OWNER_SALES]));
  assert.deepEqual([kitchen[1]], [...NOT_FOR_ROLE[OWNER_KITCHEN]]);
  assert.match(ruleBody('canUseAs'), /!narrowedOut\(value, section\)/, 'the rule must actually ask');
});

test('what each one sees of a venue that has every section', () => {
  const venue = { name: 'A place' };
  assert.deepEqual(sectionsFor(venue, OWNER_SALES),
    { orders: false, calculator: false, catalogue: false, pastries: false, foodcost: true });
  assert.deepEqual(sectionsFor(venue, OWNER_KITCHEN),
    { orders: true, calculator: true, catalogue: true, pastries: true, foodcost: false });
});

test('a role narrows, it never widens: a partial owner gets no section the venue lacks', () => {
  const none = { sections: Object.fromEntries(SECTIONS.map(s => [s, false])) };
  for (const value of [OWNER_SALES, OWNER_KITCHEN]) {
    assert.ok(Object.values(sectionsFor(none, value)).every(on => on === false), value);
  }
});

test('the three older roles see exactly what they saw', () => {
  const venue = { name: 'A place' };
  const all = { orders: true, calculator: true, catalogue: true, pastries: true, foodcost: true };
  assert.deepEqual(sectionsFor(venue, 'owner'), all);
  assert.deepEqual(sectionsFor(venue, 'manager'), all);
  assert.deepEqual(sectionsFor(venue, 'staff'), { ...all, foodcost: false });
  for (const card of STAFF_CARDS) {
    for (const role of ['owner', 'manager', 'staff', 'nonsense', undefined, null]) {
      assert.equal(roleHasCard(role, card.id), true, `${role}/${card.id}`);
    }
  }
});

test('⚠️ every card has exactly one partial owner, so nothing falls between the two', () => {
  const ids = STAFF_CARDS.map(card => card.id).sort();
  const dealt = [...ROLE_CARDS[OWNER_SALES], ...ROLE_CARDS[OWNER_KITCHEN]].sort();
  assert.deepEqual(dealt, ids, 'a card nobody has, or a card two people have, is a decision to take with him');
  assert.equal(roleHasCard(OWNER_SALES, 'foodcost'), true);
  assert.equal(roleHasCard(OWNER_SALES, 'inventory'), false);
  assert.equal(roleHasCard(OWNER_KITCHEN, 'inventory'), true);
  assert.equal(roleHasCard(OWNER_KITCHEN, 'foodcost'), false);
});

test('a name that is not a role is not looked up on the table\'s prototype', () => {
  for (const name of ['constructor', 'toString', '__proto__']) {
    assert.equal(roleHasCard(name, 'foodcost'), true, name);
    assert.doesNotThrow(() => sectionsFor({}, name), name);
  }
});

// ⚠️ THESE TWO CALLS COST MONEY, and the rules cannot stop them: a callable skips the rules.
// The owner of the sales side may save neither what they read, so they must be refused
// before anything is charged. The kitchen saves both.
test('⚠️ the owner of the sales side is not charged for a photo they could not keep', async () => {
  const IMAGE = { mediaType: 'image/jpeg', data: 'A'.repeat(100) };
  const NOW = Date.parse('2026-11-01T10:00:00Z');
  const venue = { recipePhoto: true, packPhoto: true };
  const run = async (read, value) => {
    const charged = [];
    let asked = 0;
    const out = await read({
      uid: 'u1', locationId: 'bakery', images: [IMAGE], now: NOW,
      store: {
        access: async () => value,
        location: async () => venue,
        charge: async (path, decide) => { charged.push(path); return decide(null); },
      },
      ask: async () => { asked++; throw new Error('stop here: only the refusal is under test'); },
    }).catch(() => ({ reachedTheReader: true }));
    return { out, charged, asked };
  };
  for (const read of [readRecipe, readPackText]) {
    const refused = await run(read, 'owner-sales');
    assert.equal(refused.out.error?.code, 'permission-denied', read.name);
    assert.deepEqual(refused.charged, [], `${read.name} charged a refusal`);
    assert.equal(refused.asked, 0, `${read.name} asked the reader for a refusal`);
    // The other four go on being charged, so this cannot pass by refusing everybody.
    for (const value of [true, 'manager', 'owner', 'owner-kitchen']) {
      const allowed = await run(read, value);
      assert.notEqual(allowed.out.error?.code, 'permission-denied', `${read.name}/${value}`);
      assert.ok(allowed.charged.length > 0, `${read.name}/${value} never reached the allowance`);
    }
  }
});

test('⚠️ the Calculator document: sales may change the clients and never a recipe', () => {
  const body = ruleBody('writesCalculatorConfigAs');
  assert.match(body, /resource != null/, 'a partial owner starts no document');
  const keys = body.match(/affectedKeys\(\)\.hasOnly\(\s*\[([^\]]+)\]/);
  assert.ok(keys, 'the save is no longer judged by the keys it changes');
  assert.deepEqual(sorted(values(keys[1])), sorted(['bakery', 'clients', 'configModel', 'configRev', 'whatsappClients']));
});

test('⚠️ the weighing door: three numbers, and the same bounds as the catalogue', () => {
  const block = RULES.slice(RULES.indexOf('match /recipes/{id}'));
  const doorAt = block.indexOf('allow update: if weighsRecipeLoss(lid)');
  assert.ok(doorAt > 0, 'the weighing door is gone');
  const door = block.slice(doorAt, block.indexOf('allow delete', doorAt));
  const keys = door.match(/affectedKeys\(\)\.hasOnly\(\s*\[([^\]]+)\]/);
  assert.deepEqual(sorted(values(keys[1])), sorted(['bakery', 'lossPct', 'rawGrams', 'cookedGrams']));
  assert.match(door, /lossFieldsValid\(request\.resource\.data\)/);
  const catalogueAt = block.indexOf('allow create, update: if canUse(lid, \'catalogue\')');
  assert.ok(catalogueAt > 0 && catalogueAt < doorAt, 'the catalogue\'s own rule comes first');
  assert.match(block.slice(catalogueAt, doorAt), /lossFieldsValid\(request\.resource\.data\)/,
    'both must share the bounds, or one of them drifts');
});

test('money the kitchen must not reach stays behind the Food cost card', () => {
  const block = (from, to) => RULES.slice(RULES.indexOf(from), RULES.indexOf(to, RULES.indexOf(from)));
  const products = block('match /products/{id}', 'match /inventory/{monthId}');
  assert.ok(products.includes("cardAccess(lid, 'foodcost', 'foodcost')"), 'products changed gate');
  assert.ok(!products.includes("'prices'"), 'a product is not a purchase price');
  const settings = block('match /foodcost-settings/{settingsId}', 'match /products/{id}');
  assert.ok(settings.includes("canManage(lid, 'foodcost')"), 'the labour rate changed gate');
  assert.doesNotMatch(settings, /managesPrices/, 'the labour rate is not a purchase price');
  assert.match(ruleBody('cardNarrowedOut'), /value == 'owner-kitchen' && card == 'foodcost'/);
  assert.match(ruleBody('cardNarrowedOut'), /value == 'owner-sales' && card == 'inventory'/);
});

// ── The screens and the server: who is told, who sees what ───────────────────────────────────

const text = f => read(f);
const stripComments = src => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');

test('⚠️ cardVisibleTo answers by role: a partial owner gets exactly their own cards', async () => {
  const { cardVisibleTo } = await import('../js/home-cards.js');
  const everything = STAFF_CARDS.map(c => c.id);
  const hidesAll = { staffHiddenCards: Object.fromEntries(everything.map(id => [id, true])) };
  const showsAll = { staffShownCards: Object.fromEntries(everything.map(id => [id, true])) };
  for (const role of [OWNER_SALES, OWNER_KITCHEN]) {
    for (const venue of [{}, hidesAll, showsAll, null]) {
      const seen = everything.filter(id => cardVisibleTo(venue, true, id, role));
      assert.deepEqual(sorted(seen), sorted(ROLE_CARDS[role]), `${role} with ${JSON.stringify(venue)}`);
    }
  }
  // The three older roles are exactly what they were.
  assert.equal(cardVisibleTo(hidesAll, true, 'foodcost', 'owner'), true);
  assert.equal(cardVisibleTo(hidesAll, true, 'orders', 'manager'), true);
  assert.equal(cardVisibleTo(hidesAll, false, 'orders', 'staff'), false);
  assert.equal(cardVisibleTo({}, false, 'orders', 'staff'), true);
  assert.equal(cardVisibleTo({ staffShownCards: { foodcost: true } }, false, 'foodcost', 'staff'), true);
  assert.equal(cardVisibleTo({}, false, 'foodcost', 'staff'), false);
  assert.equal(cardVisibleTo(hidesAll, true, 'orders'), true, 'no role: nothing narrows it');
});

test('⚠️ the table of cards has the same keys as the sections', () => {
  assert.deepEqual(sorted(Object.keys(ROLE_CARDS)), sorted([OWNER_SALES, OWNER_KITCHEN]));
});

function callsOf(src, name) {
  const code = stripComments(src);
  const found = [];
  const re = new RegExp(`(?<![.\\w$])${name}\\(`, 'g');
  for (const m of code.matchAll(re)) {
    if (/function\s+$/.test(code.slice(0, m.index))) continue;
    let depth = 1, args = 1, empty = true, quote = null;
    for (let i = m.index + m[0].length; i < code.length && depth > 0; i++) {
      const ch = code[i];
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; empty = false; continue; }
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      else if (ch === ',' && depth === 1) args++;
      if (depth > 0 && !/\s/.test(ch)) empty = false;
    }
    found.push(empty ? 0 : args);
  }
  return found;
}

function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
    if (entry.isDirectory()) { if (entry.name !== 'vendor') out.push(...jsFiles(`${dir}/${entry.name}`)); }
    else if (entry.name.endsWith('.js') && entry.name !== 'firebase.example.js') out.push(`${dir}/${entry.name}`);
  }
  return out;
}

test('⚠️ every caller of the four card gates passes the role', () => {
  const wanted = { cardVisibleTo: 4, mayOpenFoodCost: 3, mayOpenOrders: 3, mayEditRecords: 3 };
  const known = {
    cardVisibleTo: ['js/auth-gate.js', 'js/home-session.js', 'js/home-orders-badge.js', 'js/kiosk.js', 'js/recipe-link.js', 'js/records.js'],
    mayOpenFoodCost: ['js/catalogue/catalogue-main.js'],
    mayOpenOrders: ['js/catalogue/catalogue-main.js'],
    mayEditRecords: ['js/orders/orders-main.js', 'js/catalogue/catalogue-main.js'],
  };
  const files = jsFiles('js');
  assert.ok(files.length > 100, 'the walk found no files');
  for (const [name, args] of Object.entries(wanted)) {
    const seenIn = new Set();
    for (const file of files) {
      const calls = callsOf(text(file), name);
      if (calls.length) seenIn.add(file);
      // ⚠️ mayBeTold() is the one deliberate exception: it applies the role itself (toldAboutCard) and passes
      // `canManage` for the four roles that run a place, so the 3-argument call inside it is right.
      if (file === 'js/home-cards.js') continue;
      calls.forEach(n => assert.equal(n, args, `${file} calls ${name}() with ${n} arguments, not ${args}: the role is missing`));
    }
    for (const file of known[name]) assert.ok(seenIn.has(file), `the walk no longer finds ${name}() in ${file}`);
  }
});

test('⚠️ mayBeTold: a hidden card tells each partial owner about their own side only', async () => {
  const { mayBeTold } = await import('../js/home-cards.js');
  const access = new Map([['kit', OWNER_KITCHEN], ['sal', OWNER_SALES], ['emp', true], ['own', 'owner']]);
  const who = (card, venue) => [...mayBeTold(venue, card, ['kit', 'sal', 'emp', 'own'], access)].sort();
  const hide = card => ({ staffHiddenCards: { [card]: true } });
  assert.deepEqual(who('calculator', hide('calculator')), ['kit', 'own', 'sal'],
    'a client\'s order opens the Calculator, which is the sales owner\'s business');
  assert.deepEqual(who('catalogue', hide('catalogue')), ['kit', 'own']);
  assert.deepEqual(who('orders', hide('orders')), ['kit', 'own']);
  assert.deepEqual(who('foodcost', {}), ['own'], 'the sales owner is told about the Calculator only (his choice, 1 Nov 2026)');
  assert.equal(mayBeTold({}, 'orders', ['kit'], access), null, 'nothing hidden: nobody\'s role is read');
});

test('⚠️ receivesOrderLists: the kitchen and the full roles, never the sales owner', async () => {
  const { receivesOrderLists, whoWillBeTold, nobodyWillBeTold, awayNames } = await import('../js/away-model.js');
  for (const role of ['owner', 'manager', OWNER_KITCHEN]) assert.equal(receivesOrderLists(role), true, role);
  for (const role of [OWNER_SALES, true, 'staff', undefined, null, 'Owner']) assert.equal(receivesOrderLists(role), false, String(role));
  const roster = [
    { uid: 'a', role: 'owner' }, { uid: 'b', role: OWNER_KITCHEN }, { uid: 'c', role: OWNER_SALES },
    { uid: 'd', role: 'staff' }, { uid: 'me', role: 'manager' },
  ];
  assert.deepEqual(whoWillBeTold(roster, new Set(), 'me').map(m => m.uid), ['a', 'b']);
  assert.equal(nobodyWillBeTold(roster, new Set(['a', 'b']), 'me'), true);
  assert.equal(nobodyWillBeTold(roster, new Set(['a']), 'me'), false);
  assert.equal(nobodyWillBeTold([{ uid: 'c', role: OWNER_SALES }], new Set(['c']), 'me'), false, 'a sales owner is nobody to wait for');
  assert.equal(awayNames(roster, new Set(['b', 'c']), 'me').length, 1, 'only the kitchen owner counts');
  assert.match(text('functions/index.js'), /return receivesOrderLists\(access\);/);
  assert.equal(text('functions/away-model.js'), text('js/away-model.js'));
});

test('⚠️ worksOnClients agrees with the list in firestore.rules', async () => {
  const { worksOnClients } = await import('../js/roles.js');
  const list = ruleBody('worksOnClientsAs').match(/value in \[([^\]]+)\]/);
  assert.ok(list, 'worksOnClientsAs() no longer lists the values');
  // The session carries 'staff' for an employee, whose membership value is `true`.
  const inRules = values(list[1]).map(v => (v === 'true' ? 'staff' : v));
  for (const role of ['staff', 'manager', 'owner', OWNER_SALES, OWNER_KITCHEN]) {
    assert.equal(worksOnClients(role), inRules.includes(role), role);
  }
});

test('⚠️ productNamesUsing: names only, from components and packaging', async () => {
  const { productNamesUsing } = await import('../functions/product-usage-model.js');
  const products = [
    { name: 'Loaf', components: [{ ingredientId: 'x' }], sellingPrice: 9 },
    { name: 'Box', packaging: [{ ingredientId: 'x' }, null] },
    { name: 'Other', components: [{ ingredientId: 'y' }] },
    { components: [{ ingredientId: 'x' }] },
    { name: 7, packaging: [{ ingredientId: 'x' }] },
    null, 'junk', { components: 'nope', packaging: 4 },
  ];
  const names = productNamesUsing('x', products);
  assert.deepEqual(names, ['Loaf', 'Box', '', '']);
  assert.ok(names.every(n => typeof n === 'string'));
  assert.deepEqual(productNamesUsing('x', null), []);
  assert.deepEqual(productNamesUsing('x', 'junk'), []);
  const { mayAskProductUsage } = await import('../functions/product-usage-model.js');
  assert.equal(mayAskProductUsage('owner-kitchen'), true);
  for (const access of ['owner', 'manager', 'owner-sales', true, false, undefined, 'owner-kitchen ']) {
    assert.equal(mayAskProductUsage(access), false, String(access));
  }
  const callable = text('functions/product-usage.js');
  const gate = callable.indexOf('if (!mayAskProductUsage(await accessValue(uid, locationId)))');
  assert.ok(gate > 0, 'the callable no longer asks');
  assert.ok(gate < callable.indexOf('/products`'), 'the gate must come before the read');
  assert.match(text('functions/index.js'), /export \{ productsUsingIngredient \} from '\.\/product-usage\.js';/);
});

test('⚠️ the kitchen merge asks the server, everybody else reads the products', () => {
  const data = text('js/orders/ingredient-merge-data.js');
  const fn = data.slice(data.indexOf('async function productsSource'));
  assert.match(fn, /if \(currentSession\(\)\.role === OWNER_KITCHEN\) \{[\s\S]*productsUsingIngredient/);
  assert.match(fn, /getDocsFromServer\(collection\(db, pathFor\(PRODUCTS\)\)\)/);
  assert.match(data, /productsSource\(bId\),/, 'checkUsage must go through it: the rules refuse the kitchen a direct read');
});

test('⚠️ the Home asks nothing of a side this person does not have', () => {
  const clients = text('js/home-client-orders-badge.js');
  assert.match(clients, /if \(!roleHasCard\(session\.role, 'calculator'\)\) return;/);
  const lists = text('js/home-order-requests-badge.js');
  assert.match(lists, /if \(!roleHasCard\(session\.role, 'orders'\)\) return;/);
  assert.equal(roleHasCard('owner-sales', 'calculator'), false);
  assert.equal(roleHasCard('owner-sales', 'orders'), false);
  assert.equal(roleHasCard('staff', 'calculator'), true, 'an employee keeps the banner');
});

test('findUsage turns the names the server sent into product uses', async () => {
  const { findUsage } = await import('../js/orders/ingredient-merge.js');
  assert.deepEqual(findUsage('x', { productNames: ['Loaf', 'Box'] }), [
    { kind: 'product', name: 'Loaf' }, { kind: 'product', name: 'Box' },
  ]);
  assert.deepEqual(findUsage('x', { productNames: [] }), []);
});

test('both roles are choices, with every word in English and Italian', async () => {
  const { ROLE_CHOICES } = await import('../js/roles.js');
  const { _dictionaries } = await import('../js/i18n.js');
  const dicts = _dictionaries();
  for (const key of [OWNER_SALES, OWNER_KITCHEN]) {
    const choice = ROLE_CHOICES.find(c => c.key === key);
    assert.ok(choice && choice.role === key && choice.title === null, key);
    const stem = choice.labelKey;
    for (const lang of ['en', 'it']) {
      for (const k of [stem, `${stem}.inSentence`, stem.replace('role.', 'role.means.'), stem.replace('role.', 'people.confirm.')]) {
        assert.ok(typeof dicts[lang][k] === 'string' && dicts[lang][k], `${lang} lacks ${k}`);
      }
    }
  }
  const people = text('js/staff/people.js');
  assert.match(people, /'owner-sales': 'role\.means\.ownerSales'/);
  assert.match(people, /'owner-kitchen': 'people\.confirm\.ownerKitchen'/);
});

test('⚠️ the screens draw only what the role may use', () => {
  const settings = text('js/calculator-settings.js');
  assert.match(settings, /const CLIENT_DOORS = \['open-clients-btn', 'open-whatsapp-btn', 'open-clientorders-btn'\];/);
  assert.match(settings, /worksOnClients\(currentSession\(\)\.role\)/);
  assert.match(settings, /export function openSettings\(\) \{\s*paintClientDoors\(\);/);
  assert.match(text('js/home-settings.js'), /session\.canManageVenue \? item\(t\('lang\.title'\)/);
  assert.match(text('js/home-settings.js'), /session\.canManageVenue \? item\(t\('homeCards\.title'\)/);
  assert.match(text('js/catalogue/catalogue-main.js'), /showPhoto: currentSession\(\)\.canManageVenue === true,/);
  assert.match(text('js/orders/registry-main.js'), /get mayChangeVenue\(\) \{\s*return canManageVenueHere\(\);/);
  assert.match(text('js/orders/registry.js'), /mayChangeVenue: actions\.mayChangeVenue === true,/);
  assert.match(text('js/orders/registry-settings.js'), /if \(mayChangeVenue\) content\.appendChild\(card\);/);
});

test('the hidden attribute really hides a Settings door', () => {
  assert.match(text('tokens.css'), /\[hidden\] \{ display: none !important; \}/);
});
