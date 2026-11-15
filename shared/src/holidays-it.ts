// holidays-it.ts — the twelve Italian national public holidays, worked out here.
// TypeScript FULL port of js/orders/holidays-it.js for Mise 2 (step 3f-6, Reminders). Behaviour is identical, input for input:
// holidays-it.spec.ts runs every test against BOTH files and parity.spec.ts pairs them.
//
// PURE, ZERO IMPORTS, and no network. Federico, 24 Aug 2026, looking at the Orders screen of Panificio Miano: «mi sta suggerendo
// le festivita' in uk ma dovrebbe suggerirmi le festivita' in Italia».
//
// ⚠️⚠️ WHY THIS IS COMPUTED WHILE THE UK LIST IS FETCHED. The UK publishes its calendar as an official machine-readable feed and
// it MUST be fetched because the UK moves holidays about (a Christmas Day on a Saturday is substituted to the Monday; one-off
// holidays are declared by proclamation). Italy does neither: the twelve are set by law (L. 260/1949 and its amendments), they
// never move, and there is no official feed to read. So the honest shape is the opposite of the UK's — arithmetic, not a download.
//
// ⚠️ WHAT IS DELIBERATELY MISSING: THE PATRON SAINT'S DAY. Every Italian comune has one and it is a real public holiday there —
// San Giovanni on 24 June in Turin, Sant'Ambrogio on 7 December in Milan, Santa Rosalia on 15 July in Palermo. It is not here
// because the app knows a venue's COUNTRY and not its town, and a holiday list that guessed the town would be wrong for almost
// everybody who read it. The twelve national ones are true everywhere in Italy.

// The ten that never move, as MM-DD. Sunday or not, they are still the days the suppliers are shut, which is what this list is read for.
const FIXED: readonly string[] = Object.freeze([
  '01-01', // Capodanno
  '01-06', // Epifania
  '04-25', // Festa della Liberazione
  '05-01', // Festa dei Lavoratori
  '06-02', // Festa della Repubblica
  '08-15', // Ferragosto (Assunzione)
  '11-01', // Ognissanti
  '12-08', // Immacolata Concezione
  '12-25', // Natale
  '12-26', // Santo Stefano
]);

// The Gregorian calendar begins in 1583; the algorithm below is stated for years up to 4099. Outside that a year is not a real
// year at all — a parsed date that came out as junk, most likely — and the answer is an empty calendar, never a throw.
const FIRST_YEAR = 1583;
const LAST_YEAR = 4099;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// Easter Sunday in the Gregorian calendar, by the Meeus/Jones/Butcher algorithm.
//
// ⚠️ THE STANDARD ALGORITHM, NOT ONE OF OUR OWN, AND THAT IS THE POINT (P19). Easter depends on the ecclesiastical full moon
// rather than the astronomical one, so every "simplification" of it is wrong in some year nobody tests. This is the published
// form, transcribed unchanged; the spec checks it against twenty years of known dates, including both extremes it can reach —
// 22 March and 25 April.
export function easterSunday(year: unknown): string | null {
  const y = Math.trunc(Number(year));
  if (!Number.isFinite(y) || y < FIRST_YEAR || y > LAST_YEAR) return null;

  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return `${y}-${pad(month)}-${pad(day)}`;
}

// Easter Monday — «Lunedì dell'Angelo», or Pasquetta. The twelfth holiday, and the only one of the twelve that most people
// actually take off work.
//
// ⚠️ BUILT WITH Date, NOT BY ADDING ONE TO THE DAY NUMBER. Easter can fall on 31 March, and 32 March is not a date. Constructed
// at midday local time so that no timezone this app is read in can push it onto the day before.
export function easterMonday(year: unknown): string | null {
  const sunday = easterSunday(year);
  if (!sunday) return null;
  const [y, m, d] = sunday.split('-').map(Number) as [number, number, number];
  const monday = new Date(y, m - 1, d + 1, 12, 0, 0);
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

// One year's calendar is the same every time it is asked for, and a paint asks up to twenty-one times (a 7-day look-ahead and a
// 14-day conflict window). Worked out once per year, then kept.
const byYear = new Map<number, readonly string[]>();

// The twelve national holidays of `year`, as sorted ISO dates. An impossible year answers an empty list — the same direction as
// everything else in this app: say nothing rather than say something made up.
export function italianHolidays(year: unknown): readonly string[] {
  const y = Math.trunc(Number(year));
  if (!Number.isFinite(y) || y < FIRST_YEAR || y > LAST_YEAR) return [];
  const known = byYear.get(y);
  if (known) return known;

  const dates = FIXED.map(md => `${y}-${md}`);
  const sunday = easterSunday(y);
  const monday = easterMonday(y);
  if (sunday) dates.push(sunday);
  if (monday) dates.push(monday);

  // ⚠️ SORTED, BECAUSE EASTER IS APPENDED AT THE END. Everything that reads a calendar looks for "the next one", and the UK list
  // arrives sorted from gov.uk.
  //
  // ⚠️⚠️ AND DE-DUPLICATED, BECAUSE TWO OF THE TWELVE CAN LAND ON THE SAME DAY. Easter falls on 25 April roughly three times a
  // century — 1886, 1943, and next in 2038 — which is also the Festa della Liberazione. Twelve rules, eleven days.
  const sorted = Object.freeze([...new Set(dates)].sort());
  byYear.set(y, sorted);
  return sorted;
}

// Exported for the test that counts them. Twelve is a fact about Italian law, not an implementation detail.
//
// ⚠️ IT COUNTS THE RULES, NOT THE DAYS, and in most years those are the same number. In a year where Easter lands on 25 April
// the twelve rules name eleven distinct days.
export const ITALIAN_HOLIDAY_COUNT: number = FIXED.length + 2;
