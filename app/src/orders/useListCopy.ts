import { useEffect, useState } from 'react';
import { LIST_COPY_WRITE_DELAY_MS, readListCopy, writeListCopy } from '@mise/shared/list-copy';
import type { CopyStorage, ListCopy } from '@mise/shared/list-copy';
import { useSession } from '../session/SessionContext';
import { ACTIVE_LOCATION_KEY } from '../session/session';
import { useOrders } from './OrdersContext';

// The local copy of the last good supplier and ingredient lists (shared/src/list-copy.ts; the same key and value as the current
// app's, so each reads what the other wrote). It exists for ONE thing: the rows of the supplier list while the live lists have
// not landed, on a tablet where they take seconds.
//
// ⚠️ THE COPY NEVER ENTERS THE STORE OR ITS SNAPSHOT. It is read once here and handed to OrdersLayout, which builds a second lens
// from it for the rows of the list and nothing else. Alerts, the bell, «Order today», the debt doors, the pending latch and every
// supplier screen keep reading the live snapshot, so none of them can ever act on an old list. A supplier tapped on the copy is
// HELD in OrdersLayout (a React state) until the live data lands; this file knows nothing of that.

// `window.localStorage` can throw (storage blocked, a private window): the screen then simply has no copy.
function storageOrNull(): CopyStorage | null {
  try { return window.localStorage; } catch { return null; }
}

export function useListCopy(): ListCopy | null {
  const { locationId } = useSession();
  const snapshot = useOrders();
  // Read ONCE, when the section opens: the copy is only for the first seconds, and a later write must not bring it back.
  const [copy] = useState(() => readListCopy(locationId, storageOrNull()));

  // ⚠️ ONLY THE SERVER'S WHOLE ANSWER IS WORTH KEEPING. `serverSeen`, not «loaded»: this phone's own database can answer first with
  // a partial list, and a partial list must not become «the last good one». A stream that fails sets «loaded» with an EMPTY list;
  // writing that would replace a good copy with nothing. Offline nothing is written, which is fine. The effect depends on the two
  // lists themselves: the store keeps the same arrays when only the draft changes, so typing a quantity does not restart the timer.
  const { suppliers, ingredients } = snapshot;
  const whole = snapshot.serverSeen.suppliers && snapshot.serverSeen.ingredients
    && !snapshot.suppliersBroken && !snapshot.ingredientsBroken;
  useEffect(() => {
    if (!whole || !locationId) return;
    // ONE timer, re-armed by each change and stopped when the section closes: leaving writes nothing.
    const timer = window.setTimeout(() => {
      const storage = storageOrNull();
      // ⚠️ NOT WHILE THE DEVICE IS MOVING TO ANOTHER VENUE: switchLocation wipes this phone's data, writes the new venue's id under
      // `active-location`, then awaits the offline-database wipe before reloading — with Orders still mounted. A timer firing in
      // that gap would put the old venue's names back after the wipe. A missing key does not stop the write.
      let active: string | null = null;
      try { active = storage?.getItem(ACTIVE_LOCATION_KEY) ?? null; } catch { active = null; }
      if (active !== null && active !== '' && active !== locationId) return;
      writeListCopy(locationId, suppliers, ingredients, storage);
    }, LIST_COPY_WRITE_DELAY_MS);
    return () => { window.clearTimeout(timer); };
  }, [whole, locationId, suppliers, ingredients]);

  return copy;
}
