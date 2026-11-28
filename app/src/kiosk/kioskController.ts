// kioskController.ts — «kiosk mode» for a lab tablet that stays open all day: the runtime of js/kiosk.js, decision for decision,
// without the drawing (RestScreen.tsx draws the cover, Kiosk.tsx wires this to the session and the setting). The rules themselves
// are @mise/shared/kiosk-model, run against the current app's own file. Plain TypeScript behind an injected environment, so every
// step is a spec with fake timers (kioskController.spec.ts).
//
// OFF BY DEFAULT: with the setting off this does nothing. The setting belongs to the DEVICE (kioskSettings.ts), never to a venue or
// a person, and nothing here writes to Firestore.
//
// After a few minutes without a touch a black rest screen covers the app; after a longer while the screen lock is let go so
// Android can switch the backlight off ('night'). One tap wakes it WITHOUT reaching what is underneath (wakeTap.ts).
//
// ⚠️⚠️ NOTHING RELOADS THE PAGE WHILE THE REST COVER IS UP (#406, commit 91b7f848). In 'rest' the screen is kept on by the Wake
// Lock alone, and Android's own screen timeout counts from the last TOUCH: a reload drops the lock for a few seconds, Android sees a
// timeout long expired and switches the screen off at once — the lock screen, although the setting says «never switch off». Mise 2
// reloads by itself in two places, the service worker letting a new release in (shell/serviceWorker.ts) and the session's
// 30-second copy check (session/session.ts), and both wait while somebody holds the busy marker (session/busy.ts). So:
//   - the cover HOLDS markBusy() for as long as it is up, in 'rest' and in 'night';
//   - an update and the daily safety reload happen ONLY at the rest→night tick, the screen going off anyway (shouldAutoUpdate,
//     shouldDailyReload); the page comes back dark (`kiosk-resume` = 'night' in sessionStorage);
//   - with «Never» (nightHours 0) the daily reload is done by the waking tap after 60 minutes of rest (shouldReloadOnWake): that
//     touch keeps Android's screen on through the reload;
//   - never in 'rest', never later in 'night'.
// ⚠️ THE UPDATE AT THE NIGHT STEP GOES THROUGH THE SHELL'S ONE UPDATE PATH, NOT A SECOND ONE. When a release is waiting, this lets go
// of its own hold (after writing the night resume): the service worker's watcher, which asks isBusy() every 2 seconds while a worker
// waits, then lets the worker in and reloads, exactly as on every other device. If anybody else is busy, nothing happens: the
// watcher keeps waiting. If the reload has not come RELOAD_STALL_MS later (the shell's brake on repeated reloads), the hold is taken
// again and the resume dropped (the daily reload has the same failsafe): the update then waits for the waking tap, which lets it in
// under the cover with «One moment, reloading Mise…», as the «Never» reload does.
//
// ⚠️ AND NOT EITHER WHILE THE TABLET IS IN USE BUT UNTOUCHED (Mise 2 only; staff slice 5's choice). The current app never reloaded a
// kiosk tablet by itself in 'active': its update needed a tap on «Update now», and a tap restarts Android's timeout. Mise 2 lets an
// update in by itself, so on a kiosk tablet whose screen is held on, the busy marker is also held once nobody has touched it for
// ACTIVE_HOLD_AFTER_MS: an update (or the copy check) then lands only within half a minute of a touch, well inside Android's
// timeout of 1–2 minutes that the setting's note asks for.
//
// The lock is asked for again on every tick (refreshWakeLock), since a lost one is otherwise never requested twice.

import {
  KIOSK_LAST_RELOAD_KEY, KIOSK_RESUME_KEY, DEFAULT_KIOSK_SETTINGS, REST_NOW_GUARD_MS,
  nextKioskState, shouldAutoUpdate, shouldDailyReload, shouldReloadOnWake, shouldRestNow,
} from '@mise/shared/kiosk-model';
import type { KioskSettings, KioskState } from '@mise/shared/kiosk-model';
import type { SessionStatus } from '../session/session';

export const TICK_MS = 15 * 1000;
export const RELOAD_STALL_MS = 15 * 1000;
export const ACTIVE_HOLD_AFTER_MS = 30 * 1000;
export const WAKE_OWNER = 'kiosk';
const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
const NON_TEXT_INPUTS = ['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'range', 'color'];
// An open dialog, alert or popover (React Aria's Popover carries data-trigger): the tablet does not rest over it — React Aria
// would hide the cover from screen readers and keep the focus in the dialog (the current app's `.app-dialog-backdrop` busy selector).
const OVERLAY = '[role="dialog"], [role="alertdialog"], [data-trigger]';

export interface KioskStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface KioskEnv {
  now(): number;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  local(): KioskStorage | null;
  session(): KioskStorage | null;
  readonly document: Document;
  reload(): void;
  // A new release waits to take over this page (a waiting worker, and the page already served by one).
  updateWaiting(): Promise<boolean>;
  acquireWakeLock(owner: string): void;
  releaseWakeLock(owner: string): void;
  refreshWakeLock(): void;
  markBusy(): () => void;
  isBusyApartFrom(mine: (() => void) | null): boolean;
}

export interface KioskSessionView {
  readonly status: SessionStatus;
  // A person is signed in with a venue open and on screen (not the join form, not leaving).
  readonly signedIn: boolean;
}

export interface KioskSnapshot {
  readonly state: KioskState;
  // The waking tap is reloading the page (nightHours 0, after a long rest): the cover says so.
  readonly reloading: boolean;
  // When the cover was last painted: the clock it shows. Moves on every tick while the cover is up.
  readonly paintedAt: number;
  // Not before this moment may the waking tap be armed: the cover raised by the Home's «Standby» must not be woken by the very tap
  // (or the repeat of the key) that raised it (REST_NOW_GUARD_MS, wakeArmDelay). 0 for a cover raised by idleness.
  readonly armAt: number;
}

export interface KioskController {
  applySettings(settings: KioskSettings): void;
  setSession(session: KioskSessionView): void;
  // The waking tap (or key) on the cover; wakeTap.ts has already swallowed it.
  wakeTap(viaKey: boolean): void;
  // The Home's «Standby» (staff slice 6): cover the screen at once, on a kiosk device, signed in, not already resting.
  restNow(): void;
  stop(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): KioskSnapshot;
}

function safeGet(storage: KioskStorage | null, key: string): string | null {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}
function safeSet(storage: KioskStorage | null, key: string, value: string): void {
  try { storage?.setItem(key, value); } catch { /* storage blocked */ }
}
function safeRemove(storage: KioskStorage | null, key: string): void {
  try { storage?.removeItem(key); } catch { /* storage blocked */ }
}

export function createKioskController(env: KioskEnv): KioskController {
  const doc = env.document;
  let settings: KioskSettings = DEFAULT_KIOSK_SETTINGS;
  let started = false;
  let state: KioskState = 'active';
  let lastInputAt = 0;
  let restSince = 0;
  let session: KioskSessionView = { status: 'loading', signedIn: false };
  let lockHeld = false;
  let hold: (() => void) | null = null;
  let updating = false;
  let reloadingOnWake = false;
  let tickTimer: unknown = null;
  let idleTimer: unknown = null;
  let stallTimer: unknown = null;
  let focusBeforeRest: Element | null = null;
  // The text field that last had the focus: «Standby» is a button, so tapping it moves the focus off the field before the cover remembers it.
  let lastField: Element | null = null;
  // A release is waiting to take over (asked on every tick while the cover is up): the waking tap then lets it in under the cover.
  let updateKnown = false;
  let wakeGuardUntil = 0;
  let snapshot: KioskSnapshot = Object.freeze({ state: 'active', reloading: false, paintedAt: 0, armAt: 0 });
  const listeners = new Set<() => void>();

  // A reload this kiosk started itself (an update or the daily reload at the night step) comes back in the state it left, so the
  // screen is not lit up in the middle of the night. Read ONCE, as the page starts, and dropped from the storage at once.
  // Kept until the first tick or the first wake, so a start, stop and start again (React's StrictMode replays effects) still resumes.
  let pendingResume = safeGet(env.session(), KIOSK_RESUME_KEY);
  safeRemove(env.session(), KIOSK_RESUME_KEY);

  function emit(): void {
    snapshot = Object.freeze({ state, reloading: reloadingOnWake, paintedAt: env.now(), armAt: wakeGuardUntil });
    for (const listener of [...listeners]) listener();
  }

  function isField(element: Element | null): boolean {
    if (element === null || element === doc.body) return false;
    const tag = element.tagName;
    if (tag === 'INPUT') return !NON_TEXT_INPUTS.includes(String((element as HTMLInputElement).type || '').toLowerCase());
    return tag === 'TEXTAREA' || tag === 'SELECT' || (element as HTMLElement).isContentEditable === true;
  }

  // ⚠️ While the cover is up the focus is ON the cover, so «is a field focused» alone would always be false: the field that had the
  // focus when the screen went to rest still counts, for as long as it is on the page — it holds back the reloads (never the rest).
  function typingNow(): boolean {
    if (isField(doc.activeElement)) return true;
    return state !== 'active' && focusBeforeRest !== null && focusBeforeRest.isConnected && isField(focusBeforeRest);
  }

  // Somebody else is in the middle of something: an editor holding the busy marker, or a dialog open.
  function othersBusy(): boolean {
    return env.isBusyApartFrom(hold) || doc.querySelector(OVERLAY) !== null;
  }

  // The screen is held on only for a signed-in tablet: a signed-out one would show a bright sign-in form all night. While the
  // session is still loading (a fresh page) it is held.
  function lockWanted(): boolean {
    if (state === 'night') return false;
    return session.status === 'loading' || session.signedIn;
  }

  function syncLock(wanted: boolean): void {
    if (wanted && !lockHeld) { lockHeld = true; env.acquireWakeLock(WAKE_OWNER); }
    else if (!wanted && lockHeld) { lockHeld = false; env.releaseWakeLock(WAKE_OWNER); }
  }

  // The busy marker: held while the cover is up, and in 'active' once the held-on screen has gone untouched for a while — let go
  // only for the update at the night step (`updating`).
  function syncHold(): void {
    const idle = env.now() - lastInputAt >= ACTIVE_HOLD_AFTER_MS;
    const wanted = started && !updating && (state !== 'active' || (lockHeld && idle));
    if (wanted && hold === null) hold = env.markBusy();
    else if (!wanted && hold !== null) { hold(); hold = null; }
  }

  function noteInput(): void {
    lastInputAt = env.now();
    if (idleTimer !== null) env.clearTimeout(idleTimer);
    idleTimer = started ? env.setTimeout(() => { idleTimer = null; syncHold(); }, ACTIVE_HOLD_AFTER_MS) : null;
    syncHold();
  }

  function rememberFocus(): void {
    const active = doc.activeElement;
    // ⚠️ «Standby» (a button on every section) takes the focus when tapped: the typing the person left behind must still hold back the
    // night reload, so a field that had the focus just before counts when the focus now sits on a button.
    const fieldBefore = lastField !== null && lastField.isConnected && isField(lastField) ? lastField : null;
    if (active !== null && active !== doc.body && !isField(active) && fieldBefore !== null) focusBeforeRest = fieldBefore;
    else focusBeforeRest = active !== null && active !== doc.body ? active : null;
  }

  function onFocusIn(event: Event): void {
    if (event.target instanceof Element && isField(event.target)) lastField = event.target;
  }

  function enter(next: KioskState): void {
    if (next === state) return;
    if (next === 'rest') restSince = env.now();
    if (state === 'active') rememberFocus();
    state = next;
    syncHold();
    emit();
  }

  function wake(viaKey: boolean): void {
    const back = focusBeforeRest;
    focusBeforeRest = null;
    pendingResume = null;
    wakeGuardUntil = 0;
    lastInputAt = env.now();
    // A reload already on its way must not bring the cover back to a person who is here.
    if (updating) safeRemove(env.session(), KIOSK_RESUME_KEY);
    enter('active');
    syncLock(lockWanted());
    noteInput();
    // Focus goes back where it was. After a TOUCH not into a text field: refocusing a quantity box would pop the keyboard up.
    if (back !== null && back.isConnected && (viaKey || !isField(back))) {
      try { (back as HTMLElement).focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  }

  // The waking tap. With nightHours 0, after a long rest, this tap does the day's reload: the cover stays up with one line, and the
  // page comes back 'active' (no resume key). The tap is already disarmed; `updating` keeps every later tick from starting anything.
  // ⚠️ Mise 2 only: a release that waited while the cover was up is let in by this tap the same way — the cover stays up saying
  // «reloading», the hold is let go and the shell's own update path reloads. Without it the update would land a second after the
  // cover lifted, under the baker's next tap (code review). The touch keeps Android's screen on through the reload.
  function wakeTap(viaKey: boolean): void {
    if (!updating && started && state !== 'active') {
      const busy = othersBusy() || typingNow();
      const verdict = shouldReloadOnWake({
        state, restSince, now: env.now(), busy, signedIn: session.signedIn,
        nightHours: settings.nightHours, lastReloadDay: safeGet(env.local(), KIOSK_LAST_RELOAD_KEY),
      });
      const viaUpdate = !verdict.reload && updateKnown && !busy && session.signedIn;
      if (verdict.reload || viaUpdate) {
        updating = true;
        reloadingOnWake = true;
        safeSet(env.local(), KIOSK_LAST_RELOAD_KEY, verdict.day);
        safeRemove(env.session(), KIOSK_RESUME_KEY);
        emit();
        if (viaUpdate) syncHold();
        else env.reload();
        // Failsafe: a reload that stalls must not leave the cover on screen for good — if this page is still here, give the app back.
        if (stallTimer !== null) env.clearTimeout(stallTimer);
        stallTimer = env.setTimeout(() => {
          stallTimer = null;
          if (!updating || !reloadingOnWake) return;
          updating = false;
          reloadingOnWake = false;
          wake(viaKey);
        }, RELOAD_STALL_MS);
        return;
      }
    }
    wake(viaKey);
  }

  // A reload this kiosk asked for at the night step that has not come RELOAD_STALL_MS later: hold again and forget the resume, so
  // the cover is never left without the busy marker (`updating` lets it go).
  function armNightStall(): void {
    if (stallTimer !== null) env.clearTimeout(stallTimer);
    stallTimer = env.setTimeout(() => {
      stallTimer = null;
      if (!updating || reloadingOnWake) return;
      updating = false;
      safeRemove(env.session(), KIOSK_RESUME_KEY);
      syncHold();
    }, RELOAD_STALL_MS);
  }

  // The update at the night step: write the night resume, then let go of the hold so the shell's own update path lets the waiting
  // worker in (see the header). If the page is still here after RELOAD_STALL_MS, hold again and forget the resume.
  function letUpdateIn(day: string): void {
    updating = true;
    safeSet(env.local(), KIOSK_LAST_RELOAD_KEY, day);
    safeSet(env.session(), KIOSK_RESUME_KEY, 'night');
    syncHold();
    armNightStall();
  }

  async function maybeReload(prev: KioskState, busy: boolean, signedIn: boolean): Promise<void> {
    if (updating) return;
    const daily = shouldDailyReload({
      prevState: prev, state, now: env.now(), busy, signedIn,
      visible: doc.visibilityState === 'visible',
      lastReloadDay: safeGet(env.local(), KIOSK_LAST_RELOAD_KEY),
    });
    // ⚠️ Both reloads happen ONLY at the night-entry tick (rest → night); see shouldAutoUpdate.
    if (!(prev === 'rest' && state === 'night')) return;
    // A waiting update is applied INSTEAD of the plain daily reload: it reloads anyway, so it also counts as the day's reload and
    // the page comes back dark.
    if (!busy) {
      let waiting = false;
      try { waiting = await env.updateWaiting(); } catch { waiting = false; }
      // The world may have moved while we asked (somebody woke it): re-check the current state.
      if (updating || !started) return;
      const stillBusy = othersBusy() || typingNow();
      if (shouldAutoUpdate({ prevState: 'rest', state, busy: stillBusy, updateWaiting: waiting })) {
        letUpdateIn(daily.day);
        return;
      }
      if (state !== 'night') return;
    }
    if (daily.reload) {
      updating = true;
      safeSet(env.local(), KIOSK_LAST_RELOAD_KEY, daily.day);
      if (daily.resume !== null) safeSet(env.session(), KIOSK_RESUME_KEY, daily.resume);
      env.reload();
      armNightStall();
    }
  }

  function tick(): void {
    if (!started) return;
    pendingResume = null;
    const signedIn = session.signedIn;
    // The sign-in, no-access and picker screens: a cover left up would be a black screen in front of them. (While the session is
    // still 'loading' — a page resumed after a reload — the cover is kept.)
    if (state !== 'active' && session.status !== 'loading' && !signedIn) { wake(false); return; }
    const busy = othersBusy();
    const prev = state;
    // A focused field does NOT keep the screen on: the cover takes focus, the typed value is already saved (rest needs minutes of
    // silence). It only holds back the reloads.
    const result = nextKioskState({ state, now: env.now(), lastInputAt, restSince, busy, signedIn, settings });
    enter(result.state);
    // The model says no lock for a signed-out tablet; a page still loading its session (a resumed one) keeps it until the answer.
    syncLock(result.wakeLock || (session.status === 'loading' && result.state !== 'night'));
    if (lockHeld) env.refreshWakeLock();
    syncHold();
    if (state !== 'active') {
      emit();
      void maybeReload(prev, busy || typingNow(), signedIn);
      env.updateWaiting().then(waiting => { updateKnown = waiting; }, () => { updateKnown = false; });
    } else {
      updateKnown = false;
    }
  }

  function onInput(): void {
    // While resting the cover handles the wake (its listeners stop the event before this one); here we only note the touch.
    if (state === 'active') noteInput();
  }

  function onVisible(): void {
    if (doc.visibilityState !== 'visible') return;
    // Coming back from another app is not idleness: the clock starts again.
    if (state === 'active') noteInput();
    else lastInputAt = env.now();
    tick();
  }

  function start(resume: string | null): void {
    if (started) return;
    started = true;
    INPUT_EVENTS.forEach(type => { doc.addEventListener(type, onInput, { capture: true, passive: true }); });
    doc.addEventListener('visibilitychange', onVisible);
    doc.addEventListener('focusin', onFocusIn, true);
    tickTimer = env.setInterval(tick, TICK_MS);
    if (resume === 'rest' || resume === 'night') {
      // Resuming 'rest' only serves pages reloaded by an older release of the current app: nothing here reloads under the cover.
      restSince = env.now();
      rememberFocus();
      state = resume;
      emit();
    }
    syncLock(lockWanted());
    noteInput();
  }

  function stop(): void {
    if (!started) return;
    started = false;
    INPUT_EVENTS.forEach(type => { doc.removeEventListener(type, onInput, true); });
    doc.removeEventListener('visibilitychange', onVisible);
    doc.removeEventListener('focusin', onFocusIn, true);
    lastField = null;
    if (tickTimer !== null) { env.clearInterval(tickTimer); tickTimer = null; }
    if (idleTimer !== null) { env.clearTimeout(idleTimer); idleTimer = null; }
    if (stallTimer !== null) { env.clearTimeout(stallTimer); stallTimer = null; }
    if (updating) safeRemove(env.session(), KIOSK_RESUME_KEY);
    updating = false;
    reloadingOnWake = false;
    focusBeforeRest = null;
    const wasCovered = state !== 'active';
    state = 'active';
    syncLock(false);
    syncHold();
    if (wasCovered) emit();
  }

  return {
    applySettings(next) {
      settings = next;
      if (next.enabled) start(pendingResume);
      else { pendingResume = null; stop(); }
    },
    setSession(next) {
      session = next;
      if (state !== 'active' && next.status !== 'loading' && next.status !== 'ready') wake(false);
      if (started && next.status !== 'loading') syncLock(lockWanted());
      syncHold();
    },
    wakeTap,
    restNow() {
      if (!shouldRestNow({ enabled: settings.enabled, signedIn: started && session.signedIn, state })) return;
      wakeGuardUntil = env.now() + REST_NOW_GUARD_MS;
      enter('rest');
      syncLock(lockWanted());
    },
    stop,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
  };
}
