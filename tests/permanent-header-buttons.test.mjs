// permanent-header-buttons.test.mjs — Federico, 3 Oct 2026: «voglio che i tasti siano
// permanenti, le notifiche arrivano quando ci sono». The round buttons in the Orders green bar
// are always there; only the red number comes and goes. The bell opens a panel that says so
// when it holds nothing. Executes initAlertsPanel on a small fake DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const HTML = read('orders.html');

function openTag(id) {
  const at = HTML.indexOf(`id="${id}"`);
  assert.ok(at > 0, `${id} is in orders.html`);
  const start = HTML.lastIndexOf('<', at);
  return HTML.slice(start, HTML.indexOf('>', at) + 1);
}

// ── The fake DOM ────────────────────────────────────────────────────────────

function makeEl(id) {
  const attrs = {};
  return {
    id, hidden: false, textContent: '', children: [], className: '',
    setAttribute(k, v) { attrs[k] = v; },
    getAttribute(k) { return attrs[k]; },
    addEventListener() {},
    focus() {},
    querySelectorAll() { return this.children.flatMap(c => [c, ...c.querySelectorAll()]); },
  };
}

let observers = [];
function installDom() {
  const els = {
    'orders-alerts-btn': makeEl('orders-alerts-btn'),
    'orders-alerts-panel': makeEl('orders-alerts-panel'),
    'orders-alerts-count': makeEl('orders-alerts-count'),
    'orders-alerts-empty': makeEl('orders-alerts-empty'),
  };
  els['orders-alerts-empty'].className = 'orders-alerts-empty';
  els['orders-alerts-panel'].children = [els['orders-alerts-empty']];
  els['orders-alerts-panel'].hidden = true;
  observers = [];
  globalThis.document = {
    getElementById: id => els[id] || null,
    addEventListener() {},
  };
  globalThis.MutationObserver = class {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {}
  };
  return els;
}

const { initAlertsPanel } = await import('../js/orders/tablet-layout.js');

test('with nothing in the panel the bell stays, the number is hidden and the empty line shows', () => {
  const els = installDom();
  initAlertsPanel();
  assert.equal(els['orders-alerts-btn'].hidden, false, 'the bell is permanent');
  assert.equal(els['orders-alerts-count'].hidden, true);
  assert.equal(els['orders-alerts-count'].textContent, '');
  assert.equal(els['orders-alerts-empty'].hidden, false, 'the empty line shows on its own');
  assert.equal(els['orders-alerts-btn'].getAttribute('aria-label'), 'Notices');
});

test('the empty line is not counted as a notice, and goes away when a notice arrives', () => {
  const els = installDom();
  initAlertsPanel();
  const banner = makeEl('b');
  banner.className = 'alert-banner';
  els['orders-alerts-panel'].children.push(banner);
  observers[0].cb();
  assert.equal(els['orders-alerts-count'].textContent, '1', 'only the banner counts');
  assert.equal(els['orders-alerts-count'].hidden, false);
  assert.equal(els['orders-alerts-empty'].hidden, true);
  assert.equal(els['orders-alerts-btn'].hidden, false);

  els['orders-alerts-panel'].children.pop();
  observers[0].cb();
  assert.equal(els['orders-alerts-count'].hidden, true);
  assert.equal(els['orders-alerts-empty'].hidden, false, 'back to the empty line');
  assert.equal(els['orders-alerts-btn'].hidden, false, 'the bell never hides');
});

test('the pill alone counts as content: no empty line, no number', () => {
  const els = installDom();
  initAlertsPanel();
  const pill = makeEl('p');
  pill.className = 'alert-pill';
  els['orders-alerts-panel'].children.push(pill);
  observers[0].cb();
  assert.equal(els['orders-alerts-empty'].hidden, true);
  assert.equal(els['orders-alerts-count'].hidden, true);
});

test('an open panel is not closed when it empties', () => {
  const els = installDom();
  initAlertsPanel();
  els['orders-alerts-panel'].hidden = false;
  observers[0].cb();
  assert.equal(els['orders-alerts-panel'].hidden, false);
});

test('the empty line is only written when its state changes (the observer watches `hidden`)', () => {
  const src = read('js/orders/tablet-layout.js');
  assert.match(src, /emptyEl\.hidden !== hasContent\)\s*emptyEl\.hidden = hasContent/);
  assert.doesNotMatch(src, /btn\.hidden\s*=/, 'the bell is never hidden by code');
});

test('the markup carries no `hidden` on the reorder button or the bell', () => {
  for (const id of ['orders-reorder-btn', 'orders-alerts-btn']) {
    assert.doesNotMatch(openTag(id), /\shidden(\s|>|=)/, `${id} is permanent`);
  }
  assert.match(openTag('orders-lists-btn'), /\shidden/, 'order lists stay hidden where the venue switched them off');
  assert.match(openTag('orders-alerts-empty'), /data-i18n="orders\.alerts\.empty"/);
  // ⚠️ Never a <p>: the panel is inside <header>, where style.css «header p» draws tiny uppercase
  // (caught by driving the app, 3 Oct 2026).
  assert.doesNotMatch(openTag('orders-alerts-empty'), /^<p\b/);
  const panel = HTML.slice(HTML.indexOf('id="orders-alerts-panel"'));
  assert.ok(panel.indexOf('id="orders-alerts-empty"') > 0 && panel.indexOf('id="orders-alerts-empty"') < panel.indexOf('</header>'),
    'the empty line lives inside the panel');
});

test('the reorder renderer never hides the button', () => {
  const src = read('js/orders/deliveries-view.js');
  assert.doesNotMatch(src, /btn\.hidden\s*=\s*!/);
  assert.match(src, /btn\.hidden = false/);
});

test('the new keys exist in English and Italian', () => {
  const src = read('js/i18n.js');
  for (const [key, en, it] of [
    ['orders.alerts.empty', 'No notices right now.', 'Nessun avviso al momento.'],
    ['orders.reorder.buttonAriaNone', 'Still to re-order', 'Da riordinare'],
  ]) {
    assert.ok(src.includes(`'${key}': '${en}'`), `${key} in English`);
    assert.ok(src.includes(`'${key}': '${it}'`), `${key} in Italian`);
  }
});

test('the empty line is styled with tokens only', () => {
  const css = read('orders.css');
  const rule = css.match(/\.orders-alerts-empty\s*\{[^}]*\}/)[0];
  assert.match(rule, /color:\s*var\(--text-3\)/);
  assert.doesNotMatch(rule, /#[0-9a-f]{3,6}\b/i);
});
