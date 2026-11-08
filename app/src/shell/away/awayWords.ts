import { dayFromISO } from '@mise/shared/away-reminder';

// «16 November» / «16 novembre», in the language the screen speaks. The stored 2026-11-16 is for machines; people read the day and the
// long month (the current app's awayDayLabel). `locale` is the INTERFACE's (useT().locale): a holiday is a fact about the person, not
// about food, so it never follows the venue's country.
export function awayDayLabel(until: string | null, locale: string): string {
  const day = dayFromISO(until);
  return day ? day.toLocaleDateString(locale, { day: 'numeric', month: 'long' }) : String(until ?? '');
}
