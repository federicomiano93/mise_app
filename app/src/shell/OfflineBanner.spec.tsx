import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { renderApp } from '../testing/renderApp';
import { renderWithSession } from '../testing/renderWithSession';
import { OfflineBanner } from './OfflineBanner';
import bannerCss from './OfflineBanner.module.css?raw';

const css = bannerCss.replace(/\/\*[\s\S]*?\*\//g, '');
const ENGLISH = 'Offline: saved here, sent when the signal is back';
const ITALIAN = 'Offline: salvo qui e invio appena torna la rete';

let onLine: MockInstance<() => boolean>;

beforeEach(() => {
  onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
});

afterEach(() => {
  onLine.mockRestore();
});

function goOffline() {
  onLine.mockReturnValue(false);
  act(() => { window.dispatchEvent(new Event('offline')); });
}

function goOnline() {
  onLine.mockReturnValue(true);
  act(() => { window.dispatchEvent(new Event('online')); });
}

describe('OfflineBanner', () => {
  // ⚠️ The live region is on the page BEFORE there is anything to say: a status element inserted
  // already filled in is announced unreliably (VoiceOver on iOS), text added to one is.
  it('keeps an empty live region while the phone is online, and shows nothing', () => {
    renderWithSession(<OfflineBanner />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.queryByText(ENGLISH)).not.toBeInTheDocument();
  });

  it('says so when the phone starts offline', () => {
    onLine.mockReturnValue(false);
    renderWithSession(<OfflineBanner />);
    expect(screen.getByRole('status')).toHaveTextContent(ENGLISH);
  });

  it('appears when the signal goes and goes when it is back', () => {
    renderWithSession(<OfflineBanner />);

    goOffline();
    expect(screen.getByRole('status')).toHaveTextContent(ENGLISH);

    goOnline();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.queryByText(ENGLISH)).not.toBeInTheDocument();
  });

  it('puts the words into the SAME live region that was on the page, never a new one', () => {
    renderWithSession(<OfflineBanner />);
    const region = screen.getByRole('status');

    goOffline();
    expect(screen.getByRole('status')).toBe(region);

    goOnline();
    expect(screen.getByRole('status')).toBe(region);
  });

  it('speaks Italian in an Italian venue', () => {
    onLine.mockReturnValue(false);
    renderWithSession(<OfflineBanner />, { lang: 'it' });
    expect(screen.getByRole('status')).toHaveTextContent(ITALIAN);
  });

  it('hides its icon from assistive technology: the sentence says it all', () => {
    onLine.mockReturnValue(false);
    renderWithSession(<OfflineBanner />);
    const svg = screen.getByRole('status').querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  // jsdom applies no media query, so the parts by width are pinned in the stylesheet's text
  // (without its comments, which talk about the very words searched for).
  it('is drawn by default, and from 700px hidden on every screen, where the top bar says it', () => {
    const [phone = '', tablet = ''] = css.split('@media (min-width: 700px)');
    expect(phone).toMatch(/\.banner\s*\{[^}]*display:\s*flex/);
    expect(phone).not.toMatch(/display:\s*none/);
    expect(tablet).toMatch(/\.banner\s*\{[^}]*display:\s*none/);
    expect(css).not.toContain('data-home');
  });

  it('sits in a row with its icon, centred on each other', () => {
    expect(css).toMatch(/\.banner\s*\{[^}]*align-items:\s*center/);
  });
});

describe('OfflineBanner under the title of every screen', () => {
  it('is drawn right under the h1, never above it', () => {
    onLine.mockReturnValue(false);
    renderApp('/orders');

    const main = within(screen.getByRole('main'));
    const banner = main.getByText(ENGLISH);
    const heading = main.getByRole('heading', { level: 1, name: 'Orders' });
    expect(heading.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps its empty live region under the title while online', () => {
    renderApp('/orders');

    const main = screen.getByRole('main');
    const heading = within(main).getByRole('heading', { level: 1, name: 'Orders' });
    const region = heading.closest('header')?.nextElementSibling;
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toBeEmptyDOMElement();
  });

  it('follows the connection while a screen is open', () => {
    renderApp('/orders');
    expect(within(screen.getByRole('main')).queryByText(ENGLISH)).not.toBeInTheDocument();

    goOffline();
    expect(within(screen.getByRole('main')).getByText(ENGLISH)).toBeInTheDocument();

    goOnline();
    expect(within(screen.getByRole('main')).queryByText(ENGLISH)).not.toBeInTheDocument();
  });

  it('is in Italian in an Italian venue', () => {
    onLine.mockReturnValue(false);
    renderApp('/orders', { lang: 'it' });
    expect(within(screen.getByRole('main')).getByText(ITALIAN)).toBeInTheDocument();
  });
});
