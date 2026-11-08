import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { PendingLatchProvider, usePendingLatch } from './pendingLatch';

// The banners are latched ONCE PER OPENING — except that each round of «a line the last page left behind has just come back»
// (draftCameBack, parity F-15) asks the question again, because it was asked before those lines were here.

function probe() {
  const seen: { latch: ReturnType<typeof usePendingLatch> | null } = { latch: null };
  function Probe() {
    seen.latch = usePendingLatch();
    return null;
  }
  render(<PendingLatchProvider><Probe /></PendingLatchProvider>);
  return () => seen.latch as ReturnType<typeof usePendingLatch>;
}

describe('PendingLatchProvider', () => {
  it('starts with no look made', () => {
    const latch = probe();
    expect(latch().latched).toBeNull();
    expect(latch().round).toBe(-1);
  });

  it('keeps the FIRST look of an opening: a later look of the same round is ignored', () => {
    const latch = probe();
    act(() => { latch().latch(['a']); });
    act(() => { latch().latch(['a', 'b']); });
    expect([...(latch().latched ?? [])]).toEqual(['a']);
    expect(latch().round).toBe(0);
  });

  it('⚠️ lines that came back ask the question once more, and only once per round', () => {
    const latch = probe();
    act(() => { latch().latch(['a'], 0); });
    act(() => { latch().latch(['a', 'b'], 1); });     // a line came back with last night's stamp
    expect([...(latch().latched ?? [])]).toEqual(['a', 'b']);
    expect(latch().round).toBe(1);
    act(() => { latch().latch(['a', 'b', 'c'], 1); });
    expect([...(latch().latched ?? [])]).toEqual(['a', 'b']);
    act(() => { latch().latch(['z'], 0); });          // an older round never undoes a newer look
    expect(latch().round).toBe(1);
  });
});
