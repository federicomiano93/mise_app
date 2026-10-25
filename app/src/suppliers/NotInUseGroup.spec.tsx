import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useNotInUseOpen } from './NotInUseGroup';

describe('useNotInUseOpen — the open state of the folded «Not in use» group (3e-5b)', () => {
  it('starts folded, opens the moment a row of it is wanted, and stays open until the person closes it', () => {
    const { result, rerender } = renderHook(({ wanted }) => useNotInUseOpen(wanted), { initialProps: { wanted: false } });
    expect(result.current.open).toBe(false);
    rerender({ wanted: true });
    expect(result.current.open).toBe(true);
    act(() => { result.current.onToggle(false); });
    rerender({ wanted: true });
    expect(result.current.open).toBe(false);
  });

  it('folds again when its reset key changes (the supplier screen stays mounted from one supplier to the next)', () => {
    const { result, rerender } = renderHook(({ id }) => useNotInUseOpen(false, id), { initialProps: { id: 's-a' } });
    act(() => { result.current.onToggle(true); });
    expect(result.current.open).toBe(true);
    rerender({ id: 's-b' });
    expect(result.current.open).toBe(false);
  });
});
