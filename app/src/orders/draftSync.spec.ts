// The order in progress kept in step between phones (draftSync.ts): the sync half of js/orders/draft.js. Re-states, against
// the TypeScript data layer with a fake write and a fake clock, the current app's tests of what an autosave sends
// (tests/orders-archive.test.mjs «only changed rows», tests/draft-override.test.mjs) and the traps draft.js records in its
// comments: `pending` over every snapshot, `known` not moved by a failed write, a value retyped while its write is in the air.

import { describe, expect, it } from 'vitest';
import { createDraftSync, SAVE_DELAY_MS } from './draftSync';
import type { DraftDays, DraftEntries, DraftEntry, DraftPayload } from './draftSync';

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

  // Found in the fourth review of 3f-1 (28 Oct 2026).
  it('⚠️ leaving while the autosave is in the air does not send the same write again (it could land after a colleague)', async () => {
    const h = harness();
    h.holdSaves();
    h.sync.receive({ entries: { a: { qty: 1, stock: 0 } } });
    h.sync.change({ a: { qty: 5, stock: 0 } }, { s1: '2026-10-29' });
    await h.tick();
    h.sync.receive({ entries: { a: { qty: 5, stock: 0 } }, days: { s1: '2026-10-29' } });
    const flushed = h.sync.flush();
    expect(h.saves).toHaveLength(1);
    expect(h.sync.hasUnsaved()).toBe(true);
    h.pendingSaves[0]?.resolve();
    await flushed;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(h.sync.hasUnsaved()).toBe(false);
  });

  it('⚠️ … but what changed since that write goes: a new stock count on the same line, alone', async () => {
    const h = harness();
    h.holdSaves();
    h.sync.receive({ entries: { a: { qty: 1, stock: 0 } } });
    h.sync.change({ a: { qty: 5, stock: 0 } }, {});
    await h.tick();
    h.sync.change({ a: { qty: 5, stock: 3 } }, {});
    void h.sync.flush();
    expect(h.saves[1]?.entries).toEqual({ a: { stock: 3 } });
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

// F-16 (docs/parity/orders.md), the current app's PR #444: a correction typed while the write it corrects is in the air.
// The screen then matches `known` (no snapshot has shown the write yet: about 5 s on the lab tablet on a freshly opened
// page), so measuring against `known` alone said «nothing to send», and the write in the air then landed and put the old
// number back, on screen and on the server. The cases d1–d19 of tests/draft-claims.test.mjs, re-stated against the port: the
// page is the store's copy, rebuilt from what the sync returns at every snapshot; a keystroke changes it and calls change().
describe('draftSync — corrections while a write is in the air (F-16)', () => {
  const DAY = '2026-10-28';
  type Page = { entries: Record<string, DraftEntry>; days: Record<string, string> };

  function onePage() {
    const h = harness();
    h.holdSaves();
    let page: Page = { entries: {}, days: {} };
    const draw = (view: { entries: DraftEntries; days: DraftDays }) => {
      page = { entries: structuredClone({ ...view.entries }) as Record<string, DraftEntry>, days: { ...view.days } };
    };
    // The server's document; each call hands over fresh objects, as Firestore does.
    const snapshot = (entries: Record<string, DraftEntry>, days: Record<string, string> = {}) => {
      draw(h.sync.receive(structuredClone({ entries, days, updatedAt: 'x' })));
    };
    const type = (id: string, patch: DraftEntry) => {
      page.entries[id] = { qty: 0, stock: 0, ...page.entries[id], ...patch };
      h.sync.change(page.entries, page.days);
    };
    const stamp = (supplierId: string, day: string) => {
      page.days[supplierId] = day;
      h.sync.change(page.entries, page.days);
    };
    // The store's «save this right now» (a restamped day): the same claims a keystroke makes, sent without waiting.
    const saveNow = () => h.sync.flush().catch(() => undefined);
    const settle = () => new Promise(resolve => { setTimeout(resolve, 0); });
    const held = (i: number) => h.pendingSaves[i];
    const resolveFrom = async (from: number) => {
      for (const write of h.pendingSaves.slice(from)) write.resolve();
      await settle();
    };
    return {
      h, snapshot, type, stamp, saveNow, settle, held, resolveFrom,
      pause: h.tick,
      page: () => page,
      sent: (i: number) => h.saves[i],
      shown: () => h.sync.view(),
      forget: (ids: string[], suppliers: string[]) => { draw(h.sync.forget(ids, suppliers)); },
    };
  }
  const GROUP0 = { qty: 0, unit: '', supplierId: '' };

  it('d1 a quantity corrected to the server\'s value while the write is in the air goes out, and stays', async () => {
    const p = onePage();
    p.snapshot({});
    p.type('d1', { qty: 5 });
    await p.pause();
    expect(p.h.saves).toHaveLength(1);
    p.type('d1', { qty: 0 });
    await p.pause();
    expect(p.h.saves).toHaveLength(2);
    expect(p.sent(1)?.entries).toEqual({ d1: GROUP0 });

    p.held(0)?.resolve();
    await p.settle();
    p.snapshot({ d1: { qty: 5, stock: 0, unit: '', supplierId: '' } }); // the 5 reaches the server first…
    expect(p.page().entries.d1?.qty).toBe(0);

    p.held(1)?.resolve();
    await p.settle();
    p.snapshot({ d1: { qty: 0, stock: 0, unit: '', supplierId: '' } }); // …then the correction does
    expect(p.page().entries.d1?.qty).toBe(0);
    p.type('d1b', { qty: 1 });
    await p.pause();
    expect(Object.keys(p.sent(2)?.entries ?? {})).toEqual(['d1b']);
    await p.resolveFrom(2);
  });

  it('d2 a quantity put back to the one the server already had, while the write is in the air, goes out', async () => {
    const p = onePage();
    p.snapshot({ d2: { qty: 3, stock: 0 } });
    p.type('d2', { qty: 5 });
    await p.pause();
    p.type('d2', { qty: 3 });
    await p.pause();
    expect(p.sent(1)?.entries).toEqual({ d2: { qty: 3, unit: '', supplierId: '' } });
    await p.resolveFrom(0);
  });

  it('d3 a correction still in its pause when the earlier write lands goes out after it', async () => {
    const p = onePage();
    p.snapshot({});
    p.type('d3', { qty: 5 });
    await p.pause();
    p.type('d3', { qty: 0 });
    p.held(0)?.resolve();
    await p.settle();
    await p.pause();
    expect(p.sent(1)?.entries).toEqual({ d3: GROUP0 });
    await p.resolveFrom(1);
  });

  it('d4 the correction goes out when leaving the section too', async () => {
    const p = onePage();
    p.snapshot({});
    p.type('d4', { qty: 5 });
    await p.pause();
    p.type('d4', { qty: 0 });
    const flushing = p.h.sync.flush();
    expect(p.sent(1)?.entries).toEqual({ d4: GROUP0 });
    await p.resolveFrom(0);
    await flushing;
  });

  it('d5 a stock count corrected while its write is in the air goes out, and only the stock', async () => {
    const p = onePage();
    p.snapshot({ d5: { qty: 3, stock: 1 } });
    p.type('d5', { stock: 2 });
    await p.pause();
    p.type('d5', { stock: 1 });
    await p.pause();
    expect(p.sent(1)?.entries).toEqual({ d5: { stock: 1 } });
    await p.resolveFrom(0);
  });

  it('d6 a unit corrected while the write is in the air goes out with its quantity', async () => {
    const p = onePage();
    p.snapshot({ d6: { qty: 2, stock: 0 } });
    p.type('d6', { unit: 'busta' });
    await p.pause();
    p.type('d6', { unit: '' });
    await p.pause();
    expect(p.sent(1)?.entries).toEqual({ d6: { qty: 2, unit: '', supplierId: '' } });
    await p.resolveFrom(0);
  });

  it('d7 a day stamp put back while the write is in the air goes out', async () => {
    const p = onePage();
    p.snapshot({ d7: { qty: 2, stock: 0 } }, { aldo: '2026-10-27' });
    p.stamp('aldo', DAY);
    const moving = p.saveNow();
    p.stamp('aldo', '2026-10-27');
    await p.pause();
    expect(p.sent(1)?.days).toEqual({ aldo: '2026-10-27' });
    await p.resolveFrom(0);
    await moving;
  });

  // What the fix must NOT do: speak about a line it has no correction for.
  it('d8 retyping the value in the air sends nothing more, after a correction inside the pause', async () => {
    const p = onePage();
    p.snapshot({});
    p.type('d8', { qty: 5 });
    await p.pause();
    p.type('d8', { qty: 0 });
    p.type('d8', { qty: 5 });
    await p.pause();
    expect(p.h.saves).toHaveLength(1);
    await p.resolveFrom(0);
  });

  it('d9 a line placed while its write is in the air is not written again, nor its day stamp', async () => {
    const p = onePage();
    p.snapshot({ d9: { qty: 3, stock: 0 } }, { aldo: DAY });
    p.type('d9', { qty: 5 });
    p.stamp('aldo', '2026-10-29');
    await p.pause();
    p.forget(['d9'], ['aldo']); // the order is recorded: the store forgets its lines and its day
    p.type('d9b', { qty: 1 });
    await p.pause();
    expect(Object.keys(p.sent(1)?.entries ?? {})).toEqual(['d9b']);
    expect(p.sent(1)?.days).toBeUndefined();
    await p.resolveFrom(0);
  });

  it('d10 a field the write in the air does not carry is not claimed: a colleague\'s count is not re-asserted', async () => {
    const p = onePage();
    p.snapshot({ d10: { qty: 3, stock: 1 } });
    p.type('d10', { qty: 5 });
    await p.pause();
    // Firestore shows this phone's 5 with a colleague's new shelf count on the same line.
    p.snapshot({ d10: { qty: 5, stock: 7, unit: '', supplierId: '' } });
    p.type('d10b', { qty: 1 });
    await p.pause();
    expect(Object.keys(p.sent(1)?.entries ?? {})).toEqual(['d10b']);
    await p.resolveFrom(0);
  });

  it('d11 a correction outlives the refusal of the write it corrects', async () => {
    const p = onePage();
    p.snapshot({ d11: { qty: 3, stock: 0 } });
    p.type('d11', { qty: 5 });
    await p.pause();
    p.type('d11', { qty: 3 });
    p.held(0)?.reject(new Error('permission-denied'));
    await p.settle();
    expect(p.shown().entries.d11?.qty).toBe(3); // the refused 5 does not come back
    p.snapshot({ d11: { qty: 3, stock: 0 } }); // Firestore takes the write back
    expect(p.page().entries.d11?.qty).toBe(3);
    await p.pause();
    expect(p.h.saves).toHaveLength(1); // the take-back shows the 3: nothing is owed
    p.snapshot({ d11: { qty: 3, stock: 0 } });
    expect(p.page().entries.d11?.qty).toBe(3);
  });

  it('d11b refused, and the pause ends before the take-back: the 3 goes out, what the screen says', async () => {
    const p = onePage();
    p.snapshot({ d11b: { qty: 3, stock: 0 } });
    p.type('d11b', { qty: 5 });
    await p.pause();
    p.type('d11b', { qty: 3 });
    p.held(0)?.reject(new Error('permission-denied'));
    await p.settle();
    await p.pause();
    // The server never took the 5, so this repeats what it holds: the same exposure as any keystroke, pinned so that a
    // change to it is a decision.
    expect(p.sent(1)?.entries).toEqual({ d11b: { qty: 3, unit: '', supplierId: '' } });
    await p.resolveFrom(1);
  });

  it('d12 a refused write does not come back over a correction already on its way', async () => {
    const p = onePage();
    p.snapshot({});
    p.type('d12', { qty: 5 });
    await p.pause();
    p.type('d12', { qty: 0 });
    await p.pause();
    p.type('d12b', { qty: 1 }); // the 0 is on its way, so its claim is dropped
    p.held(0)?.reject(new Error('permission-denied'));
    await p.settle();
    p.snapshot({}); // Firestore takes the write back
    expect(p.page().entries.d12?.qty ?? 0).toBe(0);
    await p.pause();
    expect(Object.keys(p.sent(2)?.entries ?? {})).toEqual(['d12b']);
    await p.resolveFrom(1);
  });

  it('d19 a refused day stamp does not come back over a newer one already on its way', async () => {
    const p = onePage();
    p.snapshot({ d19: { qty: 2, stock: 0 } }, { aldo: '2026-10-27' });
    p.stamp('aldo', DAY);
    const first = p.saveNow();
    p.stamp('aldo', '2026-10-29');
    void p.saveNow();
    p.snapshot({ d19: { qty: 2, stock: 0 } }, { aldo: '2026-10-29' }); // Firestore shows the newer stamp
    p.type('d19b', { qty: 1 }); // so the keystroke drops its claim
    p.held(0)?.reject(new Error('permission-denied'));
    await first;
    await p.settle();
    await p.pause();
    expect(p.sent(2)?.days).toBeUndefined();
    expect(p.shown().days.aldo).toBe('2026-10-29');
    await p.resolveFrom(1);
  });

  // Changing one's mind twice: the first write lands, and its value is the one typed last.
  it('d13 5, 0, 5 again: the first 5 landing inside the pause does not stop the last 5 going out', async () => {
    const p = onePage();
    p.snapshot({});
    p.type('d13', { qty: 5 });
    await p.pause();
    p.type('d13', { qty: 0 });
    await p.pause();
    p.type('d13', { qty: 5 });
    p.held(0)?.resolve();
    await p.settle();
    await p.pause();
    expect(p.sent(2)?.entries).toEqual({ d13: { qty: 5, unit: '', supplierId: '' } });
    await p.resolveFrom(1);
    expect(p.page().entries.d13?.qty).toBe(5);
    expect(p.h.saves).toHaveLength(3); // and that is the end of it
    // The server ends at the last 5, and a snapshot saying so leaves nothing claimed.
    p.snapshot({ d13: { qty: 5, stock: 0, unit: '', supplierId: '' } });
    expect(p.h.sync.hasUnsaved()).toBe(false);
  });

  it('d14 5, 7, 5 again on a saved line ends at 5, not at the number in the middle', async () => {
    const p = onePage();
    p.snapshot({ d14: { qty: 3, stock: 0 } });
    p.type('d14', { qty: 5 });
    await p.pause();
    p.type('d14', { qty: 7 });
    await p.pause();
    p.type('d14', { qty: 5 });
    p.held(0)?.resolve();
    await p.settle();
    await p.pause();
    expect(p.sent(2)?.entries).toEqual({ d14: { qty: 5, unit: '', supplierId: '' } });
    await p.resolveFrom(1);
  });

  it('d15 a shelf count 2, 1, 2 again ends at 2', async () => {
    const p = onePage();
    p.snapshot({ d15: { qty: 3, stock: 0 } });
    p.type('d15', { stock: 2 });
    await p.pause();
    p.type('d15', { stock: 1 });
    await p.pause();
    p.type('d15', { stock: 2 });
    p.held(0)?.resolve();
    await p.settle();
    await p.pause();
    expect(p.sent(2)?.entries).toEqual({ d15: { stock: 2 } });
    await p.resolveFrom(1);
  });

  it('d16 a day stamp moved and moved back ends where it was last put', async () => {
    const p = onePage();
    p.snapshot({ d16: { qty: 2, stock: 0 } }, { aldo: '2026-10-27' });
    p.stamp('aldo', DAY);
    void p.saveNow();
    p.stamp('aldo', '2026-10-29');
    void p.saveNow();
    p.stamp('aldo', DAY);
    p.held(0)?.resolve();
    await p.settle();
    await p.pause();
    expect(p.sent(2)?.days).toEqual({ aldo: DAY });
    await p.resolveFrom(1);
  });

  it('d17 with all three writes in the air, the first landing leaves the last one\'s claim standing', async () => {
    const p = onePage();
    p.snapshot({});
    p.type('d17', { qty: 5 });
    await p.pause();
    p.type('d17', { qty: 0 });
    await p.pause();
    p.type('d17', { qty: 5 });
    await p.pause();
    p.held(0)?.resolve();
    await p.settle();
    p.snapshot({ d17: { qty: 0, stock: 0 } }); // a snapshot showing the write in the middle
    expect(p.page().entries.d17?.qty).toBe(5);
    p.type('d17b', { qty: 1 });
    await p.pause();
    expect(Object.keys(p.sent(3)?.entries ?? {})).toEqual(['d17b']);
    await p.resolveFrom(1);
  });

  // A redraw that gives a line a blank row back makes the next keystroke write it at zero. Wanted: a 5 landing after the
  // line was emptied would otherwise stay.
  it('d18 a line emptied while its write is in the air, then redrawn, is written at zero', async () => {
    const p = onePage();
    p.snapshot({ d18: { qty: 3, stock: 0 } });
    p.type('d18', { qty: 5 });
    await p.pause();
    p.page().entries.d18 = { qty: 0, stock: 0 };
    p.type('d18b', { qty: 1 });
    await p.pause();
    expect(p.sent(1)?.entries?.d18).toEqual(GROUP0);
    await p.resolveFrom(0);
  });
});
