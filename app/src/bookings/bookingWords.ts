// The words and numbers a booking is shown with (18 Nov 2026). Pure, handed the locale and the words it needs.
//
// ⚠️ TWO LANGUAGES, AS EVERYWHERE (i18n-labels): the screen's words follow t() and its locale (the interface); on the
// printed slips the unit word follows the venue's COUNTRY (`slipUnitWord`, through outputLanguage), as every word that
// travels with the food does. The product names themselves are printed as stored — the venue's recipe book, written in
// the venue's own words.

import { outputLanguage } from '@mise/shared/market';
import { parseISODate } from '@mise/shared/day';
import { formatWeight } from '@mise/shared/price-list';
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

// The words a quantity is written with: the unit's short word («pz», «kg») and the word for packs, by how many («1 confezione»,
// «3 confezioni»).
export type UnitWords = {
  readonly unit: (unit: BookingUnit) => string;
  readonly packs: (n: number) => string;
};

const numberIn = (locale: string, n: number): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(Number.isFinite(n) ? n : 0);

// A line's quantity with its unit: «2 pz», «1,5 kg», and for a product sold by the pack «3 confezioni (250 g)» (the owner's choice,
// 18 Nov 2026: the lab must know a pack is not a piece). At most three decimals (grams). Never NaN.
// A piece of a chosen weight (bookings rebuild step 2) says it the same way: «3 pz (1,5 kg)», the weight of ONE piece.
export function lineQtyText(
  line: {
    readonly qty: number; readonly unit: BookingUnit; readonly packSize: number | null; readonly packUnit: string | null;
    readonly weightKg?: number | null;
  },
  locale: string,
  words: UnitWords,
): string {
  if (line.weightKg !== undefined && line.weightKg !== null) {
    return `${numberIn(locale, line.qty)} ${words.unit(line.unit)} (${formatWeight(line.weightKg, locale)})`;
  }
  if (line.packSize !== null && line.packUnit !== null) {
    const size = `${numberIn(locale, line.packSize)} ${line.packUnit === 'pcs' ? words.unit('pcs') : line.packUnit}`;
    return `${numberIn(locale, line.qty)} ${words.packs(line.qty)} (${size})`;
  }
  return `${numberIn(locale, line.qty)} ${words.unit(line.unit)}`;
}

// The list row's short summary: the first two lines, then «+3 more».
export const SUMMARY_LINES = 2;

export function linesSummary(
  lines: readonly BookingLine[],
  locale: string,
  words: UnitWords,
): { readonly text: string; readonly more: number } {
  const shown = lines.slice(0, SUMMARY_LINES).map(line => `${lineQtyText(line, locale, words)} ${line.name}`);
  return { text: shown.join(', '), more: Math.max(0, lines.length - SUMMARY_LINES) };
}

// The units on a printed slip, in the language of the venue's country: «pz» / «confezione(i)» in Italy, «pcs» / «pack(s)»
// elsewhere; «kg» everywhere. Read while drawing, never at module load (no venue is open then).
export function slipUnitWords(location: unknown): UnitWords {
  const it = outputLanguage(location) === 'it';
  return {
    unit: unit => (unit === 'kg' ? 'kg' : it ? 'pz' : 'pcs'),
    packs: n => (it ? (n === 1 ? 'confezione' : 'confezioni') : (n === 1 ? 'pack' : 'packs')),
  };
}

// The locale the slip's numbers and dates are printed in: the venue's country's language, like its words.
export function slipLocale(location: unknown, fallback: string): string {
  const lang = outputLanguage(location);
  return lang === 'it' ? 'it-IT' : lang === 'en' ? 'en-GB' : fallback;
}
