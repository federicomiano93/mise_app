import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { pendingSuppliers } from '@mise/shared/reminders';
import type { PendingSupplier } from '@mise/shared/reminders';
import { localDayOf } from '@mise/shared/day';
import type { DraftView } from './draftSync';
import type { OrdersLens } from './ordersLens';
import { orderable } from './ordersStore';
import type { OrdersSnapshot } from './ordersStore';
import type { StoredDoc } from './ordersSource';

// The orders typed on an earlier day and never placed, as the data says RIGHT NOW (step 3f-6, parity R4).
//
// ⚠️ «No supplier» IS INCLUDED on purpose, as in the original: it never appears in «order these today» (it has no order days), but
// «you typed this on Sunday and never placed it» is a safety net and must catch everything. The lines are the lens's, as they
// are ordered now (overrides applied), so a line sent to another supplier this time is counted where it will really be ordered;
// a switched-off line with a quantity counts like any other (decision T10, `orderable`).
export function pendingNow(lens: OrdersLens, draft: DraftView, today: string): PendingSupplier<StoredDoc>[] {
  return pendingSuppliers({
    suppliers: lens.suppliers,
    ingredients: orderable(lens.lines),
    entries: draft.entries,
    days: draft.days,
    fallbackDay: localDayOf(draft.updatedAt),
    today,
  });
}

// Whether `supplierId`'s order is STILL the one typed on `day` and never placed — what «Placed {day}» and «Discard» stand on. Asked
// again when the screen opens and at the tap: the banner may be gone meanwhile (restamped here or on another phone, placed, cleared).
export function stillPendingOn(lens: OrdersLens, draft: DraftView, today: string, supplierId: string, day: string): boolean {
  return pendingNow(lens, draft, today).some(row => row.supplier.id === supplierId && row.day === day);
}

// How long the opening waits for the server before looking at the copy on the phone anyway.
export const LATCH_GRACE_MS = 5000;

// ⚠️⚠️ LOOK ONLY ONCE THE SERVER HAS ANSWERED for the suppliers, the ingredients AND the draft (review of step 3f-6): the first
// snapshot is often the copy kept on this phone, which may still hold an order another phone placed this morning — latched from
// it, the banner would ask about an order already placed, and stay for the whole opening. Offline, or after LATCH_GRACE_MS on a
// slow line, the copy is all there is, and it is used: a reminder from it is better than none.
export function latchCanLook(seen: OrdersSnapshot['serverSeen'], online: boolean, graceOver: boolean): boolean {
  return (seen.suppliers && seen.ingredients && seen.draft) || !online || graceOver;
}

// ⚠️⚠️ THE BANNERS ARE LATCHED ONCE PER OPENING OF ORDERS (the original's `pendingChecked`): the draft changes on every keystroke,
// another phone's included, and a banner that appeared under somebody's finger — or came back after it was answered — would be
// worse than the one it reports. EXCEPT WHEN A LINE THE LAST PAGE LEFT BEHIND HAS JUST COME BACK (parity F-15), maybe with last
// night's day stamp: the question «this was never placed» was asked before it was here, so the look is made once more for each
// round of that (`round` is the store's `draftCameBack`; the original resets its `pendingChecked`). Otherwise once. So the SET of suppliers found at the first complete look is kept here, above the routes (it
// survives going to the confirm screen and back), and the screens show only those of them that `pendingNow` still returns with the
// current data: a placed, restamped or discarded order goes by itself, and a refused restamp brings it back by itself. A supplier
// that becomes pending later in the session is never added.
type Latch = {
  // null until the first complete look.
  readonly latched: ReadonlySet<string> | null;
  // The round of the look that made `latched`: -1 before the first one.
  readonly round: number;
  // Keeps the set found by the look of `round`; a look of a round already kept is ignored (the once-per-opening rule).
  latch(ids: Iterable<string>, round?: number): void;
};

const NOTHING: Latch = { latched: null, round: -1, latch: () => undefined };

const PendingLatchContext = createContext<Latch>(NOTHING);

export function PendingLatchProvider({ children }: { children: ReactNode }) {
  const [looked, setLooked] = useState<{ latched: ReadonlySet<string> | null; round: number }>({ latched: null, round: -1 });
  const done = useRef(-1);
  const latch = useCallback((ids: Iterable<string>, round = 0) => {
    if (done.current >= round) return;
    done.current = round;
    setLooked({ latched: new Set(ids), round });
  }, []);
  const value = useMemo(() => ({ latched: looked.latched, round: looked.round, latch }), [looked, latch]);
  return <PendingLatchContext.Provider value={value}>{children}</PendingLatchContext.Provider>;
}

export function usePendingLatch(): Latch {
  return useContext(PendingLatchContext);
}
