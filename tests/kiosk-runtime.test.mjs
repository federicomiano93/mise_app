// What can be proved without a browser: the waking tap's swallowing, and the wiring pins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingFromPrecache } from './helpers/precache.mjs';
import { pageScripts } from './helpers/page-scripts.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { armWakeTap } from '../js/kiosk.js';
import { BUSY_SELECTORS } from '../js/update-gate.js';
import { KEEP_PREFIXES, keysToClear } from '../js/local-data.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');

// A tiny window: listeners run in registration order; stopPropagation ends the walk.
// The cover registers first, as a capture listener on the window runs before anything
// below it.
function fakeWindow() {
  const listeners = [];
  return {
    addEventListener(type, fn) { listeners.push({ type, fn }); },
    removeEventListener(type, fn) {
      const i = listeners.findIndex(l => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    fire(type, target) {
      const event = { type, target, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
      for (const l of [...listeners]) {
        if (l.type !== type) continue;
        l.fn(event);
        if (event.stopped) break;
      }
      return event;
    },
  };
}

function setup() {
  const win = fakeWindow();
  const overlay = { contains: n => n === overlay };
  const timers = { fns: [], set(fn) { this.fns.push(fn); return this.fns.length; }, clear() { this.fns = []; } };
  const state = { woke: 0, down: 0, click: 0 };
  armWakeTap(win, overlay, () => { state.woke++; }, timers);
  win.addEventListener('pointerdown', () => { state.down++; });
  win.addEventListener('click', () => { state.click++; });
  return { win, overlay, timers, state };
}

test('the waking tap never reaches what is underneath', () => {
  const { win, overlay, state } = setup();
  for (const type of ['pointerdown', 'touchstart', 'pointerup', 'touchend', 'mousedown', 'mouseup']) {
    const e = win.fire(type, overlay);
    assert.ok(e.prevented && e.stopped, `${type} swallowed`);
    assert.equal(state.woke, 0, `no wake before the click (${type})`);
  }
  const click = win.fire('click', overlay);
  assert.ok(click.prevented && click.stopped);
  assert.equal(state.woke, 1, 'wakes only after the click');
  assert.equal(state.down, 0);
  assert.equal(state.click, 0);
  // Once awake the cover no longer swallows: the next tap belongs to the app.
  win.fire('click', overlay);
  assert.equal(state.click, 1);
  assert.equal(state.woke, 1);
});

test('without a click it wakes a moment after the finger LIFTS, never during a long press', () => {
  const { win, overlay, timers, state } = setup();
  win.fire('touchstart', overlay);
  win.fire('pointerdown', overlay);
  assert.equal(timers.fns.length, 0, 'the wait does not start while the finger is down');
  win.fire('touchend', overlay);
  assert.equal(timers.fns.length, 1);
  assert.equal(state.woke, 0);
  timers.fns[0]();
  assert.equal(state.woke, 1);
});

test('a key aimed at a dialog above the cover passes through untouched', () => {
  const { win, state } = setup();
  const e = win.fire('keydown', { id: 'some-dialog-button' });
  assert.equal(e.prevented, false);
  assert.equal(e.stopped, false);
  assert.equal(state.woke, 0);
});

test('⚠ the DEFAULT timers work when setTimeout refuses a foreign `this` (Illegal invocation)', async () => {
  const realSet = globalThis.setTimeout;
  globalThis.setTimeout = function (fn, ms) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    return realSet(fn, ms);
  };
  try {
    const win = fakeWindow();
    const overlay = { contains: n => n === overlay };
    let woke = 0;
    armWakeTap(win, overlay, () => { woke++; });   // default timers
    win.fire('touchstart', overlay);
    assert.doesNotThrow(() => win.fire('touchend', overlay));
    await new Promise(r => realSet(r, 900));
    assert.equal(woke, 1, 'the lift timer woke the cover');
  } finally {
    globalThis.setTimeout = realSet;
  }
});

test('a tap elsewhere (the update banner) is not swallowed', () => {
  const { win, state } = setup();
  const e = win.fire('click', { id: 'sw-update-banner' });
  assert.equal(e.prevented, false);
  assert.equal(state.woke, 0);
  assert.equal(state.click, 1);
});

test('a key wakes it and is swallowed', () => {
  const { win, overlay, state } = setup();
  const e = win.fire('keydown', overlay);
  assert.ok(e.prevented && e.stopped);
  assert.equal(state.woke, 1);
});

test('the cover is not a busy marker (it would block updates for ever)', () => {
  assert.ok(!BUSY_SELECTORS.some(sel => sel.includes('kiosk')));
});

test('kiosk- survives sign-out', () => {
  assert.ok(KEEP_PREFIXES.includes('kiosk-'));
  const keys = ['kiosk-mode', 'kiosk-last-reload', 'config-calculator', 'firebase:authUser:x'];
  assert.deepEqual(keysToClear(keys), ['config-calculator']);
});

test('every page with the update worker loads kiosk.js, the client page does not', () => {
  const pages = ['calculator', 'catalogue', 'foodcost', 'index', 'inventory', 'orders', 'pastries', 'suppliers'];
  for (const p of pages) {
    const html = read(`${p}.html`);
    assert.ok(pageScripts(html).includes('js/sw-update.js'), p);
    assert.ok(pageScripts(html).includes('js/kiosk.js'), `${p}.html loads kiosk.js`);
  }
  assert.ok(!read('order.html').includes('kiosk.js'));
  assert.ok(!pageScripts(read('order.html')).includes('js/kiosk.js'), 'and its bundle does not run it');
});

test('the new modules are precached', () => {
  assert.deepEqual(missingFromPrecache(['kiosk.js', 'kiosk-model.js', 'wake-lock.js'].map(f => `js/${f}`)), []);
});

test('the cover is wired the way the brief says (source pins)', () => {
  const src = read('js/kiosk.js');
  assert.match(src, /id = 'kiosk-rest'/);
  assert.match(src, /setAttribute\('role', 'button'\)/);
  assert.match(src, /acquireWakeLock\(WAKE_OWNER\)/);
  assert.match(src, /'kiosk-rest-info'/);
  assert.match(src, /'kiosk-settings-changed'/);
  assert.match(src, /KIOSK_RESUME_KEY/);
  assert.match(read('tokens.css'), /z-index: 9500/);
  assert.match(read('tokens.css'), /--kiosk-text:\s*#8c8c8c/i);
});

test('the guided mix keeps its wake lock through the shared module', () => {
  const src = read('js/catalogue/guided-alarm.js');
  assert.match(src, /from '\.\.\/wake-lock\.js'/);
  assert.match(src, /WAKE_OWNER = 'guided-mix'/);
});
