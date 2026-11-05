import { vi } from 'vitest';
import type { Weekday } from '@mise/shared/pastries-model';
import type { StoredDoc } from '../pastries/pastriesSource';
import { fakePastriesSource } from './fakePastriesSource';
import type { FakePastriesSource } from './fakePastriesSource';
import { renderApp } from './renderApp';

// Draws the real app at a Pastries address, with an in-memory source behind it.
//
// The clock is the one the Pastries specs share: Wednesday 14 October 2026, 21:00 — the work day is
// Wednesday (it rolls at 4am), so the day being proved FOR is Thursday, and tonight's work date is
// 2026-10-14. Only Date is faked: the user-event clicks and the router keep their real timers.
export const EVENING = new Date(2026, 9, 14, 21, 0, 0);
export const WORK_DATE = '2026-10-14';

export function freezeClock(at: Date = EVENING): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
}

// A day's document as Firestore would hand it over.
export function dayDoc(day: Weekday, items: readonly (readonly [string, number])[], note = ''): StoredDoc {
  return { id: day, day, bakery: 'bakery', note, items: items.map(([name, qty]) => ({ name, qty })) };
}

// Tonight's record of a day: what Confirm writes, and what makes the day show as done.
export function logDoc(day: Weekday, items: readonly (readonly [string, number])[] = [], date: string = WORK_DATE): StoredDoc {
  return {
    id: `${date}_${day}`,
    date,
    day,
    bakery: 'bakery',
    note: '',
    items: items.map(([name, qty]) => ({ name, qty })),
    createdAt: new Date(2026, 9, 14, 20, 0, 0).toISOString(),
  };
}

type Options = NonNullable<Parameters<typeof renderApp>[1]> & {
  source?: FakePastriesSource;
};

export function renderPastries(path = '/pastries', { source = fakePastriesSource(), ...options }: Options = {}) {
  const view = renderApp(path, { ...options, data: { pastries: () => source, ...options.data } });
  return { ...view, source };
}
