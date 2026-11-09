// Unit tests for the Orders day helpers (P15), run against BOTH implementations: the TypeScript port in shared/
// and js/orders/day.js, which the live app uses today. Ported from tests/orders-day.test.mjs and
// tests/day-words.test.mjs.
//
// day.ts is an ADAPTED port, so parity.spec.ts does not pair it: the seven functions that spell a day take the
// translate function as their LAST argument (the original reads the interface dictionary). Here each of them is
// run for the original as it is, after `setLanguage(...)`, and for the port with the original's own `t` handed
// in — and both must give the same text. The arithmetic is compared input by input in odd-inputs.spec.ts too.
//
// PORTED: 16 of 16 tests of tests/orders-day.test.mjs and 9 of 9 of tests/day-words.test.mjs. Added: the two
// functions neither file tests (spellShortDate, spellLongDate), compared with the original in both languages.
//
// An order is filed under a DAY, so a bug here files it under the wrong date — the exact thing this feature
// exists to prevent. The timezone trap these lock down: `new Date('2026-07-13')` is UTC midnight, which is 12
// July locally west of Greenwich. Every helper must go through local getters, so the assertions below hold
// whatever timezone the machine/CI runs in.

import { describe, expect, test } from 'vitest';
import * as ported from './day';
import * as legacyJs from '../../js/orders/day.js';
import { DEFAULT_LANGUAGE, setLanguage, t } from '../../js/i18n.js';

// The words of an implementation, behind one signature: the original reads the dictionary itself, the port is
// handed it.
interface Impl {
  readonly toISODate: (d: Date) => string;
  readonly parseISODate: (iso: string) => Date;
  readonly todayISO: (d?: Date) => string;
  readonly addDays: (d: Date, n: number) => Date;
  readonly isBefore: (a?: unknown, b?: unknown) => boolean;
  readonly weekdayOf: (iso: string) => string | undefined;
  readonly localDayOf: (ts?: unknown) => string;
  readonly spellDay: (iso: string) => string;
  readonly spellShortDate: (iso: string) => string;
  readonly spellLongDate: (iso: string) => string;
  readonly dayLabel: (iso: string, now?: Date) => string;
  readonly daySpoken: (iso: string, now?: Date) => string;
  readonly dayWhen: (iso: string, now?: Date) => string;
  readonly dayPhrase: (iso: string, now?: Date) => string;
}

const original = legacyJs as unknown as Record<string, (...a: unknown[]) => never>;
const IMPLS: ReadonlyArray<readonly [string, Impl]> = [
  ['shared/ (TypeScript)', {
    toISODate: ported.toISODate,
    parseISODate: ported.parseISODate,
    todayISO: ported.todayISO,
    addDays: ported.addDays,
    isBefore: ported.isBefore,
    weekdayOf: ported.weekdayOf,
    localDayOf: ported.localDayOf as (ts?: unknown) => string,
    spellDay: iso => ported.spellDay(iso, t),
    spellShortDate: iso => ported.spellShortDate(iso, t),
    spellLongDate: iso => ported.spellLongDate(iso, t),
    dayLabel: (iso, now) => ported.dayLabel(iso, now, t),
    daySpoken: (iso, now) => ported.daySpoken(iso, now, t),
    dayWhen: (iso, now) => ported.dayWhen(iso, now, t),
    dayPhrase: (iso, now) => ported.dayPhrase(iso, now, t),
  }],
  ['js/ (current app)', {
    toISODate: original.toISODate!, parseISODate: original.parseISODate!, todayISO: original.todayISO!,
    addDays: original.addDays!, isBefore: original.isBefore!, weekdayOf: original.weekdayOf!,
    localDayOf: original.localDayOf!, spellDay: original.spellDay!, spellShortDate: original.spellShortDate!,
    spellLongDate: original.spellLongDate!, dayLabel: original.dayLabel!, daySpoken: original.daySpoken!,
    dayWhen: original.dayWhen!, dayPhrase: original.dayPhrase!,
  }],
];

const NOW = new Date('2026-08-14T09:00:00');
const TODAY = '2026-08-14';
const YESTERDAY = '2026-08-13';
const A_SATURDAY = '2026-07-11';

function inLanguage<T>(lang: string, fn: () => T): T {
  setLanguage(lang);
  try { return fn(); } finally { setLanguage(DEFAULT_LANGUAGE); }
}

describe.each(IMPLS)('%s', (_name, m) => {
  test('toISODate reads a Date with local getters', () => {
    expect(m.toISODate(new Date(2026, 6, 13))).toBe('2026-07-13');
    expect(m.toISODate(new Date(2026, 0, 5))).toBe('2026-01-05'); // zero-padded
  });

  test('parseISODate lands on LOCAL midnight, not UTC midnight', () => {
    const d = m.parseISODate('2026-07-13');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(13); // would be the 12th if parsed as UTC
    expect(d.getHours()).toBe(0);
  });

  test('an ISO day survives a round trip through parse and format', () => {
    expect(m.toISODate(m.parseISODate('2026-07-13'))).toBe('2026-07-13');
  });

  test('todayISO is today', () => {
    expect(m.todayISO(new Date(2026, 6, 13, 23, 55))).toBe('2026-07-13');
  });

  test('addDays crosses month and year boundaries', () => {
    expect(m.toISODate(m.addDays(new Date(2026, 6, 31), 1))).toBe('2026-08-01');
    expect(m.toISODate(m.addDays(new Date(2026, 0, 1), -1))).toBe('2025-12-31');
  });

  test('addDays is DST-safe (British Summer Time starts 29 March 2026)', () => {
    // The clocks go forward overnight, so that day is 23 hours long. Adding
    // 86 400 000 ms would land on the same calendar day; setDate must not.
    expect(m.toISODate(m.addDays(new Date(2026, 2, 29), 1))).toBe('2026-03-30');
    expect(m.toISODate(m.addDays(new Date(2026, 9, 25), 1))).toBe('2026-10-26'); // clocks back
  });

  test('isBefore compares ISO days, and is false for equal or missing days', () => {
    expect(m.isBefore('2026-07-12', '2026-07-13')).toBe(true);
    expect(m.isBefore('2026-07-13', '2026-07-13')).toBe(false);
    expect(m.isBefore('2026-07-14', '2026-07-13')).toBe(false);
    expect(m.isBefore('2025-12-31', '2026-01-01')).toBe(true);
    expect(m.isBefore('', '2026-07-13')).toBe(false);
    expect(m.isBefore(undefined, '2026-07-13')).toBe(false);
  });

  test('weekdayOf names the day the supplier orderDays use', () => {
    expect(m.weekdayOf('2026-07-13')).toBe('Monday');
    expect(m.weekdayOf('2026-07-19')).toBe('Sunday');
  });

  test('dayLabel says Today and Yesterday', () => {
    const now = new Date(2026, 6, 13, 9, 30);
    expect(m.dayLabel('2026-07-13', now)).toBe('Today');
    expect(m.dayLabel('2026-07-12', now)).toBe('Yesterday');
  });

  test('dayLabel spells out any other day, identically on every device', () => {
    const now = new Date(2026, 6, 13);
    expect(m.dayLabel('2026-07-06', now)).toBe('Mon 6 Jul 2026');
    expect(m.dayLabel('2025-12-31', now)).toBe('Wed 31 Dec 2025');
  });

  test('dayLabel handles a missing or unreadable day without throwing', () => {
    expect(m.dayLabel('', new Date(2026, 6, 13))).toBe('');
    expect(m.dayLabel('not-a-date', new Date(2026, 6, 13))).toBe('not-a-date');
  });

  test('spellDay always spells the date out, never "Today"', () => {
    // The legacy weekly card names its week, where "Today" would be meaningless.
    expect(m.spellDay('2026-07-13')).toBe('Mon 13 Jul 2026');
    expect(m.spellDay('')).toBe('');
  });

  test('dayPhrase reads inside a sentence, and every confirm uses it', () => {
    const now = new Date(2026, 6, 13);
    // "Record Alba's order for yesterday?" — not "...order yesterday?".
    expect(m.dayPhrase('2026-07-13', now)).toBe('for today');
    expect(m.dayPhrase('2026-07-12', now)).toBe('for yesterday');
    expect(m.dayPhrase('2026-07-06', now)).toBe('for Mon 6 Jul 2026');
    expect(m.dayPhrase('', now)).toBe('');
  });

  test('a spoken day keeps a real date\'s capitals — "sat 11 jul 2026" reads like a typo', () => {
    const now = new Date(2026, 6, 13);
    expect(m.daySpoken('2026-07-13', now)).toBe('today');
    expect(m.daySpoken('2026-07-12', now)).toBe('yesterday');
    expect(m.daySpoken('2026-07-11', now)).toBe('Sat 11 Jul 2026');
    expect(m.daySpoken('', now)).toBe('');
  });

  test('dayWhen adds the preposition a date needs, and a relative day does not', () => {
    const now = new Date(2026, 6, 13);
    // "3 items typed yesterday" — but "3 items typed ON Sat 11 Jul 2026".
    expect(m.dayWhen('2026-07-12', now)).toBe('yesterday');
    expect(m.dayWhen('2026-07-13', now)).toBe('today');
    expect(m.dayWhen('2026-07-11', now)).toBe('on Sat 11 Jul 2026');
    expect(m.dayWhen('', now)).toBe('');
  });

  test('localDayOf reads the local day of a draft timestamp', () => {
    // Midday UTC is the same calendar day in every timezone the bakery could be in.
    expect(m.localDayOf('2026-07-12T12:00:00.000Z')).toBe('2026-07-12');
    expect(m.localDayOf('')).toBe('');
    expect(m.localDayOf(null)).toBe('');
    expect(m.localDayOf('rubbish')).toBe('');
  });

  // ── tests/day-words.test.mjs ───────────────────────────────────────────────

  // ⚠️⚠️ THE WHOLE POINT IS THE FIRST TEST. `weekdayOf()` returns 'Monday', and that string is DATA: it is stored
  // on every supplier (orderDays/deliveryDays) and it is the document id of a proving list (pastries/Monday).
  // Translating it would not change a label — it would make a Monday supplier never match a Monday, and all seven
  // proving lists unreachable, with the app cheerfully showing seven empty days.
  test('⚠️ weekdayOf stays ENGLISH in every language — it is an identifier, not a word', () => {
    const days = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'];
    const english = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    expect(days.map(m.weekdayOf)).toStrictEqual(english);
    // The same call, with the app in Italian, must answer identically. A supplier
    // ordered on Monday is stored as 'Monday'.
    expect(inLanguage('it', () => days.map(m.weekdayOf)),
      'weekdayOf was translated — every supplier’s ordering day would stop matching').toStrictEqual(english);
  });

  test('today and yesterday follow the language', () => {
    expect(m.dayLabel(TODAY, NOW)).toBe('Today');
    expect(m.dayLabel(YESTERDAY, NOW)).toBe('Yesterday');
    expect(inLanguage('it', () => m.dayLabel(TODAY, NOW))).toBe('Oggi');
    expect(inLanguage('it', () => m.dayLabel(YESTERDAY, NOW))).toBe('Ieri');
  });

  test('a spelled-out date follows the language, and keeps its own shape', () => {
    expect(m.spellDay(A_SATURDAY)).toBe('Sat 11 Jul 2026');
    expect(inLanguage('it', () => m.spellDay(A_SATURDAY))).toBe('sab 11 lug 2026');
  });

  // ⚠️ THE FORM INSIDE A SENTENCE IS ASKED FOR, NEVER COMPUTED. The old code called
  // .toLowerCase() on the label — a language-specific operation performed on somebody else's language.
  test('the mid-sentence form comes from the dictionary, not from toLowerCase()', () => {
    expect(m.daySpoken(TODAY, NOW)).toBe('today');
    expect(inLanguage('it', () => m.daySpoken(TODAY, NOW))).toBe('oggi');
    // A date is a NAME and keeps its own capital — lowercasing the lot would give
    // "sat 11 jul 2026", which reads like a typo.
    expect(m.daySpoken(A_SATURDAY, NOW)).toBe('Sat 11 Jul 2026');
  });

  // ⚠️ WHOLE PHRASES. English puts nothing before "today" and "on" before a date; Italian puts "il" before the
  // date. Gluing a preposition in code decides that for every language at once.
  test('the preposition belongs to the language, not to the code', () => {
    expect(m.dayWhen(TODAY, NOW)).toBe('today');
    expect(m.dayWhen(A_SATURDAY, NOW)).toBe('on Sat 11 Jul 2026');
    expect(inLanguage('it', () => m.dayWhen(TODAY, NOW))).toBe('oggi');
    expect(inLanguage('it', () => m.dayWhen(A_SATURDAY, NOW))).toBe('il sab 11 lug 2026');
  });

  test('"for that day" is one phrase in each language', () => {
    expect(m.dayPhrase(TODAY, NOW)).toBe('for today');
    expect(m.dayPhrase(A_SATURDAY, NOW)).toBe('for Sat 11 Jul 2026');
    expect(inLanguage('it', () => m.dayPhrase(TODAY, NOW))).toBe('per oggi');
    expect(inLanguage('it', () => m.dayPhrase(A_SATURDAY, NOW))).toBe('per sab 11 lug 2026');
  });

  // ⚠️ THE DECISION IS MADE ON THE DAY, NOT ON THE PRINTED WORD. dayWhen used to ask whether the spoken form
  // equalled the string 'today' — which stopped being true the moment it could be «oggi», and would have quietly
  // produced "on oggi".
  test('«oggi» is still recognised as a named day, so no preposition is glued to it', () => {
    const it = inLanguage('it', () => m.dayWhen(TODAY, NOW));
    expect(it).toBe('oggi');
    expect(/^il /.test(it), 'a preposition was glued to a named day').toBe(false);
  });

  test('nothing at all still produces nothing, in either language', () => {
    for (const lang of ['en', 'it']) {
      inLanguage(lang, () => {
        expect(m.dayLabel('', NOW)).toBe('');
        expect(m.daySpoken('', NOW)).toBe('');
        expect(m.dayWhen('', NOW)).toBe('');
        expect(m.dayPhrase('', NOW)).toBe('');
        expect(m.spellDay('')).toBe('');
      });
    }
  });

  test('an unparseable date is handed back rather than printed as 1970', () => {
    expect(m.spellDay('not-a-date')).toBe('not-a-date');
  });
});

describe('the port against the original', () => {
  const [, mine] = IMPLS[0]!;
  const [, theirs] = IMPLS[1]!;

  test('spellShortDate and spellLongDate give the original\'s text in both languages, for every day of a week', () => {
    const days = ['2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-12-31', '', 'not-a-date'];
    for (const lang of ['en', 'it']) {
      inLanguage(lang, () => {
        for (const day of days) {
          expect(mine.spellShortDate(day), `${lang} short ${day}`).toBe(theirs.spellShortDate(day));
          expect(mine.spellLongDate(day), `${lang} long ${day}`).toBe(theirs.spellLongDate(day));
        }
      });
    }
    expect(inLanguage('en', () => mine.spellShortDate('2026-07-13'))).toBe('Mon 13');
    expect(inLanguage('en', () => mine.spellLongDate('2026-07-13'))).toBe('Monday 13 July');
  });

  test('every word function omitting the date gets today, like the original', () => {
    const today = new Date();
    expect(ported.dayLabel(ported.toISODate(today), undefined, t)).toBe(legacyJs.dayLabel(ported.toISODate(today)));
    expect(ported.dayPhrase(ported.toISODate(today), undefined, t)).toBe(legacyJs.dayPhrase(ported.toISODate(today)));
  });

  test('exports the arithmetic and the seven word functions, under the original\'s names', () => {
    const originalNames = Object.keys(legacyJs).sort();
    expect(Object.keys(ported).sort()).toStrictEqual(originalNames);
    for (const name of originalNames) expect(typeof (ported as Record<string, unknown>)[name], name).toBe('function');
  });
});
