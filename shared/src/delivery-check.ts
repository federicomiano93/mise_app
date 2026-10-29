// delivery-check.ts — whether the venue answers «did it all arrive?» at all (decision F4 of docs/parity/orders.md, Federico,
// 29 Oct 2026). NEW in Mise 2: the current app has no such switch, so there is no original to pair it with (like
// order-day-choices.ts). Pure: no Firestore and no DOM.
//
// Some venues will never tick a delivery, and the debt banner then never goes quiet. His answers: (a) ONE switch for the whole
// venue, in config/orders — every phone and the kiosk must agree about what is owed; (b) only an owner or a manager flips it
// (the rules' canManage on config/orders); (c) off hides the Incoming tab, its badge, the debt banner, «To re-order» and the
// kiosk's «arriving» lines — nothing stored is deleted.
//
// ⚠️ TURNED BACK ON, IT COUNTS FROM THAT DAY: the switch stores `deliveryCheckFrom` with it, and an order recorded before that day
// is never asked about. Without it, months of orders nobody was asked about would flood the debt banner the moment it came back.
//
// ⚠️ ABSENT = ON, and only an explicit `false` turns it off: a corrupt value or a document that does not exist yet must leave the
// venue as it has always been (the same direction as `showStock`, orders-config.ts).

import { recordDate } from './archive';

export interface DeliveryCheck {
  // Whether Orders asks about deliveries at all.
  readonly on: boolean;
  // 'YYYY-MM-DD': an order recorded before it is never asked about; '' = every order is.
  readonly from: string;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// A stored config/orders (or null) → the switch as Orders reads it.
export function deliveryCheckOf(doc?: unknown): DeliveryCheck {
  const d = doc && typeof doc === 'object' ? doc as Record<string, unknown> : null;
  const from = d?.deliveryCheckFrom;
  return {
    on: d?.deliveryCheck !== false,
    from: typeof from === 'string' && ISO_DAY.test(from) ? from : '',
  };
}

// What flipping the switch writes into config/orders (a merge). Turning it ON stamps today as the first day asked about; turning
// it OFF leaves the stored day alone (it only matters while the switch is on, and the next «on» replaces it).
export function deliveryCheckPatch(on: boolean, today: string): Record<string, unknown> {
  return on ? { deliveryCheck: true, deliveryCheckFrom: today } : { deliveryCheck: false };
}

// The records the delivery questions are asked about: none while the switch is off; from `from` on while it is on. The rest of
// Orders (suggestions, History) always reads every record — this narrows only Incoming, its badge and the debt.
export function askedAbout<T>(records: readonly T[] | null | undefined, check: DeliveryCheck): T[] {
  if (!check.on) return [];
  const list = [...(records ?? [])];
  if (!check.from) return list;
  // recordDate: the legacy weekly record answers with its week's start, and is never a delivery anyway (deliveries.ts).
  return list.filter(record => recordDate(record) >= check.from);
}
