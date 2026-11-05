// The Screen Wake Lock, shared by everything that wants the screen kept on, counted BY OWNER (a port of js/wake-lock.js): the
// lock is held while ANY owner holds it and let go when the last one releases. Owner today: 'guided-mix' (the timer on the
// bench).
//
// ⚠️ THE LOCK IS RELEASED BY THE BROWSER WHENEVER THE PAGE IS HIDDEN, and it does NOT come back by itself. Without the
// visibilitychange listener below, glancing at another app once would leave the screen free to sleep for the rest of the
// job — which looks exactly like the feature not working.
//
// Absent on older iOS (before 16.4) and on any browser that does not offer it. Nothing here ever throws in that case; the
// screen simply sleeps as it always did.

type Sentinel = {
  release(): Promise<void> | void;
  addEventListener(type: 'release', listener: () => void): void;
};
type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> };

const owners = new Set<string>();
let sentinel: Sentinel | null = null;
let requesting = false;

function api(): WakeLockApi | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock ?? null;
}

async function acquire(): Promise<void> {
  if (owners.size === 0 || sentinel !== null || requesting) return;
  const lock = api();
  if (lock === null || typeof lock.request !== 'function') return;
  requesting = true;
  try {
    const got = await lock.request('screen');
    if (owners.size === 0) {
      // Everybody let go while the request was in flight.
      try { void got.release(); } catch { /* already gone */ }
    } else {
      sentinel = got;
      got.addEventListener('release', () => { if (sentinel === got) sentinel = null; });
    }
  } catch {
    // Refused (a battery-saver, a background tab, an unsupported context).
    sentinel = null;
  } finally {
    requesting = false;
  }
}

function onVisible(): void {
  if (document.visibilityState === 'visible') void acquire();
}

export function acquireWakeLock(owner: string): void {
  if (owners.has(owner)) return;
  owners.add(owner);
  if (owners.size === 1 && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
  }
  void acquire();
}

export function releaseWakeLock(owner: string): void {
  if (!owners.delete(owner)) return;
  if (owners.size > 0) return;
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  const held = sentinel;
  sentinel = null;
  if (held !== null) {
    try { void held.release(); } catch { /* already gone */ }
  }
}

// True when this device can hold the screen on, so a screen can say what it actually does rather than promising something
// that will not happen.
export function canKeepScreenAwake(): boolean {
  const lock = api();
  return lock !== null && typeof lock.request === 'function';
}
