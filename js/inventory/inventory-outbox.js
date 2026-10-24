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
// and beside them `handed`: sent, but not yet seen back from the browser's own
// database (see the last warning below).
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
// ⚠️⚠️ SEVERAL WRITES MAY BE IN THE AIR, AND `inFlight` IS SETTLED ONLY WHEN THE
// LAST OF THEM HAS ANSWERED (answered() below). With no signal a write never
// answers, and the store used to hold every later count in memory behind the
// first: only the first reached the SDK's own queue, which lives in the browser's
// database and outlasts the page. Closing the app, changing month or going Home
// before signal lost every count after it (found 11 Oct 2026). So every save is
// handed to Firestore at once — but then the FIRST answer must not settle the
// layer, or it would confirm values another write is still carrying, and a
// failed write behind it would never be sent again.
//
// ⚠️⚠️ AND A WRITE HANDED TO FIRESTORE IS NOT YET SAFE. The SDK puts it in the
// browser's database a moment later; a page torn down inside that moment — the
// last number typed and the phone's back gesture straight after — takes it away
// (measured on the emulator, 11 Oct 2026). So until a snapshot shows the value
// back (the SDK only shows a local write once that database has it), it stays in
// `handed`, which the store keeps in localStorage — written at once, never lost
// with the page — and lays back in (revive()) when the month is next opened.
//
// ⚠️⚠️ WHAT COMES BACK THAT WAY IS `held`: on screen, kept, NOT SENT — until the
// SERVER says the month is still open (release()). The phone's own copy of the
// month can be days old, and a month closed meanwhile on another device must not
// take a count afterwards: the next month has already copied its figures (driven
// on the emulator, 11 Oct 2026 — sent on the strength of the phone's stale copy,
// the count landed in the closed month). A box typed again before then is newer,
// and leaves `held` at once.
//
// Every function returns a NEW outbox and mutates nothing, so a test can hold the
// before and the after side by side.

// ⚠️ NESTED MAPS, NEVER A DOTTED 'closing.flour' STRING. An ingredient id is a
// Firestore document id and may legally contain a dot; splitting on it would
// delete the wrong key, or nothing at all, in silence.
// `writes` counts the writes out and unanswered; `failed` says one of them was
// refused, and is acted on when the last one answers.
export const EMPTY_OUTBOX = Object.freeze({
  pending: {}, cleared: {}, inFlight: null, writes: 0, failed: false,
  handed: { pending: {}, cleared: {} },
  held: { pending: {}, cleared: {} },
});

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
  const inFlight = box.inFlight ? layerOf(box.inFlight) : null;
  // A layer in the air is at least one write in the air, whatever the count says.
  let writes = 0;
  if (inFlight) writes = Number.isInteger(box.writes) && box.writes > 0 ? box.writes : 1;
  return {
    pending: own.pending,
    cleared: own.cleared,
    inFlight,
    writes,
    failed: !!inFlight && box.failed === true,
    handed: layerOf(box.handed),
    held: layerOf(box.held),
  };
}

function emptyLayer() {
  return { pending: {}, cleared: {} };
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
  // Typed now, so whatever an earlier visit left for this box is older: it goes.
  removeIn(box.held.pending, map, id);
  removeIn(box.held.cleared, map, id);
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

// Whether any write is out and unanswered.
export function isSending(outbox) {
  return !!normalize(outbox).inFlight;
}

// Everything waiting, ready to be written, moved into `inFlight` — beside
// anything already there, which is counted as one more write out.
//
// ⚠️ IT RETURNS WHAT TO SEND AS DATA, not a Firestore payload: this file knows
// nothing about deleteField() or about documents, which is what lets it be tested
// without a browser.
// ⚠️⚠️ AND ONLY WHAT IS NEW. `inFlight` is the union of every write still out (for
// the screen, and to put back after a failure), but a write carries only what was
// waiting: carrying the union again, a count already stored would be written once
// more over a correction another phone made since — and on a weak signal each write
// would grow by every one before it (code review, 11 Oct 2026). Firestore applies
// the writes in the order they were made, so nothing is lost by sending less.
export function take(outbox) {
  const box = normalize(outbox);
  const waiting = { pending: box.pending, cleared: box.cleared };
  const inFlight = box.inFlight ? merge(box.inFlight, waiting) : layerOf(waiting);
  // A copy for the caller to build a payload from, so nothing it does can reach
  // into the outbox it has just been handed back.
  const sending = layerOf(waiting);
  return {
    outbox: {
      pending: {},
      cleared: {},
      inFlight,
      writes: box.writes + 1,
      failed: box.failed,
      handed: merge(box.handed, waiting),
      held: box.held,
    },
    values: sending.pending,
    clear: sending.cleared,
  };
}

// Everything in the air landed. Only `inFlight` goes: anything typed since is
// still waiting. A value Firestore has confirmed is in the browser's database
// too, so nothing is left `handed`.
export function confirm(outbox) {
  const box = normalize(outbox);
  return {
    pending: box.pending, cleared: box.cleared, inFlight: null, writes: 0, failed: false,
    handed: emptyLayer(), held: box.held,
  };
}

// What was in the air failed. It goes back to waiting, BEHIND anything typed
// since — see the header: the newer answer for a box wins. Waiting again, it is
// kept as waiting, so nothing need stay `handed`.
export function restore(outbox) {
  const box = normalize(outbox);
  if (!box.inFlight) return box;
  const merged = merge(box.inFlight, { pending: box.pending, cleared: box.cleared });
  return {
    pending: merged.pending, cleared: merged.cleared, inFlight: null, writes: 0, failed: false,
    handed: emptyLayer(), held: box.held,
  };
}

// A snapshot has arrived: every value it shows back is in the browser's database,
// so it is no longer only `handed`. `incoming` is the document AS IT ARRIVED,
// before anything is laid over it — afterwards it would show every value back.
//
// ⚠️ A SNAPSHOT IS THE ONLY SIGN THE SDK GIVES. It shows a write made on this phone
// only once its own database holds it, and its promise says nothing until a server
// answers — which in a storeroom is never.
export function echoed(outbox, incoming, maps) {
  const box = normalize(outbox);
  const allowed = Array.isArray(maps) ? maps : [];
  const doc = incoming && typeof incoming === 'object' ? incoming : {};
  const shows = (map, id) => allowed.includes(map) && !!doc[map] && typeof doc[map] === 'object'
    && Object.prototype.hasOwnProperty.call(doc[map], id);
  const handed = layerOf(box.handed);
  for (const [map, values] of Object.entries(box.handed.pending)) {
    for (const [id, value] of Object.entries(values)) {
      if (shows(map, id) && doc[map][id] === value) removeIn(handed.pending, map, id);
    }
  }
  for (const [map, ids] of Object.entries(box.handed.cleared)) {
    for (const id of Object.keys(ids)) {
      if (allowed.includes(map) && !shows(map, id)) removeIn(handed.cleared, map, id);
    }
  }
  return { ...box, handed };
}

// What exists nowhere but in this page's memory: typed and not sent, sent and not
// yet seen back from the browser's database, or held from an earlier visit. The
// store writes it to localStorage on every change, so a page torn down cannot take
// it away.
export function unsaved(outbox) {
  const box = normalize(outbox);
  return merge(merge(box.held, box.handed), { pending: box.pending, cleared: box.cleared });
}

// Whether unsaved() holds anything at all.
export function hasUnsaved(outbox) {
  const layer = unsaved(outbox);
  return Object.values(layer.pending).some(values => Object.keys(values).length > 0)
    || Object.values(layer.cleared).some(ids => Object.keys(ids).length > 0);
}

// What a page that was torn down left in localStorage, laid back in as `held`:
// on screen, kept, not sent until release() (the header says why). A box this
// visit has already touched is newer and keeps its own answer.
//
// ⚠️ IT TRUSTS NOTHING IT READS. localStorage can hold anything, and one value
// the rules refuse would fail every save after it: only a count a person could
// have typed (a finite number, not below zero) comes back, and only for maps on
// the list.
export function revive(outbox, saved, maps) {
  const box = normalize(outbox);
  const allowed = Array.isArray(maps) ? maps : [];
  const raw = layerOf(saved);
  const older = emptyLayer();
  for (const [map, values] of Object.entries(raw.pending)) {
    if (!allowed.includes(map)) continue;
    for (const [id, value] of Object.entries(values)) {
      if (id && typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        setIn(older.pending, map, id, value);
      }
    }
  }
  for (const [map, ids] of Object.entries(raw.cleared)) {
    if (!allowed.includes(map)) continue;
    for (const [id, flag] of Object.entries(ids)) {
      if (id && flag === true) {
        removeIn(older.pending, map, id);
        setIn(older.cleared, map, id, true);
      }
    }
  }
  const held = merge(box.held, older);
  for (const layer of [box.inFlight, box.handed, { pending: box.pending, cleared: box.cleared }]) {
    if (!layer) continue;
    for (const [map, values] of Object.entries(layer.pending)) {
      for (const id of Object.keys(values)) { removeIn(held.pending, map, id); removeIn(held.cleared, map, id); }
    }
    for (const [map, ids] of Object.entries(layer.cleared)) {
      for (const id of Object.keys(ids)) { removeIn(held.pending, map, id); removeIn(held.cleared, map, id); }
    }
  }
  return { ...box, held };
}

// Whether anything is held from an earlier visit.
export function hasHeld(outbox) {
  const box = normalize(outbox);
  return Object.values(box.held.pending).some(values => Object.keys(values).length > 0)
    || Object.values(box.held.cleared).some(ids => Object.keys(ids).length > 0);
}

// The server says the month is open: what was held goes to waiting, to be sent.
// Behind anything waiting, which is newer — though stage() has already taken every
// box typed since out of `held`.
export function release(outbox) {
  const box = normalize(outbox);
  const merged = merge(box.held, { pending: box.pending, cleared: box.cleared });
  return { ...box, pending: merged.pending, cleared: merged.cleared, held: emptyLayer() };
}

// One write has answered: `ok` true when it landed, anything else when it failed.
//
// ⚠️⚠️ NOTHING IS SETTLED UNTIL THE LAST WRITE IN THE AIR HAS ANSWERED (the header
// says why). Then the layer is confirmed if every one of them landed, and put back
// to be sent again if any of them failed — values that did land go again too,
// which writes the same number twice and loses nothing.
export function answered(outbox, ok) {
  const box = normalize(outbox);
  const writes = Math.max(0, box.writes - 1);
  const failed = box.failed || ok !== true;
  if (writes > 0) return { ...box, writes, failed };
  return failed ? restore(box) : confirm(box);
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
  // Oldest first, so the newer answer for a box is the one left on the document.
  const layers = [box.held, box.inFlight, { pending: box.pending, cleared: box.cleared }];
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
