// Unit tests for the Pastries model (P15 — the owner cannot read code, so these tests are the safety
// net), run against BOTH implementations: the TypeScript port in shared/ and
// js/pastries/pastries-model.js, which the live app uses today. Ported from
// tests/pastries-model.test.mjs; the two must stay equal until the switch to Mise 2.
//
// pastries-model.ts is a PARTIAL port, so parity.spec.ts does not pair it: the original also exports
// weekdayLabel and weekdayShortLabel, which look a word up in the interface dictionary, and in
// Mise 2 the dictionary belongs to the app. EVERY one of the 51 tests of tests/pastries-model.test.mjs
// is ported: none of them calls those two functions or touches the DOM. NOT PORTED — everything in
// tests/pastries-language.test.mjs, which is about those two functions and the screens that call
// them (it reads the screens' source as text). The last block of this file stands in for what
// pairing would have checked: the same names, the same constants, the same frozen-ness, the same
// function shapes.
//
// This file exists because of ONE behaviour that is almost impossible to check by
// hand: which day the screen opens on at 1am. Getting it wrong is silent and
// expensive — someone arrives for the night shift, reads a list that is a day
// ahead, and proves the wrong pastries for a service that has already been sold.
// Nobody finds out until the morning.
//
// Two traps are pinned here in particular:
//
//   1. THE CLOCK CHANGES. Subtracting four hours as milliseconds instead of with
//      setHours is wrong on both DST Sundays, in opposite directions. Measured:
//      25 Oct 2026 03:30 the ms version says Sunday (Saturday is right), and
//      29 Mar 2026 04:30 it says Saturday (Sunday is right).
//
//   2. THE READ-SIDE CAP. If normalizeDay did not truncate to MAX_ITEMS on the
//      way IN, a day carrying more rows than the rules allow would display fine,
//      accept one more row, and then have every save refused for ever with
//      nothing on screen to explain it.
//
// Every date is built from numeric components (new Date(2026, 7, 4, 1, 0)), never
// parsed from a string, and nowMs is always injected — so every assertion below
// holds in any timezone, including the UTC that CI runs in.

import { describe, expect, test } from 'vitest';
import * as ported from './pastries-model';
import * as legacyJs from '../../js/pastries/pastries-model.js';

const legacy = legacyJs as unknown as typeof ported;

const at = (y: number, m: number, d: number, h = 12, min = 0): number => new Date(y, m, d, h, min).getTime();

// Anchors, verified against the calendar before being used below.
// Mon 3 Aug 2026 · Tue 4 Aug 2026 · Sun 9 Aug 2026 · Mon 10 Aug 2026
// Sun 29 Mar 2026 (clocks forward) · Sun 25 Oct 2026 (clocks back)

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  // ── The vocabulary ───────────────────────────────────────────────────────────

  test('the weekday names are exactly the ones supplier orderDays already use', () => {
    // Asserted literally, so a rename here can never quietly split the app into two
    // weekday vocabularies that disagree.
    expect([...m.WEEKDAYS]).toStrictEqual([
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    ]);
    expect([...m.WEEKDAY_SHORT]).toStrictEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(m.DAY_START_HOUR).toBe(4);
  });

  test('a weekday typed with a stray space or a small letter is not a weekday', () => {
    // The same invisible-space trap that cost half an hour on the location documents.
    expect(m.isWeekday('Monday')).toBe(true);
    expect(m.isWeekday('monday')).toBe(false);
    expect(m.isWeekday('Monday ')).toBe(false);
    expect(m.isWeekday(' Monday')).toBe(false);
    expect(m.isWeekday('')).toBe(false);
    expect(m.isWeekday(null)).toBe(false);
    expect(m.isWeekday(0)).toBe(false);
    expect(m.isWeekday(['Monday'])).toBe(false);
  });

  test('the week has no end — Sunday is followed by Monday', () => {
    expect(m.nextWeekday('Sunday')).toBe('Monday');
    expect(m.previousWeekday('Monday')).toBe('Sunday');
    expect(m.nextWeekday('Monday')).toBe('Tuesday');
    expect(m.previousWeekday('Wednesday')).toBe('Tuesday');
  });

  test('an unreadable weekday falls back to Monday instead of returning undefined', () => {
    // A screen showing the wrong day is recoverable; a screen showing "undefined"
    // with no list at all is the app looking broken.
    expect(m.nextWeekday('Funday')).toBe('Monday');
    expect(m.previousWeekday(null)).toBe('Monday');
  });

  // ── The 4am roll-over ────────────────────────────────────────────────────────

  test('at 23:30 on Monday the list to prove is Tuesday', () => {
    expect(m.workWeekday(at(2026, 7, 3, 23, 30))).toBe('Monday');
    expect(m.provingDayFor(at(2026, 7, 3, 23, 30))).toBe('Tuesday');
  });

  test('at 00:30 on Tuesday it is STILL Tuesday — the night shift is one day', () => {
    // The whole reason this feature does not use the calendar day. Half an hour past
    // midnight the same person is doing the same night's work.
    expect(m.workWeekday(at(2026, 7, 4, 0, 30))).toBe('Monday');
    expect(m.provingDayFor(at(2026, 7, 4, 0, 30))).toBe('Tuesday');
  });

  test('the roll-over happens on the minute, not around it', () => {
    expect(m.provingDayFor(at(2026, 7, 4, 3, 59))).toBe('Tuesday');
    expect(m.provingDayFor(at(2026, 7, 4, 4, 0))).toBe('Wednesday');
  });

  test('later on Tuesday the list to prove is Wednesday', () => {
    expect(m.workWeekday(at(2026, 7, 4, 12, 0))).toBe('Tuesday');
    expect(m.provingDayFor(at(2026, 7, 4, 12, 0))).toBe('Wednesday');
  });

  test('the wrap and the 4am rule apply at the same time', () => {
    // Sunday night: the work day is Sunday, so the list is Monday's.
    expect(m.provingDayFor(at(2026, 7, 9, 22, 0))).toBe('Monday');
    // 1am on Monday morning is still Sunday's shift, so the list is STILL Monday's.
    expect(m.workWeekday(at(2026, 7, 10, 1, 0))).toBe('Sunday');
    expect(m.provingDayFor(at(2026, 7, 10, 1, 0))).toBe('Monday');
  });

  test('a garbage timestamp does not throw or produce undefined', () => {
    for (const bad of [undefined, null, NaN, 'yesterday', {}, Infinity]) {
      expect(m.WEEKDAYS.includes(m.workWeekday(bad)), `workWeekday(${String(bad)})`).toBe(true);
      expect(m.WEEKDAYS.includes(m.provingDayFor(bad)), `provingDayFor(${String(bad)})`).toBe(true);
    }
  });

  // ── The clock changes ────────────────────────────────────────────────────────

  test('clocks going FORWARD (Sun 29 Mar 2026) does not shift the work day', () => {
    // 03:30 is before 4am → still Saturday's shift.
    expect(m.workWeekday(at(2026, 2, 29, 3, 30))).toBe('Saturday');
    // 04:30 is past 4am → Sunday has started. Subtracting 4h as milliseconds
    // answers "Saturday" here, which is the bug this line exists to catch.
    expect(m.workWeekday(at(2026, 2, 29, 4, 30))).toBe('Sunday');
  });

  test('clocks going BACK (Sun 25 Oct 2026) does not shift the work day', () => {
    // 03:30 is before 4am → still Saturday's shift. Subtracting 4h as milliseconds
    // answers "Sunday" here — the same bug, in the opposite direction.
    expect(m.workWeekday(at(2026, 9, 25, 3, 30))).toBe('Saturday');
    expect(m.workWeekday(at(2026, 9, 25, 4, 30))).toBe('Sunday');
  });

  test('across a whole clock-change week, midday always names its own weekday', () => {
    // A cheap sweep that catches an off-by-one anywhere in the conversion between
    // JS's Sunday-first getDay() and this file's Monday-first list.
    const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    for (let i = 0; i < 7; i++) {
      const day = 19 + i; // Mon 19 Oct 2026 … Sun 25 Oct 2026
      expect(m.workWeekday(at(2026, 9, day, 12, 0)), `19+${i} Oct`).toBe(names[i]);
    }
  });

  // ── Quantities ───────────────────────────────────────────────────────────────

  test('a quantity is always a whole number Firestore can store', () => {
    expect(m.wholeNumber(24)).toBe(24);
    expect(m.wholeNumber('24')).toBe(24);
    expect(m.wholeNumber(3.7)).toBe(4);
    expect(m.wholeNumber(-5)).toBe(0);
    expect(m.wholeNumber('')).toBe(0);
    expect(m.wholeNumber(null)).toBe(0);
    expect(m.wholeNumber(undefined)).toBe(0);
    expect(m.wholeNumber('abc')).toBe(0);
  });

  test('1e999 is Infinity, and Infinity would break every save that followed', () => {
    // A number field accepts this happily. Firestore refuses a non-finite number,
    // so without this one keystroke would poison the document and every later save.
    // It becomes 0, which the validator then reports as a missing quantity.
    expect(m.wholeNumber(1e999)).toBe(0);
    expect(m.wholeNumber(Infinity)).toBe(0);
    expect(m.wholeNumber(-Infinity)).toBe(0);
    expect(m.wholeNumber(NaN)).toBe(0);
    for (const v of [1e999, Infinity, -Infinity, NaN, 'abc', null]) {
      expect(Number.isFinite(m.wholeNumber(v)), `wholeNumber(${String(v)}) must be finite`).toBe(true);
    }
  });

  test('a big number is kept as typed, and refused — never quietly shrunk', () => {
    // Storing a 9999 nobody chose is the same mistake as truncating a name.
    expect(m.wholeNumber(50000)).toBe(50000);
    const bad = m.findInvalidItems([{ name: 'Cornetti', qty: 50000 }]);
    expect(bad?.problem).toBe('qty-too-big');
    expect(bad?.name).toBe('Cornetti');
    expect(m.findInvalidItems([{ name: 'Cornetti', qty: m.MAX_QTY }])).toBe(null);
  });

  // ── Reading what is stored ───────────────────────────────────────────────────

  test('a day that was never written reads as an empty list, not a crash', () => {
    expect(m.normalizeDay(null, 'Monday')).toStrictEqual({ day: 'Monday', items: [], note: '' });
    expect(m.normalizeDay(undefined, 'Friday')).toStrictEqual({ day: 'Friday', items: [], note: '' });
    expect(m.normalizeDay({}, 'Sunday')).toStrictEqual({ day: 'Sunday', items: [], note: '' });
  });

  test('a corrupt items field reads as an empty list', () => {
    for (const bad of ['Cornetti', 42, { a: 1 }, null]) {
      expect(m.normalizeDay({ items: bad }, 'Monday').items).toStrictEqual([]);
    }
  });

  test('rows that are not rows are dropped, the real ones survive', () => {
    const out = m.normalizeDay({
      items: [1, 'Cornetti', null, { name: 'Bomboloni', qty: 10 }, { qty: 5 }, {}],
    }, 'Monday');
    expect(out.items).toStrictEqual([{ name: 'Bomboloni', qty: 10 }]);
  });

  test('names are trimmed and blank ones dropped', () => {
    const out = m.normalizeDay({
      items: [{ name: '  Cornetti  ', qty: 24 }, { name: '   ', qty: 3 }],
    }, 'Monday');
    expect(out.items).toStrictEqual([{ name: 'Cornetti', qty: 24 }]);
  });

  test('an over-long stored name is shortened rather than hidden', () => {
    // The data is already there; refusing to show it helps nobody.
    const out = m.normalizeDay({ items: [{ name: 'x'.repeat(300), qty: 1 }] }, 'Monday');
    expect(out.items[0]?.name.length).toBe(m.MAX_NAME_LENGTH);
  });

  test('a day storing more rows than the cap reads back at the cap', () => {
    // ⚠️ So a day can never become permanently unsavable: what is shown is always
    // something the rules will accept back.
    const items = Array.from({ length: 300 }, (_, i) => ({ name: `P${i}`, qty: 1 }));
    expect(m.normalizeDay({ items }, 'Monday').items.length).toBe(m.MAX_ITEMS);
  });

  test('the whole collection always comes back with all seven days', () => {
    for (const input of [[], null, 'nonsense', undefined, {}]) {
      const days = m.normalizeDays(input);
      expect(Object.keys(days)).toStrictEqual([...m.WEEKDAYS]);
      m.WEEKDAYS.forEach(d => expect(days[d]).toStrictEqual({ items: [], note: '' }));
    }
  });

  test('a document whose id is not a weekday is ignored, not rendered', () => {
    const days = m.normalizeDays([
      { id: 'Monday', items: [{ name: 'Cornetti', qty: 24 }] },
      { id: 'Funday', items: [{ name: 'Nothing', qty: 1 }] },
      { id: '2026-08-05', items: [{ name: 'Nothing', qty: 1 }] },
      { id: 'monday', items: [{ name: 'Nothing', qty: 1 }] },
    ]);
    expect(Object.keys(days)).toStrictEqual([...m.WEEKDAYS]);
    expect(days.Monday.items).toStrictEqual([{ name: 'Cornetti', qty: 24 }]);
    expect(days.Tuesday.items.length).toBe(0);
  });

  test('when the id and the stored day field disagree, the id wins', () => {
    // The id is what the rules pin and what decides which list was written.
    const days = m.normalizeDays([
      { id: 'Monday', day: 'Friday', items: [{ name: 'Cornetti', qty: 24 }] },
    ]);
    expect(days.Monday.items).toStrictEqual([{ name: 'Cornetti', qty: 24 }]);
    expect(days.Friday.items).toStrictEqual([]);
  });

  // ── Preparing what gets written ──────────────────────────────────────────────

  test('an untouched empty row is dropped, not treated as a mistake', () => {
    // Someone tapped "add" and has not typed yet. Refusing to save would make the
    // button feel broken.
    const out = m.cleanItems([
      { name: 'Cornetti', qty: 24 },
      { name: '', qty: '' },
      { name: 'Bomboloni', qty: 10 },
    ]);
    expect(out).toStrictEqual([{ name: 'Cornetti', qty: 24 }, { name: 'Bomboloni', qty: 10 }]);
  });

  test('the order typed is the order stored — it is the order the work is done in', () => {
    const names = ['Danish fruit', 'Cornetti', 'Bomboloni', 'Pain chocolat'];
    const out = m.cleanItems(names.map((name, i) => ({ name, qty: i + 1 })));
    expect(out.map(i => i.name)).toStrictEqual(names);
  });

  test('cleaning does not silently merge two rows with the same name', () => {
    // Dropping one would lose a number. findInvalidItems reports it instead, so the
    // person decides.
    expect(m.cleanItems([{ name: 'Cornetti', qty: 12 }, { name: 'Cornetti', qty: 24 }]).length).toBe(2);
  });

  test('cleanItems survives being handed something that is not a list', () => {
    for (const bad of [null, undefined, 'x', 42, {}]) expect(m.cleanItems(bad)).toStrictEqual([]);
  });

  // ── What blocks a save ───────────────────────────────────────────────────────

  test('an empty day is valid — that is how a day gets cleared', () => {
    expect(m.findInvalidItems([])).toBe(null);
    expect(m.findInvalidItems(null)).toBe(null);
  });

  test('a full, ordinary list is valid', () => {
    // The real list from the note this feature replaces.
    expect(m.findInvalidItems([
      { name: 'Cornetti', qty: 24 },
      { name: 'Savoury croissant', qty: 12 },
      { name: 'Pain chocolat', qty: 5 },
      { name: 'Cinnamon rolls', qty: 5 },
      { name: 'Bomboloni', qty: 10 },
      { name: 'Danish fruit', qty: 4 },
    ])).toBe(null);
  });

  test('the same pastry twice is reported, whatever the capitals', () => {
    const bad = m.findInvalidItems([{ name: 'Cornetti', qty: 12 }, { name: ' cornetti ', qty: 24 }]);
    expect(bad?.problem).toBe('duplicate');
    expect(bad?.index).toBe(1);
    expect(bad?.name).toBe('cornetti');
  });

  test('two different pastries that start the same are not duplicates', () => {
    expect(m.findInvalidItems([
      { name: 'Cornetti', qty: 24 },
      { name: 'Cornetti integrali', qty: 6 },
    ])).toBe(null);
  });

  test('a pastry with no number is blocked — the list is unreadable without it', () => {
    for (const qty of [0, '', null, undefined, 'abc', -3]) {
      const bad = m.findInvalidItems([{ name: 'Cornetti', qty }]);
      expect(bad && bad.problem, `qty=${String(qty)}`).toBe('no-qty');
      expect(bad?.index).toBe(0);
      expect(bad?.name).toBe('Cornetti');
    }
  });

  test('an over-long name is refused rather than quietly shortened', () => {
    const bad = m.findInvalidItems([{ name: 'x'.repeat(m.MAX_NAME_LENGTH + 1), qty: 1 }]);
    expect(bad?.problem).toBe('too-long');
    expect(bad?.index).toBe(0);
  });

  test('a name exactly at the limit is allowed', () => {
    expect(m.findInvalidItems([{ name: 'x'.repeat(m.MAX_NAME_LENGTH), qty: 1 }])).toBe(null);
  });

  test('too many rows is reported here, so the database never has to refuse it', () => {
    const many = Array.from({ length: m.MAX_ITEMS + 1 }, (_, i) => ({ name: `P${i}`, qty: 1 }));
    expect(m.findInvalidItems(many)?.problem).toBe('too-many');
    expect(m.findInvalidItems(many.slice(0, m.MAX_ITEMS))).toBe(null);
  });

  test('a blank row does not block a save and does not count as a duplicate', () => {
    expect(m.findInvalidItems([
      { name: 'Cornetti', qty: 24 },
      { name: '', qty: '' },
      { name: '', qty: '' },
    ])).toBe(null);
  });

  // ── The standing note ────────────────────────────────────────────────────────

  test('a missing or corrupt note reads as no note at all', () => {
    // A day with no note and a day whose note field is junk look the same on
    // screen, which is the honest answer in both cases.
    for (const bad of [undefined, null, 42, [], {}, true]) {
      expect(m.cleanNote(bad)).toBe('');
      expect(m.normalizeDay({ note: bad }, 'Monday').note).toBe('');
    }
  });

  test('a note keeps its line breaks — it is written in lines, not a sentence', () => {
    // Flattening it would change what somebody wrote.
    expect(m.cleanNote('check the fridge\nbutter is low')).toBe('check the fridge\nbutter is low');
    expect(m.cleanNote('  spaced  ')).toBe('spaced');
  });

  test('an over-long note is cut rather than refused', () => {
    // Unlike a pastry NAME, a note has no second field depending on it and no
    // duplicate to collide with: keeping the first 500 characters loses less than
    // refusing the save would.
    expect(m.cleanNote('x'.repeat(900)).length).toBe(m.MAX_NOTE_LENGTH);
    expect(m.normalizeDay({ note: 'x'.repeat(900) }, 'Monday').note.length).toBe(m.MAX_NOTE_LENGTH);
  });

  test('the note travels with the day, and an empty one is not undefined', () => {
    const day = m.normalizeDay({ items: [{ name: 'Cornetti', qty: 24 }], note: 'slow proof' }, 'Monday');
    expect(day).toStrictEqual({
      day: 'Monday', items: [{ name: 'Cornetti', qty: 24 }], note: 'slow proof',
    });
    expect(m.normalizeDays([{ id: 'Monday', items: [], note: 'x' }]).Monday.note).toBe('x');
    expect(m.normalizeDays([{ id: 'Monday', items: [] }]).Tuesday.note).toBe('');
  });

  // ── The cache written by an older version ────────────────────────────────────
  //
  // This runs once per device, on the first open after an update, BEFORE the
  // network answers — so it is never exercised by hand and a mistake here shows up
  // as "all seven days were empty for a second", on every phone, once.

  test('a cache written before notes existed still paints its lists', () => {
    // ⚠️ The old shape: the value under each weekday IS the items array.
    const old = {
      Monday: [{ name: 'Cornetti', qty: 24 }],
      Tuesday: [{ name: 'Bomboloni', qty: 10 }],
    };
    const days = m.daysFromCache(old);
    expect(days.Monday).toStrictEqual({ items: [{ name: 'Cornetti', qty: 24 }], note: '' });
    expect(days.Tuesday.items).toStrictEqual([{ name: 'Bomboloni', qty: 10 }]);
    expect(days.Sunday).toStrictEqual({ items: [], note: '' });
    expect(Object.keys(days)).toStrictEqual([...m.WEEKDAYS]);
  });

  test('a cache written with notes reads back with them', () => {
    const days = m.daysFromCache({
      Monday: { items: [{ name: 'Cornetti', qty: 24 }], note: 'slow proof' },
    });
    expect(days.Monday.note).toBe('slow proof');
    expect(days.Monday.items).toStrictEqual([{ name: 'Cornetti', qty: 24 }]);
  });

  test('a corrupt or absent cache is an empty week, never a crash', () => {
    for (const bad of [null, undefined, 'nonsense', 42, [], { Monday: 'x' }, { Monday: 7 }]) {
      const days = m.daysFromCache(bad);
      expect(Object.keys(days)).toStrictEqual([...m.WEEKDAYS]);
      m.WEEKDAYS.forEach(d => expect(days[d]).toStrictEqual({ items: [], note: '' }));
    }
  });

  test('a cached day is cleaned exactly as a Firestore read would be', () => {
    // The cache is this app's own storage, but it is still storage other code can
    // reach — so the same guarantees have to hold on the offline path.
    const days = m.daysFromCache({
      Monday: { items: Array.from({ length: 300 }, (_, i) => ({ name: `P${i}`, qty: 1 })) },
      Tuesday: { items: [1, null, { name: '  Cornetti  ', qty: '24' }], note: 42 },
    });
    expect(days.Monday.items.length).toBe(m.MAX_ITEMS);
    expect(days.Tuesday.items).toStrictEqual([{ name: 'Cornetti', qty: 24 }]);
    expect(days.Tuesday.note).toBe('');
  });

  // ── Changing one quantity from the day list ──────────────────────────────────

  test('a quantity lands on the row it was typed on', () => {
    const items = [{ name: 'Cornetti', qty: 24 }, { name: 'Bomboloni', qty: 10 }];
    const next = m.setQuantityAt(items, 1, 18, 'Bomboloni');
    expect(next).toStrictEqual([{ name: 'Cornetti', qty: 24 }, { name: 'Bomboloni', qty: 18 }]);
    // and the original is untouched — the store replaces the whole day, so a
    // mutated input would corrupt the copy it is about to compare against.
    expect(items).toStrictEqual([{ name: 'Cornetti', qty: 24 }, { name: 'Bomboloni', qty: 10 }]);
  });

  test('a row that moved under your finger is REFUSED, not written to the wrong pastry', () => {
    // ⚠️ The whole reason the name is checked as well as the index. Minutes can
    // pass between drawing a row and tapping its tick, and a snapshot from another
    // phone can reorder the list in between.
    const items = [{ name: 'Bomboloni', qty: 10 }, { name: 'Cornetti', qty: 24 }];
    expect(m.setQuantityAt(items, 0, 99, 'Cornetti')).toBe(null);
    expect(m.setQuantityAt(items, 5, 99, 'Cornetti')).toBe(null);
    expect(m.setQuantityAt(items, -1, 99, 'Cornetti')).toBe(null);
    expect(m.setQuantityAt(items, 0, 99, undefined)).toBe(null);
    expect(m.setQuantityAt([], 0, 99, 'Cornetti')).toBe(null);
    expect(m.setQuantityAt(null, 0, 99, 'Cornetti')).toBe(null);
  });

  test('the name check forgives capitals and spaces, like the duplicate check does', () => {
    const items = [{ name: 'Pain au chocolat', qty: 5 }];
    expect(m.setQuantityAt(items, 0, 8, '  pain AU chocolat '))
      .toStrictEqual([{ name: 'Pain au chocolat', qty: 8 }]);
  });

  test('a quantity set from the list is cleaned like any other', () => {
    const items = [{ name: 'Cornetti', qty: 24 }];
    expect(m.setQuantityAt(items, 0, '18', 'Cornetti')?.[0]?.qty).toBe(18);
    expect(m.setQuantityAt(items, 0, 18.6, 'Cornetti')?.[0]?.qty).toBe(19);
    expect(m.setQuantityAt(items, 0, 1e999, 'Cornetti')?.[0]?.qty).toBe(0);
    expect(m.setQuantityAt(items, 0, -4, 'Cornetti')?.[0]?.qty).toBe(0);
  });

  test('what survives cleaning is exactly what a save would accept', () => {
    // The round trip the editor relies on: clean, then validate, then store.
    const typed = [
      { name: '  Cornetti  ', qty: '24' },
      { name: '', qty: '' },
      { name: 'Bomboloni', qty: 10.4 },
    ];
    const clean = m.cleanItems(typed);
    expect(m.findInvalidItems(clean)).toBe(null);
    expect(clean).toStrictEqual([{ name: 'Cornetti', qty: 24 }, { name: 'Bomboloni', qty: 10 }]);
    expect(m.normalizeDay({ items: clean }, 'Monday').items).toStrictEqual(clean);
  });

  // ── Added ──────────────────────────────────────────────────────────────────
  // The original's tests read every limit through the module itself, so a limit changed in one
  // file would move the test with it. These pin the numbers, and that the lists are frozen.

  test('the limits are the ones the rules and the screens were built on', () => {
    expect(m.MAX_ITEMS).toBe(100);
    expect(m.MAX_NAME_LENGTH).toBe(80);
    expect(m.MAX_QTY).toBe(9999);
    expect(m.MAX_NOTE_LENGTH).toBe(500);
  });

  test('the two weekday lists cannot be changed by a caller', () => {
    expect(Object.isFrozen(m.WEEKDAYS)).toBe(true);
    expect(Object.isFrozen(m.WEEKDAY_SHORT)).toBe(true);
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port against the original', () => {
  // The two functions that need the interface dictionary and so stay in js/ until the switch.
  const LEFT_OUT = ['weekdayLabel', 'weekdayShortLabel'];
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;
  const shared = Object.keys(original).filter(name => !LEFT_OUT.includes(name)).sort();

  test('the original still exports the two label functions this port leaves out', () => {
    // If it did not, the exclusion above would be hiding a rename instead of a decision.
    for (const name of LEFT_OUT) expect(typeof original[name], name).toBe('function');
  });

  test('exports exactly the same names, except those two', () => {
    expect(Object.keys(port).sort()).toStrictEqual(shared);
  });

  test('every non-function export is strictly equal and frozen the same way', () => {
    for (const name of shared) {
      if (typeof original[name] === 'function') continue;
      expect(port[name], name).toStrictEqual(original[name]);
      expect(Object.isFrozen(port[name]), `${name}: frozen`).toBe(Object.isFrozen(original[name]));
    }
  });

  test('every function has the same name and the same number of required parameters', () => {
    for (const name of shared) {
      const mine = port[name];
      const theirs = original[name];
      if (typeof mine !== 'function' || typeof theirs !== 'function') continue;
      expect(mine.name, name).toBe(theirs.name);
      expect(mine.length, `${name}: arity`).toBe(theirs.length);
    }
  });
});
