// order-request-model.ts — an order list one person sends to another. PURE.
//
// TypeScript port of js/orders/order-request-model.js for Mise 2 (whole since step 3f-7, the order lists). Behaviour is
// identical, input for input, but for the ADAPTED points below: order-request-model.spec.ts runs its tests against BOTH files
// and odd-inputs.spec.ts feeds both the same strange values.
//
// ⚠️ NOT PAIRED IN parity.spec.ts, BECAUSE TWO THINGS ARE ADAPTED ON PURPOSE:
//   - `senderName(member)` takes no address and ends in '' rather than a word. HIS DECISION (P13, 3 Nov 2026): an email address is
//     never saved on a list, because everybody with the section reads it. The screen reads '' as «Someone» in the reader's own
//     language. The current app still falls back to the address until the switch.
//   - `groupRequest` takes its two words as a third argument, so shared/ never imports the dictionary (as archive.ts recordedName).
//
// The numbers this file freezes are what somebody will actually buy.

import { ingredientLabel, ingredientsOf, recordedName, wholeNumber } from './archive';
import { addDays, isBefore, toISODate } from './day';
import { cleanUnit, entryUnit, lineUnit, recordUnit, sameUnit } from './order-unit';
import { supplierLabel } from './supplier-label';

// ⚠️ A CAP, BECAUSE THE RULES CANNOT COUNT WHAT THEY CANNOT SEE. firestore.rules caps each map's size; this is the same number at
// this end, so a list too big is refused HERE with something a person can read, instead of coming back as a bare permission error.
export const MAX_LINES = 500;

// How far back the screen draws. ⚠️ A WINDOW, NOT A LIFETIME: past this the lists stop being DRAWN; «Show older» widens.
export const REQUEST_WINDOW_DAYS = 15;

// A list is a document (data): anything may arrive.
export interface OrderRequest {
  date?: unknown;
  fromUid?: unknown;
  fromName?: unknown;
  quantities?: unknown;
  units?: unknown;
  names?: unknown;
  supplierOf?: unknown;
  supplierNames?: unknown;
  done?: unknown;
  note?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

const mapOf = <T = unknown>(value: unknown): Record<string, T> => (value || {}) as Record<string, T>;

// ── Who sent it ───────────────────────────────────────────────────────────────

// ⚠️ NEVER THE RAW uid: a list headed «From Fdx92kQ1nT» tells nobody anything. And, since his decision of 3 Nov 2026, NEVER THE
// ADDRESS either (see the head of this file): nobody on the roster with a name is '' on the list.
//
// The roster row is a LABEL, never an identity: this is only ever what the screen prints, and no decision is taken on it.
export function senderName(member?: unknown): string {
  const row = member as { firstName?: unknown; lastName?: unknown } | null | undefined;
  return [row?.firstName, row?.lastName]
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
}

// ── Freezing the list ─────────────────────────────────────────────────────────

export interface BuiltOrderRequest {
  date: string;
  fromUid: string;
  fromName: string;
  quantities: Record<string, number>;
  units?: Record<string, string>;
  names: Record<string, string>;
  supplierOf: Record<string, string>;
  supplierNames: Record<string, string>;
  done: Record<string, never>;
  note: string;
  createdAt: string;
  updatedAt: string;
}

interface BuildArgs {
  suppliers?: readonly ({ id?: unknown; [key: string]: unknown } | null | undefined)[] | null;
  ingredients?: readonly unknown[] | null;
  entries?: unknown;
  date: string;
  from?: { uid?: string; name?: string } | null;
  note?: unknown;
  now?: Date;
}

// Turn the chosen suppliers' slice of the shared draft into the document that is sent. Returns null when there is nothing to
// order — there is no such thing as an empty order list, and the rules refuse one too.
//
// ⚠️ FLAT MAPS, NOT A NESTED LIST: firestore.rules cannot look inside a list, so with maps every part gets a type and a size.
//
// ⚠️ ONLY ROWS WITH qty > 0: a row somebody left at 0 is a row they decided NOT to order, and it could never be ticked off as bought.
export function buildOrderRequest({
  suppliers, ingredients, entries, date, from, note = '', now = new Date(),
}: BuildArgs): BuiltOrderRequest | null {
  const quantities: Record<string, number> = {};
  const units: Record<string, string> = {};
  const names: Record<string, string> = {};
  const supplierOf: Record<string, string> = {};
  const supplierNames: Record<string, string> = {};
  const lines = mapOf<{ qty?: unknown } | undefined>(entries);

  (suppliers || []).forEach(supplier => {
    if (!supplier || !supplier.id) return;
    const supplierId = supplier.id as string;
    let used = false;
    // The SAME lens the archive uses, so a list that is sent and the order later recorded can never disagree about what a
    // supplier sells.
    ingredientsOf(supplierId, ingredients as readonly { id: string }[]).forEach(ing => {
      const qty = wholeNumber(lines[ing.id]?.qty);
      if (qty <= 0) return;
      quantities[ing.id] = qty;
      // The unit the line means, frozen like the record does — only for a line with a choice (or a non-default unit).
      const unit = lineUnit(ing, lines[ing.id]);
      if (unit) units[ing.id] = unit;
      // Frozen the day it was sent, so a list still names what was asked for after the ingredient is renamed or deleted.
      names[ing.id] = ingredientLabel(ing);
      supplierOf[ing.id] = supplierId;
      used = true;
    });
    // ⚠️ Only suppliers that CONTRIBUTED a line are named: otherwise an empty heading with nothing under it.
    if (used) supplierNames[supplierId] = supplierLabel(supplier);
  });

  const count = Object.keys(quantities).length;
  if (!count || count > MAX_LINES) return null;

  const timestamp = now.toISOString();
  return {
    date,
    fromUid: from?.uid || '',
    fromName: from?.name || '',
    quantities,
    // Left out entirely when no line has a unit: the rules treat the key as optional.
    ...(Object.keys(units).length ? { units } : {}),
    names,
    supplierOf,
    supplierNames,
    // ⚠️ BORN EMPTY, AND IT IS THE ONLY FIELD THAT EVER CHANGES AFTERWARDS: the rules allow an update to touch `done` and
    // `updatedAt` and nothing else, so a tick can never become the way to rewrite somebody else's quantities.
    done: {},
    note: String(note || '').trim().slice(0, 500),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

// ── Is it finished? ───────────────────────────────────────────────────────────

// ⚠️⚠️ THERE IS NO "FINISHED" FIELD, AND THERE MUST NOT BE. A list is finished when every line is ticked — deduced, never stored.
//
// ⚠️ A LIST WITH NO LINES READS AS FINISHED, deliberately: nothing can create one, and an impossible document must not be able to
// jam a screen for ever.
export function isRequestDone(request?: unknown): boolean {
  const req = request as OrderRequest | null | undefined;
  const done = mapOf(req?.done);
  return Object.keys(mapOf(req?.quantities)).every(id => done[id] === true);
}

// The lines still to order — what "Finish" would tick, and what the counter counts.
export function remainingIds(request?: unknown): string[] {
  const req = request as OrderRequest | null | undefined;
  const done = mapOf(req?.done);
  return Object.keys(mapOf(req?.quantities)).filter(id => done[id] !== true);
}

// Every list still waiting, newest first. The one definition of "waiting", so the door's number and the screen cannot disagree.
export function waitingRequests<T>(list?: readonly T[] | null): T[] {
  return (list || [])
    .filter((r): r is T & NonNullable<T> => !!r && !isRequestDone(r))
    .slice()
    .sort((a, b) => String((b as OrderRequest).createdAt || '').localeCompare(String((a as OrderRequest).createdAt || '')));
}

// ── What the screen draws ─────────────────────────────────────────────────────

export interface RequestItem {
  id: string;
  name: string;
  qty: number;
  // What the line was sent in; '' = the card's own unit (no word to print).
  unit: string;
  done: boolean;
}

export interface RequestGroup {
  supplierId: string;
  supplierName: string;
  items: RequestItem[];
  doneCount: number;
  total: number;
}

// ADAPTED: the two words the original reads from the dictionary. `noSupplier` heads the lines with no named supplier, `deleted`
// names a line whose name was never frozen (archive.ts recordedName).
export interface RequestWords {
  noSupplier: string;
  deleted: string;
}

// The list regrouped under its suppliers, in the order they were sent.
//
// ⚠️ THE NAME PREFERS THE LIVE INGREDIENT, falling back to the frozen one: a rename must show through everywhere, and a deleted
// ingredient must still name itself.
export function groupRequest(request: unknown, ingredientsById: Record<string, unknown> | null | undefined, words?: RequestWords): RequestGroup[] {
  const req = request as OrderRequest | null | undefined;
  const quantities = mapOf(req?.quantities);
  const supplierOf = mapOf<string>(req?.supplierOf);
  const supplierNames = mapOf<string>(req?.supplierNames);
  const done = mapOf(req?.done);
  const units = mapOf(req?.units);

  const bySupplier = new Map<string, RequestItem[]>();
  Object.keys(supplierNames).forEach(id => bySupplier.set(id, []));

  Object.keys(quantities).forEach(id => {
    // A line whose supplier was never named still has to be drawn: losing it would silently drop something somebody asked for.
    const supplierId = supplierOf[id] || '';
    if (!bySupplier.has(supplierId)) bySupplier.set(supplierId, []);
    bySupplier.get(supplierId)?.push({
      id,
      name: recordedName(id, ingredientsById, req?.names, words?.deleted ?? ''),
      qty: wholeNumber(quantities[id]),
      unit: cleanUnit(units[id]),
      done: done[id] === true,
    });
  });

  return [...bySupplier.entries()]
    .filter(([, items]) => items.length)
    .map(([supplierId, items]) => {
      const sorted = items.slice().sort((a, b) => a.name.localeCompare(b.name));
      return {
        supplierId,
        supplierName: supplierNames[supplierId] || (words?.noSupplier ?? ''),
        items: sorted,
        doneCount: sorted.filter(i => i.done).length,
        total: sorted.length,
      };
    });
}

// Which suppliers this list covers — what the "Order placed" hand-off is offered for.
export function supplierIdsOf(request?: unknown): string[] {
  return Object.keys(mapOf((request as OrderRequest | null | undefined)?.supplierNames));
}

// ── The list is a photograph, and the shared list moves on ────────────────────

// Where the LIVE order now disagrees with what was sent: { ingredientId: liveQty }.
//
// ⚠️ ONLY LINES NOT YET TICKED: recording an order CLEARS the rows it recorded, and an alarm that fires on success is an alarm
// people learn to ignore.
//
// ⚠️ A DIFFERENT UNIT IS A DIFFERENCE, even at the same number. `ingredientsById` (optional) lets the card's own unit stand for «no
// unit stored»; without it only stored units are compared.
export function liveDifference(request: unknown, entries: unknown, ingredientsById: Record<string, unknown> = {}): Record<string, number> {
  const req = request as OrderRequest | null | undefined;
  const quantities = mapOf(req?.quantities);
  const done = mapOf(req?.done);
  const lines = mapOf<{ qty?: unknown } | undefined>(entries);
  const out: Record<string, number> = {};
  Object.keys(quantities).forEach(id => {
    if (done[id] === true) return;
    const ing = ingredientsById?.[id];
    const live = wholeNumber(lines[id]?.qty);
    const sentUnit = recordUnit(req, id, ing);
    const liveUnit = entryUnit(lines[id], ing);
    if (live !== wholeNumber(quantities[id]) || !sameUnit(sentUnit, liveUnit)) out[id] = live;
  });
  return out;
}

// ── The window on the screen ──────────────────────────────────────────────────

// ⚠️ IT RETURNS THE OLD ONES RATHER THAN DROPPING THEM: «Show older» needs them, and hiding must not be mistaken for deleting.
export function splitRequestsByAge<T>(requests?: readonly T[] | null, windowDays: unknown = REQUEST_WINDOW_DAYS, now: Date = new Date()): { recent: readonly T[]; older: readonly T[] } {
  const list = requests || [];
  const window = Math.floor(Number(windowDays));
  if (!Number.isFinite(window) || window < 1) return { recent: list, older: [] };

  const cutoff = toISODate(addDays(now, -(window - 1)));
  const dateOf = (r: T) => String((r as OrderRequest | null | undefined)?.date || '');
  return {
    recent: list.filter(r => !isBefore(dateOf(r), cutoff)),
    older: list.filter(r => isBefore(dateOf(r), cutoff)),
  };
}
