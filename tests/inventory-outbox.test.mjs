// The stocktake's outbox: what has been typed on a phone and has not reached
// Firestore yet.
//
// ⚠️⚠️ WHY THIS FILE EXISTS AT ALL. This was the hardest code in the feature and
// the only part of it that had no tests, inside the store where it could not be
// reached without a browser. Everything it protects is invisible by nature: a
// count that goes missing between a storeroom and a database looks exactly like a
// count nobody typed, and the person who typed it has already walked away from the
// shelf. Nothing about using the app can show that it works.
//
// The three cases that cost real numbers, and each has a test named for it:
//   1. a write is in the air and a snapshot arrives without it
//   2. a write fails and the same box has been re-typed since
//   3. a write fails and the same box has been EMPTIED since

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_OUTBOX, stage, stageMany, hasWork, take, confirm, restore, applyOver,
} from '../js/inventory/inventory-outbox.js';

const MAPS = ['opening', 'purchased', 'closing', 'packKg'];

// A freshly normalised month document, the shape the store adopts from Firestore.
const doc = (counts = {}) => ({
  opening: { ...(counts.opening || {}) },
  purchased: { ...(counts.purchased || {}) },
  closing: { ...(counts.closing || {}) },
  packKg: { ...(counts.packKg || {}) },
});

// ── The everyday path ────────────────────────────────────────────────────────

test('an empty outbox has nothing to send and changes no document', () => {
  assert.equal(hasWork(EMPTY_OUTBOX), false);
  assert.deepEqual(applyOver(EMPTY_OUTBOX, doc({ closing: { flour: 4 } }), MAPS),
    doc({ closing: { flour: 4 } }));
});

test('a typed count is waiting, goes out, and lands', () => {
  const box = stage(EMPTY_OUTBOX, 'closing', 'flour', 3);
  assert.equal(hasWork(box), true);

  const sent = take(box);
  assert.deepEqual(sent.values, { closing: { flour: 3 } });
  assert.deepEqual(sent.clear, {});
  assert.equal(hasWork(sent.outbox), false, 'what has been sent is no longer waiting');

  const done = confirm(sent.outbox);
  assert.equal(hasWork(done), false);
  // Firestore is now the truth: its document passes through untouched.
  assert.deepEqual(applyOver(done, doc({ closing: { flour: 3 } }), MAPS),
    doc({ closing: { flour: 3 } }));
});

test('⚠️ an emptied box travels as a REMOVAL, never as a zero', () => {
  // A merge cannot express a removal, and a zero is a different fact from "not
  // counted" — the invariant the whole feature rests on.
  const sent = take(stage(EMPTY_OUTBOX, 'closing', 'flour', null));
  assert.deepEqual(sent.values, {});
  assert.deepEqual(sent.clear, { closing: { flour: true } });
});

test('a box emptied and then typed again sends only the number', () => {
  let box = stage(EMPTY_OUTBOX, 'closing', 'flour', 2);
  box = stage(box, 'closing', 'flour', null);
  box = stage(box, 'closing', 'flour', 5);
  const sent = take(box);
  assert.deepEqual(sent.values, { closing: { flour: 5 } });
  assert.deepEqual(sent.clear, {}, 'a removal that was undone must not go out');
});

test('a box typed and then emptied sends only the removal', () => {
  let box = stage(EMPTY_OUTBOX, 'closing', 'flour', 2);
  box = stage(box, 'closing', 'flour', null);
  const sent = take(box);
  assert.deepEqual(sent.values, {});
  assert.deepEqual(sent.clear, { closing: { flour: true } });
});

test('nothing is mutated: the outbox before a change is still itself afterwards', () => {
  const before = stage(EMPTY_OUTBOX, 'closing', 'flour', 1);
  const snapshot = JSON.stringify(before);
  stage(before, 'closing', 'flour', 9);
  take(before);
  restore(before);
  assert.equal(JSON.stringify(before), snapshot);
  assert.deepEqual(EMPTY_OUTBOX, { pending: {}, cleared: {}, inFlight: null },
    'and the shared empty one above all is never written into');
});

// ── 1. The write is in the air ───────────────────────────────────────────────

test('⚠️⚠️ a snapshot arriving mid-write does NOT take back the number', () => {
  // The window this exists for: the write has left, Firestore has not stored it
  // yet, and a listener fires with the document as it still is. Laying only the
  // WAITING changes over it would empty the box on screen and in the local cache —
  // the number gone from the one phone that had it.
  const sent = take(stage(EMPTY_OUTBOX, 'closing', 'flour', 7));
  const incoming = applyOver(sent.outbox, doc({ closing: { salt: 1 } }), MAPS);
  assert.deepEqual(incoming.closing, { salt: 1, flour: 7 });
});

test('⚠️ a removal in the air is not undone by a snapshot that still has the old number', () => {
  const sent = take(stage(EMPTY_OUTBOX, 'closing', 'flour', null));
  const incoming = applyOver(sent.outbox, doc({ closing: { flour: 4 } }), MAPS);
  assert.deepEqual(incoming.closing, {}, 'the box was emptied; the snapshot is behind');
});

test('a second save while the first is unanswered carries both', () => {
  const first = take(stage(EMPTY_OUTBOX, 'closing', 'flour', 1));
  const second = take(stage(first.outbox, 'closing', 'salt', 2));
  assert.deepEqual(second.values, { closing: { flour: 1, salt: 2 } },
    'nothing waiting may be dropped because an earlier write is still out');
  const incoming = applyOver(second.outbox, doc(), MAPS);
  assert.deepEqual(incoming.closing, { flour: 1, salt: 2 });
});

test('confirming keeps what was typed after the write left', () => {
  const sent = take(stage(EMPTY_OUTBOX, 'closing', 'flour', 1));
  const typedSince = stage(sent.outbox, 'closing', 'salt', 2);
  const done = confirm(typedSince);
  assert.equal(hasWork(done), true, 'the newer count still has to go');
  assert.deepEqual(take(done).values, { closing: { salt: 2 } });
});

// ── 2 and 3. The write failed ────────────────────────────────────────────────

test('a failed write comes back to be sent again', () => {
  const sent = take(stage(EMPTY_OUTBOX, 'closing', 'flour', 3));
  const back = restore(sent.outbox);
  assert.equal(hasWork(back), true);
  assert.deepEqual(take(back).values, { closing: { flour: 3 } });
});

test('⚠️⚠️ a number re-typed while the write was failing WINS over what came back', () => {
  // Otherwise the put-back overwrites a number typed a second ago — and the screen
  // would then disagree with the database in the direction nobody would notice.
  const sent = take(stage(EMPTY_OUTBOX, 'closing', 'flour', 3));
  const retyped = stage(sent.outbox, 'closing', 'flour', 8);
  const back = restore(retyped);
  assert.deepEqual(take(back).values, { closing: { flour: 8 } });
});

test('⚠️⚠️ a box EMPTIED while the write was failing is not resurrected by it', () => {
  // The reverse of the case above, and the one that was actually broken: the
  // failed write's deletion was put back unconditionally, so a re-typed number
  // went out with a deleteField() for the same box in the same write. The number
  // was destroyed by its own save.
  const sent = take(stage(EMPTY_OUTBOX, 'closing', 'flour', 3));
  const emptied = stage(sent.outbox, 'closing', 'flour', null);
  const back = restore(emptied);
  const out = take(back);
  assert.deepEqual(out.values, {}, 'the failed number may not come back');
  assert.deepEqual(out.clear, { closing: { flour: true } });
});

test('⚠️ a failed REMOVAL does not come back over a number typed since', () => {
  const sent = take(stage(EMPTY_OUTBOX, 'closing', 'flour', null));
  const typed = stage(sent.outbox, 'closing', 'flour', 6);
  const out = take(restore(typed));
  assert.deepEqual(out.values, { closing: { flour: 6 } });
  assert.deepEqual(out.clear, {}, 'a stale deletion must not travel beside the number');
});

test('a failed write leaves untouched boxes of the same map alone', () => {
  let box = stage(EMPTY_OUTBOX, 'closing', 'flour', 3);
  box = stage(box, 'closing', 'salt', 1);
  const sent = take(box);
  const typedSince = stage(sent.outbox, 'closing', 'sugar', 2);
  const out = take(restore(typedSince));
  assert.deepEqual(out.values, { closing: { flour: 3, salt: 1, sugar: 2 } });
});

// ── The shape of what it holds ───────────────────────────────────────────────

test('⚠️ an ingredient id containing a dot survives, because nothing splits on one', () => {
  // A Firestore document id may legally contain a dot. The first version of this
  // logic kept 'closing.flour' as a string and split it, which for an id like
  // 'olio.extra' deleted the wrong key — or nothing at all — in silence.
  const id = 'olio.extra.vergine';
  const sent = take(stage(EMPTY_OUTBOX, 'closing', id, null));
  assert.deepEqual(sent.clear, { closing: { [id]: true } });
  const incoming = applyOver(sent.outbox, doc({ closing: { [id]: 2, other: 1 } }), MAPS);
  assert.deepEqual(incoming.closing, { other: 1 });
});

test('the four maps are kept apart', () => {
  let box = stage(EMPTY_OUTBOX, 'opening', 'flour', 10);
  box = stage(box, 'closing', 'flour', 2);
  box = stage(box, 'packKg', 'flour', 25);
  const sent = take(box);
  assert.deepEqual(sent.values, {
    opening: { flour: 10 }, closing: { flour: 2 }, packKg: { flour: 25 },
  });
});

test('applyOver touches only the maps it is given', () => {
  const box = stage(EMPTY_OUTBOX, 'closing', 'flour', 5);
  const target = applyOver(box, doc(), ['opening']);
  assert.deepEqual(target.closing, {}, 'a map not on the list is not written into');
});

test('stageMany fills in a whole map at once, values and removals together', () => {
  const box = stageMany(EMPTY_OUTBOX, 'purchased', { flour: 2, salt: 1 }, ['sugar']);
  const sent = take(box);
  assert.deepEqual(sent.values, { purchased: { flour: 2, salt: 1 } });
  assert.deepEqual(sent.clear, { purchased: { sugar: true } });
});

test('junk in, no throw out', () => {
  for (const junk of [undefined, null, 42, 'nonsense', [], { pending: 'no' }]) {
    assert.equal(hasWork(junk), false, `${JSON.stringify(junk)} must read as nothing waiting`);
    assert.deepEqual(applyOver(junk, doc({ closing: { flour: 1 } }), MAPS).closing, { flour: 1 });
    assert.deepEqual(take(junk).values, {});
    assert.equal(hasWork(restore(junk)), false);
    assert.equal(hasWork(confirm(junk)), false);
  }
  assert.equal(hasWork(stage(EMPTY_OUTBOX, '', 'flour', 1)), false, 'a nameless map stages nothing');
  assert.equal(hasWork(stage(EMPTY_OUTBOX, 'closing', '', 1)), false, 'nor a nameless product');
});

test('a zero is a real count and travels as one', () => {
  // "I counted it and there is none left" is a fact, and not the same fact as an
  // empty box. The outbox must not confuse the two on its way out.
  const sent = take(stage(EMPTY_OUTBOX, 'closing', 'flour', 0));
  assert.deepEqual(sent.values, { closing: { flour: 0 } });
  assert.deepEqual(sent.clear, {});
  assert.deepEqual(applyOver(sent.outbox, doc(), MAPS).closing, { flour: 0 });
});
