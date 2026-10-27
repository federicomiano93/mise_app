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
    expect(h.saves).toEqual([{ updatedAt: '2026-10-26T10:00:00.000Z', entries: { a: { qty: 12, unit: '', supplierId: '' } } }]);
    expect(h.results).toEqual([true]);
  });

  it('⚠️ sends ONLY the lines this phone changed: a colleague\'s line is never re-asserted at a stale value', async () => {
    const h = harness();
    h.sync.receive({ entries: { a: { qty: 2, stock: 0 }, b: { qty: 5, stock: 1 } }, days: { s1: '2026-10-26' } });
    h.sync.change({ a: { qty: 3, stock: 0 }, b: { qty: 5, stock: 1 } }, { s1: '2026-10-26' });
    await h.tick();
    // Field by field: the stock of line a did not change, so it is not said either.
    expect(h.saves[0]).toEqual({ updatedAt: '2026-10-26T10:00:00.000Z', entries: { a: { qty: 3, unit: '', supplierId: '' } } });
  });

  it('looking at a supplier stores nothing: a blank line the document never had is not a change', async () => {
    const h = harness();
    h.sync.receive(null);
    h.sync.change({ a: { qty: 0, stock: 0 } }, {});
    await h.tick();
    expect(h.saves).toEqual([]);
  });

  it('a line taken DOWN to zero is a real change, and so is a stock-only change — each sending only its own field', async () => {
    const h = harness();
    h.sync.receive({ entries: { a: { qty: 4, stock: 0 }, b: { qty: 0, stock: 0 } } });
    h.sync.change({ a: { qty: 0, stock: 0 }, b: { qty: 0, stock: 6 } }, {});
    await h.tick();
    expect(h.saves[0]?.entries).toEqual({ a: { qty: 0, unit: '', supplierId: '' }, b: { stock: 6 } });
  });

  it('⚠️ sends unit: \'\' and supplierId: \'\' to CLEAR them (a merge write cannot delete a nested key)', async () => {
    const h = harness();
    h.sync.receive({ entries: { a: { qty: 2, stock: 0, unit: 'busta', supplierId: 'other' } } });
    h.sync.change({ a: { qty: 0, stock: 0, unit: '', supplierId: '' } }, {});
    await h.tick();
    expect(h.saves[0]?.entries).toEqual({ a: { qty: 0, unit: '', supplierId: '' } });
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
    expect(view.entries.a).toEqual({ qty: 7, stock: 0, unit: '', supplierId: '' });
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
    expect(view.entries.a).toEqual({ qty: 8, stock: 0, unit: '', supplierId: '' });
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
    expect(h.saves).toEqual([{ updatedAt: '2026-10-26T10:00:00.000Z', entries: { c: { qty: 3, unit: '', supplierId: '' } } }]);
  });

  it('⚠️ typed over the phone\'s OLD copy before the server answered: the server\'s emptied order is not filled back in', async () => {
    const h = harness();
    // The first snapshot comes from this phone's cache, the order as it was before another phone emptied it.
    h.sync.receive({ entries: { a: { qty: 9, stock: 0 }, b: { qty: 2, stock: 0 } } });
    h.sync.change({ a: { qty: 3, stock: 0 }, b: { qty: 2, stock: 0 } }, {});
    // The server's copy arrives: the order is empty.
    const view = h.sync.receive({ entries: {} });
    expect(view.entries).toEqual({ a: { qty: 3, unit: '', supplierId: '' } });
    await h.tick();
    expect(h.saves).toEqual([{ updatedAt: '2026-10-26T10:00:00.000Z', entries: { a: { qty: 3, unit: '', supplierId: '' } } }]);
  });

  // Found in the 3f-1 review (27 Oct 2026): the claims only ever grew, and whole rows were sent.
  it('⚠️ a line corrected back inside the pause (+ then −) is released: nothing is sent and it never comes back', async () => {
    const h = harness();
    h.sync.receive({ entries: { a: { qty: 2, stock: 0 } } });
    h.sync.change({ a: { qty: 3, stock: 0 } }, {});
    h.sync.change({ a: { qty: 2, stock: 0 } }, {});
    await h.tick();
    expect(h.saves).toEqual([]);
    // A colleague's write on another line: line a still reads the server's 2, and the next edit says nothing about a.
    const view = h.sync.receive({ entries: { a: { qty: 2, stock: 0 }, b: { qty: 1, stock: 0 } } });
    expect(view.entries.a).toEqual({ qty: 2, stock: 0 });
    h.sync.change({ ...view.entries, c: { qty: 4, stock: 0 } }, {});
    await h.tick();
    expect(h.saves).toEqual([{ updatedAt: '2026-10-26T10:00:00.000Z', entries: { c: { qty: 4, unit: '', supplierId: '' } } }]);
  });

  it('⚠️ typed to the value another phone had just written: released, so that phone\'s later change or clear is not undone', async () => {
    const h = harness();
    h.sync.receive({ entries: { a: { qty: 1, stock: 0 } } });
    h.sync.change({ a: { qty: 5, stock: 0 } }, {});
    // The colleague's 5 lands before this phone's pause ends.
    h.sync.receive({ entries: { a: { qty: 5, stock: 0 } } });
    await h.tick();
    expect(h.saves).toEqual([]);
    // The colleague places the order: line a is cleared. It stays cleared here, and the next edit leaves it alone.
    const view = h.sync.receive({ entries: { a: { stock: 0 } } });
    expect(view.entries.a).toEqual({ stock: 0 });
    h.sync.change({ ...view.entries, c: { qty: 2, stock: 0 } }, {});
    await h.tick();
    expect(h.saves[0]?.entries).toEqual({ c: { qty: 2, unit: '', supplierId: '' } });
  });

  it('⚠️ a stock count sends the stock alone: a quantity another phone clears meanwhile stays cleared', async () => {
    const h = harness();
    h.sync.receive({ entries: { a: { qty: 9, stock: 0 } } });
    h.sync.change({ a: { qty: 9, stock: 2 } }, {});
    // Another phone places the order during the pause: the quantity goes.
    const view = h.sync.receive({ entries: { a: { stock: 0 } } });
    expect(view.entries.a).toEqual({ stock: 2 });
    await h.tick();
    expect(h.saves[0]?.entries).toEqual({ a: { stock: 2 } });
  });

  it('⚠️ this phone\'s own write shown at once is NOT taken as the server agreeing: refused, the typing stays (L37)', async () => {
    const h = harness();
    h.holdSaves();
    h.sync.receive({ entries: { a: { qty: 1, stock: 0 } } });
    h.sync.change({ a: { qty: 6, stock: 0 } }, {});
    await h.tick();
    // Firestore shows the write before the server answers…
    h.sync.receive({ entries: { a: { qty: 6, stock: 0 } } });
    // …then the server refuses it and the snapshot is taken back.
    h.pendingSaves[0]?.reject(new Error('permission-denied'));
    await new Promise(resolve => setTimeout(resolve, 0));
    const view = h.sync.receive({ entries: { a: { qty: 1, stock: 0 } } });
    expect(view.entries.a).toEqual({ qty: 6, stock: 0, unit: '', supplierId: '' });
  });

  // Found in the second review of 3f-1 (28 Oct 2026).
  it('⚠️ a refused write with typing on another line meanwhile: the refused line is handed back and sent again', async () => {
    const h = harness();
    h.holdSaves();
    h.sync.receive({ entries: { a: { qty: 1, stock: 0 } } });
    h.sync.change({ a: { qty: 6, stock: 0 } }, {});
    await h.tick();
    const echo = h.sync.receive({ entries: { a: { qty: 6, stock: 0 } } });
    h.sync.change({ ...echo.entries, b: { qty: 2, stock: 0 } }, {});
    h.pendingSaves[0]?.reject(new Error('permission-denied'));
    await new Promise(resolve => setTimeout(resolve, 0));
    const view = h.sync.receive({ entries: { a: { qty: 1, stock: 0 } } });
    expect(view.entries.a).toEqual({ qty: 6, stock: 0, unit: '', supplierId: '' });
    await h.tick();
    h.pendingSaves[1]?.resolve();
    expect(h.saves[1]?.entries).toEqual({ a: { qty: 6, unit: '', supplierId: '' }, b: { qty: 2, unit: '', supplierId: '' } });
  });

  it('⚠️ … and when Firestore takes the write back BEFORE the refusal arrives, view() redraws the handed-back typing', async () => {
    const h = harness();
    h.holdSaves();
    h.sync.receive({ entries: { a: { qty: 1, stock: 0 } } });
    h.sync.change({ a: { qty: 6, stock: 0 } }, {});
    await h.tick();
    const echo = h.sync.receive({ entries: { a: { qty: 6, stock: 0 } } });
    h.sync.change({ ...echo.entries, b: { qty: 2, stock: 0 } }, {});
    expect(h.sync.receive({ entries: { a: { qty: 1, stock: 0 } } }).entries.a).toEqual({ qty: 1, stock: 0 });
    h.pendingSaves[0]?.reject(new Error('permission-denied'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(h.sync.view().entries.a).toEqual({ qty: 6, stock: 0, unit: '', supplierId: '' });
  });

  it('⚠️ a quantity travels with its unit: a colleague placing the order meanwhile does not turn «5 buste» into 5 of the card\'s unit', async () => {
    const h = harness();
    h.sync.receive({ entries: { a: { qty: 4, stock: 0, unit: 'busta' } } });
    h.sync.change({ a: { qty: 5, stock: 0, unit: 'busta' } }, {});
    expect(h.sync.receive({ entries: { a: { stock: 0 } } }).entries.a).toEqual({ stock: 0, qty: 5, unit: 'busta', supplierId: '' });
    await h.tick();
    expect(h.saves[0]?.entries).toEqual({ a: { qty: 5, unit: 'busta', supplierId: '' } });
  });

  it('⚠️ … and with its supplier for this time: the line stays in that supplier\'s order', async () => {
    const h = harness();
    h.sync.receive({ entries: { a: { qty: 4, stock: 0, supplierId: 's2' } } });
    h.sync.change({ a: { qty: 5, stock: 0, supplierId: 's2' } }, {});
    h.sync.receive({ entries: { a: { stock: 0 } } });
    await h.tick();
    expect(h.saves[0]?.entries).toEqual({ a: { qty: 5, supplierId: 's2', unit: '' } });
  });

  it('⚠️ a NEW line carries only what is in it: a colleague\'s shelf count on the same line is not erased', async () => {
    const h = harness();
    h.sync.receive({ entries: {} });
    h.sync.change({ a: { qty: 5, stock: 0 } }, {});
    expect(h.sync.receive({ entries: { a: { stock: 7 } } }).entries.a).toEqual({ stock: 7, qty: 5, unit: '', supplierId: '' });
    await h.tick();
    expect(h.saves[0]?.entries).toEqual({ a: { qty: 5, unit: '', supplierId: '' } });
  });

  it('⚠️ a write in the air shields only its own fields: another line the server now agrees on is released', async () => {
    const h = harness();
    h.holdSaves();
    h.sync.receive({ entries: { a: { qty: 1, stock: 0 } } });
    h.sync.change({ a: { qty: 2, stock: 0 } }, {});
    await h.tick();
    h.sync.change({ a: { qty: 2, stock: 0 }, b: { qty: 3, stock: 0 } }, {});
    // A colleague writes b = 3, then places the order (b's quantity goes) — both while a's write is in the air.
    h.sync.receive({ entries: { a: { qty: 1, stock: 0 }, b: { qty: 3, stock: 0 } } });
    const view = h.sync.receive({ entries: { a: { qty: 1, stock: 0 }, b: { stock: 0 } } });
    expect(view.entries.b).toEqual({ stock: 0 });
    h.pendingSaves[0]?.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    await h.tick();
    expect(h.saves).toHaveLength(1);
  });

  it('⚠️ a leftover {qty: 0, supplierId: X} is not «cleaned» by an edit of another line; the first quantity typed for it clears it', async () => {
    const h = harness();
    h.sync.receive({ entries: { a: { qty: 0, stock: 0, supplierId: 'x' } } });
    h.sync.change({ a: { qty: 0, stock: 0, supplierId: 'x' }, b: { qty: 1, stock: 0 } }, {});
    await h.tick();
    expect(h.saves[0]?.entries).toEqual({ b: { qty: 1, unit: '', supplierId: '' } });
    h.sync.receive({ entries: { a: { qty: 0, stock: 0, supplierId: 'x' }, b: { qty: 1 } } });
    h.sync.change({ a: { qty: 2, stock: 0 }, b: { qty: 1 } }, {});
    await h.tick();
    expect(h.saves[1]?.entries).toEqual({ a: { qty: 2, supplierId: '', unit: '' } });
  });

  it('⚠️ a refused change still counts as unsaved (a reload must not throw it away), and flush tries it once more', async () => {
    const h = harness({ refuse: true });
    h.sync.receive({ entries: {} });
    h.sync.change({ a: { qty: 5, stock: 0 } }, {});
    await h.tick();
    expect(h.results).toEqual([false]);
    expect(h.sync.hasUnsaved()).toBe(true);
    await expect(h.sync.flush()).rejects.toThrow('permission-denied');
    expect(h.saves).toHaveLength(2);
    expect(h.saves[1]?.entries).toEqual({ a: { qty: 5, unit: '', supplierId: '' } });
  });

  // Found in the third review of 3f-1 (28 Oct 2026).
  it('⚠️ a landed write releases the group only whole: a unit changed while it was in the air goes again WITH its quantity', async () => {
    const h = harness();
    h.holdSaves();
    h.sync.receive({ entries: { a: { qty: 1, stock: 0, unit: 'busta' } } });
    h.sync.change({ a: { qty: 2, stock: 0, unit: 'busta' } }, {});
    await h.tick();
    h.sync.change({ a: { qty: 2, stock: 0 } }, {});
    h.pendingSaves[0]?.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    await h.tick();
    h.pendingSaves[1]?.resolve();
    expect(h.saves[1]?.entries).toEqual({ a: { qty: 2, unit: '', supplierId: '' } });
  });

  it('⚠️ an older write landing while a newer one is in the air does not put the baseline back to its older value', async () => {
    const h = harness();
    h.holdSaves();
    h.sync.receive({ entries: { a: { qty: 1, stock: 0 } } });
    h.sync.change({ a: { qty: 2, stock: 0 } }, {});
    await h.tick();
    h.sync.change({ a: { qty: 3, stock: 0 } }, {});
    await h.tick();
    // Firestore shows the newer write at once; then the older one is confirmed.
    h.sync.receive({ entries: { a: { qty: 3, stock: 0 } } });
    h.pendingSaves[0]?.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    h.sync.change({ ...h.sync.view().entries, b: { qty: 1, stock: 0 } }, {});
    await h.tick();
    expect(h.saves[2]?.entries).toEqual({ b: { qty: 1, unit: '', supplierId: '' } });
  });

  it('⚠️ a keystroke between a refusal and the snapshot taking the write back keeps the refused typing', async () => {
    const h = harness();
    h.holdSaves();
    h.sync.receive({ entries: { a: { qty: 1, stock: 0 } } });
    h.sync.change({ a: { qty: 6, stock: 0 } }, {});
    await h.tick();
    const echo = h.sync.receive({ entries: { a: { qty: 6, stock: 0 } } });
    h.sync.change({ ...echo.entries, b: { qty: 2, stock: 0 } }, {});
    h.pendingSaves[0]?.reject(new Error('permission-denied'));
    await new Promise(resolve => setTimeout(resolve, 0));
    h.sync.change({ a: { qty: 6, stock: 0 }, b: { qty: 3, stock: 0 } }, {});
    expect(h.sync.receive({ entries: { a: { qty: 1, stock: 0 } } }).entries.a).toEqual({ qty: 6, stock: 0, unit: '', supplierId: '' });
  });

  it('flush after such a snapshot sends only this phone\'s line too', async () => {
    const h = harness();
    h.sync.receive({ entries: { a: { qty: 4, stock: 0 } } });
    h.sync.change({ a: { qty: 4, stock: 0 }, c: { qty: 1, stock: 0 } }, {});
    h.sync.receive({ entries: { a: { qty: 0, stock: 0 } } });
    await h.sync.flush();
    expect(h.saves).toEqual([{ updatedAt: '2026-10-26T10:00:00.000Z', entries: { c: { qty: 1, unit: '', supplierId: '' } } }]);
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
    expect(h.sync.receive({ entries: {} }).entries.a).toEqual({ qty: 5, unit: '', supplierId: '' });
    // `known` did not move, so the next change carries line a again.
    h.sync.change({ a: { qty: 5, stock: 0 }, b: { qty: 1, stock: 0 } }, {});
    await h.tick();
    expect(h.saves[1]?.entries).toEqual({ a: { qty: 5, unit: '', supplierId: '' }, b: { qty: 1, unit: '', supplierId: '' } });
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
