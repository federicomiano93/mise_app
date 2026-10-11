import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type { RouteObject } from 'react-router';
import { Navigate } from 'react-router';
import { RootError } from '../errors/RootError';
import { KEEP_FOCUS } from './Page';
import { renderApp } from '../testing/renderApp';
import { AppShell } from './AppShell';
import { SectionPlaceholder } from './SectionPlaceholder';

// jsdom applies no media query, so the rail and the tab bar are BOTH in the page. Every query
// is scoped to one of them.
const rail = (name = 'All sections') => within(screen.getByRole('navigation', { name }));
const tabs = (name = 'Main sections') => within(screen.getByRole('navigation', { name }));
const linkNames = (scope: { getAllByRole: (role: string) => HTMLElement[] }) =>
  scope.getAllByRole('link').map(link => link.textContent);

describe('AppShell: navigation', () => {
  it('sends / to Orders, current in both navigations', async () => {
    renderApp('/');

    expect(await screen.findByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
    expect(rail().getByRole('link', { name: 'Orders' })).toHaveAttribute('aria-current', 'page');
    expect(tabs().getByRole('link', { name: 'Orders' })).toHaveAttribute('aria-current', 'page');
  });

  it('lists the sections in the rail in order, Settings last', () => {
    renderApp('/orders');
    expect(linkNames(rail())).toEqual([
      'Orders', 'Suppliers', 'Recipes', 'Calculator', 'Pastries', 'Stocktake', 'Food cost', 'Settings',
    ]);
  });

  it('lists four sections and «More» in the tab bar', () => {
    renderApp('/orders');
    expect(linkNames(tabs())).toEqual(['Orders', 'Recipes', 'Calculator', 'Stocktake', 'More']);
  });

  it('opens a section from the rail without reloading the page', async () => {
    const { router, user } = renderApp('/orders');
    const addressBefore = window.location.href;

    await user.click(rail().getByRole('link', { name: 'Recipes' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Recipes' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/recipes');
    expect(rail().getByRole('link', { name: 'Recipes' })).toHaveAttribute('aria-current', 'page');
    expect(rail().getByRole('link', { name: 'Orders' })).not.toHaveAttribute('aria-current');
    expect(window.location.href).toBe(addressBefore);
  });

  it('opens a section from the tab bar', async () => {
    const { router, user } = renderApp('/orders');

    await user.click(tabs().getByRole('link', { name: 'Stocktake' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Stocktake' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/stocktake');
    expect(tabs().getByRole('link', { name: 'Stocktake' })).toHaveAttribute('aria-current', 'page');
  });

  it('marks «More» as current on a section that has no tab of its own', () => {
    renderApp('/suppliers');
    expect(rail().getByRole('link', { name: 'Suppliers' })).toHaveAttribute('aria-current', 'page');
    expect(tabs().getByRole('link', { name: 'More' })).toHaveAttribute('aria-current', 'page');
    expect(tabs().getByRole('link', { name: 'Orders' })).not.toHaveAttribute('aria-current');
  });

  it('keeps «More» out of the way on a section that has a tab', () => {
    renderApp('/recipes');
    expect(tabs().getByRole('link', { name: 'Recipes' })).toHaveAttribute('aria-current', 'page');
    expect(tabs().getByRole('link', { name: 'More' })).not.toHaveAttribute('aria-current');
  });

  it('lists the sections without a tab on the «More» page and opens them', async () => {
    const { user } = renderApp('/more');
    expect(screen.getByRole('heading', { level: 1, name: 'More' })).toBeInTheDocument();
    expect(tabs().getByRole('link', { name: 'More' })).toHaveAttribute('aria-current', 'page');

    const list = within(screen.getByRole('list'));
    expect(list.getAllByRole('link').map(link => link.textContent)).toEqual([
      'Suppliers', 'Pastries', 'Food cost', 'Settings',
    ]);

    await user.click(list.getByRole('link', { name: 'Pastries' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Pastries' })).toBeInTheDocument();
    expect(tabs().getByRole('link', { name: 'More' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows «Page not found» for an unknown address, with a way back to the start', async () => {
    const { router, user } = renderApp('/no-such-section');
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByText('This address doesn’t lead to any section.')).toBeInTheDocument();
    // The navigation is still around it.
    expect(rail().getAllByRole('link')).toHaveLength(8);

    await user.click(screen.getByRole('link', { name: 'Go to the start' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/orders');
  });
});

describe('AppShell: landmarks and the skip link', () => {
  // The account avatar has a landmark of its own: content outside every landmark is skipped by
  // people who move from landmark to landmark (axe «region»).
  it('has one main landmark, one h1, and three named navigations', () => {
    renderApp('/orders');
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('navigation').map(nav => nav.getAttribute('aria-label')))
      .toEqual(['All sections', 'Account', 'Main sections']);
  });

  it('has a skip link that points at the main content', () => {
    renderApp('/orders');
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('moves focus to the content when the skip link is used, and does not change the page', async () => {
    const { router, user } = renderApp('/recipes');

    await user.click(screen.getByRole('link', { name: 'Skip to content' }));

    expect(screen.getByRole('main')).toHaveFocus();
    // Under hash routing the default action would turn «#main» into the page /main.
    expect(router.state.location.pathname).toBe('/recipes');
    expect(screen.getByRole('heading', { level: 1, name: 'Recipes' })).toBeInTheDocument();
  });

  it('cancels the link\'s own navigation, which under hash routing would be the page /main', () => {
    renderApp('/orders');
    const notCancelled = fireEvent.click(screen.getByRole('link', { name: 'Skip to content' }));
    expect(notCancelled).toBe(false);
  });

  it('makes the skip link the first stop of the keyboard', async () => {
    const { user } = renderApp('/orders');
    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();
  });

  it('sets the tab title from the page', () => {
    renderApp('/orders');
    expect(document.title).toBe('Orders · Mise');
  });

  it('follows the page in the tab title', async () => {
    const { user } = renderApp('/orders');
    await user.click(rail().getByRole('link', { name: 'Suppliers' }));
    await screen.findByRole('heading', { level: 1, name: 'Suppliers' });
    expect(document.title).toBe('Suppliers · Mise');
  });
});

describe('AppShell: focus after a navigation', () => {
  it('leaves the focus alone on first load', () => {
    renderApp('/orders');
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveFocus();
  });

  it('leaves the focus alone when / redirects to Orders on first load', async () => {
    const { user } = renderApp('/');
    const heading = await screen.findByRole('heading', { level: 1, name: 'Orders' });
    expect(heading).not.toHaveFocus();
    // So the first Tab still reaches the skip link.
    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();
  });

  it('moves the focus to the new screen\'s title after a navigation', async () => {
    const { user } = renderApp('/orders');

    await user.click(rail().getByRole('link', { name: 'Recipes' }));

    const heading = await screen.findByRole('heading', { level: 1, name: 'Recipes' });
    expect(heading).toHaveFocus();
  });

  it('does not move the focus on Back', async () => {
    const { router, user } = renderApp('/orders');
    await user.click(rail().getByRole('link', { name: 'Recipes' }));
    await screen.findByRole('heading', { level: 1, name: 'Recipes' });
    await user.click(screen.getByRole('link', { name: 'Skip to content' }));
    expect(screen.getByRole('main')).toHaveFocus();

    await act(async () => { await router.navigate(-1); });

    const heading = await screen.findByRole('heading', { level: 1, name: 'Orders' });
    expect(heading).not.toHaveFocus();
  });

  it('keeps the focus where it is when a navigation is marked KEEP_FOCUS', async () => {
    const routes: RouteObject[] = [{
      path: '/',
      element: <AppShell />,
      children: [
        { path: 'orders', element: <SectionPlaceholder sectionId="orders" /> },
        { path: 'go', element: <Navigate to="/orders" replace state={KEEP_FOCUS} /> },
      ],
    }];
    renderApp('/go', { routes });
    const heading = await screen.findByRole('heading', { level: 1, name: 'Orders' });
    expect(heading).not.toHaveFocus();
  });
});

describe('AppShell: top bar', () => {
  let onLine: MockInstance<() => boolean>;

  beforeEach(() => {
    // Only Date: the user-event clicks and the router keep their real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 10, 12, 0, 0));
    onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
  });

  afterEach(() => {
    onLine.mockRestore();
    vi.useRealTimers();
  });

  it('shows today\'s date', () => {
    renderApp('/orders');
    expect(screen.getByText('Saturday 10 October')).toBeInTheDocument();
  });

  it('shows when the device is online and when it is not', () => {
    renderApp('/orders');
    expect(screen.getByText('Online')).toBeInTheDocument();

    onLine.mockReturnValue(false);
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(screen.getByText('No connection')).toBeInTheDocument();
    expect(screen.queryByText('Online')).not.toBeInTheDocument();

    onLine.mockReturnValue(true);
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.queryByText('No connection')).not.toBeInTheDocument();
  });

  it('announces a change of connection politely', () => {
    renderApp('/orders');
    expect(screen.getByText('Online').closest('[role="status"]')).not.toBeNull();
  });
});

describe('AppShell: the date rolls over at midnight', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the next day a minute after midnight, with the tablet left open', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(2026, 9, 10, 23, 59, 30));
    renderApp('/orders');
    expect(screen.getByText('Saturday 10 October')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(60_000); });

    expect(screen.getByText('Sunday 11 October')).toBeInTheDocument();
    expect(screen.queryByText('Saturday 10 October')).not.toBeInTheDocument();
  });

  it('refreshes at once when the tablet is woken', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(2026, 9, 10, 23, 59, 30));
    renderApp('/orders');

    vi.setSystemTime(new Date(2026, 9, 11, 7, 0, 0));
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(screen.getByText('Sunday 11 October')).toBeInTheDocument();
  });
});

describe('AppShell: Italian', () => {
  it('draws every label in Italian and sets the document language', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 10, 12, 0, 0));
    try {
      renderApp('/', { lang: 'it' });

      expect(await screen.findByRole('heading', { level: 1, name: 'Ordini' })).toBeInTheDocument();
      expect(linkNames(rail('Tutte le sezioni'))).toEqual([
        'Ordini', 'Fornitori', 'Ricette', 'Calcolatore', 'Paste', 'Magazzino', 'Food cost', 'Impostazioni',
      ]);
      expect(linkNames(tabs('Sezioni principali'))).toEqual([
        'Ordini', 'Ricette', 'Calcolatore', 'Magazzino', 'Altro',
      ]);
      expect(screen.getByText('sabato 10 ottobre')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Vai al contenuto' })).toBeInTheDocument();
      expect(document.documentElement.lang).toBe('it');
      expect(document.title).toBe('Ordini · Mise');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AppShell: a section that fails', () => {
  let logged: MockInstance;
  // The Recipes route throws while this is true; a spec "repairs" it by setting it false.
  let broken = true;

  beforeEach(() => {
    broken = true;
    // React and React Router log every render error they catch; this one is expected.
    logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logged.mockRestore();
  });

  function BrokenRecipes() {
    if (broken) throw new Error('this section is broken');
    return <SectionPlaceholder sectionId="recipes" />;
  }

  const routes: RouteObject[] = [{
    path: '/',
    element: <AppShell />,
    errorElement: <RootError />,
    children: [
      { path: 'orders', element: <SectionPlaceholder sectionId="orders" /> },
      { path: 'recipes', element: <BrokenRecipes /> },
    ],
  }];

  it('says so inside the content, keeps the navigation, and recovers on another section', async () => {
    const { user } = renderApp('/orders', { routes });

    await user.click(rail().getByRole('link', { name: 'Recipes' }));

    const main = within(screen.getByRole('main'));
    // Not getByRole('status') alone: the offline banner keeps an (empty) status region of its own.
    expect(main.getByText('This part didn’t load.').closest('[role="status"]')).not.toBeNull();
    expect(main.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    // The whole-app error screen is NOT what is showing.
    expect(screen.queryByRole('heading', { name: 'Mise stopped working.' })).not.toBeInTheDocument();
    expect(rail().getAllByRole('link')).toHaveLength(8);

    await user.click(rail().getByRole('link', { name: 'Orders' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).queryByText('This part didn’t load.')).not.toBeInTheDocument();
  });

  it('keeps the title of the screen, its one h1 and the focus move while the section is down', async () => {
    const { user } = renderApp('/orders', { routes });
    expect(document.title).toBe('Orders · Mise');

    await user.click(rail().getByRole('link', { name: 'Recipes' }));

    expect(document.title).toBe('Recipes · Mise');
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Recipes');
    expect(headings[0]).toHaveFocus();
  });

  it('names a section that fails in Italian too', () => {
    renderApp('/recipes', { routes, lang: 'it' });
    expect(screen.getByRole('heading', { level: 1, name: 'Ricette' })).toBeInTheDocument();
    expect(document.title).toBe('Ricette · Mise');
  });

  it('puts the focus on the heading of the restored screen after Reload, not on the page body', async () => {
    // Opened directly (a first load), so no navigation moved the focus anywhere yet.
    const { user } = renderApp('/recipes', { routes });
    expect(within(screen.getByRole('main')).getByText('This part didn’t load.')).toBeInTheDocument();

    broken = false;
    await user.click(screen.getByRole('button', { name: 'Reload' }));

    const heading = await screen.findByRole('heading', { level: 1, name: 'Recipes' });
    expect(within(screen.getByRole('main')).queryByText('This part didn’t load.')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(heading);
    expect(document.title).toBe('Recipes · Mise');
  });
});
