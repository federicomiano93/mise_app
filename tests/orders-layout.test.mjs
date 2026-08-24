// The Orders screen, rearranged so it reads as one job.
//
// Federico, 24 Aug 2026: the calendar notice at the top and closeable; everything
// that makes an order inside ONE box with a head that stays put; the order lists at
// the foot, small, and lit when something arrives; one centred button in the bar,
// with History moved inside Settings and the settings themselves separated to look at.
//
// ⚠️ What these guard is not the LOOK — nothing here can see a pixel. It is the
// handful of facts underneath it that a later edit could quietly undo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _dictionaries } from '../js/i18n.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
// ⚠️ THE CODE, NOT THE FILE: this project explains itself in its comments, and they
// name the very things these guards forbid.
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PAGE = read('orders.html');
const MAIN = codeOf(read('js/orders/orders-main.js'));
const MGMT = codeOf(read('js/orders/management.js'));
const CSS = read('orders.css');

// ── 1. One box ───────────────────────────────────────────────────────────────

test('the two panels and the two controls are inside one box', () => {
  const box = PAGE.slice(PAGE.indexOf('<div class="order-box">'));
  assert.ok(box.length > 500, 'the slice must not be empty');
  const body = box.slice(0, box.indexOf('<!-- HISTORY'));
  for (const needle of ['class="tab-bar"', 'id="order-view-switch"',
    'id="tab-order"', 'id="tab-deliveries"']) {
    assert.ok(body.includes(needle), `${needle} must be inside the box`);
  }
});

// ⚠️⚠️ THE TAB BAR USED TO SIT OUTSIDE .scroll-area, which is the ONLY reason it
// stayed put while the list scrolled. Inside the box it has to be MADE to stay put,
// or changing view half way down a long list means scrolling back to the top to do it.
test('⚠️⚠️ the head is sticky, because it no longer gets it for free', () => {
  const rule = CSS.slice(CSS.indexOf('.order-box-head {'));
  const block = rule.slice(0, rule.indexOf('}'));
  assert.ok(block.length > 20, 'the slice must not be empty');
  assert.match(block, /position:\s*sticky/);
  assert.match(block, /top:\s*0/);
  assert.match(block, /background:/, 'an opaque ground is part of the mechanism: rows '
    + 'would otherwise slide visibly underneath it');
});

// ⚠️ `overflow: hidden` on the box would make it its own scroll container and the
// sticky head would stop sticking — silently, and only on a list long enough to
// scroll, which is the only case it exists for.
test('⚠️ the box does not clip its own overflow', () => {
  const rule = CSS.slice(CSS.indexOf('.order-box {'));
  assert.ok(!/overflow:\s*hidden/.test(rule.slice(0, rule.indexOf('}'))));
});

// ⚠️⚠️ TWO CONDITIONS, ONE WRITER. The switch used to live INSIDE the order panel, so
// the Incoming tab hid it for free. In the shared head it would sit there on Incoming
// offering to switch a list that is not on screen. Two functions writing the same
// `hidden` is how the two conditions come to disagree.
test('⚠️⚠️ exactly one function decides whether the view switch is shown', () => {
  const writers = MAIN.match(/order-view-switch[\s\S]{0,200}?hidden\s*=/g) || [];
  assert.equal(writers.length, 1, 'only refreshViewSwitch() may write it');
  const fn = MAIN.slice(MAIN.indexOf('function refreshViewSwitch()'));
  const body = fn.slice(0, fn.search(/^\}/m));
  assert.ok(body.length > 80, 'the slice must not be empty');
  assert.ok(body.includes("'tab-order'"), 'it asks which tab is showing');
  assert.ok(body.includes('hasSomethingToOrder'), 'and whether there is anything to order');
});

test('changing tab re-asks the question', () => {
  const fn = MAIN.slice(MAIN.indexOf('function setupTabs()'));
  assert.ok(fn.slice(0, fn.search(/^\}/m)).includes('refreshViewSwitch()'));
});

// ── 2. The order lists ───────────────────────────────────────────────────────

// ⚠️⚠️ THESE TWO ARE ONE DECISION AND MUST NOT BE SPLIT. The green banner at the top
// carried NO role gate, so it was the only sight an ordinary employee had of the
// lists; the card at the foot was manager-only. Removing the banner while the card
// stayed gated would leave the very people who SEND a list unable to see one.
test('⚠️⚠️ the banner is gone AND the card is open to everybody', () => {
  assert.ok(!PAGE.includes('id="orders-requests"'), 'the top banner is gone from the page');
  assert.ok(!MAIN.includes('renderRequestBanner'), 'and from the code');
  assert.ok(!CSS.includes('.req-banner'), 'and its styles went with it');

  const fn = MAIN.slice(MAIN.indexOf('function renderRequestCard()'));
  const body = fn.slice(0, fn.search(/^\}/m));
  assert.ok(body.length > 100, 'the slice must not be empty');
  assert.ok(!/hidden\s*=\s*!canManageHere\(\)/.test(body),
    'the card must not be behind a role again — it is the only door left');
});

// ⚠️ Smaller was the instruction; quieter-when-empty was never part of it. The colour
// swap is what makes a waiting list findable without reading the screen.
test('⚠️ the card still changes colour when a list is waiting', () => {
  const fn = MAIN.slice(MAIN.indexOf('function renderRequestCard()'));
  assert.match(fn.slice(0, fn.search(/^\}/m)), /requests-card--waiting/);
  assert.match(CSS, /\.requests-card--waiting\s*\{/);
});

// ⚠️ 44px is the floor for anything a thumb has to hit, whatever else changes.
test('⚠️ the smaller card is still big enough to tap', () => {
  const rule = CSS.slice(CSS.lastIndexOf('.requests-card {'));
  const px = Number((rule.slice(0, rule.indexOf('}')).match(/min-height:\s*(\d+)px/) || [])[1]);
  assert.ok(px >= 44, `min-height is ${px}px — under the 44px tap floor`);
});

// ── 3. One button in the bar, and History behind the gear ────────────────────

test('the bar holds one button, and the bar itself is derived from it', () => {
  const bar = PAGE.match(/<div class="recipe-footer"[\s\S]*?<\/div>/)[0];
  assert.equal((bar.match(/class="recipe-footer-btn"/g) || []).length, 1);
  assert.match(bar, /id="settings-footer-btn"/);
  assert.match(MAIN, /footerEl\.hidden = !\[\.\.\.footerEl\.children\]\.some/,
    'no visible button, no bar — derived, never typed');
});

// ⚠️⚠️ THE v1.62.0 CHECK, MADE AGAIN. A gate on a container is a gate on everything
// later put inside it. History has never had a role, and the panel it now lives in is
// open to everybody — `isAdmin` is the always-true placeholder and each control in
// there carries its own permission.
test('⚠️⚠️ moving History into Settings takes it away from nobody', () => {
  assert.match(codeOf(read('js/orders/management.js')), /export const isAdmin = true/,
    'the settings panel is for everybody; each control is gated on its own');
  const render = MGMT.slice(MGMT.indexOf('function render()'));
  const body = render.slice(0, render.search(/^  \}/m));
  assert.ok(body.length > 100, 'the slice must not be empty');
  const history = body.slice(body.indexOf("section('ui.history'"));
  assert.ok(history.length > 10, 'History must be a section of the panel');
  assert.ok(!/boss/.test(body.slice(body.indexOf("section('ui.history'") - 60,
    body.indexOf("section('ui.history'"))), 'and it must not sit behind `boss`');
});

// ⚠️⚠️ AND IT HAS TO BE IN THE RIGHT HALF OF THE CALL. buildManagement(data,
// actions) reads it as actions.openHistory and skips the whole section when it is
// missing — so putting it in `data` left History simply not there, in silence, with
// every test green. Only opening the screen showed it. A guard that asks whether the
// WORD appears would have passed too; this one asks where.
test('⚠️⚠️ the way into History is handed in as an ACTION, not as data', () => {
  const call = MAIN.slice(MAIN.indexOf('buildManagement('));
  // The call ends at the closing paren in column 3.
  const args = call.slice(0, call.search(/^  \);/m));
  assert.ok(args.length > 100, 'the slice must not be empty');
  const secondObject = args.slice(args.indexOf('onClose:'));
  assert.ok(secondObject.includes('openHistory:'),
    'openHistory must sit beside onClose, in the actions object');
  assert.match(MGMT, /actions\.openHistory\(\)/, 'management.js only calls what it was given');
});

// ── 4. The settings groups can be told apart ─────────────────────────────────

test('every settings group is a card with a border', () => {
  const fn = MGMT.slice(MGMT.indexOf('function section('));
  const body = fn.slice(0, fn.search(/^  \}/m));
  assert.ok(body.length > 80, 'the slice must not be empty');
  assert.ok(body.includes("class: 'mgmt-fold'"), 'the card the ingredient record uses');
  assert.ok(body.includes('mgmt-fold-head--static'), 'a heading, not a tap target that does nothing');
});

// ⚠️⚠️ THE ONE THING THE CARD SHAPE DOES NOT BRING WITH IT. .mgmt-fold lives inside
// .mgmt-form, a flex column with a gap; .mgmt-scroll is not one, so without this the
// cards touch and read as a single long box — the very thing the border was for.
test('⚠️⚠️ two settings cards do not touch', () => {
  assert.match(CSS, /\.mgmt-scroll > \.mgmt-fold \+ \.mgmt-fold\s*\{[^}]*margin-top/);
});

test('an empty group draws no heading at all', () => {
  const fn = MGMT.slice(MGMT.indexOf('function section('));
  assert.match(fn.slice(0, fn.search(/^  \}/m)), /if \(!inner\.length\) return;/);
});

// ── 5. The words ─────────────────────────────────────────────────────────────

test('every new phrase exists in BOTH languages', () => {
  const keys = ['orders.alert.close', 'orders.alert.reopen', 'orders.settings.openHistory'];
  const dicts = Object.entries(_dictionaries());
  assert.ok(dicts.length >= 2);
  for (const [lang, dict] of dicts) {
    for (const key of keys) {
      assert.ok(typeof dict[key] === 'string' && dict[key].trim(), `${key} missing in ${lang}`);
    }
  }
});

test('the new module is precached, or an offline phone 404s on it', () => {
  assert.ok(read('sw.js').includes("'./js/orders/alert-dismissal.js'"));
});
