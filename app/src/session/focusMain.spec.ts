import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusMain, focusMainSoon } from './focusMain';

// The screen's heading is where the focus goes after a dialog went away. From 700px the h1 is in the top bar's title slot, OUTSIDE <main>
// (the single bar, 22 Nov 2026), so both places are searched, in the old order: main's h1, the bar's h1, main's first control.
afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); });

const page = (html: string): void => { document.body.innerHTML = html; };
const active = (): string => document.activeElement?.id ?? '';

describe('focusMain', () => {
  it('focuses the h1 in main, as before (a phone)', () => {
    page('<header></header><main><h1 id="in-main" tabindex="-1">Orders</h1><button id="btn">Go</button></main>');
    focusMain();
    expect(active()).toBe('in-main');
  });

  it('focuses the h1 in the top bar\'s title slot, outside main (700px and wider)', () => {
    page('<header><div data-title-slot=""><h1 id="in-bar" tabindex="-1">Orders</h1></div></header><main><button id="btn">Go</button></main>');
    focusMain();
    expect(active()).toBe('in-bar');
  });

  it('falls back to main\'s first control when no h1 takes the focus', () => {
    page('<header><div data-title-slot=""><p>Bookings</p></div></header><main><button id="btn">Go</button></main>');
    focusMain();
    expect(active()).toBe('btn');
  });

  it('does nothing without a main', () => {
    page('<header><div data-title-slot=""><h1 id="in-bar" tabindex="-1">Orders</h1></div></header>');
    focusMain();
    expect(active()).toBe('');
  });
});

describe('focusMainSoon', () => {
  it('looks again until the bar\'s h1 is there, then stops', () => {
    vi.useFakeTimers();
    page('<header><div data-title-slot=""></div></header><main></main>');
    const stop = focusMainSoon(document, 100, 3000);
    vi.advanceTimersByTime(150);
    expect(active()).toBe('');
    document.querySelector('[data-title-slot]')!.innerHTML = '<h1 id="late" tabindex="-1">Orders</h1>';
    vi.advanceTimersByTime(200);
    expect(active()).toBe('late');
    stop();
  });
});
