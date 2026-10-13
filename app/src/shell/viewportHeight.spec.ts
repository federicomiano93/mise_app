import { describe, expect, it, vi } from 'vitest';
import { installViewportHeight, VH_VAR } from './viewportHeight';

// A window just big enough for installViewportHeight: resize listeners, CSS.supports, a root element whose
// clientHeight (the layout viewport) the test moves.
function fakeWindow(supportsDvh: boolean, clientHeight: number) {
  const listeners = new Map<string, Set<() => void>>();
  const root = document.createElement('html');
  const state = { clientHeight };
  Object.defineProperty(root, 'clientHeight', { get: () => state.clientHeight });
  const win = {
    CSS: { supports: (property: string, value: string) => supportsDvh && property === 'height' && value === '100dvh' },
    document: { documentElement: root },
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => { listeners.get(type)?.delete(fn); },
    fire: (type: string) => { for (const fn of listeners.get(type) ?? []) fn(); },
    count: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
  return { win, root, state };
}

describe('installViewportHeight', () => {
  it('sets nothing where the browser knows dvh', () => {
    const { win, root } = fakeWindow(true, 648);
    installViewportHeight(win as never);
    expect(root.style.getPropertyValue(VH_VAR)).toBe('');
    expect(win.count()).toBe(0);
  });

  it('sets the visible height where dvh is unknown (the lab tablet, Chrome 101), and follows it', () => {
    const { win, root, state } = fakeWindow(false, 648);
    const stop = installViewportHeight(win as never);
    expect(root.style.getPropertyValue(VH_VAR)).toBe('648px');

    // The address bar slides away: the window grows, and so does the value.
    state.clientHeight = 704;
    win.fire('resize');
    expect(root.style.getPropertyValue(VH_VAR)).toBe('704px');

    stop();
    expect(win.count()).toBe(0);
    expect(root.style.getPropertyValue(VH_VAR)).toBe('');
  });

  it('does not write again while the height is unchanged', () => {
    const { win, root, state } = fakeWindow(false, 648);
    const write = vi.spyOn(root.style, 'setProperty');
    installViewportHeight(win as never);
    win.fire('resize');
    win.fire('orientationchange');
    expect(write).toHaveBeenCalledTimes(1);
    state.clientHeight = 650;
    win.fire('resize');
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('treats a browser with no CSS.supports as one without dvh', () => {
    const { win, root } = fakeWindow(false, 500);
    delete (win as { CSS?: unknown }).CSS;
    installViewportHeight(win as never);
    expect(root.style.getPropertyValue(VH_VAR)).toBe('500px');
  });
});
