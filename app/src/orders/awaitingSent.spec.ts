// «Did it go?» (awaitingSent.ts), re-stated from the current app's tests/awaiting-sent.test.mjs (PR #554).

import { describe, expect, it, vi } from 'vitest';
import {
  answerAwaiting, awaitingEntry, awaitingList, claimDecision, draftQuantities, isAwaiting, linesToClear, putQuestionBack,
  restoreDecision, shouldAskBeforeRecording, supplierKeepsLines,
} from './awaitingSent';
import type { AwaitingEntry } from './awaitingSent';

const AT = '2026-11-14T10:42:00.000Z';
const entry: AwaitingEntry = { at: AT, date: '2026-11-14', quantities: { flour: 2, salt: 1 }, units: { flour: 'sacco' } };

describe('awaitingEntry', () => {
  it('keeps only lines with a quantity, a unit only where there is one, and a real day', () => {
    expect(awaitingEntry({ at: AT, date: 'soon', quantities: { flour: 2, salt: 0, rye: 'x' }, units: { flour: 'sacco', salt: 'kg' } }))
      .toStrictEqual({ at: AT, date: '', quantities: { flour: 2 }, units: { flour: 'sacco' } });
  });
  it('is null when nothing went: there is no question to ask', () => {
    expect(awaitingEntry({ at: AT, quantities: { flour: 0 } })).toBeNull();
  });
  it('keeps what the draft said only when it differs from what went («Send it now» with a corrected number)', () => {
    expect(awaitingEntry({ at: AT, quantities: { flour: 3 }, draft: { quantities: { flour: 3 } } })?.draft).toBeUndefined();
    expect(awaitingEntry({ at: AT, quantities: { flour: 3 }, draft: { quantities: { flour: 5 } } })?.draft)
      .toStrictEqual({ quantities: { flour: 5 }, units: {} });
  });
});

describe('reading the shared questions', () => {
  it('isAwaiting refuses a half-written key', () => {
    expect(isAwaiting(entry)).toBe(true);
    expect(isAwaiting({ at: AT, quantities: {} })).toBe(false);
    expect(isAwaiting({ quantities: { flour: 1 } })).toBe(false);
    expect(isAwaiting('x')).toBe(false);
  });
  it('awaitingList: one banner per supplier the venue still has, oldest first', () => {
    const list = awaitingList({
      b: { ...entry, at: '2026-11-14T11:00:00.000Z' }, a: entry, gone: entry, bad: { at: AT },
    }, [{ id: 'a' }, { id: 'b' }, { id: 'bad' }]);
    expect(list.map(item => item.supplier.id)).toStrictEqual(['a', 'b']);
  });
  it('draftQuantities reads the draft through the supplier’s own lines, with the unit each row shows', () => {
    expect(draftQuantities([{ id: 'flour' }, { id: 'salt' }, { id: 'rye' }], { flour: { qty: 2, unit: 'sacco' }, salt: { qty: 0 }, oil: { qty: 9 } }))
      .toStrictEqual({ quantities: { flour: 2 }, units: { flour: 'sacco' } });
  });
});

describe('two devices answering at once', () => {
  it('claimDecision: only the same question, still there', () => {
    expect(claimDecision({ awaitingSent: { s: entry } }, 's', AT)).toBe(true);
    expect(claimDecision({ awaitingSent: {} }, 's', AT)).toBe(false);
    expect(claimDecision({ awaitingSent: { s: { ...entry, at: 'newer' } } }, 's', AT)).toBe(false);
  });
  it('restoreDecision: never over a question that stands (this one, or a newer send)', () => {
    expect(restoreDecision({ awaitingSent: {} }, 's')).toBe(true);
    expect(restoreDecision(null, 's')).toBe(true);
    expect(restoreDecision({ awaitingSent: { s: entry } }, 's')).toBe(false);
  });
});

describe('after «Yes»', () => {
  const cardOf = (id: string) => ({ flour: { unit: 'kg' }, salt: { unit: 'kg' } } as Record<string, unknown>)[id] ?? null;
  it('⚠️ clears only the lines still reading what went: typing done since is the next order', () => {
    const entries = { flour: { qty: 2, unit: 'sacco' }, salt: { qty: 4 }, rye: { qty: 1 } };
    expect(linesToClear(entries, cardOf, entry)).toStrictEqual(['flour']);
  });
  it('a line whose unit changed since stays', () => {
    expect(linesToClear({ flour: { qty: 2 } }, cardOf, entry)).toStrictEqual([]);
  });
  it('with a corrected send, the lines still reading what the DRAFT said then', () => {
    const corrected = { ...entry, quantities: { flour: 3 }, units: {}, draft: { quantities: { flour: 5 }, units: {} } };
    expect(linesToClear({ flour: { qty: 5 } }, cardOf, corrected)).toStrictEqual(['flour']);
  });
  it('supplierKeepsLines: the day stamp goes only when nothing of the supplier is left', () => {
    expect(supplierKeepsLines([{ id: 'flour' }, { id: 'rye' }], { flour: { qty: 2 }, rye: { qty: 1 } }, ['flour'])).toBe(true);
    expect(supplierKeepsLines([{ id: 'flour' }], { flour: { qty: 2 } }, ['flour'])).toBe(false);
  });
  it('⚠️ asks before recording only when History already holds every line at least as large', () => {
    expect(shouldAskBeforeRecording(entry, null)).toBe(false);
    expect(shouldAskBeforeRecording(entry, { quantities: { flour: 2 } })).toBe(false);
    expect(shouldAskBeforeRecording(entry, { quantities: { flour: 2, salt: 3 } })).toBe(true);
  });
});

describe('answerAwaiting — one answer, start to finish', () => {
  const deps = (over: Partial<Parameters<typeof answerAwaiting>[3]> = {}) => ({
    claim: vi.fn(async () => true), record: vi.fn(async () => true), restore: vi.fn(), drop: vi.fn(), busy: new Set<string>(), ...over,
  });
  it('«Yes»: claims, then records', async () => {
    const d = deps();
    expect(await answerAwaiting('yes', 's', entry, d)).toBe('recorded');
    expect(d.claim).toHaveBeenCalledWith('s', AT);
    expect(d.record).toHaveBeenCalledWith('s', entry);
  });
  it('another device answered first: nothing is recorded here', async () => {
    const d = deps({ claim: vi.fn(async () => false) });
    expect(await answerAwaiting('yes', 's', entry, d)).toBe('elsewhere');
    expect(d.record).not.toHaveBeenCalled();
  });
  it('no network for the claim: nothing recorded, the question stays', async () => {
    const d = deps({ claim: vi.fn(async () => { throw new Error('offline'); }) });
    expect(await answerAwaiting('yes', 's', entry, d)).toBe('claimFailed');
    expect(d.record).not.toHaveBeenCalled();
  });
  it('a failed recording puts the question back', async () => {
    const d = deps({ record: vi.fn(async () => false) });
    expect(await answerAwaiting('yes', 's', entry, d)).toBe('failed');
    expect(d.restore).toHaveBeenCalledWith('s', entry);
  });
  it('«No»: only the key goes', async () => {
    const d = deps();
    expect(await answerAwaiting('no', 's', entry, d)).toBe('dropped');
    expect(d.drop).toHaveBeenCalledWith('s');
    expect(d.record).not.toHaveBeenCalled();
  });
  it('a question this device could not share is recorded without a claim', async () => {
    const d = deps();
    expect(await answerAwaiting('yes', 's', entry, d, { local: true })).toBe('recorded');
    expect(d.claim).not.toHaveBeenCalled();
  });
  it('a second tap while answering is refused', async () => {
    const d = deps({ busy: new Set(['s']) });
    expect(await answerAwaiting('yes', 's', entry, d)).toBe('busy');
  });
  it('putQuestionBack keeps the question HERE when the write fails (a transaction is never queued offline)', async () => {
    const keepHere = vi.fn();
    expect(await putQuestionBack('s', entry, { write: async () => { throw new Error('offline'); }, keepHere })).toBe('kept');
    expect(keepHere).toHaveBeenCalled();
    expect(await putQuestionBack('s', entry, { write: async () => true, keepHere })).toBe('restored');
  });
});
