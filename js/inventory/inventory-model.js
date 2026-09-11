// inventory-model.js — the month's stocktake, as pure arithmetic.
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
// `allergensCheckedAt` in js/allergen-model.js.
//
// ⚠️ THE ONE DELIBERATE EXCEPTION IS `purchased`, and it runs the other way: a
// missing value there IS zero. Most products are not reordered every month, so
// "bought none" is the ordinary case, while "did not count" is the dangerous one.
// The screen prints the 0 rather than hiding it, so the assumption is always
// visible on the row it applies to.

// The document id of a month, and the only shape this feature will accept.
export const MONTH_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

export function isMonthId(id) {
  return typeof id === 'string' && MONTH_PATTERN.test(id);
}

const pad2 = n => String(n).padStart(2, '0');

// '2026-09' from a moment in LOCAL time.
//
// ⚠️ LOCAL, never UTC. At 00:30 on 1 October in British Summer Time, UTC still
// says September — so a stocktake started just after midnight would be written
// into the month that had already ended. Same reason js/orders/day.js builds its
// ISO dates from getFullYear/getMonth/getDate instead of toISOString().
export function monthKey(nowMs = Date.now()) {
  const d = new Date(nowMs);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

// The month `delta` months away from this one. shiftMonth('2026-12', 1) is
// '2027-01' — the year rolls because Date does the arithmetic, not a hand-written
// "if the month is 12".
export function shiftMonth(monthId, delta) {
  if (!isMonthId(monthId) || !Number.isInteger(delta)) return null;
  const [year, month] = monthId.split('-').map(Number);
  // Day 1 at midday: a date built on the 1st at midnight can slip into the
  // previous day in a timezone behind UTC, and midday is safely clear of both
  // clock changes.
  const d = new Date(year, month - 1 + delta, 1, 12, 0, 0);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export const previousMonth = monthId => shiftMonth(monthId, -1);
export const nextMonth = monthId => shiftMonth(monthId, 1);

// The two dates that bound a month, for a Firestore range query on `date`:
// `from` is inclusive, `to` is EXCLUSIVE (the 1st of the next month), so no
// arithmetic about how many days February has is ever needed.
export function monthBounds(monthId) {
  if (!isMonthId(monthId)) return null;
  const next = nextMonth(monthId);
  return { from: `${monthId}-01`, to: `${next}-01` };
}

// Round away binary-float dust: 0.1 + 0.2 must read as 0.3 on a screen somebody
// is comparing with a delivery note. Three decimals is far finer than anyone
// counts a shelf to, and coarse enough to hide the noise.
function round3(value) {
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
export function readCount(value) {
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
export const COUNT_MAPS = Object.freeze(['opening', 'purchased', 'closing', 'packKg']);
export const FROZEN_MAPS = Object.freeze(['names', 'pricePerKg']);

function cleanCounts(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    const n = readCount(value);
    if (n !== null) out[id] = n;
  }
  return out;
}

function cleanNames(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text) out[id] = text.slice(0, 200);
  }
  return out;
}

// A month document from anywhere — Firestore, localStorage, a half-written draft
// — turned into the exact shape the rest of the feature may assume.
export function normalizeMonth(raw, fallbackId = null) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const id = isMonthId(source.month) ? source.month
    : isMonthId(source.id) ? source.id
      : isMonthId(fallbackId) ? fallbackId : null;
  if (!id) return null;

  return {
    id,
    month: id,
    opening: cleanCounts(source.opening),
    purchased: cleanCounts(source.purchased),
    closing: cleanCounts(source.closing),
    packKg: cleanCounts(source.packKg),
    names: cleanNames(source.names),
    pricePerKg: cleanCounts(source.pricePerKg),
    closedAt: typeof source.closedAt === 'string' ? source.closedAt : '',
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : '',
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
  };
}

export function isClosed(month) {
  return !!(month && typeof month.closedAt === 'string' && month.closedAt !== '');
}

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
export function consumption(month, ingredientId) {
  const m = month || {};
  const opening = readCount((m.opening || {})[ingredientId]);
  const closing = readCount((m.closing || {})[ingredientId]);
  const purchasedRaw = readCount((m.purchased || {})[ingredientId]);
  const purchased = purchasedRaw === null ? 0 : purchasedRaw;

  const counted = closing !== null;
  const hasOpening = opening !== null;
  const used = counted && hasOpening ? round3(opening + purchased - closing) : null;

  return { opening, purchased, closing, used, counted, hasOpening };
}

// How far through the count you are. The reason it exists: 67 products is a long
// job spread over an evening, and "what is left to do" is the only question
// somebody halfway through is asking.
export function progressOf(month, ingredientIds) {
  const ids = Array.isArray(ingredientIds) ? ingredientIds : [];
  const closing = (month && month.closing) || {};
  let counted = 0;
  ids.forEach(id => { if (readCount(closing[id]) !== null) counted += 1; });
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
export function carryOver(previous, monthId, nowIso = '') {
  if (!isMonthId(monthId)) return null;
  const prev = normalizeMonth(previous);
  const opening = prev ? { ...prev.closing } : {};
  return {
    id: monthId,
    month: monthId,
    opening,
    purchased: {},
    closing: {},
    packKg: prev ? { ...prev.packKg } : {},
    names: {},
    pricePerKg: {},
    closedAt: '',
    createdAt: typeof nowIso === 'string' ? nowIso : '',
    updatedAt: typeof nowIso === 'string' ? nowIso : '',
  };
}

// The Firestore payload. The keys are LISTED BY HAND because the rules whitelist
// exactly these — spreading the month would send `id` as a field and have every
// save refused, the same trap foodcost-store.js carries a note about.
export function toDocument(month) {
  const m = normalizeMonth(month);
  if (!m) return null;
  return {
    month: m.month,
    opening: m.opening,
    purchased: m.purchased,
    closing: m.closing,
    packKg: m.packKg,
    names: m.names,
    pricePerKg: m.pricePerKg,
    closedAt: m.closedAt,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}
