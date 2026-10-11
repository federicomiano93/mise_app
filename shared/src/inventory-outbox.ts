// inventory-outbox.ts — what has been typed on this phone and has not reached
// Firestore yet.
//
// TypeScript port of js/inventory/inventory-outbox.js for Mise 2. Behaviour is identical, input for
// input: inventory-outbox.spec.ts runs every test against BOTH files, parity.spec.ts compares their
// exports and odd-inputs.spec.ts feeds both the same strange values. The comments below are the ones
// the original paid for in bugs.
//
// PURE, ZERO IMPORTS: no DOM, no Firestore, no clock. It is here, on its own,
// because it is the hardest code in the feature and the only part of it that no
// amount of using the app can check. A count that goes missing between a phone in
// a storeroom and a database looks exactly like a count nobody typed.
//
// THREE LAYERS, AND THE ORDER BETWEEN THEM IS THE WHOLE POINT:
//
//   pending    typed, not sent yet
//   inFlight   sent, not confirmed yet
//   (the document Firestore sends back)
//
// ⚠️⚠️ `inFlight` IS WHY THIS FILE EXISTS. A write is taken out of `pending`
// BEFORE it is sent — otherwise the write's own success would wipe an edit made
// while it was in the air. But between the sending and the answer, a snapshot can
// arrive that does not contain the number yet, and laying only `pending` over it
// would empty the box on screen AND in the local cache. The number would be gone
// from a phone whose owner walked across a storeroom to read it.
//
// ⚠️ AND THE FAILURE PATH IS NOT A SIMPLE PUT-BACK. While a write was failing,
// the same box may have been re-typed or emptied. What went out is therefore
// OLDER than what is here now, and per box the newer answer wins — otherwise a
// failed deletion would come back and destroy a number typed a second later.
//
// Every function returns a NEW outbox and mutates nothing, so a test can hold the
// before and the after side by side.

// What a layer holds: the new value of each box (by map, then by product id) and the boxes that
// were EMPTIED. Values are whatever was staged; the maps are the month's count maps by name.
export interface OutboxLayer {
  pending: Record<string, Record<string, unknown>>;
  cleared: Record<string, Record<string, true>>;
}

export interface Outbox extends OutboxLayer {
  inFlight: OutboxLayer | null;
}

// What take() hands back: the outbox with everything waiting moved to `inFlight`, and a COPY of
// that, to build the write from.
export interface OutboxTake {
  outbox: Outbox;
  values: Record<string, Record<string, unknown>>;
  clear: Record<string, Record<string, true>>;
}

type Maybe<T> = T | null | undefined;

// ⚠️ NESTED MAPS, NEVER A DOTTED 'closing.flour' STRING. An ingredient id is a
// Firestore document id and may legally contain a dot; splitting on it would
// delete the wrong key, or nothing at all, in silence.
export const EMPTY_OUTBOX: Readonly<Outbox> = Object.freeze({ pending: {}, cleared: {}, inFlight: null });

// Anything at all may arrive here (undefined, a half-written object, something read back from a
// cache), so what is read off it is `unknown` until it has been looked at.
function layerOf(source: unknown): OutboxLayer {
  const out: OutboxLayer = { pending: {}, cleared: {} };
  const raw = (source && typeof source === 'object' ? source : {}) as { pending?: unknown; cleared?: unknown };
  for (const [map, values] of Object.entries((raw.pending || {}) as object)) {
    if (values && typeof values === 'object') out.pending[map] = { ...values };
  }
  for (const [map, ids] of Object.entries((raw.cleared || {}) as object)) {
    if (ids && typeof ids === 'object') out.cleared[map] = { ...ids };
  }
  return out;
}

// Anything at all — undefined, a half-written object, something read back from a
// cache — becomes the exact shape the rest of this file may assume.
function normalize(outbox: unknown): Outbox {
  const box = (outbox && typeof outbox === 'object' ? outbox : {}) as { inFlight?: unknown };
  const own = layerOf(box);
  return {
    pending: own.pending,
    cleared: own.cleared,
    inFlight: box.inFlight ? layerOf(box.inFlight) : null,
  };
}

function setIn<V>(map2: Record<string, Record<string, V>>, map: string, id: string, value: V): void {
  map2[map] = { ...(map2[map] || {}), [id]: value };
}

function removeIn<V>(map2: Record<string, Record<string, V>>, map: string, id: string): void {
  if (!map2[map]) return;
  const next = { ...map2[map] };
  delete next[id];
  if (Object.keys(next).length) map2[map] = next; else delete map2[map];
}

// Two layers into one, where `newer` wins box by box. Used both when a second
// write is taken while the first is still in the air, and when a failed write
// comes back to sit behind edits made since.
function merge(older: unknown, newer: OutboxLayer): OutboxLayer {
  const out = layerOf(older);
  for (const [map, ids] of Object.entries(out.cleared)) {
    for (const id of Object.keys(ids)) removeIn(out.pending, map, id);
  }
  for (const [map, values] of Object.entries(newer.pending || {})) {
    for (const [id, value] of Object.entries(values)) {
      setIn(out.pending, map, id, value);
      removeIn(out.cleared, map, id);
    }
  }
  for (const [map, ids] of Object.entries(newer.cleared || {})) {
    for (const id of Object.keys(ids)) {
      setIn(out.cleared, map, id, true as const);
      removeIn(out.pending, map, id);
    }
  }
  return out;
}

// One box changed. `value === null` means it was EMPTIED, which is not the same
// as a zero and cannot travel as one: a Firestore merge never removes a key, so
// an emptied box has to be remembered as a deletion of its own.
export function stage(outbox: unknown, map: string, id: string, value: unknown): Outbox {
  const box = normalize(outbox);
  if (!map || !id) return box;
  if (value === null || value === undefined) {
    removeIn(box.pending, map, id);
    setIn(box.cleared, map, id, true as const);
  } else {
    setIn(box.pending, map, id, value);
    removeIn(box.cleared, map, id);
  }
  return box;
}

// Several boxes of one map at once — the shape "carry last month forward" and
// "fill in what the orders say" both have. Values are staged; ids listed in
// `clear` are emptied.
export function stageMany(
  outbox: unknown, map: string, values: Readonly<Record<string, unknown>> = {}, clear: readonly string[] = [],
): Outbox {
  let box = normalize(outbox);
  for (const [id, value] of Object.entries(values)) box = stage(box, map, id, value);
  for (const id of clear) box = stage(box, map, id, null);
  return box;
}

export function hasWork(outbox: unknown): boolean {
  const box = normalize(outbox);
  return Object.values(box.pending).some(values => Object.keys(values).length > 0)
    || Object.values(box.cleared).some(ids => Object.keys(ids).length > 0);
}

// Whether a write is out and unanswered. The caller uses it to keep exactly one
// write in the air: two at once, and the second's success would confirm the
// first's values as well.
export function isSending(outbox: unknown): boolean {
  return !!normalize(outbox).inFlight;
}

// Everything waiting, ready to be written, moved into `inFlight`.
//
// ⚠️ IT RETURNS WHAT TO SEND AS DATA, not a Firestore payload: this file knows
// nothing about deleteField() or about documents, which is what lets it be tested
// without a browser.
export function take(outbox: unknown): OutboxTake {
  const box = normalize(outbox);
  const waiting: OutboxLayer = { pending: box.pending, cleared: box.cleared };
  const inFlight = box.inFlight ? merge(box.inFlight, waiting) : layerOf(waiting);
  // A copy for the caller to build a payload from, so nothing it does can reach
  // into the outbox it has just been handed back.
  const sending = layerOf(inFlight);
  return {
    outbox: { pending: {}, cleared: {}, inFlight },
    values: sending.pending,
    clear: sending.cleared,
  };
}

// The write landed. Only `inFlight` goes: anything typed since is still waiting.
export function confirm(outbox: unknown): Outbox {
  const box = normalize(outbox);
  return { pending: box.pending, cleared: box.cleared, inFlight: null };
}

// The write failed. What went out goes back to waiting, BEHIND anything typed
// since — see the header: the newer answer for a box wins.
export function restore(outbox: unknown): Outbox {
  const box = normalize(outbox);
  if (!box.inFlight) return box;
  const merged = merge(box.inFlight, { pending: box.pending, cleared: box.cleared });
  return { pending: merged.pending, cleared: merged.cleared, inFlight: null };
}

// Lay everything unsent over a document that has just arrived, so a snapshot can
// never take back a number this phone is still holding. `maps` is the whitelist
// of count maps a month document carries.
//
// ⚠️ IT MUTATES `target`, which is the caller's own freshly normalised copy — the
// document it is about to adopt, never a shared object.
//
// ⚠️ A QUIRK OF THE ORIGINAL, KEPT ON PURPOSE (found while porting it, 11 Oct 2026). `target[map]` is read
// for any map name the outbox holds AND `maps` lists, so a map called like something a plain object
// inherits («constructor») would be read as that thing, and Object.assign would write into it. No real call
// reaches it: `maps` is the month's own COUNT_MAPS and the outbox is only ever staged with those. This port
// does the same, so the two apps cannot disagree; the fix belongs in BOTH files at once.
export function applyOver<T extends object>(outbox: unknown, target: T, maps: unknown): T {
  const box = normalize(outbox);
  const allowed: readonly unknown[] = Array.isArray(maps) ? maps : [];
  const layers: Maybe<OutboxLayer>[] = [box.inFlight, { pending: box.pending, cleared: box.cleared }];
  // The count maps of the document, by name (whichever of them it has).
  const doc = target as unknown as Record<string, Record<string, unknown> | undefined>;
  for (const layer of layers) {
    if (!layer) continue;
    for (const [map, values] of Object.entries(layer.pending)) {
      if (!allowed.includes(map) || !doc[map]) continue;
      Object.assign(doc[map] as Record<string, unknown>, values);
    }
    for (const [map, ids] of Object.entries(layer.cleared)) {
      if (!allowed.includes(map) || !doc[map]) continue;
      for (const id of Object.keys(ids)) delete (doc[map] as Record<string, unknown>)[id];
    }
  }
  return target;
}
