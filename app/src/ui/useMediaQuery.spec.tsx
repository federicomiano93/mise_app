import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useMediaQuery } from './useMediaQuery';

function Probe() {
  return <p>{useMediaQuery('(min-width: 1000px)') ? 'wide' : 'narrow'}</p>;
}

// A matchMedia that can be moved: the list it hands out tells its listeners when `matches` changes.
function movableMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const list = {
    get matches() { return matches; },
    addEventListener: (_type: string, listener: () => void) => { listeners.add(listener); },
    removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener); },
  };
  vi.stubGlobal('matchMedia', () => list);
  return {
    listeners,
    set(next: boolean) {
      matches = next;
      listeners.forEach(listener => { listener(); });
    },
  };
}

describe('useMediaQuery', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reads «does not match» where there is no matchMedia (jsdom)', () => {
    render(<Probe />);
    expect(screen.getByText('narrow')).toBeInTheDocument();
  });

  it('reads «does not match» from a stub that is only { matches: false }', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    render(<Probe />);
    expect(screen.getByText('narrow')).toBeInTheDocument();
  });

  it('reads a match from a bare stub without listeners, and does not throw', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(<Probe />);
    expect(screen.getByText('wide')).toBeInTheDocument();
  });

  it('follows the query as it changes, and stops listening when it goes away', () => {
    const media = movableMedia(false);
    const { unmount } = render(<Probe />);
    expect(screen.getByText('narrow')).toBeInTheDocument();
    expect(media.listeners.size).toBe(1);

    act(() => { media.set(true); });
    expect(screen.getByText('wide')).toBeInTheDocument();

    act(() => { media.set(false); });
    expect(screen.getByText('narrow')).toBeInTheDocument();

    unmount();
    expect(media.listeners.size).toBe(0);
  });
});
