// The order as a picture: the layout (pure), the share outcomes, the chooser's decisions and
// the wording. The canvas itself needs a browser; everything that decides WHAT it draws does not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseBold, layoutOrder, plainLines, imageFileName, canSharePhotos, sharePhoto,
  INK, IMAGE_WIDTH, IMAGE_PADDING,
} from '../js/orders/order-image.js';
import { sendTexts, runPhotoBatch, afterShare, settleOnce } from '../js/orders/send-chooser.js';
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

// ── where it is wired, and the wording ───────────────────────────────────────

const chooser = readFileSync(new URL('../js/orders/send-chooser.js', import.meta.url), 'utf8');

test('only the two WhatsApp roads can ask; email and manager never touch the picture', () => {
  assert.equal((chooser.match(/viaWhatsapp\(/g) || []).length, 3, 'definition + two roads');
  const emailBranch = chooser.slice(chooser.indexOf("if (offer.route === 'email')"),
    chooser.indexOf("if (offer.route !== 'email')"));
  assert.ok(!/viaWhatsapp|askFormat/.test(emailBranch));
  assert.match(chooser, /if \(!canSharePhotos\(\)\) return finish\(sendTexts\(jobs, openTab\)\)/,
    'no canShare = no question, the text goes at once');
});

// ── delivering ───────────────────────────────────────────────────────────────

const JOBS = [
  { ids: ['a'], name: 'Alfa', text: 'ta', url: 'url-a' },
  { ids: ['b'], name: 'Beta', text: 'tb', url: 'url-b' },
  { ids: ['c'], name: 'Gamma', text: 'tc', url: 'url-c' },
];
const FILES = ['fa', 'fb', 'fc'];
const batch = (answers, jobs = JOBS, { okTap = true, windowOpens = true } = {}) => {
  const asked = []; const said = []; const opened = [];
  const ask = async ({ job, i, n }) => { asked.push([job.ids[0], i, n]); return answers[i]; };
  const run = runPhotoBatch({
    jobs, files: FILES, ask, notify: async m => { said.push(m); },
    confirmText: async () => okTap,
    open: u => { opened.push(u); return windowOpens ? {} : null; },
  });
  return run.then(sent => ({ sent, asked, said, opened }));
};

test('text road: every url opened, every id sent, synchronously — as before', () => {
  const opened = [];
  assert.deepEqual(sendTexts(JOBS, u => opened.push(u)), ['a', 'b', 'c']);
  assert.deepEqual(opened, ['url-a', 'url-b', 'url-c']);
});

test('one tap per picture: each job is asked in turn, with its number and the total', async () => {
  const r = await batch(['shared', 'shared', 'shared']);
  assert.deepEqual(r.asked, [['a', 0, 3], ['b', 1, 3], ['c', 2, 3]]);
  assert.deepEqual(r.sent, ['a', 'b', 'c']);
  assert.deepEqual(r.said, []);
  assert.deepEqual(r.opened, []);
});

test('⚠️ skip: that one is not sent, the next is still asked, and the not-sent one is named', async () => {
  const r = await batch(['shared', 'skipped', 'shared']);
  assert.deepEqual(r.sent, ['a', 'c']);
  assert.equal(r.asked.length, 3);
  assert.equal(r.said.length, 1);
  assert.match(r.said[0], /Beta/);
  assert.ok(!/Alfa|Gamma/.test(r.said[0]));
  assert.deepEqual(r.opened, []);
});

test('⚠️ cancel stops the whole batch: it and everything after are named, none sent', async () => {
  const r = await batch(['shared', 'cancelled', 'shared']);
  assert.deepEqual(r.sent, ['a']);
  assert.equal(r.asked.length, 2, 'the third was never asked');
  assert.match(r.said[0], /Beta/);
  assert.match(r.said[0], /Gamma/);
});

test('⚠️ a failed share, then OK: THAT supplier’s text is opened and counted as sent', async () => {
  const r = await batch(['failed', 'shared', 'skipped']);
  assert.deepEqual(r.opened, ['url-a'], 'one link, for the one that failed, and no loop');
  assert.deepEqual(r.sent, ['a', 'b']);
  assert.match(r.said[0], /Gamma/);
});

test('⚠️ a failed share, then Cancel or Escape: nothing opened, nothing counted, named', async () => {
  const r = await batch(['failed', 'shared', 'shared'], JOBS, { okTap: false });
  assert.deepEqual(r.opened, []);
  assert.deepEqual(r.sent, ['b', 'c']);
  assert.match(r.said[0], /Alfa/);
});

test('⚠️ a fallback text whose window was blocked is not counted as sent', async () => {
  const r = await batch(['failed', 'shared', 'shared'], JOBS, { windowOpens: false });
  assert.deepEqual(r.opened, ['url-a']);
  assert.deepEqual(r.sent, ['b', 'c']);
  assert.match(r.said[0], /Alfa/);
});

test('⚠️ the text road counts only the chats whose window really opened', () => {
  const sent = sendTexts(JOBS, u => (u === 'url-b' ? null : {}));
  assert.deepEqual(sent, ['a', 'c']);
});

test('⚠️ a dialog settles once: a late share() after Skip or Cancel is ignored', () => {
  const answers = [];
  let cleaned = 0;
  const done = settleOnce(v => answers.push(v), () => { cleaned++; });
  assert.equal(done('skipped'), true);
  assert.equal(done('shared'), false, 'the late «shared» never counts');
  assert.deepEqual(answers, ['skipped']);
  assert.equal(cleaned, 1);
});

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

test('⚠️ while a share runs only «Share» is disabled; Escape cancels; the page coming back re-enables it', () => {
  const dialog = chooser.slice(chooser.indexOf('function photoDialog'), chooser.indexOf('// ⚠️ DIGITS ONLY'));
  assert.ok(!/otherBtn\.disabled = true/.test(dialog), 'Skip/Cancel must stay live');
  assert.match(dialog, /onCancel: \(\) => done\('cancelled'\)/);
  assert.match(dialog, /visibilitychange/);
  assert.match(dialog, /removeEventListener\('visibilitychange'/);
  assert.match(dialog, /settleOnce\(resolve/);
});

test('the picker restores focus when it releases the busy button', () => {
  const picker = readFileSync(new URL('../js/orders/supplier-picker.js', import.meta.url), 'utf8');
  assert.match(picker, /focusAfterBusy\(document\.activeElement, document\.body, actionBtn/);
  assert.match(picker, /h1', \{ text: title, tabindex: '-1' \}|tabindex: '-1'/);
});

test('one grouped chat: cancelled sends nothing and shows no «not sent» list', async () => {
  const r = await batch(['cancelled'], [{ ids: ['a', 'b'], text: 't', url: 'u' }]);
  assert.deepEqual(r.sent, []);
  assert.deepEqual(r.said, []);
});

test('afterShare: shared is done, a closed sheet keeps the dialog open, the rest failed', () => {
  assert.equal(afterShare('shared'), 'shared');
  assert.equal(afterShare('cancelled'), 'again');
  assert.equal(afterShare('failed'), 'failed');
});

test('⚠️ the send is not started twice while the pictures are being drawn', async () => {
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

test('⚠️ the share starts INSIDE the click handler, with no await before it', () => {
  const handler = chooser.slice(chooser.indexOf("shareBtn.addEventListener('click'"),
    chooser.indexOf("otherBtn.addEventListener('click'"));
  assert.match(handler, /sharePhoto\(file\)/);
  assert.ok(!/await/.test(handler.slice(0, handler.indexOf('sharePhoto('))));
  assert.match(handler, /shareBtn\.disabled = true/);
});

test('the pictures are all drawn before the first dialog; the dialogs are one per picture', () => {
  assert.ok(chooser.indexOf('Promise.all(jobs.map(j => renderOrderImage')
    < chooser.indexOf('runPhotoBatch({'));
});

test('both question dialogs are named, trap Tab and give focus back', () => {
  const shell = chooser.slice(chooser.indexOf('function modalShell'), chooser.indexOf('// «Photo or text?»'));
  assert.match(shell, /'aria-labelledby': titleId/);
  assert.match(shell, /role: 'dialog', 'aria-modal': 'true'/);
  assert.match(shell, /e\.key === 'Escape'/);
  assert.match(shell, /e\.key !== 'Tab'/);
  assert.match(shell, /prevFocus\.focus\(\)/);
  const users = chooser.match(/= modalShell\(/g) || [];
  assert.equal(users.length, 2, 'the format question and the photo dialog both use it');
});

test('the .send-route-primary button has a visible press state', () => {
  const css = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
  assert.match(css, /\.send-route-primary:active\s*\{[^}]*scale\(\.97\)/);
});

test('the order picture is shared as a File — no link, no blob: URL, no download', () => {
  const src = readFileSync(new URL('../js/orders/order-image.js', import.meta.url), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/createObjectURL|\.download\s*=|blob:/.test(src));
  assert.match(src, /share\(\{ files: \[file\] \}\)/);
});

test('the four keys exist in both languages and the prompt is a question', () => {
  const d = _dictionaries();
  for (const lang of ['en', 'it']) {
    for (const k of ['title', 'photo', 'text', 'photoFailed', 'shareFor', 'shareReady', 'share', 'skip', 'notSent']) {
      assert.ok(d[lang][`orders.sendFormat.${k}`], `${lang} ${k}`);
    }
  }
  assert.equal(d.it['orders.sendFormat.title'], 'Come lo mandi?');
  assert.equal(d.en['orders.sendFormat.photo'], 'Order photo');
  assert.equal(d.it['orders.sendFormat.photoFailed'], 'Non riesco a condividere la foto: mando il testo.');
});

test('labels are read inside the function that draws them', () => {
  assert.match(chooser, /function askFormat\(\)[\s\S]*t\('orders\.sendFormat\.title'\)/);
  assert.ok(!/^const \w+ = t\(/m.test(chooser));
});
