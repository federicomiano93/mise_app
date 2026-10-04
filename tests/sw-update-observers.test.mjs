// The update banner and gate must not leave page-wide observers running.
//
// A tablet is left open for days. js/sw-update.js used to keep a body-wide attribute
// observer (banner placement) and resize listener alive after the banner was gone, and
// announce() could start a second body-wide childList observer while the first was
// still waiting for a quiet screen. Run against a small stand-in for the page: the
// real module, a fake document, and a MutationObserver that counts its own life.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const byId = new Map();
const observers = [];
const resizeListeners = new Set();
let busy = false;

function makeEl(tag) {
  const el = {
    tagName: tag.toUpperCase(), id: '', dataset: {}, style: {}, children: [], isConnected: false,
    textContent: '', disabled: false, hidden: false,
    setAttribute() {}, addEventListener() {}, focus() {}, querySelectorAll: () => [],
    appendChild(child) { this.children.push(child); return child; },
    append(...kids) { kids.forEach((k) => this.appendChild(k)); },
    remove() { this.isConnected = false; if (this.id) byId.delete(this.id); },
  };
  return el;
}

class FakeObserver {
  constructor(callback) { this.callback = callback; this.live = false; observers.push(this); }
  observe(target, options) { this.live = true; this.target = target; this.options = options; }
  disconnect() { this.live = false; }
}

let announce;

before(async () => {
  const body = makeEl('body');
  body.appendChild = (child) => {
    child.isConnected = true;
    if (child.id) byId.set(child.id, child);
    return child;
  };
  globalThis.document = {
    body,
    activeElement: null,
    createElement: makeEl,
    getElementById: (id) => byId.get(id) ?? null,
    querySelector: () => (busy ? {} : null),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  globalThis.window = {
    innerHeight: 800,
    addEventListener: (type, fn) => { if (type === 'resize') resizeListeners.add(fn); },
    removeEventListener: (type, fn) => { if (type === 'resize') resizeListeners.delete(fn); },
  };
  globalThis.MutationObserver = FakeObserver;
  ({ __announce: announce } = await import('../js/sw-update.js'));
});

const liveObservers = () => observers.filter((o) => o.live);
const reg = { waiting: null, addEventListener() {} };

test('announce() while the screen is busy starts ONE observer, however often it is called', () => {
  busy = true;
  announce(reg);
  announce(reg);
  announce(reg);
  const gateWatchers = liveObservers().filter((o) => o.options.childList);
  assert.equal(gateWatchers.length, 1, 'a second gate observer was started');
  assert.ok(document.getElementById('sw-update-host'), 'the banner is up meanwhile');
  assert.equal(liveObservers().filter((o) => o.options.attributes).length, 1, 'one banner tracker');
  assert.equal(resizeListeners.size, 1);
});

test('the driver seam __keepAboveBottomBar leaves the real banner tracker running', async () => {
  const { __keepAboveBottomBar } = await import('../js/sw-update.js');
  const before = liveObservers().filter((o) => o.options.attributes);
  assert.equal(before.length, 1, 'the banner tracker should be up');
  const stop = __keepAboveBottomBar({ style: {}, isConnected: true });
  assert.ok(before[0].live, 'the seam stopped the real banner tracker');
  assert.equal(liveObservers().filter((o) => o.options.attributes).length, 2);
  stop();
  assert.ok(before[0].live, 'stopping the driver tracker stopped the real one');
  assert.equal(liveObservers().filter((o) => o.options.attributes).length, 1);
});

test('once the screen is quiet the gate shows and every observer and listener is let go', () => {
  busy = false;
  const watcher = liveObservers().find((o) => o.options.childList);
  watcher.callback();
  assert.ok(document.getElementById('sw-update-gate'), 'the gate did not show');
  assert.equal(document.getElementById('sw-update-host'), null, 'the banner should be gone');
  assert.equal(liveObservers().length, 0, 'an observer is still running');
  assert.equal(resizeListeners.size, 0, 'a resize listener is still registered');
});
