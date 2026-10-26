// The update gate sits above the kiosk rest cover, so it must wait until the cover is gone.
// Same stand-in page as tests/sw-update-observers.test.mjs.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const byId = new Map();
const observers = [];

function makeEl(tag) {
  return {
    tagName: tag.toUpperCase(), id: '', dataset: {}, style: {}, children: [], isConnected: false,
    textContent: '', disabled: false, hidden: false,
    setAttribute() {}, addEventListener() {}, focus() {}, querySelectorAll: () => [],
    appendChild(child) { this.children.push(child); return child; },
    append(...kids) { kids.forEach((k) => this.appendChild(k)); },
    remove() { this.isConnected = false; if (this.id) byId.delete(this.id); },
  };
}

class FakeObserver {
  constructor(callback) { this.callback = callback; this.live = false; observers.push(this); }
  observe(target, options) { this.live = true; this.options = options; }
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
    body, activeElement: null, createElement: makeEl,
    getElementById: (id) => byId.get(id) ?? null,
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
  };
  globalThis.window = { innerHeight: 800, addEventListener() {}, removeEventListener() {} };
  globalThis.MutationObserver = FakeObserver;
  ({ __announce: announce } = await import('../js/sw-update.js'));
});

test('⚠ with the kiosk rest cover up the gate waits; when the cover goes the gate shows', () => {
  const cover = makeEl('div');
  cover.id = 'kiosk-rest';
  document.body.appendChild(cover);
  announce({ waiting: null, addEventListener() {} });
  assert.equal(document.getElementById('sw-update-gate'), null, 'no white box over the rest screen');
  const watcher = observers.find((o) => o.live && o.options.childList);
  assert.ok(watcher, 'still waiting on the page');
  watcher.callback();
  assert.equal(document.getElementById('sw-update-gate'), null, 'still covered');
  cover.remove();
  watcher.callback();
  assert.ok(document.getElementById('sw-update-gate'), 'the gate appears for the person who woke it');
});
