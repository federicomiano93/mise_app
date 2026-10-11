// The stocktake in a storeroom with no signal — the two rules the store broke.
//
// ⚠️⚠️ 1. A FIRESTORE WRITE DOES NOT SETTLE UNTIL IT REACHES A SERVER. Under the
// app's offline cache the write is already durable — it is in the browser's own
// database and goes up when there is signal — but its promise never settles. The
// store AWAITED those promises in `closeMonth` and in the month arrows, so both
// controls did nothing at all, silently, in the one place this feature is used.
//
// ⚠️⚠️ 2. THE LOCAL SAFETY COPY WAS NEVER READ. Its key names the venue, and the
// store read it at module load — before sign-in has opened one. So boot looked for
// `inventory-none-2026-09` while every write of the evening went to
// `inventory-loc-abc-2026-09`: written faithfully, read never.
//
// Neither can be reached from a test without a browser and a network to take away,
// and neither shows up in ordinary use — the app was driven end to end against the
// emulator and looked perfect, because the emulator is always there and the
// listener always answers. So what is pinned here is the SHAPE of the code: no
// await on a raw write, and no cache read before the session. A rule stated as a
// rule, which is what this project does when the failure itself is untestable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(join(ROOT, name), 'utf8');
// Comments are where this project explains itself, and they name the very things
// these tests forbid. Judge the CODE.
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const STORE = codeOf(read('js/inventory/inventory-store.js'));
const MAIN = codeOf(read('js/inventory/inventory-main.js'));
const DATA = codeOf(read('js/inventory/firebase-inventory.js'));

// The text of one top-level function, from its signature to the closing brace in
// the first column. Every module in this project is written in that shape.
function bodyOf(src, signature) {
  const start = src.indexOf(signature);
  assert.notEqual(start, -1, `${signature} is not in the file — this test must be re-read`);
  const end = src.indexOf('\n}', start);
  assert.notEqual(end, -1, `could not find the end of ${signature}`);
  return src.slice(start, end);
}

// ── 1. Nothing the screen waits on waits for a server ────────────────────────

test('⚠️⚠️ no write is ever awaited raw — every wait goes through settled()', () => {
  assert.doesNotMatch(STORE, /await\s+saveMonthFields\(/,
    'awaiting a write hangs for ever with no signal: race it against a clock');
  assert.doesNotMatch(STORE, /await\s+flush\(\)/,
    'flush() ends in a write, so it hangs the same way');
  const races = STORE.match(/settled\(/g) || [];
  assert.ok(races.length >= 3,
    `closing a month (two writes plus the flush) and reopening one all have to be `
    + `bounded; found ${races.length} bounded waits`);
});

test('the bound is a number a person could wait for', () => {
  const ms = STORE.match(/const SETTLE_MS = (\d+);/);
  assert.ok(ms, 'SETTLE_MS must be stated as a constant, not buried in a call');
  assert.ok(Number(ms[1]) > 0 && Number(ms[1]) <= 3000,
    `${ms[1]}ms is not a wait somebody standing in a storeroom would accept`);
});

test('⚠️ ONE deadline for a whole sequence, not one per write', () => {
  // Three writes with a bound each would make «close the month» take three times as
  // long as the bound before it answered.
  const close = bodyOf(STORE, 'export async function closeMonth');
  assert.match(close, /const deadline = deadlineFromNow\(\)/);
  const waits = close.match(/settled\([\s\S]*?deadline\)/g) || [];
  assert.ok(waits.length >= 2, 'every wait inside closeMonth shares the one deadline');
});

test('⚠️ a write nobody waits for still reports its failure and never throws loose', () => {
  // An unhandled rejection in a page is a silent failure with a red line in a
  // console nobody has open.
  assert.match(STORE, /function queued\(promise\) \{[\s\S]*?\.catch\(/,
    'queued() is what attaches the failure report to a write nobody awaits');
  const close = bodyOf(STORE, 'export async function closeMonth');
  const writes = close.match(/saveMonthFields\(/g) || [];
  const wrapped = close.match(/queued\(saveMonthFields\(/g) || [];
  assert.equal(writes.length, wrapped.length,
    'every write inside closeMonth goes out through queued()');
});

test('⚠️⚠️ a save never waits behind an earlier write that has not answered', () => {
  // With no signal the first write never answers. Holding every later count in
  // memory behind it meant only the first count of a storeroom reached the SDK's
  // own queue — closing the app, changing month or going Home lost all the others
  // (reproduced on the emulator, 11 Oct 2026: three counts typed, one survived).
  const flush = bodyOf(STORE, 'export function flush');
  assert.doesNotMatch(flush, /\.then\(\(\) => flush\(\)\)/,
    'a save chained onto the previous write waits for ever with no signal');
  assert.match(flush, /if \(hasWork\(outbox\) && !isClosed\(month\)\) send\(\);/,
    'whatever is waiting is handed to Firestore at once');
  // And the books are kept for several writes at once: nothing is settled until the
  // last one answers (the outbox's own tests pin the rules).
  const send = bodyOf(STORE, 'function send');
  assert.match(send, /outbox = answered\(outbox, ok\)/);
  assert.doesNotMatch(STORE, /confirm\(outbox\)|restore\(outbox\)/,
    'settling on the FIRST answer would confirm values another write still carries');
});

test('⚠️ once every write has answered, the screen is drawn again from what Firestore sent', () => {
  // While writes are out this phone's own numbers are laid over every snapshot, which
  // hides a correction another phone makes meanwhile (code review, 11 Oct 2026).
  const send = bodyOf(STORE, 'function send');
  assert.match(send, /if \(!isSending\(outbox\) && lastRemote\) adoptRemote\(\);/);
  const init = bodyOf(STORE, 'export function initInventory');
  assert.match(init, /lastRemote = remote;/, 'the document is kept exactly as it arrived');
});

test('⚠️ every way off the page hands the counts over first', () => {
  const home = bodyOf(MAIN, 'function leaveForHome');
  assert.match(home, /flushBeforeLeaving\(\)\.finally\(\(\) => \{ location\.href = 'index\.html'; \}\)/,
    'going Home waits (within the bound) for the last count to be handed over');
  // ⚠️ THE HOME BUTTON IS A REAL LINK (inventory.html #invHome), and the app's own back
  // button is hidden exactly where Home shows — so the link itself is caught (code
  // review, 11 Oct 2026: the first version of this fix never ran for it).
  const link = bodyOf(MAIN, 'function handleHomeLink');
  assert.match(link, /e\.preventDefault\(\);\s*leaveForHome\(\);/);
  assert.match(MAIN, /homeBtn\.addEventListener\('click', handleHomeLink\)/);
  assert.match(read('inventory.html'), /<a [^>]*id="invHome"[^>]*href="index\.html"/,
    'if Home stops being this link, re-read this test');
  assert.match(bodyOf(MAIN, 'function handleBack'), /leaveForHome\(\)/);
  const month = bodyOf(MAIN, 'function goToMonth');
  assert.match(month, /flushBeforeLeaving\(\)\.finally\(/);
  assert.match(MAIN, /addEventListener\('pagehide', \(\) => \{ flush\(\); \}\)/);
  assert.match(MAIN, /visibilitychange[\s\S]{0,120}visibilityState === 'hidden'\) flush\(\)/,
    'a phone hides the page before it closes it: that is the moment to hand the count over');
  const ways = MAIN.match(/location\.(href|search|assign|replace)\s*=|location\.(assign|replace)\(/g) || [];
  assert.equal(ways.length, 2, 'a new way off the page must hand the counts over too — '
    + 'add it here once it does');
  const links = read('inventory.html').match(/<a [^>]*href=/g) || [];
  assert.equal(links.length, 1, 'a new link off the page must hand the counts over too');
});

// ── 2. The local copy is read once the venue is open ─────────────────────────

test('⚠️⚠️ the cached month is NOT read while the module is loading', () => {
  const init = bodyOf(STORE, 'export function initInventory');
  assert.doesNotMatch(init, /readJson\(/,
    'currentLocationId() is still null here, so the key would name no venue');
  assert.doesNotMatch(init, /cacheKey\(/,
    'not even to build the key: the key is the whole bug');
  assert.match(init, /authReady\.then\(fromThisPhone\)/,
    'the read waits for the session that opens the venue');
  const local = bodyOf(STORE, 'function fromThisPhone');
  assert.match(local, /hydrateFromCache\(\);\s*reviveUnsaved\(\);/,
    'the month as last seen first, then what had not been saved laid over it');
});

// ── 3. Handed to Firestore is not yet in the browser's database ──────────────

test('⚠️⚠️ what exists only in memory is written to localStorage on EVERY outbox change', () => {
  // A write reaches the SDK's database a moment after it is handed over; the last
  // count typed before a back gesture was lost inside that moment (emulator, 11 Oct
  // 2026). Any outbox change that is not written down reopens the hole.
  const lines = STORE.split('\n');
  const changes = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => /^\s*outbox = /.test(line));
  assert.ok(changes.length >= 7, `found ${changes.length} outbox changes — this test must be re-read`);
  for (const { line, i } of changes) {
    const next = lines.slice(i + 1, i + 4).join('\n');
    assert.match(next, /keepUnsaved\(\)/, `not written down after: ${line.trim()}`);
  }
});

test('⚠️ the unsaved copy names the venue and is never filed under a nameless one', () => {
  assert.match(STORE, /function unsavedKey\(monthId\) \{\s*return `inventory-unsaved-\$\{currentLocationId\(\) \|\| 'none'\}-\$\{monthId\}`;/);
  const keep = bodyOf(STORE, 'function keepUnsaved');
  assert.match(keep, /if \(!monthId \|\| !currentLocationId\(\)\) return;/);
  assert.match(keep, /removeItem\(unsavedKey\(monthId\)\)/, 'and removed once nothing is left only in memory');
  assert.match(keep, /try \{[\s\S]*\} catch/, 'a full storage must not break the count');
});

test('⚠️ a snapshot settles what it shows back BEFORE the unsent numbers are laid over it', () => {
  const init = bodyOf(STORE, 'export function initInventory');
  const echo = init.indexOf('outbox = echoed(outbox, remoteMonth(), COUNT_MAPS)');
  const over = init.indexOf('adoptRemote()');
  assert.ok(echo > 0 && over > echo,
    'judged after the overlay, every number would look stored — and the copy would be dropped');
  assert.match(bodyOf(STORE, 'function remoteMonth'), /normalizeMonth\(lastRemote, monthId\)/,
    'a fresh copy every time: applyOver writes into the one it is given');
});

test('⚠️⚠️ what a torn-down page left behind is shown at once, and sent only on the SERVER\'s word', () => {
  // Driven on the emulator (11 Oct 2026): sent on the strength of the phone's own copy
  // of the month, which still said «open», a held count landed in a month closed from
  // another device meanwhile.
  const revive = bodyOf(STORE, 'function reviveUnsaved');
  assert.match(revive, /readJson\(unsavedKey\(monthId\), null\)/);
  assert.match(revive, /outbox = revive\(outbox, saved, COUNT_MAPS\)/);
  assert.match(revive, /applyOver\(outbox, month, COUNT_MAPS\)/, 'on screen before the first snapshot');
  assert.doesNotMatch(revive, /scheduleSave\(\)|flush\(\)/, 'but NOT sent from here');
  const release = bodyOf(STORE, 'function releaseHeld');
  assert.match(release, /if \(!hasHeld\(outbox\) \|\| isClosed\(month\)\) return;/);
  assert.match(release, /outbox = release\(outbox\);[\s\S]*scheduleSave\(\)/);
  const init = bodyOf(STORE, 'export function initInventory');
  assert.match(init, /if \(meta && meta\.fromServer\) releaseHeld\(\);/,
    'released by a snapshot the server sent, never by the phone\'s own copy');
  assert.match(DATA, /includeMetadataChanges: true/,
    'without it, a server answer identical to the phone\'s copy is never reported');
  assert.match(DATA, /fromServer: !snap\.metadata\.fromCache/);
});

test('the cache is not written under a nameless venue either', () => {
  assert.match(STORE, /if \(month && currentLocationId\(\)\)\s*writeJson\(/,
    'a copy filed under `none` is a copy nothing will ever read');
});

test('⚠️ the cached copy never overwrites something newer', () => {
  const hydrate = bodyOf(STORE, 'function hydrateFromCache');
  assert.match(hydrate, /remoteArrived/, 'Firestore may already have answered');
  assert.match(hydrate, /hasWork\(outbox\)/, 'or a number may already have been typed');
});

// ── The read that fails is not an empty answer ───────────────────────────────

test('⚠️ «that month is empty» and «I could not read it» are two different answers', () => {
  const pull = bodyOf(STORE, 'export async function pullOpeningFromPrevious');
  assert.match(pull, /try \{[\s\S]*getMonthOnce[\s\S]*\} catch/,
    'a read with no signal rejects, and it must not surface as "nothing to carry"');
  assert.match(pull, /return null;/, 'the failure has an answer of its own');
  assert.match(MAIN, /moved === null/, 'and the screen tells the two apart');
  assert.match(MAIN, /inv\.carryFailed/, 'in words, not in silence');
});

// ── What the closed month reads, and what it does not ────────────────────────

test('⚠️ no screen filters the live ingredient list by hand any more', () => {
  // A closed month is read from what was frozen into it, and that judgement lives in
  // exactly one place (js/inventory/inventory-model.js productsOfMonth). A hand-made
  // filter beside it is how a closed month quietly lost a deleted product.
  assert.doesNotMatch(MAIN, /getIngredients\(\)\.filter\(/,
    'it must go through productsOfMonth, which knows about frozen months');
  assert.match(MAIN, /productsOfMonth\(getMonth\(\), getIngredients\(\)\)/);
  const list = codeOf(read('js/inventory/inventory-list.js'));
  assert.doesNotMatch(list, /active !== false/,
    'the list is handed the rows it should draw; re-filtering them would drop the '
    + 'frozen rows of a closed month, which have no live product behind them');
});

// ── And the role check that claimed a control this feature does not have ─────

test('the data layer reads no role: the page gate is the only gate', () => {
  assert.doesNotMatch(DATA, /canManageHere|currentSession/,
    'inventory.html rides data-section="foodcost", so everybody who can open this '
    + 'screen may already run it — a UX check here would describe a control that '
    + 'does not exist');
  assert.match(read('inventory.html'), /<body[^>]*\bdata-section="foodcost"/);
});

// ── «Closed» has to be true of the SCREEN, not only of the footer ────────────
//
// ⚠️⚠️ FOUND BY OPENING A CLOSED MONTH IN A BROWSER, after every unit test was
// green: the month's own state arrives from Firestore AFTER the first paint, and the
// screen never took it in. A closed July was drawn as OPEN — every count box
// enabled, both fill-in actions offered, the note saying an empty box means «not
// counted yet» — with only the footer button saying «Reopen», because the footer was
// the only thing repainted. Typing there changed the figures of a month the screen
// promises no longer change, and the rules cannot refuse it: they cannot tell a count
// apart from the write that reopens the month.

test('⚠️⚠️ the screen is BUILT AGAIN when the month turns out to be closed', () => {
  assert.match(MAIN, /let builtClosed = false;/,
    'the screen has to remember what it was built for');
  assert.match(MAIN, /if \(readOnly\(\) !== builtClosed\) \{/,
    'and compare it with the answer that has just arrived');
  for (const builder of ['showList', 'openIngredient', 'showUsage']) {
    const body = bodyOf(MAIN, `function ${builder}(`);
    assert.match(body, /builtClosed = readOnly\(\);/,
      `${builder}() must record what it drew, or the comparison drifts`);
  }
  assert.match(MAIN, /if \(view === 'detail' && activeIngredient\) openIngredient\(activeIngredient\)/,
    'a product open on screen is rebuilt, not abandoned');
});

test('⚠️⚠️ and the store refuses every change to a closed month, whatever the screen drew', () => {
  // The last line of defence, and the only one that cannot be raced: a disabled
  // attribute is set when the screen is built, which is before the answer arrives.
  const setCount = bodyOf(STORE, 'export function setCount');
  assert.match(setCount, /if \(isClosed\(month\)\) return;/);
  assert.match(bodyOf(STORE, 'export function applyPurchases'), /isClosed\(month\)/,
    'filling in purchases is a change like any other');
  assert.match(bodyOf(STORE, 'export async function pullOpeningFromPrevious'), /isClosed\(month\)/,
    'and so is carrying last month forward');
  // ⚠️⚠️ AND SO IS WHAT THIS PHONE STILL HOLDS. A count left behind on a phone, sent
  // when the month is next opened there, would change a month closed meanwhile on
  // another device — after the next month had copied its figures (code review, 11
  // Oct 2026). Nothing is sent into it, laid over it, or revived over it.
  assert.match(bodyOf(STORE, 'export function flush'), /&& !isClosed\(month\)\) send\(\)/);
  assert.match(bodyOf(STORE, 'function adoptRemote'), /if \(!isClosed\(merged\)\) applyOver\(/);
  assert.match(bodyOf(STORE, 'function reviveUnsaved'), /\|\| isClosed\(month\)\) return;/);
  assert.match(bodyOf(STORE, 'function releaseHeld'), /isClosed\(month\)\) return;/);
  // Closing here sends what is held FIRST: it is on screen, and the next month's
  // opening is copied from the screen's month.
  const close = bodyOf(STORE, 'export async function closeMonth');
  const released = close.indexOf('outbox = release(outbox);');
  assert.ok(released > 0 && released < close.indexOf('flush()') && released < close.indexOf('carryOver('),
    'released before the flush that sends it and before the copy into next month');
  // And reopening brings it back and sends it.
  const reopen = bodyOf(STORE, 'export async function reopenMonth');
  assert.match(reopen, /outbox = release\(outbox\);/);
  assert.match(reopen, /if \(hasWork\(outbox\)\) \{\s*applyOver\(outbox, month, COUNT_MAPS\);\s*scheduleSave\(\);/);
  // Closing and reopening must still work, or the month could never be unfrozen.
  assert.doesNotMatch(bodyOf(STORE, 'export async function reopenMonth'), /isClosed\(month\)/);
});
