// wakeTap.ts — the tap that wakes the rest screen, and presses NOTHING underneath (a port of `armWakeTap` in js/kiosk.js).
//
// ⚠️ THE TAP THAT WAKES THE SCREEN MUST NOT PRESS WHAT IS UNDER IT. Every event of the gesture that lands on the cover is stopped at
// the WINDOW, in the capture phase, before anything below can see it (React's own listeners sit on the root and on the portal's
// container, React Aria's on the document: all of them later than the window's capture). And the cover is removed only after the
// finger has LIFTED — a `click` ends it at once, otherwise LIFT_WAIT_MS later — so a ghost click cannot fall through onto the button
// beneath, and a long press stays swallowed until it ends. On Android, preventDefault() on touchstart suppresses the click, so the
// lift timer is the normal wake path on the tablet, and the click is the path for a mouse.
//
// A key wakes it too, and the key is swallowed. ⚠️ ANY key, wherever the focus is: unlike the current app's cover, Mise 2's sits
// above every layer of the page, dialogs included (RestScreen.module.css), so a key can never be meant for something the person can
// see. (The current app let a key aimed at a dialog drawn above its cover pass.)
//
// onWake(viaKey) tells the caller how it was woken.
//
// ⚠️ The default timers are arrow functions on purpose: handing the native setTimeout over as a method of an object calls it with
// the wrong `this` («Illegal invocation»), and then the tablet's cover would never wake on touch.

export const LIFT_WAIT_MS = 700;

const SWALLOWED = ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup',
  'touchstart', 'touchend', 'touchcancel', 'click'] as const;
const LIFTED: readonly string[] = ['pointerup', 'pointercancel', 'mouseup', 'touchend', 'touchcancel'];

export interface WakeTimers {
  set(callback: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

// The part of a window this needs (a spec hands in a small fake).
export interface WakeWindow {
  addEventListener(type: string, listener: (event: Event) => void, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: (event: Event) => void, options?: boolean | EventListenerOptions): void;
}

export function armWakeTap(
  win: WakeWindow,
  cover: { contains(node: Node | null): boolean },
  onWake: (viaKey: boolean) => void,
  timers: WakeTimers = { set: (callback, ms) => setTimeout(callback, ms), clear: id => { clearTimeout(id as ReturnType<typeof setTimeout>); } },
): () => void {
  let timer: unknown = null;
  let done = false;

  function finish(viaKey: boolean): void {
    if (done) return;
    done = true;
    if (timer !== null) timers.clear(timer);
    disarm();
    onWake(viaKey);
  }
  function onPointerish(event: Event): void {
    if (!cover.contains(event.target as Node | null)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'click') { finish(false); return; }
    if (LIFTED.includes(event.type) && timer === null) timer = timers.set(() => { finish(false); }, LIFT_WAIT_MS);
  }
  function onKey(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    finish(true);
  }
  function onWheel(): void { finish(false); }

  function disarm(): void {
    SWALLOWED.forEach(type => { win.removeEventListener(type, onPointerish, true); });
    win.removeEventListener('keydown', onKey, true);
    win.removeEventListener('wheel', onWheel, true);
  }

  SWALLOWED.forEach(type => { win.addEventListener(type, onPointerish, { capture: true, passive: false }); });
  win.addEventListener('keydown', onKey, true);
  win.addEventListener('wheel', onWheel, { capture: true, passive: true });
  return disarm;
}
