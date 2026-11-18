// The waking tap presses nothing underneath (staff slice 5): a port of the swallowing half of tests/kiosk-runtime.test.mjs, then the
// same proof on a real DOM, with a button under the cover and React-style listeners on the document.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { LIFT_WAIT_MS, armWakeTap } from './wakeTap';
import type { WakeWindow } from './wakeTap';

type FakeEvent = { type: string; target: unknown; prevented: boolean; stopped: boolean; preventDefault(): void; stopPropagation(): void };

// A tiny window: listeners run in registration order; stopPropagation ends the walk. The cover registers first, as a capture
// listener on the window runs before anything below it.
function fakeWindow() {
  const listeners: { type: string; fn: (event: Event) => void }[] = [];
  const win: WakeWindow & { fire(type: string, target: unknown): FakeEvent } = {
    addEventListener(type, fn) { listeners.push({ type, fn }); },
    removeEventListener(type, fn) {
      const i = listeners.findIndex(l => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    fire(type, target) {
      const event: FakeEvent = { type, target, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
      for (const l of [...listeners]) {
        if (l.type !== type) continue;
        l.fn(event as unknown as Event);
        if (event.stopped) break;
      }
      return event;
    },
  };
  return win;
}

function setup() {
  const win = fakeWindow();
  const cover = { contains: (n: unknown) => n === cover };
  const fns: (() => void)[] = [];
  const timers = { set: (fn: () => void) => { fns.push(fn); return fns.length; }, clear: () => { fns.length = 0; } };
  const state = { woke: 0, viaKey: null as boolean | null, down: 0, click: 0, keys: 0 };
  armWakeTap(win, cover as unknown as { contains(node: Node | null): boolean }, viaKey => { state.woke++; state.viaKey = viaKey; }, timers);
  win.addEventListener('pointerdown', () => { state.down++; });
  win.addEventListener('click', () => { state.click++; });
  win.addEventListener('keydown', () => { state.keys++; });
  return { win, cover, fns, state };
}

describe('the waking tap (the current app’s cases)', () => {
  test('never reaches what is underneath', () => {
    const { win, cover, state } = setup();
    for (const type of ['pointerdown', 'touchstart', 'pointerup', 'touchend', 'mousedown', 'mouseup']) {
      const e = win.fire(type, cover);
      expect(e.prevented && e.stopped, `${type} swallowed`).toBe(true);
      expect(state.woke, `no wake before the click (${type})`).toBe(0);
    }
    const click = win.fire('click', cover);
    expect(click.prevented && click.stopped).toBe(true);
    expect(state.woke, 'wakes only after the click').toBe(1);
    expect(state.down).toBe(0);
    expect(state.click).toBe(0);
    // Once awake the cover no longer swallows: the next tap belongs to the app.
    win.fire('click', cover);
    expect(state.click).toBe(1);
    expect(state.woke).toBe(1);
  });

  test('without a click it wakes a moment after the finger LIFTS, never during a long press', () => {
    const { win, cover, fns, state } = setup();
    win.fire('touchstart', cover);
    win.fire('pointerdown', cover);
    expect(fns, 'the wait does not start while the finger is down').toHaveLength(0);
    win.fire('touchend', cover);
    expect(fns).toHaveLength(1);
    expect(state.woke).toBe(0);
    fns[0]?.();
    expect(state.woke).toBe(1);
    expect(state.viaKey).toBe(false);
  });

  test('a tap aimed elsewhere is not swallowed', () => {
    const { win, state } = setup();
    const e = win.fire('click', { id: 'something-else' });
    expect(e.prevented).toBe(false);
    expect(state.woke).toBe(0);
    expect(state.click).toBe(1);
  });

  test('a key wakes it and is swallowed — any key, wherever the focus is (Mise 2’s cover is above everything)', () => {
    const { win, state } = setup();
    const e = win.fire('keydown', { id: 'a-dialog-button-under-the-cover' });
    expect(e.prevented && e.stopped).toBe(true);
    expect(state.woke).toBe(1);
    expect(state.viaKey).toBe(true);
    expect(state.keys).toBe(0);
  });

  test('⚠ the DEFAULT timers work when setTimeout refuses a foreign `this` (Illegal invocation)', () => {
    vi.useFakeTimers();
    try {
      const real = globalThis.setTimeout;
      const strict = function (this: unknown, fn: () => void, ms?: number) {
        if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
        return real(fn, ms);
      };
      vi.stubGlobal('setTimeout', strict);
      const win = fakeWindow();
      const cover = { contains: (n: unknown) => n === cover };
      let woke = 0;
      armWakeTap(win, cover as unknown as { contains(node: Node | null): boolean }, () => { woke++; });
      win.fire('touchstart', cover);
      expect(() => win.fire('touchend', cover)).not.toThrow();
      vi.advanceTimersByTime(LIFT_WAIT_MS);
      expect(woke, 'the lift timer woke the cover').toBe(1);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

describe('the waking tap on a real page', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    cleanups.splice(0).forEach(cleanup => { cleanup(); });
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  // The button the baker's finger lands on is UNDER the cover; React's and React Aria's listeners sit on the root and the document.
  function page() {
    const button = document.createElement('button');
    button.textContent = 'Confirm';
    const pressed = vi.fn();
    button.addEventListener('click', pressed);
    const documentHeard = vi.fn();
    const types = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'keydown'];
    types.forEach(type => { document.addEventListener(type, documentHeard, true); });
    const cover = document.createElement('div');
    document.body.append(button, cover);
    const woke = vi.fn();
    const disarm = armWakeTap(window, cover, woke);
    cleanups.push(disarm, () => { types.forEach(type => { document.removeEventListener(type, documentHeard, true); }); });
    return { button, pressed, documentHeard, cover, woke };
  }

  test('a tap on the cover (touch, then the lift) never reaches the page, and wakes it after the lift', () => {
    vi.useFakeTimers();
    const { pressed, documentHeard, cover, woke } = page();
    fireEvent.pointerDown(cover);
    fireEvent.touchStart(cover);
    fireEvent.pointerUp(cover);
    fireEvent.touchEnd(cover);
    expect(woke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LIFT_WAIT_MS);
    expect(woke).toHaveBeenCalledWith(false);
    expect(pressed).not.toHaveBeenCalled();
    expect(documentHeard, 'nothing below the window heard the gesture').not.toHaveBeenCalled();
  });

  test('a mouse click on the cover wakes it at once and presses nothing', () => {
    const { pressed, documentHeard, cover, woke } = page();
    fireEvent.mouseDown(cover);
    fireEvent.mouseUp(cover);
    const click = fireEvent.click(cover);
    expect(click, 'the click is cancelled').toBe(false);
    expect(woke).toHaveBeenCalledTimes(1);
    expect(pressed).not.toHaveBeenCalled();
    expect(documentHeard).not.toHaveBeenCalled();
  });

  test('a key with the focus on the button underneath wakes the cover and never presses it', () => {
    const { button, pressed, documentHeard, woke } = page();
    button.focus();
    const went = fireEvent.keyDown(button, { key: 'Enter' });
    expect(went).toBe(false);
    expect(woke).toHaveBeenCalledWith(true);
    expect(pressed).not.toHaveBeenCalled();
    expect(documentHeard).not.toHaveBeenCalled();
  });

  test('once woken, the next tap belongs to the page', () => {
    const { button, pressed, cover } = page();
    fireEvent.click(cover);
    fireEvent.click(button);
    expect(pressed).toHaveBeenCalledTimes(1);
  });
});
