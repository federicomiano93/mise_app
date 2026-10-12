// Unit tests for the WhatsApp order message the Calculator sends (P15 — the owner cannot read code), run against
// BOTH implementations: the TypeScript port in shared/ and js/calculator-order-text.js, which the live app uses
// today. Ported from tests/calculator-order-text.test.mjs; the two must stay equal until the switch to Mise 2.
//
// The text is what a CLIENT actually receives, so its shape is pinned character for character.
//
// calculator-order-text.ts is a FULL port, so parity.spec.ts pairs it (same names, same function shapes).
//
// PORTED from tests/calculator-order-text.test.mjs: all 13 of its tests.

import { describe, expect, test } from 'vitest';
import * as ported from './calculator-order-text';
import * as legacyJs from '../../js/calculator-order-text.js';

const legacy = legacyJs as unknown as typeof ported;

// Placeholder names on purpose: this repo is public.
const ENTRIES = [
  { client: { name: 'CLIENT A' }, products: [{ id: 'p1', name: 'Buns' }, { id: 'p2', name: 'Rolls' }] },
  { client: { name: 'CLIENT B' }, products: [{ id: 'p1', name: 'Buns' }] },
  { client: { name: 'CLIENT C' }, products: [{ id: 'p3', name: 'Trays' }] },
];

// qtyOf(entryIndex, productId), the shape the order form supplies.
const qtys = (map: Record<string, number>) => (ei: number, pid: unknown): number => map[`${ei}|${String(pid)}`] || 0;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  // ── Which clients end up in the message ──────────────────────────────────────

  test('only clients with something typed become sections', () => {
    const s = m.orderSections(ENTRIES, qtys({ '0|p1': 30, '2|p3': 4 }));
    expect(s.map(x => x.name)).toStrictEqual(['CLIENT A', 'CLIENT C']);
  });

  test('a client with everything at zero is left out entirely', () => {
    // An empty heading in a message reads as "we want nothing from you", which is not what an untouched row means.
    expect(m.orderSections(ENTRIES, qtys({ '1|p1': 0 }))).toStrictEqual([]);
  });

  test('a section keeps its own index, so its rows can still be addressed', () => {
    expect(m.orderSections(ENTRIES, qtys({ '2|p3': 4 }))[0]?.index).toBe(2);
  });

  test('only the rows above zero are listed, in the order the products are shown', () => {
    const s = m.orderSections(ENTRIES, qtys({ '0|p1': 30, '0|p2': 0 }));
    expect(s[0]?.lines).toStrictEqual([{ name: 'Buns', qty: 30 }]);
  });

  test('junk in a quantity is nothing, never NaN in somebody’s message', () => {
    for (const bad of ['abc', null, undefined, Number.NaN, Infinity, {}, -5]) {
      expect(m.orderSections(ENTRIES, () => bad), String(bad)).toStrictEqual([]);
    }
  });

  test('a malformed order produces no sections rather than throwing', () => {
    expect(m.orderSections(null, qtys({}))).toStrictEqual([]);
    expect(m.orderSections([null, {}, { client: null }], qtys({}))).toStrictEqual([]);
    expect(m.orderSections([{ client: { name: 'X' }, products: null }], qtys({}))).toStrictEqual([]);
    expect(m.orderSections(ENTRIES, null)).toStrictEqual([]);
  });

  // ── The message, pinned character for character ──────────────────────────────

  test('several clients: the message is byte-identical to what it has always sent', () => {
    const s = m.orderSections(ENTRIES, qtys({ '0|p1': 30, '0|p2': 10, '2|p3': 4 }));
    expect(m.buildOrderMessage('Morning list', s, true))
      .toBe('*Morning list*\n\n*CLIENT A*\n- Buns: 30\n- Rolls: 10\n\n*CLIENT C*\n- Trays: 4');
  });

  test('one client on its own: its own name as the title, and no repeated heading', () => {
    const s = m.orderSections(ENTRIES, qtys({ '2|p3': 4 }));
    expect(m.buildOrderMessage('CLIENT C', s, false)).toBe('*CLIENT C*\n\n- Trays: 4');
  });

  test('sending everything KEEPS the headings even when one client filled in', () => {
    // ⚠️ This is why `multi` is passed in rather than derived from sections.length. The title is then the
    // LIST's name, so dropping the heading would leave a message that never says who it is for.
    const s = m.orderSections(ENTRIES, qtys({ '2|p3': 4 }));
    expect(m.buildOrderMessage('Morning list', s, true)).toBe('*Morning list*\n\n*CLIENT C*\n- Trays: 4');
  });

  test('a missing title still produces a headed message', () => {
    const s = m.orderSections(ENTRIES, qtys({ '0|p1': 1 }));
    expect(m.buildOrderMessage('', s, false)).toBe('*Order*\n\n- Buns: 1');
    expect(m.buildOrderMessage(null, s, false)).toBe('*Order*\n\n- Buns: 1');
  });

  test('the builder never throws on a malformed section list', () => {
    expect(m.buildOrderMessage('T', null, true)).toBe('*T*\n\n');
    expect(m.buildOrderMessage('T', [{ name: 'X' }], true)).toBe('*T*\n\n*X*\n');
  });

  // ── The link ─────────────────────────────────────────────────────────────────

  test('the link carries the message and names no recipient', () => {
    // No number on purpose: one order often goes to a person rather than to a stored business number, so
    // WhatsApp asks who.
    const url = m.whatsappUrl('*T*\n\n- Buns: 30');
    expect(url).toBe('https://wa.me/?text=' + encodeURIComponent('*T*\n\n- Buns: 30'));
    expect(url.includes('phone=')).toBe(false);
  });

  test('the message survives the round trip through the link', () => {
    const text = '*Morning list*\n\n*CLIENT A*\n- Buns: 30 & Rolls: 10 (100%)';
    expect(decodeURIComponent(m.whatsappUrl(text).split('text=')[1] ?? '')).toBe(text);
  });
});
