// Tests for «Order to X inviato: è partito?» (P15), ported from tests/awaiting-sent.test.mjs of `main` (v1.145.0).
//
// NOT PAIRED in parity.spec.ts YET: the original, js/orders/awaiting-sent.js, exists only on `main` (PRs #551 and #554),
// not on this branch, so there is nothing to import it from. When `main` is merged into the Mise 2 branch, pair it: add
// it to PAIRS in parity.spec.ts and turn the describe below into a describe.each over this port and the js/ file.
//
// PORTED: every test that calls this module's functions. The original's tests ran «Sì» against js/orders/draft.js with
// the data layer stubbed; here the same server behaviour is a small in-memory fake whose claim reads, decides and deletes
// in one step, as the Firestore transaction does.
//
// NOT PORTED (they read source text or other modules, none of which exists here): the claim/restore transaction shape
// of firebase-orders.js (2 tests), draft.js `setAwaitingSent` / `clearSentLines` / `watchDraft` (3), the wiring tests that
// read orders-main.js, orders.html or tablet-layout.js (11), the focus test of the banner, and the two dictionary tests
// (the app's own words are pinned by the i18n spec). The wiring ones are rebuilt against the React screens in the
// slices that build them.

import { describe, expect, test } from 'vitest';
import {
  answerAwaiting, awaitingEntry, awaitingList, claimDecision, draftQuantities, isAwaiting, linesToClear,
  putQuestionBack, restoreDecision, shouldAskBeforeRecording, supplierKeepsLines,
} from './awaiting-sent';

declare function structuredClone<V>(value: V): V;

const AT = '2026-11-14T10:42:00.000Z';
const SENT = { at: AT, date: '2026-11-14', quantities: { flour: 2, yeast: 1 }, units: { flour: 'cartone' } };

describe('awaiting-sent', () => {
  // ── the value written ──────────────────────────────────────────────────────────

  test('the entry keeps only the lines that went, with their unit, the day and the time', () => {
    expect(awaitingEntry({ at: AT, date: '2026-11-14',
      quantities: { flour: '2', salt: 0, yeast: 1, junk: 'x' }, units: { flour: ' cartone ', salt: 'kg' } }))
      .toStrictEqual({ at: AT, date: '2026-11-14', quantities: { flour: 2, yeast: 1 }, units: { flour: 'cartone' } });
    expect(awaitingEntry({ at: AT, quantities: { flour: 0 } })).toBeNull();
    expect(awaitingEntry({ at: AT, date: 'yesterday', quantities: { a: 1 } })?.date).toBe('');
  });

  test('the header send stores the draft as the message read it, in the unit every row shows', () => {
    const ingredients = [
      { id: 'flour', unit: 'sacco', packUnit: 'busta' },
      { id: 'yeast', unit: 'kg' },
      { id: 'salt', unit: 'kg' },
    ];
    const entries = { flour: { qty: 2, unit: 'busta' }, yeast: { qty: 1 }, salt: { qty: 0, stock: 4 } };
    expect(draftQuantities(ingredients, entries))
      .toStrictEqual({ quantities: { flour: 2, yeast: 1 }, units: { flour: 'busta', yeast: 'kg' } });
  });

  test('only a well-formed question is shown, one per supplier the venue still has, oldest first', () => {
    const suppliers = [{ id: 'A' }, { id: 'B' }];
    const list = awaitingList({
      B: { ...SENT, at: '2026-11-14T09:00:00.000Z' },
      A: SENT,
      gone: SENT,                               // a supplier deleted since
      broken: { at: AT },                       // no quantities
    }, suppliers);
    expect(list.map(e => e.supplier.id)).toStrictEqual(['B', 'A']);
    expect(isAwaiting({ at: AT, quantities: { a: 0 } })).toBe(false);
    expect(isAwaiting(null)).toBe(false);
  });

  // ── «Sì» clears only what went ─────────────────────────────────────────────────

  test('⚠️ «Sì» clears the lines that went and still read so — typing done since stays', () => {
    const cards: Record<string, { id: string; unit: string; packUnit?: string }> = {
      flour: { id: 'flour', unit: 'sacco', packUnit: 'cartone' }, yeast: { id: 'yeast', unit: 'kg' }, salt: { id: 'salt', unit: 'kg' },
    };
    const entries = {
      flour: { qty: 2, unit: 'cartone' },      // as sent → cleared
      yeast: { qty: 3 },                        // changed since (1 → 3) → stays
      salt: { qty: 5 },                         // typed after the send → stays
    };
    const cleared = linesToClear(entries, id => cards[id], SENT);
    expect(cleared).toStrictEqual(['flour']);
    expect(supplierKeepsLines(Object.values(cards), entries, cleared)).toBe(true);
  });

  test('a line whose UNIT changed since is not cleared; a line with no unit compares with the card', () => {
    const cards: Record<string, { id: string; unit: string; packUnit?: string }> = {
      flour: { id: 'flour', unit: 'sacco', packUnit: 'cartone' }, yeast: { id: 'yeast', unit: 'kg' },
    };
    expect(linesToClear({ flour: { qty: 2, unit: 'sacco' }, yeast: { qty: 1, unit: 'kg' } } as never, id => cards[id], SENT))
      .toStrictEqual(['yeast']);
    expect(supplierKeepsLines(Object.values(cards), { flour: { qty: 2 } }, ['flour'])).toBe(false);
  });

  test('⚠️ «Invialo ora» with numbers corrected on the review screen: «Sì» clears what the DRAFT said, no phantom order', () => {
    const entry = awaitingEntry({ at: AT, date: '2026-11-14', quantities: { flour: 3 }, units: {},
      draft: { quantities: { flour: 5, salt: 2 }, units: {} } });
    expect(entry?.quantities).toStrictEqual({ flour: 3 });
    expect(entry?.draft).toStrictEqual({ quantities: { flour: 5, salt: 2 }, units: {} });
    const cards: Record<string, { id: string; unit: string }> = {
      flour: { id: 'flour', unit: 'kg' }, salt: { id: 'salt', unit: 'kg' }, milk: { id: 'milk', unit: 'l' },
    };
    const entries = { flour: { qty: 5 }, salt: { qty: 2 }, milk: { qty: 1 } };   // milk typed after the send
    expect(linesToClear(entries, id => cards[id], entry)).toStrictEqual(['flour', 'salt']);
    expect(awaitingEntry({ at: AT, quantities: { a: 1 }, draft: { quantities: { a: 1 } } })?.draft).toBeUndefined();
  });

  // ── answering, against a fake server with the claim of a transaction ───────────

  type Entry = typeof SENT;
  let server: { awaitingSent: Record<string, Entry> };
  const serverHas = (id: string) => Boolean(server.awaitingSent[id]);

  function device(record: (id: string, entry: Entry) => Promise<boolean> = async () => true) {
    const log = { claims: 0, records: [] as { id: string; entry: Entry }[], restored: [] as string[], dropped: [] as string[], keysTouched: [] as string[][] };
    const deps = {
      busy: new Set<string>(),
      // One step: read, decide, delete — as the transaction does, so two devices cannot both win.
      claim: async (id: string, at: string) => {
        log.claims++;
        await Promise.resolve();
        if (!claimDecision(server, id, at)) return false;
        delete server.awaitingSent[id];
        log.keysTouched.push([`awaitingSent.${id}`]);
        return true;
      },
      record: async (id: string, entry: Entry) => { log.records.push({ id, entry }); return record(id, entry); },
      restore: async (id: string, entry: Entry) => { log.restored.push(id); server.awaitingSent[id] = entry; },
      drop: async (id: string) => { log.dropped.push(id); delete server.awaitingSent[id]; log.keysTouched.push([`awaitingSent.${id}`]); },
    };
    return { deps, log };
  }
  const fresh = (over: Record<string, Entry> = {}) => { server = { awaitingSent: { S1: structuredClone(SENT), ...over } }; };

  test('⚠️ «Sì» records ONCE, with the STORED quantities, then the key is gone', async () => {
    fresh();
    const phone = device();
    expect(await answerAwaiting('yes', 'S1', SENT, phone.deps)).toBe('recorded');
    expect(phone.log.records).toHaveLength(1);
    expect(phone.log.records[0]?.entry.quantities).toStrictEqual({ flour: 2, yeast: 1 });
    expect(phone.log.records[0]?.entry.units).toStrictEqual({ flour: 'cartone' });
    expect(serverHas('S1')).toBe(false);
    expect(phone.log.keysTouched).toStrictEqual([['awaitingSent.S1']]);
  });

  test('⚠️⚠️ «Sì» on two devices at the same moment records once: the second hears it was answered', async () => {
    fresh();
    const tablet = device();
    const phone = device();
    const both = await Promise.all([
      answerAwaiting('yes', 'S1', SENT, tablet.deps),
      answerAwaiting('yes', 'S1', SENT, phone.deps),
    ]);
    expect([...both].sort()).toStrictEqual(['elsewhere', 'recorded']);
    expect(tablet.log.records.length + phone.log.records.length).toBe(1);
  });

  test('a double tap on ONE device: the second does nothing while the first is answering', async () => {
    fresh();
    const phone = device();
    const [first, second] = await Promise.all([
      answerAwaiting('yes', 'S1', SENT, phone.deps),
      answerAwaiting('yes', 'S1', SENT, phone.deps),
    ]);
    expect(first).toBe('recorded');
    expect(second).toBe('busy');
    expect(phone.log.claims).toBe(1);
  });

  test('a newer send for the same supplier is not claimed by an answer to the older one', async () => {
    fresh({ S1: { ...structuredClone(SENT), at: '2026-11-14T11:00:00.000Z' } });
    const phone = device();
    expect(await answerAwaiting('yes', 'S1', SENT, phone.deps)).toBe('elsewhere');
    expect(phone.log.records).toHaveLength(0);
    expect(serverHas('S1')).toBe(true);
  });

  test('⚠️ «No» only removes the key: nothing claimed, nothing recorded', async () => {
    fresh();
    const phone = device();
    expect(await answerAwaiting('no', 'S1', SENT, phone.deps)).toBe('dropped');
    expect(phone.log.claims).toBe(0);
    expect(phone.log.records).toHaveLength(0);
    expect(phone.log.keysTouched).toStrictEqual([['awaitingSent.S1']]);
  });

  test('a recording that fails puts the question back, so the order is still asked about', async () => {
    fresh();
    const phone = device(async () => false);
    expect(await answerAwaiting('yes', 'S1', SENT, phone.deps)).toBe('failed');
    expect(phone.log.restored).toStrictEqual(['S1']);
    expect(serverHas('S1')).toBe(true);
  });

  test('a recording that THROWS is a failed recording too', async () => {
    fresh();
    const phone = device(async () => { throw new Error('boom'); });
    expect(await answerAwaiting('yes', 'S1', SENT, phone.deps)).toBe('failed');
    expect(phone.log.restored).toStrictEqual(['S1']);
  });

  test('a claim that cannot be made (no network) records nothing and leaves the question', async () => {
    fresh();
    const phone = device();
    phone.deps.claim = async () => { throw new Error('unavailable'); };
    expect(await answerAwaiting('yes', 'S1', SENT, phone.deps)).toBe('claimFailed');
    expect(phone.log.records).toHaveLength(0);
  });

  test('a question this device could not share is recorded straight away, once', async () => {
    fresh();
    const phone = device();
    expect(await answerAwaiting('yes', 'S1', SENT, phone.deps, { local: true })).toBe('recorded');
    expect(phone.log.claims).toBe(0);
    expect(phone.log.records).toHaveLength(1);
  });

  // ── a failed recording must not overwrite a NEWER send ─────────────────────────

  test('⚠️ the question is put back only when no question stands for that supplier now', () => {
    const newer = { ...SENT, at: '2026-11-14T11:30:00.000Z' };
    expect(restoreDecision({ awaitingSent: { S1: newer } }, 'S1')).toBe(false);
    expect(restoreDecision({ entries: { flour: { qty: 1 } }, awaitingSent: { S2: { at: AT } } }, 'S1')).toBe(true);
    expect(restoreDecision(null, 'S1')).toBe(true);
    expect(restoreDecision({ awaitingSent: { S1: SENT } }, 'S1')).toBe(false);
  });

  test('the claim is for the question that was asked: same key, same `at`', () => {
    expect(claimDecision({ awaitingSent: { S1: SENT } }, 'S1', AT)).toBe(true);
    expect(claimDecision({ awaitingSent: { S1: SENT } }, 'S1', '2026-11-14T11:00:00.000Z')).toBe(false);
    expect(claimDecision({ awaitingSent: {} }, 'S1', AT)).toBe(false);
    expect(claimDecision(null, 'S1', AT)).toBe(false);
  });

  test('⚠️ a restore that rejects (offline: a transaction is never queued) keeps the question on THIS device', async () => {
    const kept: unknown[] = [];
    const offline = async () => { throw new Error('unavailable'); };
    expect(await putQuestionBack('S1', SENT, { write: offline, keepHere: (id, e) => kept.push([id, e]) })).toBe('kept');
    expect(kept).toStrictEqual([['S1', SENT]]);
    const wrote: string[] = [];
    expect(await putQuestionBack('S1', SENT, { write: async id => { wrote.push(id); return true; }, keepHere: () => kept.push('no') }))
      .toBe('restored');
    expect(wrote).toStrictEqual(['S1']);
    expect(kept).toHaveLength(1);
  });

  // ── «Sì» when History already holds the order ──────────────────────────────────

  test('⚠️ «Sì» asks ONLY when History already holds this order at least as large; otherwise it records', () => {
    const stored = { quantities: { flour: 2, yeast: 1 }, units: {} };
    expect(shouldAskBeforeRecording(stored, null)).toBe(false);
    expect(shouldAskBeforeRecording(stored, undefined)).toBe(false);
    expect(shouldAskBeforeRecording(stored, { quantities: { flour: 2, yeast: 1 } })).toBe(true);
    expect(shouldAskBeforeRecording(stored, { quantities: { flour: 5, yeast: 1, salt: 3 } })).toBe(true);
    expect(shouldAskBeforeRecording(stored, { quantities: { flour: 2 } })).toBe(false);
    expect(shouldAskBeforeRecording(stored, { quantities: { flour: 1, yeast: 1 } })).toBe(false);
    expect(shouldAskBeforeRecording(stored, { quantities: {} })).toBe(false);
    expect(shouldAskBeforeRecording({ quantities: {} }, { quantities: { flour: 2 } })).toBe(false);
    expect(shouldAskBeforeRecording(null, { quantities: { flour: 2 } })).toBe(false);
  });

  test('a changed or cleared draft is NO evidence: the rule takes the entry and the record only', () => {
    expect(shouldAskBeforeRecording.length).toBe(2);
    expect(shouldAskBeforeRecording({ quantities: { flour: 2 } }, null)).toBe(false);
  });
});
