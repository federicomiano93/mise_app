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
