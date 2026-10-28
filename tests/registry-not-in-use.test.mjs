// «Disattiva» / «Riattiva» on every ingredient row, the folded «Non in uso (N)» group and the pencil
// on hand-made items (js/orders/registry.js, 28 Oct 2026). P15.
//
// js/orders/registry.js is EXECUTED here against a small fake DOM, with the modules that reach
// Firebase (or that draw other screens) replaced by stubs — the screen is never connected to a
// database. The rows are found the way a person finds them: by the word on them.
//
// ⚠️ IT PROVES WHAT THE SCREEN DECIDES (which row is where, what it says, what a tap calls), not how it
// looks: the look is the ui-check skill's job.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { fromInvoice } from '../js/ingredient-origin.js';

// ── A DOM just complete enough for registry.js ───────────────────────────────

class ClassList {
  constructor() { this.set = new Set(); }
  add(...names) { names.forEach(n => n && this.set.add(n)); }
  remove(...names) { names.forEach(n => this.set.delete(n)); }
  contains(name) { return this.set.has(name); }
  toggle(name, on) { if (on) this.add(name); else this.remove(name); return this.contains(name); }
}

const ACTIVE = { el: null };

class Node {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.classList = new ClassList();
    this._text = null;
    this.open = false;
  }

  get className() { return [...this.classList.set].join(' '); }
  set className(value) { this.classList = new ClassList(); this.classList.add(...String(value).split(/\s+/)); }
  get dataset() {
    const attrs = this.attributes;
    return new Proxy({}, { get: (_, key) => attrs[`data-${String(key)}`] });
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text !== null ? this._text : this.children.map(c => c.textContent).join(''); }
  set innerHTML(value) { this._text = ''; this._html = value; }
  get disabled() { return 'disabled' in this.attributes; }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(child) { child.remove(); child.parentNode = this; this._text = null; this.children.push(child); return child; }
  prepend(child) { child.remove(); child.parentNode = this; this.children.unshift(child); }
  remove() {
    // A browser hands the focus to <body> when the focused element leaves the page.
    if (ACTIVE.el && this.contains(ACTIVE.el)) ACTIVE.el = null;
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this);
    this.parentNode = null;
  }
  replaceChildren(...kids) {
    this.children.forEach(c => { c.parentNode = null; });
    this.children = []; this._text = null;
    kids.forEach(k => this.appendChild(k));
  }
  replaceWith(next) {
    const parent = this.parentNode;
    const at = parent.children.indexOf(this);
    next.remove();
    next.parentNode = parent;
    parent.children[at] = next;
    this.parentNode = null;
  }
  contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
  focus() { ACTIVE.el = this; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  fire(type) { (this.listeners[type] || []).forEach(fn => fn({ target: this })); }

  querySelectorAll(selector) {
    const out = [];
    const groups = String(selector).split(',').map(s => s.trim()).filter(Boolean).map(s => s.split(/\s+/));
    const visit = (node) => {
      for (const child of node.children) {
        if (groups.some(parts => matchesChain(child, parts, this))) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

class Text extends Node {
  constructor(text) { super('#text'); this._text = String(text); }
}

// One compound selector: tag, .class, [attr], [attr="v"], :disabled.
function matchesCompound(node, compound) {
  if (!(node instanceof Node) || node.tagName === '#TEXT') return false;
  const tag = compound.match(/^[a-z0-9]+/i);
  if (tag && node.tagName !== tag[0].toUpperCase()) return false;
  for (const m of compound.matchAll(/\.([\w-]+)/g)) if (!node.classList.contains(m[1])) return false;
  for (const m of compound.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    if (!(m[1] in node.attributes)) return false;
    if (m[2] !== undefined && node.attributes[m[1]] !== m[2]) return false;
  }
  if (compound.includes(':disabled') && !node.disabled) return false;
  return true;
}
function matchesChain(node, parts, root) {
  if (!matchesCompound(node, parts[parts.length - 1])) return false;
  let at = node.parentNode;
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    while (at && at !== root && !matchesCompound(at, parts[i])) at = at.parentNode;
    if (!at || at === root) return false;
    at = at.parentNode;
  }
  return true;
}
const walk = (node, out = []) => { out.push(node); node.children.forEach(c => walk(c, out)); return out; };

const body = new Node('body');
const tablet = { on: false };
globalThis.document = {
  createElement: tag => new Node(tag),
  createTextNode: text => new Text(text),
  getElementById: () => null,
  body,
  get activeElement() { return ACTIVE.el || body; },
};
globalThis.window = {
  matchMedia: () => ({ get matches() { return tablet.on; }, addEventListener() {} }),
  dispatchEvent() {},
};
globalThis.requestAnimationFrame = fn => fn();
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

// ── The modules registry.js draws other screens with, or that reach a database, are stubbed ──

const REPORTS = [];
const CARDS = [];
globalThis.__registryTest = { REPORTS, CARDS, mkNode: tag => new Node(tag) };
const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const STUBS = {
  'js/orders/firebase-orders.js': stub('export const mayWritePrices = () => false;'),
  'js/orders/firebase-features.js': stub('export const ingredientPanels = () => ({ allergens: false }); export const setIngredientPanel = async () => {}; export const setPackPhoto = async () => {};'),
  'js/orders/photo-capture.js': stub('export const renderPackPhotoCapture = () => ({ root: null, dispose() {} });'),
  'js/orders/ingredient-merge-screen.js': stub('export const buildMergeChooser = () => null; export const runMergeFlow = async () => null;'),
  'js/orders/registry-settings.js': stub('export const buildRegistrySettings = () => null;'),
  'js/orders/suppliers.js': stub('export const dayShort = (d) => d;'),
  'js/supplier-record-form.js': stub('export const buildSupplierForm = () => null;'),
  'js/ingredient-record-form.js': stub(
    'export const buildIngredientForm = ({ item }) => { const t = globalThis.__registryTest; t.CARDS.push(item); const n = t.mkNode("div"); n.setAttribute("class", "mgmt-form"); return n; };'),
  'js/orders/mgmt-ui.js': stub(
    'export const BACK_ICON = ""; export const mgmtRow = (name) => { const n = globalThis.__registryTest.mkNode("div"); n.textContent = name; return n; };'
    + ' export const reportFailure = async (key, name, err) => { globalThis.__registryTest.REPORTS.push({ key, name, message: err && err.message }); };'),
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    const rel = resolved.url.startsWith('file:') ? decodeURIComponent(resolved.url).split('/mise_app/').pop() : '';
    const hit = Object.keys(STUBS).find(key => resolved.url.endsWith(`/${key}`) || rel.endsWith(key));
    return hit ? { url: STUBS[hit], shortCircuit: true } : resolved;
  },
});

const { setLanguage } = await import('../js/i18n.js');
const { buildRegistry } = await import('../js/orders/registry.js');
before(() => setLanguage('it'));

// ── The screen under test ────────────────────────────────────────────────────

const ing = (id, name, over = {}) => ({ id, name, supplierId: 'S1', unit: 'kg', kind: 'ingredient', active: true, supplierCode: 'X', ...over });
const box = (over = {}) => ({ id: 'B1', name: 'Scatola', supplierId: 'S1', kind: 'packaging', active: true, supplierCode: 'X', ...over });

function screen(initial, { pane = null } = {}) {
  const data = {
    items: initial,
    suppliers: () => [{ id: 'S1', name: 'ALDO', active: true }],
    favouriteSuppliers: () => [],
    ingredients: () => data.items,
  };
  const calls = [];
  const actions = {
    setIngredientActive: (id, active) => {
      calls.push({ id, active });
      return data.fail ? Promise.reject(new Error('refused')) : Promise.resolve();
    },
  };
  const reg = buildRegistry(data, actions, pane ? { pane } : {});
  const all = () => walk(reg.node);
  const rows = () => all().filter(n => n.classList.contains('reg-row'));
  const rowOf = (name) => rows().find(r => r.querySelector('.reg-name-text').textContent === name);
  const word = (name) => rowOf(name)?.querySelector('.reg-word');
  const groups = () => all().filter(n => n.tagName === 'DETAILS');
  const groupNames = () => groups().flatMap(g => g.querySelectorAll('.reg-name-text').map(n => n.textContent));
  const mainNames = () => rows().filter(r => !groups().some(g => g.contains(r))).map(r => r.querySelector('.reg-name-text').textContent);
  const set = (items) => { data.items = items; reg.refresh(); };
  const tab = (label) => all().find(n => n.classList.contains('view-switch-btn') && n.textContent === label);
  return { reg, data, calls, rows, rowOf, word, groups, groupNames, mainNames, set, tab, all };
}
const settle = () => new Promise(r => setImmediate(r));
const items = () => [ing('a', 'Burro'), ing('b', 'Farina'), ing('c', 'Zucchero', { active: false }), ing('d', 'Latte', { active: false })];

// ── The word ────────────────────────────────────────────────────────────────

test('every ingredient row carries the word, with an aria-label that CONTAINS it', () => {
  const s = screen(items());
  const burro = s.word('Burro');
  assert.equal(burro.textContent, 'Disattiva');
  assert.match(burro.getAttribute('aria-label'), /Disattiva/);
  assert.match(burro.getAttribute('aria-label'), /Burro/);
  assert.equal(burro.getAttribute('type'), 'button');
  s.tab('Ingredienti');
  const off = s.word('Zucchero');
  assert.equal(off.textContent, 'Riattiva');
  assert.match(off.getAttribute('aria-label'), /Riattiva Zucchero/);
});

test('packaging rows carry it too, and supplier rows do not', () => {
  const s = screen([...items(), box(), box({ id: 'B2', name: 'Vassoio', active: false })]);
  s.tab('Imballaggi').fire('click');
  assert.equal(s.word('Scatola').textContent, 'Disattiva');
  assert.equal(s.word('Vassoio').textContent, 'Riattiva');
  s.tab('Fornitori').fire('click');
  assert.equal(s.all().filter(n => n.classList.contains('reg-word')).length, 0);
});

test('the frame carries data-sel, and the drill button inside does not', () => {
  const s = screen(items());
  const row = s.rowOf('Burro');
  assert.equal(row.getAttribute('data-sel'), 'ingredient:a');
  assert.equal(row.querySelector('.reg-drill').getAttribute('data-sel'), undefined);
});

// ── The tap ─────────────────────────────────────────────────────────────────

test('tapping the word saves at once, flips the row and never opens the card', () => {
  CARDS.length = 0;
  const s = screen(items());
  const w = s.word('Burro');
  w.fire('click');
  assert.deepEqual(s.calls, [{ id: 'a', active: false }]);
  assert.equal(w.textContent, 'Riattiva');
  assert.match(w.getAttribute('aria-label'), /Riattiva Burro/);
  assert.equal(s.rowOf('Burro').querySelector('.reg-drill').classList.contains('inactive'), true);
  assert.equal(CARDS.length, 0, 'the card did not open');
  w.fire('click');
  assert.deepEqual(s.calls[1], { id: 'a', active: true });
  assert.equal(w.textContent, 'Disattiva');
});

test('after the live snapshot the switched row is still in its A–Z place, now saying «Riattiva»', () => {
  const s = screen(items());
  s.word('Burro').fire('click');
  s.set(items().map(i => (i.id === 'a' ? { ...i, active: false } : i)));
  assert.deepEqual(s.mainNames(), ['Burro', 'Farina'], 'in place, not moved to the group');
  assert.deepEqual(s.groupNames(), ['Latte', 'Zucchero']);
  const w = s.word('Burro');
  assert.equal(w.textContent, 'Riattiva');
  assert.equal(s.rowOf('Burro').querySelector('.reg-drill').classList.contains('inactive'), true);
});

// ⚠️ IN PLACE BOTH WAYS: a row switched back on from inside the group stays in the group (saying
// «Disattiva») until the list is opened again — it does not jump up under the finger.
test('a row switched back on inside the group stays in the group while the list is open', () => {
  const s = screen(items());
  s.word('Zucchero'); // inside the folded group, still drawn
  s.groups()[0].open = true;
  s.groups()[0].fire('toggle');
  s.word('Zucchero').fire('click');
  s.set(items().map(i => (i.id === 'c' ? { ...i, active: true } : i)));
  assert.deepEqual(s.mainNames(), ['Burro', 'Farina']);
  assert.deepEqual(s.groupNames(), ['Latte', 'Zucchero']);
  // Switched off again: still the group, its side was decided by the FIRST tap.
  s.word('Zucchero').fire('click');
  s.set(items());
  assert.deepEqual(s.groupNames(), ['Latte', 'Zucchero']);
});

test('after a tab change away and back the switched-off row sits in the folded group, with the count', () => {
  const s = screen(items());
  s.word('Burro').fire('click');
  s.set(items().map(i => (i.id === 'a' ? { ...i, active: false } : i)));
  s.tab('Imballaggi').fire('click');
  s.tab('Ingredienti').fire('click');
  assert.deepEqual(s.mainNames(), ['Farina']);
  assert.deepEqual(s.groupNames(), ['Burro', 'Latte', 'Zucchero']);
  const group = s.groups()[0];
  assert.equal(group.querySelector('summary').textContent, 'Non in uso (3)');
  assert.equal(group.open, false, 'closed by default');
  assert.equal(group.className, 'reg-notinuse');
});

test('no switched-off item, no group', () => {
  const s = screen([ing('a', 'Burro')]);
  assert.equal(s.groups().length, 0);
});

test('the group is closed by default, and keeps the state it was left in across repaints', () => {
  const s = screen(items());
  assert.equal(s.groups()[0].open, false);
  s.groups()[0].open = true;
  s.groups()[0].fire('toggle');
  s.set(items());
  assert.equal(s.groups()[0].open, true, 'a snapshot must not fold it again');
  s.groups()[0].open = false;
  s.groups()[0].fire('toggle');
  s.set(items());
  assert.equal(s.groups()[0].open, false);
});

test('a search that finds an item of the group opens it and counts only what matches', async () => {
  const s = screen(items());
  const input = s.all().find(n => n.classList.contains('mgmt-search-input'));
  input.value = 'zuc';
  input.fire('input');
  await new Promise(r => setTimeout(r, 200));
  assert.deepEqual(s.mainNames(), []);
  assert.deepEqual(s.groupNames(), ['Zucchero']);
  assert.equal(s.groups()[0].open, true);
  assert.equal(s.groups()[0].querySelector('summary').textContent, 'Non in uso (1)');
  input.value = 'zzzz';
  input.fire('input');
  await new Promise(r => setTimeout(r, 200));
  assert.equal(s.groups().length, 0);
  assert.equal(s.all().some(n => n.classList.contains('mgmt-empty')), true, 'the no-match sentence');
});

test('a search that matches only in-use items does not open the group', async () => {
  const s = screen([...items(), ing('e', 'Burro di montagna', { active: false })]);
  const input = s.all().find(n => n.classList.contains('mgmt-search-input'));
  input.value = 'farina';
  input.fire('input');
  await new Promise(r => setTimeout(r, 200));
  assert.equal(s.groups().length, 0);
  assert.deepEqual(s.mainNames(), ['Farina']);
});

test('the item open in the tablet pane opens its group by itself', () => {
  tablet.on = true;
  try {
    const pane = new Node('div');
    const s = screen(items(), { pane });
    s.rowOf('Burro').querySelector('.reg-drill').fire('click');
    assert.equal(s.rowOf('Burro').getAttribute('aria-current'), 'true');
    // Another phone switches it off: it is not in this screen's own «switched» memory, so it falls in the group.
    s.set(items().map(i => (i.id === 'a' ? { ...i, active: false } : i)));
    assert.deepEqual(s.groupNames(), ['Burro', 'Latte', 'Zucchero']);
    assert.equal(s.groups()[0].open, true);
    assert.equal(s.rowOf('Burro').getAttribute('aria-current'), 'true', 'the whole row card is the picked one');
  } finally {
    tablet.on = false;
  }
});

test('focus returning to a row inside a closed group opens the group first, and lands on the drill button', () => {
  tablet.on = true;
  try {
    const pane = new Node('div');
    const s = screen([ing('a', 'Burro'), ing('c', 'Zucchero', { active: false })], { pane });
    s.groups()[0].open = true;
    s.groups()[0].fire('toggle');
    const drill = s.rowOf('Zucchero').querySelector('.reg-drill');
    drill.fire('click');
    assert.ok(pane.querySelector('.mgmt-overlay'), 'the card opened in the pane');
    // The group is folded by hand while the card is open; closing the card brings the keyboard back to its row.
    s.groups()[0].open = false;
    s.groups()[0].fire('toggle');
    ACTIVE.el = pane.querySelector('h1');
    pane.querySelector('.orders-icon-btn').fire('click');
    assert.equal(s.groups()[0].open, true, 'the group was opened so the row can take focus');
    assert.equal(ACTIVE.el, s.rowOf('Zucchero').querySelector('.reg-drill'), 'focus is on the drill button inside the frame');
  } finally {
    tablet.on = false;
  }
});

// ── A rejected write ────────────────────────────────────────────────────────

test('a refused write puts the row back and says so', async () => {
  REPORTS.length = 0;
  const s = screen(items());
  s.data.fail = true;
  const w = s.word('Burro');
  w.fire('click');
  assert.equal(w.textContent, 'Riattiva', 'flipped at once, before the answer');
  await settle();
  await settle();
  assert.equal(w.textContent, 'Disattiva');
  assert.equal(s.rowOf('Burro').querySelector('.reg-drill').classList.contains('inactive'), false);
  assert.deepEqual(REPORTS.map(r => [r.key, r.name]), [['deactivate', 'Burro']]);
});

test('a refused re-activation reports «activate»', async () => {
  REPORTS.length = 0;
  const s = screen(items());
  s.data.fail = true;
  s.groups()[0].open = true;
  const w = s.word('Zucchero');
  w.fire('click');
  await settle();
  await settle();
  assert.equal(w.textContent, 'Riattiva');
  assert.deepEqual(REPORTS.map(r => r.key), ['activate']);
});

// ── A supplier's own screen ─────────────────────────────────────────────────

function openSupplierScreen(s) {
  s.tab('Fornitori').fire('click');
  s.all().find(n => n.classList.contains('reg-drill') && n.getAttribute('data-sel') === 'supplier:S1').fire('click');
  const overlay = body.children.find(n => n.classList.contains('mgmt-overlay'));
  const walkOverlay = () => walk(overlay);
  return {
    overlay,
    rows: () => walkOverlay().filter(n => n.classList.contains('reg-row')),
    word: (name) => walkOverlay().find(n => n.classList.contains('reg-row') && n.querySelector('.reg-name-text').textContent === name)?.querySelector('.reg-word'),
    groups: () => walkOverlay().filter(n => n.tagName === 'DETAILS'),
    names: (root) => walk(root).filter(n => n.classList.contains('reg-name-text')).map(n => n.textContent),
    back: () => overlay.querySelector('.orders-icon-btn'),
  };
}

test('a supplier screen: the word, the folded group, rows that stay, and a reopen that folds again', () => {
  body.children.length = 0;
  const s = screen(items());
  let sup = openSupplierScreen(s);
  assert.equal(sup.rows().length, 4);
  assert.equal(sup.word('Burro').textContent, 'Disattiva');
  assert.equal(sup.groups().length, 1);
  assert.equal(sup.groups()[0].querySelector('summary').textContent, 'Non in uso (2)');
  assert.equal(sup.word('Zucchero').textContent, 'Riattiva');
  assert.equal(sup.word('Burro').getAttribute('data-sel'), undefined);
  // Switch Burro off; the snapshot arrives and the screen is rebuilt with the SAME entry.
  sup.word('Burro').fire('click');
  assert.deepEqual(s.calls, [{ id: 'a', active: false }]);
  s.set(items().map(i => (i.id === 'a' ? { ...i, active: false } : i)));
  sup = { ...sup, overlay: body.children.find(n => n.classList.contains('mgmt-overlay')) };
  const names = (g) => walk(g).filter(n => n.classList.contains('reg-name-text')).map(n => n.textContent);
  const group = walk(sup.overlay).find(n => n.tagName === 'DETAILS');
  assert.deepEqual(names(group), ['Latte', 'Zucchero'], 'Burro stayed out of the group');
  const inPlace = walk(sup.overlay).filter(n => n.classList.contains('reg-row') && !group.contains(n))
    .map(r => r.querySelector('.reg-name-text').textContent);
  assert.deepEqual(inPlace, ['Burro', 'Farina']);
  // The list beside it did not jump either.
  s.tab('Ingredienti');
  assert.deepEqual(s.mainNames(), s.mainNames());
  // Back, and open the supplier again: a fresh entry, so Burro now sits in the folded group.
  body.children.find(n => n.classList.contains('mgmt-overlay')).querySelector('.orders-icon-btn').fire('click');
  return settle().then(() => {
    s.all().find(n => n.classList.contains('reg-drill') && n.getAttribute('data-sel') === 'supplier:S1').fire('click');
    const again = body.children.find(n => n.classList.contains('mgmt-overlay'));
    const g = walk(again).find(n => n.tagName === 'DETAILS');
    assert.deepEqual(names(g), ['Burro', 'Latte', 'Zucchero']);
    assert.equal(g.open, false);
    body.children.length = 0;
  });
});

test('a tap on a supplier screen also keeps the row in place on the list beside it (tablet)', () => {
  tablet.on = true;
  try {
    const pane = new Node('div');
    const s = screen(items(), { pane });
    s.tab('Fornitori').fire('click');
    s.all().find(n => n.classList.contains('reg-drill') && n.getAttribute('data-sel') === 'supplier:S1').fire('click');
    const overlay = pane.children.find(n => n.classList.contains('mgmt-overlay'));
    // The list beside it moves to the ingredients, with the supplier's screen still open.
    s.tab('Ingredienti').fire('click');
    walk(overlay).find(n => n.classList.contains('reg-row') && n.querySelector('.reg-name-text').textContent === 'Burro')
      .querySelector('.reg-word').fire('click');
    s.set(items().map(i => (i.id === 'a' ? { ...i, active: false } : i)));
    assert.deepEqual(s.mainNames(), ['Burro', 'Farina'], 'the list did not jump either');
    assert.equal(s.word('Burro').textContent, 'Riattiva');
  } finally {
    tablet.on = false;
  }
});

test('a refused write on a supplier screen puts the row back and says so', async () => {
  body.children.length = 0;
  REPORTS.length = 0;
  const s = screen(items());
  const sup = openSupplierScreen(s);
  s.data.fail = true;
  const w = sup.word('Farina');
  w.fire('click');
  await settle();
  await settle();
  assert.equal(w.textContent, 'Disattiva');
  assert.deepEqual(REPORTS.map(r => r.key), ['deactivate']);
  body.children.length = 0;
});

// ── The pencil ──────────────────────────────────────────────────────────────

test('the pencil marks hand-made items only, with no words beside it but its label', () => {
  const s = screen([
    ing('a', 'Fatto a mano', { supplierCode: undefined }),
    ing('b', 'Da fattura'),
    ing('c', 'Blank', { supplierCode: '  ', supplierCodes: ['', ' '], invoiceName: '   ' }),
    ing('d', 'Con codici', { supplierCode: undefined, supplierCodes: ['', 'K1'] }),
    ing('e', 'Con nome fattura', { supplierCode: undefined, invoiceName: 'FARINA 00' }),
  ]);
  const pencil = (name) => s.rowOf(name).querySelector('.reg-handmade');
  assert.ok(pencil('Fatto a mano'));
  assert.equal(pencil('Fatto a mano').getAttribute('role'), 'img');
  assert.equal(pencil('Fatto a mano').getAttribute('aria-label'), 'Inserito a mano');
  assert.equal(pencil('Fatto a mano').getAttribute('title'), 'Inserito a mano');
  assert.ok(pencil('Blank'), 'blanks do not count as an invoice');
  assert.equal(pencil('Da fattura'), null);
  assert.equal(pencil('Con codici'), null);
  assert.equal(pencil('Con nome fattura'), null);
});

test('the pencil is not on supplier rows', () => {
  const s = screen([ing('a', 'Fatto a mano', { supplierCode: undefined })]);
  s.tab('Fornitori').fire('click');
  assert.equal(s.all().filter(n => n.classList.contains('reg-handmade')).length, 0);
});

// ── fromInvoice, on its own ─────────────────────────────────────────────────

test('fromInvoice: each of the three invoice keys says «from an invoice»', () => {
  assert.equal(fromInvoice({ supplierCode: 'ABC' }), true);
  assert.equal(fromInvoice({ supplierCodes: ['ABC'] }), true);
  assert.equal(fromInvoice({ supplierCodes: ['', 'ABC'] }), true);
  assert.equal(fromInvoice({ invoiceName: 'FARINA' }), true);
});

test('fromInvoice: nothing, blanks and wrong types say «by hand»', () => {
  assert.equal(fromInvoice({}), false);
  assert.equal(fromInvoice(null), false);
  assert.equal(fromInvoice({ supplierCode: '', supplierCodes: [], invoiceName: '' }), false);
  assert.equal(fromInvoice({ supplierCode: '   ', supplierCodes: ['  ', ''], invoiceName: ' \t' }), false);
  assert.equal(fromInvoice({ supplierCode: 12, supplierCodes: 'ABC', invoiceName: null }), false);
});
