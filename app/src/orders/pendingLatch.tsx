import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { pendingSuppliers } from '@mise/shared/reminders';
import type { PendingSupplier } from '@mise/shared/reminders';
import { localDayOf } from '@mise/shared/day';
import type { DraftView } from './draftSync';
import type { OrdersLens } from './ordersLens';
import type { StoredDoc } from './ordersSource';

// The orders typed on an earlier day and never placed, as the data says RIGHT NOW (step 3f-6, parity R4).
//
// ⚠️ «No supplier» IS INCLUDED on purpose, as in the original: it never appears in «order these today» (it has no order days), but
// «you typed this on Sunday and never placed it» is a safety net and must catch everything. The lines are the lens's, as they
// are ordered now (overrides applied), so a line sent to another supplier this time is counted where it will really be ordered.
export function pendingNow(lens: OrdersLens, draft: DraftView, today: string): PendingSupplier<StoredDoc>[] {
  return pendingSuppliers({
    suppliers: lens.suppliers,
    ingredients: lens.lines,
    entries: draft.entries,
    days: draft.days,
    fallbackDay: localDayOf(draft.updatedAt),
    today,
  });
}

// ⚠️⚠️ THE BANNERS ARE LATCHED ONCE PER OPENING OF ORDERS (the original's `pendingChecked`): the draft changes on every keystroke,
// another phone's included, and a banner that appeared under somebody's finger — or came back after it was answered — would be
// worse than the one it reports. So the SET of suppliers found at the first complete look is kept here, above the routes (it
// survives going to the confirm screen and back), and the screens show only those of them that `pendingNow` still returns with the
// current data: a placed, restamped or discarded order goes by itself, and a refused restamp brings it back by itself. A supplier
// that becomes pending later in the session is never added.
type Latch = {
  // null until the first complete look.
  readonly latched: ReadonlySet<string> | null;
  latch(ids: Iterable<string>): void;
};

const NOTHING: Latch = { latched: null, latch: () => undefined };

const PendingLatchContext = createContext<Latch>(NOTHING);

export function PendingLatchProvider({ children }: { children: ReactNode }) {
  const [latched, setLatched] = useState<ReadonlySet<string> | null>(null);
  const done = useRef(false);
  const latch = useCallback((ids: Iterable<string>) => {
    if (done.current) return;
    done.current = true;
    setLatched(new Set(ids));
  }, []);
  const value = useMemo(() => ({ latched, latch }), [latched, latch]);
  return <PendingLatchContext.Provider value={value}>{children}</PendingLatchContext.Provider>;
}

export function usePendingLatch(): Latch {
  return useContext(PendingLatchContext);
}
