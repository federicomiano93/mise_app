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
// The four cases that cost real numbers, and each has a test named for it:
//   1. a write is in the air and a snapshot arrives without it
//   2. a write fails and the same box has been re-typed since
//   3. a write fails and the same box has been EMPTIED since
//   4. with no signal, several writes are in the air at once (11 Oct 2026)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_OUTBOX, stage, stageMany, hasWork, take, confirm, restore, applyOver, answered,
  isSending, echoed, unsaved, hasUnsaved, revive, hasHeld, release,
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
  assert.deepEqual(EMPTY_OUTBOX, {
    pending: {}, cleared: {}, inFlight: null, writes: 0, failed: false,
    handed: { pending: {}, cleared: {} },
    held: { pending: {}, cleared: {} },
  },
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

test('⚠️ a second save while the first is unanswered carries only what is new', () => {
  // Carrying the first one's values again would write a stored count once more over
  // a correction another phone made in between — and on a weak signal every write
  // would grow by all the ones before it (code review, 11 Oct 2026).
  const first = take(stage(EMPTY_OUTBOX, 'closing', 'flour', 1));
  const second = take(stage(first.outbox, 'closing', 'salt', 2));
  assert.deepEqual(second.values, { closing: { salt: 2 } });
  const incoming = applyOver(second.outbox, doc(), MAPS);
  assert.deepEqual(incoming.closing, { flour: 1, salt: 2 },
    'but the screen still shows both until they have answered');
});

test('a box re-typed while its first write is out goes again with the new number', () => {
  const first = take(stage(EMPTY_OUTBOX, 'closing', 'flour', 1));
  const second = take(stage(first.outbox, 'closing', 'flour', 4));
  assert.deepEqual(second.values, { closing: { flour: 4 } });
  assert.deepEqual(applyOver(second.outbox, doc(), MAPS).closing, { flour: 4 });
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

// ── 4. Several writes in the air: a storeroom with no signal ─────────────────
//
// With no signal a write never answers. The store used to keep every later count
// in memory behind the first, so only the first reached the SDK's own queue (the
// one that outlasts the page): closing the app before signal lost the rest. Every
// save now goes at once, and these are the rules that make that safe.

test('⚠️⚠️ the first of two answers does NOT settle what the second is still carrying', () => {
  const first = take(stage(EMPTY_OUTBOX, 'closing', 'flour', 1));
  const second = take(stage(first.outbox, 'closing', 'salt', 2));
  assert.equal(second.outbox.writes, 2, 'two writes are out');

  const one = answered(second.outbox, true);
  assert.equal(isSending(one), true, 'the second write has not answered yet');
  assert.deepEqual(applyOver(one, doc(), MAPS).closing, { flour: 1, salt: 2 },
    'a snapshot arriving now must still show both numbers');

  const both = answered(one, true);
  assert.equal(isSending(both), false);
  assert.equal(hasWork(both), false, 'both landed: nothing left to send');
});

test('⚠️⚠️ a failed FIRST write is sent again even though the second one landed', () => {
  // The reason there used to be only one write in the air: the second one landing
  // must not count as the first one landing.
  const first = take(stage(EMPTY_OUTBOX, 'closing', 'flour', 1));
  const second = take(stage(first.outbox, 'closing', 'salt', 2));
  const afterFailure = answered(second.outbox, false);
  assert.equal(isSending(afterFailure), true, 'still waiting for the second answer');
  const settled = answered(afterFailure, true);
  assert.equal(isSending(settled), false);
  assert.deepEqual(take(settled).values, { closing: { flour: 1, salt: 2 } },
    'everything that was in the air goes again; a number sent twice loses nothing');
});

test('a failed LAST write is sent again too', () => {
  const first = take(stage(EMPTY_OUTBOX, 'closing', 'flour', 1));
  const second = take(stage(first.outbox, 'closing', 'salt', 2));
  const settled = answered(answered(second.outbox, true), new Error('refused'));
  assert.equal(hasWork(settled), true);
  assert.deepEqual(take(settled).values, { closing: { flour: 1, salt: 2 } });
});

test('⚠️ a number typed while the writes were out wins over what comes back', () => {
  const first = take(stage(EMPTY_OUTBOX, 'closing', 'flour', 1));
  const second = take(stage(first.outbox, 'closing', 'salt', 2));
  const retyped = stage(second.outbox, 'closing', 'flour', 9);
  const settled = answered(answered(retyped, false), false);
  assert.deepEqual(take(settled).values, { closing: { flour: 9, salt: 2 } });
});

test('one write answered with nothing else out settles at once, as before', () => {
  const sent = take(stage(EMPTY_OUTBOX, 'closing', 'flour', 3));
  assert.equal(sent.outbox.writes, 1);
  const landed = answered(sent.outbox, true);
  assert.equal(isSending(landed), false);
  assert.equal(hasWork(landed), false);
  const refused = answered(sent.outbox, false);
  assert.deepEqual(take(refused).values, { closing: { flour: 3 } });
});

test('a layer in the air with no count is still one write out', () => {
  // Whatever an outbox was built from, a layer in the air is never forgotten by the
  // count: answered() settles it on the first answer, never ignores it.
  const legacy = { pending: {}, cleared: {}, inFlight: { pending: { closing: { flour: 4 } }, cleared: {} } };
  assert.equal(isSending(legacy), true);
  assert.equal(hasWork(answered(legacy, true)), false);
  assert.deepEqual(take(answered(legacy, false)).values, { closing: { flour: 4 } });
});

// ── 5. Handed to Firestore is not yet safe ───────────────────────────────────
//
// The SDK puts a write in the browser's database a moment after it is handed over.
// Typed, and the page left at once (a back gesture): on the emulator the last count
// was gone (11 Oct 2026). So what is not yet seen back is kept, and laid back in.

test('⚠⚠ a count sent but not yet seen back is still unsaved; seen back, it is safe', () => {
  const sent = take(stage(EMPTY_OUTBOX, 'closing', 'flour', 3));
  assert.equal(hasWork(sent.outbox), false, 'nothing is waiting to be sent');
  assert.deepEqual(unsaved(sent.outbox).pending, { closing: { flour: 3 } },
    'but until the browser database shows it back, a torn-down page would lose it');

  const notYet = echoed(sent.outbox, doc({ closing: { salt: 1 } }), MAPS);
  assert.equal(hasUnsaved(notYet), true, 'a snapshot without the number proves nothing');

  const seen = echoed(sent.outbox, doc({ closing: { flour: 3 } }), MAPS);
  assert.equal(hasUnsaved(seen), false, 'the snapshot shows it: the SDK has stored it');
  assert.equal(isSending(seen), true, 'and it is still in the air: echoed() settles nothing else');
});

test('a snapshot with a DIFFERENT number does not count as the echo', () => {
  const sent = take(stage(EMPTY_OUTBOX, 'closing', 'flour', 3));
  assert.equal(hasUnsaved(echoed(sent.outbox, doc({ closing: { flour: 2 } }), MAPS)), true);
});

test('an emptied box is seen back when the snapshot no longer has it', () => {
  const sent = take(stage(EMPTY_OUTBOX, 'closing', 'flour', null));
  assert.equal(hasUnsaved(echoed(sent.outbox, doc({ closing: { flour: 4 } }), MAPS)), true);
  assert.equal(hasUnsaved(echoed(sent.outbox, doc(), MAPS)), false);
});

test('what is typed and not sent yet is unsaved too', () => {
  const box = stage(EMPTY_OUTBOX, 'closing', 'flour', 5);
  assert.deepEqual(unsaved(box).pending, { closing: { flour: 5 } });
  assert.equal(hasUnsaved(EMPTY_OUTBOX), false);
});

test('⚠ the newer number wins in what is kept: re-typed after sending, the new one', () => {
  const sent = take(stage(EMPTY_OUTBOX, 'closing', 'flour', 3));
  const retyped = stage(sent.outbox, 'closing', 'flour', 8);
  assert.deepEqual(unsaved(retyped).pending, { closing: { flour: 8 } });
  const emptied = stage(sent.outbox, 'closing', 'flour', null);
  assert.deepEqual(unsaved(emptied), { pending: {}, cleared: { closing: { flour: true } } });
});

test('confirmed by the server, nothing is left handed', () => {
  const sent = take(stage(EMPTY_OUTBOX, 'closing', 'flour', 3));
  assert.equal(hasUnsaved(answered(sent.outbox, true)), false);
  const failed = answered(sent.outbox, false);
  assert.deepEqual(unsaved(failed).pending, { closing: { flour: 3 } },
    'a failed write is waiting again, and waiting is unsaved');
});

test('⚠⚠ what a torn-down page left behind is laid back in: shown and kept, sent once released', () => {
  const left = unsaved(take(stage(stage(EMPTY_OUTBOX, 'closing', 'flour', 3), 'closing', 'salt', null)).outbox);
  const stored = JSON.parse(JSON.stringify(left));   // through localStorage and back
  const back = revive(EMPTY_OUTBOX, stored, MAPS);
  assert.equal(hasHeld(back), true);
  assert.equal(hasWork(back), false, 'HELD: nothing goes until the server says the month is open');
  assert.deepEqual(applyOver(back, doc({ closing: { salt: 2 } }), MAPS).closing, { flour: 3 },
    'but it is on screen, and the first snapshot cannot take it back off');
  assert.deepEqual(unsaved(back), stored, 'and it is still written down');

  const out = take(release(back));
  assert.deepEqual(out.values, { closing: { flour: 3 } });
  assert.deepEqual(out.clear, { closing: { salt: true } });
  assert.equal(hasHeld(release(back)), false);
});

test('⚠⚠ held survives the writes of this visit answering, and is never sent by them', () => {
  // The month may have been closed elsewhere while the phone held these: only release()
  // may send them, never a save of something else typed meanwhile.
  const back = revive(EMPTY_OUTBOX, { pending: { closing: { salt: 1 } }, cleared: {} }, MAPS);
  const sent = take(stage(back, 'closing', 'flour', 4));
  assert.deepEqual(sent.values, { closing: { flour: 4 } }, 'the held count does not ride along');
  assert.equal(hasHeld(answered(sent.outbox, true)), true);
  assert.equal(hasHeld(answered(sent.outbox, false)), true);
  assert.deepEqual(unsaved(answered(sent.outbox, true)).pending, { closing: { salt: 1 } });
});

test('⚠ a number typed since the page came back wins over what it left behind', () => {
  const typed = stage(EMPTY_OUTBOX, 'closing', 'flour', 9);
  const back = revive(typed, { pending: { closing: { flour: 3, salt: 1 } }, cleared: {} }, MAPS);
  assert.deepEqual(take(release(back)).values, { closing: { flour: 9, salt: 1 } });
  const emptied = stage(EMPTY_OUTBOX, 'closing', 'flour', null);
  const back2 = take(release(revive(emptied, { pending: { closing: { flour: 3 } }, cleared: {} }, MAPS)));
  assert.deepEqual(back2.values, {}, 'emptied since: the old number may not come back');
  assert.deepEqual(back2.clear, { closing: { flour: true } });
});

test('⚠⚠ a box already SENT this visit is not overwritten by what an earlier one left', () => {
  // Sent, it is no longer waiting — released behind «waiting» alone, the older number
  // would follow it to Firestore and undo it.
  const sent = take(stage(EMPTY_OUTBOX, 'closing', 'flour', 9)).outbox;
  const back = revive(sent, { pending: { closing: { flour: 3 } }, cleared: {} }, MAPS);
  assert.equal(hasHeld(back), false);
  assert.equal(hasWork(release(back)), false);
});

test('a box typed after the page came back leaves held at once', () => {
  const back = revive(EMPTY_OUTBOX, { pending: { closing: { flour: 3, salt: 1 } }, cleared: {} }, MAPS);
  const typed = stage(back, 'closing', 'flour', 7);
  assert.deepEqual(unsaved(typed).pending, { closing: { flour: 7, salt: 1 } });
  assert.deepEqual(take(release(typed)).values, { closing: { flour: 7, salt: 1 } });
});

test('⚠ revive trusts nothing it reads: only counts a person could have typed', () => {
  const junk = {
    pending: {
      closing: { a: -1, b: 'x', c: NaN, d: Infinity, e: 2, f: null, g: {} },
      notAMap: { h: 1 },
    },
    cleared: { closing: { i: 'yes', j: true }, notAMap: { k: true } },
  };
  const out = take(release(revive(EMPTY_OUTBOX, junk, MAPS)));
  assert.deepEqual(out.values, { closing: { e: 2 } });
  assert.deepEqual(out.clear, { closing: { j: true } });
  for (const nothing of [undefined, null, 42, 'x', [], { pending: 'no' }]) {
    assert.equal(hasWork(revive(EMPTY_OUTBOX, nothing, MAPS)), false);
  }
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
    assert.equal(hasWork(answered(junk, true)), false);
    assert.equal(isSending(answered(junk, false)), false);
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
