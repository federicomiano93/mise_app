import { useEffect, useMemo, useState } from 'react';
import type { PlacedRecord } from '@mise/shared/reminders';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useDataServices } from '../data/DataContext';
import { useSession } from '../session/SessionContext';
import { useDueSuppliers } from '../shell/useDueSuppliers';
import { useTodayKey } from '../shell/useTodayKey';
import { useVisibleSections } from '../shell/useVisibleSections';
import type { StoredDoc } from './ordersDueSource';

type Live = {
  readonly suppliers: readonly StoredDoc[];
  readonly suppliersLoaded: boolean;
  readonly placed: readonly StoredDoc[];
  readonly placedFromServer: boolean;
  readonly skipped: Readonly<Record<string, unknown>> | null;
  readonly draftFromServer: boolean;
  readonly broken: boolean;
};

const NOTHING: Live = {
  suppliers: [], suppliersLoaded: false, placed: [], placedFromServer: false, skipped: null, draftFromServer: false, broken: false,
};

// The suppliers the Home's «Ordini da fare» card lists (item 7 of docs/mockups/orders-tablet-2026-11.md): those still to order TODAY —
// an order day today, not placed today, not closed today as «not needed» (reminders `dueTodayIds`, through the shell's
// `useDueSuppliers`, the very rule of the Orders list's «To order» group and of the Suppliers list's tag) — A→Z by the label shown.
//
// ⚠️ ONLY FOR SOMEBODY THE VENUE SHOWS ORDERS TO (useVisibleSections): for anybody else nothing is read at all, and the card is not
// drawn. The rules would refuse the records and the draft to them anyway.
// ⚠️ NOBODY IS LISTED UNTIL THE SERVER HAS ANSWERED for today's records and the draft (not this phone's saved copy, which can lack an
// order placed this morning on another phone): before that, offline included, the list is empty and the card hidden. A dead stream
// hides it too — the card is a shortcut, never the only way to Orders.
// The three listeners live exactly as long as the Home (P14); the day is useTodayKey's, so at midnight the window moves by itself.
export function useOrdersDue(): readonly StoredDoc[] {
  const services = useDataServices();
  const { locationId } = useSession();
  const { visible } = useVisibleSections();
  const seesOrders = visible.has('orders');
  const today = useTodayKey();
  const [live, setLive] = useState<Live>(NOTHING);

  useEffect(() => {
    if (!seesOrders || !locationId) return undefined;
    setLive(NOTHING);
    const source = services.ordersDue(locationId);
    const patch = (next: Partial<Live>) => { setLive(before => ({ ...before, ...next })); };
    const broke = () => { patch({ broken: true }); };
    const stops = [
      source.watchSuppliers(list => { patch({ suppliers: list, suppliersLoaded: true }); }, broke),
      source.watchPlaced(today, (list, meta) => {
        setLive(before => ({ ...before, placed: list, placedFromServer: before.placedFromServer || meta.fromServer }));
      }, broke),
      source.watchDraft((data, meta) => {
        const skipped = data?.skipped;
        setLive(before => ({
          ...before,
          skipped: typeof skipped === 'object' && skipped !== null ? skipped as Record<string, unknown> : null,
          draftFromServer: before.draftFromServer || meta.fromServer,
        }));
      }, broke),
    ];
    return () => { for (const stop of stops) stop(); };
  }, [services, locationId, seesOrders, today]);

  const ready = seesOrders && !live.broken && live.suppliersLoaded && live.placedFromServer && live.draftFromServer;
  const due = useDueSuppliers({
    suppliers: live.suppliers,
    records: live.placed as readonly PlacedRecord[],
    skipped: live.skipped,
    ready,
  });
  return useMemo(
    () => live.suppliers
      .filter(supplier => due.has(supplier.id))
      .sort((a, b) => supplierLabel(a).localeCompare(supplierLabel(b))),
    [live.suppliers, due],
  );
}
