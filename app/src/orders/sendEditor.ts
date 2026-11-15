// sendEditor.ts — the pure half of the in-app send editor (the current app's js/orders/send-editor.js, PR #554, v1.145.0): what the
// preview draws, the picture kept in step with the box, and one editor after the other for a send. The dialog is SendEditorDialog.tsx;
// the road around it is sendFlow.ts takeRoad. Not paired with the original: the stack's js/ predates it.
//
// ⚠️⚠️ WHY IT EXISTS (owner, 14 Nov 2026). An order reached a supplier with a product missing and nobody noticed before sending: the
// old road asked «photo or text?», then «the photo is ready», and nobody ever SAW what the supplier would receive. Now every road that
// hands an order over shows the message exactly as buildOrderMessage wrote it — *bold* drawn bold, as WhatsApp draws it — in a box
// that can be corrected before it goes. ⚠️ AN EDIT CHANGES ONLY THE MESSAGE: what «did it go?» records are the quantities of the order.
//
// ⚠️⚠️ navigator.share() NEEDS A FRESH TAP: it must be CALLED inside the press, with no await before it. So the picture is drawn AHEAD
// of the tap, from the text in the box, and drawn again (debounced) while the person types; «Send» waits until the picture matches the
// box, and its press hands the READY File to the share sheet at once (picturePrep). A text road opens its link inside the press too.

import { parseBold } from '@mise/shared/order-image';
import type { Run } from '@mise/shared/order-image';
import type { SendJob, Translate } from '@mise/shared/send-chooser';

export const RENDER_DELAY_MS = 350;

// The text as WhatsApp shows it: one entry per line, each a list of runs (the picture draws the very same runs). An empty line is [].
// `plain` is the email road: a mail app shows the asterisks as they are, so the preview does too.
export function previewLines(text: string, plain = false): Run[][] {
  return String(text || '').split('\n').map(line => {
    if (!line) return [];
    return plain ? [{ text: line, bold: false }] : parseBold(line);
  });
}

export interface PictureState {
  // A picture of exactly the text in the box is ready.
  readonly ready: boolean;
  // A picture is being drawn (or waits for the pause) for the text in the box.
  readonly busy: boolean;
  // Drawing the text in the box failed: «Send» falls back to the text road.
  readonly failed: boolean;
}

export interface PicturePrep {
  // The box changed: draw again after the pause (at once with `now`).
  update(text: string, options?: { now?: boolean }): void;
  // The File drawn from exactly this text, or null (stale, still drawing, failed).
  ready(text: string): File | null;
  failed(text: string): boolean;
  stop(): void;
}

// Keeps a picture that matches the box. Pure over its timers and its drawing function, so «what goes is drawn from the EDITED text» is
// proved without a canvas. `onChange` after every step.
export function picturePrep({ render, delay = RENDER_DELAY_MS, onChange = () => undefined,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => { clearTimeout(id as ReturnType<typeof setTimeout>); } }: {
  render: (text: string) => Promise<File>;
  delay?: number;
  onChange?: (state: PictureState) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}): PicturePrep {
  let wanted: string | null = null;
  let drawn: { text: string; file: File } | null = null;
  let broken: string | null = null;
  let timer: unknown = null;
  let seq = 0;

  const state = (): PictureState => ({
    ready: drawn !== null && drawn.text === wanted,
    busy: wanted !== null && (drawn === null || drawn.text !== wanted) && broken !== wanted,
    failed: broken !== null && broken === wanted,
  });

  function draw(text: string) {
    const mine = ++seq;
    Promise.resolve().then(() => render(text)).then(file => {
      if (mine !== seq) return; // an older drawing finishing late is never used
      drawn = { text, file };
      broken = null;
      onChange(state());
    }, (err: unknown) => {
      if (mine !== seq) return;
      console.error('Drawing the order picture failed:', err);
      broken = text;
      onChange(state());
    });
  }

  return {
    update(text, { now = false } = {}) {
      wanted = text;
      if (timer !== null) clearTimer(timer);
      timer = null;
      // Back to the text already drawn: that picture is the one, and a drawing still running for the text typed in between must not
      // replace it when it lands (it would leave «Send» off with nothing left to draw — found in the current app's review).
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

// One message of a send, with the link its EDITED text opens (wa.me / mailto). `plain`: the email road (no bold in the preview).
export interface EditJob extends SendJob {
  readonly link: (text: string) => string;
  readonly plain: boolean;
}

// How one editor ended:
//   'shared'    — the share sheet took the picture
//   'opened'    — the text road's window opened
//   'blocked'   — the text road's window did not open: not sent
//   'failed'    — the picture could not be drawn or shared: the batch offers the text instead
//   'skipped'   — «Skip» (several in a row): not sent, carry on
//   'cancelled' — «Cancel», Escape: not sent, and nothing after it either
export type EditOutcome = 'shared' | 'opened' | 'blocked' | 'failed' | 'skipped' | 'cancelled';
export interface EditAnswer {
  readonly outcome: EditOutcome;
  readonly text: string;
  // Opening the window threw (not «blocked»: something broke). The batch rethrows it, so the screen says its friendly line.
  readonly error?: unknown;
}

// What one editor is asked: the job, where it is in the batch, whether it goes as a picture, and how its text road opens.
export interface EditQuestion {
  readonly job: EditJob;
  readonly i: number;
  readonly n: number;
  readonly photo: boolean;
  // Opens THIS job's window for the edited text, inside the press; answers whether the browser really opened one.
  readonly open: (text: string) => boolean;
}

export interface SendBatch {
  readonly jobs: readonly EditJob[];
  readonly photo: boolean;
  readonly ask: (question: EditQuestion) => Promise<EditAnswer>;
  readonly open: (url: string) => boolean;
  readonly notify: (message: string) => Promise<unknown>;
  // «Couldn't share the photo, sending the text instead.» — OK / Cancel.
  readonly confirmText: () => Promise<boolean>;
  readonly t: Translate;
}

// One editor at a time, for every message of a send:
//   shared / opened → sent
//   skipped / blocked → not sent, carry on
//   cancelled → not sent, and so is everything after it
//   failed → asks OK/Cancel; on OK THIS message's (edited) text is opened and counted only if the window really opened
// Whoever was not sent is named afterwards (suppliers only: the grouped chat has no name). `blocked` is true only when every window
// was due and the browser refused them all. `handOff` says how the LAST message left: 'share' (the share sheet answered, the person is
// already back here) or 'text' (a window opened, the page is about to leave).
export async function runSendBatch({ jobs, photo, ask, open, notify, confirmText, t }: SendBatch):
  Promise<{ ids: string[]; blocked: boolean; handOff: 'share' | 'text' }> {
  const sent: string[] = [];
  const notSent: EditJob[] = [];
  let refused = 0;
  let declined = false;
  let handOff: 'share' | 'text' = 'text';
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    if (!job) continue;
    const answer = await ask({ job, i, n: jobs.length, photo, open: edited => open(job.link(edited)) });
    if (answer.error !== undefined) throw answer.error instanceof Error ? answer.error : new Error(String(answer.error));
    const { outcome, text } = answer;
    if (outcome === 'shared') { sent.push(...job.ids); handOff = 'share'; continue; }
    if (outcome === 'opened') { sent.push(...job.ids); handOff = 'text'; continue; }
    if (outcome === 'failed') {
      if (await confirmText() && open(job.link(text))) { sent.push(...job.ids); handOff = 'text'; }
      else { notSent.push(job); declined = true; }
      continue;
    }
    notSent.push(job);
    if (outcome === 'blocked') { refused += 1; continue; }
    declined = true;
    if (outcome === 'cancelled') { notSent.push(...jobs.slice(i + 1)); break; }
  }
  const blocked = jobs.length > 0 && sent.length === 0 && !declined && refused === jobs.length;
  // Every window refused by the browser: the screen says «Nothing was opened» with what to do, so no second notice names them.
  const names = blocked ? [] : notSent.map(job => job.name).filter((name): name is string => Boolean(name));
  if (names.length) await notify(t('orders.sendFormat.notSent', { names: names.join(', ') }));
  return { ids: sent, blocked, handOff };
}
