// The kiosk rest screen's Orders lines from what Orders already holds (step 3f-8, parity M14, decision T13): no read, no render.
// The kiosk that draws them is step 3g; until then only ordersStore.kioskSections() asks.
//
// ⚠️ THE GOODS-ARRIVED SWITCH IS HONOURED HERE (decision F4, his answer (c)): off, there is no «arriving» line at all; back on, only
// the orders recorded from the day it was turned on count (askedAbout) — the same records Incoming and the debt read
// (useDeliveryView.ts), so the rest screen can never disagree with them. A DIFFERENCE from the current app, whose kiosk does not know
// the switch (docs/parity/orders.md «Step 3f-5 as built», coexistence).
// «To order today» reads EVERY record of the live window: whether an order has been placed today has nothing to do with deliveries.
// It also reads drafts/current.skipped (checklist item 3, 8 Nov 2026): a supplier closed as not ordered today is not «to order».

import { askedAbout } from '@mise/shared/delivery-check';
import type { DeliveryCheck } from '@mise/shared/delivery-check';
import { ARRIVING_TITLE_KEY, kioskSectionsFromData, TO_ORDER_TITLE_KEY } from '@mise/shared/kiosk-lines';
import type { KioskSection } from '@mise/shared/kiosk-lines';
import type { PlacedRecord, SkippedMap } from '@mise/shared/reminders';
import type { StoredDoc } from './ordersSource';

export function kioskSectionsFor({ suppliers, history, today, weekStartsOn, deliveryCheck, skipped = null }: {
  suppliers: readonly StoredDoc[];
  history: readonly StoredDoc[];
  today: string;
  weekStartsOn: string;
  deliveryCheck: DeliveryCheck;
  skipped?: SkippedMap | null;
}): KioskSection[] {
  // A stored record is whatever was written: the shared rules read only `date`, `supplierId` and the delivery fields.
  const records = history as readonly PlacedRecord[];
  const all = kioskSectionsFromData({ suppliers, history: records, today, weekStartsOn, skipped });
  const toOrder = all.filter(s => s.titleKey === TO_ORDER_TITLE_KEY);
  const asked = askedAbout(history, deliveryCheck);
  const arriving = asked.length === 0 ? [] : kioskSectionsFromData({ suppliers, history: asked as readonly PlacedRecord[], today, weekStartsOn })
    .filter(s => s.titleKey === ARRIVING_TITLE_KEY);
  return [...toOrder, ...arriving];
}
