import { NOW } from './logFixtures';

// Orders a client sent, for the specs of the clients' ordering screens (the shape `buildOrder` writes). The clock is
// the one logFixtures freezes: Monday 12 October 2026, ten in the morning, so TODAY is the 12th.
export const TODAY = '2026-10-12';
export const TOMORROW = '2026-10-13';
export const LATER = '2026-10-15';
export const YESTERDAY = '2026-10-11';

// An ISO time `minutes` before the frozen clock.
export const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();

export type TestOrder = { id: string } & Record<string, unknown>;

// An order from Cafe Roma for tomorrow: five Focaccia trays, new (never put into the Calculator), sent 20 minutes ago.
export function orderOf(over: Record<string, unknown> = {}): TestOrder {
  const date = String(over['date'] ?? TOMORROW);
  const clientId = String(over['clientId'] ?? 'roma');
  return {
    id: `${date}_${clientId}`,
    date,
    clientId,
    clientName: 'Cafe Roma',
    quantities: { tray: 5 },
    names: { tray: 'Focaccia tray' },
    note: '',
    createdAt: ago(60),
    updatedAt: ago(20),
    ...over,
  };
}

// The same order after it was put into the Calculator, untouched since.
export function usedOrder(over: Record<string, unknown> = {}): TestOrder {
  const order = orderOf(over);
  return { ...order, appliedAt: ago(10), appliedFor: String(order['updatedAt']), ...over };
}

// The same order after it was put into the Calculator and the client then changed it.
export function changedOrder(over: Record<string, unknown> = {}): TestOrder {
  const order = orderOf(over);
  return { ...order, appliedAt: ago(10), appliedFor: ago(40), ...over };
}
