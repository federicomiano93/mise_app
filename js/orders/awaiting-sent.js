// awaiting-sent.js — «Order to X sent at 10:42: did it go?», shared by every device.
//
// ⚠️⚠️ WHY IT LIVES IN THE SHARED DRAFT. On 14 Nov 2026 an order left with a line missing and
// nobody saw it, and the «did you send it? record it» step used to happen only on the device that
// opened WhatsApp, and only if somebody came back to the app — forget it there and the order was
// never recorded. So the moment the send editor hands an order to the share sheet (or opens the
// text chat), the EXACT quantities that went are written to drafts/current as
// `awaitingSent.<supplierId>` = { at, date, quantities, units }. Every device then shows the
// question as a banner; the device that sent it also asks at once when it comes back.
//
// PURE, no Firestore and no DOM: the wiring is orders-main.js, the writes draft.js.
//
//   «Sì»  → the order is recorded with the STORED quantities (never what the draft says now:
//           somebody may have typed since), only the lines that went are cleared, then the
//           key goes. Two devices tapping «Sì» together record ONCE: the key is CLAIMED in a
//           transaction first (claimDecision), and only the device whose claim removed it
//           records. A failed recording puts the question back.
//   «No»  → only the key goes; the quantities stay in the draft.

import { cleanUnit, entryUnit, sameUnit } from '../order-unit.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const positive = v => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function cleanLines(quantities, units) {
  const q = {};
  const u = {};
  Object.entries(quantities || {}).forEach(([id, qty]) => {
    const n = positive(qty);
    if (!n) return;
    q[id] = n;
    const unit = cleanUnit(units?.[id]);
    if (unit) u[id] = unit;
  });
  return { quantities: q, units: u };
}

// The value written under awaitingSent.<supplierId>. Only lines with a quantity; a unit only for
// a line that has one. Returns null when nothing was sent (there is no question to ask).
//
// `draft` ({ quantities, units }) is what the DRAFT said for this supplier at the moment of the
// send, when it differs from what went: «Ordine fatto» → «Invialo ora» sends the numbers the
// review screen CONFIRMED, which may be corrected and are never written back to the draft. «Sì»
// clears the lines still reading what the draft said then (linesToClear), so a corrected «5 → 3»
// does not stay behind as a phantom order. Left out when it is the same as what went.
export function awaitingEntry({ at, date, quantities, units, draft = null } = {}) {
  const sent = cleanLines(quantities, units);
  if (!Object.keys(sent.quantities).length) return null;
  const entry = {
    at: typeof at === 'string' ? at : new Date().toISOString(),
    date: typeof date === 'string' && DAY.test(date) ? date : '',
    ...sent,
  };
  if (draft) {
    const before = cleanLines(draft.quantities, draft.units);
    if (JSON.stringify(before) !== JSON.stringify(sent)) entry.draft = before;
  }
  return entry;
}

// What one supplier's order holds RIGHT NOW in the draft, in the shape awaitingEntry takes: the
// header send screen sends the draft as it stands. `ingredients` are that supplier's rows (the
// same lens the message was built from); the unit is the one every row shows (entryUnit), the
// same as the «Ordine fatto» review screen confirms, so both roads store the same shape.
export function draftQuantities(ingredients, entries) {
  const quantities = {};
  const units = {};
  (ingredients || []).forEach(ing => {
    const entry = entries?.[ing?.id];
    const qty = positive(entry?.qty);
    if (!ing?.id || !qty) return;
    quantities[ing.id] = qty;
    const unit = entryUnit(entry, ing);
    if (unit) units[ing.id] = unit;
  });
  return { quantities, units };
}

// Is a stored value a question that can be answered? Anything else (a hand-edited or half-written
// key) is ignored rather than shown with no quantities behind it.
export function isAwaiting(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.at === 'string'
    && value.quantities && typeof value.quantities === 'object'
    && Object.values(value.quantities).some(v => positive(v) > 0);
}

// The banners to draw: one per waiting supplier the venue still has, oldest first.
//   awaiting: the draft's awaitingSent map; suppliers: [{ id, … }].
export function awaitingList(awaiting, suppliers) {
  const byId = new Map((suppliers || []).map(s => [s.id, s]));
  return Object.entries(awaiting || {})
    .filter(([id, value]) => byId.has(id) && isAwaiting(value))
    .map(([id, value]) => ({ supplier: byId.get(id), ...value }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

// Inside the claim transaction: the draft as the server holds it now → may THIS device record?
// Only when the key is still there AND is the same question it was asked (same `at`): a key
// already removed was answered elsewhere, and a newer `at` is a newer send that deserves its
// own answer.
export function claimDecision(draft, supplierId, at) {
  const value = draft?.awaitingSent?.[supplierId];
  return Boolean(value) && value.at === at;
}

// After «Sì»: the lines to clear from the draft. ⚠️ ONLY WHAT WAS SENT, AND ONLY WHERE THE DRAFT
// STILL SAYS WHAT WAS SENT. Between the send and the answer somebody can type — a line forgotten
// in the message, a number corrected — and that typing must survive: it is the next order, not
// this one. A line whose quantity or unit has changed since is left as it is.
//   entries: the draft's entries; cardOf(id) → the ingredient (for the card's unit);
//   stored: the entry as stored — its `draft` (what the draft said at the send) when there is one,
//   else what went.
export function linesToClear(entries, cardOf, stored) {
  const sent = stored?.draft && typeof stored.draft === 'object' ? stored.draft : stored;
  return Object.keys(sent?.quantities || {}).filter(id => {
    const entry = entries?.[id];
    if (!entry) return false;
    if (positive(entry.qty) !== positive(sent.quantities[id])) return false;
    const card = cardOf ? cardOf(id) : null;
    const now = entryUnit(entry, card);
    const then = cleanUnit(sent.units?.[id]) || cleanUnit(card?.unit);
    return sameUnit(now, then);
  });
}

// Does anything of this supplier stay in the draft once `cleared` are gone? Decides whether its
// day stamp goes too (a stamp with no rows is what the «not placed» banner reads as forgotten).
export function supplierKeepsLines(supplierIngredients, entries, cleared) {
  const gone = new Set(cleared || []);
  return (supplierIngredients || []).some(ing => !gone.has(ing.id) && positive(entries?.[ing.id]?.qty) > 0);
}

// One answer, start to finish, with the side effects handed in so the rule can be proved without
// Firestore. Resolves to what happened:
//   'recorded'  — claimed and recorded
//   'elsewhere' — another device answered first (or it was a newer send): nothing recorded here
//   'claimFailed' — the claim could not be made (no network): nothing recorded, the question stays
//   'failed'    — the recording failed: the question is put back
//   'dropped'   — «No»: only the key went
//   'busy'      — this device is already answering for this supplier
//
// deps: { claim(supplierId, at) → Promise<bool>, record(supplierId, entry) → Promise<bool>,
//         restore(supplierId, entry) → Promise, drop(supplierId) → Promise, busy: Set }
// `local: true` is a question this device could not share (the write was refused): there is no
// key to claim, so it is recorded straight away — once, guarded by `busy`.
export async function answerAwaiting(answer, supplierId, entry, deps, { local = false } = {}) {
  const busy = deps.busy || new Set();
  if (busy.has(supplierId)) return 'busy';
  busy.add(supplierId);
  try {
    if (answer !== 'yes') {
      if (!local) await deps.drop(supplierId);
      return 'dropped';
    }
    if (!local) {
      let claimed;
      try { claimed = await deps.claim(supplierId, entry.at); } catch { return 'claimFailed'; }
      if (!claimed) return 'elsewhere';
    }
    let recorded = false;
    try { recorded = await deps.record(supplierId, entry); } catch { recorded = false; }
    if (recorded) return 'recorded';
    // Not written: the question must come back, or the order is neither recorded nor asked about.
    if (!local) { try { await deps.restore(supplierId, entry); } catch { /* the banner says so */ } }
    return 'failed';
  } finally {
    busy.delete(supplierId);
  }
}
