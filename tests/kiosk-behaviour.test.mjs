// Drives js/kiosk.js against a fake window / document / clock — no browser. What it cannot
// prove (real touch, focus, the Wake Lock, an actual reload) is driven by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const MIN = 60 * 1000;
const T0 = new Date(2026, 9, 5, 3, 0).getTime();
const GLOBALS = ['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'location',
  'setInterval', 'clearInterval', 'matchMedia'];
let counter = 0;

class El {
  constructor(doc, tag) {
    this.doc = doc; this.tagName = String(tag).toUpperCase(); this.children = []; this.parent = null;
    this.attrs = {}; this.style = {}; this.id = ''; this.className = ''; this.hidden = false;
    this.textContent = ''; this.isConnected = false; this.tabIndex = -1;
    const set = new Set();
    this.classList = { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c) };
  }
  append(...kids) { kids.forEach(k => { k.parent = this; this.children.push(k); k.connect(this.isConnected); }); }
  connect(on) { this.isConnected = on; this.children.forEach(c => c.connect(on)); }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this);
    this.parent = null; this.connect(false);
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  focus() { this.doc.activeElement = this; }
  contains(n) { return n === this || this.children.some(c => c.contains(n)); }
  closest(sel) {
    for (let e = this; e; e = e.parent) if (sel === `#${e.id}`) return e;
    return null;
  }
  get childElementCount() { return this.children.length; }
}

function storage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); } };
}

async function makeEnv({ settings = { enabled: true, restMinutes: 2, nightHours: 1 }, local = {}, session = {} } = {}) {
  const saved = Object.fromEntries(GLOBALS.map(g => [g, Object.getOwnPropertyDescriptor(globalThis, g)]));
  const realNow = Date.now;
  const clock = { now: T0 };
  Date.now = () => clock.now;

  const listeners = new Map();
  const add = (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); };
  const doc = { visibilityState: 'visible', activeElement: null, busy: {}, addEventListener: add, removeEventListener() {},
    querySelectorAll: sel => doc.busy[sel] || [], getElementById: id => (id === 'auth-gate' ? doc.gate : null) };
  doc.createElement = tag => new El(doc, tag);
  doc.body = new El(doc, 'body'); doc.body.isConnected = true;
  doc.documentElement = new El(doc, 'html');
  doc.gate = new El(doc, 'div'); doc.gate.isConnected = true;
  const events = [];
  const win = { addEventListener: add, removeEventListener() {}, dispatchEvent: ev => { events.push(ev.type); return true; }, document: doc };
  const reloads = { n: 0 };
  const waiting = { value: false };
  const define = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  define('window', win);
  define('document', doc);
  define('localStorage', storage({ 'kiosk-mode': JSON.stringify(settings), ...local }));
  define('sessionStorage', storage(session));
  define('navigator', { onLine: true, serviceWorker: {
    controller: {}, getRegistration: async () => ({ waiting: waiting.value ? {} : null }) } });
  define('location', { reload: () => { reloads.n++; } });
  define('setInterval', () => 1);
  define('clearInterval', () => {});
  define('matchMedia', () => ({ matches: true }));   // reduced motion: the cover goes at once

  const mod = await import(`../js/kiosk.js?run=${++counter}`);
  const k = mod.__testing;
  const updates = { n: 0 };
  k.setUpdater(async () => { updates.n++; });
  k.session({ status: 'ready', name: 'Test venue' });

  const settle = () => new Promise(r => setTimeout(r, 0));
  return {
    k, doc, clock, reloads, updates, waiting, settle, events,
    cover: () => doc.body.children.find(c => c.id === 'kiosk-rest') || null,
    advance(ms) { clock.now += ms; },
    fire(type) { (listeners.get(type) || []).forEach(fn => fn({ type })); },
    // The waking tap: a key press aimed at the cover (the path armWakeTap finishes at once).
    tap() {
      const ev = { type: 'keydown', target: doc.body.children.find(c => c.id === 'kiosk-rest'),
        preventDefault() {}, stopPropagation() {} };
      (listeners.get('keydown') || []).forEach(fn => fn(ev));
    },
    async tick() { k.tick(); await settle(); },
    stop() {
      localStorage.setItem('kiosk-mode', JSON.stringify({ enabled: false }));
      k.applySettings();
      Date.now = realNow;
      for (const [g, d] of Object.entries(saved)) {
        if (d) Object.defineProperty(globalThis, g, d); else delete globalThis[g];
      }
    },
  };
}

async function inEnv(opts, fn) {
  const env = await makeEnv(opts);
  try { await fn(env); } finally { env.stop(); }
}

test('rests after restMinutes of silence, and the cover is up', () => inEnv({}, async e => {
  await e.tick();
  assert.equal(e.k.state(), 'active');
  e.advance(2 * MIN);
  await e.tick();
  assert.equal(e.k.state(), 'rest');
  assert.ok(e.cover());
}));

// A day already reloaded, so the rest→night transition does not start the daily reload and the
// auto-update is what is being looked at.
const RELOADED_TODAY = { 'kiosk-last-reload': '2026-10-05' };

// Rests, then (with an update waiting or not) crosses into night; that tick is the night-ENTRY.
async function toNight(e, { waiting = false } = {}) {
  e.advance(3 * MIN); await e.tick();
  assert.equal(e.k.state(), 'rest');
  e.waiting.value = waiting;
  e.advance(61 * MIN); await e.tick();
  assert.equal(e.k.state(), 'night');
}

test('⚠ the update gate appearing at the night entry does not stop the auto-update, which replaces the plain reload', () => inEnv({}, async e => {
  const gate = new El(e.doc, 'div'); gate.id = 'sw-update-gate';
  e.doc.busy['.app-dialog-backdrop'] = [gate];
  await toNight(e, { waiting: true });
  assert.equal(e.updates.n, 1, 'updateNow was called');
  assert.equal(e.reloads.n, 0, 'no second, plain reload');
  assert.equal(sessionStorage.getItem('kiosk-resume'), 'night');
  assert.match(localStorage.getItem('kiosk-last-reload'), /^2026-10-05$/);
}));

test('⚠ an update arriving later in the night waits: not on a tick, not when the page becomes visible', () => inEnv({ local: RELOADED_TODAY }, async e => {
  await toNight(e);
  e.waiting.value = true;
  e.advance(5 * MIN); await e.tick();
  e.fire('visibilitychange');
  await e.settle();
  assert.equal(e.updates.n, 0);
  assert.equal(e.reloads.n, 0);
}));

test('⚠ an update waiting under the rest cover is NOT applied: a reload there switches the screen off', () => inEnv({}, async e => {
  e.advance(3 * MIN); await e.tick();
  e.waiting.value = true;
  e.advance(30 * MIN); await e.tick();
  assert.equal(e.k.state(), 'rest');
  assert.equal(e.updates.n, 0);
  assert.equal(e.reloads.n, 0);
}));

test('a real dialog still holds the update back, and so do too many failed attempts', async () => {
  await inEnv({ local: RELOADED_TODAY }, async e => {
    e.advance(3 * MIN); await e.tick();
    e.waiting.value = true;
    e.doc.busy['.app-dialog-backdrop'] = [new El(e.doc, 'div')];
    e.advance(61 * MIN); await e.tick();
    assert.equal(e.k.state(), 'night');
    assert.equal(e.updates.n, 0);
  });
  await inEnv({ local: RELOADED_TODAY, session: { 'sw-update-attempts': '2' } }, async e => {
    await toNight(e, { waiting: true });
    assert.equal(e.updates.n, 0, 'attempts >= MAX_ATTEMPTS: no reload loop all night');
  });
});

test('⚠ the session going signed-out while resting removes the cover', () => inEnv({}, async e => {
  e.advance(3 * MIN); await e.tick();
  assert.ok(e.cover());
  e.k.session({ status: 'signed-out' });
  assert.equal(e.k.state(), 'active');
  assert.equal(e.cover(), null);
}));

test('the sign-in screen appearing is caught by the tick too, and it never rests signed-out', () => inEnv({}, async e => {
  e.advance(3 * MIN); await e.tick();
  assert.ok(e.cover());
  e.doc.gate.append(new El(e.doc, 'form'));
  await e.tick();
  assert.equal(e.cover(), null);
  e.advance(30 * MIN); await e.tick();
  assert.equal(e.k.state(), 'active', 'not signed in: no rest');
}));

test('a page resumed after our own reload comes back covered, and drops the cover if not signed in', async () => {
  await inEnv({ session: { 'kiosk-resume': 'night' } }, async e => {
    assert.equal(e.k.state(), 'night');
    assert.ok(e.cover());
    assert.equal(e.k.hasLock(), false, 'night holds no wake lock');
    assert.equal(sessionStorage.getItem('kiosk-resume'), null, 'the key is consumed');
  });
  await inEnv({ session: { 'kiosk-resume': 'rest' } }, async e => {
    e.k.session({ status: 'signed-out' });
    assert.equal(e.k.state(), 'active');
  });
});

test('coming back from another app is not idleness', () => inEnv({}, async e => {
  e.advance(3 * MIN);                     // away for three minutes
  e.fire('visibilitychange');
  assert.equal(e.k.state(), 'active');
  assert.equal(e.cover(), null);
}));

test('a focused field does not stop the rest, but holds back the reloads', () => inEnv({}, async e => {
  const input = new El(e.doc, 'input');
  e.doc.body.append(input);
  input.focus();
  e.advance(3 * MIN);
  await e.tick();
  assert.equal(e.k.state(), 'rest', 'rests with a field focused');
  assert.notEqual(e.doc.activeElement, input, 'the cover took the focus');
  e.waiting.value = true;
  await e.tick();                         // NOT re-focused by hand: the field that had it still counts
  assert.equal(e.updates.n, 0, 'no auto-update while a field was left focused');
  e.advance(61 * MIN);
  await e.tick();
  assert.equal(e.k.state(), 'night');
  assert.equal(e.reloads.n, 0, 'no daily reload either');
  input.remove();                         // the field is gone from the page
  await e.tick();
  assert.equal(e.updates.n, 0, 'the night-entry tick has passed: the update waits for the wake and the gate');
}));

test('a focused checkbox is not typing', () => inEnv({ local: RELOADED_TODAY }, async e => {
  const box = new El(e.doc, 'input'); box.type = 'checkbox';
  e.doc.body.append(box); box.focus();
  e.advance(3 * MIN); await e.tick();
  e.waiting.value = true;
  e.advance(61 * MIN); await e.tick();
  assert.equal(e.k.state(), 'night');
  assert.equal(e.updates.n, 1);
}));

test('a signed-out tablet holds no wake lock; a signed-in one does', () => inEnv({}, async e => {
  assert.equal(e.k.hasLock(), true);
  e.k.session({ status: 'signed-out' });
  assert.equal(e.k.hasLock(), false);
  e.k.session({ status: 'ready', name: 'V' });
  assert.equal(e.k.hasLock(), true);
}));

test('taking the cover off announces kiosk-awake', () => inEnv({}, async e => {
  e.advance(3 * MIN); await e.tick();
  assert.ok(!e.events.includes('kiosk-awake'));
  e.k.session({ status: 'signed-out' });
  assert.ok(e.events.includes('kiosk-awake'));
}));

test('the daily reload happens exactly once, at the rest→night transition, and comes back dark', () => inEnv({}, async e => {
  e.advance(3 * MIN); await e.tick();
  assert.equal(e.k.state(), 'rest');
  e.advance(30 * MIN); await e.tick();
  assert.equal(e.reloads.n, 0, 'still resting: no reload');
  e.advance(31 * MIN); await e.tick();
  assert.equal(e.k.state(), 'night');
  assert.equal(e.reloads.n, 1);
  assert.equal(sessionStorage.getItem('kiosk-resume'), 'night');
  assert.match(localStorage.getItem('kiosk-last-reload'), /^2026-10-05$/);
  e.advance(10 * MIN); await e.tick();
  assert.equal(e.reloads.n, 1);
}));

test('no second reload the same day', () => inEnv({ local: { 'kiosk-last-reload': '2026-10-05' } }, async e => {
  e.advance(3 * MIN); await e.tick();
  e.advance(70 * MIN); await e.tick();
  assert.equal(e.k.state(), 'night');
  assert.equal(e.reloads.n, 0);
}));

// The Orders lines on the cover: the feed (js/kiosk-orders.js, loaded lazily) is started when
// the cover goes up and stopped on wake and on night. Deleting the syncRestFeed() call from
// enter() makes this fail.
function fakeOrdersModule() {
  const log = [];
  return {
    log,
    mod: {
      fetchRestSections: async () => [],
      createRestOrdersFeed: () => ({
        start: () => log.push('start'), stop: () => log.push('stop'),
        current: () => [], refreshIfStale: () => log.push('stale'),
      }),
    },
  };
}

test('the Orders feed starts on rest and stops on wake', () => inEnv({}, async e => {
  const fake = fakeOrdersModule();
  let loads = 0;
  e.k.setOrdersLoader(async () => { loads++; return fake.mod; });
  assert.equal(loads, 0, 'not loaded while active');
  await e.tick();
  assert.equal(loads, 0);
  e.advance(3 * MIN); await e.tick();
  assert.equal(e.k.state(), 'rest');
  assert.equal(loads, 1, 'loaded the first time it is needed');
  assert.equal(fake.log.filter(x => x === 'start').length, 1);
  e.k.session({ status: 'signed-out' });   // a wake path
  assert.equal(e.k.state(), 'active');
  assert.equal(fake.log.at(-1), 'stop');
}));

test('the Orders feed stops when the night begins', () => inEnv({}, async e => {
  const fake = fakeOrdersModule();
  e.k.setOrdersLoader(async () => fake.mod);
  e.advance(3 * MIN); await e.tick();
  assert.equal(fake.log.at(-1), 'start');
  e.advance(61 * MIN); await e.tick();
  assert.equal(e.k.state(), 'night');
  assert.equal(fake.log.at(-1), 'stop');
}));

test('a module that fails to load leaves the kiosk working, and is not retried in a loop', () => inEnv({}, async e => {
  let loads = 0;
  e.k.setOrdersLoader(async () => { loads++; throw new Error('Jane Doe'); });
  const warn = console.warn;
  const logged = [];
  console.warn = (...a) => logged.push(a);
  try {
    e.advance(3 * MIN); await e.tick();
    assert.equal(e.k.state(), 'rest');
    assert.ok(e.cover());
    await e.tick();
    assert.equal(loads, 1);
    assert.ok(!JSON.stringify(logged).includes('Jane'));
  } finally { console.warn = warn; }
}));

test('waking while a reload is on its way drops the resume marker', () => inEnv({ local: RELOADED_TODAY }, async e => {
  await toNight(e, { waiting: true });    // the update starts: resume = night
  assert.equal(sessionStorage.getItem('kiosk-resume'), 'night');
  e.k.session({ status: 'signed-out' });  // any wake path
  assert.equal(sessionStorage.getItem('kiosk-resume'), null);
}));

// «Never switch off» (nightHours 0): no reload under the cover, the day's reload is the waking tap.
const NEVER = { enabled: true, restMinutes: 2, nightHours: 0 };

test('⚠ nightHours 0: two hours of rest reload nothing and the lock stays held', () => inEnv({ settings: NEVER }, async e => {
  e.advance(3 * MIN); await e.tick();
  assert.equal(e.k.state(), 'rest');
  e.waiting.value = true;
  e.advance(2 * 60 * MIN); await e.tick();
  assert.equal(e.k.state(), 'rest');
  assert.equal(e.reloads.n, 0);
  assert.equal(e.updates.n, 0);
  assert.equal(e.k.hasLock(), true);
  assert.equal(sessionStorage.getItem('kiosk-resume'), null);
}));

test('nightHours 0: the waking tap after a long rest reloads once, covered, and comes back active', () => inEnv({ settings: NEVER }, async e => {
  e.advance(3 * MIN); await e.tick();
  e.advance(2 * 60 * MIN); await e.tick();
  e.tap();
  assert.equal(e.reloads.n, 1);
  assert.match(localStorage.getItem('kiosk-last-reload'), /^2026-10-05$/);
  assert.equal(sessionStorage.getItem('kiosk-resume'), null, 'it comes back active');
  assert.ok(e.cover(), 'the cover stays up until the page is gone');
  assert.equal(e.k.state(), 'rest');
  const centre = e.cover().children[0].children[1];
  assert.equal(centre.children.length, 1);
  assert.equal(centre.children[0].className, 'kiosk-rest-section-title');
  assert.equal(centre.children[0].textContent, 'One moment, reloading Mise…');
  assert.equal(e.cover().attrs['aria-label'], 'One moment, reloading Mise…');
  e.advance(15 * 1000); await e.tick();   // a later tick neither hides the cover nor reloads again
  assert.equal(e.reloads.n, 1);
  assert.ok(e.cover());
}));

test('⚠ a wake reload that stalls gives the app back after 15 seconds', () => inEnv({ settings: NEVER }, async e => {
  const timers = [];
  const realSet = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => { timers.push({ fn, ms }); return realSet(fn, ms, ...rest); };
  try {
    e.advance(3 * MIN); await e.tick();
    e.advance(2 * 60 * MIN); await e.tick();
    e.tap();
    assert.equal(e.reloads.n, 1);
    const stall = timers.find(x => x.ms === 15000);
    assert.ok(stall, 'a failsafe timer was set');
    assert.ok(e.cover());
    stall.fn();                           // the page is still here
    assert.equal(e.k.state(), 'active');
    assert.equal(e.cover(), null);
  } finally { globalThis.setTimeout = realSet; }
}));

test('every tick re-requests a wake lock the browser let go of', () => inEnv({}, async e => {
  const log = { requests: 0, sentinels: [] };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: {
    onLine: true, serviceWorker: { controller: {}, getRegistration: async () => ({ waiting: null }) },
    wakeLock: { async request() {
      log.requests++;
      const s = { listener: null, addEventListener(t, f) { s.listener = f; }, release() {} };
      log.sentinels.push(s);
      return s;
    } },
  } });
  // The kiosk already holds its owner (start() ran before the API existed, so nothing was
  // requested then): the first tick asks, and so does the first tick after a release.
  await e.tick(); await e.settle();
  assert.equal(log.requests, 1, 'the tick asked for the lock');
  await e.tick(); await e.settle();
  assert.equal(log.requests, 1, 'a live sentinel is not asked for twice');
  log.sentinels[0].listener();            // released by the browser, the page never hidden
  await e.tick(); await e.settle();
  assert.equal(log.requests, 2, 'the next tick asked again');
}));

test('nightHours 0: a second long rest and wake the same day does not reload again', () => inEnv({ settings: NEVER, local: RELOADED_TODAY }, async e => {
  e.advance(3 * MIN); await e.tick();
  e.advance(2 * 60 * MIN); await e.tick();
  e.tap();
  assert.equal(e.reloads.n, 0);
  assert.equal(e.k.state(), 'active');
  assert.equal(e.cover(), null);
}));

test('nightHours 0: a short rest or a focused text field makes the waking tap a plain wake', async () => {
  await inEnv({ settings: NEVER }, async e => {
    e.advance(3 * MIN); await e.tick();
    e.advance(30 * MIN); await e.tick();
    e.tap();
    assert.equal(e.reloads.n, 0);
    assert.equal(e.k.state(), 'active');
  });
  await inEnv({ settings: NEVER }, async e => {
    const input = new El(e.doc, 'input');
    e.doc.body.append(input); input.focus();
    e.advance(3 * MIN); await e.tick();
    e.advance(2 * 60 * MIN); await e.tick();
    e.tap();
    assert.equal(e.reloads.n, 0, 'typing: no reload');
    assert.equal(e.k.state(), 'active');
  });
});

test('with a night the waking tap never reloads (their daily reload is the night transition)', () => inEnv({}, async e => {
  e.advance(3 * MIN); await e.tick();
  e.advance(30 * MIN); await e.tick();
  e.tap();
  assert.equal(e.reloads.n, 0);
  assert.equal(e.k.state(), 'active');
}));
