import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { LOAD, configOf, onlyFocaccia, renderCalculator } from '../testing/renderCalculator';

// What can be done with a confirmed recipe: full screen with a text size, copy, send.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

// 4 trays of 500 g: a 2,000 g dough, confirmed (the current app's own keys), so the recipe is on screen.
beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('qty-roma::tray', '4');
  window.localStorage.setItem('revealed-focaccia', '1');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'clipboard');
  window.localStorage.clear();
});

const main = () => within(screen.getByRole('main'));
const fullScreenButton = () => main().getByRole('button', { name: 'Full screen' });
const view = () => screen.queryByRole('dialog', { name: 'Focaccia' });

async function open(config: Record<string, unknown> = onlyFocaccia(), lang: 'en' | 'it' = 'en') {
  const source = fakeCalculatorSource({ config });
  const rendered = renderCalculator('/calculator/focaccia', { source, lang });
  await main().findByRole('region', { name: lang === 'it' ? 'Impasto Focaccia' : 'Focaccia dough' }, LOAD);
  return { ...rendered, source };
}

// The recipe's exact text for 2,000 g, as the copy and the mail carry it.
const RECIPE_TEXT_START = `FOCACCIA  2.0 kg\n${'-'.repeat(22)}\nFlour:`;

describe('the full-screen view', () => {
  it('opens from the visible button, labelled by the recipe, with only the rows and the total', async () => {
    const { user } = await open();
    expect(view()).not.toBeInTheDocument();
    await user.click(fullScreenButton());
    const dialog = within(screen.getByRole('dialog', { name: 'Focaccia' }));
    expect(dialog.getAllByRole('listitem').map(row => row.textContent)).toEqual(['Flour1,159 g', 'Water812 g', 'Salt23 g', 'Yeast6 g']);
    expect(dialog.getByText('Total dough')).toBeInTheDocument();
    expect(dialog.getByText('2,000 g')).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: /Copy|Send/ })).not.toBeInTheDocument();
  });

  it('opens from a tap on the ingredient list and on the total line', async () => {
    const { user } = await open();
    await user.click(main().getByText('Flour'));
    expect(view()).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Exit full screen' }));
    expect(view()).not.toBeInTheDocument();
    await user.click(main().getByText('Total dough'));
    expect(view()).toBeInTheDocument();
  });

  it('is never opened by Copy or Send', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(() => Promise.resolve()) }, configurable: true });
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { user } = await open();
    await user.click(main().getByRole('button', { name: 'Copy recipe' }));
    expect(view()).not.toBeInTheDocument();
    await user.click(main().getByRole('button', { name: 'Send' }));
    expect(view()).not.toBeInTheDocument();
  });

  it('puts the focus on the ×, and gives it back to the button that opened it', async () => {
    const { user } = await open();
    await user.click(fullScreenButton());
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Exit full screen' }));
    expect(view()).not.toBeInTheDocument();
    expect(fullScreenButton()).toHaveFocus();
  });

  it('closes with Escape', async () => {
    const { user } = await open();
    await user.click(fullScreenButton());
    await user.keyboard('{Escape}');
    expect(view()).not.toBeInTheDocument();
    expect(fullScreenButton()).toHaveFocus();
  });

  it('closes when the configuration changes under it: it is a copy of the old grams', async () => {
    const { user, source } = await open();
    await user.click(fullScreenButton());
    expect(view()).toBeInTheDocument();
    act(() => { source.config = onlyFocaccia({ logRetentionHours: 48 }); source.push(); });
    await waitFor(() => { expect(view()).not.toBeInTheDocument(); });
  });

  // ⚠️ jsdom has no inertness, so it cannot show that focus() on the opener fails while the modal dialog is
  // still open. What it can show is the ORDER: the dialog is closed before the opener is focused, on every road
  // out (the ×, Escape, and a configuration that changes under it).
  it.each([
    ['the ×', async (ctx: Awaited<ReturnType<typeof open>>) => { await ctx.user.click(screen.getByRole('button', { name: 'Exit full screen' })); }],
    ['Escape', async (ctx: Awaited<ReturnType<typeof open>>) => { await ctx.user.keyboard('{Escape}'); }],
    ['a configuration change', (ctx: Awaited<ReturnType<typeof open>>) => {
      act(() => { ctx.source.config = onlyFocaccia({ logRetentionHours: 48 }); ctx.source.push(); });
      return Promise.resolve();
    }],
  ])('closes the dialog BEFORE it focuses the opener: %s', async (_name, leave) => {
    const ctx = await open();
    await ctx.user.click(fullScreenButton());
    const order: string[] = [];
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function close(this: HTMLDialogElement) {
      order.push('close');
      this.removeAttribute('open');
    });
    vi.spyOn(fullScreenButton(), 'focus').mockImplementation(() => { order.push('focus'); });
    await leave(ctx);
    await waitFor(() => { expect(order).toContain('focus'); });
    expect(order).toEqual(['close', 'focus']);
  });

  it('says its buttons in Italian', async () => {
    const { user } = await open(onlyFocaccia(), 'it');
    await user.click(main().getByRole('button', { name: 'Schermo intero' }));
    expect(screen.getByRole('button', { name: 'Esci dallo schermo intero' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Testo più piccolo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Testo più grande' })).toBeInTheDocument();
  });
});

describe('the text size', () => {
  const size = () => (view() as HTMLElement).style.fontSize;

  it('starts at the default step and goes up and down in steps, remembered in the shared key', async () => {
    const { user } = await open();
    await user.click(fullScreenButton());
    expect(size()).toBe('calc(var(--fs-2xl) * 1)');
    await user.click(screen.getByRole('button', { name: 'Larger text' }));
    expect(size()).toBe('calc(var(--fs-2xl) * 1.2)');
    expect(window.localStorage.getItem('mise.calcZoomStep')).toBe('2');
    await user.click(screen.getByRole('button', { name: 'Smaller text' }));
    await user.click(screen.getByRole('button', { name: 'Smaller text' }));
    expect(size()).toBe('calc(var(--fs-2xl) * 0.8)');
    expect(window.localStorage.getItem('mise.calcZoomStep')).toBe('0');
  });

  it('stops at both ends with aria-disabled (never disabled), and a press there changes nothing', async () => {
    const { user } = await open();
    await user.click(fullScreenButton());
    const smaller = screen.getByRole('button', { name: 'Smaller text' });
    const larger = screen.getByRole('button', { name: 'Larger text' });
    await user.click(smaller);
    expect(smaller).toHaveAttribute('aria-disabled', 'true');
    expect(smaller).toBeEnabled();
    await user.click(smaller);
    expect(window.localStorage.getItem('mise.calcZoomStep')).toBe('0');
    for (let i = 0; i < 7; i += 1) await user.click(larger);
    expect(larger).toHaveAttribute('aria-disabled', 'true');
    expect(window.localStorage.getItem('mise.calcZoomStep')).toBe('5');
    expect(size()).toBe('calc(var(--fs-2xl) * 2.1)');
  });

  it('remembers the size for the next time', async () => {
    window.localStorage.setItem('mise.calcZoomStep', '3');
    const { user } = await open();
    await user.click(fullScreenButton());
    expect(size()).toBe('calc(var(--fs-2xl) * 1.45)');
  });

  it.each(['9', 'x', '-1', '2.5', ''])('reads a damaged step (%j) as the default, never an extreme', async stored => {
    window.localStorage.setItem('mise.calcZoomStep', stored);
    const { user } = await open();
    await user.click(fullScreenButton());
    expect(size()).toBe('calc(var(--fs-2xl) * 1)');
  });

  it('works with a storage that throws', async () => {
    const { user } = await open();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    await user.click(fullScreenButton());
    expect(size()).toBe('calc(var(--fs-2xl) * 1)');
    await user.click(screen.getByRole('button', { name: 'Larger text' }));
    expect(size()).toBe('calc(var(--fs-2xl) * 1.2)');
  });
});

describe('Copy', () => {
  // ⚠️ AFTER renderApp: user-event's setup() puts a clipboard of its own on the navigator.
  function clipboard(writeText: (text: string) => Promise<void>) {
    const spy = vi.fn(writeText);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: spy }, configurable: true });
    return spy;
  }

  it('puts the recipe\'s text on the clipboard and says «Copied» for two seconds', async () => {
    await open();
    const write = clipboard(() => Promise.resolve());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(main().getByRole('button', { name: 'Copy recipe' }));
    await act(async () => { await Promise.resolve(); });
    expect(write).toHaveBeenCalledTimes(1);
    expect(String(write.mock.calls[0]?.[0])).toContain('FOCACCIA  2.0 kg');
    expect(String(write.mock.calls[0]?.[0]).startsWith(RECIPE_TEXT_START)).toBe(true);
    expect(main().getByRole('button', { name: 'Copied ✓' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1999); });
    expect(main().getByRole('button', { name: 'Copied ✓' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2); });
    expect(main().getByRole('button', { name: 'Copy recipe' })).toBeInTheDocument();
  });

  it('says it could not copy when the clipboard refuses', async () => {
    const { user } = await open();
    clipboard(() => Promise.reject(new Error('denied')));
    await user.click(main().getByRole('button', { name: 'Copy recipe' }));
    expect(await main().findByRole('button', { name: 'Could not copy — select the text above instead' }, LOAD)).toBeInTheDocument();
  });

  it('does not wait for ever on a clipboard that never answers: after two seconds it says it failed', async () => {
    await open();
    clipboard(() => new Promise<void>(() => undefined));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(main().getByRole('button', { name: 'Copy recipe' }));
    await act(async () => { await Promise.resolve(); });
    expect(main().getByRole('button', { name: 'Copy recipe' })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(2000); await Promise.resolve(); });
    expect(main().getByRole('button', { name: 'Could not copy — select the text above instead' })).toBeInTheDocument();
  });

  it('says «Copied» in Italian', async () => {
    const { user } = await open(onlyFocaccia(), 'it');
    clipboard(() => Promise.resolve());
    await user.click(main().getByRole('button', { name: 'Copia la ricetta' }));
    expect(await main().findByRole('button', { name: 'Copiato ✓' }, LOAD)).toBeInTheDocument();
  });
});

describe('Send', () => {
  it('is an arrow named «Send», with no brand on it', async () => {
    await open();
    const arrow = main().getByRole('button', { name: 'Send' });
    expect(arrow.textContent).toBe('');
    expect(arrow.getAttribute('aria-label')).not.toMatch(/whatsapp|email|mail/i);
  });

  it('asks which road, then opens WhatsApp with the recipe, with no recipient', async () => {
    const open_ = vi.spyOn(window, 'open').mockReturnValue(null);
    const { user } = await open();
    await user.click(main().getByRole('button', { name: 'Send' }));
    const sheet = within(await screen.findByRole('dialog', { name: 'How do you want to send it?' }));
    await user.click(sheet.getByRole('button', { name: /^WhatsApp/ }));
    expect(open_).toHaveBeenCalledTimes(1);
    const [url, target, features] = open_.mock.calls[0] ?? [];
    expect(String(url).startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(String(url).slice('https://wa.me/?text='.length)).startsWith(RECIPE_TEXT_START)).toBe(true);
    expect([target, features]).toEqual(['_blank', 'noopener']);
  });

  it('opens the mail app with the dough\'s name as the subject', async () => {
    const open_ = vi.spyOn(window, 'open').mockReturnValue(null);
    const { user } = await open();
    await user.click(main().getByRole('button', { name: 'Send' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Email/ }));
    expect(String(open_.mock.calls[0]?.[0]).startsWith('mailto:?subject=Focaccia&body=')).toBe(true);
  });

  it('opens nothing when the sheet is cancelled', async () => {
    const open_ = vi.spyOn(window, 'open').mockReturnValue(null);
    const { user } = await open();
    await user.click(main().getByRole('button', { name: 'Send' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(open_).not.toHaveBeenCalled();
  });

  it('is not there when the recipe cannot be calculated', async () => {
    window.localStorage.setItem('qty-roma::tray', '0');
    window.localStorage.setItem('total-brioche', '0');
    const source = fakeCalculatorSource({ config: configOf({ recipes: [] }) });
    renderCalculator('/calculator', { source });
    await screen.findByText('No recipes yet', undefined, LOAD);
    expect(main().queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });
});
