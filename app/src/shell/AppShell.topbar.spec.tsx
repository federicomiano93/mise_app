import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { KIOSK_STORAGE_KEY } from '@mise/shared/kiosk-model';
import { renderApp } from '../testing/renderApp';
import shellCss from './AppShell.module.css?raw';

// The top bar (venue · date · connection) is on EVERY section (Federico, 21 Nov 2026; it was the Home's only since 16 Nov): CSS shows it
// from 700px. The kiosk pills (Standby / Exit) stay the Home's.

const css = shellCss.replace(/\/\*[\s\S]*?\*\//g, '');
const ON = '{"enabled":true,"restMinutes":5,"nightHours":1}';
let onLine: MockInstance<() => boolean>;

beforeEach(() => {
  onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
});

afterEach(() => {
  onLine.mockRestore();
  localStorage.clear();
});

const topBar = () => document.querySelector('header [role="status"]')?.closest('header') ?? null;

describe('the top bar', () => {
  it.each(['/home', '/orders', '/settings', '/recipes'])('is drawn on %s, with the connection', path => {
    renderApp(path);
    expect(topBar()).not.toBeNull();
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('takes its row of the column from 700px, and no rule zeroes its height any more', () => {
    renderApp('/orders');
    expect(document.querySelector('[data-topbar]')).toBeNull();
    expect(css).not.toContain('--topbar-h: 0px');
    expect(css).toMatch(/@media \(min-width: 700px\)\s*\{[^@]*\.main\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.topbar\s*\{[^}]*height:\s*var\(--topbar-h\)/);
  });

  it('carries the kiosk pills on the Home only, even with kiosk mode on', async () => {
    localStorage.setItem(KIOSK_STORAGE_KEY, ON);
    renderApp('/home');
    expect(await screen.findByRole('group', { name: 'Kiosk mode' })).toBeInTheDocument();
    expect(document.querySelector('[data-kiosk]')).toHaveAttribute('data-kiosk', 'on');
  });

  it('does not mark a kiosk phone\'s shell off the Home, so the bar stays hidden there', async () => {
    localStorage.setItem(KIOSK_STORAGE_KEY, ON);
    renderApp('/orders');
    expect(await screen.findByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
    expect(document.querySelector('[data-kiosk]')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Kiosk mode' })).not.toBeInTheDocument();
  });

  it('on a kiosk phone the bar shows, takes its own row, and gives way at the venue, never the page', () => {
    // CSS only (jsdom draws no layout): the rules that keep a long venue name from widening the page on a 360px phone (20 Nov 2026).
    expect(css).toMatch(/\.shell\[data-kiosk="on"\] \.main\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.shell\[data-kiosk="on"\] \.topbar\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.topbar\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.shell\[data-kiosk="on"\] \.venueStatic\s*\{[^}]*flex:\s*0 100 auto;[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.shell\[data-kiosk="on"\] \.sync\s*\{[^}]*min-width:\s*0/);
    // On a kiosk phone the connection's words are kept for a screen reader but not drawn.
    expect(css).toMatch(/@media \(max-width: 699\.98px\)\s*\{[^@]*\.shell\[data-kiosk="on"\] \.syncText\s*\{[^}]*clip-path:\s*inset\(50%\)/);
  });
});
