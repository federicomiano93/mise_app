// awaitingSent.ts — «Order to X sent at 10:42: did it go?», shared by every device of the venue.
//
// A port of the current app's js/orders/awaiting-sent.js (PR #554, v1.145.0), decision for decision. NOT PAIRED with it: the stack's
// js/ predates that PR (main is not merged into the stack), so its spec (awaitingSent.spec.ts) re-states the current app's
// tests/awaiting-sent.test.mjs against this file alone.
//
// ⚠️⚠️ WHY IT LIVES IN THE SHARED DRAFT. On 14 Nov 2026 an order left with a line missing and nobody saw it, and the «did you send
// it? record it» step used to happen only on the device that opened WhatsApp, and only if somebody came back to the app — forget it
// there and the order was never recorded. So the moment the send editor hands an order over (the share sheet, a chat, the mail app),
// the EXACT quantities that went are written to drafts/current as `awaitingSent.<supplierId>` = { at, date, quantities, units }.
// Every device then shows the question as a banner; the device that sent it also asks at once when it comes back.
//
// PURE, no Firestore and no DOM: the wiring is useAwaitingSent.tsx, the writes ordersStore.ts / ordersSource.ts.
//
//   «Yes» → the order is recorded with the STORED quantities (never what the draft says now: somebody may have typed since), only the
//           lines that went are cleared, then the key goes. Two devices tapping «Yes» together record ONCE: the key is CLAIMED in a
//           transaction first (claimDecision), and only the device whose claim removed it records. A failed recording puts the
//           question back.
//   «No»  → only the key goes; the quantities stay in the draft.

import { cleanUnit, entryUnit, sameUnit } from '@mise/shared/order-unit';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const positive = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export interface SentLines {
  readonly quantities: Readonly<Record<string, number>>;
  readonly units: Readonly<Record<string, string>>;
}

// One question as stored under awaitingSent.<supplierId>.
export interface AwaitingEntry extends SentLines {
  // When it was handed over (ISO): names THIS send, so an answer to an older one never touches a newer one.
  readonly at: string;
  // The day it is recorded under ('YYYY-MM-DD'), '' when unknown.
  readonly date: string;
  // What the DRAFT said for this supplier at the send, when it differs from what went («Send it now» sends the confirmed numbers,
  // which are never written back to the draft): «Yes» clears the lines still reading it.
  readonly draft?: SentLines;
}

function cleanLines(quantities: unknown, units: unknown): { quantities: Record<string, number>; units: Record<string, string> } {
  const q: Record<string, number> = {};
  const u: Record<string, string> = {};
  const unitMap = units && typeof units === 'object' ? units as Record<string, unknown> : {};
  Object.entries(quantities && typeof quantities === 'object' ? quantities as Record<string, unknown> : {}).forEach(([id, qty]) => {
    const n = positive(qty);
    if (!n) return;
    q[id] = n;
    const unit = cleanUnit(unitMap[id]);
    if (unit) u[id] = unit;
  });
  return { quantities: q, units: u };
}

// The value written under awaitingSent.<supplierId>. Only lines with a quantity; a unit only for a line that has one. null when
// nothing was sent (there is no question to ask). `draft` is left out when it is the same as what went.
export function awaitingEntry({ at, date, quantities, units, draft = null }: {
  at?: unknown; date?: unknown; quantities?: unknown; units?: unknown; draft?: { quantities?: unknown; units?: unknown } | null;
} = {}): AwaitingEntry | null {
  const sent = cleanLines(quantities, units);
  if (!Object.keys(sent.quantities).length) return null;
  const entry: { -readonly [K in keyof AwaitingEntry]: AwaitingEntry[K] } = {
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

// What one supplier's order holds RIGHT NOW in the draft, in the shape awaitingEntry takes. `ingredients` are that supplier's lines
// (the lens the message was built from); the unit is the one every row shows (entryUnit).
export function draftQuantities(ingredients: ReadonlyArray<{ readonly id: string }>, entries: Readonly<Record<string, unknown>>): SentLines {
  const quantities: Record<string, number> = {};
  const units: Record<string, string> = {};
  ingredients.forEach(ing => {
    const entry = entries[ing.id] as { qty?: unknown } | undefined;
    const qty = positive(entry?.qty);
    if (!ing.id || !qty) return;
    quantities[ing.id] = qty;
    const unit = entryUnit(entry, ing);
    if (unit) units[ing.id] = unit;
  });
  return { quantities, units };
}

// Is a stored value a question that can be answered? Anything else (a hand-edited or half-written key) is ignored rather than shown
// with no quantities behind it.
export function isAwaiting(value: unknown): value is AwaitingEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as { at?: unknown; quantities?: unknown };
  return typeof v.at === 'string' && !!v.quantities && typeof v.quantities === 'object'
    && Object.values(v.quantities as Record<string, unknown>).some(q => positive(q) > 0);
}

// The banners to draw: one per waiting supplier the venue still has, oldest first.
export function awaitingList<S extends { readonly id: string }>(awaiting: Readonly<Record<string, unknown>> | null | undefined,
  suppliers: readonly S[]): Array<AwaitingEntry & { readonly supplier: S }> {
  const byId = new Map(suppliers.map(s => [s.id, s]));
  return Object.entries(awaiting ?? {})
    .flatMap(([id, value]) => {
      const supplier = byId.get(id);
      return supplier && isAwaiting(value) ? [{ ...value, supplier }] : [];
    })
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

const awaitingOf = (draft: unknown, supplierId: string): unknown => {
  const map = (draft as { awaitingSent?: unknown } | null)?.awaitingSent;
  return map && typeof map === 'object' ? (map as Record<string, unknown>)[supplierId] : undefined;
};

// Inside the claim transaction: may THIS device record? Only when the key is still there AND is the same question (same `at`): a key
// already removed was answered elsewhere, and a newer `at` is a newer send that deserves its own answer.
export function claimDecision(draft: unknown, supplierId: string, at: string): boolean {
  const value = awaitingOf(draft, supplierId) as { at?: unknown } | undefined;
  return Boolean(value) && value?.at === at;
}

// Inside the restore transaction: may the question be put back? Only when no question stands for this supplier any more (a key present
// now is this very question, or a NEWER send by another device, which must not be overwritten by the older one).
export function restoreDecision(draft: unknown, supplierId: string): boolean {
  return !awaitingOf(draft, supplierId);
}

// After «Yes»: the lines to clear from the draft. ⚠️ ONLY WHAT WAS SENT, AND ONLY WHERE THE DRAFT STILL SAYS WHAT WAS SENT: typing done
// between the send and the answer is the next order, not this one. `stored`'s `draft` (what the draft said at the send) when there is
// one, else what went.
export function linesToClear(entries: Readonly<Record<string, unknown>>, cardOf: ((id: string) => unknown) | null,
  stored: { quantities?: unknown; units?: unknown; draft?: SentLines | null } | null | undefined): string[] {
  const sent = stored?.draft && typeof stored.draft === 'object' ? stored.draft : stored;
  const quantities = (sent?.quantities ?? {}) as Record<string, unknown>;
  const units = (sent?.units ?? {}) as Record<string, unknown>;
  return Object.keys(quantities).filter(id => {
    const entry = entries[id] as { qty?: unknown } | undefined;
    if (!entry) return false;
    if (positive(entry.qty) !== positive(quantities[id])) return false;
    const card = cardOf ? cardOf(id) : null;
    const now = entryUnit(entry, card);
    const then = cleanUnit(units[id]) || cleanUnit((card as { unit?: unknown } | null)?.unit);
    return sameUnit(now, then);
  });
}

// Before «Yes» records: is it worth asking first? ⚠️ ONLY WHEN HISTORY ALREADY HOLDS THIS ORDER: the record for that supplier and day
// (`record`, or null) holds EVERY stored line at a quantity ≥ the stored one. Another device (one on an older version records without
// knowing of this question) may have recorded it, and recording again would double it (mergeArchives adds).
export function shouldAskBeforeRecording(entry: { quantities?: unknown } | null | undefined, record: unknown): boolean {
  const lines = Object.entries((entry?.quantities ?? {}) as Record<string, unknown>).filter(([, q]) => positive(q) > 0);
  if (!lines.length || !record || typeof record !== 'object') return false;
  const recorded = ((record as { quantities?: unknown }).quantities ?? {}) as Record<string, unknown>;
  return lines.every(([id, q]) => positive(recorded[id]) >= positive(q));
}

// Does anything of this supplier stay in the draft once `cleared` are gone? Decides whether its day stamp goes too.
export function supplierKeepsLines(supplierIngredients: ReadonlyArray<{ readonly id: string }>,
  entries: Readonly<Record<string, unknown>>, cleared: readonly string[]): boolean {
  const gone = new Set(cleared);
  return supplierIngredients.some(ing => !gone.has(ing.id) && positive((entries[ing.id] as { qty?: unknown } | undefined)?.qty) > 0);
}

// Put a question back after a failed recording. ⚠️ THE WRITE IS A TRANSACTION AND A TRANSACTION IS NEVER QUEUED OFFLINE: a rejection
// must not leave the order neither recorded nor asked about, so a failed write keeps the question on THIS device (`keepHere`).
export async function putQuestionBack(supplierId: string, entry: AwaitingEntry, { write, keepHere }: {
  write: (supplierId: string, entry: AwaitingEntry) => Promise<unknown>;
  keepHere: (supplierId: string, entry: AwaitingEntry, err: unknown) => void;
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

export interface AnswerDeps {
  claim(supplierId: string, at: string): Promise<boolean>;
  record(supplierId: string, entry: AwaitingEntry): Promise<boolean>;
  restore(supplierId: string, entry: AwaitingEntry): unknown;
  drop(supplierId: string): unknown;
  busy?: Set<string>;
}

// One answer, start to finish, with the side effects handed in. Resolves to what happened:
//   'recorded'    — claimed and recorded
//   'elsewhere'   — another device answered first (or it was a newer send): nothing recorded here
//   'claimFailed' — the claim could not be made (no network): nothing recorded, the question stays
//   'failed'      — the recording failed: the question is put back
//   'dropped'     — «No»: only the key went
//   'busy'        — this device is already answering for this supplier
// `local: true` is a question this device could not share: there is no key to claim, so it is recorded straight away.
export async function answerAwaiting(answer: 'yes' | 'no', supplierId: string, entry: AwaitingEntry, deps: AnswerDeps,
  { local = false } = {}): Promise<AnswerResult> {
  const busy = deps.busy ?? new Set<string>();
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
