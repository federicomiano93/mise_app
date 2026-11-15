// awaiting-sent.ts — «Order to X sent at 10:42: did it go?», shared by every device.
// TypeScript FULL port of js/orders/awaiting-sent.js (v1.145.0, on main only) for Mise 2.
//
// ⚠️⚠️ WHY IT LIVES IN THE SHARED DRAFT. On 14 Nov 2026 an order left with a line missing and
// nobody saw it, and the «did you send it? record it» step used to happen only on the device that
// opened WhatsApp, and only if somebody came back to the app — forget it there and the order was
// never recorded. So the moment the send editor hands an order to the share sheet (or opens the
// text chat), the EXACT quantities that went are written to drafts/current as
// `awaitingSent.<supplierId>` = { at, date, quantities, units }. Every device then shows the
// question as a banner; the device that sent it also asks at once when it comes back.
//
// PURE, no Firestore and no DOM: the wiring is the orders store, the writes the orders source.
//
//   «Sì»  → the order is recorded with the STORED quantities (never what the draft says now:
//           somebody may have typed since), only the lines that went are cleared, then the
//           key goes. Two devices tapping «Sì» together record ONCE: the key is CLAIMED in a
//           transaction first (claimDecision), and only the device whose claim removed it
//           records. A failed recording puts the question back.
//   «No»  → only the key goes; the quantities stay in the draft.

import { cleanUnit, entryUnit, sameUnit } from './order-unit';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const positive = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export interface Lines {
  quantities: Record<string, number>;
  units: Record<string, string>;
}

export interface AwaitingEntry extends Lines {
  at: string;
  date: string;
  draft?: Lines;
}

type Loose = Record<string, unknown>;
type Entries = Record<string, { qty?: unknown } | undefined> | null | undefined;

function cleanLines(quantities: unknown, units: unknown): Lines {
  const q: Record<string, number> = {};
  const u: Record<string, string> = {};
  Object.entries((quantities as Loose) || {}).forEach(([id, qty]) => {
    const n = positive(qty);
    if (!n) return;
    q[id] = n;
    const unit = cleanUnit((units as Loose | null | undefined)?.[id]);
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
export function awaitingEntry({ at, date, quantities, units, draft = null }: {
  at?: unknown; date?: unknown; quantities?: unknown; units?: unknown;
  draft?: { quantities?: unknown; units?: unknown } | null;
} = {}): AwaitingEntry | null {
  const sent = cleanLines(quantities, units);
  if (!Object.keys(sent.quantities).length) return null;
  const entry: AwaitingEntry = {
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
export function draftQuantities(ingredients: readonly { id?: string }[] | null | undefined, entries: Entries): Lines {
  const quantities: Record<string, number> = {};
  const units: Record<string, string> = {};
  (ingredients || []).forEach(ing => {
    const entry = ing?.id ? entries?.[ing.id] : undefined;
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
export function isAwaiting(value: unknown): boolean {
  const v = value as { at?: unknown; quantities?: unknown } | null | undefined;
  return Boolean(v) && typeof v === 'object' && typeof v?.at === 'string'
    && Boolean(v.quantities) && typeof v.quantities === 'object'
    && Object.values(v.quantities as Loose).some(q => positive(q) > 0);
}

// The banners to draw: one per waiting supplier the venue still has, oldest first.
//   awaiting: the draft's awaitingSent map; suppliers: [{ id, … }].
export function awaitingList<S extends { id: string }>(awaiting: unknown, suppliers: readonly S[] | null | undefined):
  Array<{ supplier: S } & AwaitingEntry> {
  const byId = new Map((suppliers || []).map(s => [s.id, s] as const));
  return Object.entries((awaiting as Loose) || {})
    .filter(([id, value]) => byId.has(id) && isAwaiting(value))
    .map(([id, value]) => ({ supplier: byId.get(id) as S, ...(value as AwaitingEntry) }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

// Inside the claim transaction: the draft as the server holds it now → may THIS device record?
// Only when the key is still there AND is the same question it was asked (same `at`): a key
// already removed was answered elsewhere, and a newer `at` is a newer send that deserves its
// own answer.
export function claimDecision(draft: unknown, supplierId: string, at: unknown): boolean {
  const value = (draft as { awaitingSent?: Record<string, { at?: unknown } | undefined> } | null | undefined)
    ?.awaitingSent?.[supplierId];
  return Boolean(value) && value?.at === at;
}

// Inside the restore transaction: may the question be put back? Only when no question stands for
// this supplier any more. A key present now is either this very question (nothing to restore) or
// a NEWER send by another device, which must not be overwritten by the older one.
export function restoreDecision(draft: unknown, supplierId: string): boolean {
  return !(draft as { awaitingSent?: Record<string, unknown> } | null | undefined)?.awaitingSent?.[supplierId];
}

// After «Sì»: the lines to clear from the draft. ⚠️ ONLY WHAT WAS SENT, AND ONLY WHERE THE DRAFT
// STILL SAYS WHAT WAS SENT. Between the send and the answer somebody can type — a line forgotten
// in the message, a number corrected — and that typing must survive: it is the next order, not
// this one. A line whose quantity or unit has changed since is left as it is.
//   entries: the draft's entries; cardOf(id) → the ingredient (for the card's unit);
//   stored: the entry as stored — its `draft` (what the draft said at the send) when there is one,
//   else what went.
export function linesToClear(entries: Entries, cardOf: ((id: string) => unknown) | null | undefined,
  stored: { draft?: unknown; quantities?: unknown; units?: unknown } | null | undefined): string[] {
  const sent = (stored?.draft && typeof stored.draft === 'object' ? stored.draft : stored) as
    { quantities?: Loose; units?: Loose } | null | undefined;
  return Object.keys(sent?.quantities || {}).filter(id => {
    const entry = entries?.[id];
    if (!entry) return false;
    if (positive(entry.qty) !== positive(sent?.quantities?.[id])) return false;
    const card = cardOf ? cardOf(id) : null;
    const now = entryUnit(entry, card);
    const then = cleanUnit(sent?.units?.[id]) || cleanUnit((card as { unit?: unknown } | null)?.unit);
    return sameUnit(now, then);
  });
}

// Before «Sì» records: is it worth asking first? ⚠️ ONLY WHEN HISTORY ALREADY HOLDS THIS ORDER.
// Another device (one on an older version records «Ordine fatto» without knowing of this
// question) may have recorded it, and recording again would double it (mergeArchives adds). The
// evidence is History itself: the record for that supplier and day (`record`, or null) holds
// EVERY stored line at a quantity ≥ the stored one. The draft is no evidence: a number changed
// after sending, or a list cleared on purpose, says nothing about whether this order was
// recorded, and asking there would let «Non registrare» lose an order that really went.
export function shouldAskBeforeRecording(entry: { quantities?: unknown } | null | undefined,
  record: { quantities?: Loose } | null | undefined): boolean {
  const lines = Object.entries((entry?.quantities as Loose) || {}).filter(([, q]) => positive(q) > 0);
  if (!lines.length || !record || typeof record !== 'object') return false;
  return lines.every(([id, q]) => positive(record.quantities?.[id]) >= positive(q));
}

// Does anything of this supplier stay in the draft once `cleared` are gone? Decides whether its
// day stamp goes too (a stamp with no rows is what the «not placed» banner reads as forgotten).
export function supplierKeepsLines(supplierIngredients: readonly { id: string }[] | null | undefined,
  entries: Entries, cleared: readonly string[] | null | undefined): boolean {
  const gone = new Set(cleared || []);
  return (supplierIngredients || []).some(ing => !gone.has(ing.id) && positive(entries?.[ing.id]?.qty) > 0);
}

// Put a question back after a failed recording. ⚠️ THE WRITE IS A TRANSACTION AND A TRANSACTION IS
// NEVER QUEUED OFFLINE: it rejects exactly when the recording failed for network reasons, and a
// rejection must not leave the order neither recorded nor asked about. So a failed write keeps the
// question on THIS device (`keepHere`), as a send whose question could not be shared does.
// Resolves 'restored' or 'kept'.
export async function putQuestionBack<E>(supplierId: string, entry: E, { write, keepHere }: {
  write: (supplierId: string, entry: E) => unknown;
  keepHere: (supplierId: string, entry: E, err: unknown) => void;
}): Promise<'restored' | 'kept'> {
  try {
    await write(supplierId, entry);
    return 'restored';
  } catch (err) {
    keepHere(supplierId, entry, err);
    return 'kept';
  }
}

export type AnswerResult = 'recorded' | 'elsewhere' | 'claimFailed' | 'failed' | 'dropped' | 'busy';

export interface AnswerDeps<E> {
  claim(supplierId: string, at: string): Promise<boolean>;
  record(supplierId: string, entry: E): Promise<boolean>;
  restore(supplierId: string, entry: E): Promise<unknown>;
  drop(supplierId: string): Promise<unknown>;
  busy?: Set<string>;
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
export async function answerAwaiting<E extends { at: string }>(answer: string, supplierId: string, entry: E,
  deps: AnswerDeps<E>, { local = false }: { local?: boolean } = {}): Promise<AnswerResult> {
  const busy = deps.busy || new Set<string>();
  if (busy.has(supplierId)) return 'busy';
  busy.add(supplierId);
  try {
    if (answer !== 'yes') {
      if (!local) await deps.drop(supplierId);
      return 'dropped';
    }
    if (!local) {
      let claimed: boolean;
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
