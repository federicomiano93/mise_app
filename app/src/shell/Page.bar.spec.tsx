import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router';
import { en } from '../i18n/en';
import { I18nProvider } from '../i18n/I18nProvider';
import { PartBoundary } from '../errors/PartBoundary';
import { renderApp } from '../testing/renderApp';
import { Page } from './Page';
import { TITLE_SLOT_ATTRIBUTE, TitleSlotContext } from './titleSlot';

// THE SINGLE BAR (22 Nov 2026): from 700px a Page draws its title (and its gear) into the shell's top bar through a portal. jsdom has no
// matchMedia, so every spec here stubs it to «matches», as a window of 700px or more.
const original = window.matchMedia;
let wide = true;
const listeners = new Set<() => void>();
// Crosses 700px the way a resized window does: the answer changes and every subscriber is told.
const resizeTo = (isWide: boolean): void => {
  wide = isWide;
  act(() => { listeners.forEach(listener => { listener(); }); });
};
beforeEach(() => {
  wide = true;
  window.matchMedia = ((query: string) => ({
    get matches() { return wide; },
    media: query,
    addEventListener: (_type: string, listener: () => void) => { listeners.add(listener); },
    removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener); },
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => { window.matchMedia = original; listeners.clear(); });

const bar = () => document.querySelector('header') as HTMLElement;

function Frame({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <TitleSlotContext.Provider value={slot}>
      <header ref={setSlot} data-testid="bar" {...{ [TITLE_SLOT_ATTRIBUTE]: '' }} />
      <main>{children}</main>
    </TitleSlotContext.Provider>
  );
}

function Mover() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => { void navigate('/next'); }}>Push</button>
      <button type="button" onClick={() => { void navigate(-1); }}>Pop</button>
    </>
  );
}

function draw(ui: ReactNode, entries: string[] = ['/']) {
  return render(
    <I18nProvider initialLanguage="en" initialMessages={en}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}><Frame>{ui}</Frame></MemoryRouter>
    </I18nProvider>,
  );
}

describe('a Page with a top bar to draw into, from 700px', () => {
  it('draws its one h1 and its gear in the bar, and nothing above its content', () => {
    draw(<Page title="Cakes" gear={<button type="button">Gear</button>}><p>Body</p></Page>);
    const h1 = screen.getByRole('heading', { level: 1, name: 'Cakes' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(bar()).toContainElement(h1);
    expect(h1).toHaveAttribute('tabindex', '-1');
    const gear = screen.getByRole('button', { name: 'Gear' });
    expect(bar()).toContainElement(gear);
    expect(h1.compareDocumentPosition(gear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No header of its own in the page: the content starts 24px under the bar.
    expect(within(screen.getByRole('main')).queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.getByText('Body').parentElement?.className).toMatch(/bodyTop/);
  });

  it('keeps a band\'s other controls in the page, under the bar, as a row', () => {
    draw(<Page title="Orders" gear={<button type="button">Gear</button>} band={<button type="button">History</button>} stickyBand bandWraps><p>Body</p></Page>);
    const history = screen.getByRole('button', { name: 'History' });
    expect(bar()).not.toContainElement(history);
    expect(screen.getByRole('main')).toContainElement(history);
    expect(bar()).toContainElement(screen.getByRole('button', { name: 'Gear' }));
    expect(history.parentElement?.className).toMatch(/barRow/);
    expect(history.parentElement?.className).toMatch(/stickyBand/);
  });

  it('keeps an action in the page, on a row of its own, and the title in the bar', () => {
    draw(<Page title="Settings" action={<button type="button">Log out</button>}><p>Body</p></Page>);
    expect(bar()).toContainElement(screen.getByRole('heading', { level: 1, name: 'Settings' }));
    const action = screen.getByRole('button', { name: 'Log out' });
    expect(bar()).not.toContainElement(action);
    expect(screen.getByRole('main')).toContainElement(action);
  });

  it('moves the focus to the h1 in the bar after a push, and not after Back', async () => {
    const user = userEvent.setup();
    draw(<><Mover /><Page title="Cakes"><p>Body</p></Page></>);
    const h1 = screen.getByRole('heading', { level: 1, name: 'Cakes' });
    expect(h1).not.toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Push' }));
    expect(h1).toHaveFocus();
    // Focus is somewhere else (the button just pressed): Back must leave it exactly there.
    const pop = screen.getByRole('button', { name: 'Pop' });
    pop.focus();
    await user.click(pop);
    expect(pop).toHaveFocus();
    expect(h1).not.toHaveFocus();
  });

  it('with its own heading (a booking): the section\'s name is plain text in the bar, with no gear, and the screen\'s h1 is the only one', () => {
    draw(
      <Page title="Bookings" ownHeading gear={<button type="button">Gear</button>} band={<button type="button">Other</button>}>
        <h1>Maria Rossi</h1>
      </Page>,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Maria Rossi');
    expect(bar()).toHaveTextContent('Bookings');
    expect(within(bar()).queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gear' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Other' })).not.toBeInTheDocument();
  });
});

describe('a window that crosses 700px', () => {
  it('keeps the section\'s content (an input half typed in) when the layout moves the title between the bar and the page', async () => {
    const user = userEvent.setup();
    draw(<Page title="Cakes" gear={<button type="button">Gear</button>}><input aria-label="Notes" /></Page>);
    await user.type(screen.getByRole('textbox', { name: 'Notes' }), 'half typed');
    const input = screen.getByRole('textbox', { name: 'Notes' });
    resizeTo(false);
    // The title is now in the page, and the very same input is still there, with its text.
    expect(screen.getByRole('heading', { level: 1, name: 'Cakes' }).closest('header')).toContainElement(screen.getByRole('button', { name: 'Gear' }));
    expect(bar()).toBeEmptyDOMElement();
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBe(input);
    expect(input).toHaveValue('half typed');
    resizeTo(true);
    expect(bar()).toContainElement(screen.getByRole('heading', { level: 1, name: 'Cakes' }));
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBe(input);
    expect(input).toHaveValue('half typed');
  });
});

describe('a phone\'s title bar with a gear and an action', () => {
  it('draws both: the gear beside the title, the action after them', () => {
    resizeTo(false);
    draw(<Page title="Settings" gear={<button type="button">Gear</button>} action={<button type="button">Log out</button>}><p>Body</p></Page>);
    const h1 = screen.getByRole('heading', { level: 1, name: 'Settings' });
    const gear = screen.getByRole('button', { name: 'Gear' });
    const action = screen.getByRole('button', { name: 'Log out' });
    const head = h1.parentElement as HTMLElement;
    expect(head).toContainElement(gear);
    expect(head).toContainElement(action);
    expect(h1.compareDocumentPosition(gear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gear.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('a boundary inside a Page, and the focus after its Reload', () => {
  let broken = true;
  function Flaky() {
    if (broken) throw new Error('this part is broken');
    return <p>the part works</p>;
  }

  it('a titled PartBoundary inside a Page draws its notice without a second title or a second h1', () => {
    broken = true;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    draw(<Page title="Bookings"><PartBoundary title="Bookings"><Flaky /></PartBoundary></Page>);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(within(bar()).getAllByText('Bookings')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('This part didn’t load.');
    logged.mockRestore();
  });

  it('a titled PartBoundary standing alone still draws its own Page, with the title in the bar', () => {
    broken = true;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    draw(<PartBoundary title="Cakes"><Flaky /></PartBoundary>);
    expect(bar()).toContainElement(screen.getByRole('heading', { level: 1, name: 'Cakes' }));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    logged.mockRestore();
  });

  it('after Reload the focus goes to the screen\'s h1 in the bar, outside the boundary\'s own container', async () => {
    broken = true;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    function Screen() {
      if (broken) throw new Error('this screen is broken');
      return <Page title="Cakes"><p>the screen works</p></Page>;
    }
    draw(<PartBoundary title="Cakes"><Screen /></PartBoundary>);
    broken = false;
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(screen.getByText('the screen works')).toBeInTheDocument();
    const h1 = screen.getByRole('heading', { level: 1, name: 'Cakes' });
    expect(bar()).toContainElement(h1);
    expect(h1).toHaveFocus();
    logged.mockRestore();
  });
});

describe('the slot', () => {
  it('is marked in the shell with the attribute the focus helpers look for', async () => {
    renderApp('/home');
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    expect(document.querySelector(`[${TITLE_SLOT_ATTRIBUTE}] h1`)).not.toBeNull();
  });
});

describe('a Page with no bar to draw into (a window under 700px, or no shell)', () => {
  it('draws everything in the page, as on a phone', () => {
    resizeTo(false);
    draw(<Page title="Cakes" gear={<button type="button">Gear</button>}><p>Body</p></Page>);
    expect(bar()).toBeEmptyDOMElement();
    const head = screen.getByRole('heading', { level: 1, name: 'Cakes' }).parentElement as HTMLElement;
    expect(head.tagName).toBe('HEADER');
    expect(head).toContainElement(screen.getByRole('button', { name: 'Gear' }));
  });
});

describe('the app on a tablet-wide window', () => {
  it('Orders: the title and the settings gear are in the top bar, the other controls under it in the page', async () => {
    renderApp('/orders');
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Orders' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const header = h1.closest('header') as HTMLElement;
    expect(within(header).getByText('Online')).toBeInTheDocument();
    expect(await within(header).findByRole('button', { name: 'Orders settings' })).toBeInTheDocument();
    const history = screen.getByRole('button', { name: 'History' });
    expect(header).not.toContainElement(history);
    expect(screen.getByRole('main')).toContainElement(history);
  });

  it('Settings: «Log out» stays in the page', async () => {
    renderApp('/settings');
    const header = (await screen.findByRole('heading', { level: 1, name: 'Settings' })).closest('header') as HTMLElement;
    const logOut = screen.getByRole('button', { name: 'Log out' });
    expect(header).not.toContainElement(logOut);
  });

  it('Home: its title is in the bar too, and the page has one h1', async () => {
    renderApp('/home');
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Home' });
    expect(h1.closest('header')).toContainElement(screen.getByText('Online'));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
