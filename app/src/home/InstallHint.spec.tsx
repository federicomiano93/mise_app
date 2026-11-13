import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithSession } from '../testing/renderWithSession';
import { guidePage } from '../session/installGuide';
import { InstallHint } from './InstallHint';

// After a join, ONCE, on the Home: «Add the app to your phone» (staff slice 2, a port of js/install-hint-boot.js). The join
// marks `just-joined`; the Home asks, spends it as it asks, and «Show me how» goes to the current app's guide page.

const KEY = 'just-joined';
const standalone = (installed: boolean) => {
  // jsdom has no matchMedia of its own.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: installed && query === '(display-mode: standalone)', media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList);
};

beforeEach(() => {
  window.localStorage.clear();
  standalone(false);
  vi.spyOn(guidePage, 'open').mockImplementation(() => {});
});
afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('InstallHint', () => {
  test('somebody who has just joined, in a browser tab: asked once; «Show me how» goes to the guide', async () => {
    window.localStorage.setItem(KEY, '1');
    const { user } = renderWithSession(<InstallHint />);
    // Not at the very first moment: the Home settles first, and the notice is not spent yet.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBe('1');
    const dialog = await screen.findByRole('alertdialog', { name: 'Add the app to your phone' });
    expect(dialog).toHaveTextContent('You are in — but the app is running inside your browser.');
    // ⚠️ Spent as it is asked: an app closed now does not ask again.
    expect(window.localStorage.getItem(KEY)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show me how' }));
    expect(guidePage.open).toHaveBeenCalledOnce();
  });

  test('«Not now» goes nowhere, and it is not asked again', async () => {
    window.localStorage.setItem(KEY, '1');
    const { user, unmount } = renderWithSession(<InstallHint />);
    await user.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(guidePage.open).not.toHaveBeenCalled();
    unmount();
    vi.useFakeTimers();
    renderWithSession(<InstallHint />);
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  test('nobody just joined: nothing, ever', () => {
    vi.useFakeTimers();
    renderWithSession(<InstallHint />);
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  test('already the installed app: nothing, and the flag is dropped', () => {
    standalone(true);
    window.localStorage.setItem(KEY, '1');
    vi.useFakeTimers();
    renderWithSession(<InstallHint />);
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    vi.useRealTimers();
  });

  test('a Home left at once does not spend it', () => {
    window.localStorage.setItem(KEY, '1');
    vi.useFakeTimers();
    const { unmount } = renderWithSession(<InstallHint />);
    unmount();
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(window.localStorage.getItem(KEY)).toBe('1');
    vi.useRealTimers();
  });

  test('in Italian', async () => {
    window.localStorage.setItem(KEY, '1');
    renderWithSession(<InstallHint />, { lang: 'it' });
    expect(await screen.findByRole('alertdialog', { name: 'Aggiungi l’app al telefono' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Come si fa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Non ora' })).toBeInTheDocument();
  });
});
