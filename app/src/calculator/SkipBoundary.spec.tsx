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
});
