// The owner of the sales side and their clients (Federico, 1 Nov 2026, step 3 of 4).
//
// The rules that hold this up are proven against the emulator by the partialOwners scenario in
// tests/rules/firestore-rules-check.mjs. This file holds what decides, purely, who gets the card,
// what its save sends and where a refused page lands.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cardVisibleTo, roleHasCard, ROLE_ONLY_CARDS, STAFF_CARDS, HIDEABLE_IDS, isValidOrder } from '../js/home-cards.js';
import { pageWhenRefused, OWNER_SALES, OWNER_KITCHEN } from '../js/sections.js';
import { clientsOnlyWrite, needsCalculatorSave, normalizeConfig, saveFailureKey, NEEDS_CALCULATOR_SAVE } from '../js/calculator-config.js';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const RULES = read('firestore.rules').replace(/^\s*\/\/.*$/gm, '');

test('⚠️ the Clients card is on one Home only, and every doubt answers no', () => {
  assert.equal(cardVisibleTo({}, true, 'clients', OWNER_SALES), true);
  for (const role of ['owner', 'manager', OWNER_KITCHEN, 'staff', undefined, null, 'constructor', '__proto__', 'owner-sales ']) {
    assert.equal(cardVisibleTo({}, true, 'clients', role), false, `canManage ${String(role)}`);
    assert.equal(cardVisibleTo({}, false, 'clients', role), false, `employee ${String(role)}`);
    assert.equal(roleHasCard(role, 'clients'), false, String(role));
  }
});

test('the role-only card is not a card a venue can switch, order or be notified about', () => {
  assert.deepEqual([...ROLE_ONLY_CARDS], ['clients']);
  assert.equal(STAFF_CARDS.some(card => card.id === 'clients'), false);
  assert.equal(HIDEABLE_IDS.includes('clients'), false);
  assert.equal(isValidOrder(['clients']), false, 'setHomeCardOrder would store a card the server has no switch for');
});

test('⚠️ the sales save sends the address book and the revision, and the rules accept every key', () => {
  const clients = [{ id: 'c-one', name: 'One', products: [] }];
  const out = clientsOnlyWrite({ clients, recipes: [{ id: 'r' }], extraDough: {}, configRev: 3 }, { configRev: 7 });
  assert.deepEqual(Object.keys(out).sort(), ['clients', 'configRev']);
  assert.equal(out.clients, clients);
  assert.equal(out.configRev, 8, 'always server + 1, like the whole save');
  assert.equal(clientsOnlyWrite({ clients }, null).configRev, 1);

  const allowed = RULES.slice(RULES.indexOf('function writesCalculatorConfigAs(')).match(/affectedKeys\(\)\.hasOnly\(\s*\[([^\]]+)\]/);
  assert.ok(allowed, 'writesCalculatorConfigAs no longer lists the keys');
  const keys = allowed[1].split(',').map(s => s.trim().replace(/'/g, ''));
  for (const key of [...Object.keys(out), 'configModel', 'bakery']) assert.ok(keys.includes(key), `the rules refuse ${key}`);

  const src = read('js/firebase.js');
  const body = src.slice(src.indexOf('export function saveCalculatorClients'), src.indexOf('// ── The Calculator reading a recipe'));
  assert.match(body, /tx\.update\(ref, \{ \.\.\.clientsOnlyWrite\(config, snap\.data\(\)\), configModel: CONFIG_MODEL, bakery: currentLocationId\(\) \}\)/);
  assert.doesNotMatch(body, /tx\.set/, 'a set replaces the recipes');
});

test('⚠️ a config with no list of clients is refused, never sent as an empty address book', () => {
  for (const bad of [null, undefined, {}, { clients: 'x' }, { clients: { a: 1 } }]) {
    assert.throws(() => clientsOnlyWrite(bad, null), TypeError, JSON.stringify(bad));
  }
});

test('⚠️ a document in a retired shape refuses the clients-only save, because it would empty every client', () => {
  // Why: next to a top-level products[] the saved clients are read back with no products at all.
  const clients = [{ id: 'c-one', name: 'One', products: [{ id: 'p', name: 'Bread', recipeId: 'r', weight: 500 }] }];
  assert.equal(normalizeConfig({ products: [], clients }).clients[0].products.length, 0, 'the loss this guards against');
  assert.equal(normalizeConfig({ clients }).clients[0].products.length, 1);

  for (const old of [{ products: [], clients: [] }, { products: [{ id: 'p' }] }, { focaccia: { clients: [] } },
    { brioche: {} }, { sourdough: {} }, { market: { clients: [] } }]) {
    assert.equal(needsCalculatorSave(old), true, JSON.stringify(old));
  }
  assert.equal(needsCalculatorSave(null), true, 'no document: this role can change it, never start it');
  assert.equal(needsCalculatorSave({ clients: [] }), false);
  assert.equal(needsCalculatorSave({ clients: [], recipes: [], whatsappLists: [] }), false);

  const src = read('js/firebase.js');
  const body = src.slice(src.indexOf('export function saveCalculatorClients'), src.indexOf('// ── The Calculator reading a recipe'));
  assert.ok(body.indexOf('needsCalculatorSave(') < body.indexOf('tx.update('), 'asked before writing');
});

test('a venue whose Calculator has to save first says so, not «check the connection»', () => {
  assert.equal(saveFailureKey({ synced: false, reason: 'write-failed', code: NEEDS_CALCULATOR_SAVE }), 'calc.notSavedNoConfig');
  assert.equal(saveFailureKey({ synced: false, reason: 'write-failed', code: 'permission-denied' }), 'calc.notSavedOutOfDate');
  assert.equal(saveFailureKey({ synced: false, reason: 'write-failed', code: 'unavailable' }), 'calc.notSavedCheckConnection');
  assert.equal(saveFailureKey({ synced: true }), null);
});

test('⚠️ a refused page goes Home, except the Calculator for the owner of the sales side', () => {
  assert.equal(pageWhenRefused(OWNER_SALES, 'calculator'), 'clients.html#orders', 'the tap on a client order');
  for (const card of ['catalogue', 'orders', 'suppliers', 'pastries', 'inventory']) {
    assert.equal(pageWhenRefused(OWNER_SALES, card), 'index.html', card);
  }
  for (const role of ['owner', 'manager', OWNER_KITCHEN, 'staff', undefined]) {
    assert.equal(pageWhenRefused(role, 'calculator'), 'index.html', String(role));
    assert.equal(pageWhenRefused(role, 'clients'), 'index.html', String(role));
  }
});

// ── The Clients page (clients.html) ───────────────────────────────────────────────────────
const codeOf = src => src.replace(/^\s*\/\/.*$/gm, '');

test('⚠️ the page starts the store in clients-only mode, and the door stays shut until the server has answered', () => {
  const main = codeOf(read('js/clients/clients-main.js'));
  assert.match(main, /initConfig\(onConfig, \{ onlyClients: true \}\)/);
  assert.match(main, /door\.disabled = !ready/, 'the door is disabled until canSyncConfig()');
  assert.match(main, /const ready = canSyncConfig\(\) && !missing/);
  assert.match(main, /t\('calc\.loading'\)/);
  assert.match(main, /missing \? t\('clients\.noConfigYet'\)/, 'a venue with no document hears so before typing');
  assert.match(main, /repaintClientOrders\(\)/, 'the orders repaint when the config arrives');
  // Read-only: no argument, so the screen draws no «put in the calculator».
  assert.match(main, /initClientOrders\(\);/);
  assert.doesNotMatch(main, /initClientOrders\([^)]/);
  assert.match(main, /cardVisibleTo\(session\.location, session\.canManage, 'clients', session\.role\)/);
  assert.match(main, /location\.hash === '#orders'/);
  assert.match(main, /addEventListener\('hashchange'/);
  assert.doesNotMatch(main, /scheduleAlarm/, 'timers are the kitchen\'s');
});

test('the notifications row follows what the phone can do', () => {
  const main = codeOf(read('js/clients/clients-main.js'));
  assert.match(main, /pushOnForMe\(\)/);
  assert.match(main, /role: 'switch'/);
  assert.match(main, /supportText\(result\.reason\)/);
  assert.match(main, /await enablePush\(\)/);
  assert.match(main, /await disablePush\(\)/);
  assert.match(main, /disabled: true, sub: supportText\(support\.reason\)/);
  assert.match(main, /wanted && navigator\.onLine === false/, 'offline it says so, not «this phone cannot»');
});

test('⚠️ turning notifications off forgets on this phone first, and does not wait for the write', () => {
  const src = codeOf(read('js/push.js'));
  const body = src.slice(src.indexOf('export async function disablePush'), src.indexOf('function storedToken'));
  assert.ok(body.indexOf('localStorage.removeItem(TOKEN_KEY)') < body.indexOf('deleteDoc('), 'a phone that left must not say «on» for ever');
  assert.doesNotMatch(body, /await deleteDoc/, 'a Firestore write does not settle while offline: the switch would stay locked');
});

test('the orders screen says «loading» until the first answer, not «no orders»', () => {
  const src = codeOf(read('js/calculator-client-orders.js'));
  assert.match(src, /if \(!orders\.length && !ordersAnswered\) \{\s*content\.appendChild\(el\('p', \{ class: 'co-none' \}, t\('calc\.loading'\)\)\);/);
});

test('the received-orders screen draws its apply button only when it was given the fields', () => {
  const src = codeOf(read('js/calculator-client-orders.js'));
  assert.match(src, /if \(fields\) \{\s*const apply = el\('button', \{ class: 'co-apply'/);
  assert.match(src, /fields = injected \|\| null;/);
  assert.match(src, /export function repaintClientOrders\(\)/);
  assert.match(read('js/app.js'), /initClientOrders\(/, 'the Calculator still passes its fields');
});

test('clients.html carries the page attributes, three overlays and no WhatsApp', () => {
  const html = read('clients.html');
  assert.match(html, /<body data-section="calculator" data-card="clients">/);
  for (const id of ['cp-overlay', 'clientorders-overlay', 'cosettings-overlay']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
  }
  assert.doesNotMatch(html, /wa-overlay|open-whatsapp-btn/);
  for (const id of ['open-clients-btn', 'open-received-btn', 'open-clientorders-btn', 'clients-push-row']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.match(html, /<button id="open-clients-btn"[^>]*\bdisabled\b/, 'the door starts shut');
  assert.match(html, /<a class="app-icon-btn[^"]*"[^>]*href="index\.html"/, 'Back is a real link');
  assert.match(html, /data-help="clients-orders"/);
  assert.match(html, /<script type="module" src="dist\/clients\.js"><\/script>/);
  assert.doesNotMatch(html, /scroll-with-bar/);
  assert.equal((html.match(/id="auth-gate" class="auth-gate"><\/div>/g) || []).length, 1);
});

test('the Home has one Clients card, the badge reads for whoever has it, and both files are cached', () => {
  const home = read('index.html');
  assert.equal((home.match(/<a class="home-card"[^>]*\bdata-card="clients"[^>]*>/g) || []).length, 1);
  assert.match(home, /<a class="home-card" href="clients\.html" data-section="calculator" data-card="clients">/);
  const badge = codeOf(read('js/home-client-orders-badge.js'));
  assert.match(badge, /roleHasCard\(session\.role, 'clients'\)/);
  assert.match(badge, /\[data-card="\$\{cardId\}"\]/);
  const sw = read('sw.js');
  assert.match(sw, /'\.\/clients\.html'/);
  assert.match(sw, /'\.\/dist\/clients\.js'/);
});

test('the editor moved out of the Settings hub and is wired on both pages', () => {
  const editor = read('js/clients-editor.js');
  assert.match(editor, /export function openClients\(\)/);
  const settings = read('js/calculator-settings.js');
  assert.doesNotMatch(settings, /function renderClientList|function doSaveClients/);
  assert.match(settings, /from '\.\/clients-editor\.js'/);
  assert.match(settings, /getElementById\('open-clients-btn'\)\.addEventListener\('click', openClients\)/);
  assert.match(read('js/clients/clients-main.js'), /getElementById\('open-clients-btn'\)\.addEventListener\('click', openClients\)/);
});
