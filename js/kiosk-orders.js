// kiosk-orders.js — the Orders information on the kiosk rest screen, on EVERY page.
//
// js/kiosk.js asks the page for it with the `kiosk-rest-info` window event; the Orders
// page answers from its own live data. On every other page nothing answers, so this
// module reads it instead: a few one-time reads (no listener) while the tablet RESTS,
// kept in memory and handed over synchronously. It stays silent where the Orders page
// already answers (its live data is fresher and a second answer would double the lines).
//
// Reads, per refresh (see fetchRestSections): config/orders (1 document), suppliers (all of
// them), orders-history from the start of the current work week (a bounded `date >=`
// query — a handful of documents). Refreshed when the screen goes to rest and every
// 15 minutes while it stays there; never in the night, never while somebody is working.
//
// The gate (Orders allowed + card visible, as the Home badge) lives in js/kiosk.js, which
// loads THIS file with a dynamic import only once the gate has passed. A root-level file may
// import the Orders folder's data layer and pure rules, as that badge does. A failed read
// keeps the previous answer and never reaches the kiosk (P17).
// Reads are thrifty (P14): an answer younger than REFRESH_MS is reused (a short rest after a
// short work spell costs nothing), and nothing is read while the page is hidden.

import { kioskSectionsFromData } from './orders/kiosk-lines.js';
import { todayISO } from './orders/day.js';
import { weekStart, weekStartOf } from './orders/work-week.js';

export const REFRESH_MS = 15 * 60 * 1000;

// The reads. Returns the sections to draw for today.
export async function fetchRestSections() {
  const orders = await import('./orders/firebase-orders.js');
  const today = todayISO();

  // config/orders decides which day the week starts on; on a failed read the local
  // mirror Orders keeps, then the default (Sunday).
  let config = null;
  try {
    config = await orders.getDocOnce(orders.COLLECTIONS.config, 'orders');
  } catch {
    try { config = JSON.parse(localStorage.getItem('orders-config') || 'null'); } catch { config = null; }
  }
  const weekStartsOn = weekStartOf(config);

  const [suppliers, history] = await Promise.all([
    orders.getCollection(orders.COLLECTIONS.suppliers),
    orders.getHistoryFrom(weekStart(today, weekStartsOn)),
  ]);
  return kioskSectionsFromData({ suppliers, history, today, weekStartsOn });
}

// The scheduler and the memory, with everything outside injected so it can be tested:
//   allowed()        may this person see Orders at all (re-checked on every refresh)
//   pageAnswers()    does the page itself answer kiosk-rest-info (the Orders page)
//   fetchSections()  the reads
//   onChange()       fresh data arrived: repaint
//   today()          the local day, so yesterday's answer is never shown
//   now()            milliseconds, to age the answer
//   visible()        false while the page is hidden: nothing is read then
//   timers           { set, clear } for the 15-minute repeat
export function createRestOrdersFeed({
  allowed, pageAnswers, fetchSections, onChange, today = todayISO,
  now = () => Date.now(),
  visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  timers = { set: (fn, ms) => setInterval(fn, ms), clear: id => clearInterval(id) },
}) {
  let timer = null;
  let running = false;
  let inFlight = false;
  let token = 0;
  let cache = null;   // { day, at, sections }

  // An answer of today that is younger than REFRESH_MS: the screen is never staler than that.
  function fresh() {
    return !!cache && cache.day === today() && now() - cache.at < REFRESH_MS;
  }

  async function refresh() {
    if (!running || inFlight || !visible() || !allowed() || pageAnswers()) return;
    const mine = token;
    inFlight = true;
    try {
      const sections = await fetchSections();
      if (mine !== token) return;   // stopped (woken, night) while the reads were out
      cache = { day: today(), at: now(), sections: Array.isArray(sections) ? sections : [] };
      onChange();
    } catch (err) {
      // Keep what we had. Only the error code is logged: no names, no data.
      console.warn('The kiosk Orders lines could not be refreshed:', err && err.code ? err.code : 'error');
    } finally {
      if (mine === token) inFlight = false;
    }
  }

  return {
    // Idempotent: called on entering rest and whenever the session changes while resting.
    start() {
      if (running || !allowed() || pageAnswers()) return;
      running = true;
      if (!fresh()) refresh();
      timer = timers.set(refresh, REFRESH_MS);
    },
    stop() {
      running = false;
      inFlight = false;
      token++;
      if (timer !== null) { timers.clear(timer); timer = null; }
    },
    // The page came back into view while resting: read only if the answer is stale.
    refreshIfStale() {
      if (running && !fresh()) refresh();
    },
    // What kiosk.js draws: the last answer of today, or nothing.
    current() {
      return allowed() && cache && cache.day === today() ? cache.sections : [];
    },
    isRunning: () => running,
  };
}

