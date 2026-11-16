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

// Whether two answers hold the same plain data (documents, a skipped map): objects by their keys, arrays by their items.
// ⚠️ Only PLAIN objects and arrays are walked: a Firestore value (a Timestamp, a DocumentReference, which points back at the whole
// Firestore instance) is compared by its own isEqual, never walked, or the walk could run in a circle.
const isPlain = (v: object): boolean => Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null;
function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (!isPlain(a) || !isPlain(b)) {
    const eq = (a as { isEqual?: unknown }).isEqual;
    if (typeof eq !== 'function' || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    try { return (eq as (other: unknown) => boolean).call(a, b) === true; } catch { return false; }
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => key in right && sameData(left[key], right[key]));
}

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
    const source = services.ordersDue(locationId);
    // ⚠️ THE SAME OBJECT COMES BACK WHILE WHAT THE CARD USES DOES NOT CHANGE: another phone writes drafts/current on every keystroke,
    // and a new state each time would redraw the card for nothing (React bails out of a state it already holds).
    const broke = () => { setLive(before => (before.broken ? before : { ...before, broken: true })); };
    const stops = [
      source.watchSuppliers(list => {
        setLive(before => (before.suppliersLoaded && sameData(before.suppliers, list) ? before : { ...before, suppliers: list, suppliersLoaded: true }));
      }, broke),
      source.watchPlaced(today, (list, meta) => {
        setLive(before => {
          const fromServer = before.placedFromServer || meta.fromServer;
          if (fromServer === before.placedFromServer && sameData(before.placed, list)) return before;
          return { ...before, placed: list, placedFromServer: fromServer };
        });
      }, broke),
      source.watchDraft((data, meta) => {
        const raw = data?.skipped;
        const skipped = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : null;
        setLive(before => {
          const fromServer = before.draftFromServer || meta.fromServer;
          if (fromServer === before.draftFromServer && sameData(before.skipped, skipped)) return before;
          return { ...before, skipped, draftFromServer: fromServer };
        });
      }, broke),
    ];
    // ⚠️ The old answers go WITH the listeners: the next listen (Orders switched back on, a new day) must not draw them for a frame.
    return () => {
      for (const stop of stops) stop();
      setLive(NOTHING);
    };
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
