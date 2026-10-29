// confirmCopy.ts — the WORKING COPY the confirm screen holds (parity X2). Pure: made once, when the screen opens, and never
// read from the live order again, so a colleague's typing meanwhile cannot move a number under the finger (P20).
import { ingredientDisplayLabel, wholeNumber } from '@mise/shared/archive';
import { entryUnit } from '@mise/shared/order-unit';
import { isFutureDay } from '@mise/shared/order-day';
import { supplierLabel } from '@mise/shared/supplier-label';
import type { DraftView } from './draftSync';
import { rawDayFor, recordDateFor } from './orderDay';
import type { OrdersLens } from './ordersLens';
import type { RecordCheck } from './ordersStore';

// One line of the order as the screen showed it: its quantity above zero and the unit it was SHOWN in.
export interface ConfirmRow {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly qty: number;
}

export interface ConfirmGroup {
  readonly supplierId: string;
  readonly name: string;
  // The day the order is recorded under (decision F3: never later than today).
  readonly date: string;
  // Today's record of this supplier already exists: the amounts are ADDED to it.
  readonly exists: boolean;
  // The rows are stamped for a day that has not come: the screen says the order is recorded as today's (decision F3).
  readonly later: boolean;
  readonly rows: readonly ConfirmRow[];
}

// A supplier with nothing above zero, or one that is gone from the list, has no group: there is nothing to confirm for it.
export function buildConfirmGroups(
  { ids, checks, lens, draft, today }:
  { ids: readonly string[]; checks: readonly RecordCheck[]; lens: OrdersLens; draft: DraftView; today: string },
): ConfirmGroup[] {
  const groups: ConfirmGroup[] = [];
  for (const supplierId of ids) {
    const supplier = lens.supplierById(supplierId);
    if (!supplier) continue;
    const rows = lens.linesOf(supplierId)
      .map(line => ({
        id: line.id,
        name: ingredientDisplayLabel(line),
        unit: entryUnit(draft.entries[line.id], line),
        qty: wholeNumber(draft.entries[line.id]?.qty),
      }))
      .filter(row => row.qty > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (rows.length === 0) continue;
    groups.push({
      supplierId,
      name: supplierLabel(supplier),
      date: recordDateFor(draft, supplierId, today),
      exists: checks.find(check => check.supplierId === supplierId)?.exists === true,
      later: isFutureDay(rawDayFor(draft, supplierId, today), today),
      rows,
    });
  }
  return groups;
}

// What the person confirmed, in the shape `store.place` takes: only the quantities above zero, and the unit EVERY row showed.
// A supplier with nothing above zero is left out.
export function confirmedItems(
  groups: readonly ConfirmGroup[],
  typed: Readonly<Record<string, Readonly<Record<string, number>>>>,
): Array<{ supplierId: string; date: string; quantities: Record<string, number>; units: Record<string, string> }> {
  const items = [];
  for (const group of groups) {
    const quantities: Record<string, number> = {};
    const units: Record<string, string> = {};
    for (const row of group.rows) {
      units[row.id] = row.unit;
      const qty = wholeNumber(typed[group.supplierId]?.[row.id]);
      if (qty > 0) quantities[row.id] = qty;
    }
    if (Object.keys(quantities).length > 0) items.push({ supplierId: group.supplierId, date: group.date, quantities, units });
  }
  return items;
}
