import type { Language } from '../i18n/i18n';

// A dough's «when», shown in the interface language.
//
// ⚠️ THE STORED TEXT STAYS ENGLISH («Tuesday 13 October», «11:11 PM» — shared/src/log-time.ts): the current app and
// Mise 2 read each other's logs until the switch, so what is written must not change. Shown as written, an Italian
// venue read English dates in Dough history (driven on the lab tablet, 14 Oct 2026, beside a header that said
// «martedì 13 ottobre»). So the SCREEN translates: the English names are read back and said again in Italian, with
// the 24-hour clock Italy uses. Anything that does not read as that shape is shown exactly as stored — a guess at a
// date nobody can check is worse than the original words.
const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_IT = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const MONTHS_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

export function localDate(date: string, lang: Language): string {
  if (lang !== 'it') return date;
  const m = /^(\w+) (\d{1,2}) (\w+)$/.exec(date.trim());
  if (!m) return date;
  const day = DAYS_EN.indexOf(m[1] ?? '');
  const month = MONTHS_EN.indexOf(m[3] ?? '');
  if (day < 0 || month < 0) return date;
  return `${DAYS_IT[day]} ${Number(m[2])} ${MONTHS_IT[month]}`;
}

export function localTime(time: string, lang: Language): string {
  if (lang !== 'it') return time;
  const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(time.trim());
  if (!m) return time;
  const hour12 = Number(m[1]);
  if (hour12 < 1 || hour12 > 12) return time;
  const hour = (hour12 % 12) + (m[3] === 'PM' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${m[2]}`;
}
