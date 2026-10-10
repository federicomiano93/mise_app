// usage.js — how the app is used: the screens people open, for how long, and the moves from
// one screen to the next (the routes that may deserve a shortcut).
//
// A device keeps ONE accumulator per person per venue per day in its own storage and sends the
// whole of it now and then: locations/{lid}/usage/<deviceId>_<YYYYMMDD>_<uid>. The line carries
// the signed-in account's uid (the owner's choice, 9 Oct 2026, internal use — never a name or an
// email). The rules refuse every read; only the owner's script (scripts/read-usage.mjs) sees them.
//
// WHAT A «SCREEN» IS: the page (index, orders, catalogue…) and, inside a page, a view announced by
// a `mise:screen` event on window (detail = view name, '' = back to the main view) → `page` or
// `page:view`. Key actions are announced by `mise:action` (detail = a short name). The code that
// announces them imports nothing from here: one dispatchEvent line, and a page without this file
// is not affected.
//
// Imported by js/auth-gate.js, which every member page loads and the client ordering page
// (order.html) and the password-reset page do not: a client account is not a member and its
// writes would be refused.
//
// ⚠️ NEVER VISIBLE, NEVER BLOCKING (P17). Every failure is a console line with the error code and
// nothing else; every storage access is in a try/catch; nothing is thrown, drawn or awaited.
// ⚠️ NO STORAGE, NO LINE. The local accumulator IS the day's truth; with nowhere to keep it,
// nothing is sent (a smaller total would overwrite a bigger one on the server).
// ⚠️ THE KEYS START WITH "usage-": js/local-data.js keeps that prefix through a sign-out and a
// venue switch. Wiped, the next write of the day would carry smaller totals than the line already
// on the server and replace them.
// ⚠️ FEW WRITES (P14). A line is sent only if something changed AND ten minutes passed since the
// last send (three when the page is being hidden), or the day is over. The throttle clock starts
// when the day's record is made, so a short visit does not write on its own.
// ⚠️ A RECORD IS CLEAN ONLY WHEN THE SERVER ANSWERED (and nothing was added meanwhile: `rev`).
// `lastSentAt` is the time of the last ATTEMPT, which bounds the retries to one per ten
// minutes; a write that never settles (offline, or a page that died) is sent again later,
// the same document id and the whole document, so repeating it is harmless.
// ⚠️ A RECORD THAT NEVER REACHED A SEND THRESHOLD is still sent: today's on the first check
// ten minutes after it was made, a past day's on the next page load. It is pruned only
// after seven days unsent.
// ⚠️ NOTHING TO RECORD, NOTHING WRITTEN: no target of a tap, no text, no value is ever read —
// only the name of the screen the tap happened on.

import { askVersionOf, versionNumber } from './app-version.js';
import { deviceKind, sameSession } from './device-model.js';
import { deviceIdFrom } from './device-ping.js';
import {
  newAcc, mergeAcc, cleanAcc, isEmptyAcc, addScreen, addRoute, addSeconds, addTap, addAction,
  addLoad, addOffline, touchMinute, dayKeyOf, docId, payloadOf, SCREEN_RE, ACTION_RE,
} from './usage-model.js';

export const STORE_PREFIX = 'usage-';
export const LAST_KEY = 'usage-last';
export const TICK_MS = 15000;
// How often the send check runs; the ten-minute throttle inside it decides.
export const FLUSH_CHECK_MS = 60000;
export const IDLE_MS = 120000;
export const ROUTE_WINDOW_MS = 30 * 60 * 1000;
export const SEND_EVERY_MS = 10 * 60 * 1000;
export const SEND_ON_HIDE_MS = 3 * 60 * 1000;
export const KEEP_DAYS = 7;
// Let the page paint and the first reads finish before any write.
const START_DELAY_MS = 2500;

function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function isReady(session) {
  return !!session && session.status === 'ready' && !!session.locationId && !!(session.user && session.user.uid);
}

// Only these codes mean «asking again won't help»: a refusal does not heal by retrying.
function isFinalRefusal(err) {
  const code = err && err.code ? String(err.code) : '';
  return code === 'permission-denied' || code === 'invalid-argument';
}

function warn(err) {
  try { console.warn('Usage not sent:', err && err.code ? err.code : 'unknown'); } catch { /* nothing */ }
}

// The page's name from its path: «/mise_app/orders.html» → «orders»; the root → «index».
export function pageName(pathname) {
  const file = String(pathname || '').split('/').pop() || '';
  const base = file.replace(/\.html?$/i, '').toLowerCase();
  const name = base || 'index';
  return SCREEN_RE.test(name) ? name : 'other';
}

export function storeKey(lid, uid, dayKey) {
  return `${STORE_PREFIX}${lid}-${uid}-${dayKey}`;
}

// The inverse of storeKey. The uid has no hyphen and the day is eight digits, so the venue
// (which may have hyphens) is whatever is left in front.
export function parseStoreKey(key) {
  const match = /^usage-(.+)-([A-Za-z0-9]{1,128})-(20\d{6})$/.exec(String(key || ''));
  return match ? { lid: match[1], uid: match[2], dayKey: match[3] } : null;
}

// `deps` exists so the flow can be tested without a browser; production passes REAL().
export function createTracker(deps = {}) {
  const d = { ...REAL(), ...deps };
  // Counted but not yet merged into the stored day: everything before a venue is open, and the
  // last few seconds before each commit. `memDay` is the day those counts belong to, set when the
  // first one lands, so a tick that crosses midnight files them under the day they were made.
  let mem = newAcc();
  let memDay = null;
  let session = null;
  let current = null;
  let page = null;
  let loadRecorded = false;
  let lastInputAt = d.now().getTime();
  let lastTickAt = lastInputAt;
  let versionPromise = null;
  // The release, once known: a flush on hide cannot wait for it.
  let cachedVersion = null;

  function version() {
    if (!versionPromise) {
      versionPromise = Promise.resolve().then(() => d.version()).catch(() => null)
        .then(v => { cachedVersion = v; return v; });
    }
    return versionPromise;
  }

  function remember(screen) {
    if (!d.storage) return;
    writeJson(d.storage, LAST_KEY, { screen, at: d.now().getTime() });
  }

  // Called before every count: counts made on an earlier day are filed first, then the new
  // count is marked as today's.
  function stamp() {
    const today = dayKeyOf(d.now());
    if (memDay !== null && memDay !== today) commit();
    if (memDay === null) memDay = today;
  }

  // The screen changed (or the page opened).
  function goTo(name) {
    if (typeof name !== 'string' || !SCREEN_RE.test(name) || name === current) return;
    stamp();
    const previous = current;
    current = name;
    addScreen(mem, name);
    if (previous) addRoute(mem, previous, name);
    touchMinute(mem, d.now());
    remember(name);
  }

  // The page just opened: count it, and a move from the screen the last page ended on.
  function begin(pageName_) {
    const now = d.now().getTime();
    const last = d.storage ? readJson(d.storage, LAST_KEY) : null;
    page = pageName_;
    current = null;
    goTo(page);
    if (last && typeof last.screen === 'string' && Number.isFinite(last.at)
        && now - last.at >= 0 && now - last.at < ROUTE_WINDOW_MS) {
      addRoute(mem, last.screen, page);
    }
  }

  // The page finished loading: its load time, once. Not known at begin() — loadEventEnd is 0
  // until the window's load event has run.
  function recordLoad() {
    if (loadRecorded || !page) return;
    const ms = d.navigationMs();
    if (ms === null) return;
    loadRecorded = true;
    stamp();
    addLoad(mem, page, ms);
  }

  // A view inside the page: '' = back to its main view.
  function view(pageOf, detail) {
    if (typeof detail !== 'string') return;
    goTo(detail === '' ? pageOf : `${pageOf}:${detail}`);
  }

  function action(detail) {
    if (typeof detail === 'string' && ACTION_RE.test(detail)) {
      stamp();
      addAction(mem, detail);
    }
  }

  function tap() {
    lastInputAt = d.now().getTime();
    stamp();
    if (current) addTap(mem, current);
    touchMinute(mem, d.now());
  }

  function input() {
    lastInputAt = d.now().getTime();
  }

  // Every 15 seconds: the time between two ticks goes to the current screen only while the
  // page is on show AND somebody did something in the last two minutes.
  function tick() {
    const nowMs = d.now().getTime();
    const elapsed = Math.min(30, Math.max(0, Math.round((nowMs - lastTickAt) / 1000)));
    lastTickAt = nowMs;
    // A tick that crosses midnight files the old counts under the old day first.
    stamp();
    if (!d.visible()) { commit(); return; }
    if (!d.online()) addOffline(mem, elapsed);
    if (current && nowMs - lastInputAt <= IDLE_MS) {
      addSeconds(mem, current, elapsed);
      touchMinute(mem, d.now());
      remember(current);
    }
    commit();
  }

  // Memory → the day's stored record. Needs an open venue; nothing is lost while there is none.
  // Every commit raises `rev`: a write is only called delivered if nothing changed since.
  function commit() {
    try {
      if (!isReady(session) || !d.storage || isEmptyAcc(mem)) return;
      const key = storeKey(session.locationId, session.user.uid, memDay || dayKeyOf(d.now()));
      const stored = readJson(d.storage, key);
      const rec = {
        acc: cleanAcc(stored && stored.acc),
        dirty: true,
        // The time of the last ATTEMPT to send; a new record starts its clock now, so a short
        // visit does not write on its own.
        lastSentAt: stored && Number.isFinite(stored.lastSentAt) ? stored.lastSentAt : d.now().getTime(),
        rev: (stored && Number.isFinite(stored.rev) ? stored.rev : 0) + 1,
      };
      mergeAcc(rec.acc, mem);
      if (writeJson(d.storage, key, rec)) { mem = newAcc(); memDay = null; }
    } catch (err) {
      warn(err);
    }
  }

  // Delete what is older than a week, whoever it belongs to.
  function prune() {
    try {
      const oldest = new Date(d.now().getTime() - KEEP_DAYS * 86400000);
      const limit = dayKeyOf(oldest);
      for (const key of d.keys()) {
        if (key === LAST_KEY) continue;
        const parsed = parseStoreKey(key);
        if (parsed && parsed.dayKey < limit) d.storage.removeItem(key);
      }
    } catch (err) {
      warn(err);
    }
  }

  // The write came back (or was refused for good): the record is clean ONLY if nothing was added
  // while it was in flight, and a past day's record is then deleted.
  function settle(key, sentRev, past) {
    try {
      const again = readJson(d.storage, key);
      if (!again) return;
      if ((Number.isFinite(again.rev) ? again.rev : 0) !== sentRev) return;
      if (past) d.storage.removeItem(key);
      else writeJson(d.storage, key, { ...again, dirty: false });
    } catch { /* it stays dirty: one more send, same document id */ }
  }

  // Sends what is due for the open session. `reason`: 'timer' | 'hidden' | 'load'.
  //
  // ⚠️ ON 'hidden' NOTHING IS AWAITED before the write is handed over (the page may be gone
  // within milliseconds) and only today's record is sent; past days go on 'load' and 'timer'.
  // ⚠️ A RECORD IS CLEAN ONLY WHEN THE SERVER ANSWERED. Handing the write to the SDK proves
  // nothing: a page that is leaving dies before it reaches even the offline cache. So the
  // record stays dirty, `lastSentAt` is the time of the ATTEMPT (it bounds the retries to one
  // per ten minutes), and an offline write that never settles is simply sent again later — the
  // same document id, the whole document, so repeating it is harmless.
  async function flush(reason) {
    try {
      if (!isReady(session) || !d.storage) return 'skipped';
      commit();
      const hidden = reason === 'hidden';
      const today = dayKeyOf(d.now());
      const mine = d.keys().map(parseStoreKey)
        .filter(p => p && p.lid === session.locationId && p.uid === session.user.uid)
        .filter(p => !hidden || p.dayKey === today);
      if (mine.length === 0) return 'nothing';
      const deviceId = d.deviceId();
      if (!deviceId) return 'no-device';
      const appVersion = hidden ? cachedVersion : await version();
      // Who is signed in NOW: the person may have left during the wait for the version.
      if (!sameSession(session, d.currentSession())) return 'skipped';
      let sent = 0;
      for (const p of mine) {
        const key = storeKey(p.lid, p.uid, p.dayKey);
        const rec = readJson(d.storage, key);
        if (!rec) continue;
        const past = p.dayKey < today;
        if (!rec.dirty) {
          if (past) { try { d.storage.removeItem(key); } catch { /* next time */ } }
          continue;
        }
        const nowMs = d.now().getTime();
        const since = nowMs - (Number.isFinite(rec.lastSentAt) ? rec.lastSentAt : 0);
        const due = past
          ? (reason === 'load' || since >= SEND_EVERY_MS)
          : (since >= SEND_EVERY_MS || (hidden && since >= SEND_ON_HIDE_MS));
        if (!due) continue;
        const id = docId(deviceId, p.dayKey, p.uid);
        const payload = payloadOf(rec.acc, { deviceId, dayKey: p.dayKey, kind: d.kind(), appVersion });
        if (!id || !payload) continue;
        const sentRev = Number.isFinite(rec.rev) ? rec.rev : 0;
        // The attempt is stamped BEFORE the write: a page that dies mid-write still bounds the retries.
        if (!writeJson(d.storage, key, { ...rec, lastSentAt: nowMs })) continue;
        let sending;
        try { sending = Promise.resolve(d.send(payload, id)); } catch (err) { sending = Promise.reject(err); }
        sent += 1;
        sending.then(() => settle(key, sentRev, past), err => {
          // A refusal by the rules would only repeat itself: leave it be. A passing failure
          // (offline, busy) keeps the record dirty for the next attempt.
          if (isFinalRefusal(err)) settle(key, sentRev, past);
          warn(err);
        });
      }
      return sent > 0 ? 'sent' : 'nothing';
    } catch (err) {
      warn(err);
      return 'failed';
    }
  }

  // What was counted so far belongs to whoever was signed in until now, never to the next person.
  function setSession(next) {
    if (isReady(session)) commit();
    session = next;
    if (isReady(session)) {
      commit();
      // Asked now so a flush on hide already has it.
      version();
    }
  }

  return {
    begin, view, action, tap, input, tick, commit, flush, prune, setSession, goTo, recordLoad,
    useCurrentSession: fn => { d.currentSession = fn; },
    pending: () => mem,
    current: () => current,
  };
}

// The browser's own answers, read when needed (not at import: this file is also loaded by tests).
function REAL() {
  const storage = (() => { try { return window.localStorage; } catch { return null; } })();
  return {
    storage,
    now: () => new Date(),
    keys: () => {
      try { return Object.keys(window.localStorage).filter(k => k.startsWith(STORE_PREFIX)); } catch { return []; }
    },
    visible: () => document.visibilityState !== 'hidden',
    online: () => navigator.onLine !== false,
    navigationMs: () => {
      try {
        const entry = performance.getEntriesByType('navigation')[0];
        if (!entry) return null;
        const end = entry.loadEventEnd > 0 ? entry.loadEventEnd : entry.domContentLoadedEventEnd;
        return end > 0 ? end : null;
      } catch { return null; }
    },
    // Read, or made if this is the first time any file asks (the device count owns the id).
    deviceId: () => deviceIdFrom(storage, () => crypto.getRandomValues(new Uint8Array(64))),
    kind: () => deviceKind({
      width: screen.width,
      height: screen.height,
      coarse: window.matchMedia('(pointer: coarse)').matches,
    }),
    version: async () => {
      const controller = navigator.serviceWorker ? navigator.serviceWorker.controller : null;
      return versionNumber(await askVersionOf(controller, { timeoutMs: 800, attempts: 1 }));
    },
    currentSession: () => null,
    send: (payload, id) => import('./firebase.js').then(m => m.saveUsage(payload, id)),
  };
}

// firebase.js is loaded here, not imported at the top, so tests can read this file without the
// Firebase SDK from its CDN. Every page that loads the gate has already loaded it.
//
// ⚠️ THE WHOLE BODY IS IN A try: auth-gate.js imports this file statically, so a throw here
// would stop the sign-in on every page.
function start() {
  try {
    const page = pageName(location.pathname);
    const tracker = createTracker({});
    tracker.begin(page);

    const on = (type, fn, capture) => window.addEventListener(type, fn, capture === true ? { capture: true, passive: true } : { passive: true });
    on('pointerdown', () => tracker.tap(), true);
    on('keydown', () => tracker.input());
    on('wheel', () => tracker.input());
    on('scroll', () => tracker.input(), true);
    on('mise:screen', event => tracker.view(page, event.detail));
    on('mise:action', event => tracker.action(event.detail));
    // loadEventEnd is 0 until the load event has finished, so the load time is read after it.
    const noteLoad = () => setTimeout(() => tracker.recordLoad(), 0);
    if (document.readyState === 'complete') noteLoad();
    else window.addEventListener('load', noteLoad, { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        tracker.tick();
        tracker.flush('hidden');
      }
    });
    window.addEventListener('pagehide', () => {
      tracker.tick();
      tracker.flush('hidden');
    });
    setInterval(() => tracker.tick(), TICK_MS);
    // The ten-minute throttle inside flush decides whether anything is actually sent.
    setInterval(() => tracker.flush('timer'), FLUSH_CHECK_MS);

    import('./firebase.js').then(({ onSession, currentSession }) => {
      tracker.useCurrentSession(currentSession);
      onSession(session => {
        tracker.setSession(session);
        if (!isReady(session)) return;
        tracker.prune();
        setTimeout(() => {
          if (sameSession(session, currentSession())) tracker.flush('load');
        }, START_DELAY_MS);
      });
    }).catch(err => {
      console.warn('Usage not started:', err && err.code ? err.code : 'unknown');
    });
  } catch (err) {
    try { console.warn('Usage not started:', err && err.code ? err.code : 'unknown'); } catch { /* nothing */ }
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') start();
