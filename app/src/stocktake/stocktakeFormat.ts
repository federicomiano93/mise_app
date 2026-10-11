// How the Stocktake writes numbers and months, in the interface language's locale (a quantity
// follows the language: «3,5» in Italian). Pure, and keyed by the locale it is handed, so nothing
// here freezes the language the page booted in.

const formats = new Map<string, Intl.NumberFormat>();

function formatFor(locale: string, grouping: boolean): Intl.NumberFormat {
  const key = `${locale}|${grouping ? 'grouped' : 'plain'}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, { maximumFractionDigits: 3, useGrouping: grouping });
    formats.set(key, format);
  }
  return format;
}

// A number to READ on a row: 3 stays 3, 3.5 becomes «3,5» in Italian, a thousand has its separator.
// «—» for a figure that is not known.
export function displayNumber(value: number | null, locale: string): string {
  return value === null ? '—' : formatFor(locale, true).format(value);
}

// ⚠️ A NUMBER IN A BOX A PERSON EDITS NEVER HAS A THOUSANDS SEPARATOR (v1.107.0): readCount() reads
// the one mark it finds as the decimal, so a grouped «1.234,5» could not be read back and «1,234»
// edited to «1,235» would be taken for 1.235. This is the text of a box, every time it is written
// into one — after an update from another phone too. '' for a count nobody has made.
export function boxText(value: number | null, locale: string): string {
  return value === null ? '' : formatFor(locale, false).format(value);
}

// «October 2026», in the platform's own words for the interface language: no month name is written
// in the code or the dictionary. Day 1 at midday keeps the date clear of both clock changes.
export function monthName(monthId: string, locale: string): string {
  const [year = 1970, month = 1] = monthId.split('-').map(Number);
  return new Date(year, month - 1, 1, 12, 0, 0).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}
