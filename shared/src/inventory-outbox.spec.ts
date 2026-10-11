// Unit tests for the stocktake's outbox: what has been typed on a phone and has not reached Firestore
// yet (P15 — the owner cannot read code, so these tests are the safety net), run against BOTH
// implementations: the TypeScript port in shared/ and js/inventory/inventory-outbox.js, which the live
// app uses today. Ported from tests/inventory-outbox.test.mjs; the two must stay equal until the
// switch to Mise 2. Every one of that file's 21 tests is ported. The module is a FULL port, so
// parity.spec.ts also compares its exports name by name.
//
// ⚠️⚠️ WHY THESE TESTS EXIST AT ALL. This was the hardest code in the feature and the only part of it
// that had no tests, inside the store where it could not be reached without a browser. Everything it
// protects is invisible by nature: a count that goes missing between a storeroom and a database
// looks exactly like a count nobody typed, and the person who typed it has already walked away from
// the shelf. Nothing about using the app can show that it works.
//
// The three cases that cost real numbers, and each has a test named for it:
//   1. a write is in the air and a snapshot arrives without it
//   2. a write fails and the same box has been re-typed since
//   3. a write fails and the same box has been EMPTIED since
//
// The last block ("Added") pins what the original's tests leave out: isSending (no test of the
// original asks for it), that the frozen empty outbox can be built on, that what take() hands to the
// caller is a copy, and that applyOver changes the very document it is given.

import { describe, expect, test } from 'vitest';
import * as ported from './inventory-outbox';
import * as legacyJs from '../../js/inventory/inventory-outbox.js';

const legacy = legacyJs as unknown as typeof ported;

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

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
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

  test('nothing is mutated: the outbox before a change is still itself afterwards', () => {
    const before = m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 1);
    const snapshot = JSON.stringify(before);
    m.stage(before, 'closing', 'flour', 9);
    m.take(before);
    m.restore(before);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(m.EMPTY_OUTBOX, 'and the shared empty one above all is never written into')
      .toStrictEqual({ pending: {}, cleared: {}, inFlight: null });
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

  test('a second save while the first is unanswered carries both', () => {
    const first = m.take(m.stage(m.EMPTY_OUTBOX, 'closing', 'flour', 1));
    const second = m.take(m.stage(first.outbox, 'closing', 'salt', 2));
    expect(second.values, 'nothing waiting may be dropped because an earlier write is still out')
      .toStrictEqual({ closing: { flour: 1, salt: 2 } });
    const incoming = m.applyOver(second.outbox, doc(), MAPS);
    expect(incoming.closing).toStrictEqual({ flour: 1, salt: 2 });
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

  test('a write is in the air from take() until it is confirmed or fails — and only one at a time', () => {
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
    expect(m.restore(m.EMPTY_OUTBOX)).toStrictEqual({ pending: {}, cleared: {}, inFlight: null });
    expect(m.confirm(m.EMPTY_OUTBOX)).toStrictEqual({ pending: {}, cleared: {}, inFlight: null });
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
