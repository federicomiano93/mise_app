import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { fakeStore } from '../testing/fakeSession';
import { renderApp } from '../testing/renderApp';
import type { ConsoleLike, ListenerTarget } from '../telemetry/errorReport';
import type { TelemetrySinks } from '../telemetry/sinks';
import { startTelemetry } from '../telemetry/startTelemetry';
import { SCREEN_EVENT } from '../telemetry/usage';

// The shell tells the usage record which screen is on (announceScreen), on every move; the error
// report names the same screen on its line. AppShell.spec.tsx covers the shell itself.

const rail = () => within(screen.getByRole('navigation', { name: 'All sections' }));

let heard: string[];
const listener = (event: Event) => { heard.push(String((event as CustomEvent).detail)); };

beforeEach(() => {
  heard = [];
  window.addEventListener(SCREEN_EVENT, listener);
});

afterEach(() => {
  window.removeEventListener(SCREEN_EVENT, listener);
});

describe('AppShell: it announces the screen', () => {
  it('announces the section it opens on', () => {
    renderApp('/orders');
    expect(heard).toEqual(['orders']);
  });

  it('announces each section the person moves to, in order', async () => {
    const { user } = renderApp('/orders');

    await user.click(rail().getByRole('link', { name: 'Recipes' }));
    await screen.findByRole('heading', { level: 1, name: 'Recipes' });
    await user.click(rail().getByRole('link', { name: 'Food cost' }));
    await screen.findByRole('heading', { level: 1, name: 'Food cost' });

    expect(heard).toEqual(['orders', 'recipes', 'foodcost']);
  });

  it('announces «more» for its own page', () => {
    renderApp('/more');
    expect(heard).toEqual(['more']);
  });

  it('announces «not-found» for an address that leads nowhere', () => {
    renderApp('/no-such-section');
    expect(heard).toEqual(['not-found']);
  });

  // The address with no section in it redirects at once; counting it would put a bogus
  // «not-found» at the start of every visit.
  it('announces only the section `/` lands on, never `/` itself', async () => {
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Orders' });
    expect(heard).toEqual(['orders']);
  });

  it('announces the section a venue starts on when it is not Orders', async () => {
    renderApp('/', { session: { location: { sections: { orders: false } } } });
    await screen.findByRole('heading', { level: 1 });
    expect(heard).toHaveLength(1);
    expect(heard[0]).not.toBe('orders');
    expect(heard[0]).not.toBe('not-found');
  });

  it('does not announce again when the shell is only redrawn', () => {
    const { store } = renderApp('/orders');
    act(() => { store.set({ name: 'Another name' }); });
    expect(heard).toEqual(['orders']);
  });
});

describe('AppShell: the error report names the screen the person is on', () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal('screen', { width: 390, height: 844 });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
  });

  afterEach(() => {
    stop?.();
    stop = null;
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('says m2:recipes once the person is on Recipes', async () => {
    const sinks = {
      reportError: vi.fn<TelemetrySinks['reportError']>(async () => undefined),
      pingDevice: vi.fn<TelemetrySinks['pingDevice']>(async () => undefined),
      saveUsage: vi.fn<TelemetrySinks['saveUsage']>(async () => undefined),
    };
    const target: ListenerTarget = { addEventListener: () => undefined };
    const consoleObj: ConsoleLike = { error: vi.fn() };
    stop = startTelemetry({ store: fakeStore(), sinks, target, console: consoleObj });

    const { user } = renderApp('/orders');
    consoleObj.error('while on Orders');
    await user.click(rail().getByRole('link', { name: 'Recipes' }));
    await screen.findByRole('heading', { level: 1, name: 'Recipes' });
    consoleObj.error('while on Recipes');
    await vi.waitFor(() => { expect(sinks.reportError).toHaveBeenCalledTimes(2); });

    expect(sinks.reportError.mock.calls.map(([record]) => record.screen)).toEqual(['m2:orders', 'm2:recipes']);
  });
});
