import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { KIOSK_STORAGE_KEY } from '@mise/shared/kiosk-model';
import { renderApp } from '../testing/renderApp';
import shellCss from './AppShell.module.css?raw';

// The top bar (venue · date · connection) is on EVERY section (Federico, 21 Nov 2026; it was the Home's only since 16 Nov): CSS shows it
// from 700px, and from 700px it also holds the section's title and gear and the account's letter (22 Nov 2026). The kiosk «Standby» pill stays the Home's;
// «Exit» is in the account menu there.

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
  });

  it('on a kiosk phone the bar shows, takes its own row, and gives way at the venue, never the page', () => {
    // CSS only (jsdom draws no layout): the rules that keep a long venue name from widening the page on a 360px phone (20 Nov 2026).
    expect(css).toMatch(/\.shell\[data-kiosk="on"\] \.main\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.shell\[data-kiosk="on"\] \.topbar\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.topbar\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.shell\[data-kiosk="on"\] \.venueStatic\s*\{[^}]*flex:\s*0 100 auto;[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.shell\[data-kiosk="on"\] \.sync\s*\{[^}]*min-width:\s*0/);
    // Under 800px (a kiosk phone included) the connection's words are kept for a screen reader but not drawn.
    expect(css).toMatch(/@media \(max-width: 799\.98px\)\s*\{[^@]*\.syncText\s*\{[^}]*clip-path:\s*inset\(50%\)/);
    // On the kiosk phone the venue's box (not the page) gives way, and the right side never shrinks.
    expect(css).toMatch(/@media \(max-width: 699\.98px\)\s*\{[^@]*\.shell\[data-kiosk="on"\] \.barMiddle\s*\{[^}]*flex:\s*0 100 auto/);
  });

  it('is ONE grid from 700px: a 1fr cell at each side so the venue is truly centred, and it gives way instead of overlapping', () => {
    expect(css).toMatch(/@media \(min-width: 700px\)\s*\{[^@]*\.topbar,\s*\.shell\[data-kiosk="on"\] \.topbar\s*\{[^}]*grid-template-columns:\s*1fr minmax\(0, auto\) 1fr/);
    // The sides keep their content as a minimum (no min-width: 0 on them) and the middle may shrink.
    expect(css).not.toMatch(/\.barLeft\s*\{[^}]*min-width:\s*0/);
    expect(css).not.toMatch(/\.barRight\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.barMiddle\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.venueName\s*\{[^}]*text-overflow:\s*ellipsis/);
  });

  it('hides the date under 1000px and the word «Online» under 800px, and keeps the venue at 600 weight', () => {
    expect(css).toMatch(/\.date\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/@media \(min-width: 1000px\)\s*\{\s*\.date\s*\{\s*display:\s*block/);
    expect(css).toMatch(/\.venueStatic\s*\{[^}]*font:\s*600 var\(--fs-md\)/);
  });

  it('draws no initial square beside the venue', () => {
    expect(css).not.toContain('venueDot');
  });

  it('clears the window buttons and is a drag region only in the PC app\'s overlay mode, every control opting out', () => {
    const overlay = /@media \(display-mode: window-controls-overlay\)\s*\{([\s\S]*)$/.exec(css)?.[1] ?? '';
    expect(overlay).toMatch(/padding-right:\s*calc\(100vw - env\(titlebar-area-x, 0px\) - env\(titlebar-area-width, 100vw\) \+ var\(--s6\)\)/);
    expect(overlay).toMatch(/-webkit-app-region:\s*drag;\s*app-region:\s*drag/);
    expect(overlay).toMatch(/\.topbar a,\s*\.topbar button,\s*\.topbar \[role="button"\],\s*\.topbar input\s*\{[^}]*-webkit-app-region:\s*no-drag;\s*app-region:\s*no-drag/);
    // Nothing of it outside the media query.
    expect(css.replace(/@media \(display-mode: window-controls-overlay\)[\s\S]*$/, '')).not.toMatch(/app-region/);
  });
});
