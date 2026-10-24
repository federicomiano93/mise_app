// Nothing on the Pastries day is changed or recorded before the first answers are in.
//
// Found 11 Oct 2026 (driving PR #339): on a NEW phone or a cleared browser, a pencil tapped within
// a second of opening Pastries opened the editor EMPTY — «0 pastries» for a Tuesday that held six.
// The editor copies the day once, when it opens, and the day is written whole (setDoc, no merge),
// so typing one pastry and saving would have REPLACED the real list. On an Italian venue the same
// early editor also opened in English, because the venue's language is set just before the data
// is allowed to load.
//
// These tests EXECUTE the real stores and the real page (js/pastries/pastries-main.js) under node,
// with the Firestore data layer replaced by a stub that answers only when told to
// (tests/helpers/load-pastries.mjs). What they cannot show is a real phone's timing: that was
// driven on the emulator with a fresh browser profile (the PR says how).

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom, Node, walk } from './helpers/form-dom.mjs';
import { standIns, loadPastries } from './helpers/load-pastries.mjs';
import { WEEKDAYS } from '../js/pastries/pastries-model.js';
import { t as say } from '../js/i18n.js';

// Lets the stores' awaits (sign-in, the watch starting) run. setImmediate, not setTimeout: the
// page's own timers are mocked below so a 4am timer cannot keep the test process alive.
const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise(r => setImmediate(r)); };

function quietly(fn) {
  const { error, warn } = console;
  console.error = () => {};
  console.warn = () => {};
  return Promise.resolve().then(fn).finally(() => { console.error = error; console.warn = warn; });
}

const SIX = ['Cornetti', 'Pain au chocolat', 'Girelle', 'Treccine', 'Saccottini', 'Krapfen']
  .map((name, i) => ({ name, qty: 10 + i }));
const everyDay = items => WEEKDAYS.map(day => ({ id: day, day, items, note: '' }));

// ── The seven days ───────────────────────────────────────────────────────────

test('the days are not ready until the first snapshot; the snapshot makes them ready and repaints', async () => {
  const { fs } = await standIns('days-snapshot');
  const store = await loadPastries('pastries-store.js', 'days-snapshot');
  let painted = 0;
  store.initPastries(() => { painted += 1; });
  await settle();
  assert.equal(store.daysReady(), false, 'nothing has answered yet');
  assert.deepEqual(store.getItems('Tuesday'), [], 'a new phone has only an empty copy');

  fs.control.days[0].onChange(everyDay(SIX));
  assert.equal(store.daysReady(), true);
  assert.equal(painted, 1);
  assert.equal(store.getItems('Tuesday').length, 6);
});

test('a days stream that fails before answering ends the wait, and tells the screen', async () => {
  const { fs } = await standIns('days-error');
  const store = await loadPastries('pastries-store.js', 'days-error');
  let painted = 0;
  let errors = 0;
  store.initPastries(() => { painted += 1; }, () => { errors += 1; });
  await settle();
  fs.control.days[0].onError(new Error('permission-denied'));
  assert.equal(store.daysReady(), true, 'nothing may wait for ever on a question that cannot be answered');
  assert.equal(painted, 1, 'the screen must hear it, or the pencil waits for ever');
  assert.equal(errors, 1);
});

test('a days stream that fails AFTER answering does not repaint for nothing', async () => {
  const { fs } = await standIns('days-late-error');
  const store = await loadPastries('pastries-store.js', 'days-late-error');
  let painted = 0;
  store.initPastries(() => { painted += 1; }, () => {});
  await settle();
  fs.control.days[0].onChange(everyDay(SIX));
  fs.control.days[0].onError(new Error('permission-denied'));
  assert.equal(painted, 1);
  assert.equal(store.daysReady(), true);
});

test('a days watch that cannot even start ends the wait too', async () => {
  const { fs } = await standIns('days-no-start');
  fs.control.failDaysStart = true;
  const store = await loadPastries('pastries-store.js', 'days-no-start');
  let painted = 0;
  let errors = 0;
  await quietly(async () => {
    store.initPastries(() => { painted += 1; }, () => { errors += 1; });
    await settle();
  });
  assert.equal(store.daysReady(), true);
  assert.equal(painted, 1);
  assert.equal(errors, 1);
});

// ── An answer from Firestore's offline copy ──────────────────────────────────
//
// Offline for ~10 s, Firestore answers a list it has never fetched on this phone with NO
// documents, from its cache. The seven day documents are never deleted, so that answer means
// «nothing known», not «nothing here» — believing it reopened the same hole on a new phone with a
// bad signal (code review, 11 Oct 2026).

// This phone's own copy (localStorage), set BEFORE the store loads: it is read once, at boot.
function phoneCopy(copy) {
  const stored = new Map(copy ? [['pastries-days', JSON.stringify(copy)]] : []);
  globalThis.localStorage = {
    getItem: k => (stored.has(k) ? stored.get(k) : null),
    setItem: (k, v) => { stored.set(k, String(v)); },
    removeItem: k => { stored.delete(k); },
  };
}
const weekOf = items => Object.fromEntries(WEEKDAYS.map(day => [day, { items, note: '' }]));

test('on a NEW phone an empty answer from the offline copy is not believed; the server is awaited', async (t) => {
  t.after(() => { delete globalThis.localStorage; });
  phoneCopy(null);
  const { fs } = await standIns('cache-empty-new');
  const store = await loadPastries('pastries-store.js', 'cache-empty-new');
  let painted = 0;
  store.initPastries(() => { painted += 1; });
  await settle();
  fs.control.days[0].onChange([], true);
  assert.equal(store.daysReady(), false, '«nothing known» must not open an empty editor');
  assert.equal(painted, 0);
  fs.control.days[0].onChange(everyDay(SIX), false);
  assert.equal(store.daysReady(), true);
  assert.equal(store.getItems('Tuesday').length, 6);
});

test('an answer from the offline copy that holds documents is believed (working offline is untouched)', async (t) => {
  t.after(() => { delete globalThis.localStorage; });
  phoneCopy(null);
  const { fs } = await standIns('cache-full');
  const store = await loadPastries('pastries-store.js', 'cache-full');
  store.initPastries(() => {});
  await settle();
  fs.control.days[0].onChange(everyDay(SIX), true);
  assert.equal(store.daysReady(), true);
});

test("an empty offline answer IS believed where this phone's own copy says the venue never had a pastry", async (t) => {
  // The phone has synced before and saw nothing: with the same nothing in Firestore's cache, the
  // server will not send another answer when it agrees — waiting for one would wait for ever.
  t.after(() => { delete globalThis.localStorage; });
  phoneCopy(weekOf([]));
  const { fs } = await standIns('cache-empty-venue');
  const store = await loadPastries('pastries-store.js', 'cache-empty-venue');
  store.initPastries(() => {});
  await settle();
  fs.control.days[0].onChange([], true);
  assert.equal(store.daysReady(), true);
});

test("an empty offline answer neither counts nor wipes a copy that holds pastries", async (t) => {
  t.after(() => { delete globalThis.localStorage; });
  phoneCopy(weekOf([{ name: 'Cornetti', qty: 24 }]));
  const { fs } = await standIns('cache-empty-evicted');
  const store = await loadPastries('pastries-store.js', 'cache-empty-evicted');
  store.initPastries(() => {});
  await settle();
  fs.control.days[0].onChange([], true);
  assert.equal(store.daysReady(), false);
  assert.deepEqual(store.getItems('Tuesday'), [{ name: 'Cornetti', qty: 24 }], 'the copy on screen stays');
});

test('an empty answer from the SERVER is believed: a venue that has never written a day', async (t) => {
  t.after(() => { delete globalThis.localStorage; });
  phoneCopy(null);
  const { fs } = await standIns('server-empty');
  const store = await loadPastries('pastries-store.js', 'server-empty');
  store.initPastries(() => {});
  await settle();
  fs.control.days[0].onChange([], false);
  assert.equal(store.daysReady(), true);
});

// ── Tonight's confirmations ──────────────────────────────────────────────────

test("tonight's confirmations are not ready until they answer", async () => {
  const { fs } = await standIns('dates-answer');
  const logs = await loadPastries('pastries-logs-store.js', 'dates-answer');
  let painted = 0;
  const watching = logs.watchConfirmations('2026-10-13', () => { painted += 1; });
  await settle();
  await watching;
  assert.equal(logs.confirmationsReady(), false, '«not confirmed» here only means «nobody has said»');
  fs.control.dates[0].onChange([{ id: '2026-10-13_Tuesday', day: 'Tuesday', date: '2026-10-13' }]);
  assert.equal(logs.confirmationsReady(), true);
  assert.equal(logs.isConfirmedTonight('Tuesday'), true);
  assert.ok(painted >= 2, 'painted when the watch started and again when it answered');
});

test('an out-of-date watch answering does not count; the latest one does', async () => {
  const { fs } = await standIns('dates-stale');
  const logs = await loadPastries('pastries-logs-store.js', 'dates-stale');
  const first = logs.watchConfirmations('2026-10-12', () => {});
  const second = logs.watchConfirmations('2026-10-13', () => {});
  await settle();
  await Promise.all([first, second]);
  const stale = fs.control.dates.find(w => w.date === '2026-10-12');
  const latest = fs.control.dates.find(w => w.date === '2026-10-13');
  stale.onChange([]);
  assert.equal(logs.confirmationsReady(), false, 'yesterday answering says nothing about tonight');
  latest.onChange([]);
  assert.equal(logs.confirmationsReady(), true);
});

test('the 4am refresh does not take the answer back (it would close a box being typed into)', async () => {
  const { fs } = await standIns('dates-roll');
  const logs = await loadPastries('pastries-logs-store.js', 'dates-roll');
  await logs.watchConfirmations('2026-10-12', () => {});
  fs.control.dates[0].onChange([]);
  const rolling = logs.watchConfirmations('2026-10-13', () => {});
  assert.equal(logs.confirmationsReady(), true);
  await rolling;
});

test('a confirmations question that fails, or cannot start, counts as an answer', async () => {
  const failed = await standIns('dates-error');
  const logsA = await loadPastries('pastries-logs-store.js', 'dates-error');
  await logsA.watchConfirmations('2026-10-13', () => {});
  failed.fs.control.dates[0].onError(new Error('permission-denied'));
  assert.equal(logsA.confirmationsReady(), true);

  const refused = await standIns('dates-no-start');
  refused.fs.control.failDatesStart = true;
  const logsB = await loadPastries('pastries-logs-store.js', 'dates-no-start');
  await quietly(() => logsB.watchConfirmations('2026-10-13', () => {}));
  assert.equal(logsB.confirmationsReady(), true);
});

// ── The page ─────────────────────────────────────────────────────────────────

// The page's own elements (pastries.html), in the small fake DOM.
function pageDom(cached = null) {
  installDom();
  // The fake's replaceChildren() only empties; the page refills with it.
  Node.prototype.replaceChildren = function replaceChildren(...nodes) {
    this.children = [];
    this._text = null;
    nodes.forEach(n => this.appendChild(n));
  };
  const header = new Node('header');
  const ids = new Map();
  for (const id of ['pasScreen', 'pasStrip', 'pasTitle', 'pasSub', 'pasHome', 'pasBack', 'pasEdit',
    'pasSave', 'pasFooter', 'pasLogs', 'pasToast']) {
    ids.set(id, new Node(id === 'pasScreen' ? 'main' : 'button'));
  }
  ids.get('pasSave').closest = () => header;
  globalThis.document.getElementById = id => ids.get(id) || null;
  const stored = new Map(cached ? [['pastries-days', JSON.stringify(cached)]] : []);
  globalThis.localStorage = {
    getItem: k => (stored.has(k) ? stored.get(k) : null),
    setItem: (k, v) => { stored.set(k, String(v)); },
    removeItem: k => { stored.delete(k); },
  };
  return { ids, header };
}

const find = (root, cls) => walk(root).filter(n => n.classList && n.classList.contains(cls));
const editorOpen = screen => find(screen, 'pas-editrows').length > 0;

test('⚠️ the pencil tapped before the list has answered WAITS, then opens the editor on the REAL list', async (t) => {
  t.after(() => { mock.timers.reset(); delete globalThis.document; delete globalThis.localStorage; });
  mock.timers.enable({ apis: ['setTimeout'] });
  const { ids } = pageDom();   // a NEW phone: nothing stored
  const { fs } = await standIns('page-pencil');
  await loadPastries('pastries-main.js', 'page-pencil');
  await settle();
  const screen = ids.get('pasScreen');

  ids.get('pasEdit').fire('click');
  await settle();
  assert.equal(editorOpen(screen), false, 'an editor opened now would copy an EMPTY day — and Save would write it');
  assert.equal(ids.get('pasSave').hidden, true);
  assert.equal(ids.get('pasToast').textContent, say('past.listNotLoadedYet'), 'a tap that waits says so');

  fs.control.days[0].onChange(everyDay(SIX));
  await settle();
  assert.equal(editorOpen(screen), false, 'still waiting for tonight\'s confirmations (the lock question)');

  fs.control.dates.at(-1).onChange([]);
  await settle();
  assert.equal(editorOpen(screen), true, 'the tap is honoured once the answers are in');
  assert.equal(ids.get('pasToast').classList.contains('show'), false, '«not arrived yet» goes once it has');
  const names = find(screen, 'pas-name').map(n => n.value);
  assert.deepEqual(names, SIX.map(i => i.name), 'the editor holds the stored list, not the empty copy');
});

test('offline on a new phone, the pencil keeps waiting through an empty answer from the offline copy', async (t) => {
  t.after(() => { mock.timers.reset(); delete globalThis.document; delete globalThis.localStorage; });
  mock.timers.enable({ apis: ['setTimeout'] });
  const { ids } = pageDom();
  const { fs } = await standIns('page-pencil-offline');
  await loadPastries('pastries-main.js', 'page-pencil-offline');
  await settle();
  const screen = ids.get('pasScreen');
  ids.get('pasEdit').fire('click');
  fs.control.days[0].onChange([], true);
  fs.control.dates.at(-1).onChange([]);
  await settle();
  assert.equal(editorOpen(screen), false, '«nothing known» must not open an empty editor whose save is queued');
  fs.control.days[0].onChange(everyDay(SIX), false);
  await settle();
  assert.deepEqual(find(screen, 'pas-name').map(n => n.value), SIX.map(i => i.name));
});

test('a broken stream that ends the wait keeps its own message on screen', async (t) => {
  t.after(() => { mock.timers.reset(); delete globalThis.document; delete globalThis.localStorage; });
  mock.timers.enable({ apis: ['setTimeout'] });
  const { ids } = pageDom();
  const { fs } = await standIns('page-pencil-broken');
  await quietly(async () => {
    await loadPastries('pastries-main.js', 'page-pencil-broken');
    await settle();
    ids.get('pasEdit').fire('click');
    fs.control.days[0].onError(new Error('permission-denied'));
    fs.control.dates.at(-1).onChange([]);
    await settle();
  });
  const toastNode = ids.get('pasToast');
  assert.equal(toastNode.textContent, say('past.liveSyncInterruptedThis'));
  assert.equal(toastNode.classList.contains('show'), true, 'closing «not arrived yet» must not take the error down');
});

test('a tap on the still-waiting pencil says it again once the first message has gone', async (t) => {
  t.after(() => { mock.timers.reset(); delete globalThis.document; delete globalThis.localStorage; });
  mock.timers.enable({ apis: ['setTimeout'] });
  const { ids } = pageDom();
  await standIns('page-pencil-again');
  await loadPastries('pastries-main.js', 'page-pencil-again');
  await settle();
  const toastNode = ids.get('pasToast');
  ids.get('pasEdit').fire('click');
  mock.timers.tick(3000);
  assert.equal(toastNode.classList.contains('show'), false, 'the toast hides itself');
  ids.get('pasEdit').fire('click');
  assert.equal(toastNode.classList.contains('show'), true, 'a further tap is not met with silence');
  assert.equal(toastNode.textContent, say('past.listNotLoadedYet'));
});

test('before the answer an empty copy says the list has not arrived — never «nothing to prove»', async (t) => {
  t.after(() => { mock.timers.reset(); delete globalThis.document; delete globalThis.localStorage; });
  mock.timers.enable({ apis: ['setTimeout'] });
  const { ids } = pageDom();
  const { fs } = await standIns('page-empty-state');
  await loadPastries('pastries-main.js', 'page-empty-state');
  await settle();
  const screen = ids.get('pasScreen');
  const title = () => find(screen, 'empty-title').map(n => n.textContent).join(' ');
  assert.equal(title(), say('past.listNotArrivedYet'));
  fs.control.days[0].onChange([], false);    // the server: this venue has never written a day
  fs.control.dates.at(-1).onChange([]);
  await settle();
  assert.match(title(), /^Nothing to prove for /, 'once the server has said so, it is the truth');
});

test('the days are watched WITH metadata changes, or a set-aside empty answer is never followed up', () => {
  // Source-level: the module loads the SDK from a CDN, so node cannot execute it. Without the option,
  // the server's «same nothing» after an empty from-cache answer is a metadata-only change that
  // onSnapshot never delivers, and the pencil waits on every opening of that phone.
  const src = readFileSync(new URL('../js/pastries/firebase-pastries.js', import.meta.url), 'utf8');
  const watch = src.slice(src.indexOf('export async function watchPastryDays'), src.indexOf('export async function savePastryDay'));
  assert.match(watch, /onSnapshot\(\s*collection\(db, pathFor\(PASTRIES\)\),\s*\{ includeMetadataChanges: true \},/);
  assert.match(watch, /snap\.metadata\.fromCache/);
});

test('two taps on the waiting pencil ask the lock question ONCE and open ONE editor', async (t) => {
  t.after(() => { mock.timers.reset(); delete globalThis.document; delete globalThis.localStorage; });
  mock.timers.enable({ apis: ['setTimeout'] });
  const { ids } = pageDom();
  const { fs, dialog } = await standIns('page-pencil-twice');
  await loadPastries('pastries-main.js', 'page-pencil-twice');
  await settle();
  ids.get('pasEdit').fire('click');
  ids.get('pasEdit').fire('click');
  fs.control.days[0].onChange(everyDay(SIX));
  const tonight = fs.control.dates.at(-1);
  tonight.onChange(WEEKDAYS.map(day => ({ id: `${tonight.date}_${day}`, day, date: tonight.date })));
  await settle();
  assert.equal(dialog.asked.length, 1, 'a second waiting tap would ask a second time');
  assert.equal(find(ids.get('pasScreen'), 'pas-editrows').length, 1);
});

test('a recorded day still asks «Edit?» when the pencil was tapped before the confirmations answered', async (t) => {
  t.after(() => { mock.timers.reset(); delete globalThis.document; delete globalThis.localStorage; });
  mock.timers.enable({ apis: ['setTimeout'] });
  const { ids } = pageDom();
  const { fs, dialog } = await standIns('page-pencil-locked');
  dialog.settings.answer = false;
  await loadPastries('pastries-main.js', 'page-pencil-locked');
  await settle();
  ids.get('pasEdit').fire('click');
  fs.control.days[0].onChange(everyDay(SIX));
  const tonight = fs.control.dates.at(-1);
  // Every weekday recorded tonight, so whichever day the screen opened on is locked.
  tonight.onChange(WEEKDAYS.map(day => ({ id: `${tonight.date}_${day}`, day, date: tonight.date })));
  await settle();
  assert.equal(dialog.asked.length, 1, 'the lock question is asked, not skipped by tapping early');
  assert.equal(editorOpen(ids.get('pasScreen')), false, 'Cancel keeps the editor shut');
});

test('before the answers a row ignores a tap and Confirm is disabled; after, both work', async (t) => {
  t.after(() => { mock.timers.reset(); delete globalThis.document; delete globalThis.localStorage; });
  mock.timers.enable({ apis: ['setTimeout'] });
  // A phone with an OLD copy: it is drawn at once, but nothing may be written from it.
  const old = {};
  WEEKDAYS.forEach(day => { old[day] = { items: [{ name: 'Cornetti', qty: 4 }], note: '' }; });
  const { ids } = pageDom(old);
  const { fs, dialog } = await standIns('page-rows');
  await loadPastries('pastries-main.js', 'page-rows');
  await settle();
  const screen = ids.get('pasScreen');

  let [row] = find(screen, 'pas-row-main');
  let [confirm] = find(screen, 'pas-confirm-btn');
  assert.ok(row, 'the old copy is drawn at once');
  assert.equal(row.getAttribute('aria-disabled'), 'true');
  assert.equal(confirm.disabled, true);
  row.fire('click');
  confirm.fire('click');
  await settle();
  assert.equal(find(screen, 'pas-row').some(r => r.dataset.open === 'true'), false, 'no box opens on a stale row');
  assert.equal(dialog.asked.length, 0, 'Confirm asks nothing, records nothing');

  // The list alone is not enough: until tonight's confirmations answer, a recorded day would
  // open without its «Edit?» question.
  fs.control.days[0].onChange(everyDay(SIX));
  await settle();
  [row] = find(screen, 'pas-row-main');
  [confirm] = find(screen, 'pas-confirm-btn');
  assert.equal(row.getAttribute('aria-disabled'), 'true', 'the list has answered, the confirmations not yet');
  assert.equal(confirm.disabled, true);

  fs.control.dates.at(-1).onChange([]);
  await settle();
  [row] = find(screen, 'pas-row-main');
  [confirm] = find(screen, 'pas-confirm-btn');
  assert.equal(row.getAttribute('aria-disabled'), undefined);
  assert.equal(confirm.disabled, false);
  row.fire('click');
  assert.equal(find(screen, 'pas-row').some(r => r.dataset.open === 'true'), true);
  confirm.fire('click');
  await settle();
  assert.equal(dialog.asked.length, 1, 'Confirm asks once the list is the real one');
});
