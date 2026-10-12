// Unit tests for «which unit does this order line mean?» (P15 — the owner cannot read code, so
// these tests are the safety net), run against BOTH implementations: the TypeScript port in shared/
// and js/order-unit.js, which the live app uses today. Ported from tests/order-unit.test.mjs; the
// two must stay equal until the switch to Mise 2. Every one of that file's 11 tests is ported (none
// needs the dictionary or the DOM). The module is a FULL port, so parity.spec.ts also compares its
// exports name by name.
//
// The original file does not test the one conversion there is (inPackages and addableInPackages: its
// tests live with the order draft). The last block here ("Added") pins it, from the example the
// owner gave on 3 Oct 2026.

import { describe, expect, test } from 'vitest';
import * as ported from './order-unit';
import * as legacyJs from '../../js/order-unit.js';

const legacy = legacyJs as unknown as typeof ported;

const CASE = { unit: 'cartone', packUnit: 'busta' };
const PLAIN = { unit: 'cartone' };

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('cleanUnit trims, caps at 100 and answers "" for anything that is not a string', () => {
    expect(m.cleanUnit('  busta ')).toBe('busta');
    expect(m.cleanUnit('x'.repeat(150)).length).toBe(100);
    for (const v of [null, undefined, 4, {}, [], true]) expect(m.cleanUnit(v)).toBe('');
  });

  test('sameUnit ignores case and surrounding or repeated spaces', () => {
    expect(m.sameUnit('Busta', 'busta')).toBe(true);
    expect(m.sameUnit('  busta ', 'busta')).toBe(true);
    expect(m.sameUnit('mezza  busta', 'MEZZA busta')).toBe(true);
    expect(m.sameUnit('busta', 'cartone')).toBe(false);
    expect(m.sameUnit('', null), 'two nothings are the same nothing').toBe(true);
    expect(m.sameUnit('busta', '')).toBe(false);
  });

  test('a choice exists only when the card names both a unit and a different package', () => {
    expect(m.hasUnitChoice(CASE)).toBe(true);
    expect(m.hasUnitChoice(PLAIN)).toBe(false);
    expect(m.hasUnitChoice({ packUnit: 'busta' }), 'a package with no unit has nothing to choose').toBe(false);
    expect(m.hasUnitChoice({ unit: 'busta', packUnit: ' Busta ' }), 'the same word twice').toBe(false);
    expect(m.hasUnitChoice(null)).toBe(false);
    expect(m.hasUnitChoice({ unit: 5, packUnit: {} })).toBe(false);
  });

  test('unitChoices offers the card unit first, then the package', () => {
    expect(m.unitChoices(CASE)).toStrictEqual(['cartone', 'busta']);
    expect(m.unitChoices(PLAIN)).toStrictEqual(['cartone']);
    expect(m.unitChoices({})).toStrictEqual([]);
    expect(m.unitChoices(null)).toStrictEqual([]);
  });

  test('a stored choice the card no longer offers is appended, never dropped', () => {
    expect(m.unitChoices(CASE, 'Busta'), 'a known one is not doubled').toStrictEqual(['cartone', 'busta']);
    expect(m.unitChoices(CASE, 'sacco')).toStrictEqual(['cartone', 'busta', 'sacco']);
    expect(m.unitChoices(PLAIN, 'busta')).toStrictEqual(['cartone', 'busta']);
    expect(m.unitChoices({}, 'busta')).toStrictEqual(['busta']);
    expect(m.unitChoices(CASE, '   ')).toStrictEqual(['cartone', 'busta']);
  });

  test('entryUnit: the entry own unit, else the card', () => {
    expect(m.entryUnit({ unit: 'busta' }, CASE)).toBe('busta');
    expect(m.entryUnit({ qty: 2 }, CASE)).toBe('cartone');
    expect(m.entryUnit(undefined, CASE)).toBe('cartone');
    expect(m.entryUnit({}, undefined)).toBe('');
  });

  test('isDefaultUnit: no unit, or the card unit in any spelling, is the default', () => {
    expect(m.isDefaultUnit({ qty: 1 }, CASE)).toBe(true);
    expect(m.isDefaultUnit({ unit: '' }, CASE)).toBe(true);
    expect(m.isDefaultUnit({ unit: 'CARTONE' }, CASE)).toBe(true);
    expect(m.isDefaultUnit(undefined, CASE)).toBe(true);
    expect(m.isDefaultUnit({ unit: 'busta' }, CASE)).toBe(false);
  });

  test('lineUnit: shown for a card with a choice (default too) and for a non-default entry only', () => {
    expect(m.lineUnit(CASE, { qty: 1 })).toBe('cartone');
    expect(m.lineUnit(CASE, { unit: 'busta' })).toBe('busta');
    expect(m.lineUnit(PLAIN, { qty: 1 }), 'an ordinary line shows no unit').toBe('');
    expect(m.lineUnit(PLAIN, { unit: 'cartone' })).toBe('');
    expect(m.lineUnit(PLAIN, { unit: 'busta' }), 'a stale non-default unit is kept').toBe('busta');
    expect(m.lineUnit({}, {})).toBe('');
  });

  test('recordUnit: what the record froze, else the card unit', () => {
    expect(m.recordUnit({ units: { a: 'busta' } }, 'a', CASE)).toBe('busta');
    expect(m.recordUnit({ units: {} }, 'a', CASE)).toBe('cartone');
    expect(m.recordUnit({}, 'a', CASE)).toBe('cartone');
    expect(m.recordUnit(null, 'a', null)).toBe('');
  });

  test('qtyWithUnit writes «2 × busta», and only the number without a unit', () => {
    expect(m.qtyWithUnit(2, 'busta')).toBe('2 × busta');
    expect(m.qtyWithUnit(2, ' busta ')).toBe('2 × busta');
    expect(m.qtyWithUnit(2, '')).toBe('2');
    expect(m.qtyWithUnit(0, undefined)).toBe('0');
  });

  test('storedUnitFor: the draft keeps only a NON-default choice', () => {
    expect(m.storedUnitFor('busta', CASE)).toBe('busta');
    expect(m.storedUnitFor('Cartone', CASE)).toBe('');
    expect(m.storedUnitFor('', CASE)).toBe('');
    expect(m.storedUnitFor(null, CASE)).toBe('');
    expect(m.storedUnitFor(' busta ', CASE)).toBe('busta');
  });

  // ── Added ──────────────────────────────────────────────────────────────────
  // Not in tests/order-unit.test.mjs. The owner's own example, 3 Oct 2026: «se ordino un cartone che
  // ha 4 buste e nel pomeriggio ordino 2 buste considera un totale di 6 buste».

  const CARTON = { unit: 'cartone', packUnit: 'busta', packCount: 4 };

  test('a carton of 4 and 2 more buste make 6 buste', () => {
    expect(m.inPackages(1, 'cartone', CARTON)).toBe(4);
    expect(m.inPackages(2, 'busta', CARTON)).toBe(2);
    expect((m.inPackages(1, 'cartone', CARTON) ?? NaN) + (m.inPackages(2, 'busta', CARTON) ?? NaN)).toBe(6);
    expect(m.inPackages(3, ' Cartone ', CARTON), 'spelling and spaces do not matter').toBe(12);
  });

  test('nothing is guessed: no packCount, a unit that is neither, or no choice at all answers null', () => {
    expect(m.inPackages(1, 'cartone', CASE)).toBe(null);
    expect(m.inPackages(1, 'sacco', CARTON)).toBe(null);
    expect(m.inPackages(1, 'cartone', PLAIN)).toBe(null);
    for (const packCount of [0, -1, 2.5, '4', null, undefined, NaN]) {
      expect(m.inPackages(1, 'cartone', { ...CASE, packCount }), `packCount=${String(packCount)}`).toBe(null);
    }
  });

  test('two units can be added up only when both are known in packages', () => {
    expect(m.addableInPackages('cartone', 'busta', CARTON)).toBe(true);
    expect(m.addableInPackages('cartone', 'sacco', CARTON)).toBe(false);
    expect(m.addableInPackages('cartone', 'busta', CASE)).toBe(false);
  });
});
