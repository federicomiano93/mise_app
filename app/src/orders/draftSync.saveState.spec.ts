// «Saved ✓» / «Not sent yet» (the current app's PR #551, the order typed on the iPad, 14 Nov 2026): draftSync.ts saveState and the
// line's words (saveStateView.ts), re-stated from tests/draft-save-state.test.mjs and tests/save-state-view.test.mjs of the current app.

import { describe, expect, it } from 'vitest';
import { writeJournal } from '@mise/shared/draft-journal';
import type { JournalStorage } from '@mise/shared/draft-journal';
import { createDraftSync } from './draftSync';
import type { SaveState } from './draftSync';
import { saveStateView } from './saveStateView';

function harness({ storage = null as JournalStorage | null } = {}) {
  const told: SaveState[] = [];
  let timer: (() => void) | null = null;
  const held: Array<{ resolve: () => void; reject: (err: unknown) => void }> = [];
  let refuse = false;
  const sync = createDraftSync({
    save: () => new Promise<void>((resolve, reject) => {
      if (refuse) { reject(new Error('permission-denied')); return; }
      held.push({ resolve, reject });
    }),
    nowIso: () => '2026-11-14T10:00:00.000Z',
    setTimer: run => { timer = run; return 1; },
    clearTimer: () => { timer = null; },
    onResult: () => undefined,
    onSaveState: state => { told.push(state); },
    ...(storage ? {
      journal: {
        venue: 'v1', storage: () => storage, now: () => Date.parse('2026-11-14T10:00:00.000Z'),
        ordersSince: () => new Promise<never>(() => undefined), retryLater: () => undefined, onCameBack: () => undefined,
      },
    } : {}),
  });
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  return {
    sync, told, held, settle,
    pause: () => { const run = timer; timer = null; run?.(); },
    refuseNext: () => { refuse = true; },
  };
}

function memoryStorage(): JournalStorage {
  const map = new Map<string, string>();
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: key => { map.delete(key); },
  };
}

describe('draftSync — whether everything typed here has reached the server', () => {
  it('is not ready before the first snapshot, then saved', () => {
    const h = harness();
    expect(h.sync.saveState()).toEqual({ ready: false, saved: true });
    h.sync.receive({ entries: {}, days: {} });
    expect(h.sync.saveState()).toEqual({ ready: true, saved: true });
    expect(h.told).toEqual([{ ready: true, saved: true }]);
  });

  it('says «not sent» from the keystroke, through the pause and the write in the air, and «saved» once the server answers', async () => {
    const h = harness();
    h.sync.receive({ entries: {}, days: {} });
    h.sync.change({ a: { qty: 3 } }, {});
    expect(h.sync.saveState().saved).toBe(false);
    h.pause();
    expect(h.held).toHaveLength(1);
    // ⚠️ Firestore shows this phone's own write at once: that snapshot is NOT the server's word.
    h.sync.receive({ entries: { a: { qty: 3 } }, days: {} }, false, true);
    expect(h.sync.saveState().saved).toBe(false);
    h.held[0]?.resolve();
    await h.settle();
    // The write landed, but Firestore still reports it pending on this device: still «not sent».
    expect(h.sync.saveState().saved).toBe(false);
    h.sync.receive({ entries: { a: { qty: 3 } }, days: {} }, true, false);
    expect(h.sync.saveState()).toEqual({ ready: true, saved: true });
    // Told only when it changed: saved → not sent → saved.
    expect(h.told.map(state => state.saved)).toEqual([true, false, true]);
  });

  it('stays «not sent» after a refusal: the typing is handed back and waits for the next save', async () => {
    const h = harness();
    h.sync.receive({ entries: {}, days: {} });
    h.refuseNext();
    h.sync.change({ a: { qty: 3 } }, {});
    h.pause();
    await h.settle();
    expect(h.sync.saveState().saved).toBe(false);
  });

  it('⚠️ a write a PREVIOUS page left queued on this device (hasPendingWrites) is not «saved»', () => {
    const h = harness();
    h.sync.receive({ entries: { a: { qty: 3 } }, days: {} }, false, true);
    expect(h.sync.saveState()).toEqual({ ready: true, saved: false });
    h.sync.receive({ entries: { a: { qty: 3 } }, days: {} }, true, false);
    expect(h.sync.saveState().saved).toBe(true);
  });

  it('⚠️ the last page’s note still waiting to come back is not «saved» (the lie of 14 Nov, on the device that typed it)', () => {
    const storage = memoryStorage();
    const at = Date.parse('2026-11-14T09:59:00.000Z');
    writeJournal('v1', { at, entries: { a: { row: { qty: 5, unit: '', supplierId: '' }, base: { qty: 0, unit: '', supplierId: '' } } }, days: {} }, storage);
    const h = harness({ storage });
    h.sync.receive({ entries: {}, days: {} }, false, false);
    expect(h.sync.saveState()).toEqual({ ready: true, saved: false });
  });

  it('sendWaiting sends a change still in its pause at once, and nothing when nothing waits', () => {
    const h = harness();
    h.sync.receive({ entries: {}, days: {} });
    h.sync.sendWaiting();
    expect(h.held).toHaveLength(0);
    h.sync.change({ a: { qty: 3 } }, {});
    h.sync.sendWaiting();
    expect(h.held).toHaveLength(1);
  });

  it('a watcher that throws never reaches the save', async () => {
    const sync = createDraftSync({
      save: () => Promise.resolve(), nowIso: () => '', setTimer: () => 1, clearTimer: () => undefined, onResult: () => undefined,
      onSaveState: () => { throw new Error('boom'); },
    });
    const errors = console.error;
    console.error = () => undefined;
    try {
      expect(() => sync.receive({ entries: {}, days: {} })).not.toThrow();
      sync.change({ a: { qty: 1 } }, {});
      await expect(sync.flush()).resolves.toBeUndefined();
    } finally {
      console.error = errors;
    }
  });
});

describe('saveStateView — what the line says', () => {
  it('nothing before the first snapshot', () => {
    expect(saveStateView({ ready: false, saved: true })).toEqual({ state: '', key: null });
  });
  it('«Saved ✓» when saved and online', () => {
    expect(saveStateView({ ready: true, saved: true })).toEqual({ state: 'saved', key: 'ord.saveState.saved' });
  });
  it('«Not sent yet» when something waits, and while offline even when nothing does', () => {
    expect(saveStateView({ ready: true, saved: false })).toEqual({ state: 'unsent', key: 'ord.saveState.unsent' });
    expect(saveStateView({ ready: true, saved: true }, false)).toEqual({ state: 'unsent', key: 'ord.saveState.unsent' });
  });
});
