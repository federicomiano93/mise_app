import { vi } from 'vitest';
import type { StoredDoc } from '../suppliers/suppliersSource';
import { fakeSuppliersSource } from './fakeSuppliersSource';
import type { FakeSuppliersSource } from './fakeSuppliersSource';
import { renderApp } from './renderApp';

// Draws the real app at an «Ingredients & suppliers» address, with an in-memory source behind it.
type Options = NonNullable<Parameters<typeof renderApp>[1]> & {
  source?: FakeSuppliersSource;
};

export function renderSuppliers(path = '/suppliers', { source = fakeSuppliersSource(), ...options }: Options = {}) {
  const view = renderApp(path, { ...options, data: { suppliers: () => source, ...options.data } });
  return { ...view, source };
}

// A supplier as the database holds it.
export function supplier(id: string, fields: Record<string, unknown> = {}): StoredDoc {
  return { id, name: id, ...fields };
}

// An ingredient (or, with kind: 'packaging', a packaging item) as the database holds it.
export function item(id: string, fields: Record<string, unknown> = {}): StoredDoc {
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
