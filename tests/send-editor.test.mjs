// The send editor (owner, 14 Nov 2026): every road that hands an order over shows the message as
// the supplier will get it, editable, with ONE «Invia» — and the picture, or the link, is made
// from the EDITED text. The «photo or text?» question is gone.
//
// The dialog is EXECUTED against the small DOM in tests/helpers/form-dom.mjs (it is not a
// browser: it proves what the editor decides and sends, not how it looks — that is ui-check).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom, walk, type, click, Node } from './helpers/form-dom.mjs';

installDom();
// What the editor needs beyond the card's DOM: a body to open on, listeners that can be removed,
// a visible page, and replaceChildren that keeps what it is given (the preview is redrawn so).
const listeners = {};
Object.assign(globalThis.document, {
  body: new Node('body'),
  visibilityState: 'visible',
  addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
  removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter(f => f !== fn); },
});
Node.prototype.replaceChildren = function replaceChildren(...kids) {
  this.children = [];
  this._text = null;
  kids.forEach(k => this.appendChild(k));
};
Node.prototype.querySelector = function querySelector() { return null; };

// The share sheet: records what it was handed and whether that happened INSIDE the tap.
let tapping = false;
const shares = [];
let shareAnswer = async () => {};
Object.defineProperty(globalThis.navigator, 'share', {
  configurable: true, writable: true,
  value: async payload => { shares.push({ file: payload.files[0], inTap: tapping }); return shareAnswer(); },
});
const tap = node => { tapping = true; try { click(node); } finally { tapping = false; } };

const {
  sendEditorDialog, runSendBatch, picturePrep, previewLines, editorTitle, settleOnce, afterShare,
} = await import('../js/orders/send-editor.js');

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
const nodes = () => walk(globalThis.document.body);
const box = () => nodes().find(n => n.tagName === 'TEXTAREA');
const sendButton = () => nodes().find(n => n.tagName === 'BUTTON' && n.classList.contains('app-dialog-btn-solid'));
const otherButton = () => nodes().find(n => n.tagName === 'BUTTON' && n.classList.contains('app-dialog-btn-ghost'));
const preview = () => nodes().find(n => n.classList?.contains('send-editor-preview'));

beforeEach(() => {
  globalThis.document.body.children = [];
  shares.length = 0;
  shareAnswer = async () => {};
});

const MESSAGE = '*Ordine — Panificio*\n\n- Farina: 2\n- Lievito: 1';

// ── ⚠️ the picture is drawn from the EDITED text, and shared inside the tap ──────────

test('⚠️ the editor shows the message in a labelled box, draws it, and shares the picture of the EDITED text', async () => {
  const drawn = [];
  const render = async text => { drawn.push(text); return { picture: text }; };
  const answer = sendEditorDialog({ job: { name: 'Bruno', text: MESSAGE, open: () => { throw new Error('no link on the picture road'); } },
    photo: true, render });

  const area = box();
  assert.equal(area.value, MESSAGE, 'the message exactly as buildOrderMessage wrote it');
  const label = nodes().find(n => n.tagName === 'LABEL');
  assert.equal(label.getAttribute('for'), area.getAttribute('id'), 'the box is labelled');
  assert.equal(area.getAttribute('aria-describedby'), nodes().find(n => n.classList?.contains('send-editor-hint')).getAttribute('id'));

  await wait(0);
  assert.deepEqual(drawn, [MESSAGE], 'drawn at once on open');
  assert.equal(sendButton().disabled, false);

  type(area, `${MESSAGE}\n- Sale: 3`);
  assert.equal(sendButton().disabled, true, '«Invia» waits for the picture of what is in the box now');
  tap(sendButton());
  assert.equal(shares.length, 0, 'a stale picture is never shared');

  await wait(450);                                   // the debounce, then the drawing
  assert.equal(drawn.at(-1), `${MESSAGE}\n- Sale: 3`);
  assert.equal(sendButton().disabled, false);

  tap(sendButton());
  assert.equal(shares.length, 1);
  assert.equal(shares[0].inTap, true, '⚠️ navigator.share() called synchronously inside the click');
  assert.deepEqual(shares[0].file, { picture: `${MESSAGE}\n- Sale: 3` }, 'the picture of the EDITED text');
  assert.deepEqual(await answer, { outcome: 'shared', text: `${MESSAGE}\n- Sale: 3` });
  assert.equal(globalThis.document.body.children.length, 0, 'closed');
});

test('the preview draws *bold* bold, as WhatsApp does, and follows the typing', async () => {
  sendEditorDialog({ job: { text: MESSAGE, open: () => true }, photo: false });
  const strong = walk(preview()).filter(n => n.tagName === 'STRONG').map(n => n.textContent);
  assert.deepEqual(strong, ['Ordine — Panificio']);
  assert.ok(!preview().textContent.includes('*'), 'the asterisks are the bold, not text');
  type(box(), '*Nuovo*\n- Burro: 1');
  assert.deepEqual(walk(preview()).filter(n => n.tagName === 'STRONG').map(n => n.textContent), ['Nuovo']);
  assert.match(preview().textContent, /Burro: 1/);
  click(otherButton());
});

test('the text road (no share sheet for files, or email): the EDITED text opens inside the tap', async () => {
  const opened = [];
  const answer = sendEditorDialog({ job: { name: 'Bruno', text: MESSAGE, open: text => { opened.push({ text, inTap: tapping }); return {}; } },
    photo: false });
  type(box(), 'Ciao Bruno\n- Farina: 3');
  tap(sendButton());
  assert.deepEqual(opened, [{ text: 'Ciao Bruno\n- Farina: 3', inTap: true }]);
  assert.deepEqual(await answer, { outcome: 'opened', text: 'Ciao Bruno\n- Farina: 3' });
});

test('a blocked window is not «opened»; an emptied box cannot be sent', async () => {
  const answer = sendEditorDialog({ job: { text: MESSAGE, open: () => null }, photo: false });
  type(box(), '   ');
  assert.equal(sendButton().disabled, true);
  type(box(), 'x');
  tap(sendButton());
  assert.equal((await answer).outcome, 'blocked');
});

test('Cancel sends nothing; with several, the button is «Skip»', async () => {
  const one = sendEditorDialog({ job: { text: MESSAGE, open: () => { throw new Error('nothing may open'); } }, photo: false });
  assert.equal(otherButton().textContent, 'Cancel');
  click(otherButton());
  assert.equal((await one).outcome, 'cancelled');
  const many = sendEditorDialog({ job: { name: 'A', text: MESSAGE, open: () => true }, i: 0, n: 2, photo: false });
  assert.equal(otherButton().textContent, 'Skip');
  click(otherButton());
  assert.equal((await many).outcome, 'skipped');
});

test('Escape cancels (nothing sent), and the listener goes with the dialog', async () => {
  const answer = sendEditorDialog({ job: { text: MESSAGE, open: () => { throw new Error('nothing may open'); } }, photo: false });
  const before = (listeners.keydown || []).length;
  listeners.keydown.at(-1)({ key: 'Escape', preventDefault() {} });
  assert.equal((await answer).outcome, 'cancelled');
  assert.equal((listeners.keydown || []).length, before - 1);
});

test('a picture that cannot be drawn: «Invia» answers «failed» with the edited text (the caller offers the text)', async () => {
  const answer = sendEditorDialog({ job: { text: MESSAGE, open: () => true }, photo: true,
    render: async () => { throw new Error('no canvas'); } });
  await wait(0);
  type(box(), 'edited');
  await wait(450);
  tap(sendButton());
  assert.deepEqual(await answer, { outcome: 'failed', text: 'edited' });
  assert.equal(shares.length, 0);
});

test('the share sheet closed without sending: the editor stays, «Invia» works again', async () => {
  shareAnswer = async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); };
  const answer = sendEditorDialog({ job: { text: MESSAGE, open: () => true }, photo: true, render: async t => ({ t }) });
  await wait(0);
  tap(sendButton());
  await wait(0);
  assert.equal(sendButton().disabled, false);
  assert.equal(globalThis.document.body.children.length, 1, 'still open');
  shareAnswer = async () => {};
  tap(sendButton());
  assert.equal((await answer).outcome, 'shared');
});

// ── the picture keeper, with its own clock ──────────────────────────────────────

function clock() {
  let next = 0; const due = new Map();
  return {
    setTimer: (fn, ms) => { const id = ++next; due.set(id, fn); return id; },
    clearTimer: id => { due.delete(id); },
    run() { const fns = [...due.values()]; due.clear(); fns.forEach(fn => fn()); },
    pending: () => due.size,
  };
}

test('picturePrep: drawn at once, redrawn after the pause, never ready for a text that is not in the box', async () => {
  const c = clock();
  const drawn = [];
  const prep = picturePrep({ render: async t => { drawn.push(t); return `file:${t}`; }, setTimer: c.setTimer, clearTimer: c.clearTimer });
  prep.update('a', { now: true });
  await wait(0);
  assert.equal(prep.ready('a'), 'file:a');
  prep.update('ab');
  prep.update('abc');
  assert.equal(c.pending(), 1, 'one drawing for a burst of typing');
  assert.equal(prep.ready('abc'), null);
  assert.equal(prep.ready('a'), null, 'the old picture is not the box any more');
  c.run();
  await wait(0);
  assert.deepEqual(drawn, ['a', 'abc']);
  assert.equal(prep.ready('abc'), 'file:abc');
  prep.update('a');
  assert.equal(prep.ready('a'), null, 'typed back: drawn again, never the stale one by luck');
});

test('⚠️ picturePrep: a typo deleted while its picture is being drawn leaves «Invia» ready (review, 14 Nov 2026)', async () => {
  const c = clock();
  const finish = {};
  const states = [];
  const prep = picturePrep({
    render: t => new Promise(r => { finish[t] = () => r(`file:${t}`); }),
    onChange: st => states.push(st), setTimer: c.setTimer, clearTimer: c.clearTimer,
  });
  prep.update('A', { now: true });
  await wait(0); finish.A(); await wait(0);
  prep.update('AB');
  c.run();                       // «AB» starts drawing…
  await wait(0);
  prep.update('A');              // …and the typo is deleted before it lands
  finish.AB(); await wait(0);
  assert.equal(prep.ready('A'), 'file:A');
  assert.deepEqual(states.at(-1), { ready: true, busy: false, failed: false });
});

test('picturePrep: an older drawing that finishes late is ignored', async () => {
  const c = clock();
  const finish = {};
  const prep = picturePrep({ render: t => new Promise(r => { finish[t] = () => r(`file:${t}`); }), setTimer: c.setTimer, clearTimer: c.clearTimer });
  prep.update('old', { now: true });
  await wait(0);
  prep.update('new', { now: true });
  await wait(0);
  finish.new(); await wait(0);
  finish.old(); await wait(0);
  assert.equal(prep.ready('new'), 'file:new');
});

test('picturePrep: a failed drawing is reported for that text only', async () => {
  const prep = picturePrep({ render: async t => { if (t === 'bad') throw new Error('x'); return t; } });
  prep.update('bad', { now: true });
  await wait(0);
  assert.equal(prep.failed('bad'), true);
  prep.update('good', { now: true });
  await wait(0);
  assert.equal(prep.failed('good'), false);
  assert.equal(prep.ready('good'), 'good');
  prep.stop();
});

test('the email road previews the text as the mail app shows it: asterisks and all', async () => {
  sendEditorDialog({ job: { text: '*Ordine*\n- Farina: 2', plain: true, open: () => true }, photo: false });
  assert.equal(walk(preview()).filter(n => n.tagName === 'STRONG').length, 0);
  assert.match(preview().textContent, /\*Ordine\*/);
  click(otherButton());
  assert.match(chooser, /jobs\.push\(\{ ids: \[supplier\.id\], name, text, plain: true, open: edited => \{/);
});

test('previewLines and the title', () => {
  assert.deepEqual(previewLines('*A*\n\nb'), [[{ text: 'A', bold: true }], [], [{ text: 'b', bold: false }]]);
  assert.equal(editorTitle({ name: 'Bruno' }), 'Order for Bruno');
  assert.equal(editorTitle({ name: 'Bruno', i: 1, n: 3 }), 'Order for Bruno (2 of 3)');
  assert.equal(editorTitle({}), 'Check the order');
});

// ── one editor per message, Skip and Cancel as the photos had them ─────────────────

const JOBS = [
  { ids: ['a'], name: 'Alfa', text: 'ta' },
  { ids: ['b'], name: 'Beta', text: 'tb' },
  { ids: ['c'], name: 'Gamma', text: 'tc' },
];
const batch = (answers, jobs = JOBS, { okTap = true, windowOpens = true } = {}) => {
  const asked = []; const said = []; const opened = [];
  const withOpen = jobs.map(j => ({ ...j, open: text => { opened.push([j.ids[0], text]); return windowOpens ? {} : null; } }));
  return runSendBatch({
    jobs: withOpen,
    ask: async ({ job, i, n }) => { asked.push([job.ids[0], i, n]); return { outcome: answers[i], text: `edited ${job.text}` }; },
    notify: async m => { said.push(m); },
    confirmText: async () => okTap,
  }).then(sent => ({ sent, asked, said, opened }));
};

test('one editor per message, in turn, each with its number and the total', async () => {
  const r = await batch(['shared', 'opened', 'shared']);
  assert.deepEqual(r.asked, [['a', 0, 3], ['b', 1, 3], ['c', 2, 3]]);
  assert.deepEqual(r.sent, ['a', 'b', 'c']);
  assert.deepEqual(r.said, []);
});

test('⚠️ skip: that one is not sent, the next is still asked, and the not-sent one is named', async () => {
  const r = await batch(['shared', 'skipped', 'shared']);
  assert.deepEqual(r.sent, ['a', 'c']);
  assert.match(r.said[0], /Beta/);
  assert.ok(!/Alfa|Gamma/.test(r.said[0]));
});

test('⚠️ cancel stops the whole batch: it and everything after are named, none sent', async () => {
  const r = await batch(['shared', 'cancelled', 'shared']);
  assert.deepEqual(r.sent, ['a']);
  assert.equal(r.asked.length, 2);
  assert.match(r.said[0], /Beta/);
  assert.match(r.said[0], /Gamma/);
});

test('⚠️ a failed picture, then OK: THAT supplier’s EDITED text is opened and counted', async () => {
  const r = await batch(['failed', 'shared', 'skipped']);
  assert.deepEqual(r.opened, [['a', 'edited ta']]);
  assert.deepEqual(r.sent, ['a', 'b']);
});

test('⚠️ a failed picture, then Cancel: nothing opened, nothing counted, named', async () => {
  const r = await batch(['failed', 'shared', 'shared'], JOBS, { okTap: false });
  assert.deepEqual(r.opened, []);
  assert.deepEqual(r.sent, ['b', 'c']);
  assert.match(r.said[0], /Alfa/);
});

test('⚠️ a blocked window is not counted as sent, and is named', async () => {
  const r = await batch(['blocked', 'opened', 'opened']);
  assert.deepEqual(r.sent, ['b', 'c']);
  assert.match(r.said[0], /Alfa/);
});

test('one grouped chat: cancelled sends nothing and names nobody', async () => {
  const r = await batch(['cancelled'], [{ ids: ['a', 'b'], text: 't' }]);
  assert.deepEqual(r.sent, []);
  assert.deepEqual(r.said, []);
});

test('settleOnce and afterShare keep their meaning', () => {
  const answers = [];
  const done = settleOnce(v => answers.push(v));
  assert.equal(done('skipped'), true);
  assert.equal(done('shared'), false, 'a late «shared» never counts');
  assert.deepEqual(answers, ['skipped']);
  assert.equal(afterShare('shared'), 'shared');
  assert.equal(afterShare('cancelled'), 'again');
  assert.equal(afterShare('failed'), 'failed');
});

// ── ⚠️ no format question any more ─────────────────────────────────────────────────

const chooser = read('js/orders/send-chooser.js');
const editor = read('js/orders/send-editor.js');

test('⚠️ «photo or text?» and «the photo is ready» are gone, code and words', () => {
  for (const src of [chooser, editor]) {
    assert.ok(!/askFormat|photoDialog|sendFormat\.(title|photo|text|shareFor|shareReady|share)'/.test(src));
  }
  const i18n = read('js/i18n.js');
  for (const k of ['title', 'photo', 'text', 'shareFor', 'shareReady', 'share']) {
    assert.ok(!i18n.includes(`'orders.sendFormat.${k}'`), `orders.sendFormat.${k} left in a dictionary`);
  }
  assert.ok(!/send-route-primary/.test(read('tokens.css')), 'its button style went with it');
});

test('every road that hands the order over goes through the editor: both WhatsApp roads and email', () => {
  assert.equal((chooser.match(/viaEditor\(/g) || []).length, 3, 'definition + the grouped chat + per supplier');
  assert.match(chooser, /return viaEditor\(jobs, \{ photo: offer\.route !== 'email' \}\)/, 'email: the editor, never a picture');
  assert.match(chooser, /const pictures = photo && canSharePhotos\(\)/, 'no share sheet for files: the text road');
  assert.match(chooser, /open: edited => openTab\(whatsappUrl\(edited\)\)/, 'the link is built from the EDITED text');
  assert.match(chooser, /encodeURIComponent\(edited\)/);
  assert.match(chooser, /mailto\(supplier\.email, emailSubject\(locationName, language\), edited\)/);
});

test('⚠️ the share starts INSIDE the click handler, with no await before it — and the file says why', () => {
  const handler = editor.slice(editor.indexOf("sendBtn.addEventListener('click'"), editor.indexOf("otherBtn.addEventListener('click'"));
  assert.match(handler, /sharePhoto\(file\)/);
  assert.ok(!/await/.test(handler.slice(0, handler.indexOf('sharePhoto('))));
  assert.match(editor, /navigator\.share\(\) NEEDS A FRESH TAP/);
});

test('the dialog is named by its title, traps Tab over the box too, and gives focus back', () => {
  const shell = editor.slice(editor.indexOf('export function modalShell'), editor.indexOf('// Settle a dialog'));
  assert.match(shell, /'aria-labelledby': titleId/);
  assert.match(shell, /role: 'dialog', 'aria-modal': 'true'/);
  assert.match(shell, /e\.key === 'Escape'/);
  assert.match(shell, /querySelectorAll\('textarea'\), \.\.\.box\.querySelectorAll\('button:not\(\[disabled\]\)'\)/);
  assert.match(shell, /prevFocus\.focus\(\)/);
});

test('the new words exist in both languages, Italian in the house style', async () => {
  const d = (await import('../js/i18n.js'))._dictionaries();
  for (const k of ['titleOne', 'titleOf', 'titleGrouped', 'preview', 'edit', 'hint', 'send']) {
    assert.ok(d.en[`orders.sendEditor.${k}`] && d.it[`orders.sendEditor.${k}`], k);
  }
  assert.equal(d.it['orders.sendEditor.send'], 'Invia');
  assert.equal(d.en['orders.sendEditor.send'], 'Send');
  assert.equal(d.it['orders.supplierSend'], 'Invia');
  assert.equal(d.it['orders.sendEditor.titleOf'], 'Ordine per {name} ({i} di {n})');
});
