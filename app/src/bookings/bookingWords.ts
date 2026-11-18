// The words and numbers a booking is shown with (18 Nov 2026). Pure, handed the locale and the words it needs.
//
// ⚠️ TWO LANGUAGES, AS EVERYWHERE (i18n-labels): the screen's words follow t() and its locale (the interface); on the
// printed slips the unit word follows the venue's COUNTRY (`slipUnitWord`, through outputLanguage), as every word that
// travels with the food does. The product names themselves are printed as stored — the venue's recipe book, written in
// the venue's own words.

import { outputLanguage } from '@mise/shared/market';
import { parseISODate } from '@mise/shared/day';
import type { BookingLine, BookingUnit } from './bookingModel';

// «mercoledì 18 novembre» / «Wednesday 18 November», in the interface's locale.
export function spellDate(iso: string, locale: string): string {
  const date = parseISODate(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

// «18/11/2026» — the short form a slip carries beside the time.
export function shortDate(iso: string, locale: string): string {
  const date = parseISODate(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

// A quantity with its unit: «2 pz», «1,5 kg». At most three decimals (grams). Never NaN.
export function qtyText(qty: number, unit: BookingUnit, locale: string, unitWord: (unit: BookingUnit) => string): string {
  const n = Number.isFinite(qty) ? qty : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(n)} ${unitWord(unit)}`;
}

// The list row's short summary: the first two lines, then «+3 more».
export const SUMMARY_LINES = 2;

export function linesSummary(
  lines: readonly BookingLine[],
  locale: string,
  unitWord: (unit: BookingUnit) => string,
): { readonly text: string; readonly more: number } {
  const shown = lines.slice(0, SUMMARY_LINES).map(line => `${qtyText(line.qty, line.unit, locale, unitWord)} ${line.name}`);
  return { text: shown.join(', '), more: Math.max(0, lines.length - SUMMARY_LINES) };
}

// The unit on a printed slip, in the language of the venue's country: «pz» in Italy, «pcs» elsewhere; «kg» everywhere.
// Read while drawing, never at module load (no venue is open then).
export function slipUnitWord(location: unknown): (unit: BookingUnit) => string {
  const lang = outputLanguage(location);
  return unit => (unit === 'kg' ? 'kg' : lang === 'it' ? 'pz' : 'pcs');
}

// The locale the slip's numbers and dates are printed in: the venue's country's language, like its words.
export function slipLocale(location: unknown, fallback: string): string {
  const lang = outputLanguage(location);
  return lang === 'it' ? 'it-IT' : lang === 'en' ? 'en-GB' : fallback;
}
