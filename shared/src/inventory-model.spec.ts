// Unit tests for the month's stocktake: what you had, what you bought, what is left, and therefore
// what you used (P15 — the owner cannot read code, so these tests are the safety net), run against
// BOTH implementations: the TypeScript port in shared/ and js/inventory/inventory-model.js, which the
// live app uses today. Ported from tests/inventory-model.test.mjs; the two must stay equal until the
// switch to Mise 2. Every one of that file's 42 tests is ported (none needs the dictionary, the DOM or
// reads source as text). The module is a FULL port, so parity.spec.ts also compares its exports name
// by name.
//
// The one they exist for above all others is the first block: an empty box is not a zero. Read as a
// zero, a product nobody counted reports its whole stock as consumed — a made-up number that would
// then be believed.
//
// The last block ("Added") pins what the original's tests leave to the screens: the clock default of
// monthKey, the three decimals, the 200 characters of a frozen name, that a normalised month shares
// nothing with the document it came from, that an open month hands back the very objects it was
// given, and what a row of a closed month keeps of its live product.

import { afterEach, describe, expect, test, vi } from 'vitest';
import * as ported from './inventory-model';
import * as legacyJs from '../../js/inventory/inventory-model.js';

const legacy = legacyJs as unknown as typeof ported;

const FLOUR = 'flour';
const BUTTER = 'butter';

afterEach(() => { vi.useRealTimers(); });

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  // A month with flour counted end to end: 3 on the shelf, 12 bought, 4 left.
  const month = (over: Record<string, unknown> = {}): ported.InventoryMonth => m.normalizeMonth({
    month: '2026-09',
    opening: { [FLOUR]: 3 },
    purchased: { [FLOUR]: 12 },
    closing: { [FLOUR]: 4 },
    ...over,
  }) as ported.InventoryMonth;

  // ── An empty box is not a zero ─────────────────────────────────────────────

  test('a product nobody counted has NO consumption, not a full one', () => {
    // The trap this whole file exists for: flour started at 3, 12 arrived, and
    // nobody walked past the shelf. Read as "0 left" it would claim 15 used.
    const line = m.consumption(month({ closing: {} }), FLOUR);
    expect(line.counted).toBe(false);
    expect(line.closing).toBe(null);
    expect(line.used).toBe(null);
  });

  test('a product counted AND found empty consumed everything — the other state', () => {
    const line = m.consumption(month({ closing: { [FLOUR]: 0 } }), FLOUR);
    expect(line.counted).toBe(true);
    expect(line.closing).toBe(0);
    expect(line.used).toBe(15);
  });

  test('without an opening there is no answer either, however much was bought', () => {
    const line = m.consumption(month({ opening: {} }), FLOUR);
    expect(line.hasOpening).toBe(false);
    expect(line.used).toBe(null);
  });

  test('a product never mentioned at all answers null, never NaN', () => {
    const line = m.consumption(month(), 'never-heard-of-it');
    expect(line.used).toBe(null);
    expect(line.opening).toBe(null);
    expect(line.purchased).toBe(0);
  });

  test('a missing PURCHASED is a real zero — the one field that runs the other way', () => {
    // Deliberate: most products are not reordered every month, so "bought none" is
    // the ordinary case. The screen prints the 0 rather than hiding it.
    const line = m.consumption(month({ purchased: {} }), FLOUR);
    expect(line.purchased).toBe(0);
    expect(line.used).toBe(-1);
  });

  // ── The subtraction ────────────────────────────────────────────────────────

  test('used = had + bought − left', () => {
    expect(m.consumption(month(), FLOUR).used).toBe(11);
  });

  test('half a sack is a real quantity, and the thirds of a decimal do not leak', () => {
    const doc = month({ opening: { [FLOUR]: 0.1 }, purchased: { [FLOUR]: 0.2 }, closing: { [FLOUR]: 0 } });
    expect(m.consumption(doc, FLOUR).used).toBe(0.3);
  });

  test('more on the shelf than could possibly be there stays NEGATIVE', () => {
    // Impossible arithmetic is evidence of a mistyped number or an unrecorded
    // delivery. Clamped to zero it would read as a normal month.
    const doc = month({ opening: { [FLOUR]: 1 }, purchased: { [FLOUR]: 0 }, closing: { [FLOUR]: 9 } });
    expect(m.consumption(doc, FLOUR).used).toBe(-8);
  });

  test('a month object that is missing every map cannot throw', () => {
    expect(m.consumption({}, FLOUR).used).toStrictEqual(null);
    expect(m.consumption(null, FLOUR).used).toStrictEqual(null);
  });

  // ── What a count box accepts ───────────────────────────────────────────────

  test('an empty box, a blank one and nothing at all all mean "not said"', () => {
    expect(m.readCount('')).toBe(null);
    expect(m.readCount('   ')).toBe(null);
    expect(m.readCount(null)).toBe(null);
    expect(m.readCount(undefined)).toBe(null);
  });

  test('an Italian keyboard types 3,5 and it means three and a half', () => {
    expect(m.readCount('3,5')).toBe(3.5);
    expect(m.readCount('3.5')).toBe(3.5);
  });

  test('a negative count is refused, never quietly turned into zero', () => {
    expect(m.readCount(-2)).toBe(null);
    expect(m.readCount('-2')).toBe(null);
  });

  test('junk in a box is refused rather than becoming NaN', () => {
    expect(m.readCount('HELLO')).toBe(null);
    expect(m.readCount(Infinity)).toBe(null);
    expect(m.readCount(NaN)).toBe(null);
    expect(m.readCount({})).toBe(null);
    expect(m.readCount([])).toBe(null);
  });

  test('zero typed on purpose is a real answer', () => {
    expect(m.readCount('0')).toBe(0);
    expect(m.readCount(0)).toBe(0);
  });

  // ── Which month, and the one either side of it ─────────────────────────────

  test('a month id is a year and a real month, nothing else', () => {
    expect(m.isMonthId('2026-09')).toBe(true);
    expect(m.isMonthId('2026-13')).toBe(false);
    expect(m.isMonthId('2026-00')).toBe(false);
    expect(m.isMonthId('2026-9')).toBe(false);
    expect(m.isMonthId('2026-09-01')).toBe(false);
    expect(m.isMonthId('')).toBe(false);
    expect(m.isMonthId(null)).toBe(false);
    expect(m.MONTH_PATTERN).toBeInstanceOf(RegExp);
  });

  test('the month comes from the LOCAL clock, so half past midnight is the new month', () => {
    // Built in local time on purpose: at 00:30 on 1 October in British Summer Time
    // UTC still says September, and a stocktake would be written into the month
    // that had already ended.
    expect(m.monthKey(new Date(2026, 9, 1, 0, 30).getTime())).toBe('2026-10');
    expect(m.monthKey(new Date(2026, 8, 30, 23, 59).getTime())).toBe('2026-09');
  });

  test('a broken clock answers null rather than a made-up month', () => {
    expect(m.monthKey(NaN)).toBe(null);
  });

  test('the year rolls at December without anyone writing an if', () => {
    expect(m.nextMonth('2026-12')).toBe('2027-01');
    expect(m.previousMonth('2026-01')).toBe('2025-12');
    expect(m.shiftMonth('2026-09', 0)).toBe('2026-09');
    expect(m.shiftMonth('2026-09', -9)).toBe('2025-12');
  });

  test('a month nobody could name shifts to nothing', () => {
    expect(m.shiftMonth('nonsense', 1)).toBe(null);
    expect(m.shiftMonth('2026-09', 1.5)).toBe(null);
  });

  test('a month is bounded from its first day up to — not including — the next', () => {
    expect(m.monthBounds('2026-02')).toStrictEqual({ from: '2026-02-01', to: '2026-03-01' });
    expect(m.monthBounds('2026-12')).toStrictEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(m.monthBounds('2026-13')).toBe(null);
  });

  // ── Cleaning what comes back from the database ─────────────────────────────

  test('a document with no month at all is refused', () => {
    expect(m.normalizeMonth({})).toBe(null);
    expect(m.normalizeMonth(null)).toBe(null);
    expect(m.normalizeMonth({ month: 'junk' })).toBe(null);
  });

  test('the id can come from the field, from the document id, or be handed in', () => {
    expect(m.normalizeMonth({ month: '2026-09' })?.id).toBe('2026-09');
    expect(m.normalizeMonth({ id: '2026-08' })?.id).toBe('2026-08');
    expect(m.normalizeMonth({}, '2026-07')?.id).toBe('2026-07');
  });

  test('a corrupt value inside a map is dropped, not carried into the arithmetic', () => {
    const doc = m.normalizeMonth({
      month: '2026-09',
      opening: { [FLOUR]: 'HELLO', [BUTTER]: '2,5' },
      closing: 'not a map',
    }) as ported.InventoryMonth;
    expect(doc.opening).toStrictEqual({ [BUTTER]: 2.5 });
    expect(doc.closing).toStrictEqual({});
  });

  test('every map exists after normalising, so nothing downstream has to check', () => {
    const doc = m.normalizeMonth({ month: '2026-09' }) as ported.InventoryMonth;
    [...m.COUNT_MAPS, ...m.FROZEN_MAPS].forEach(key => {
      expect(doc[key], `${key} should be an empty map`).toStrictEqual({});
    });
  });

  test('a frozen name is kept as text and a junk one is dropped', () => {
    const doc = m.normalizeMonth({ month: '2026-09', names: { [FLOUR]: '  Farina 00 25kg ', [BUTTER]: 7 } }) as ported.InventoryMonth;
    expect(doc.names).toStrictEqual({ [FLOUR]: 'Farina 00 25kg' });
  });

  test('a month is open until something is written into closedAt', () => {
    expect(m.isClosed(m.normalizeMonth({ month: '2026-09' }))).toBe(false);
    expect(m.isClosed(m.normalizeMonth({ month: '2026-09', closedAt: '2026-10-01T09:00:00.000Z' }))).toBe(true);
    expect(m.isClosed(null)).toBe(false);
  });

  // ── How far through the count you are ──────────────────────────────────────

  test('progress counts the boxes filled in, not the products that exist', () => {
    const doc = month({ closing: { [FLOUR]: 4 } });
    expect(m.progressOf(doc, [FLOUR, BUTTER])).toStrictEqual({ counted: 1, total: 2, done: false });
  });

  test('a count of zero counts as counted', () => {
    const doc = month({ closing: { [FLOUR]: 0, [BUTTER]: 0 } });
    expect(m.progressOf(doc, [FLOUR, BUTTER])).toStrictEqual({ counted: 2, total: 2, done: true });
  });

  test('no products at all is not a finished count', () => {
    expect(m.progressOf(month(), [])).toStrictEqual({ counted: 0, total: 0, done: false });
  });

  // ── Opening the next month ─────────────────────────────────────────────────

  test('what is left at the end of September is what you have at the start of October', () => {
    const september = month({ closing: { [FLOUR]: 4, [BUTTER]: 1.5 } });
    const october = m.carryOver(september, '2026-10', 'NOW') as ported.InventoryMonth;
    expect(october.opening).toStrictEqual({ [FLOUR]: 4, [BUTTER]: 1.5 });
    expect(october.month).toBe('2026-10');
    expect(october.closedAt).toBe('');
    expect(october.createdAt).toBe('NOW');
  });

  test('last month\'s purchases and counts do NOT come with it', () => {
    const october = m.carryOver(month(), '2026-10') as ported.InventoryMonth;
    expect(october.purchased).toStrictEqual({});
    expect(october.closing).toStrictEqual({});
  });

  test('the weight of a sack is typed once and travels from month to month', () => {
    const september = month({ packKg: { [FLOUR]: 25 } });
    expect(m.carryOver(september, '2026-10')?.packKg).toStrictEqual({ [FLOUR]: 25 });
  });

  test('a product nobody counted inherits no opening — "not said" stays not said', () => {
    const september = month({ closing: { [FLOUR]: 4 } });
    const october = m.carryOver(september, '2026-10') as ported.InventoryMonth;
    expect(october.opening[BUTTER]).toBe(undefined);
    expect(m.consumption(october, BUTTER).hasOpening).toBe(false);
  });

  test('the very first month starts empty rather than refusing to exist', () => {
    const first = m.carryOver(null, '2026-09') as ported.InventoryMonth;
    expect(first.opening).toStrictEqual({});
    expect(first.month).toBe('2026-09');
  });

  test('a month nobody could name is not created', () => {
    expect(m.carryOver(month(), 'later')).toBe(null);
  });

  // ── What is written to Firestore ───────────────────────────────────────────

  test('the payload carries exactly the keys the rules allow, and no id', () => {
    const doc = m.toDocument(month()) as ported.MonthDocument;
    expect(Object.keys(doc).sort()).toStrictEqual([
      'closedAt', 'closing', 'createdAt', 'month', 'names',
      'opening', 'packKg', 'purchased', 'unitPrice', 'updatedAt',
    ]);
    expect('id' in doc).toBe(false);
    expect('bakery' in doc, 'the data layer stamps bakery, not the model').toBe(false);
  });

  test('there is nothing to write for a month that does not exist', () => {
    expect(m.toDocument(null)).toBe(null);
    expect(m.toDocument({ month: 'junk' })).toBe(null);
  });

  // ── Which products a month is about ────────────────────────────────────────
  //
  // ⚠️⚠️ THE DEFECT THESE PIN: every screen read its rows from the LIVE ingredient
  // list, closed months included. Delete a product next spring and September stopped
  // naming it — and its cost dropped out of September's total — while the screen
  // promised that a closed month's figures no longer change. A closed month is a
  // record, and a record may not lose rows.

  const active = (over: Record<string, unknown> = {}): { id: string } & Record<string, unknown> =>
    ({ id: 'flour', name: 'Flour', weight: '25kg', ...over });

  test('an OPEN month is about what the venue sells today', () => {
    const live = [
      active(),
      active({ id: 'salt', name: 'Salt' }),
      active({ id: 'old', name: 'Retired', active: false }),
      active({ id: 'blank', name: '   ' }),
      null,
    ];
    const out = m.productsOfMonth({ closedAt: '' }, live);
    expect(out.map(i => i.id),
      'a product out of use, one with no name and a hole in the list are not rows').toStrictEqual(['flour', 'salt']);
    expect(m.countableProducts(live).map(i => i.id)).toStrictEqual(['flour', 'salt']);
    expect(m.countableProducts(null), 'nothing at all is no rows, not a crash').toStrictEqual([]);
  });

  test('⚠️ a CLOSED month is about what was frozen into it', () => {
    const doc = {
      closedAt: '2026-10-01T09:00:00.000Z',
      names: { flour: 'Flour 25kg', salt: 'Salt 1kg' },
      closing: { flour: 2 },
    };
    // Only one of the two still exists, and a third has been added since.
    const live = [active({ id: 'flour', name: 'Farina rinominata' }), active({ id: 'new', name: 'New' })];
    const out = m.productsOfMonth(doc, live);
    expect(out.map(i => i.id).sort(),
      'the deleted one is still a row; the one added afterwards is not').toStrictEqual(['flour', 'salt']);
    const byId = new Map(out.map(i => [i.id, i]));
    expect(byId.get('flour')?.name,
      'a product renamed after the close keeps, inside that month, the name it was counted under').toBe('Flour 25kg');
    expect(byId.get('flour')?.weight,
      'and the frozen label already carries the pack text, so it is not printed twice').toBe('');
    expect(byId.get('salt')?.name).toBe('Salt 1kg');
  });

  test('⚠️ a counted row cannot vanish, even if the frozen list never named it', () => {
    // Belt and braces: a close whose `names` write failed, or a month closed by an
    // older version. The counts are in the document and are what somebody walked the
    // shelves for.
    const doc = { closedAt: 'yes', names: {}, closing: { ghost: 3 }, opening: { older: 1 } };
    const out = m.productsOfMonth(doc, [active({ id: 'flour' })]);
    expect(out.map(i => i.id).sort()).toStrictEqual(['ghost', 'older']);
  });

  test('a pack weight alone does not make a product a row of the month', () => {
    // packKg is a setting carried from month to month, not a count.
    const doc = { closedAt: 'yes', names: { flour: 'Flour' }, packKg: { flour: 25, salt: 1 } };
    expect(m.productsOfMonth(doc, [] as { id: string }[]).map(i => i.id)).toStrictEqual(['flour']);
  });

  test('a month closed with nothing recorded at all shows the live list, not a blank screen', () => {
    const live = [active()];
    expect(m.productsOfMonth({ closedAt: 'yes', names: {} }, live).map(i => i.id)).toStrictEqual(['flour']);
  });

  // ── Added ──────────────────────────────────────────────────────────────────
  // Not in tests/inventory-model.test.mjs. Each is a fact the stocktake's parity list relies on.

  test('with no moment given, the month is the one the clock is in', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1, 0, 30));
    expect(m.monthKey()).toBe('2026-10');
    vi.setSystemTime(new Date(2026, 8, 30, 23, 59));
    expect(m.monthKey()).toBe('2026-09');
  });

  test('a count keeps three decimals and no more', () => {
    expect(m.readCount('3.14159')).toBe(3.142);
    expect(m.readCount(0.0004)).toBe(0);
    expect(m.readCount('1,2346')).toBe(1.235);
    expect(m.readCount('1,2344')).toBe(1.234);
    expect(m.readCount(' 7 ')).toBe(7);
  });

  test('a frozen name is cut to 200 characters after it is trimmed', () => {
    const doc = m.normalizeMonth({ month: '2026-09', names: { a: ` ${'x'.repeat(250)} `, b: 'y'.repeat(200), c: '   ' } }) as ported.InventoryMonth;
    expect(doc.names.a).toBe('x'.repeat(200));
    expect(doc.names.b).toBe('y'.repeat(200));
    expect('c' in doc.names, 'a blank name is no name').toBe(false);
  });

  test('a normalised month shares nothing with the document it came from', () => {
    const raw = { month: '2026-09', closing: { [FLOUR]: 4 }, names: { [FLOUR]: 'Flour' } };
    const doc = m.normalizeMonth(raw) as ported.InventoryMonth;
    doc.closing[FLOUR] = 99;
    doc.names[FLOUR] = 'changed';
    expect(raw.closing[FLOUR]).toBe(4);
    expect(raw.names[FLOUR]).toBe('Flour');
  });

  test('the month after takes its figures by copy: changing it does not touch the month it came from', () => {
    const september = month({ closing: { [FLOUR]: 4 }, packKg: { [FLOUR]: 25 } });
    const october = m.carryOver(september, '2026-10') as ported.InventoryMonth;
    october.opening[FLOUR] = 99;
    october.packKg[FLOUR] = 99;
    expect(september.closing[FLOUR]).toBe(4);
    expect(september.packKg[FLOUR]).toBe(25);
  });

  test('a stamp that is not text is no stamp', () => {
    expect(m.carryOver(null, '2026-10', 5)?.createdAt).toBe('');
    expect(m.carryOver(null, '2026-10', undefined)?.updatedAt).toBe('');
    expect(m.carryOver(null, '2026-10', '2026-10-01T09:00:00.000Z')?.updatedAt).toBe('2026-10-01T09:00:00.000Z');
  });

  test('the lists of maps are the ones the rules know, and nobody can change them', () => {
    expect([...m.COUNT_MAPS]).toStrictEqual(['opening', 'purchased', 'closing', 'packKg']);
    expect([...m.FROZEN_MAPS]).toStrictEqual(['names', 'unitPrice']);
    expect(Object.isFrozen(m.COUNT_MAPS)).toBe(true);
    expect(Object.isFrozen(m.FROZEN_MAPS)).toBe(true);
  });

  test('an OPEN month hands back the very objects it was given', () => {
    const flour = active();
    const salt = active({ id: 'salt', name: 'Salt' });
    const out = m.productsOfMonth({ closedAt: '' }, [flour, salt]);
    expect(out[0]).toBe(flour);
    expect(out[1]).toBe(salt);
    expect(m.productsOfMonth(null, [flour])[0], 'no month at all is an open one').toBe(flour);
  });

  test('a row of a closed month keeps what the live product knew, and a row nobody knows is its id and its label', () => {
    const doc = { closedAt: 'yes', names: { flour: 'Flour 25kg', ghost: 'Ghost 1kg' }, closing: { flour: 2 } };
    const live = [active({ id: 'flour', name: 'Farina', shortName: 'Fa', brand: 'Caputo', category: 'dry' })];
    const byId = new Map(m.productsOfMonth(doc, live).map(i => [i.id, i]));
    expect(byId.get('flour')).toStrictEqual({
      id: 'flour', name: 'Flour 25kg', shortName: '', weight: '', brand: 'Caputo', category: 'dry',
    });
    expect(byId.get('ghost')).toStrictEqual({ id: 'ghost', name: 'Ghost 1kg', shortName: '', weight: '' });
    expect(live[0]?.name, 'and the live list itself is not touched').toBe('Farina');
  });

  test('a counted row with no frozen label is its live product, name and all', () => {
    const doc = { closedAt: 'yes', names: {}, closing: { flour: 2 } };
    const out = m.productsOfMonth(doc, [active({ id: 'flour', name: 'Farina' })]);
    expect(out).toStrictEqual([{ id: 'flour', name: 'Farina', weight: '25kg' }]);
  });
});
