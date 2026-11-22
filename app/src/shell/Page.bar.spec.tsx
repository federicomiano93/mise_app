import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router';
import { en } from '../i18n/en';
import { I18nProvider } from '../i18n/I18nProvider';
import { renderApp } from '../testing/renderApp';
import { Page } from './Page';
import { TitleSlotContext } from './titleSlot';

// THE SINGLE BAR (22 Nov 2026): from 700px a Page draws its title (and its gear) into the shell's top bar through a portal. jsdom has no
// matchMedia, so every spec here stubs it to «matches», as a window of 700px or more.
const original = window.matchMedia;
beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => { window.matchMedia = original; });

const bar = () => document.querySelector('header') as HTMLElement;

function Frame({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <TitleSlotContext.Provider value={slot}>
      <header ref={setSlot} data-testid="bar" />
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
    await user.click(screen.getByRole('button', { name: 'Pop' }));
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

describe('a Page with no bar to draw into (a window under 700px, or no shell)', () => {
  it('draws everything in the page, as on a phone', () => {
    window.matchMedia = original;
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
