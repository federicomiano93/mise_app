// Unit tests for the order list one person sends to another (P15), run against BOTH implementations: the TypeScript
// port in shared/ and js/orders/order-request-model.js, which the live app uses today. Ported from
// tests/order-request-model.test.mjs.
//
// order-request-model.ts is a PARTIAL port (only `remainingIds`), so parity.spec.ts does not pair it; the last describe
// compares what it ports with the js/ file itself (names, arity).
//
// PORTED: 'what is left is what Finish would tick' — the only test of the original that names remainingIds. Added:
// the odd documents (no list, no quantities, a done map that is not a map) that remainingIds must never throw on.
//
// NOT PORTED: everything else in tests/order-request-model.test.mjs (senderName, buildOrderRequest, isRequestDone,
// waitingRequests, groupRequest, supplierIdsOf, liveDifference, splitRequestsByAge): those functions are not in shared/.

import { describe, expect, test } from 'vitest';
import * as ported from './order-request-model';
import * as legacyJs from '../../js/orders/order-request-model.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('what is left is what Finish would tick', () => {
    const req = { quantities: { a: 1, b: 2, c: 3 }, done: { b: true } };
    expect(m.remainingIds(req).sort()).toStrictEqual(['a', 'c']);
    expect(m.remainingIds({ quantities: { a: 1 }, done: { a: true } })).toStrictEqual([]);
  });

  test('only a line ticked with exactly true is done', () => {
    expect(m.remainingIds({ quantities: { a: 1, b: 1, c: 1 }, done: { a: 1, b: 'true', c: true } })).toStrictEqual(['a', 'b']);
  });

  test('a missing or broken list has nothing left, and never throws', () => {
    for (const request of [undefined, null, {}, { quantities: null }, { quantities: {}, done: null }, 0, '']) {
      expect(m.remainingIds(request), String(request)).toStrictEqual([]);
    }
    expect(m.remainingIds({ quantities: { a: 1 } })).toStrictEqual(['a']);
  });
});

describe('the port against the original', () => {
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;

  test('exports exactly remainingIds, and the original has it', () => {
    expect(Object.keys(port)).toStrictEqual(['remainingIds']);
    expect(typeof original.remainingIds).toBe('function');
  });

  test('it has the same name and the same number of required parameters', () => {
    const mine = port.remainingIds as (...args: unknown[]) => unknown;
    const theirs = original.remainingIds as (...args: unknown[]) => unknown;
    expect(mine.name).toBe(theirs.name);
    expect(mine.length).toBe(theirs.length);
  });
});
