// kiosk-lines.ts — the Orders sections on the kiosk rest screen. PURE: no DOM, no Firestore — the callers hand in data they
// already hold.
//
// TypeScript port of js/orders/kiosk-lines.js for Mise 2 (step 3f-8, parity M14 and T13). Behaviour is identical, input for input:
// kiosk-lines.spec.ts runs every test against BOTH files and parity.spec.ts compares their exports. A FULL port.
//
// Two sections, in this order: what is still to be ordered today, and which deliveries arrive today. Each is a title KEY plus
// supplier NAMES; the title is translated by the drawing code (never here, never at module load), and a section with no names
// is left out.
//
// ⚠️ THE GOODS-ARRIVED SWITCH (decision F4) IS NOT KNOWN HERE, exactly as in the original: Mise 2's data layer hands in only the
// records the venue is asked about (delivery-check.ts askedAbout) for the «arriving» half — app/src/orders/kioskFeed.ts.

import { supplierLabel } from './supplier-label';
import { todayOrders } from './reminders';
import type { ReminderSupplier, PlacedRecord, SkippedMap } from './reminders';
import { pendingDeliveries } from './deliveries';

// More than this many suppliers and the rest become «+N» (a resting screen is read from across the room).
export const MAX_SUPPLIERS_SHOWN = 4;

export const TO_ORDER_TITLE_KEY = 'kiosk.rest.toOrderTitle';
export const ARRIVING_TITLE_KEY = 'kiosk.rest.arrivingTitle';

export interface KioskSection {
  titleKey: string;
  names: string[];
  more: number;
}

// One section: the first MAX_SUPPLIERS_SHOWN labels and how many were cut. Suppliers that are missing (null — a deleted one an
// old order still points at) are skipped, and so is the same supplier twice. Names are data and go through supplierLabel().
function section(titleKey: string, suppliers: unknown): KioskSection {
  const seen = new Set<unknown>();
  const labels: string[] = [];
  (Array.isArray(suppliers) ? suppliers : []).forEach((s: unknown) => {
    if (!s || typeof s !== 'object') return;
    const key = (s as { id?: unknown }).id ?? supplierLabel(s);
    if (seen.has(key)) return;
    seen.add(key);
    const label = supplierLabel(s);
    if (label) labels.push(label);
  });
  return {
    titleKey,
    names: labels.slice(0, MAX_SUPPLIERS_SHOWN),
    more: Math.max(0, labels.length - MAX_SUPPLIERS_SHOWN),
  };
}

// toOrder / arriving: lists of supplier objects → the sections to draw (empty ones dropped).
export function kioskOrderSections({ toOrder, arriving }: { toOrder?: unknown; arriving?: unknown } = {}): KioskSection[] {
  return [
    section(TO_ORDER_TITLE_KEY, toOrder),
    section(ARRIVING_TITLE_KEY, arriving),
  ].filter(s => s.names.length > 0);
}

// The same, straight from Orders data: suppliers + orders-history records. `today` is "YYYY-MM-DD". Reuses the screen's own rules
// (todayOrders, pendingDeliveries) so the rest screen can never disagree with the banners. `skipped` is drafts/current.skipped: a
// supplier closed as not ordered today is not «to order».
export function kioskSectionsFromData<S extends ReminderSupplier>({ suppliers, history, today, weekStartsOn, skipped = null }: {
  suppliers?: readonly S[] | null;
  history?: readonly PlacedRecord[] | null;
  today?: string;
  weekStartsOn?: string;
  skipped?: SkippedMap;
}): KioskSection[] {
  const toOrder = todayOrders({ suppliers, history, today, skipped })
    .filter(row => !row.placed && !row.skipped).map(row => row.supplier);
  const byId: Record<string, S> = {};
  (suppliers || []).forEach(s => { byId[s.id as string] = s; });
  const arriving = pendingDeliveries(history, byId, today, { weekStartsOn })
    .dueToday.map(entry => entry.supplier);
  return kioskOrderSections({ toOrder, arriving });
}
