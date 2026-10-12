import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkipBoundary } from './SkipBoundary';

function Bomb(): never {
  throw new Error('a damaged log');
}

describe('SkipBoundary', () => {
  it('draws nothing for a child that throws, and keeps its neighbours', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ul>
        <SkipBoundary><li>first</li></SkipBoundary>
        <SkipBoundary><Bomb /></SkipBoundary>
        <SkipBoundary><li>third</li></SkipBoundary>
      </ul>,
    );
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['first', 'third']);
    spy.mockRestore();
  });

  it('tries a card that failed again once its reset key changes, and not before', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Maybe = ({ broken }: { broken: boolean }) => (broken ? <Bomb /> : <li>repaired</li>);
    const { rerender } = render(<ul><SkipBoundary resetKey="1"><Maybe broken /></SkipBoundary></ul>);
    expect(screen.queryByRole('listitem')).toBeNull();
    // Same key: still skipped, even though the child would now draw.
    rerender(<ul><SkipBoundary resetKey="1"><Maybe broken={false} /></SkipBoundary></ul>);
    expect(screen.queryByRole('listitem')).toBeNull();
    rerender(<ul><SkipBoundary resetKey="2"><Maybe broken={false} /></SkipBoundary></ul>);
    expect(screen.getByRole('listitem')).toHaveTextContent('repaired');
    spy.mockRestore();
  });
});
