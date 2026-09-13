// inventory-outbox.js — what has been typed on this phone and has not reached
// Firestore yet.
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

// ⚠️ NESTED MAPS, NEVER A DOTTED 'closing.flour' STRING. An ingredient id is a
// Firestore document id and may legally contain a dot; splitting on it would
// delete the wrong key, or nothing at all, in silence.
export const EMPTY_OUTBOX = Object.freeze({ pending: {}, cleared: {}, inFlight: null });

function layerOf(source) {
  const out = { pending: {}, cleared: {} };
  const raw = source && typeof source === 'object' ? source : {};
  for (const [map, values] of Object.entries(raw.pending || {})) {
    if (values && typeof values === 'object') out.pending[map] = { ...values };
  }
  for (const [map, ids] of Object.entries(raw.cleared || {})) {
    if (ids && typeof ids === 'object') out.cleared[map] = { ...ids };
  }
  return out;
}

// Anything at all — undefined, a half-written object, something read back from a
// cache — becomes the exact shape the rest of this file may assume.
function normalize(outbox) {
  const box = outbox && typeof outbox === 'object' ? outbox : {};
  const own = layerOf(box);
  return {
    pending: own.pending,
    cleared: own.cleared,
    inFlight: box.inFlight ? layerOf(box.inFlight) : null,
  };
}

function setIn(map2, map, id, value) {
  map2[map] = { ...(map2[map] || {}), [id]: value };
}

function removeIn(map2, map, id) {
  if (!map2[map]) return;
  const next = { ...map2[map] };
  delete next[id];
  if (Object.keys(next).length) map2[map] = next; else delete map2[map];
}

// Two layers into one, where `newer` wins box by box. Used both when a second
// write is taken while the first is still in the air, and when a failed write
// comes back to sit behind edits made since.
function merge(older, newer) {
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
      setIn(out.cleared, map, id, true);
      removeIn(out.pending, map, id);
    }
  }
  return out;
}

// One box changed. `value === null` means it was EMPTIED, which is not the same
// as a zero and cannot travel as one: a Firestore merge never removes a key, so
// an emptied box has to be remembered as a deletion of its own.
export function stage(outbox, map, id, value) {
  const box = normalize(outbox);
  if (!map || !id) return box;
  if (value === null || value === undefined) {
    removeIn(box.pending, map, id);
    setIn(box.cleared, map, id, true);
  } else {
    setIn(box.pending, map, id, value);
    removeIn(box.cleared, map, id);
  }
  return box;
}

// Several boxes of one map at once — the shape "carry last month forward" and
// "fill in what the orders say" both have. Values are staged; ids listed in
// `clear` are emptied.
export function stageMany(outbox, map, values = {}, clear = []) {
  let box = normalize(outbox);
  for (const [id, value] of Object.entries(values)) box = stage(box, map, id, value);
  for (const id of clear) box = stage(box, map, id, null);
  return box;
}

export function hasWork(outbox) {
  const box = normalize(outbox);
  return Object.values(box.pending).some(values => Object.keys(values).length > 0)
    || Object.values(box.cleared).some(ids => Object.keys(ids).length > 0);
}

// Whether a write is out and unanswered. The caller uses it to keep exactly one
// write in the air: two at once, and the second's success would confirm the
// first's values as well.
export function isSending(outbox) {
  return !!normalize(outbox).inFlight;
}

// Everything waiting, ready to be written, moved into `inFlight`.
//
// ⚠️ IT RETURNS WHAT TO SEND AS DATA, not a Firestore payload: this file knows
// nothing about deleteField() or about documents, which is what lets it be tested
// without a browser.
export function take(outbox) {
  const box = normalize(outbox);
  const waiting = { pending: box.pending, cleared: box.cleared };
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
export function confirm(outbox) {
  const box = normalize(outbox);
  return { pending: box.pending, cleared: box.cleared, inFlight: null };
}

// The write failed. What went out goes back to waiting, BEHIND anything typed
// since — see the header: the newer answer for a box wins.
export function restore(outbox) {
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
export function applyOver(outbox, target, maps) {
  const box = normalize(outbox);
  const allowed = Array.isArray(maps) ? maps : [];
  const layers = [box.inFlight, { pending: box.pending, cleared: box.cleared }];
  for (const layer of layers) {
    if (!layer) continue;
    for (const [map, values] of Object.entries(layer.pending)) {
      if (!allowed.includes(map) || !target[map]) continue;
      Object.assign(target[map], values);
    }
    for (const [map, ids] of Object.entries(layer.cleared)) {
      if (!allowed.includes(map) || !target[map]) continue;
      for (const id of Object.keys(ids)) delete target[map][id];
    }
  }
  return target;
}
