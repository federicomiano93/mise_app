// confirmCopy.ts — the WORKING COPY the confirm screen holds (parity X2). Pure: made once, when the screen opens, and never
// read from the live order again, so a colleague's typing meanwhile cannot move a number under the finger (P20).
import { ingredientDisplayLabel, wholeNumber } from '@mise/shared/archive';
import { entryUnit } from '@mise/shared/order-unit';
import { isFutureDay } from '@mise/shared/order-day';
import { supplierLabel } from '@mise/shared/supplier-label';
import { askedToday } from '@mise/shared/untold-changes';
import type { ToldRecord } from '@mise/shared/untold-changes';
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
  // What a sent order list asked for today, when that differs from `qty`. Left out when no list carried the line.
  readonly asked?: number;
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
  { ids, checks, lens, draft, today, pinnedDay = null, requests = [] }:
  // `pinnedDay`: the day a pending banner's «Placed yesterday» pinned (PlaceConfirmScreen pendingDayIn): the order is recorded under it.
  // `requests`: the order lists sent, so a row can say what the list asked for beside what is being confirmed.
  {
    ids: readonly string[]; checks: readonly RecordCheck[]; lens: OrdersLens; draft: DraftView; today: string;
    pinnedDay?: string | null; requests?: readonly ToldRecord[];
  },
): ConfirmGroup[] {
  const groups: ConfirmGroup[] = [];
  for (const supplierId of ids) {
    const supplier = lens.supplierById(supplierId);
    if (!supplier) continue;
    const date = pinnedDay ?? recordDateFor(draft, supplierId, today);
    const lines = lens.linesOf(supplierId);
    // ⚠️ ONLY WHAT WAS ASKED IN THE UNIT THE ROW MEANS NOW: «asked 4 cartons» beside a line of bags would compare two things.
    const asked = askedToday(requests, supplierId, date, Object.fromEntries(lines.map(line => [line.id, { ing: line, unit: entryUnit(draft.entries[line.id], line) }])));
    const rows = lines
      .map(line => {
        const qty = wholeNumber(draft.entries[line.id]?.qty);
        const row: ConfirmRow = {
          id: line.id,
          name: ingredientDisplayLabel(line),
          unit: entryUnit(draft.entries[line.id], line),
          qty,
        };
        // ⚠️ ABSENT MEANS «NOBODY ASKED»; 0 WOULD MEAN «THEY ASKED FOR NONE». Only a line a sent list carried AND that disagrees.
        const wanted = asked[line.id];
        return wanted !== undefined && wanted !== qty ? { ...row, asked: wanted } : row;
      })
      .filter(row => row.qty > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (rows.length === 0) continue;
    groups.push({
      supplierId,
      name: supplierLabel(supplier),
      date,
      exists: checks.find(check => check.supplierId === supplierId)?.exists === true,
      later: pinnedDay === null && isFutureDay(rawDayFor(draft, supplierId, today), today),
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
