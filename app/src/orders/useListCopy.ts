import { useEffect, useState } from 'react';
import { LIST_COPY_WRITE_DELAY_MS, readListCopy, writeListCopy } from '@mise/shared/list-copy';
import type { CopyStorage, ListCopy } from '@mise/shared/list-copy';
import { useSession } from '../session/SessionContext';
import { useOrders } from './OrdersContext';

// The local copy of the last good supplier and ingredient lists (shared/src/list-copy.ts; the same key and value as the current
// app's, so each reads what the other wrote). It exists for ONE thing: the rows of the supplier list while the live lists have
// not landed, on a tablet where they take seconds.
//
// ⚠️ THE COPY NEVER ENTERS THE STORE OR ITS SNAPSHOT. It is read once here and handed to OrdersLayout, which builds a second lens
// from it for the rows of the list and nothing else. Alerts, the bell, «Order today», the debt doors, the pending latch and every
// supplier screen keep reading the live snapshot, so none of them can ever act on an old list.

// `window.localStorage` can throw (storage blocked, a private window): the screen then simply has no copy.
function storageOrNull(): CopyStorage | null {
  try { return window.localStorage; } catch { return null; }
}

export function useListCopy(): ListCopy | null {
  const { locationId } = useSession();
  const snapshot = useOrders();
  // Read ONCE, when the section opens: the copy is only for the first seconds, and a later write must not bring it back.
  const [copy] = useState(() => readListCopy(locationId, storageOrNull()));

  // ⚠️ ONLY A LIVE, WHOLE ANSWER IS WORTH KEEPING. A stream that fails sets «loaded» with an EMPTY list; writing that would
  // replace a good copy with nothing. The effect depends on the two lists themselves: the store keeps the same arrays when
  // only the draft changes, so typing a quantity does not restart the timer.
  const { suppliers, ingredients } = snapshot;
  const whole = snapshot.suppliersLoaded && snapshot.ingredientsLoaded && !snapshot.suppliersBroken && !snapshot.ingredientsBroken;
  useEffect(() => {
    if (!whole || !locationId) return;
    // ONE timer, re-armed by each change and stopped when the section closes: leaving writes nothing.
    const timer = window.setTimeout(() => { writeListCopy(locationId, suppliers, ingredients, storageOrNull()); }, LIST_COPY_WRITE_DELAY_MS);
    return () => { window.clearTimeout(timer); };
  }, [whole, locationId, suppliers, ingredients]);

  return copy;
}
