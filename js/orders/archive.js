// archive.js — turning a draft into history records. Pure: no Firestore here.
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

import { t } from '../i18n.js';
import { supplierLabel } from '../supplier-label.js';
import { toISODate, addDays, isBefore } from './day.js';
import { compareLabels } from './order-text.js';
import { cleanUnit, sameUnit, lineUnit, entryUnit, recordUnit } from '../order-unit.js';

// A quantity, made safe: whole, never negative, never NaN — and never Infinity.
//
// THE ONE definition, shared by every screen that reads a typed number (the order
// rows, the History editor). `Number(v) || 0` alone let Infinity through: a number
// field accepts `1e999`, and Firestore refuses to store a non-finite number, so
// every save afterwards failed while the row on screen looked perfectly normal.
export function wholeNumber(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

const num = wholeNumber;

export function historyDocId(date, supplierId) {
  return `${date}_${supplierId}`;
}

// A record written by the old weekly model has no supplierId.
export function isLegacyRecord(record) {
  return !record?.supplierId;
}

// The day a record belongs to, whichever model wrote it.
export function recordDate(record) {
  return record?.date || record?.weekStart || '';
}

// This supplier's ingredients. activeOnly is the right lens for anything the
// operator SEES (counting, nagging); pass false when CLEARING the draft, or a
// quantity left on a since-deactivated ingredient would sit there forever,
// invisible and unclearable.
export function ingredientsOf(supplierId, ingredients, { activeOnly = true } = {}) {
  return (ingredients || []).filter(i =>
    i.supplierId === supplierId && (!activeOnly || i.active !== false));
}

// Does this supplier have anything worth recording? (Stock on its own is not an
// order — see the note in buildSupplierArchive.)
export function supplierHasItems(supplierId, ingredients, entries) {
  return ingredientsOf(supplierId, ingredients).some(i => num(entries?.[i.id]?.qty) > 0);
}

// Build the history payload for ONE supplier out of the shared draft entries.
// Returns null when nothing was ordered — there is no such thing as an empty order.
//
// `quantities` holds ONLY rows with qty > 0, and that is load-bearing: it is the
// map the suggestion engine averages over. A "stock was full so I ordered 0" row
// has a HIGH level (stock + 0) and there is no matching downward pull, so
// recording it would ratchet the par level up week after week. `stock` may hold
// the reading for any filled-in row; the engine ignores rows absent from
// `quantities`, so it costs nothing and keeps the raw reading for later.
export function buildSupplierArchive({ supplier, ingredients, entries, date, now = new Date() }) {
  const quantities = {};
  const stock = {};
  const names = {};
  const units = {};

  ingredientsOf(supplier.id, ingredients).forEach(ing => {
    const entry = entries?.[ing.id];
    if (!entry) return;
    const qty = num(entry.qty);
    const onHand = num(entry.stock);
    if (qty > 0) {
      quantities[ing.id] = qty;
      names[ing.id] = ingredientLabel(ing);
      // Frozen for every line that HAD a choice (even the default one: «1 cartone» and
      // «1 busta» are different orders) and for any non-default unit. A line with no
      // choice stays out, so an ordinary record keeps its old shape.
      const unit = lineUnit(ing, entry);
      if (unit) units[ing.id] = unit;
    }
    if (qty > 0 || onHand > 0) stock[ing.id] = onHand;
  });

  if (!Object.keys(quantities).length) return null;

  const timestamp = now.toISOString();
  return {
    date,
    supplierId: supplier.id,
    supplierName: supplierLabel(supplier),
    quantities,
    stock,
    // What each item was CALLED on the day. The screen prefers the live ingredient
    // (a rename should show through everywhere), so this is only read once the
    // ingredient is gone — and then it is the only thing standing between a past
    // order and a row of raw document ids. Same reasoning as supplierName, which has
    // been frozen into the record since the per-day model.
    names,
    ...(Object.keys(units).length ? { units } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

// The label an order shows for an ingredient: "Bacon 2.27kg". One definition, so a
// name frozen into a record matches what the live row would have shown.
export function ingredientLabel(ing) {
  return [ing?.name, ing?.weight].filter(Boolean).join(' ');
}

// The order every list of a supplier's products is read in: by the label a person reads,
// numerically («Flour 5kg» before «Flour 25kg» — the message's own compareLabels), then by
// id, so two identical labels cannot swap places between repaints and make the rows jump
// under the eye. A nameless item has an empty label and so sorts first — it stays visible
// at the top instead of hiding.
export function compareByLabel(a, b) {
  return compareLabels(ingredientLabel(a), ingredientLabel(b))
    || String(a?.id).localeCompare(String(b?.id));
}

// A sorted COPY — the caller's list is the shared state and is never reordered.
export function sortByLabel(list) {
  return (list || []).filter(Boolean).slice().sort(compareByLabel);
}

// What a PAST order calls one of its items, in order of preference:
//   1. the ingredient as it is called NOW — a rename must show through everywhere;
//   2. the name frozen into the record when the order was placed;
//   3. an honest placeholder.
// Never the raw document id, which is what the screen used to fall back to: an order
// reading "Fdx92kQ1: 4" tells nobody what was bought, and the whole point of History
// is answering exactly that.
export function recordedName(id, ingredientsById, names) {
  const live = ingredientLabel(ingredientsById?.[id]);
  if (live) return live;
  const stored = names?.[id];
  return typeof stored === 'string' && stored.trim() ? stored.trim() : t('orders.deletedIngredient');
}

// The draft fields to delete when the operator throws away what they have typed
// for one or more suppliers, WITHOUT recording an order.
//
// Two things make this different from clearSupplier above, and both were asked for:
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
export function quantityPathsFor(supplierIds, ingredients) {
  const ids = (supplierIds || []).filter(Boolean);
  const paths = [];
  ids.forEach(supplierId => {
    ingredientsOf(supplierId, ingredients, { activeOnly: false })
      .forEach(ing => {
        paths.push(`entries.${ing.id}.qty`);
        // The unit goes with the quantity: a cleared row starts again in the card's own
        // unit (the default), never in whatever the last order happened to use.
        paths.push(`entries.${ing.id}.unit`);
      });
    paths.push(`days.${supplierId}`);
  });
  return paths;
}

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
export function changedEntries(next, known) {
  const out = {};
  Object.entries(next || {}).forEach(([id, entry]) => {
    const before = (known || {})[id];
    const qty = num(entry?.qty);
    const stock = num(entry?.stock);
    const unit = cleanUnit(entry?.unit);
    const beforeUnit = cleanUnit(before?.unit);
    // Merely LOOKING at a supplier materialises a blank row in memory, and an
    // all-zero row that the document never had says nothing worth storing.
    // (A row that EXISTS and is taken down to zero is a real change: `before`
    // is there, so it still goes.) A row that carries a unit is not blank.
    if (!before && qty === 0 && stock === 0 && !unit) return;
    if (!before || num(before.qty) !== qty || num(before.stock) !== stock || beforeUnit !== unit) {
      const row = { qty, stock };
      // ⚠️ `unit: ''` IS SENT ON PURPOSE when a row goes back to the card's unit: a merge
      // write never deletes a nested key, so omitting it would leave the old unit in the
      // document and the row would come back as «busta» on the next snapshot. An
      // ordinary entry (no unit on either side) keeps exactly {qty, stock}.
      if (unit || beforeUnit) row.unit = unit;
      out[id] = row;
    }
  });
  return out;
}

// The same idea for the per-supplier day stamps: sending the whole map would
// re-assert another phone's day for a supplier this one never touched.
export function changedDays(next, known) {
  const out = {};
  Object.entries(next || {}).forEach(([supplierId, day]) => {
    if ((known || {})[supplierId] !== day) out[supplierId] = day;
  });
  return out;
}

// Two orders to the same supplier on the same day are ONE order: the second is
// "I forgot a couple of things", so quantities ADD UP rather than replace (which
// would silently destroy the first order — the rows are cleared after archiving,
// so the second payload only ever carries the forgotten items). The stock reading
// is a measurement, not a total: the newer one wins.
//
// ⚠️ NEVER ADD TWO DIFFERENT UNITS. 2 cartoni + 3 buste is neither 5 of anything nor a
// number we may convert (we do not know the case size here), so the same ingredient
// ordered twice in one day in different units THROWS `orders/unit-conflict` and nothing
// is written. `cardUnitOf(id)` supplies the unit of a record that froze none (every
// record from before the choice existed is in the card's own unit).
export function mergeArchives(existing, incoming, { cardUnitOf } = {}) {
  if (!existing) return incoming;

  const effectiveUnit = (record, id) => recordUnit(record, id, { unit: cardUnitOf?.(id) });
  const conflicts = Object.keys(incoming.quantities || {}).filter(id =>
    num(existing.quantities?.[id]) > 0 && num(incoming.quantities[id]) > 0 &&
    !sameUnit(effectiveUnit(existing, id), effectiveUnit(incoming, id)));
  if (conflicts.length) {
    // The message is the code itself: never shown (placeOrder says it through t()), and a
    // sentence here would be a phrase that reaches a screen without the dictionary.
    const err = new Error('orders/unit-conflict');
    err.code = 'orders/unit-conflict';
    err.ids = conflicts;
    throw err;
  }

  const quantities = { ...(existing.quantities || {}) };
  Object.entries(incoming.quantities || {}).forEach(([id, qty]) => {
    quantities[id] = num(quantities[id]) + num(qty);
  });
  const units = { ...(existing.units || {}), ...(incoming.units || {}) };

  return {
    ...incoming,
    quantities,
    stock: { ...(existing.stock || {}), ...(incoming.stock || {}) },
    // Keep every name the record has ever carried. The incoming write only names the
    // items IT adds, so replacing rather than merging would strip the names off the
    // rows placed earlier in the day — and a phone still on the previous version
    // sends no names at all, which must not erase the ones already stored.
    names: { ...(existing.names || {}), ...(incoming.names || {}) },
    // Same reasoning as names: keep the units of the rows placed earlier in the day.
    ...(Object.keys(units).length ? { units } : {}),
    createdAt: existing.createdAt || incoming.createdAt,
    updatedAt: incoming.updatedAt,
  };
}

// ⚠️ THE SAME QUESTION mergeArchives ANSWERS, asked BEFORE anything leaves the app: which of
// the draft's lines would meet today's record of this supplier in a DIFFERENT unit? The
// merge throws on these, but by then a WhatsApp message may already have gone to the
// supplier, so the screens ask this first. Both use recordUnit() and sameUnit(), so «the
// same unit» has one meaning.
//
// existingRecord: today's history record for this supplier, or null/undefined.
// -> [{ id, name, unit }] — `unit` is the one ALREADY RECORDED, what the person must stay in.
export function unitConflicts(existingRecord, entries, ingredients, supplierId) {
  if (!existingRecord) return [];
  const out = [];
  ingredientsOf(supplierId, ingredients).forEach(ing => {
    const entry = entries?.[ing.id];
    if (!entry || num(entry.qty) <= 0 || num(existingRecord.quantities?.[ing.id]) <= 0) return;
    const recorded = recordUnit(existingRecord, ing.id, ing);
    if (!sameUnit(entryUnit(entry, ing), recorded)) {
      out.push({ id: ing.id, name: ingredientLabel(ing), unit: recorded });
    }
  });
  return out;
}

// «Flour 25kg — cartone, Yeast — busta»: each clashing line with the unit it must stay in,
// joined with commas (no singular/plural agreement to get wrong in either language).
export function unitConflictList(conflicts) {
  return (conflicts || []).map(c => `${c.name} — ${c.unit}`).join(', ');
}

// Split day sections (the output of groupHistoryByDay) into the ones History shows
// straight away and the ones parked behind "Show older orders".
//
// This HIDES, it never deletes: `older` is returned, not dropped, and the suggestion
// engine reads the raw records rather than this split — so narrowing the window can
// never change a suggested quantity. That separation is the whole safety of the
// feature: an ingredient ordered weekly needs 4 past orders before suggestions turn
// on (suggestions.js), which a 15-day window would never accumulate.
//
// The window INCLUDES today: 15 days means today and the 14 before it. The boundary
// is computed once with addDays (DST-safe — see day.js), and the per-record test is a
// string compare on "YYYY-MM-DD", which is exact.
//
// An unusable window shows EVERYTHING rather than nothing: normalizeOrdersConfig has
// already applied the default, so anything wrong reaching here means the assumption
// failed somewhere, and the safe failure is a long list, never an empty one.
export function splitHistoryByAge(days, historyDays, now = new Date()) {
  const list = days || [];
  const window = Math.floor(Number(historyDays));
  if (!Number.isFinite(window) || window < 1) return { recent: list, older: [] };

  const cutoff = toISODate(addDays(now, -(window - 1)));
  return {
    recent: list.filter(d => !isBefore(d.date, cutoff)),
    older: list.filter(d => isBefore(d.date, cutoff)),
  };
}

// How many ORDERS sit in a set of day sections — what "Show older orders (N)" counts.
// Days are the sections; the operator thinks in orders.
export function countRecords(days) {
  return (days || []).reduce((total, d) => total + (d.records?.length || 0), 0);
}

// Group history records into day sections, most recent day first, and within a
// day by supplier name. Legacy weekly records land under their weekStart.
export function groupHistoryByDay(history) {
  const byDay = new Map();

  (history || []).forEach(record => {
    const date = recordDate(record);
    if (!date) return;
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push(record);
  });

  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, records]) => ({
      date,
      records: records.slice().sort((a, b) =>
        String(a.supplierName || '').localeCompare(String(b.supplierName || ''))),
    }));
}
