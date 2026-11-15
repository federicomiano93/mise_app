// The pure half of the send editor (sendEditor.ts), re-stated from the current app's tests/send-editor.test.mjs (PR #554).

import { describe, expect, it } from 'vitest';
import type { Translate } from '@mise/shared/send-chooser';
import { picturePrep, previewLines, runSendBatch } from './sendEditor';
import type { EditAnswer, EditJob, EditQuestion, PictureState } from './sendEditor';

const t: Translate = (key, vars) => (key === 'orders.sendFormat.notSent' ? `Not sent: ${String(vars?.names)}` : key);

describe('previewLines — the message as WhatsApp draws it', () => {
  it('draws *bold* bold, one entry per line, an empty line as []', () => {
    expect(previewLines('*Mill*\n\n- Flour: 2')).toStrictEqual([
      [{ text: 'Mill', bold: true }], [], [{ text: '- Flour: 2', bold: false }],
    ]);
  });
  it('the email road shows the asterisks as they are', () => {
    expect(previewLines('*Mill*', true)).toStrictEqual([[{ text: '*Mill*', bold: false }]]);
  });
});

describe('picturePrep — the picture always matches the box', () => {
  function harness(render: (text: string) => Promise<File> = async text => new File([text], 'p.png')) {
    let pending: (() => void) | null = null;
    const states: PictureState[] = [];
    const prep = picturePrep({ render, onChange: state => { states.push(state); }, setTimer: fn => { pending = fn; return 1; }, clearTimer: () => { pending = null; } });
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));
    return { prep, states, flush, pause: () => { const run = pending; pending = null; run?.(); } };
  }

  it('draws at once from the text as it opens, and «Send» may go once it is ready', async () => {
    const h = harness();
    h.prep.update('a', { now: true });
    expect(h.prep.ready('a')).toBeNull();
    await h.flush();
    expect(await h.prep.ready('a')?.text()).toBe('a');
    expect(h.states.at(-1)).toStrictEqual({ ready: true, busy: false, failed: false });
  });

  it('⚠️ what goes is drawn from the EDITED text: an old picture is never handed out for a changed box', async () => {
    const h = harness();
    h.prep.update('a', { now: true });
    await h.flush();
    h.prep.update('a + salt');
    expect(h.prep.ready('a + salt')).toBeNull();
    expect(h.prep.ready('a')).toBeNull();
    expect(h.states.at(-1)?.busy).toBe(true);
    h.pause();
    await h.flush();
    expect(await h.prep.ready('a + salt')?.text()).toBe('a + salt');
  });

  it('a drawing that finishes late, for a text typed over since, is never used', async () => {
    let release: (file: File) => void = () => undefined;
    const h = harness(text => (text === 'slow' ? new Promise<File>(resolve => { release = resolve; }) : Promise.resolve(new File([text], 'p.png'))));
    h.prep.update('slow', { now: true });
    await h.flush();
    h.prep.update('fast', { now: true });
    await h.flush();
    release(new File(['slow'], 'p.png'));
    await h.flush();
    expect(await h.prep.ready('fast')?.text()).toBe('fast');
  });

  it('a picture that cannot be drawn says so: «Send» then falls back to the text', async () => {
    const error = console.error;
    console.error = () => undefined;
    try {
      const h = harness(() => Promise.reject(new Error('no canvas')));
      h.prep.update('a', { now: true });
      await h.flush();
      expect(h.prep.failed('a')).toBe(true);
      expect(h.states.at(-1)).toStrictEqual({ ready: false, busy: false, failed: true });
    } finally {
      console.error = error;
    }
  });
});

describe('runSendBatch — one editor after the other', () => {
  const job = (id: string, name?: string): EditJob => ({
    ids: [id], ...(name ? { name } : {}), text: id, url: `https://wa.me/${id}`, link: text => `https://wa.me/${id}?text=${text}`, plain: false,
  });
  const jobs = [job('a', 'Alpha'), job('b', 'Beta'), job('c', 'Gamma')];
  function run(answers: Record<string, EditAnswer['outcome']>, over: { open?: (url: string) => boolean; confirmText?: () => Promise<boolean>; photo?: boolean } = {}) {
    const said: string[] = [];
    const asked: EditQuestion[] = [];
    const opened: string[] = [];
    const pending = runSendBatch({
      jobs, photo: over.photo ?? false, t,
      ask: async question => { asked.push(question); return { outcome: answers[question.job.ids[0]!] ?? 'opened', text: `${question.job.text}!` }; },
      open: over.open ?? (url => { opened.push(url); return true; }),
      notify: async message => { said.push(message); },
      confirmText: over.confirmText ?? (async () => true),
    });
    return { pending, said, asked, opened };
  }

  it('asks each one in turn with «i of n», and counts what was shared or opened', async () => {
    const r = run({ a: 'shared', b: 'opened', c: 'shared' });
    expect(await r.pending).toStrictEqual({ ids: ['a', 'b', 'c'], blocked: false, handOff: 'share' });
    expect(r.asked.map(q => [q.i, q.n])).toStrictEqual([[0, 3], [1, 3], [2, 3]]);
  });

  it('Skip leaves that one unsent, names it and carries on', async () => {
    const r = run({ b: 'skipped' });
    expect((await r.pending).ids).toStrictEqual(['a', 'c']);
    expect(r.said).toStrictEqual(['Not sent: Beta']);
  });

  it('Cancel stops the batch and names the one it stopped at and every one after it', async () => {
    const r = run({ a: 'shared', b: 'cancelled' });
    expect((await r.pending).ids).toStrictEqual(['a']);
    expect(r.asked).toHaveLength(2);
    expect(r.said).toStrictEqual(['Not sent: Beta, Gamma']);
  });

  it('a failed picture asks before the text goes: OK opens THIS message’s EDITED text, Cancel leaves it unsent', async () => {
    const ok = run({ a: 'failed', b: 'skipped', c: 'skipped' });
    expect((await ok.pending).ids).toStrictEqual(['a']);
    expect(ok.opened).toStrictEqual(['https://wa.me/a?text=a!']);
    const no = run({ a: 'failed', b: 'skipped', c: 'skipped' }, { confirmText: async () => false });
    expect((await no.pending).ids).toStrictEqual([]);
    expect(no.said).toStrictEqual(['Not sent: Alpha, Beta, Gamma']);
  });

  it('every window blocked is «blocked», with no second notice', async () => {
    const r = run({ a: 'blocked', b: 'blocked', c: 'blocked' });
    expect(await r.pending).toStrictEqual({ ids: [], blocked: true, handOff: 'text' });
    expect(r.said).toStrictEqual([]);
  });

  it('the question carries whether it goes as a picture, and an `open` that opens the edited text', async () => {
    const r = run({}, { photo: true });
    await r.pending;
    expect(r.asked[0]!.photo).toBe(true);
    r.asked[0]!.open('edited');
    expect(r.opened.at(-1)).toBe('https://wa.me/a?text=edited');
  });
});
