// log-time.ts — pure timestamp formatting for the log. PURE: no DOM, no storage, no Firebase.
//
// TypeScript FULL port of js/log-time.js for Mise 2. Behaviour is identical, input for input:
// log-time.spec.ts runs every test against BOTH files and parity.spec.ts compares their exports.
//
// ⚠️ THE STORED TEXT IS ENGLISH WHATEVER THE INTERFACE LANGUAGE ("Monday 09 June", "2:05 PM"). The current
// app and Mise 2 read each other's logs until the switch, so the text written into a log document must stay
// byte-identical; showing it in another language is a screen's business, never this function's.

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface LogTimestamp {
  date: string;
  time: string;
}

// Formats a Date as { date: "Monday 09 June", time: "2:05 PM" }. Time is 12-hour with an AM/PM suffix:
// midnight/noon read as 12, minutes padded.
export function logTimestamp(now: Date = new Date()): LogTimestamp {
  const d = String(now.getDate()).padStart(2, '0');
  const period = now.getHours() < 12 ? 'AM' : 'PM';
  const hour12 = now.getHours() % 12 || 12;
  const t = hour12 + ':' + String(now.getMinutes()).padStart(2, '0') + ' ' + period;
  return { date: `${DAY[now.getDay()]} ${d} ${MON[now.getMonth()]}`, time: t };
}

// ⚠️ WHAT IS STORED STAYS ENGLISH; THE SCREEN SAYS IT IN THE INTERFACE LANGUAGE (current app 021a49ff, 31 Oct 2026).
// logTimestamp above writes «Saturday 31 October» / «8:19 PM» into every log version, and both apps read the same logs,
// so the stored text must not change. Shown as written, an Italian venue read English dates in the Dough history. So the
// screen reads the English names back and says them again with Intl, in the interface language, on the 24-hour clock.
// Anything that does not read as that shape (an old or hand-made entry) is shown exactly as stored: a guess at a date
// nobody can check is worse than the original words.
//
// Every Date below is built in UTC and formatted in UTC, so the device's zone can never move a name by a day. The stored
// text has no year, so the weekday comes from a reference week (1 Jan 2023 was a Sunday) and the month from a reference
// year: only the NAMES are used.
//
// ⚠️ THE LANGUAGE IS AN ARGUMENT, never read from the module: the original reads the open venue's language, Mise 2 keeps
// no venue fact in a module variable. The default is English (the stored text as it is), like `formatGrams`.
const LOCALE_TAG: Readonly<Record<string, string>> = { it: 'it-IT', en: 'en-GB' };
const localeOf = (lang: string): string => (lang === 'it' ? LOCALE_TAG.it! : LOCALE_TAG.en!);

const formatters = new Map<string, Intl.DateTimeFormat>();
function intlName(lang: string, date: Date, options: Intl.DateTimeFormatOptions): string {
  const key = lang + '|' + JSON.stringify(options);
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(localeOf(lang), { ...options, timeZone: 'UTC' });
    formatters.set(key, formatter);
  }
  return formatter.format(date);
}

// «Saturday 31 October» → «sabato 31 ottobre» in Italian; English is shown as stored.
export function localLogDate(date: unknown, lang: string): string {
  const text = String(date || '');
  if (lang !== 'it') return text;
  const m = /^(\w+) (\d{1,2}) (\w+)$/.exec(text.trim());
  if (!m) return text;
  const day = DAY.indexOf(m[1] as string);
  const month = MON.indexOf(m[3] as string);
  if (day < 0 || month < 0) return text;
  const weekday = intlName(lang, new Date(Date.UTC(2023, 0, 1 + day)), { weekday: 'long' });
  const monthName = intlName(lang, new Date(Date.UTC(2026, month, 1)), { month: 'long' });
  return `${weekday} ${Number(m[2])} ${monthName}`;
}

// «8:19 PM» → «20:19» in Italian; English is shown as stored.
export function localLogTime(time: unknown, lang: string): string {
  const text = String(time || '');
  if (lang !== 'it') return text;
  const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(text.trim());
  if (!m) return text;
  const hour12 = Number(m[1]);
  const minute = Number(m[2]);
  if (hour12 < 1 || hour12 > 12 || minute > 59) return text;
  const hour = (hour12 % 12) + (m[3] === 'PM' ? 12 : 0);
  return intlName(lang, new Date(Date.UTC(2026, 0, 1, hour, minute)), {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
}

// The «when» line of a log version, as every Dough history screen shows it: «date — time».
export function logStampText(at: { date?: unknown; time?: unknown } | null | undefined, lang: string = 'en'): string {
  const a = at || {};
  return localLogDate(a.date, lang) + ' — ' + localLogTime(a.time, lang);
}
