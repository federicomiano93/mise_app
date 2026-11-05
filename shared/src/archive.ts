// archive.ts — turning a draft into history records, the pure half that the Orders list and the draft
// writer need. No Firestore here.
//
// TypeScript PARTIAL port of js/orders/archive.js for Mise 2. PORTED, identical input for input:
// wholeNumber, historyDocId, ingredientsOf, supplierHasItems, ingredientLabel, ingredientDisplayLabel,
// compareByLabel, sortByLabel, quantityPathsFor, changedEntries, changedDays. None of them reads the
// dictionary. archive.spec.ts compares them with the js/ file's own exports and runs the matching
// tests; odd-inputs.spec.ts feeds both the same strange values.
//
// ⚠️ A PARTIAL PORT, SO parity.spec.ts DOES NOT PAIR IT. NOT PORTED (slices 3f-2 and 3f-4 of the Orders
// section): buildSupplierArchive, mergeArchives, recordedName (it uses the dictionary for the
// deleted-ingredient word), isLegacyRecord, recordDate, the sends (sendIdFor, MAX_SENDS, capSends,
// withCorrection, recordSends, sendSections), unitConflicts, unitConflictList, splitHistoryByAge,
// countRecords and groupHistoryByDay. They come with the screens that use them.
//
// An order is one DAY and one SUPPLIER: orders-history/{YYYY-MM-DD}_{supplierId}.
// Marking a supplier as placed must not touch the quantities already typed for the
// supplier you order on Thursday, so every function below works on ONE supplier's
// slice of the shared draft.
//
// The field names `quantities` and `stock` are deliberately unchanged from the
// old weekly model: the legacy weekly documents (one per ISO week, all suppliers
// merged) stay readable by both the history view and the suggestion engine, so
// nothing had to be migrated.

import { ingredientDisplayName } from './ingredient-name';
import { compareLabels } from './order-text';
import { cleanUnit } from './order-unit';
import { overrideOf, cleanSupplierId } from './line-supplier';

// A quantity, made safe: whole, never negative, never NaN — and never Infinity.
//
// THE ONE definition, shared by every screen that reads a typed number (the order
// rows, the History editor). `Number(v) || 0` alone let Infinity through: a number
// field accepts `1e999`, and Firestore refuses to store a non-finite number, so
// every save afterwards failed while the row on screen looked perfectly normal.
export function wholeNumber(v?: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

const num = wholeNumber;

export function historyDocId(date: unknown, supplierId: unknown): string {
  return `${date}_${supplierId}`;
}

interface Row { id?: unknown; supplierId?: unknown; active?: unknown; name?: unknown; weight?: unknown }

// This supplier's ingredients. activeOnly is the right lens for anything the
// operator SEES (counting, nagging); pass false when CLEARING the draft, or a
// quantity left on a since-deactivated ingredient would sit there forever,
// invisible and unclearable.
export function ingredientsOf<T>(supplierId: unknown, ingredients?: readonly T[] | null, { activeOnly = true }: { activeOnly?: boolean } = {}): T[] {
  return (ingredients || []).filter(i =>
    (i as Row).supplierId === supplierId && (!activeOnly || (i as Row).active !== false));
}

// Does this supplier have anything worth recording? (Stock on its own is not an
// order — see the note in buildSupplierArchive of the original.)
export function supplierHasItems(supplierId: unknown, ingredients?: readonly unknown[] | null, entries?: unknown): boolean {
  const byId = entries as Record<string, { qty?: unknown } | undefined> | null | undefined;
  return ingredientsOf(supplierId, ingredients).some(i => num(byId?.[(i as { id: string }).id]?.qty) > 0);
}

// The label an order shows for an ingredient: "Bacon 2.27kg". One definition, so a
// name frozen into a record matches what the live row would have shown.
//
// ⚠️ THIS IS THE LABEL OF WHAT WAS SENT: it keeps the INVOICE name on purpose, and it is what is
// frozen into `names`. To put an ingredient on a SCREEN use ingredientDisplayLabel below.
export function ingredientLabel(ing?: unknown): string {
  const r = ing as Row | null | undefined;
  return [r?.name, r?.weight].filter(Boolean).join(' ');
}

// The label a SCREEN shows for an ingredient: the «name to show» when there is one (ingredient-name.ts),
// else the name, then the weight. Never written into a record and never sent to a supplier.
export function ingredientDisplayLabel(ing?: unknown): string {
  return [ingredientDisplayName(ing), (ing as Row | null | undefined)?.weight].filter(Boolean).join(' ');
}

// The order every list of a supplier's products is read in: by the label a person reads,
// numerically («Flour 5kg» before «Flour 25kg» — the message's own compareLabels), then by
// id, so two identical labels cannot swap places between repaints and make the rows jump
// under the eye. A nameless item has an empty label and so sorts first — it stays visible
// at the top instead of hiding.
export function compareByLabel(a?: unknown, b?: unknown): number {
  return compareLabels(ingredientDisplayLabel(a), ingredientDisplayLabel(b))
    || String((a as Row | null | undefined)?.id).localeCompare(String((b as Row | null | undefined)?.id));
}

// A sorted COPY — the caller's list is the shared state and is never reordered.
export function sortByLabel<T>(list?: readonly T[] | null): T[] {
  return (list || []).filter(Boolean).slice().sort(compareByLabel);
}

// The draft fields to delete when the operator throws away what they have typed
// for one or more suppliers, WITHOUT recording an order.
//
// Two things make this different from clearSupplier, and both were asked for:
//   * only `entries.<id>.qty` goes, never the whole row — so the STOCK reading
//     survives. Counting the shelves is work already done, and starting the order
//     again should not mean counting them again.
//   * several suppliers in one list, so the whole thing is ONE Firestore write with
//     no half-cleared state in between (P14 as well: one operation, not N).
//
// The day stamp goes with the quantities: `days.<supplierId>` records when those
// rows were typed, and with nothing left to order it would describe nothing.
//
// ⚠️ NOTHING HERE TOUCHES orders-history. Clearing the draft is not the same as
// deleting an order: anything already recorded stays recorded, and the suggestion
// engine — which reads only the history — is unaffected.
//
// ⚠️ Uses the UNFILTERED ingredient list, exactly like clearSupplier: a quantity
// left on a since-deactivated product is invisible on screen but still in the
// document, and skipping it would leave a row nobody can see or clear.
export function quantityPathsFor(supplierIds?: readonly unknown[] | null, ingredients?: readonly unknown[] | null): string[] {
  const ids = (supplierIds || []).filter(Boolean);
  const paths: string[] = [];
  ids.forEach(supplierId => {
    ingredientsOf(supplierId, ingredients, { activeOnly: false })
      .forEach(ing => {
        const id = (ing as { id?: unknown }).id;
        paths.push(`entries.${id}.qty`);
        // The unit goes with the quantity: a cleared row starts again in the card's own
        // unit (the default), never in whatever the last order happened to use.
        paths.push(`entries.${id}.unit`);
        // ⚠️ AND THE OVERRIDE (line-supplier.ts): it never outlives the quantity it
        // redirects, or the next quantity typed for this ingredient would go to a supplier
        // nobody chose this time.
        paths.push(`entries.${id}.supplierId`);
      });
    paths.push(`days.${supplierId}`);
  });
  return paths;
}

export interface EntryChange { qty: number; stock: number; unit?: string; supplierId?: string }

// The slice of the draft that actually CHANGED since the copy we last agreed on
// with the server — the only thing an autosave has any business sending.
//
// ⚠️ THIS IS A CONCURRENCY FIX, not a saving of bytes. The autosave used to send
// the WHOLE entries map. Firestore merges a map key by key, so every save also
// re-asserted every OTHER row at the value this phone happened to hold — and a
// quantity a colleague had typed seconds earlier, not yet arrived here, was
// silently rewritten back to its old value. Two people ordering at once is
// normal in a kitchen, and nothing on either screen showed what had happened.
//
// Sending only the changed keys makes the merge do what it looks like it does:
// untouched rows are not mentioned, so nobody else's work is overwritten.
//
// A key with no counterpart in `known` counts as changed (it is new), and both
// fields are compared through the same clamp the UI applies, so "" and 0 are not
// mistaken for a change.
export function changedEntries(next?: unknown, known?: unknown): Record<string, EntryChange> {
  const out: Record<string, EntryChange> = {};
  type Entry = { qty?: unknown; stock?: unknown; unit?: unknown; supplierId?: unknown } | null | undefined;
  Object.entries((next || {}) as Record<string, Entry>).forEach(([id, entry]) => {
    const before = ((known || {}) as Record<string, Entry>)[id];
    const qty = num(entry?.qty);
    const stock = num(entry?.stock);
    const unit = cleanUnit(entry?.unit);
    const beforeUnit = cleanUnit(before?.unit);
    // The override only exists while there is a quantity (overrideOf), so a line taken to
    // zero loses it in this same write.
    const supplierTo = overrideOf(entry);
    // ⚠️ THE STORED VALUE, RAW — not overrideOf(before), which is '' whenever the stored row has
    // no quantity. A leftover {qty: 0, supplierId: 'X'} (an older phone typing 0 or running
    // «start again», or a two-phone race) must still be seen and cleared, or the next quantity
    // typed for this ingredient would revive it and file the line under X.
    const beforeSupplierRaw = cleanSupplierId(before?.supplierId);
    // Merely LOOKING at a supplier materialises a blank row in memory, and an
    // all-zero row that the document never had says nothing worth storing.
    // (A row that EXISTS and is taken down to zero is a real change: `before`
    // is there, so it still goes.) A row that carries a unit is not blank.
    if (!before && qty === 0 && stock === 0 && !unit) return;
    if (!before || num(before.qty) !== qty || num(before.stock) !== stock || beforeUnit !== unit
      || beforeSupplierRaw !== supplierTo) {
      const row: EntryChange = { qty, stock };
      // ⚠️ `unit: ''` IS SENT ON PURPOSE when a row goes back to the card's unit: a merge
      // write never deletes a nested key, so omitting it would leave the old unit in the
      // document and the row would come back as «busta» on the next snapshot. An
      // ordinary entry (no unit on either side) keeps exactly {qty, stock}.
      if (unit || beforeUnit) row.unit = unit;
      // ⚠️ THE SAME FOR THE OVERRIDE: `supplierId: ''` is sent when a line goes back to its
      // usual supplier or to zero, because a merge write cannot delete a nested key. An
      // ordinary line (no override on either side) keeps exactly {qty, stock}.
      if (supplierTo || beforeSupplierRaw) row.supplierId = supplierTo;
      out[id] = row;
    }
  });
  return out;
}

// The same idea for the per-supplier day stamps: sending the whole map would
// re-assert another phone's day for a supplier this one never touched.
export function changedDays(next?: unknown, known?: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.entries((next || {}) as Record<string, unknown>).forEach(([supplierId, day]) => {
    if (((known || {}) as Record<string, unknown>)[supplierId] !== day) out[supplierId] = day;
  });
  return out;
}
