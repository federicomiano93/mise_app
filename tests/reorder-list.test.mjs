// reorder-list.test.mjs — the «To re-order» list opened from the banner on the Order tab.
//
// One card per missing line; each says where it was missed and offers two answers: put it
// back in THAT supplier's order, or «Resolved» (bought elsewhere). Driven on a small fake
// DOM, because what matters is which write each button makes — and that a failed write, or
// a «no» to the question, changes nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ── A DOM just complete enough for dom.js, the dialog and the overlay ────────

class ClassList {
  constructor() { this.set = new Set(); }
  add(...names) { names.forEach(n => n && this.set.add(n)); }
  contains(name) { return this.set.has(name); }
}

class Node {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parent = null;
    this.attributes = {};
    this.listeners = {};
    this.dataset = {};
    this.style = {};
    this.classList = new ClassList();
    this._text = null;
  }

  get className() { return [...this.classList.set].join(' '); }
  set className(value) {
    this.classList = new ClassList();
    this.classList.add(...String(value).split(/\s+/));
  }

  set textContent(value) {
    this.children.forEach(c => { c.parent = null; });
    this.children = [];
    this._text = value === '' ? null : String(value);
  }

  get textContent() {
    if (this._text !== null) return this._text;
    return this.children.map(c => c.textContent).join('');
  }

  set innerHTML(value) { this._html = value; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this);
    this.parent = null;
  }
  focus() {}
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  async click() { for (const fn of this.listeners.click || []) await fn({ target: this }); }
}

class Text extends Node {
  constructor(text) { super('#text'); this._text = String(text); }
}

const body = new Node('body');
globalThis.document = {
  body,
  createElement: tag => new Node(tag),
  createTextNode: text => new Text(text),
  addEventListener() {},
  removeEventListener() {},
  activeElement: null,
};

const { renderReorderBanner } = await import('../js/orders/deliveries-view.js');
const { _dictionaries } = await import('../js/i18n.js');

function walk(node, out = []) {
  out.push(node);
  node.children.forEach(child => walk(child, out));
  return out;
}
const withClass = (name, root = body) => walk(root).filter(n => n.classList.contains(name));
const overlay = () => withClass('reorder-overlay')[0];
const cards = () => withClass('reorder-card');
const dialogButton = kind => withClass(kind)[0];
const tick = () => new Promise(resolve => setImmediate(resolve));

// ── Fixtures: one flour missed on 29 Sep from Aldo, one yeast from nobody known ──────────

function makeCtx(over = {}) {
  const calls = { reorder: [], resolve: [] };
  const ctx = {
    history: [
      { id: '2026-09-29_aldo', date: '2026-09-29', supplierId: 'aldo',
        quantities: { flour: 5 }, units: {}, deliveredAt: '2026-09-30T08:00:00Z', missing: { flour: true } },
      { id: '2026-09-28_ghost', date: '2026-09-28', supplierId: 'ghost',
        quantities: { yeast: 2 }, units: {}, deliveredAt: '2026-09-30T08:00:00Z', missing: { yeast: true } },
    ],
    entries: {},
    suppliersById: { aldo: { id: 'aldo', name: 'Aldo Legacy Foods Ltd', shortName: 'Aldo' } },
    ingredientsById: { flour: { id: 'flour', name: 'Flour' }, yeast: { id: 'yeast', name: 'Yeast' } },
    today: '2026-10-01',
    onReorder: async applied => { calls.reorder.push(applied); },
    onResolve: async item => { calls.resolve.push(item); },
    ...over,
  };
  return { ctx, calls };
}

function openList(ctx) {
  const host = new Node('div');
  renderReorderBanner(host, ctx);
  withClass('reorder-banner', host)[0].listeners.click[0]();
  return host;
}

function closeList() {
  withClass('app-icon-btn', overlay())[0].listeners.click[0]();
}

test('the banner opens the list: one card per line, each with both buttons named for its ingredient', () => {
  const { ctx } = makeCtx();
  openList(ctx);
  try {
    assert.equal(cards().length, 2);
    const [first] = cards();
    const buttons = walk(first).filter(n => n.tagName === 'BUTTON');
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].getAttribute('aria-label'), 'Put back in Aldo’s order — Flour');
    assert.equal(buttons[1].getAttribute('aria-label'), 'Resolved — Flour');
    assert.match(first.textContent, /from Aldo · did not arrive/);
    // A supplier nobody can name is said so, never left blank.
    assert.match(cards()[1].textContent, /from [^·]+ · did not arrive/);
    assert.doesNotMatch(cards()[1].textContent, /from  ·/);
  } finally { closeList(); }
  assert.equal(overlay(), undefined, 'Back closes it');
});

test('«put back» applies exactly that line and calls onReorder once', async () => {
  const { ctx, calls } = makeCtx();
  openList(ctx);
  try {
    await withClass('reorder-put', cards()[0])[0].click();
    assert.equal(calls.reorder.length, 1);
    assert.deepEqual(calls.reorder[0], [{ id: 'flour', qty: 5 }]);
  } finally { closeList(); }
});

test('«put back» on a line that already has a quantity is said, and writes nothing', async () => {
  const { ctx, calls } = makeCtx();
  openList(ctx);
  try {
    // Somebody typed a quantity (maybe on another phone) after the card was drawn.
    ctx.entries.flour = { qty: 3 };
    const pending = withClass('reorder-put', cards()[0])[0].click();
    await tick();
    assert.equal(calls.reorder.length, 0);
    assert.match(dialogButton('app-dialog-backdrop').textContent, /already had a quantity/);
    await dialogButton('app-dialog-btn-solid').click();
    await pending;
  } finally { closeList(); }
});

test('«Resolved» asks first; «Cancel» writes nothing, «Resolved» writes recordId + id', async () => {
  const { ctx, calls } = makeCtx();
  openList(ctx);
  try {
    const press = withClass('reorder-resolve', cards()[0])[0];

    const pending = press.click();
    await tick();
    assert.equal(calls.resolve.length, 0, 'nothing is written before the answer');
    assert.match(withClass('app-dialog-title')[0].textContent, /Mark as resolved\?/);
    assert.match(withClass('app-dialog-msg')[0].textContent, /^Flour leaves this list/);
    assert.equal(withClass('app-dialog-btn-danger').length, 0, 'not a danger dialog');
    await dialogButton('app-dialog-btn-ghost').click();
    await pending;
    assert.equal(calls.resolve.length, 0);

    const again = press.click();
    await tick();
    await dialogButton('app-dialog-btn-solid').click();
    await again;
    assert.equal(calls.resolve.length, 1);
    assert.equal(calls.resolve[0].id, 'flour');
    assert.equal(calls.resolve[0].recordId, '2026-09-29_aldo');
  } finally { closeList(); }
});

test('a failed «Resolved» keeps the row and says so', async () => {
  const { ctx } = makeCtx({ onResolve: async () => { throw new Error('offline'); } });
  openList(ctx);
  try {
    const pending = withClass('reorder-resolve', cards()[0])[0].click();
    await tick();
    await dialogButton('app-dialog-btn-solid').click();
    await tick();
    assert.match(dialogButton('app-dialog-backdrop').textContent, /Not saved/);
    await dialogButton('app-dialog-btn-solid').click();
    await pending;
    assert.equal(cards().length, 2, 'the list is unchanged');
  } finally { closeList(); }
});

test('the open list is redrawn by the next render, and an empty one stays open with a sentence', () => {
  const { ctx } = makeCtx();
  const host = openList(ctx);
  try {
    assert.equal(cards().length, 2);
    const next = { ...ctx, history: [ctx.history[1]] };
    renderReorderBanner(host, next);
    assert.equal(cards().length, 1);

    renderReorderBanner(host, { ...ctx, history: [] });
    assert.equal(cards().length, 0);
    assert.ok(overlay(), 'the screen is not pulled away under the thumb');
    assert.equal(withClass('ing-empty', overlay())[0].textContent, 'Nothing to re-order.');
    assert.equal(host.hidden, true, 'the banner itself goes, as before');
  } finally { closeList(); }
});

test('every new string exists in English and Italian, and the screen is wired to the write', () => {
  const dict = _dictionaries();
  for (const key of ['screenTitle', 'empty', 'rowMeta', 'putBackIn', 'putBackInAria', 'resolved',
    'resolvedAria', 'resolveTitle', 'resolveMessage']) {
    for (const lang of ['en', 'it']) {
      assert.ok(dict[lang][`orders.reorder.${key}`], `${lang} is missing orders.reorder.${key}`);
    }
  }
  const main = readFileSync(new URL('../js/orders/orders-main.js', import.meta.url), 'utf8');
  assert.match(main, /onResolve: async \(item\) => \{ await resolveMissing\(item\.recordId, item\.id\); \}/);
});

// Found driving it (1 Oct 2026): the ingredient list can arrive after the order history,
// and a card drawn in between said «Ingrediente eliminato». The order's frozen names are the
// fallback, and the banner opens the list with the freshest ctx it was drawn with.
test('a card falls back to the names frozen in its order, never to «deleted»', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../js/orders/deliveries-view.js', import.meta.url), 'utf8');
  const card = src.slice(src.indexOf('function reorderCard'));
  assert.match(card.slice(0, 900), /recordedName\(item\.id, ctx\.ingredientsById \|\| \{\}, record\?\.names \|\| \{\}\)/);
  assert.match(src, /openReorderScreen\(lastBannerCtx \|\| ctx\)/);
  assert.match(card.slice(0, 1400), /supplierLabel\(supplier\) \|\| record\?\.supplierName \|\| t\('orders\.deliveries\.unknownSupplier'\)/);
});
