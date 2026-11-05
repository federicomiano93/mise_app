import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { itemOpener, useHandBackState } from './handBack';
import type { SupplierDeletions } from './supplierDeletions';

const NO_DELETIONS = { has: () => false } as unknown as SupplierDeletions;

// A row in the folded «Not in use» group (3e-5b), inside a closed <details>.
function folded(): { group: HTMLDetailsElement; row: HTMLButtonElement } {
  const group = document.createElement('details');
  group.append(document.createElement('summary'));
  const row = document.createElement('button');
  group.append(row);
  document.body.append(group);
  return { group, row };
}

describe('handBack and the folded «Not in use» group', () => {
  it('opens the group before it hands the focus to one of its rows (focus)', () => {
    const { result } = renderHook(() => useHandBackState(NO_DELETIONS));
    const { group, row } = folded();
    result.current.register(itemOpener('butter'), row);
    expect(result.current.focus(itemOpener('butter'))).toBe(true);
    expect(group.open).toBe(true);
    expect(document.activeElement).toBe(row);
    group.remove();
  });

  it('opens the group before it hands the focus to one of its rows (deliver)', () => {
    const { result } = renderHook(() => useHandBackState(NO_DELETIONS));
    const { group, row } = folded();
    result.current.register(itemOpener('butter'), row);
    result.current.expect(itemOpener('butter'));
    result.current.deliver();
    expect(group.open).toBe(true);
    expect(document.activeElement).toBe(row);
    group.remove();
  });

  it('a row that moves into the group in the same commit keeps the focus', () => {
    const { result } = renderHook(() => useHandBackState(NO_DELETIONS));
    const before = document.createElement('button');
    document.body.append(before);
    result.current.register(itemOpener('butter'), before);
    before.focus();
    // What React does when the row moves: the old ref is let go while the element is still on the page, then the new one is set.
    result.current.register(itemOpener('butter'), null);
    before.remove();
    const { group, row } = folded();
    result.current.register(itemOpener('butter'), row);
    expect(group.open).toBe(true);
    expect(document.activeElement).toBe(row);
    group.remove();
  });

  it('a row that goes away for good does not pull the focus later', async () => {
    const { result } = renderHook(() => useHandBackState(NO_DELETIONS));
    const before = document.createElement('button');
    document.body.append(before);
    result.current.register(itemOpener('butter'), before);
    before.focus();
    result.current.register(itemOpener('butter'), null);
    before.remove();
    await Promise.resolve();
    const { group, row } = folded();
    result.current.register(itemOpener('butter'), row);
    expect(group.open).toBe(false);
    expect(document.activeElement).not.toBe(row);
    group.remove();
  });
});
