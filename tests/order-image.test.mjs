// The order as a picture: the layout (pure) and the share outcomes. The editor that draws it
// from the (edited) text and the batch that sends it are tests/send-editor.test.mjs. The canvas itself needs a browser; everything that decides WHAT it draws does not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseBold, layoutOrder, plainLines, imageFileName, canSharePhotos, sharePhoto,
  INK, IMAGE_WIDTH, IMAGE_PADDING,
} from '../js/orders/order-image.js';
import { ignoreWhilePending, focusAfterBusy } from '../js/orders/supplier-picker.js';
import { buildOrderMessage } from '../js/orders/order-text.js';
import { _dictionaries } from '../js/i18n.js';

// 20px per character, bold the same: easy to reason about.
const measure = s => [...s].length * 20;
const WIDTH = { width: 400 + 2 * 10, padding: 10 };   // room for exactly 20 characters

// ── bold parsing ─────────────────────────────────────────────────────────────

test('*bold* is drawn bold without its asterisks; a lone asterisk stays', () => {
  assert.deepEqual(parseBold('*Ordine — X*'), [{ text: 'Ordine — X', bold: true }]);
  assert.deepEqual(parseBold('- a: 2'), [{ text: '- a: 2', bold: false }]);
  assert.deepEqual(parseBold('x *y* z'), [
    { text: 'x ', bold: false }, { text: 'y', bold: true }, { text: ' z', bold: false }]);
  assert.deepEqual(parseBold('A*B'), [{ text: 'A*B', bold: false }]);
});

// ── layout ───────────────────────────────────────────────────────────────────

test('the picture shows the same lines as buildOrderMessage, bold marks removed', () => {
  const text = buildOrderMessage([
    { supplierName: 'Alfa', items: [{ name: 'Flour', weight: '25kg', qty: 2 }] },
    { supplierName: 'Beta', items: [{ name: 'Milk', weight: '', qty: 6 }] },
  ], { grouped: true, locationName: 'Venue', language: 'it' });
  const layout = layoutOrder(text, () => 1);   // nothing ever wraps
  assert.deepEqual(plainLines(layout), text.replace(/\*/g, '').split('\n'));
  const boldRuns = layout.lines.flat().filter(s => s.bold).map(s => s.text);
  assert.ok(boldRuns.includes('Alfa') && boldRuns.includes('Beta'));
});

test('long lines wrap to the width and no word is lost', () => {
  const text = 'alpha beta gamma delta epsilon zeta eta theta';
  const layout = layoutOrder(text, measure, WIDTH);
  const rows = plainLines(layout);
  assert.ok(rows.length > 1);
  rows.forEach(r => assert.ok(measure(r) <= 400, `"${r}" is too wide`));
  assert.equal(rows.join(' '), text);
});

test('a word wider than the page is cut by character, nothing dropped', () => {
  const word = 'x'.repeat(45);
  const rows = plainLines(layoutOrder(word, measure, WIDTH));
  assert.ok(rows.length >= 3);
  assert.equal(rows.join(''), word);
});

test('wrapping keeps bold on the bold words', () => {
  const layout = layoutOrder('*one two three four five six seven*', measure, WIDTH);
  assert.ok(layout.lines.length > 1);
  assert.ok(layout.lines.flat().every(s => s.bold));
});

test('blank lines are kept and the height is fitted to the content', () => {
  const layout = layoutOrder('a\n\nb', measure, WIDTH);
  assert.deepEqual(plainLines(layout), ['a', '', 'b']);
  assert.equal(layout.height, 2 * 10 + 3 * layout.step);
  assert.equal(layout.step, Math.round(40 * 1.45));
});

test('the page is 1080 wide with 64px of padding', () => {
  assert.equal(IMAGE_WIDTH, 1080);
  assert.equal(IMAGE_PADDING, 64);
  assert.equal(layoutOrder('a', measure).width, 1080);
});

test('the ink is the --text token of tokens.css', () => {
  const css = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
  assert.match(css, new RegExp(`--text:\\s*${INK};`, 'i'));
});

test('the file name is the order word of the venue language plus the date, nothing else', () => {
  assert.equal(imageFileName(new Date(2026, 9, 7), 'en'), 'order-2026-10-07.png');
  assert.equal(imageFileName(new Date(2026, 9, 7), 'it'), 'ordine-2026-10-07.png');
  assert.equal(imageFileName(new Date(2026, 9, 7)), 'order-2026-10-07.png', 'no country: English, like the title');
});

// ── can this browser share a picture ─────────────────────────────────────────

test('canSharePhotos is true only with canShare AND share, and canShare saying yes', () => {
  const probe = () => ({});
  assert.equal(canSharePhotos({ canShare: () => true, share() {} }, probe), true);
  assert.equal(canSharePhotos({ canShare: () => false, share() {} }, probe), false);
  assert.equal(canSharePhotos({ share() {} }, probe), false);
  assert.equal(canSharePhotos({ canShare: () => true }, probe), false);
  assert.equal(canSharePhotos(null, probe), false);
  assert.equal(canSharePhotos({ canShare() { throw new Error('x'); }, share() {} }, probe), false);
});

test('sharePhoto: resolved = shared, AbortError = cancelled, anything else = failed', async () => {
  const f = {};
  assert.equal(await sharePhoto(f, { share: async () => {} }), 'shared');
  assert.equal(await sharePhoto(f, { share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } }), 'cancelled');
  assert.equal(await sharePhoto(f, { share: async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); } }), 'failed');
});

// ── the busy guard the picker keeps around a send ────────────────────────────

test('⚠️ the busy guard is released when the batch fails too', async () => {
  const states = [];
  const once = ignoreWhilePending(() => Promise.reject(new Error('boom')), p => states.push(p));
  once().catch(() => {});
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(states, [true, false]);
});

test('focus after a busy send: kept if somewhere real, else the button, else the heading', () => {
  const body = {}; const heading = {};
  assert.equal(focusAfterBusy({}, body, { disabled: false }, heading), null);
  assert.equal(focusAfterBusy(body, body, { disabled: false }, heading).disabled, false);
  assert.equal(focusAfterBusy(body, body, { disabled: true }, heading), heading);
  assert.equal(focusAfterBusy(null, body, { disabled: true }, heading), heading);
});

test('the picker restores focus when it releases the busy button', () => {
  const picker = readFileSync(new URL('../js/orders/supplier-picker.js', import.meta.url), 'utf8');
  assert.match(picker, /focusAfterBusy\(document\.activeElement, document\.body, actionBtn/);
  assert.match(picker, /h1', \{ text: title, tabindex: '-1' \}|tabindex: '-1'/);
});

test('⚠️ the send is not started twice while the editor is open', async () => {
  let calls = 0; const states = [];
  let release;
  const once = ignoreWhilePending(() => { calls++; return new Promise(r => { release = r; }); },
    p => states.push(p));
  once(); once(); once();
  assert.equal(calls, 1);
  release();
  await new Promise(r => setTimeout(r, 0));
  once();
  assert.equal(calls, 2, 'free again once the first settled');
  assert.deepEqual(states, [true, false, true]);
  assert.equal(ignoreWhilePending(() => 7)(), 7, 'a synchronous result is never pending');
});

test('the order picture is shared as a File — no link, no blob: URL, no download', () => {
  const src = readFileSync(new URL('../js/orders/order-image.js', import.meta.url), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/createObjectURL|\.download\s*=|blob:/.test(src));
  assert.match(src, /share\(\{ files: \[file\] \}\)/);
});

test('the keys still in use exist in both languages', () => {
  const d = _dictionaries();
  for (const lang of ['en', 'it']) {
    for (const k of ['photoFailed', 'skip', 'notSent']) {
      assert.ok(d[lang][`orders.sendFormat.${k}`], `${lang} ${k}`);
    }
  }
  assert.equal(d.it['orders.sendFormat.photoFailed'], 'Non riesco a condividere la foto: mando il testo.');
});
