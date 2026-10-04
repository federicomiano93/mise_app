// wake-lock.js — the Screen Wake Lock, shared by everything that wants the screen kept
// on, counted BY OWNER: the lock is held while ANY owner holds it and let go when the
// last one releases. Owners today: 'guided-mix' (the timer on the bench) and 'kiosk'.
//
// ⚠️ THE LOCK IS RELEASED BY THE BROWSER WHENEVER THE PAGE IS HIDDEN, and it does NOT
// come back by itself. Without the visibilitychange listener below, glancing at another
// app once would leave the screen free to sleep for the rest of the job — which looks
// exactly like the feature not working.
//
// Absent on older iOS (before 16.4) and on any browser that does not offer it. Nothing
// here ever throws in that case; the screen simply sleeps as it always did.

const owners = new Set();
let sentinel = null;
let requesting = false;

function api() {
  return typeof navigator !== 'undefined' ? navigator.wakeLock : null;
}

async function acquire() {
  if (owners.size === 0 || sentinel || requesting) return;
  const lock = api();
  if (!lock || typeof lock.request !== 'function') return;
  requesting = true;
  try {
    const got = await lock.request('screen');
    if (owners.size === 0) {
      // Everybody let go while the request was in flight.
      try { got.release(); } catch (e) { /* already gone */ }
    } else {
      sentinel = got;
      got.addEventListener('release', () => { if (sentinel === got) sentinel = null; });
    }
  } catch (e) {
    // Refused (a battery-saver, a background tab, an unsupported context).
    sentinel = null;
  } finally {
    requesting = false;
  }
}

function onVisible() {
  if (document.visibilityState === 'visible') acquire();
}

export function acquireWakeLock(owner) {
  if (owners.has(owner)) return;
  owners.add(owner);
  if (owners.size === 1 && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
  }
  acquire();
}

export function releaseWakeLock(owner) {
  if (!owners.delete(owner)) return;
  if (owners.size > 0) return;
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  const held = sentinel;
  sentinel = null;
  if (held) { try { held.release(); } catch (e) { /* already gone */ } }
}

// True when this device can hold the screen on, so a screen can say what it actually
// does rather than promising something that will not happen.
export function canKeepScreenAwake() {
  return typeof navigator !== 'undefined'
    && !!navigator.wakeLock && typeof navigator.wakeLock.request === 'function';
}
