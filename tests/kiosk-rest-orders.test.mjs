import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingFromPrecache } from './helpers/precache.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRestOrdersFeed, REFRESH_MS } from '../js/kiosk-orders.js';
import { restOrdersAllowed } from '../js/kiosk.js';
import { _dictionaries } from '../js/i18n.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');

// A fake clock: the feed's 15-minute repeat is driven by hand.
function fakeTimers() {
  const jobs = new Map();
  let next = 1;
  return {
    set: (fn, ms) => { const id = next++; jobs.set(id, { fn, ms }); return id; },
    clear: id => { jobs.delete(id); },
    jobs,
    fire: () => [...jobs.values()].forEach(j => j.fn()),
  };
}
const settle = () => new Promise(r => setTimeout(r, 0));

function feed({ allowed = true, pageAnswers = false, fetchSections, today = () => '2026-10-07' } = {}) {
  const timers = fakeTimers();
  const calls = { fetch: 0, changed: 0 };
  const f = createRestOrdersFeed({
    allowed: () => (typeof allowed === 'function' ? allowed() : allowed),
    pageAnswers: () => (typeof pageAnswers === 'function' ? pageAnswers() : pageAnswers),
    fetchSections: async () => { calls.fetch++; return (fetchSections ? fetchSections(calls.fetch) : [{ titleKey: 'k', names: ['A'], more: 0 }]); },
    onChange: () => { calls.changed++; },
    today, timers,
  });
  return { f, timers, calls };
}

test('gating: no reads without Orders access (session, section off, card hidden)', () => {
  const ready = { status: 'ready', location: {}, canManage: false };
  assert.equal(restOrdersAllowed(ready), true);
  assert.equal(restOrdersAllowed(null), false);
  assert.equal(restOrdersAllowed({ ...ready, status: 'loading' }), false);
  assert.equal(restOrdersAllowed({ ...ready, location: { sections: { orders: false } } }), false);
  const hidden = { staffHiddenCards: { orders: true } };
  assert.equal(restOrdersAllowed({ ...ready, location: hidden }), false);
  assert.equal(restOrdersAllowed({ ...ready, location: hidden, canManage: true }), true);
});

test('a feed that is not allowed never reads and never repeats', async () => {
  const { f, timers, calls } = feed({ allowed: false });
  f.start();
  await settle();
  assert.equal(calls.fetch, 0);
  assert.equal(timers.jobs.size, 0);
  assert.deepEqual(f.current(), []);
});

test('schedule: reads at once on rest entry, then every 15 minutes, and stops for good', async () => {
  const { f, timers, calls } = feed();
  f.start();
  await settle();
  assert.equal(calls.fetch, 1);
  assert.equal(REFRESH_MS, 15 * 60 * 1000);
  assert.deepEqual([...timers.jobs.values()].map(j => j.ms), [REFRESH_MS]);
  timers.fire();
  await settle();
  assert.equal(calls.fetch, 2);
  f.start();   // idempotent: no second timer, no extra read
  await settle();
  assert.equal(calls.fetch, 2);
  assert.equal(timers.jobs.size, 1);
  f.stop();    // woken, or the night begins
  assert.equal(timers.jobs.size, 0);
  assert.equal(f.isRunning(), false);
});

test('an answer that arrives after stop() is thrown away', async () => {
  let release;
  const { f, calls } = feed({ fetchSections: () => new Promise(r => { release = r; }) });
  f.start();
  f.stop();
  release([{ titleKey: 'k', names: ['Late'], more: 0 }]);
  await settle();
  assert.equal(calls.changed, 0);
  assert.deepEqual(f.current(), []);
});

test('the last answer is kept in memory and a repaint is asked for', async () => {
  const { f, calls } = feed();
  f.start();
  await settle();
  assert.equal(calls.changed, 1);
  assert.deepEqual(f.current(), [{ titleKey: 'k', names: ['A'], more: 0 }]);
});

test('yesterday\'s answer is never shown', async () => {
  let day = '2026-10-07';
  const { f } = feed({ today: () => day });
  f.start();
  await settle();
  assert.equal(f.current().length, 1);
  day = '2026-10-08';
  assert.deepEqual(f.current(), []);
});

test('a failed read keeps the previous answer and never throws', async () => {
  const warn = console.warn;
  const logged = [];
  console.warn = (...a) => logged.push(a);
  try {
    const { f, timers } = feed({
      fetchSections: n => { if (n === 2) { const e = new Error('Jane Doe offline'); e.code = 'unavailable'; throw e; } return [{ titleKey: 'k', names: ['A'], more: 0 }]; },
    });
    f.start();
    await settle();
    timers.fire();
    await settle();
    assert.equal(f.current().length, 1);
    // Only the error code is logged — never the message, which could carry data.
    assert.equal(logged.length, 1);
    assert.ok(!JSON.stringify(logged).includes('Jane'));
  } finally { console.warn = warn; }
});

test('silence on the Orders page: when the page answers, nothing is read', async () => {
  const { f, timers, calls } = feed({ pageAnswers: true });
  f.start();
  await settle();
  assert.equal(calls.fetch, 0);
  assert.equal(timers.jobs.size, 0);
});

test('permission lost while resting: the next refresh reads nothing and nothing is shown', async () => {
  let allowed = true;
  const { f, timers, calls } = feed({ allowed: () => allowed });
  f.start();
  await settle();
  allowed = false;
  timers.fire();
  await settle();
  assert.equal(calls.fetch, 1);
  assert.deepEqual(f.current(), []);
});

test('kiosk.js: the tap line is gone but stays the cover\'s name; the page is asked first', () => {
  const src = read('js/kiosk.js');
  assert.match(src, /overlay\.setAttribute\('aria-label', t\('kiosk\.rest\.tap'\)\)/);
  assert.doesNotMatch(src, /kiosk-rest-tap/);
  assert.match(src, /setAttribute\('role', 'button'\)/);
  assert.match(src, /overlay\.tabIndex = 0/);
  // The titles are translated inside the drawing code, never at module top level.
  assert.match(src, /function sectionBlock\(section\) \{[\s\S]*?t\(section\.titleKey\)/);
  assert.match(src, /detail\.live \? detail\.sections : \(restFeed \? restFeed\.current\(\) : \[\]\)/);
  assert.match(src, /restFeed\.start\(\)/);
  assert.match(src, /restFeed\.stop\(\)/);
  assert.doesNotMatch(read('tokens.css'), /\.kiosk-rest-tap/);
  assert.match(read('tokens.css'), /justify-content: safe center/);
});

test('kiosk.js has no static import of kiosk-orders.js or of anything under js/orders/', () => {
  const src = read('js/kiosk.js');
  const statics = src.match(/^import[^\n]*from\s+'[^']+';/gm) || [];
  assert.ok(statics.length > 0);
  for (const line of statics) {
    assert.doesNotMatch(line, /kiosk-orders|\/orders\//, line);
  }
  assert.match(src, /import\('\.\/kiosk-orders\.js'\)/);
});

test('P14: a fresh answer is not read again at once; a stale or hidden page is handled', async () => {
  let clock = 1_000_000;
  let visible = true;
  const timers = fakeTimers();
  let fetches = 0;
  const f = createRestOrdersFeed({
    allowed: () => true, pageAnswers: () => false, today: () => '2026-10-07',
    fetchSections: async () => { fetches++; return [{ titleKey: 'k', names: ['A'], more: 0 }]; },
    onChange() {}, now: () => clock, visible: () => visible, timers,
  });
  f.start();
  await settle();
  assert.equal(fetches, 1);
  f.stop();
  clock += 10 * 60 * 1000;   // a second rest 10 minutes later: still fresh
  f.start();
  await settle();
  assert.equal(fetches, 1, 'no read for an answer younger than 15 minutes');
  f.stop();
  clock += 6 * 60 * 1000;    // 16 minutes old: stale
  visible = false;
  f.start();
  await settle();
  assert.equal(fetches, 1, 'nothing is read while the page is hidden');
  visible = true;
  f.refreshIfStale();        // back in view while resting
  await settle();
  assert.equal(fetches, 2);
  f.refreshIfStale();        // fresh now: no read
  await settle();
  assert.equal(fetches, 2);
});

test('kiosk-orders.js reads once (no listener) and only the bounded week', () => {
  const src = read('js/kiosk-orders.js');
  assert.doesNotMatch(src, /onSnapshot|watchCollection|watchRecentHistory|watchDoc/);
  assert.match(src, /getHistoryFrom\(weekStart\(today, weekStartsOn\)\)/);
  const kiosk = read('js/kiosk.js');
  assert.match(kiosk, /isSectionAllowed\(session\.location, 'orders'\)/);
  assert.match(kiosk, /cardVisibleTo\(session\.location, session\.canManage, 'orders'\)/);
  assert.match(read('js/orders/firebase-orders.js'), /export async function getHistoryFrom\(fromDate\)[\s\S]*?where\('date', '>=', fromDate\)/);
});

test('both languages carry the section titles', () => {
  const dicts = _dictionaries();
  for (const lang of ['en', 'it']) {
    for (const key of ['kiosk.rest.toOrderTitle', 'kiosk.rest.arrivingTitle', 'kiosk.rest.tap']) {
      assert.equal(typeof dicts[lang][key], 'string', `${lang} ${key}`);
    }
  }
  assert.equal(dicts.it['kiosk.rest.toOrderTitle'], 'Da ordinare oggi');
  assert.equal(dicts.it['kiosk.rest.arrivingTitle'], 'In arrivo oggi');
  assert.equal(dicts.en['kiosk.rest.toOrderTitle'], 'To order today');
  assert.equal(dicts.en['kiosk.rest.arrivingTitle'], 'Arriving today');
});

test('the new module is precached', () => {
  assert.deepEqual(missingFromPrecache(['js/kiosk-orders.js']), []);
});
