// send-editor.js — «this is what the supplier will get», editable, with ONE button: «Invia».
//
// ⚠️⚠️ WHY IT EXISTS (owner, 14 Nov 2026). An order reached a supplier with a product missing and
// nobody noticed before sending: the old road asked «photo or text?», then «the photo is ready»,
// and nobody ever SAW what the supplier would receive. Now every road that hands an order to
// WhatsApp (or opens the mail app) shows the message exactly as buildOrderMessage wrote it —
// *bold* drawn bold, as WhatsApp draws it — in a labelled box that can be corrected before it goes.
//
// ⚠️ AN EDIT CHANGES ONLY THE MESSAGE. History keeps the quantities that were confirmed (the
// owner's decision): the box is the words, not the order.
//
// ⚠️⚠️ navigator.share() NEEDS A FRESH TAP (Safari and Chrome both): it must be CALLED inside the
// click handler, with no await before it — a share started after a promise, a timer or a
// rendering step is refused. So the picture is drawn AHEAD of the tap, from the text in the box,
// and drawn again (debounced) while the person types; «Invia» is held disabled until the picture
// matches the box, and its click hands the READY File to sharePhoto synchronously.
// The text roads (no share sheet for files, or email) need no picture: their click opens the
// link, also synchronously, so window.open stays inside the tap.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { parseBold, sharePhoto } from './order-image.js';

const RENDER_DELAY_MS = 350;

// The dialog's title: a supplier's name (with «2 of 3» when several go one after the other), or —
// for the one grouped chat that has no single supplier — a plain «check the order».
export function editorTitle({ name, i = 0, n = 1 }) {
  if (!name) return t('orders.sendEditor.titleGrouped');
  return n > 1 ? t('orders.sendEditor.titleOf', { name, i: i + 1, n }) : t('orders.sendEditor.titleOne', { name });
}

// The text as WhatsApp shows it: one entry per line, each a list of { text, bold } runs
// (order-image.js parseBold — the picture draws the very same runs). An empty line is [].
export function previewLines(text) {
  return String(text || '').split('\n').map(line => (line ? parseBold(line) : []));
}

// Keeps a picture that matches the box. Pure over its timers and its drawing function, so the
// rule «what goes is drawn from the EDITED text» is proved without a canvas.
//   render(text) → Promise<File>; onChange({ ready, busy, failed }) after every step.
//   update(text): the box changed — draw again after `delay` (at once with `now`).
//   ready(text): the File drawn from exactly this text, or null (stale, still drawing, failed).
//   failed(text): drawing this text failed — the click falls back to the text road.
export function picturePrep({ render, delay = RENDER_DELAY_MS, onChange = () => {},
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) }) {
  let wanted = null;        // the text the box holds now
  let drawn = null;         // { text, file } of the last finished drawing
  let broken = null;        // the text whose drawing failed
  let timer = null;
  let seq = 0;

  const state = () => ({
    ready: drawn !== null && drawn.text === wanted,
    busy: wanted !== null && (drawn === null || drawn.text !== wanted) && broken !== wanted,
    failed: broken !== null && broken === wanted,
  });

  function draw(text) {
    const mine = ++seq;
    Promise.resolve().then(() => render(text)).then(file => {
      if (mine !== seq) return;          // an older drawing finishing late is never used
      drawn = { text, file };
      broken = null;
      onChange(state());
    }, () => {
      if (mine !== seq) return;
      broken = text;
      onChange(state());
    });
  }

  return {
    update(text, { now = false } = {}) {
      wanted = text;
      if (timer !== null) clearTimer(timer);
      timer = null;
      onChange(state());
      if (drawn && drawn.text === text) return;
      if (now) { draw(text); return; }
      timer = setTimer(() => { timer = null; draw(text); }, delay);
    },
    ready(text) { return drawn && drawn.text === text && wanted === text ? drawn.file : null; },
    failed(text) { return broken !== null && broken === text && wanted === text; },
    stop() { if (timer !== null) clearTimer(timer); timer = null; seq++; },
  };
}

let dialogSeq = 0;

// The shell every send question shares: named by its title, Escape cancels, Tab stays inside,
// focus goes back where it was (copied from confirm-dialog.js, which the roads chooser lacks).
// `focus` is the element to start on; the first live button otherwise.
export function modalShell({ title, body, actions, onCancel, boxClass = '', focus = null }) {
  const prevFocus = document.activeElement;
  const titleId = `send-chooser-title-${++dialogSeq}`;
  const heading = el('h2', { class: 'app-dialog-title', id: titleId, text: title, tabindex: '-1' });
  const box = el('div', {
    class: `app-dialog${boxClass ? ` ${boxClass}` : ''}`, role: 'dialog', 'aria-modal': 'true',
    'aria-labelledby': titleId,
  }, [
    heading,
    ...body,
    el('div', { class: 'app-dialog-actions' }, actions),
  ]);
  const overlay = el('div', { class: 'app-dialog-backdrop send-chooser' }, [box]);
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
    if (e.key !== 'Tab') return;
    // The box comes before the buttons in the dialog, so the two lists keep the page's order.
    const focusable = [...box.querySelectorAll('textarea'), ...box.querySelectorAll('button:not([disabled])')];
    if (!focusable.length) { e.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
  const start = focus && !focus.disabled ? focus
    : box.querySelector('.send-route') || box.querySelector('.app-dialog-btn-solid:not([disabled])') || heading;
  start?.focus();
  return {
    heading,
    close() {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (prevFocus && typeof prevFocus.focus === 'function') {
        try { prevFocus.focus(); } catch { /* best effort */ }
      }
    },
  };
}

// Settle a dialog's promise once. A second answer (a share() that resolves after Skip or
// Cancel, or after the dialog moved on) is ignored, so nothing is ever counted twice and an
// order the person skipped stays NOT sent.
export function settleOnce(resolve, cleanup = () => {}) {
  let settled = false;
  return value => {
    if (settled) return false;
    settled = true;
    cleanup();
    resolve(value);
    return true;
  };
}

// What a share() result means for the editor that started it: a resolved share is done; the
// person closing the sheet leaves the editor open (nothing sent, they can retry, skip or
// cancel); anything else is a failure.
export function afterShare(result) {
  return result === 'shared' ? 'shared' : result === 'cancelled' ? 'again' : 'failed';
}

// The preview, drawn with nodes (never innerHTML: the text is whatever was typed).
function fillPreview(node, text) {
  node.replaceChildren(...previewLines(text).map(runs => el('div', { class: 'send-editor-line' },
    runs.length ? runs.map(r => (r.bold ? el('strong', { text: r.text }) : document.createTextNode(r.text)))
      : [el('br')])));
}

// The editor for ONE message. Resolves { outcome, text }:
//   'shared'    — the share sheet took the picture
//   'opened'    — the text road's link opened (job.open answered true)
//   'blocked'   — the text road's window did not open: not sent
//   'failed'    — the picture could not be drawn or shared: the caller offers the text instead
//   'skipped'   — «Salta» (several in a row): not sent, carry on
//   'cancelled' — «Annulla», Escape: not sent, and nothing after it either
// job: { name?, text, open(text) → truthy when it opened }; photo: draw and share a picture.
export function sendEditorDialog({ job, i = 0, n = 1, language = null, photo = false, render }) {
  return new Promise(resolve => {
    let shell = null;
    const n2 = ++dialogSeq;
    const areaId = `send-editor-text-${n2}`;
    const hintId = `send-editor-hint-${n2}`;
    const previewId = `send-editor-preview-label-${n2}`;

    const preview = el('div', { class: 'send-editor-preview', role: 'group', 'aria-labelledby': previewId });
    const area = el('textarea', {
      class: 'send-editor-text', id: areaId, rows: '6', spellcheck: 'false',
      'aria-describedby': hintId,
    });
    area.value = job.text;
    fillPreview(preview, job.text);

    const sendBtn = el('button', { class: 'app-dialog-btn app-dialog-btn-solid', type: 'button',
      text: t('orders.sendEditor.send') });
    const otherBtn = el('button', { class: 'app-dialog-btn app-dialog-btn-ghost', type: 'button',
      text: n > 1 ? t('orders.sendFormat.skip') : t('ui.cancel') });

    // true while the share sheet is open: «Invia» stays off until it answers.
    let sharing = false;
    // Only «Invia» waits: for a non-empty box and, on the picture road, for a picture of THIS text.
    const pictures = photo ? picturePrep({
      render: text => render(text, { language }),
      onChange: s => {
        if (sharing) return;
        sendBtn.disabled = !area.value.trim() || s.busy;
        sendBtn.setAttribute('aria-busy', s.busy ? 'true' : 'false');
      },
    }) : null;

    const onVisible = () => {
      // Back from the share sheet with the promise still pending: let them try again.
      if (document.visibilityState === 'visible' && sharing) {
        sharing = false;
        sendBtn.disabled = !area.value.trim() || !pictures?.ready(area.value);
      }
    };
    const done = settleOnce(resolve, () => {
      pictures?.stop();
      document.removeEventListener('visibilitychange', onVisible);
      shell.close();
    });

    area.addEventListener('input', () => {
      fillPreview(preview, area.value);
      if (pictures) pictures.update(area.value);
      else sendBtn.disabled = !area.value.trim();
    });

    sendBtn.addEventListener('click', () => {
      const text = area.value;
      if (!text.trim()) return;
      if (!pictures) {
        // The text road: the link opens HERE, inside the tap.
        done({ outcome: job.open(text) ? 'opened' : 'blocked', text });
        return;
      }
      if (pictures.failed(text)) { done({ outcome: 'failed', text }); return; }
      const file = pictures.ready(text);
      if (!file) return;               // still drawing: the button is disabled, this is a race
      // ⚠️ NO AWAIT BEFORE THIS LINE — see the note at the top of the file.
      sharing = true;
      sendBtn.disabled = true;
      sharePhoto(file).then(result => {
        const next = afterShare(result);
        if (next === 'again') {
          sharing = false;
          sendBtn.disabled = false;
          sendBtn.focus();
          return;
        }
        done({ outcome: next, text });
      });
    });
    otherBtn.addEventListener('click', () => done({ outcome: n > 1 ? 'skipped' : 'cancelled', text: area.value }));
    document.addEventListener('visibilitychange', onVisible);

    shell = modalShell({
      title: editorTitle({ name: job.name, i, n }),
      boxClass: 'send-editor',
      body: [el('div', { class: 'send-editor-body' }, [
        el('p', { class: 'send-editor-label', id: previewId, text: t('orders.sendEditor.preview') }),
        preview,
        el('label', { class: 'send-editor-label', for: areaId, text: t('orders.sendEditor.edit') }),
        el('p', { class: 'send-editor-hint', id: hintId, text: t('orders.sendEditor.hint') }),
        area,
      ])],
      actions: [otherBtn, sendBtn],
      onCancel: () => done({ outcome: 'cancelled', text: area.value }),
      focus: sendBtn,
    });
    if (pictures) pictures.update(area.value, { now: true });
    else sendBtn.disabled = !area.value.trim();
    // Drawing started disabled the button: start on the title rather than on nothing.
    if (sendBtn.disabled) shell.heading.focus();
  });
}

// One editor at a time, for every message of a send. `ask({ job, i, n })` is the editor.
//   shared / opened → sent
//   skipped / blocked → not sent, carry on
//   cancelled → not sent, and so is everything after it
//   failed → ask OK/Cancel; on OK THIS message's (edited) text is opened and counted as sent
//            only if the window really opened; Cancel or Escape = not sent, carry on
// Returns the ids that were sent. Who was not sent is named afterwards (suppliers only: the
// single grouped chat has no name to give).
export async function runSendBatch({ jobs, ask, notify, confirmText }) {
  const sent = [];
  const notSent = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const { outcome, text } = await ask({ job, i, n: jobs.length });
    if (outcome === 'shared' || outcome === 'opened') { sent.push(...job.ids); continue; }
    if (outcome === 'failed') {
      if (await confirmText() && job.open(text)) sent.push(...job.ids);
      else notSent.push(job);
      continue;
    }
    notSent.push(job);
    if (outcome === 'cancelled') { notSent.push(...jobs.slice(i + 1)); break; }
  }
  const names = notSent.map(j => j.name).filter(Boolean);
  if (names.length) await notify(t('orders.sendFormat.notSent', { names: names.join(', ') }));
  return sent;
}
