import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { STILL_WAITING_MS, useStillWaiting } from './useStillWaiting';

afterEach(() => { vi.useRealTimers(); });

describe('useStillWaiting', () => {
  it('is false at first, true after ten seconds of waiting, and false the moment the wait ends', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ waiting }) => useStillWaiting(waiting), { initialProps: { waiting: true } });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(STILL_WAITING_MS - 1); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
    rerender({ waiting: false });
    expect(result.current).toBe(false);
  });

  it('never starts a timer when nothing is being waited for', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStillWaiting(false));
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(STILL_WAITING_MS * 2); });
    expect(result.current).toBe(false);
  });

  it('clears its timer when the screen goes away', () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useStillWaiting(true));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
