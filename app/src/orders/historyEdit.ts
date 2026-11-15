// historyEdit.ts — correcting one recorded order (parity H12, step 3f-4): the rows the editor shows, the record a correction
// writes, and whether the stored record is still the one the editor opened. Pure: the store (ordersStore.ts) runs it inside the
// write's transaction, the editor screen draws `editRows`.
//
// The editor is the safety valve behind «a second order the same day ADDS to the first» (archive mergeArchives): adding can
// never lose the first order, but it is the wrong arithmetic when somebody meant to CORRECT a number. So a recorded order can
// be corrected, and one made by mistake removed.

import { recordedName, wholeNumber, withCorrection } from '@mise/shared/archive';
import { recordUnit } from '@mise/shared/order-unit';
import { compareLabels } from '@mise/shared/order-text';

// One ordered line of a record, as the editor shows it.
export interface EditRow {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly qty: number;
  readonly stock: number;
}

// What the person typed: the quantity and the stock reading of each row, by ingredient id.
export interface RecordEdits {
  readonly qty: Readonly<Record<string, number>>;
  readonly stock: Readonly<Record<string, number>>;
}

type Rec = Record<string, unknown>;

const mapOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

// One row per ORDERED line (quantity above zero). An ingredient deleted since still shows, under the name the order was placed
// with or the word for a deleted ingredient (recordedName), rather than vanishing from its own order. Sorted as the order
// text sorts its lines (numerically: «Farina 5kg» before «Farina 25kg»; the current app uses a plain localeCompare here).
export function editRows(record: Rec, ingredientsById: Readonly<Record<string, unknown>>, deletedWord: string): EditRow[] {
  const quantities = mapOf(record.quantities);
  const stock = mapOf(record.stock);
  return Object.keys(quantities)
    .filter(id => wholeNumber(quantities[id]) > 0)
    .map(id => ({
      id,
      name: recordedName(id, ingredientsById, record.names, deletedWord),
      unit: recordUnit(record, id, ingredientsById[id]),
      qty: wholeNumber(quantities[id]),
      stock: wholeNumber(stock[id]),
    }))
    .sort((a, b) => compareLabels(a.name, b.name));
}

// The record a correction writes, built from the record AS STORED NOW (so a delivery answer written meanwhile — deliveredAt,
// missing, missingResolved — is kept): the lines taken to 0 leave it, the units of the lines still ordered stay, the
// correction joins the day's sends as «Corrected · <time>» (withCorrection; only a record that already keeps sends), and
// `updatedAt` is the time of the correction. The document id and the venue stamp are not part of it (the source stamps).
// null when nothing would be left: an order with nothing in it is not an order (delete it instead).
export function correctedRecord(stored: Rec, edits: RecordEdits, at: string): Rec | null {
  const quantities: Record<string, number> = {};
  const stock: Record<string, number> = {};
  for (const [id, value] of Object.entries(edits.qty)) {
    const qty = wholeNumber(value);
    if (qty <= 0) continue;
    quantities[id] = qty;
    stock[id] = wholeNumber(edits.stock[id]);
  }
  if (Object.keys(quantities).length === 0) return null;

  const { id: _id, bakery: _bakery, units: storedUnits, sends: _sends, ...fields } = stored;
  const recorded = mapOf(storedUnits);
  const units: Record<string, string> = {};
  for (const id of Object.keys(quantities)) {
    const unit = recorded[id];
    if (typeof unit === 'string' && unit) units[id] = unit;
  }
  const sends = withCorrection(stored, quantities, units, at);
  return {
    ...fields,
    quantities,
    stock,
    ...(Object.keys(units).length ? { units } : {}),
    ...(sends ? { sends } : {}),
    updatedAt: at,
  };
}

// The same value whatever order its keys were written in (Firestore does not keep the order of a map's keys).
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Rec)[key])]));
  }
  return value;
}

// ⚠️ WHETHER THE STORED RECORD IS STILL THE ORDER THE EDITOR OPENED: the lines, their units, the stock readings and the sends.
// A colleague's second order to the same supplier that day, or their own correction, changes one of them, and a correction
// written over it would wipe their order (difference E1 of 3f-4: the current app overwrites). A delivery answer does NOT count:
// it touches none of them, and the correction keeps it.
export function sameOrder(stored: Rec | null, opened: Rec): boolean {
  if (!stored) return false;
  const part = (r: Rec) => JSON.stringify(canonical({
    quantities: mapOf(r.quantities), units: mapOf(r.units), stock: mapOf(r.stock), sends: mapOf(r.sends),
  }));
  return part(stored) === part(opened);
}
