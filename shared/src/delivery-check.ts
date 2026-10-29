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
// ⚠️ EXCEPT ON THE DAY IT WAS TURNED OFF (found in the review of 3f-5): turning it off stores `deliveryCheckOffOn`, and switching it
// back on that same day keeps the day it counted from — so an off-and-on by mistake never makes the venue's open deliveries vanish.
// On any later day the screen asks first, because the orders before today will not be asked about again.
//
// ⚠️ ABSENT = ON, and only an explicit `false` turns it off: a corrupt value or a document that does not exist yet must leave the
// venue as it has always been (the same direction as `showStock`, orders-config.ts).

import { recordDate } from './archive';

export interface DeliveryCheck {
  // Whether Orders asks about deliveries at all.
  readonly on: boolean;
  // 'YYYY-MM-DD': an order recorded before it is never asked about; '' = every order is.
  readonly from: string;
  // 'YYYY-MM-DD': the day it was last turned off; '' = never (or unreadable).
  readonly offOn: string;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isoDay = (v: unknown): string => (typeof v === 'string' && ISO_DAY.test(v) ? v : '');

// A stored config/orders (or null) → the switch as Orders reads it.
export function deliveryCheckOf(doc?: unknown): DeliveryCheck {
  const d = doc && typeof doc === 'object' ? doc as Record<string, unknown> : null;
  return {
    on: d?.deliveryCheck !== false,
    from: isoDay(d?.deliveryCheckFrom),
    offOn: isoDay(d?.deliveryCheckOffOn),
  };
}

// Whether turning the switch ON today drops the orders recorded before today (the screen asks first when it does): not when it
// was turned off today — the day it counted from is kept.
export function turningOnForgets(check: DeliveryCheck, today: string): boolean {
  return !check.on && check.offOn !== today;
}

// What flipping the switch writes into config/orders (a merge). OFF stamps the day it went off; ON stamps today as the first day
// asked about — unless it went off today, when the stored day stays (turningOnForgets).
export function deliveryCheckPatch(on: boolean, today: string, current: DeliveryCheck): Record<string, unknown> {
  if (!on) return { deliveryCheck: false, deliveryCheckOffOn: today };
  return turningOnForgets(current, today) ? { deliveryCheck: true, deliveryCheckFrom: today } : { deliveryCheck: true };
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
