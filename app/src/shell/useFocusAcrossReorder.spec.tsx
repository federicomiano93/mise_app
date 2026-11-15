import { useLayoutEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useFocusAcrossReorder } from './useFocusAcrossReorder';

// Chrome drops the focus of a node that React takes out and puts back (a keyed row pushed down by the reorder); jsdom keeps it, so
// the browser's loss is played by a layout effect that blurs, declared BEFORE the hook in the same component so it runs first, as
// the move does. The hook is proved by the control: the same reorder without it leaves the focus on the page.
function List({ order, useHook }: { order: readonly string[]; useHook: boolean }) {
  const key = order.join('|');
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.tagName === 'BUTTON') active.blur();
  }, [key]);
  // A constant per mount, so the hook order never changes between renders.
  if (useHook) useFocusAcrossReorder(key);
  return <ul>{order.map(id => <li key={id}><button type="button">{id}</button></li>)}</ul>;
}

afterEach(cleanup);

describe('useFocusAcrossReorder', () => {
  it('hands the focus back to the control whose row the reorder pushed down and lost the focus of', () => {
    const { rerender } = render(<List order={['a', 'b', 'c']} useHook />);
    const a = screen.getByRole('button', { name: 'a' });
    act(() => { a.focus(); });
    rerender(<List order={['b', 'a', 'c']} useHook />);
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['b', 'a', 'c']);
    expect(a).toHaveFocus();
  });

  it('(the control) without the hook the same reorder leaves the focus on the page', () => {
    const { rerender } = render(<List order={['a', 'b', 'c']} useHook={false} />);
    const a = screen.getByRole('button', { name: 'a' });
    act(() => { a.focus(); });
    rerender(<List order={['b', 'a', 'c']} useHook={false} />);
    expect(a).not.toHaveFocus();
  });

  it('never steals the focus: a person who is somewhere else keeps it', () => {
    const { rerender } = render(<><input aria-label="search" /><List order={['a', 'b']} useHook /></>);
    const search = screen.getByRole('textbox');
    act(() => { search.focus(); });
    rerender(<><input aria-label="search" /><List order={['b', 'a']} useHook /></>);
    expect(search).toHaveFocus();
  });
});
