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
