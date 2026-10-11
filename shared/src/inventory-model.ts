// inventory-model.ts — the month's stocktake, as pure arithmetic.
//
// TypeScript port of js/inventory/inventory-model.js for Mise 2. Behaviour is identical, input for
// input: inventory-model.spec.ts runs every test against BOTH files, parity.spec.ts compares their
// exports and odd-inputs.spec.ts feeds both the same strange values. The comments below are the ones
// the original paid for in bugs.
//
// PURE, ZERO IMPORTS: no DOM, no Firestore, no clock of its own. Everything that
// decides a number lives here so it can be tested without a browser (P15), which
// matters more than usual on this screen — the owner cannot read the code, and a
// wrong subtraction here would not look wrong on the phone. It would just be wrong.
//
// THE WHOLE FEATURE IS ONE SUBTRACTION:
//
//     what you had  +  what you bought  −  what is left  =  what you used
//
// ⚠️⚠️ AN EMPTY BOX IS NOT A ZERO, AND THAT IS THE ONE RULE THIS FILE EXISTS TO
// PROTECT. "I have not counted this yet" and "I counted it and there is none
// left" are different facts. Read as zero, an ingredient nobody walked past would
// report its ENTIRE stock as consumed — a number that is not merely imprecise, it
// is invented, and it would land in a food-cost figure a business decision gets
// made on. So a missing count is `null` everywhere below, and a consumption that
// depends on one is `null` too. Same three-state shape, and the same reasoning, as
// `allergensCheckedAt` in allergen-model.ts.
//
// ⚠️ THE ONE DELIBERATE EXCEPTION IS `purchased`, and it runs the other way: a
// missing value there IS zero. Most products are not reordered every month, so
// "bought none" is the ordinary case, while "did not count" is the dangerous one.
// The screen prints the 0 rather than hiding it, so the assumption is always
// visible on the row it applies to.

// Anything at all may arrive (a document is data), so what is read off a month or a product is
// `unknown` and read the way the original reads it.
type Loose = Readonly<Record<string, unknown>>;
type Maybe<T> = T | null | undefined;

// The maps of counts a month document carries, and the ones that hold a name or a price frozen into
// it when it closes.
export type CountMap = 'opening' | 'purchased' | 'closing' | 'packKg';
export type FrozenMap = 'names' | 'unitPrice';

// A month as the rest of the feature may assume it: what normalizeMonth returns (never null here).
export interface InventoryMonth {
  id: string;
  month: string;
  opening: Record<string, number>;
  purchased: Record<string, number>;
  closing: Record<string, number>;
  packKg: Record<string, number>;
  names: Record<string, string>;
  unitPrice: Record<string, number>;
  closedAt: string;
  createdAt: string;
  updatedAt: string;
}

// The Firestore payload of a month: the same, without `id`.
export type MonthDocument = Omit<InventoryMonth, 'id'>;

// One product's line of the month.
export interface Consumption {
  opening: number | null;
  purchased: number;
  closing: number | null;
  used: number | null;
  counted: boolean;
  hasOpening: boolean;
}

export interface Progress {
  counted: number;
  total: number;
  done: boolean;
}

// The document id of a month, and the only shape this feature will accept.
export const MONTH_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

export function isMonthId(id: unknown): boolean {
  return typeof id === 'string' && MONTH_PATTERN.test(id);
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

// '2026-09' from a moment in LOCAL time.
//
// ⚠️ LOCAL, never UTC. At 00:30 on 1 October in British Summer Time, UTC still
// says September — so a stocktake started just after midnight would be written
// into the month that had already ended. Same reason js/orders/day.js builds its
// ISO dates from getFullYear/getMonth/getDate instead of toISOString().
export function monthKey(nowMs: number = Date.now()): string | null {
  const d = new Date(nowMs);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

// The month `delta` months away from this one. shiftMonth('2026-12', 1) is
// '2027-01' — the year rolls because Date does the arithmetic, not a hand-written
// "if the month is 12".
export function shiftMonth(monthId: unknown, delta: unknown): string | null {
  if (!isMonthId(monthId) || !Number.isInteger(delta)) return null;
  // The pattern gives two numbers, always.
  const [year, month] = (monthId as string).split('-').map(Number) as [number, number];
  // Day 1 at midday: a date built on the 1st at midnight can slip into the
  // previous day in a timezone behind UTC, and midday is safely clear of both
  // clock changes.
  const d = new Date(year, month - 1 + (delta as number), 1, 12, 0, 0);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export const previousMonth = (monthId: unknown): string | null => shiftMonth(monthId, -1);
export const nextMonth = (monthId: unknown): string | null => shiftMonth(monthId, 1);

// The two dates that bound a month, for a Firestore range query on `date`:
// `from` is inclusive, `to` is EXCLUSIVE (the 1st of the next month), so no
// arithmetic about how many days February has is ever needed.
export function monthBounds(monthId: unknown): { from: string; to: string } | null {
  if (!isMonthId(monthId)) return null;
  // A month id always has a next one.
  const next = nextMonth(monthId) as string;
  return { from: `${monthId as string}-01`, to: `${next}-01` };
}

// Round away binary-float dust: 0.1 + 0.2 must read as 0.3 on a screen somebody
// is comparing with a delivery note. Three decimals is far finer than anyone
// counts a shelf to, and coarse enough to hide the noise.
function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

// What somebody typed into a count box, as a number — or null for "nothing said".
//
// ⚠️ A COMMA IS A DECIMAL POINT HERE. The app runs in Italian on an Italian
// keyboard, where 3,5 is how three and a half is written; refusing it would look
// like the box was broken.
// ⚠️ NEGATIVE IS REFUSED, not clamped. You cannot have minus two sacks of flour,
// and silently turning −2 into 0 would hide a typo inside a number that then
// looks deliberate.
export function readCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? round3(value) : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(',', '.');
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? round3(n) : null;
}

// The maps a month document carries. Listed once, here, because the store, the
// rules and the tests all have to agree on them.
export const COUNT_MAPS: readonly CountMap[] = Object.freeze(['opening', 'purchased', 'closing', 'packKg'] as const);
export const FROZEN_MAPS: readonly FrozenMap[] = Object.freeze(['names', 'unitPrice'] as const);

function cleanCounts(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    const n = readCount(value);
    if (n !== null) out[id] = n;
  }
  return out;
}

function cleanNames(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text) out[id] = text.slice(0, 200);
  }
  return out;
}

// A month document from anywhere — Firestore, localStorage, a half-written draft
// — turned into the exact shape the rest of the feature may assume.
export function normalizeMonth(raw: unknown, fallbackId: unknown = null): InventoryMonth | null {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Loose;
  const id = isMonthId(source.month) ? (source.month as string)
    : isMonthId(source.id) ? (source.id as string)
      : isMonthId(fallbackId) ? (fallbackId as string) : null;
  if (!id) return null;

  return {
    id,
    month: id,
    opening: cleanCounts(source.opening),
    purchased: cleanCounts(source.purchased),
    closing: cleanCounts(source.closing),
    packKg: cleanCounts(source.packKg),
    names: cleanNames(source.names),
    unitPrice: cleanCounts(source.unitPrice),
    closedAt: typeof source.closedAt === 'string' ? source.closedAt : '',
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : '',
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
  };
}

export function isClosed(month: unknown): boolean {
  const m = month as Maybe<Loose>;
  return !!(m && typeof m.closedAt === 'string' && m.closedAt !== '');
}

// A product as this file reads it. Anything at all may be a list entry (a document is data), so a
// caller's own loose type comes back from countableProducts and productsOfMonth as it went in.
type Product = Loose;

// Everything countable in this venue: a product still in use, with a name. Written
// once, here, because the list, the progress figure, the close dialog and the cost
// screen all have to agree about what "a product" is.
export function countableProducts<T extends object>(ingredients: Maybe<readonly Maybe<T>[]>): T[] {
  const list: readonly Maybe<T>[] = Array.isArray(ingredients) ? ingredients : [];
  return list.filter((i): i is T => !!i && (i as Product).active !== false && String((i as Product).name || '').trim() !== '');
}

// The products a month is ABOUT — which for a CLOSED month is not the same
// question as "what does this venue sell today".
//
// ⚠️⚠️ A CLOSED MONTH IS A RECORD, AND A RECORD MAY NOT LOSE ROWS. Delete a product
// next spring and, read from the live list, September would quietly stop naming it
// and its cost would drop out of September's total — while the screen promises that
// the month's figures no longer change. So a closed month is read from what was
// frozen into it (`names`) plus, belt and braces, every id that carries a count:
// a row somebody counted cannot vanish, whatever became of the frozen list.
//
// ⚠️ AND THE LABEL IS THE FROZEN ONE. A product renamed afterwards keeps, inside
// that month, the name it was counted under.
//
// (For the types: a row of a closed month that no live product answers to is built from its id and
// its frozen label alone, so T is meant to be a loose shape — every field but `id` optional — such as
// `{ id: string } & Record<string, unknown>`.)
export function productsOfMonth<T extends object>(month: unknown, ingredients: Maybe<readonly Maybe<T>[]>): T[] {
  const live = countableProducts(ingredients);
  if (!isClosed(month)) return live;

  const m = month as Maybe<Loose>;
  const names = ((m && m.names) || {}) as Loose;
  const ids = new Set(Object.keys(names));
  // Only the three maps that hold a COUNT. `packKg` is a setting carried forward
  // from month to month, so a product that has one but was never counted is not a
  // row of this month.
  ['opening', 'purchased', 'closing'].forEach(map => {
    Object.keys(((m && m[map]) || {}) as object).forEach(id => ids.add(id));
  });
  // Closed with nothing recorded in it at all — there is nothing to read it from,
  // so the live list is more honest than an empty screen.
  if (!ids.size) return live;

  const byId = new Map<unknown, T>(live.map((i): [unknown, T] => [(i as Product).id, i]));
  return [...ids].map(id => {
    const known = byId.get(id) || {};
    const frozen = names[id];
    // The frozen label already carries the pack text, so the live `weight` is
    // dropped rather than printed twice.
    // `shortName` is dropped too: the frozen label is what that month shows, and a live short name
    // would replace it (and make two products with the same short name look identical).
    return (frozen ? { ...known, id, name: frozen, shortName: '', weight: '' } : { ...known, id }) as T;
  });
}

// What is in one box of a month: whatever the document holds (or nothing at all).
const boxOf = (month: Loose, map: CountMap, ingredientId: unknown): unknown =>
  ((month[map] || {}) as Loose)[ingredientId as string];

// One ingredient's line of the month.
//
//   opening   what was on the shelf when the month began  (null = nobody said)
//   purchased what came in                                (missing means none)
//   closing   what is on the shelf now                    (null = not counted)
//   used      the answer, or null when it cannot be known
//
// ⚠️ `used` MAY COME OUT NEGATIVE, and it is left negative on purpose. More on the
// shelf than you started with plus everything you bought is arithmetically
// impossible, so it is evidence of a mistyped number or a delivery nobody
// recorded. Clamping it to zero would erase the only signal that something is
// wrong, and the total would quietly stop adding up.
export function consumption(month: unknown, ingredientId: unknown): Consumption {
  const m = (month || {}) as Loose;
  const opening = readCount(boxOf(m, 'opening', ingredientId));
  const closing = readCount(boxOf(m, 'closing', ingredientId));
  const purchasedRaw = readCount(boxOf(m, 'purchased', ingredientId));
  const purchased = purchasedRaw === null ? 0 : purchasedRaw;

  const counted = closing !== null;
  const hasOpening = opening !== null;
  const used = counted && hasOpening ? round3(opening + purchased - closing) : null;

  return { opening, purchased, closing, used, counted, hasOpening };
}

// How far through the count you are. The reason it exists: 67 products is a long
// job spread over an evening, and "what is left to do" is the only question
// somebody halfway through is asking.
export function progressOf(month: unknown, ingredientIds: unknown): Progress {
  const ids: readonly unknown[] = Array.isArray(ingredientIds) ? ingredientIds : [];
  const closing = ((month && (month as Loose).closing) || {}) as Loose;
  let counted = 0;
  ids.forEach(id => { if (readCount(closing[id as string]) !== null) counted += 1; });
  return { counted, total: ids.length, done: ids.length > 0 && counted === ids.length };
}

// Open the next month from the one just closed.
//
// ⚠️ IT IS A COPY, NOT A LINK. October's opening is written into October's own
// document, so correcting September next spring cannot silently restate a figure
// October has already been read from. The screen offers to re-copy instead, which
// is a decision somebody makes rather than one that happens to them.
// ⚠️ `packKg` TRAVELS TOO — the weight of a sack does not change when the month
// does, and carrying it is what makes it a thing typed once rather than every
// month.
// ⚠️ ONLY COUNTED ROWS BECOME AN OPENING. A product nobody counted has no closing,
// so it gets no opening either: the next month inherits the same honest "not
// said" rather than a zero nobody wrote.
export function carryOver(previous: unknown, monthId: unknown, nowIso: unknown = ''): InventoryMonth | null {
  if (!isMonthId(monthId)) return null;
  const prev = normalizeMonth(previous);
  const opening = prev ? { ...prev.closing } : {};
  return {
    id: monthId as string,
    month: monthId as string,
    opening,
    purchased: {},
    closing: {},
    packKg: prev ? { ...prev.packKg } : {},
    names: {},
    unitPrice: {},
    closedAt: '',
    createdAt: typeof nowIso === 'string' ? nowIso : '',
    updatedAt: typeof nowIso === 'string' ? nowIso : '',
  };
}

// The Firestore payload. The keys are LISTED BY HAND because the rules whitelist
// exactly these — spreading the month would send `id` as a field and have every
// save refused, the same trap foodcost-store.js carries a note about.
export function toDocument(month: unknown): MonthDocument | null {
  const m = normalizeMonth(month);
  if (!m) return null;
  return {
    month: m.month,
    opening: m.opening,
    purchased: m.purchased,
    closing: m.closing,
    packKg: m.packKg,
    names: m.names,
    unitPrice: m.unitPrice,
    closedAt: m.closedAt,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}
