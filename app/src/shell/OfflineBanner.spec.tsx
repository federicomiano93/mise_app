import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { renderApp } from '../testing/renderApp';
import { renderWithSession } from '../testing/renderWithSession';
import { OfflineBanner } from './OfflineBanner';
import bannerCss from './OfflineBanner.module.css?raw';

const css = bannerCss.replace(/\/\*[\s\S]*?\*\//g, '');
const ENGLISH ='No connection. What you change stays on this phone and is sent when the signal is back.';
const ITALIAN = 'Nessuna connessione. Quello che cambi resta sul telefono e parte appena torna la rete.';

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

  // jsdom applies no media query, so the phone-only part is pinned in the stylesheet's text
  // (without its comments, which talk about the very words searched for).
  it('is drawn by default and hidden from 700px, where the top bar says it', () => {
    const [phone = '', tablet = ''] = css.split('@media (min-width: 700px)');
    expect(phone).toMatch(/\.banner\s*\{[^}]*display:\s*flex/);
    expect(phone).not.toMatch(/display:\s*none/);
    expect(tablet).toMatch(/\.banner\s*\{[^}]*display:\s*none/);
  });

  it('sits in a row with its icon, centred on each other', () => {
    expect(css).toMatch(/\.banner\s*\{[^}]*align-items:\s*center/);
  });
});

describe('OfflineBanner in the shell', () => {
  it('is drawn at the top of the content, above the screen', () => {
    onLine.mockReturnValue(false);
    renderApp('/orders');

    const main = within(screen.getByRole('main'));
    const banner = main.getByText(ENGLISH);
    const heading = main.getByRole('heading', { level: 1, name: 'Orders' });
    expect(banner.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps its empty live region at the top of the content while online', () => {
    renderApp('/orders');

    const main = screen.getByRole('main');
    const region = main.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region).toBeEmptyDOMElement();
    const heading = within(main).getByRole('heading', { level: 1, name: 'Orders' });
    expect((region?.compareDocumentPosition(heading) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('follows the connection while a screen is open, and the top bar still says it too', () => {
    renderApp('/orders');
    expect(within(screen.getByRole('main')).queryByText(ENGLISH)).not.toBeInTheDocument();

    goOffline();
    expect(within(screen.getByRole('main')).getByText(ENGLISH)).toBeInTheDocument();
    // The top bar's own words, for the tablet.
    expect(screen.getByText('No connection')).toBeInTheDocument();

    goOnline();
    expect(within(screen.getByRole('main')).queryByText(ENGLISH)).not.toBeInTheDocument();
  });

  it('is in Italian in the shell of an Italian venue', () => {
    onLine.mockReturnValue(false);
    renderApp('/orders', { lang: 'it' });
    expect(within(screen.getByRole('main')).getByText(ITALIAN)).toBeInTheDocument();
  });
});
