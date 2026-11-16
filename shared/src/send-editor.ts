// send-editor.ts — the PURE half of js/orders/send-editor.js (v1.145.0, on main only): what the send editor shows and
// how a batch of editors is run. TypeScript PARTIAL, partly ADAPTED port for Mise 2.
//
// «this is what the supplier will get», editable, with ONE button: «Invia». ⚠️⚠️ WHY IT EXISTS (owner, 14 Nov 2026): an
// order reached a supplier with a product missing and nobody noticed before sending, because nobody ever SAW what the
// supplier would receive. Now every road that hands an order over shows the message exactly as buildOrderMessage wrote it.
//
// ⚠️ AN EDIT CHANGES ONLY THE MESSAGE. History keeps the quantities that were confirmed: the box is the words, not the order.
//
// ⚠️⚠️ navigator.share() NEEDS A FRESH TAP: it must be CALLED inside the click handler, with no await before it. So the
// picture is drawn AHEAD of the tap, from the text in the box, and drawn again (debounced) while the person types
// (`picturePrep`); «Invia» is held disabled until the picture matches the box.
//
// LEFT OUT: `modalShell` and `sendEditorDialog` (the DOM; in Mise 2 the editor is a React dialog on the shared Dialog),
// `settleOnce` and `afterShare` (already in send-chooser.ts).
//
// ADAPTED: `editorTitle` and `runSendBatch` take the translate function as an argument (the original reads its own
// dictionary), with the original's keys (`orders.sendEditor.title*`, `orders.sendFormat.notSent`); the app maps them to
// its own words, as sendFlow.ts does for SEND_KEYS. `runSendBatch` also reports `blocked` — see there.

import { parseBold } from './order-image';
import type { Run } from './order-image';

// shared/ compiles without DOM or Node types: the two timers are declared, as history-window.ts does for console.
declare function setTimeout(fn: () => void, ms: number): unknown;
declare function clearTimeout(id: unknown): void;

export type Translate = (key: string, vars?: Record<string, unknown>) => string;

const RENDER_DELAY_MS = 350;

// The dialog's title: a supplier's name (with «2 of 3» when several go one after the other), or —
// for the one grouped chat that has no single supplier — a plain «check the order».
export function editorTitle({ name, i = 0, n = 1 }: { name?: string; i?: number; n?: number }, t: Translate): string {
  if (!name) return t('orders.sendEditor.titleGrouped');
  return n > 1 ? t('orders.sendEditor.titleOf', { name, i: i + 1, n }) : t('orders.sendEditor.titleOne', { name });
}

// The text as WhatsApp shows it: one entry per line, each a list of { text, bold } runs
// (order-image parseBold — the picture draws the very same runs). An empty line is [].
export function previewLines(text: unknown): Run[][] {
  return String(text || '').split('\n').map(line => (line ? parseBold(line) : []));
}

export interface PictureState { ready: boolean; busy: boolean; failed: boolean }

export interface PicturePrep<F> {
  update(text: string, options?: { now?: boolean }): void;
  ready(text: string): F | null;
  failed(text: string): boolean;
  stop(): void;
}

// Keeps a picture that matches the box. Pure over its timers and its drawing function, so the
// rule «what goes is drawn from the EDITED text» is proved without a canvas.
//   render(text) → Promise<File>; onChange({ ready, busy, failed }) after every step.
//   update(text): the box changed — draw again after `delay` (at once with `now`).
//   ready(text): the File drawn from exactly this text, or null (stale, still drawing, failed).
//   failed(text): drawing this text failed — the click falls back to the text road.
export function picturePrep<F, T = unknown>({ render, delay = RENDER_DELAY_MS, onChange = () => {},
  setTimer = (fn, ms) => setTimeout(fn, ms) as T, clearTimer = id => clearTimeout(id) }: {
  render: (text: string) => F | Promise<F>;
  delay?: number;
  onChange?: (state: PictureState) => void;
  setTimer?: (fn: () => void, ms: number) => T;
  clearTimer?: (id: T) => void;
}): PicturePrep<F> {
  let wanted: string | null = null;                     // the text the box holds now
  let drawn: { text: string; file: F } | null = null;   // the last finished drawing
  let broken: string | null = null;                     // the text whose drawing failed
  let timer: T | null = null;
  let seq = 0;

  const state = (): PictureState => ({
    ready: drawn !== null && drawn.text === wanted,
    busy: wanted !== null && (drawn === null || drawn.text !== wanted) && broken !== wanted,
    failed: broken !== null && broken === wanted,
  });

  function draw(text: string): void {
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
      // Back to the text already drawn: that picture is the one, and a drawing still running for
      // the text typed in between must not replace it when it lands (it would leave «Invia» off
      // with nothing left to draw — found in review, 14 Nov 2026).
      if (drawn && drawn.text === text) { seq++; onChange(state()); return; }
      onChange(state());
      if (now) { draw(text); return; }
      timer = setTimer(() => { timer = null; draw(text); }, delay);
    },
    ready(text) { return drawn && drawn.text === text && wanted === text ? drawn.file : null; },
    failed(text) { return broken !== null && broken === text && wanted === text; },
    stop() { if (timer !== null) clearTimer(timer); timer = null; seq++; },
  };
}

// One message of a send: the suppliers it answers for (ids), its name (none for the one grouped chat) and the text.
// `open(text)` opens the text road's window with the (edited) text and answers whether it really opened.
export interface EditorJob {
  readonly ids: string[];
  readonly name?: string;
  readonly text: string;
  open(text: string): boolean;
  readonly plain?: boolean;
}

export type EditorOutcome = 'shared' | 'opened' | 'blocked' | 'failed' | 'skipped' | 'cancelled';

export interface EditorAnswer { outcome: EditorOutcome; text: string }

// One editor at a time, for every message of a send. `ask({ job, i, n })` is the editor.
//   shared / opened → sent
//   skipped / blocked → not sent, carry on
//   cancelled → not sent, and so is everything after it
//   failed → ask OK/Cancel; on OK THIS message's (edited) text is opened and counted as sent
//            only if the window really opened; Cancel or Escape = not sent, carry on
// Returns the ids that were sent. Who was not sent is named afterwards (suppliers only: the
// single grouped chat has no name to give).
//
// ADAPTED: it also returns `blocked`, true only when messages were due, none was sent, nobody skipped or cancelled and
// every one ended on a window the browser refused (a «blocked» editor, or a failed picture whose text window then did not
// open either). The screen then says «Nothing was opened» with what to do, so — as in runTextBatch — no second notice
// names the suppliers.
export async function runSendBatch<J extends EditorJob = EditorJob>({ jobs, ask, notify, confirmText, t }: {
  jobs: readonly J[];
  ask(question: { job: J; i: number; n: number }): Promise<EditorAnswer>;
  notify(message: string): Promise<void> | void;
  confirmText(): Promise<boolean>;
  t: Translate;
}): Promise<{ ids: string[]; blocked: boolean }> {
  const sent: string[] = [];
  const notSent: J[] = [];
  let refused = 0;
  let declined = false;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    if (!job) continue;
    const { outcome, text } = await ask({ job, i, n: jobs.length });
    if (outcome === 'shared' || outcome === 'opened') { sent.push(...job.ids); continue; }
    if (outcome === 'failed') {
      if (!(await confirmText())) { declined = true; notSent.push(job); continue; }
      if (job.open(text)) sent.push(...job.ids);
      else { notSent.push(job); refused += 1; }
      continue;
    }
    notSent.push(job);
    if (outcome === 'blocked') { refused += 1; continue; }
    declined = true;
    if (outcome === 'cancelled') { notSent.push(...jobs.slice(i + 1)); break; }
  }
  const blocked = jobs.length > 0 && sent.length === 0 && !declined && refused === jobs.length;
  const names = blocked ? [] : notSent.map(j => j.name).filter(Boolean);
  if (names.length) await notify(t('orders.sendFormat.notSent', { names: names.join(', ') }));
  return { ids: sent, blocked };
}
