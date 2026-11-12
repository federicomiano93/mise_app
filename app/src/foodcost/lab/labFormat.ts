// Numbers as the lab writes them: grams with a thousands separator and at most one decimal («1.234,5 g» in Italian, «1,234.5 g» in
// English). Written by hand, not with Intl's `useGrouping: 'always'` (Chrome 106): Italian's own rule leaves four digits ungrouped, and
// the lab tablet's Chrome 101 would not know the option.
export function groupedNumber(value: number, locale: string): string {
  if (!Number.isFinite(value)) return '';
  const italian = locale.toLowerCase().startsWith('it');
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  const [whole = '0', fraction] = String(rounded).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, italian ? '.' : ',');
  const sign = value < 0 && rounded !== 0 ? '-' : '';
  return `${sign}${grouped}${fraction === undefined ? '' : `${italian ? ',' : '.'}${fraction}`}`;
}

export const gramsText = (grams: number, locale: string): string => `${groupedNumber(grams, locale)} g`;

// «2 persone», «1 persona», and a fractional number of people the card holds («1,5 persone») in the venue's own number format. The plural
// message picks its form from a NUMBER, so only a whole number goes through it; a fraction is always the plural form.
export function peopleText(
  t: (key: 'lab.n.people' | 'lab.n.peopleFraction', params: { n: number | string }) => string, people: number, locale: string,
): string {
  if (Number.isInteger(people)) return t('lab.n.people', { n: people });
  const italian = locale.toLowerCase().startsWith('it');
  const shown = String(Math.round(people * 100) / 100).replace('.', italian ? ',' : '.');
  return t('lab.n.peopleFraction', { n: shown });
}
