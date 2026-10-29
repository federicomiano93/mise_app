import { vi } from 'vitest';
import type { StoredDoc } from '../orders/ordersSource';
import { fakeOrdersSource } from './fakeOrdersSource';
import type { FakeOrdersSource } from './fakeOrdersSource';
import { renderApp } from './renderApp';

// Draws the real app at an «Orders» address, with an in-memory source behind it.
type Options = NonNullable<Parameters<typeof renderApp>[1]> & {
  source?: FakeOrdersSource;
};

export function renderOrders(path = '/orders', { source = fakeOrdersSource(), ...options }: Options = {}) {
  const view = renderApp(path, { ...options, data: { orders: () => source, ...options.data } });
  return { ...view, source };
}

// A supplier as the database holds it.
export function supplier(id: string, fields: Record<string, unknown> = {}): StoredDoc {
  return { id, name: id, ...fields };
}

// An ingredient as the database holds it.
export function ingredient(id: string, fields: Record<string, unknown> = {}): StoredDoc {
  return { id, name: id, ...fields };
}

// The tablet's split: jsdom applies no media query, so the query is answered by hand.
export function split(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 1000px)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

export const LOAD = { timeout: 10_000 };
// The draft is saved 800 ms after the last keystroke (draftSync.ts): a spec that reads what was written waits this long.
export const SAVED = { timeout: 5_000 };
