// Tests for the send editor's pure half (P15), ported from tests/send-editor.test.mjs of `main` (v1.145.0).
//
// NOT PAIRED in parity.spec.ts YET: the original, js/orders/send-editor.js, exists only on `main` (PRs #551 and #554), not
// on this branch. When `main` is merged into the Mise 2 branch, turn the describes below into a describe.each over this
// port and the js/ file (it needs a DOM to import: use the fake of tests/helpers/form-dom.mjs). send-editor.ts is PARTIAL
// (it leaves out `modalShell` and `sendEditorDialog`, the DOM) and ADAPTED (`editorTitle` and `runSendBatch` take the
// translator; `runSendBatch` also reports `blocked`).
//
// PORTED: the four picturePrep tests, previewLines + editorTitle, and the seven runSendBatch tests (one editor per message,
// skip, cancel, failed + OK, failed + Cancel, blocked window, one grouped chat). NEW: the `blocked` rule.
//
// NOT PORTED: the 13 tests that drive the dialog in a fake DOM (shown message, bold preview, text road, discard question,
// Escape, share sheet, email preview...) — the dialog is React in Mise 2 and gets its own component spec; `settleOnce` and
// `afterShare` (tested in send-chooser.spec.ts); the source-reading tests (the share inside the click handler, the words,
// «photo or text?» gone, every road through the editor).

import { describe, expect, test } from 'vitest';
import { editorTitle, picturePrep, previewLines, runSendBatch } from './send-editor';
import type { EditorAnswer, EditorJob, EditorOutcome } from './send-editor';

declare function setTimeout(fn: () => void, ms: number): unknown;

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// The current app's English words for the keys the port is handed, so the assertions read as the original's did.
const WORDS: Record<string, (v: Record<string, unknown>) => string> = {
  'orders.sendEditor.titleGrouped': () => 'Check the order',
  'orders.sendEditor.titleOne': v => `Order for ${String(v.name)}`,
  'orders.sendEditor.titleOf': v => `Order for ${String(v.name)} (${String(v.i)} of ${String(v.n)})`,
  'orders.sendFormat.notSent': v => `Not sent: ${String(v.names)}`,
};
const t = (key: string, vars: Record<string, unknown> = {}) => (WORDS[key] ? WORDS[key](vars) : key);

// ── the picture keeper, with its own clock ──────────────────────────────────────

function clock() {
  let next = 0;
  const due = new Map<number, () => void>();
  return {
    setTimer: (fn: () => void) => { const id = ++next; due.set(id, fn); return id; },
    clearTimer: (id: number) => { due.delete(id); },
    run() { const fns = [...due.values()]; due.clear(); fns.forEach(fn => fn()); },
    pending: () => due.size,
  };
}

describe('picturePrep', () => {
  test('drawn at once, redrawn after the pause, never ready for a text that is not in the box', async () => {
    const c = clock();
    const drawn: string[] = [];
    const prep = picturePrep({ render: async (text: string) => { drawn.push(text); return `file:${text}`; }, setTimer: c.setTimer, clearTimer: c.clearTimer });
    prep.update('a', { now: true });
    await wait(0);
    expect(prep.ready('a')).toBe('file:a');
    prep.update('ab');
    prep.update('abc');
    expect(c.pending()).toBe(1);
    expect(prep.ready('abc')).toBeNull();
    expect(prep.ready('a')).toBeNull();
    c.run();
    await wait(0);
    expect(drawn).toStrictEqual(['a', 'abc']);
    expect(prep.ready('abc')).toBe('file:abc');
    prep.update('a');
    expect(prep.ready('a')).toBeNull();
  });

  test('⚠️ a typo deleted while its picture is being drawn leaves «Invia» ready (review, 14 Nov 2026)', async () => {
    const c = clock();
    const finish: Record<string, () => void> = {};
    const states: unknown[] = [];
    const prep = picturePrep({
      render: (text: string) => new Promise<string>(resolve => { finish[text] = () => resolve(`file:${text}`); }),
      onChange: st => states.push(st), setTimer: c.setTimer, clearTimer: c.clearTimer,
    });
    prep.update('A', { now: true });
    await wait(0); finish.A?.(); await wait(0);
    prep.update('AB');
    c.run();                       // «AB» starts drawing…
    await wait(0);
    prep.update('A');              // …and the typo is deleted before it lands
    finish.AB?.(); await wait(0);
    expect(prep.ready('A')).toBe('file:A');
    expect(states.at(-1)).toStrictEqual({ ready: true, busy: false, failed: false });
  });

  test('an older drawing that finishes late is ignored', async () => {
    const c = clock();
    const finish: Record<string, () => void> = {};
    const prep = picturePrep({
      render: (text: string) => new Promise<string>(resolve => { finish[text] = () => resolve(`file:${text}`); }),
      setTimer: c.setTimer, clearTimer: c.clearTimer,
    });
    prep.update('old', { now: true });
    await wait(0);
    prep.update('new', { now: true });
    await wait(0);
    finish.new?.(); await wait(0);
    finish.old?.(); await wait(0);
    expect(prep.ready('new')).toBe('file:new');
  });

  test('a failed drawing is reported for that text only', async () => {
    const prep = picturePrep({ render: async (text: string) => { if (text === 'bad') throw new Error('x'); return text; } });
    prep.update('bad', { now: true });
    await wait(0);
    expect(prep.failed('bad')).toBe(true);
    prep.update('good', { now: true });
    await wait(0);
    expect(prep.failed('good')).toBe(false);
    expect(prep.ready('good')).toBe('good');
    prep.stop();
  });

  test('the real timer is used when none is handed in, and stop() cancels the pending drawing', async () => {
    const drawn: string[] = [];
    const prep = picturePrep({ render: async (text: string) => { drawn.push(text); return text; }, delay: 5 });
    prep.update('x');
    prep.stop();
    await wait(30);
    expect(drawn).toStrictEqual([]);
    prep.update('y');
    await wait(30);
    expect(drawn).toStrictEqual(['y']);
  });
});

test('previewLines and the title', () => {
  expect(previewLines('*A*\n\nb')).toStrictEqual([[{ text: 'A', bold: true }], [], [{ text: 'b', bold: false }]]);
  expect(editorTitle({ name: 'Bruno' }, t)).toBe('Order for Bruno');
  expect(editorTitle({ name: 'Bruno', i: 1, n: 3 }, t)).toBe('Order for Bruno (2 of 3)');
  expect(editorTitle({}, t)).toBe('Check the order');
});

// ── one editor per message, Skip and Cancel as the photos had them ─────────────────

const JOBS = [
  { ids: ['a'], name: 'Alfa', text: 'ta' },
  { ids: ['b'], name: 'Beta', text: 'tb' },
  { ids: ['c'], name: 'Gamma', text: 'tc' },
];

async function batch(answers: EditorOutcome[], jobs: { ids: string[]; name?: string; text: string }[] = JOBS,
  { okTap = true, windowOpens = true }: { okTap?: boolean; windowOpens?: boolean } = {}) {
  const asked: [string | undefined, number, number][] = [];
  const said: string[] = [];
  const opened: [string | undefined, string][] = [];
  const withOpen: EditorJob[] = jobs.map(j => ({
    ...j, open: (text: string) => { opened.push([j.ids[0], text]); return windowOpens; },
  }));
  const result = await runSendBatch({
    jobs: withOpen,
    ask: async ({ job, i, n }): Promise<EditorAnswer> => {
      asked.push([job.ids[0], i, n]);
      return { outcome: answers[i] ?? 'cancelled', text: `edited ${job.text}` };
    },
    notify: async message => { said.push(message); },
    confirmText: async () => okTap,
    t,
  });
  return { ...result, sent: result.ids, asked, said, opened };
}

describe('runSendBatch', () => {
  test('one editor per message, in turn, each with its number and the total', async () => {
    const r = await batch(['shared', 'opened', 'shared']);
    expect(r.asked).toStrictEqual([['a', 0, 3], ['b', 1, 3], ['c', 2, 3]]);
    expect(r.sent).toStrictEqual(['a', 'b', 'c']);
    expect(r.said).toStrictEqual([]);
    expect(r.blocked).toBe(false);
  });

  test('⚠️ skip: that one is not sent, the next is still asked, and the not-sent one is named', async () => {
    const r = await batch(['shared', 'skipped', 'shared']);
    expect(r.sent).toStrictEqual(['a', 'c']);
    expect(r.said[0]).toMatch(/Beta/);
    expect(r.said[0]).not.toMatch(/Alfa|Gamma/);
  });

  test('⚠️ cancel stops the whole batch: it and everything after are named, none sent', async () => {
    const r = await batch(['shared', 'cancelled', 'shared']);
    expect(r.sent).toStrictEqual(['a']);
    expect(r.asked).toHaveLength(2);
    expect(r.said[0]).toMatch(/Beta/);
    expect(r.said[0]).toMatch(/Gamma/);
  });

  test('⚠️ a failed picture, then OK: THAT supplier’s EDITED text is opened and counted', async () => {
    const r = await batch(['failed', 'shared', 'skipped']);
    expect(r.opened).toStrictEqual([['a', 'edited ta']]);
    expect(r.sent).toStrictEqual(['a', 'b']);
  });

  test('⚠️ a failed picture, then Cancel: nothing opened, nothing counted, named', async () => {
    const r = await batch(['failed', 'shared', 'shared'], JOBS, { okTap: false });
    expect(r.opened).toStrictEqual([]);
    expect(r.sent).toStrictEqual(['b', 'c']);
    expect(r.said[0]).toMatch(/Alfa/);
  });

  test('⚠️ a blocked window is not counted as sent, and is named', async () => {
    const r = await batch(['blocked', 'opened', 'opened']);
    expect(r.sent).toStrictEqual(['b', 'c']);
    expect(r.said[0]).toMatch(/Alfa/);
    expect(r.blocked).toBe(false);
  });

  test('one grouped chat: cancelled sends nothing and names nobody', async () => {
    const r = await batch(['cancelled'], [{ ids: ['a', 'b'], text: 't' }]);
    expect(r.sent).toStrictEqual([]);
    expect(r.said).toStrictEqual([]);
    expect(r.blocked).toBe(false);
  });

  // ── NEW in the port: `blocked`, so Mise 2's «Nothing was opened» survives ─────────

  test('⚠️ every editor ended on a refused window: blocked, and nobody is named a second time', async () => {
    const r = await batch(['blocked', 'blocked', 'blocked']);
    expect(r.sent).toStrictEqual([]);
    expect(r.blocked).toBe(true);
    expect(r.said).toStrictEqual([]);
  });

  test('a failed picture whose text window does not open either counts as refused', async () => {
    const r = await batch(['failed'], [{ ids: ['a'], name: 'Alfa', text: 'ta' }], { windowOpens: false });
    expect(r.blocked).toBe(true);
    expect(r.said).toStrictEqual([]);
  });

  test('one refused window among others that went is NOT blocked', async () => {
    const r = await batch(['blocked', 'opened']);
    expect(r.blocked).toBe(false);
  });

  test('somebody who skipped, cancelled or declined the text is never «blocked»', async () => {
    expect((await batch(['blocked', 'skipped', 'blocked'])).blocked).toBe(false);
    expect((await batch(['blocked', 'cancelled', 'blocked'])).blocked).toBe(false);
    expect((await batch(['failed'], [{ ids: ['a'], name: 'Alfa', text: 'ta' }], { okTap: false })).blocked).toBe(false);
  });

  test('no jobs: nothing asked, nothing sent, not blocked', async () => {
    const r = await batch([], []);
    expect(r).toMatchObject({ ids: [], blocked: false, said: [] });
  });
});
