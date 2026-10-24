// Unit tests for who may add a supplier or an ingredient (P15 — the owner cannot read code, so these tests are the
// safety net), run against BOTH implementations: the TypeScript port in shared/ and js/records.js, which the live
// app uses today. The Recipe catalogue's «+ Add "…" as an ingredient» door is drawn only where this says yes.

import { describe, expect, test } from 'vitest';
import * as ported from './records';
import * as legacyJs from '../../js/records.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('the «no supplier» id is the one stored on ingredients', () => {
    expect(m.NO_SUPPLIER_ID).toBe('no-supplier');
  });

  test('no venue, no: there is nothing to judge by', () => {
    for (const venue of [null, undefined, '', 'bakery', 0, true]) {
      expect(m.mayEditRecords(venue, true), String(venue)).toBe(false);
    }
  });

  test('a venue with Orders on: owners, managers and employees alike', () => {
    const venue = { sections: {} };
    expect(m.mayEditRecords(venue, true)).toBe(true);
    expect(m.mayEditRecords(venue, false)).toBe(true);
  });

  test('⚠️ Orders off: nobody, because the rules refuse the save', () => {
    const venue = { sections: { orders: false } };
    expect(m.mayEditRecords(venue, true)).toBe(false);
    expect(m.mayEditRecords(venue, false)).toBe(false);
  });

  test('⚠️ the Ingredients & suppliers card hidden from staff: employees no, managers yes', () => {
    const venue = { sections: {}, staffHiddenCards: { suppliers: true } };
    expect(m.mayEditRecords(venue, false)).toBe(false);
    expect(m.mayEditRecords(venue, true)).toBe(true);
  });

  test('only a literal true makes somebody a manager', () => {
    const venue = { sections: {}, staffHiddenCards: { suppliers: true } };
    for (const canManage of ['true', 1, {}, null, undefined]) {
      expect(m.mayEditRecords(venue, canManage), String(canManage)).toBe(false);
    }
  });

  test('another card hidden from staff changes nothing here', () => {
    expect(m.mayEditRecords({ sections: {}, staffHiddenCards: { orders: true } }, false)).toBe(true);
  });
});
