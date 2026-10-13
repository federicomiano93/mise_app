// Unit tests for the stocktake's outbox: what has been typed on a phone and has not reached Firestore
// yet (P15 — the owner cannot read code, so these tests are the safety net), run against BOTH
// implementations: the TypeScript port in shared/ and js/inventory/inventory-outbox.js, which the live
// app uses today. Ported from tests/inventory-outbox.test.mjs; the two must stay equal until the
// switch to Mise 2. Every one of that file's 40 tests is ported (21 of them from before the fix of
// 11 Oct 2026, 19 from the fix itself). The module is a FULL port, so parity.spec.ts also compares its
// exports name by name.
//
// ⚠️⚠️ WHY THESE TESTS EXIST AT ALL. This was the hardest code in the feature and the only part of it
// that had no tests, inside the store where it could not be reached without a browser. Everything it
// protects is invisible by nature: a count that goes missing between a storeroom and a database
// looks exactly like a count nobody typed, and the person who typed it has already walked away from
// the shelf. Nothing about using the app can show that it works.
//
// The cases that cost real numbers, and each has a test named for it:
//   1. a write is in the air and a snapshot arrives without it
//   2. a write fails and the same box has been re-typed since
//   3. a write fails and the same box has been EMPTIED since
//   4. with no signal, several writes are in the air at once (11 Oct 2026)
//   5. a write handed to Firestore is not yet in the browser's own database (11 Oct 2026)
//
// The last block ("Added") pins what the original's tests leave out: that the frozen empty outbox can
// be built on, that what take() hands to the caller is a copy, that applyOver changes the very
// document it is given and lays the layers over it oldest first.

import { describe, expect, test } from 'vitest';
import * as ported from './inventory-outbox';
import * as legacyJs from '../../js/inventory/inventory-outbox.js';

const legacy = legacyJs as unknown as typeof ported;

// The fix of 11 Oct 2026 (PR #343) is in both files: every test below, the fix's included, runs against
// the port AND js/inventory/inventory-outbox.js, with no condition.

type Implementation = readonly [string, typeof ported];
const BOTH: readonly Implementation[] = [['shared/ (TypeScript)', ported], ['js/ (current app)', legacy]];

const MAPS = ['opening', 'purchased', 'closing', 'packKg'];

// A freshly normalised month document, the shape the store adopts from Firestore.
interface Counts {
  opening?: Record<string, number>;
  purchased?: Record<string, number>;
  closing?: Record<string, number>;
  packKg?: Record<string, number>;
}
const doc = (counts: Counts = {}): Required<Counts> => ({
  opening: { ...(counts.opening || {}) },
  purchased: { ...(counts.purchased || {}) },
  closing: { ...(counts.closing || {}) },
  packKg: { ...(counts.packKg || {}) },
});

const EMPTY_LAYER = { pending: {}, cleared: {} };
// What an outbox with nothing in it looks like once it has been through any of the functions.
const EMPTY_SHAPE = {
  pending: {}, cleared: {}, inFlight: null, writes: 0, failed: false, handed: EMPTY_LAYER, held: EMPTY_LAYER,
};

describe.each(BOTH)('%s', (_name, m) => {
  // ── The everyday path ──────────────────────────────────────────────────────

  test('an empty outbox has nothing to send and changes no document', () => {
    expect(m.hasWork(m.EMPTY_OUTBOX)).toBe(false);
    expect(m.applyOver(m.EMPTY_OUTBOX, doc({ closing: { flour: 4 } }), MAPS)).toStrictEqual(doc({ closing: { flour: 4 } }));
  });

  test('a typed count is waiting, goes out, and lands', () => {
    const box = m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 3);
    expect(m.hasWork(box)).toBe(true);

    const sent = m.take(box);
    expect(sent.values).toStrictEqual({ closing: { flour: 3 } });
    expect(sent.clear).toStrictEqual({});
    expect(m.hasWork(sent.outbox), 'what has been sent is no longer waiting').toBe(false);

    const done = m.confirm(sent.outbox);
    expect(m.hasWork(done)).toBe(false);
    // Firestore is now the truth: its document passes through untouched.
    expect(m.applyOver(done, doc({ closing: { flour: 3 } }), MAPS)).toStrictEqual(doc({ closing: { flour: 3 } }));
  });

  test('⚠️ an emptied box travels as a REMOVAL, never as a zero', () => {
    // A merge cannot express a removal, and a zero is a different fact from "not
    // counted" — the invariant the whole feature rests on.
    const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', null));
    expect(sent.values).toStrictEqual({});
    expect(sent.clear).toStrictEqual({ closing: { flour: true } });
  });

  test('a box emptied and then typed again sends only the number', () => {
    let box = m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 2);
    box = m.stage(box, 'closing', 'flour', null);
    box = m.stage(box, 'closing', 'flour', 5);
    const sent = m.take(box);
    expect(sent.values).toStrictEqual({ closing: { flour: 5 } });
    expect(sent.clear, 'a removal that was undone must not go out').toStrictEqual({});
  });

  test('a box typed and then emptied sends only the removal', () => {
    let box = m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 2);
    box = m.stage(box, 'closing', 'flour', null);
    const sent = m.take(box);
    expect(sent.values).toStrictEqual({});
    expect(sent.clear).toStrictEqual({ closing: { flour: true } });
  });

  // ── 1. The write is in the air ─────────────────────────────────────────────

  test('⚠️⚠️ a snapshot arriving mid-write does NOT take back the number', () => {
    // The window this exists for: the write has left, Firestore has not stored it
    // yet, and a listener fires with the document as it still is. Laying only the
    // WAITING changes over it would empty the box on screen and in the local cache —
    // the number gone from the one phone that had it.
    const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 7));
    const incoming = m.applyOver(sent.outbox, doc({ closing: { salt: 1 } }), MAPS);
    expect(incoming.closing).toStrictEqual({ salt: 1, flour: 7 });
  });

  test('⚠️ a removal in the air is not undone by a snapshot that still has the old number', () => {
    const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', null));
    const incoming = m.applyOver(sent.outbox, doc({ closing: { flour: 4 } }), MAPS);
    expect(incoming.closing, 'the box was emptied; the snapshot is behind').toStrictEqual({});
  });

  test('confirming keeps what was typed after the write left', () => {
    const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 1));
    const typedSince = m.stage(sent.outbox, 'closing', 'salt', 2);
    const done = m.confirm(typedSince);
    expect(m.hasWork(done), 'the newer count still has to go').toBe(true);
    expect(m.take(done).values).toStrictEqual({ closing: { salt: 2 } });
  });

  // ── 2 and 3. The write failed ──────────────────────────────────────────────

  test('a failed write comes back to be sent again', () => {
    const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 3));
    const back = m.restore(sent.outbox);
    expect(m.hasWork(back)).toBe(true);
    expect(m.take(back).values).toStrictEqual({ closing: { flour: 3 } });
  });

  test('⚠️⚠️ a number re-typed while the write was failing WINS over what came back', () => {
    // Otherwise the put-back overwrites a number typed a second ago — and the screen
    // would then disagree with the database in the direction nobody would notice.
    const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 3));
    const retyped = m.stage(sent.outbox, 'closing', 'flour', 8);
    const back = m.restore(retyped);
    expect(m.take(back).values).toStrictEqual({ closing: { flour: 8 } });
  });

  test('⚠️⚠️ a box EMPTIED while the write was failing is not resurrected by it', () => {
    // The reverse of the case above, and the one that was actually broken: the
    // failed write's deletion was put back unconditionally, so a re-typed number
    // went out with a deleteField() for the same box in the same write. The number
    // was destroyed by its own save.
    const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 3));
    const emptied = m.stage(sent.outbox, 'closing', 'flour', null);
    const back = m.restore(emptied);
    const out = m.take(back);
    expect(out.values, 'the failed number may not come back').toStrictEqual({});
    expect(out.clear).toStrictEqual({ closing: { flour: true } });
  });

  test('⚠️ a failed REMOVAL does not come back over a number typed since', () => {
    const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', null));
    const typed = m.stage(sent.outbox, 'closing', 'flour', 6);
    const out = m.take(m.restore(typed));
    expect(out.values).toStrictEqual({ closing: { flour: 6 } });
    expect(out.clear, 'a stale deletion must not travel beside the number').toStrictEqual({});
  });

  test('a failed write leaves untouched boxes of the same map alone', () => {
    let box = m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 3);
    box = m.stage(box, 'closing', 'salt', 1);
    const sent = m.take(box);
    const typedSince = m.stage(sent.outbox, 'closing', 'sugar', 2);
    const out = m.take(m.restore(typedSince));
    expect(out.values).toStrictEqual({ closing: { flour: 3, salt: 1, sugar: 2 } });
  });

  // ── The shape of what it holds ─────────────────────────────────────────────

  test('⚠️ an ingredient id containing a dot survives, because nothing splits on one', () => {
    // A Firestore document id may legally contain a dot. The first version of this
    // logic kept 'closing.flour' as a string and split it, which for an id like
    // 'olio.extra' deleted the wrong key — or nothing at all — in silence.
    const id = 'olio.extra.vergine';
    const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', id, null));
    expect(sent.clear).toStrictEqual({ closing: { [id]: true } });
    const incoming = m.applyOver(sent.outbox, doc({ closing: { [id]: 2, other: 1 } }), MAPS);
    expect(incoming.closing).toStrictEqual({ other: 1 });
  });

  test('the four maps are kept apart', () => {
    let box = m.stage(m.EMPTY_OUTBOX, 'opening', 'flour', 10);
    box = m.stage(box, 'closing', 'flour', 2);
    box = m.stage(box, 'packKg', 'flour', 25);
    const sent = m.take(box);
    expect(sent.values).toStrictEqual({
      opening: { flour: 10 }, closing: { flour: 2 }, packKg: { flour: 25 },
    });
  });

  test('applyOver touches only the maps it is given', () => {
    const box = m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 5);
    const target = m.applyOver(box, doc(), ['opening']);
    expect(target.closing, 'a map not on the list is not written into').toStrictEqual({});
  });

  test('stageMany fills in a whole map at once, values and removals together', () => {
    const box = m.stageMany(m.EMPTY_OUTBOX, 'purchased', { flour: 2, salt: 1 }, ['sugar']);
    const sent = m.take(box);
    expect(sent.values).toStrictEqual({ purchased: { flour: 2, salt: 1 } });
    expect(sent.clear).toStrictEqual({ purchased: { sugar: true } });
  });

  test('junk in, no throw out', () => {
    for (const junk of [undefined, null, 42, 'nonsense', [], { pending: 'no' }]) {
      expect(m.hasWork(junk), `${JSON.stringify(junk)} must read as nothing waiting`).toBe(false);
      expect(m.applyOver(junk, doc({ closing: { flour: 1 } }), MAPS).closing).toStrictEqual({ flour: 1 });
      expect(m.take(junk).values).toStrictEqual({});
      expect(m.hasWork(m.restore(junk))).toBe(false);
      expect(m.hasWork(m.confirm(junk))).toBe(false);
    }
    expect(m.hasWork(m.stage(m.EMPTY_OUTBOX, '', 'flour', 1)), 'a nameless map stages nothing').toBe(false);
    expect(m.hasWork(m.stage(m.EMPTY_OUTBOX, 'closing', '', 1)), 'nor a nameless product').toBe(false);
  });

  test('a zero is a real count and travels as one', () => {
    // "I counted it and there is none left" is a fact, and not the same fact as an
    // empty box. The outbox must not confuse the two on its way out.
    const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 0));
    expect(sent.values).toStrictEqual({ closing: { flour: 0 } });
    expect(sent.clear).toStrictEqual({});
    expect(m.applyOver(sent.outbox, doc(), MAPS).closing).toStrictEqual({ flour: 0 });
  });

  // ── Added ──────────────────────────────────────────────────────────────────
  // Not in tests/inventory-outbox.test.mjs.

  test('a write is in the air from take() until it is confirmed or fails', () => {
    expect(m.isSending(m.EMPTY_OUTBOX)).toBe(false);
    const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 3));
    expect(m.isSending(sent.outbox)).toBe(true);
    expect(m.isSending(m.stage(sent.outbox, 'closing', 'salt', 1)), 'typing more does not end it').toBe(true);
    expect(m.isSending(m.confirm(sent.outbox))).toBe(false);
    expect(m.isSending(m.restore(sent.outbox))).toBe(false);
    for (const junk of [undefined, null, 42, 'nonsense', []]) expect(m.isSending(junk)).toBe(false);
  });

  test('the frozen empty outbox can be built on: every function answers a new one', () => {
    expect(Object.isFrozen(m.EMPTY_OUTBOX)).toBe(true);
    const staged = m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 1);
    expect(staged).not.toBe(m.EMPTY_OUTBOX);
    expect(m.stageMany(m.EMPTY_OUTBOX, 'closing', { flour: 1 })).toStrictEqual(staged);
  });

  test('what take() hands over is a copy: nothing the caller does reaches the outbox it gets back', () => {
    const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 3));
    (sent.values['closing'] as Record<string, unknown>)['flour'] = 99;
    sent.values['packKg'] = { flour: 1 };
    sent.clear['closing'] = { salt: true };
    expect(m.take(m.restore(sent.outbox)).values).toStrictEqual({ closing: { flour: 3 } });
    expect(m.take(m.restore(sent.outbox)).clear).toStrictEqual({});
  });

  test('applyOver changes the document it is given, and answers that same document', () => {
    const target = doc({ closing: { salt: 1 } });
    const answer = m.applyOver(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 4), target, MAPS);
    expect(answer).toBe(target);
    expect(target.closing).toStrictEqual({ salt: 1, flour: 4 });
  });

  test('what is in the air is laid over first and what is waiting after it: the newer answer for a box wins', () => {
    const inTheAir = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 3)).outbox;
    const typedAfter = m.stage(inTheAir, 'closing', 'flour', 8);
    expect(m.applyOver(typedAfter, doc({ closing: { flour: 1 } }), MAPS).closing).toStrictEqual({ flour: 8 });
    const emptiedAfter = m.stage(inTheAir, 'closing', 'flour', null);
    expect(m.applyOver(emptiedAfter, doc({ closing: { flour: 1 } }), MAPS).closing).toStrictEqual({});
  });

  test('a document without the map is left alone, and so is a map the outbox does not name', () => {
    const box = m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 4);
    expect(m.applyOver(box, { opening: { a: 1 } }, MAPS)).toStrictEqual({ opening: { a: 1 } });
    expect(m.applyOver(box, doc({ opening: { a: 1 } }), 'closing')).toStrictEqual(doc({ opening: { a: 1 } }));
    expect(m.applyOver(box, doc(), undefined)).toStrictEqual(doc());
  });
});

// ── The fix of 11 Oct 2026 ────────────────────────────────────────────────────
// Everything below changes how an outbox is shaped or settled, so it is compared against the current
// app's file too, unconditionally (PR #343 is on main).

describe.each(BOTH)('%s — several writes in the air, counts held for the server', (_name, m) => {
  test('nothing is mutated: the outbox before a change is still itself afterwards', () => {
    const before = m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 1);
    const snapshot = JSON.stringify(before);
    m.stage(before, 'closing', 'flour', 9);
    m.take(before);
    m.restore(before);
    m.answered(before, true);
    m.release(before);
    m.revive(before, { pending: { closing: { salt: 2 } }, cleared: {} }, MAPS);
    m.echoed(before, doc({ closing: { flour: 1 } }), MAPS);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(m.EMPTY_OUTBOX, 'and the shared empty one above all is never written into').toStrictEqual(EMPTY_SHAPE);
  });

  test('every function that settles an outbox answers the same empty shape for the empty one', () => {
    expect(m.restore(m.EMPTY_OUTBOX)).toStrictEqual(EMPTY_SHAPE);
    expect(m.confirm(m.EMPTY_OUTBOX)).toStrictEqual(EMPTY_SHAPE);
    expect(m.answered(m.EMPTY_OUTBOX, true)).toStrictEqual(EMPTY_SHAPE);
    expect(m.answered(m.EMPTY_OUTBOX, false)).toStrictEqual(EMPTY_SHAPE);
    expect(m.release(m.EMPTY_OUTBOX)).toStrictEqual(EMPTY_SHAPE);
    expect(m.revive(m.EMPTY_OUTBOX, undefined, MAPS)).toStrictEqual(EMPTY_SHAPE);
    expect(m.echoed(m.EMPTY_OUTBOX, doc(), MAPS)).toStrictEqual(EMPTY_SHAPE);
  });

  test('⚠️ a second save while the first is unanswered carries only what is new', () => {
    // Carrying the first one's values again would write a stored count once more over
    // a correction another phone made in between — and on a weak signal every write
    // would grow by all the ones before it (code review, 11 Oct 2026).
    const first = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 1));
    const second = m.take(m.stage(first.outbox, 'closing', 'salt', 2));
    expect(second.values).toStrictEqual({ closing: { salt: 2 } });
    const incoming = m.applyOver(second.outbox, doc(), MAPS);
    expect(incoming.closing, 'but the screen still shows both until they have answered')
      .toStrictEqual({ flour: 1, salt: 2 });
  });

  test('a box re-typed while its first write is out goes again with the new number', () => {
    const first = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 1));
    const second = m.take(m.stage(first.outbox, 'closing', 'flour', 4));
    expect(second.values).toStrictEqual({ closing: { flour: 4 } });
    expect(m.applyOver(second.outbox, doc(), MAPS).closing).toStrictEqual({ flour: 4 });
  });

  // ── 4. Several writes in the air: a storeroom with no signal ───────────────
  //
  // With no signal a write never answers. The store used to keep every later count
  // in memory behind the first, so only the first reached the SDK's own queue (the
  // one that outlasts the page): closing the app before signal lost the rest. Every
  // save now goes at once, and these are the rules that make that safe.

  test('⚠️⚠️ the first of two answers does NOT settle what the second is still carrying', () => {
    const first = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 1));
    const second = m.take(m.stage(first.outbox, 'closing', 'salt', 2));
    expect(second.outbox.writes, 'two writes are out').toBe(2);

    const one = m.answered(second.outbox, true);
    expect(m.isSending(one), 'the second write has not answered yet').toBe(true);
    expect(m.applyOver(one, doc(), MAPS).closing, 'a snapshot arriving now must still show both numbers')
      .toStrictEqual({ flour: 1, salt: 2 });

    const both = m.answered(one, true);
    expect(m.isSending(both)).toBe(false);
    expect(m.hasWork(both), 'both landed: nothing left to send').toBe(false);
  });

  test('⚠️⚠️ a failed FIRST write is sent again even though the second one landed', () => {
    // The reason there used to be only one write in the air: the second one landing
    // must not count as the first one landing.
    const first = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 1));
    const second = m.take(m.stage(first.outbox, 'closing', 'salt', 2));
    const afterFailure = m.answered(second.outbox, false);
    expect(m.isSending(afterFailure), 'still waiting for the second answer').toBe(true);
    const settled = m.answered(afterFailure, true);
    expect(m.isSending(settled)).toBe(false);
    expect(m.take(settled).values, 'everything that was in the air goes again; a number sent twice loses nothing')
      .toStrictEqual({ closing: { flour: 1, salt: 2 } });
  });

  test('a failed LAST write is sent again too', () => {
    const first = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 1));
    const second = m.take(m.stage(first.outbox, 'closing', 'salt', 2));
    const settled = m.answered(m.answered(second.outbox, true), new Error('refused'));
    expect(m.hasWork(settled)).toBe(true);
    expect(m.take(settled).values).toStrictEqual({ closing: { flour: 1, salt: 2 } });
  });

  test('⚠️ a number typed while the writes were out wins over what comes back', () => {
    const first = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 1));
    const second = m.take(m.stage(first.outbox, 'closing', 'salt', 2));
    const retyped = m.stage(second.outbox, 'closing', 'flour', 9);
    const settled = m.answered(m.answered(retyped, false), false);
    expect(m.take(settled).values).toStrictEqual({ closing: { flour: 9, salt: 2 } });
  });

  test('one write answered with nothing else out settles at once, as before', () => {
    const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 3));
    expect(sent.outbox.writes).toBe(1);
    const landed = m.answered(sent.outbox, true);
    expect(m.isSending(landed)).toBe(false);
    expect(m.hasWork(landed)).toBe(false);
    const refused = m.answered(sent.outbox, false);
    expect(m.take(refused).values).toStrictEqual({ closing: { flour: 3 } });
  });

  test('a layer in the air with no count is still one write out', () => {
    // Whatever an outbox was built from, a layer in the air is never forgotten by the
    // count: answered() settles it on the first answer, never ignores it.
    const old = { pending: {}, cleared: {}, inFlight: { pending: { closing: { flour: 4 } }, cleared: {} } };
    expect(m.isSending(old)).toBe(true);
    expect(m.hasWork(m.answered(old, true))).toBe(false);
    expect(m.take(m.answered(old, false)).values).toStrictEqual({ closing: { flour: 4 } });
  });

  // ── 5. Handed to Firestore is not yet safe ─────────────────────────────────
  //
  // The SDK puts a write in the browser's database a moment after it is handed over.
  // Typed, and the page left at once (a back gesture): on the emulator the last count
  // was gone (11 Oct 2026). So what is not yet seen back is kept, and laid back in.

  test('⚠⚠ a count sent but not yet seen back is still unsaved; seen back, it is safe', () => {
    const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 3));
    expect(m.hasWork(sent.outbox), 'nothing is waiting to be sent').toBe(false);
    expect(m.unsaved(sent.outbox).pending, 'but until the browser database shows it back, a torn-down page would lose it')
      .toStrictEqual({ closing: { flour: 3 } });

    const notYet = m.echoed(sent.outbox, doc({ closing: { salt: 1 } }), MAPS);
    expect(m.hasUnsaved(notYet), 'a snapshot without the number proves nothing').toBe(true);

    const seen = m.echoed(sent.outbox, doc({ closing: { flour: 3 } }), MAPS);
    expect(m.hasUnsaved(seen), 'the snapshot shows it: the SDK has stored it').toBe(false);
    expect(m.isSending(seen), 'and it is still in the air: echoed() settles nothing else').toBe(true);
  });

  test('a snapshot with a DIFFERENT number does not count as the echo', () => {
    const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 3));
    expect(m.hasUnsaved(m.echoed(sent.outbox, doc({ closing: { flour: 2 } }), MAPS))).toBe(true);
  });

  test('an emptied box is seen back when the snapshot no longer has it', () => {
    const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', null));
    expect(m.hasUnsaved(m.echoed(sent.outbox, doc({ closing: { flour: 4 } }), MAPS))).toBe(true);
    expect(m.hasUnsaved(m.echoed(sent.outbox, doc(), MAPS))).toBe(false);
  });

  test('what is typed and not sent yet is unsaved too', () => {
    const box = m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 5);
    expect(m.unsaved(box).pending).toStrictEqual({ closing: { flour: 5 } });
    expect(m.hasUnsaved(m.EMPTY_OUTBOX)).toBe(false);
  });

  test('⚠ the newer number wins in what is kept: re-typed after sending, the new one', () => {
    const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 3));
    const retyped = m.stage(sent.outbox, 'closing', 'flour', 8);
    expect(m.unsaved(retyped).pending).toStrictEqual({ closing: { flour: 8 } });
    const emptied = m.stage(sent.outbox, 'closing', 'flour', null);
    expect(m.unsaved(emptied)).toStrictEqual({ pending: {}, cleared: { closing: { flour: true } } });
  });

  test('confirmed by the server, nothing is left handed', () => {
    const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 3));
    expect(m.hasUnsaved(m.answered(sent.outbox, true))).toBe(false);
    const failed = m.answered(sent.outbox, false);
    expect(m.unsaved(failed).pending, 'a failed write is waiting again, and waiting is unsaved')
      .toStrictEqual({ closing: { flour: 3 } });
  });

  test('⚠⚠ what a torn-down page left behind is laid back in: shown and kept, sent once released', () => {
    const left = m.unsaved(m.take(m.stage(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 3), 'closing', 'salt', null)).outbox);
    const stored = JSON.parse(JSON.stringify(left)) as typeof left;   // through localStorage and back
    const back = m.revive(m.EMPTY_OUTBOX, stored, MAPS);
    expect(m.hasHeld(back)).toBe(true);
    expect(m.hasWork(back), 'HELD: nothing goes until the server says the month is open').toBe(false);
    expect(m.applyOver(back, doc({ closing: { salt: 2 } }), MAPS).closing,
      'but it is on screen, and the first snapshot cannot take it back off').toStrictEqual({ flour: 3 });
    expect(m.unsaved(back), 'and it is still written down').toStrictEqual(stored);

    const out = m.take(m.release(back));
    expect(out.values).toStrictEqual({ closing: { flour: 3 } });
    expect(out.clear).toStrictEqual({ closing: { salt: true } });
    expect(m.hasHeld(m.release(back))).toBe(false);
  });

  test('⚠⚠ held survives the writes of this visit answering, and is never sent by them', () => {
    // The month may have been closed elsewhere while the phone held these: only release()
    // may send them, never a save of something else typed meanwhile.
    const back = m.revive(m.EMPTY_OUTBOX, { pending: { closing: { salt: 1 } }, cleared: {} }, MAPS);
    const sent = m.take(m.stage(back, 'closing', 'flour', 4));
    expect(sent.values, 'the held count does not ride along').toStrictEqual({ closing: { flour: 4 } });
    expect(m.hasHeld(m.answered(sent.outbox, true))).toBe(true);
    expect(m.hasHeld(m.answered(sent.outbox, false))).toBe(true);
    expect(m.unsaved(m.answered(sent.outbox, true)).pending).toStrictEqual({ closing: { salt: 1 } });
  });

  test('⚠ a number typed since the page came back wins over what it left behind', () => {
    const typed = m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 9);
    const back = m.revive(typed, { pending: { closing: { flour: 3, salt: 1 } }, cleared: {} }, MAPS);
    expect(m.take(m.release(back)).values).toStrictEqual({ closing: { flour: 9, salt: 1 } });
    const emptied = m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', null);
    const back2 = m.take(m.release(m.revive(emptied, { pending: { closing: { flour: 3 } }, cleared: {} }, MAPS)));
    expect(back2.values, 'emptied since: the old number may not come back').toStrictEqual({});
    expect(back2.clear).toStrictEqual({ closing: { flour: true } });
  });

  test('⚠⚠ a box already SENT this visit is not overwritten by what an earlier one left', () => {
    // Sent, it is no longer waiting — released behind «waiting» alone, the older number
    // would follow it to Firestore and undo it.
    const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 9)).outbox;
    const back = m.revive(sent, { pending: { closing: { flour: 3 } }, cleared: {} }, MAPS);
    expect(m.hasHeld(back)).toBe(false);
    expect(m.hasWork(m.release(back))).toBe(false);
  });

  test('a box typed after the page came back leaves held at once', () => {
    const back = m.revive(m.EMPTY_OUTBOX, { pending: { closing: { flour: 3, salt: 1 } }, cleared: {} }, MAPS);
    const typed = m.stage(back, 'closing', 'flour', 7);
    expect(m.unsaved(typed).pending).toStrictEqual({ closing: { flour: 7, salt: 1 } });
    expect(m.take(m.release(typed)).values).toStrictEqual({ closing: { flour: 7, salt: 1 } });
  });

  test('⚠ revive trusts nothing it reads: only counts a person could have typed', () => {
    const junk = {
      pending: {
        closing: { a: -1, b: 'x', c: NaN, d: Infinity, e: 2, f: null, g: {} },
        notAMap: { h: 1 },
      },
      cleared: { closing: { i: 'yes', j: true }, notAMap: { k: true } },
    };
    const out = m.take(m.release(m.revive(m.EMPTY_OUTBOX, junk, MAPS)));
    expect(out.values).toStrictEqual({ closing: { e: 2 } });
    expect(out.clear).toStrictEqual({ closing: { j: true } });
    for (const nothing of [undefined, null, 42, 'x', [], { pending: 'no' }]) {
      expect(m.hasWork(m.revive(m.EMPTY_OUTBOX, nothing, MAPS))).toBe(false);
    }
  });

  test('junk in, no throw out — for the functions of the fix too', () => {
    for (const junk of [undefined, null, 42, 'nonsense', [], { pending: 'no' }]) {
      expect(m.hasWork(m.answered(junk, true))).toBe(false);
      expect(m.isSending(m.answered(junk, false))).toBe(false);
      expect(m.hasUnsaved(junk)).toBe(false);
      expect(m.hasHeld(junk)).toBe(false);
      expect(m.hasHeld(m.release(junk))).toBe(false);
      expect(m.hasUnsaved(m.echoed(junk, doc(), MAPS))).toBe(false);
      expect(m.unsaved(junk)).toStrictEqual(EMPTY_LAYER);
    }
    for (const incoming of [undefined, null, 42, 'doc', []]) {
      const sent = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 3)).outbox;
      expect(m.hasUnsaved(m.echoed(sent, incoming, MAPS)), 'a document that is not one shows nothing back').toBe(true);
      expect(m.hasUnsaved(m.echoed(sent, doc({ closing: { flour: 3 } }), undefined)), 'nor does one asked of no maps').toBe(true);
    }
  });

  // ── Added ──────────────────────────────────────────────────────────────────
  // Not in tests/inventory-outbox.test.mjs.

  test('applyOver lays what is held first, then what is in the air, then what is waiting: the newest wins', () => {
    const by = (held: unknown, inFlight: unknown, waiting: unknown) => ({
      pending: (waiting as { pending?: object }).pending ?? {},
      cleared: (waiting as { cleared?: object }).cleared ?? {},
      inFlight, writes: 1, failed: false,
      handed: EMPTY_LAYER, held,
    });
    const layer = (pending: object, cleared: object = {}) => ({ pending, cleared });
    const target = () => doc({ closing: { flour: 1, salt: 1 } });
    // Held 3, in the air 4, waiting 5: five.
    expect(m.applyOver(by(layer({ closing: { flour: 3 } }), layer({ closing: { flour: 4 } }), layer({ closing: { flour: 5 } })),
      target(), MAPS).closing).toStrictEqual({ flour: 5, salt: 1 });
    // Held 3, in the air 4: four.
    expect(m.applyOver(by(layer({ closing: { flour: 3 } }), layer({ closing: { flour: 4 } }), layer({})),
      target(), MAPS).closing).toStrictEqual({ flour: 4, salt: 1 });
    // Held 3, in the air a removal: gone.
    expect(m.applyOver(by(layer({ closing: { flour: 3 } }), layer({}, { closing: { flour: true } }), layer({})),
      target(), MAPS).closing).toStrictEqual({ salt: 1 });
    // Held removal, nothing newer: gone, and the held number does not come back through the others.
    expect(m.applyOver(by(layer({}, { closing: { salt: true } }), null, layer({})),
      target(), MAPS).closing).toStrictEqual({ flour: 1 });
  });

  test('take() counts every write, and answered() never goes below none', () => {
    let box = m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 1);
    box = m.take(box).outbox;
    box = m.take(m.stage(box, 'closing', 'salt', 2)).outbox;
    box = m.take(m.stage(box, 'closing', 'sugar', 3)).outbox;
    expect(box.writes).toBe(3);
    box = m.answered(box, true);
    box = m.answered(box, true);
    expect(box.writes).toBe(1);
    box = m.answered(box, true);
    expect(box.writes).toBe(0);
    expect(m.isSending(box)).toBe(false);
    expect(m.answered(box, true).writes, 'an answer nobody was waiting for changes nothing').toBe(0);
  });

  test('⚠️ a refusal is remembered while other writes are out, then forgotten once it has been acted on', () => {
    const first = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 1));
    const second = m.take(m.stage(first.outbox, 'closing', 'salt', 2));
    const third = m.take(m.stage(second.outbox, 'closing', 'sugar', 3));
    const refusedFirst = m.answered(third.outbox, false);
    expect(refusedFirst.failed).toBe(true);
    const landing = m.answered(m.answered(refusedFirst, true), true);
    expect(m.take(landing).values, 'the two that landed go again with the one that did not')
      .toStrictEqual({ closing: { flour: 1, salt: 2, sugar: 3 } });
    expect(landing.failed, 'and the next round starts clean').toBe(false);
    expect(m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 1)).outbox.failed).toBe(false);
  });

  test('echoed() settles only what the snapshot shows, only in the maps it was asked about, and touches nothing else', () => {
    let box = m.take(m.stage(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 3), 'opening', 'flour', 2)).outbox;
    box = m.stage(box, 'closing', 'salt', 1);
    const seen = m.echoed(box, doc({ closing: { flour: 3 }, opening: { flour: 2 } }), ['closing']);
    expect(m.unsaved(seen).pending, 'opening was not asked about, so it is not yet seen back')
      .toStrictEqual({ opening: { flour: 2 }, closing: { salt: 1 } });
    expect(seen.pending, 'what is waiting is untouched').toStrictEqual({ closing: { salt: 1 } });
    expect(seen.inFlight, 'and so is what is in the air').toStrictEqual(box.inFlight);
    expect(seen.writes).toBe(1);
  });
});
