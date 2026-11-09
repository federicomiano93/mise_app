import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { RouteObject } from 'react-router';
import { renderApp } from '../testing/renderApp';
import { AppShell } from './AppShell';
import { useOwnScrollArea } from './scrollArea';

// The shell has one scroll area for every section and resets it to the top at every address. A
// section whose list and detail are separate addresses can OWN it (useOwnScrollArea): the shell
// then resets only when the section changes. jsdom does not lay out or scroll, so the position is
// planted on the scroll area (the main landmark) the way the Stocktake's own specs do.

// A section that owns the scroll, and one that does not: two screens each.
function Owner({ name }: { name: string }) {
  useOwnScrollArea();
  return <p>{name}</p>;
}

function Plain({ name }: { name: string }) {
  return <p>{name}</p>;
}

const routes: RouteObject[] = [{
  path: '/',
  element: <AppShell />,
  children: [
    { path: 'pastries/one', element: <Owner name="Owner one" /> },
    { path: 'pastries/two', element: <Owner name="Owner two" /> },
    { path: 'orders', element: <Plain name="Plain orders" /> },
    { path: 'recipes/one', element: <Plain name="Plain one" /> },
    { path: 'recipes/two', element: <Plain name="Plain two" /> },
  ],
}];

function scrolledTo(top: number): HTMLElement {
  const main = screen.getByRole('main');
  Object.defineProperty(main, 'scrollTop', { value: top, writable: true });
  return main;
}

describe('AppShell: the scroll area', () => {
  it('keeps the place in a section that owns the scroll across a move inside it', async () => {
    const { router } = renderApp('/pastries/one', { routes });
    const main = scrolledTo(600);

    await act(async () => { await router.navigate('/pastries/two'); });

    expect(screen.getByText('Owner two')).toBeInTheDocument();
    expect(main.scrollTop).toBe(600);
  });

  it('resets it when the move leaves the section that owned it', async () => {
    const { router } = renderApp('/pastries/one', { routes });
    const main = scrolledTo(600);

    await act(async () => { await router.navigate('/orders'); });

    expect(screen.getByText('Plain orders')).toBeInTheDocument();
    expect(main.scrollTop).toBe(0);
  });

  it('resets it when a section that owns the scroll is entered from another one', async () => {
    const { router } = renderApp('/orders', { routes });
    const main = scrolledTo(600);

    await act(async () => { await router.navigate('/pastries/one'); });

    expect(screen.getByText('Owner one')).toBeInTheDocument();
    expect(main.scrollTop).toBe(0);
  });

  it('resets it at every move of a section that does not own it', async () => {
    const { router } = renderApp('/recipes/one', { routes });
    const main = scrolledTo(600);

    await act(async () => { await router.navigate('/recipes/two'); });

    expect(screen.getByText('Plain two')).toBeInTheDocument();
    expect(main.scrollTop).toBe(0);
  });

  it('stops keeping the place once the owner is gone', async () => {
    const { router } = renderApp('/pastries/one', { routes });
    await act(async () => { await router.navigate('/recipes/one'); });
    const main = scrolledTo(600);

    await act(async () => { await router.navigate('/recipes/two'); });

    expect(main.scrollTop).toBe(0);
  });
});

describe('useOwnScrollArea outside the shell', () => {
  // A section drawn alone (a spec, a preview) has no scroll area: it gets none and nothing breaks.
  it('gives no scroll area and claims nothing', () => {
    function Probe() {
      const element = useOwnScrollArea();
      return <p>{element() === null ? 'no scroll area' : 'a scroll area'}</p>;
    }

    const view = render(<Probe />);
    expect(screen.getByText('no scroll area')).toBeInTheDocument();
    view.unmount();
  });
});
