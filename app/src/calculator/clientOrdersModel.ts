// clientOrdersModel.ts — the pure decisions of the Calculator's client-ordering half that are not in the shared
// model (@mise/shared/client-order-model, which the client's own page shares).

import { getClients } from '@mise/shared/calculator-config';
import type { CalculatorConfig } from '@mise/shared/calculator-config';
import { CUTOFF_PATTERN, menuChanged, menuFor } from '@mise/shared/client-order-model';

// Whether some client's PUBLISHED product list would read differently after this save (js/calculator-config-store.js
// `menusWouldChange`). Everything else in the configuration — recipes, WhatsApp lists, log settings — is invisible to
// a client, so a save that touches only those must not cost a read of every menu (P14).
export function menusWouldChange(before: CalculatorConfig, after: CalculatorConfig): boolean {
  const was = new Map(getClients(before).map(client => [client.id, menuFor(client)] as const));
  const now = getClients(after);
  if (was.size !== now.length) return true;
  return now.some(client => menuChanged(was.get(client.id), menuFor(client)));
}

// Whether what the deadline box holds can be saved: nothing at all (no deadline) or a time of day, 'HH:MM' (js/
// calculator-client-orders.js: `input.value && !CUTOFF_PATTERN.test(input.value)`). The native time box hands over
// exactly that, but a browser without one (an old desktop Safari) lets anything be typed, and the store would turn a
// bad value into «no deadline» without a word.
export function isAcceptableCutoff(value: string): boolean {
  return value === '' || CUTOFF_PATTERN.test(value);
}
