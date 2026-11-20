import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { renderApp } from '../testing/renderApp';
import shellCss from './AppShell.module.css?raw';

// The top bar (venue · date · connection) is the Home's only (the Orders redesign of 16 Nov 2026, item 1): every other screen gives
// its height to its own content, and says the connection only when it is lost (the strip under its title, OfflineBanner).

const css = shellCss.replace(/\/\*[\s\S]*?\*\//g, '');
let onLine: MockInstance<() => boolean>;

beforeEach(() => {
  onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
});

afterEach(() => {
  onLine.mockRestore();
});

const topBar = () => document.querySelector('header [role="status"]')?.closest('header') ?? null;

describe('the top bar', () => {
  it('is drawn on the Home, with the connection', () => {
    renderApp('/home');
    expect(topBar()).not.toBeNull();
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it.each(['/orders', '/settings'])('is not drawn on %s', path => {
    renderApp(path);
    expect(topBar()).toBeNull();
    expect(screen.queryByText('Online')).not.toBeInTheDocument();
  });

  it('marks the shell, so the column and the split panes do not keep its room off the Home', () => {
    renderApp('/orders');
    expect(document.querySelector('[data-topbar]')).toHaveAttribute('data-topbar', 'off');
    expect(css).toMatch(/\.shell\[data-topbar="off"\]\s*\{[^}]*--topbar-h:\s*0px/);
    expect(css).toMatch(/\.shell\[data-topbar="on"\] \.main\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/);
  });

  it('on a kiosk phone the bar shows, takes its own row, and gives way at the venue, never the page', () => {
    // CSS only (jsdom draws no layout): the rules that keep a long venue name from widening the page on a 360px phone (20 Nov 2026).
    expect(css).toMatch(/\.shell\[data-topbar="on"\]\[data-kiosk="on"\] \.main\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.shell\[data-kiosk="on"\] \.topbar\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.topbar\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.shell\[data-kiosk="on"\] \.venueStatic\s*\{[^}]*flex:\s*0 100 auto;[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.shell\[data-kiosk="on"\] \.sync\s*\{[^}]*min-width:\s*0/);
    // On a kiosk phone the connection's words are kept for a screen reader but not drawn.
    expect(css).toMatch(/@media \(max-width: 699\.98px\)\s*\{[^@]*\.shell\[data-kiosk="on"\] \.syncText\s*\{[^}]*clip-path:\s*inset\(50%\)/);
  });
});
