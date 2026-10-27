// The order in progress kept in step between phones (draftSync.ts): the sync half of js/orders/draft.js. Re-states, against
// the TypeScript data layer with a fake write and a fake clock, the current app's tests of what an autosave sends
// (tests/orders-archive.test.mjs «only changed rows», tests/draft-override.test.mjs) and the traps draft.js records in its
// comments: `pending` over every snapshot, `known` not moved by a failed write, a value retyped while its write is in the air.

import { describe, expect, it } from 'vitest';
import { createDraftSync, SAVE_DELAY_MS } from './draftSync';
import type { DraftPayload } from './draftSync';

function harness({ refuse = false } = {}) {
  const saves: DraftPayload[] = [];
  const results: boolean[] = [];
  let timer: (() => void) | null = null;
  let delay = 0;
  const pendingSaves: Array<{ resolve: () => void; reject: (err: unknown) => void }> = [];
  let hold = false;
  const sync = createDraftSync({
    save: payload => {
      saves.push(payload);
      if (hold) return new Promise<void>((resolve, reject) => { pendingSaves.push({ resolve, reject }); });
      return refuse ? Promise.reject(new Error('permission-denied')) : Promise.resolve();
    },
    nowIso: () => '2026-10-26T10:00:00.000Z',
    setTimer: (run, ms) => { timer = run; delay = ms; return 1; },
    clearTimer: () => { timer = null; },
    onResult: ok => { results.push(ok); },
  });
  const tick = async () => {
    const run = timer;
    timer = null;
    run?.();
    // Let the write and its .then/.finally settle.
    await new Promise(resolve => setTimeout(resolve, 0));
  };
  return {
    sync, saves, results, tick,
    armed: () => timer !== null,
    delay: () => delay,
    holdSaves: () => { hold = true; },
    pendingSaves,
  };
}

describe('draftSync — what an autosave sends', () => {
  it('waits 800 ms after the last change and sends ONE write for a burst of typing (P14)', async () => {
    const h = harness();
    h.sync.receive({ entries: {}, days: {} });
    h.sync.change({ a: { qty: 1, stock: 0 } }, {});
    h.sync.change({ a: { qty: 12, stock: 0 } }, {});
    expect(h.delay()).toBe(SAVE_DELAY_MS);
    expect(h.saves).toHaveLength(0);
    await h.tick();
    expect(h.saves).toEqual([{ updatedAt: '2026-10-26T10:00:00.000Z', entries: { a: { qty: 12, stock: 0 } } }]);
    expect(h.results).toEqual([true]);
  });

  it('⚠️ sends ONLY the lines this phone changed: a colleague\'s line is never re-asserted at a stale value', async () => {
    const h = harness();
    h.sync.receive({ entries: { a: { qty: 2, stock: 0 }, b: { qty: 5, stock: 1 } }, days: { s1: '2026-10-26' } });
    h.sync.change({ a: { qty: 3, stock: 0 }, b: { qty: 5, stock: 1 } }, { s1: '2026-10-26' });
    await h.tick();
    expect(h.saves[0]).toEqual({ updatedAt: '2026-10-26T10:00:00.000Z', entries: { a: { qty: 3, stock: 0 } } });
  });

  it('looking at a supplier stores nothing: a blank line the document never had is not a change', async () => {
    const h = harness();
    h.sync.receive(null);
    h.sync.change({ a: { qty: 0, stock: 0 } }, {});
    await h.tick();
    expect(h.saves).toEqual([]);
  });

  it('a line taken DOWN to zero is a real change, and so is a stock-only change', async () => {
    const h = harness();
    h.sync.receive({ entries: { a: { qty: 4, stock: 0 }, b: { qty: 0, stock: 0 } } });
    h.sync.change({ a: { qty: 0, stock: 0 }, b: { qty: 0, stock: 6 } }, {});
    await h.tick();
    expect(h.saves[0]?.entries).toEqual({ a: { qty: 0, stock: 0 }, b: { qty: 0, stock: 6 } });
  });

  it('⚠️ sends unit: \'\' and supplierId: \'\' to CLEAR them (a merge write cannot delete a nested key)', async () => {
    const h = harness();
    h.sync.receive({ entries: { a: { qty: 2, stock: 0, unit: 'busta', supplierId: 'other' } } });
    h.sync.change({ a: { qty: 0, stock: 0, unit: '', supplierId: '' } }, {});
    await h.tick();
    expect(h.saves[0]?.entries).toEqual({ a: { qty: 0, stock: 0, unit: '', supplierId: '' } });
  });

  it('sends a changed day stamp, and only that one', async () => {
    const h = harness();
    h.sync.receive({ entries: {}, days: { s1: '2026-10-20', s2: '2026-10-26' } });
    h.sync.change({ a: { qty: 1, stock: 0 } }, { s1: '2026-10-26', s2: '2026-10-26' });
    await h.tick();
    expect(h.saves[0]?.days).toEqual({ s1: '2026-10-26' });
  });
});

describe('draftSync — two phones in one document', () => {
  it('⚠️ a snapshot from another phone during the debounce does NOT erase what this phone just typed', () => {
    const h = harness();
    h.sync.receive({ entries: { a: { qty: 1, stock: 0 } } });
    h.sync.change({ a: { qty: 7, stock: 0 } }, {});
    // Another phone writes line b before this phone's autosave went out.
    const view = h.sync.receive({ entries: { a: { qty: 1, stock: 0 }, b: { qty: 3, stock: 0 } } });
    expect(view.entries.a).toEqual({ qty: 7, stock: 0 });
    expect(view.entries.b).toEqual({ qty: 3, stock: 0 });
  });

  it('after the write lands, the server owns the line again: a later colleague\'s change shows', async () => {
    const h = harness();
    h.sync.receive({ entries: {} });
    h.sync.change({ a: { qty: 7, stock: 0 } }, {});
    await h.tick();
    const view = h.sync.receive({ entries: { a: { qty: 9, stock: 0 } } });
    expect(view.entries.a).toEqual({ qty: 9, stock: 0 });
  });

  it('⚠️ a value typed AGAIN while its write is in the air stays this phone\'s', async () => {
    const h = harness();
    h.holdSaves();
    h.sync.receive({ entries: {} });
    h.sync.change({ a: { qty: 7, stock: 0 } }, {});
    await h.tick();
    h.sync.change({ a: { qty: 8, stock: 0 } }, {});
    h.pendingSaves[0]?.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    const view = h.sync.receive({ entries: { a: { qty: 7, stock: 0 } } });
    expect(view.entries.a).toEqual({ qty: 8, stock: 0 });
  });

  // Found driving 3f-1 against the emulator (27 Oct 2026): the queued map was the whole screen as it was at the keystroke,
  // so a snapshot that cleared lines during the pause made every one of them «changed here» against the new baseline.
  it('⚠️ another phone clearing lines during the debounce: the autosave sends ONLY this phone\'s line, never the cleared ones back', async () => {
    const h = harness();
    h.sync.receive({ entries: { a: { qty: 2, stock: 0 }, b: { qty: 5, stock: 1 } }, days: { s1: '2026-10-26' } });
    h.sync.change({ a: { qty: 2, stock: 0 }, b: { qty: 5, stock: 1 }, c: { qty: 3, stock: 0 } }, { s1: '2026-10-26' });
    // Another phone places the order: its lines go to 0 and its day stamp goes.
    h.sync.receive({ entries: { a: { qty: 0, stock: 0 }, b: { qty: 0, stock: 1 } }, days: {} });
    await h.tick();
    expect(h.saves).toEqual([{ updatedAt: '2026-10-26T10:00:00.000Z', entries: { c: { qty: 3, stock: 0 } } }]);
  });

  it('⚠️ typed over the phone\'s OLD copy before the server answered: the server\'s emptied order is not filled back in', async () => {
    const h = harness();
    // The first snapshot comes from this phone's cache, the order as it was before another phone emptied it.
    h.sync.receive({ entries: { a: { qty: 9, stock: 0 }, b: { qty: 2, stock: 0 } } });
    h.sync.change({ a: { qty: 3, stock: 0 }, b: { qty: 2, stock: 0 } }, {});
    // The server's copy arrives: the order is empty.
    const view = h.sync.receive({ entries: {} });
    expect(view.entries).toEqual({ a: { qty: 3, stock: 0 } });
    await h.tick();
    expect(h.saves).toEqual([{ updatedAt: '2026-10-26T10:00:00.000Z', entries: { a: { qty: 3, stock: 0 } } }]);
  });

  it('flush after such a snapshot sends only this phone\'s line too', async () => {
    const h = harness();
    h.sync.receive({ entries: { a: { qty: 4, stock: 0 } } });
    h.sync.change({ a: { qty: 4, stock: 0 }, c: { qty: 1, stock: 0 } }, {});
    h.sync.receive({ entries: { a: { qty: 0, stock: 0 } } });
    await h.sync.flush();
    expect(h.saves).toEqual([{ updatedAt: '2026-10-26T10:00:00.000Z', entries: { c: { qty: 1, stock: 0 } } }]);
  });
});

describe('draftSync — a refused write', () => {
  it('says so, keeps the typing on screen and sends it again with the next change (parity L37)', async () => {
    const h = harness({ refuse: true });
    h.sync.receive({ entries: {} });
    h.sync.change({ a: { qty: 5, stock: 0 } }, {});
    await h.tick();
    expect(h.results).toEqual([false]);
    // Firestore took the write back: the snapshot has no line a — this phone's typing is put back on top.
    expect(h.sync.receive({ entries: {} }).entries.a).toEqual({ qty: 5, stock: 0 });
    // `known` did not move, so the next change carries line a again.
    h.sync.change({ a: { qty: 5, stock: 0 }, b: { qty: 1, stock: 0 } }, {});
    await h.tick();
    expect(h.saves[1]?.entries).toEqual({ a: { qty: 5, stock: 0 }, b: { qty: 1, stock: 0 } });
  });
});

describe('draftSync — flush and unsaved', () => {
  it('flush sends a waiting change at once, and resolves without a write when nothing waits', async () => {
    const h = harness();
    h.sync.receive({ entries: {} });
    await h.sync.flush();
    expect(h.saves).toEqual([]);
    h.sync.change({ a: { qty: 2, stock: 0 } }, {});
    expect(h.sync.hasUnsaved()).toBe(true);
    await h.sync.flush();
    expect(h.saves).toHaveLength(1);
    expect(h.armed()).toBe(false);
    expect(h.sync.hasUnsaved()).toBe(false);
  });

  it('a refused flush rejects (its caller decides) and is said', async () => {
    const h = harness({ refuse: true });
    h.sync.receive({ entries: {} });
    h.sync.change({ a: { qty: 2, stock: 0 } }, {});
    await expect(h.sync.flush()).rejects.toThrow('permission-denied');
    expect(h.results).toEqual([false]);
  });

  it('a missing document is an empty order that does not exist yet', () => {
    const h = harness();
    expect(h.sync.receive(null)).toEqual({ entries: {}, days: {}, updatedAt: '', exists: false });
    expect(h.sync.receive({ entries: {}, updatedAt: 'x' }).exists).toBe(true);
  });
});
