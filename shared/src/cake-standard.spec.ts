// Unit tests for the standard cake per diameter (the cakes rework, step 4, 22 Nov 2026). NEW IN MISE 2: no original in js/. Fake data
// only (P15).
//
// Federico's rules under test (approved on the mockup, 21 Nov 2026): one row per diameter; an empty box is filled in from the NEAREST
// diameter he typed in that column — base, soak and filling by area, the coating by the surface it covers, the decoration along the
// edge — rounded to 10 g; a typed figure stays as typed; a cake takes the row of its own diameter.

import { describe, expect, test } from 'vitest';
import rules from '../../firestore.rules?raw';
import { REFERENCE_KEYS, normalizeReference, ruleGrams } from './cake-model';
import type { ReferenceGrams } from './cake-model';
import {
  DEFAULT_DIAMETERS, LEGACY_DIAMETER_CM, MAX_STANDARD_ROWS, STANDARD_ROW_KEYS, emptyRow, everyColumnTyped, normalizeStandard,
  referenceFor, refIsCurrent, sameStandard, scaleFactor, standardCell, standardFromReference, tidyRows, toStandardDocument,
} from './cake-standard';
import type { CakeStandard, StandardRow } from './cake-standard';

const REF: ReferenceGrams = { diameterCm: 22, discs: 3, discHeightCm: 2, baseG: 220, soakG: 70, fillingG: 300, coatingG: 350, decorationG: 120 };
const ROW22: StandardRow = { diameterCm: 22, baseG: 220, soakG: 70, fillingG: 300, coatingG: 350, decorationG: 120 };

function table(rows: StandardRow[]): CakeStandard {
  return { discs: 3, discHeightCm: 2, rows };
}

describe('standardCell', () => {
  const standard = table([emptyRow(16), emptyRow(20), ROW22, emptyRow(26)]);

  test('a typed box is its own figure, black', () => {
    expect(standardCell(standard, 'baseG', 22)).toEqual({ grams: 220, typed: true, fromCm: 22 });
  });

  test('base, soak and filling grow by area, rounded to 10 g', () => {
    // 220 × (26/22)² = 307.3 → 310
    expect(standardCell(standard, 'baseG', 26)).toEqual({ grams: 310, typed: false, fromCm: 22 });
    // 70 × (16/22)² = 37.0 → 40
    expect(standardCell(standard, 'soakG', 16)?.grams).toBe(40);
    // 300 × (20/22)² = 247.9 → 250
    expect(standardCell(standard, 'fillingG', 20)?.grams).toBe(250);
  });

  test('the coating by top + side: S(d) = π(d/2)² + π·d·(discs × disc height)', () => {
    const S = (d: number) => Math.PI * (d / 2) ** 2 + Math.PI * d * 6;
    expect(standardCell(standard, 'coatingG', 26)?.grams).toBe(Math.round((350 * S(26)) / S(22) / 10) * 10);
    expect(scaleFactor('coatingG', 22, 26, 3, 2)).toBeCloseTo(S(26) / S(22), 10);
  });

  test('the decoration along the edge', () => {
    // 120 × 26/22 = 141.8 → 140
    expect(standardCell(standard, 'decorationG', 26)?.grams).toBe(140);
  });

  test('the NEAREST typed diameter of that column wins, column by column', () => {
    const two = table([{ ...emptyRow(16), baseG: 100 }, emptyRow(20), ROW22, { ...emptyRow(28), soakG: 200 }]);
    // base at 18: 16 is 2 away, 22 is 4 away → from 16. 100 × (18/16)² = 126.6 → 130
    expect(standardCell(two, 'baseG', 18)).toEqual({ grams: 130, typed: false, fromCm: 16 });
    // soak at 26: 28 is 2 away, 22 is 4 away → from 28
    expect(standardCell(two, 'soakG', 26)?.fromCm).toBe(28);
  });

  test('on a tie the smaller diameter wins (the mockup\'s order)', () => {
    const tie = table([{ ...emptyRow(20), baseG: 100 }, { ...emptyRow(24), baseG: 200 }]);
    expect(standardCell(tie, 'baseG', 22)?.fromCm).toBe(20);
  });

  test('a column with nothing typed fills nothing', () => {
    expect(standardCell(table([emptyRow(22)]), 'baseG', 22)).toBeNull();
  });

  test('a typed 0 is a real figure, and scales to 0', () => {
    const zero = table([{ ...ROW22, decorationG: 0 }]);
    expect(standardCell(zero, 'decorationG', 22)).toEqual({ grams: 0, typed: true, fromCm: 22 });
    expect(standardCell(zero, 'decorationG', 28)?.grams).toBe(0);
  });

  test('never above the rules\' 100,000 g, never NaN', () => {
    const big = table([{ ...ROW22, coatingG: 100000 }]);
    expect(standardCell(big, 'coatingG', 60)?.grams).toBe(100000);
    for (const d of [10, 60]) {
      for (const column of ['baseG', 'soakG', 'fillingG', 'coatingG', 'decorationG'] as const) {
        expect(Number.isFinite(standardCell(standard, column, d)?.grams)).toBe(true);
      }
    }
  });
});

describe('referenceFor — the single reference a cake takes', () => {
  const standard = table([emptyRow(16), ROW22, emptyRow(26)]);

  test('at its own diameter, the row\'s figures (typed or filled in)', () => {
    expect(referenceFor(standard, 22)).toEqual({ ...REF });
    const at26 = referenceFor(standard, 26) as ReferenceGrams;
    expect(at26.diameterCm).toBe(26);
    // A cake copies the scaled figure to the WHOLE gram (the table shows 10 g): 220 × (26/22)² = 307.2, 120 × 26/22 = 141.8.
    expect(at26.baseG).toBe(307);
    expect(at26.decorationG).toBe(142);
    expect(at26.discs).toBe(3);
    expect(at26.discHeightCm).toBe(2);
  });

  test('a cake of that diameter then gets exactly the row\'s figures through ruleGrams', () => {
    const at26 = referenceFor(standard, 26);
    expect(ruleGrams(at26, 'base', 26, 3)).toBe(307 * 3);
    expect(ruleGrams(at26, 'decoration', 26, 3)).toBe(142);
  });

  test('a small figure never collapses to 0 g: 20 g of soak at 22 cm is 4 g at 10 cm, while the table shows 0', () => {
    const small = table([{ ...ROW22, soakG: 20 }]);
    expect(referenceFor(small, 10)?.soakG).toBe(4);
    expect(standardCell(small, 'soakG', 10)?.grams).toBe(0);
  });

  test('a typed row is exact, whole or not', () => {
    expect(referenceFor(table([{ ...ROW22, baseG: 221.5 }]), 22)?.baseG).toBe(221.5);
  });

  test('a diameter between rows, or not whole, is filled in the same way', () => {
    expect(referenceFor(standard, 23.5)?.diameterCm).toBe(23.5);
  });

  test('outside 10–60 cm it is clamped; is always a valid reference', () => {
    expect(referenceFor(standard, 4)?.diameterCm).toBe(10);
    expect(normalizeReference(referenceFor(standard, 99))).not.toBeNull();
  });

  test('null with no standard or a column with nothing typed', () => {
    expect(referenceFor(null, 22)).toBeNull();
    expect(referenceFor(table([{ ...ROW22, soakG: null }]), 22)).toBeNull();
  });
});

describe('refIsCurrent — a cake’s reference against the table at the reference’s own diameter', () => {
  const legacy = normalizeStandard({ bakery: 'x', grams: REF, updatedAt: '' });

  test('the old single reference (22 cm) is current against the legacy table, whatever the cake’s own diameter', () => {
    expect(refIsCurrent(REF, legacy)).toBe(true);
  });

  test('not current once the table’s row at the reference’s diameter changes', () => {
    const changed = normalizeStandard({ bakery: 'x', grams: { ...REF, baseG: 250 }, updatedAt: '' });
    expect(refIsCurrent(REF, changed)).toBe(false);
  });

  test('a reference taken at another diameter is current while it matches the table there', () => {
    expect(refIsCurrent(referenceFor(legacy, 20), legacy)).toBe(true);
  });

  test('false with no reference or no standard', () => {
    expect(refIsCurrent(null, legacy)).toBe(false);
    expect(refIsCurrent(REF, null)).toBe(false);
  });
});

describe('normalizeStandard — reading cake-settings/reference', () => {
  test('a document written before the table: its one cake among the default diameters', () => {
    const standard = normalizeStandard({ bakery: 'x', grams: REF, updatedAt: '' }) as CakeStandard;
    expect(standard.rows.map(r => r.diameterCm)).toEqual([...DEFAULT_DIAMETERS]);
    expect(standard.rows.find(r => r.diameterCm === 22)).toEqual(ROW22);
    expect(standard.rows.filter(r => r.baseG !== null)).toHaveLength(1);
    expect(standard.discs).toBe(3);
  });

  test('an old reference at a diameter outside the defaults gets a row of its own (rounded to whole cm)', () => {
    const standard = normalizeStandard({ grams: { ...REF, diameterCm: 30.4 } }) as CakeStandard;
    expect(standard.rows.map(r => r.diameterCm)).toEqual([...DEFAULT_DIAMETERS, 30]);
    expect(standard.rows.at(-1)?.baseG).toBe(220);
  });

  test('the table, tidied: ascending, a diameter once, junk rows and junk figures dropped', () => {
    const standard = normalizeStandard({
      grams: REF,
      rows: [{ ...ROW22, diameterCm: 26 }, ROW22, { ...ROW22, baseG: 1 }, { diameterCm: 9 }, 'x', { ...emptyRow(18), soakG: -4, fillingG: '3' }],
    }) as CakeStandard;
    expect(standard.rows.map(r => r.diameterCm)).toEqual([18, 22, 26]);
    expect(standard.rows[1]?.baseG).toBe(220);
    expect(standard.rows[0]).toEqual(emptyRow(18));
  });

  test('rows that leave a column with nothing typed are ignored: the old reference is read', () => {
    const standard = normalizeStandard({ grams: REF, rows: [{ ...ROW22, diameterCm: 26, coatingG: null }] }) as CakeStandard;
    expect(standard.rows.find(r => r.diameterCm === 22)).toEqual(ROW22);
  });

  test('no valid grams = no standard (the rules require them)', () => {
    expect(normalizeStandard(null)).toBeNull();
    expect(normalizeStandard({ rows: [ROW22] })).toBeNull();
    expect(normalizeStandard({ grams: { ...REF, discs: 0 }, rows: [ROW22] })).toBeNull();
  });

  test('at most MAX_STANDARD_ROWS rows', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...ROW22, diameterCm: 10 + i }));
    expect(normalizeStandard({ grams: REF, rows: many })?.rows).toHaveLength(MAX_STANDARD_ROWS);
  });
});

describe('toStandardDocument — what is written', () => {
  test('whole: bakery, the table, and the old reference at 22 cm for phones not yet updated', () => {
    const standard = table([emptyRow(16), { ...ROW22, diameterCm: 24 }]);
    const doc = toStandardDocument(standard, 'loc', '2026-11-22T00:00:00.000Z');
    expect(doc).not.toBeNull();
    expect(Object.keys(doc as object).sort()).toEqual(['bakery', 'grams', 'rows', 'updatedAt']);
    expect(doc?.grams).toEqual(referenceFor(standard, LEGACY_DIAMETER_CM));
    expect(doc?.grams.diameterCm).toBe(22);
    expect(doc?.rows.map(r => Object.keys(r))).toEqual([[...STANDARD_ROW_KEYS], [...STANDARD_ROW_KEYS]]);
  });

  test('refused (null) while a column has nothing typed, the disc count is wrong or there are no rows', () => {
    expect(toStandardDocument(table([{ ...ROW22, fillingG: null }]), 'loc', '')).toBeNull();
    expect(toStandardDocument({ ...table([ROW22]), discs: 6 }, 'loc', '')).toBeNull();
    expect(toStandardDocument(table([]), 'loc', '')).toBeNull();
  });

  test('read back, it is the same table', () => {
    const standard = table([emptyRow(16), ROW22, { ...emptyRow(28), decorationG: 0 }]);
    const doc = toStandardDocument(standard, 'loc', '');
    expect(sameStandard(normalizeStandard(doc), standard)).toBe(true);
  });
});

describe('helpers', () => {
  test('tidyRows and everyColumnTyped', () => {
    expect(tidyRows([emptyRow(30), emptyRow(12), emptyRow(30)]).map(r => r.diameterCm)).toEqual([12, 30]);
    expect(everyColumnTyped([emptyRow(16), ROW22])).toBe(true);
    expect(everyColumnTyped([{ ...ROW22, soakG: null }])).toBe(false);
  });

  test('standardFromReference keeps the discs and the disc height', () => {
    const standard = standardFromReference({ ...REF, discs: 4, discHeightCm: 2.5 });
    expect([standard.discs, standard.discHeightCm]).toEqual([4, 2.5]);
  });

  test('sameStandard', () => {
    expect(sameStandard(table([ROW22]), table([{ ...ROW22 }]))).toBe(true);
    expect(sameStandard(table([ROW22]), table([{ ...ROW22, soakG: 71 }]))).toBe(false);
    expect(sameStandard(table([ROW22]), { ...table([ROW22]), discs: 4 })).toBe(false);
    expect(sameStandard(null, null)).toBe(true);
  });
});

describe('the rules', () => {
  // Row by row hit Firestore's 1000-expressions limit at four full rows (measured 22 Nov 2026): the rules judge only type and count.
  test('the rules take an optional list of at most MAX_STANDARD_ROWS rows beside the old reference', () => {
    const block = /function isStandardRows\(rows\) \{([\s\S]*?)\}/.exec(rules)?.[1] ?? '';
    expect(block).toContain('rows is list');
    expect(block).toContain(`rows.size() <= ${MAX_STANDARD_ROWS}`);
    expect(rules).toContain("hasOnly(['bakery', 'grams', 'rows', 'updatedAt'])");
    expect(rules).toContain("(!('rows' in request.resource.data) || isStandardRows(request.resource.data.rows))");
  });

  test('a row is written with exactly its six keys', () => {
    expect([...STANDARD_ROW_KEYS]).toEqual(['diameterCm', 'baseG', 'soakG', 'fillingG', 'coatingG', 'decorationG']);
  });

  test('the old reference keys are unchanged (an old phone keeps writing them)', () => {
    expect([...REFERENCE_KEYS]).toEqual(['diameterCm', 'discs', 'discHeightCm', 'baseG', 'soakG', 'fillingG', 'coatingG', 'decorationG']);
  });
});
