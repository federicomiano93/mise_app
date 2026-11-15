import { vi } from 'vitest';
import type { StoredDoc } from '../stocktake/stocktakeSource';
import { fakeStocktakeSource } from './fakeStocktakeSource';
import type { FakeStocktakeSource } from './fakeStocktakeSource';
import { renderApp } from './renderApp';

// Draws the real app at a Stocktake address, with an in-memory source behind it.
//
// The clock is the one the Stocktake specs share: Wednesday 14 October 2026, 21:00 — so the current
// month is 2026-10 and the month before it 2026-09. Only Date is faked: the user-event clicks and
// the router keep their real timers.
export const EVENING = new Date(2026, 9, 14, 21, 0, 0);
export const THIS_MONTH = '2026-10';
export const LAST_MONTH = '2026-09';

export function freezeClock(at: Date = EVENING): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
}

// An ingredient as Firestore would hand it over: active, with a name, counted in kilos.
export function ingredient(id: string, fields: Record<string, unknown> = {}): StoredDoc {
  return { id, name: id, active: true, unit: 'kg', category: '', ...fields };
}

// A month's document: open, with whatever counts the spec puts in it.
export function monthDoc(id: string, fields: Record<string, unknown> = {}): StoredDoc {
  return { id, month: id, bakery: 'bakery', ...fields };
}

// A month closed with the names it froze.
export function closedMonthDoc(id: string, fields: Record<string, unknown> = {}): StoredDoc {
  return monthDoc(id, { closedAt: '2026-10-01T09:00:00.000Z', ...fields });
}

type Options = NonNullable<Parameters<typeof renderApp>[1]> & {
  source?: FakeStocktakeSource;
};

export function renderStocktake(path = '/stocktake', { source = fakeStocktakeSource(), ...options }: Options = {}) {
  const view = renderApp(path, { ...options, data: { stocktake: () => source, ...options.data } });
  return { ...view, source };
}
