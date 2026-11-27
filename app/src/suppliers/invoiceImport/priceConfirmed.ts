import { priceChange } from '@mise/shared/invoice-import-plan';
import type { PlanEntry } from '@mise/shared/invoice-import-plan';

type StoredPrice = { pricePerUnit?: unknown; priceUnit?: unknown };
type Row = PlanEntry['row'];

// What an «update-price» row replaces: the stored price in force, the price that would become current, and how far apart they
// are (the model's priceChange: same unit, within half a percent is 0). null when the row is not a price update or the two
// cannot be compared. ⚠️ ONE FUNCTION FOR THE «(=)» ON THE ROW AND THE «Price confirmed» PILL, so they never disagree.
export function replacedPrice(
  row: Row,
  pricesById: unknown,
  priceUnit: string,
): { stored: StoredPrice; next: { pricePerUnit: number }; percent: number } | null {
  if (row.status !== 'update-price') return null;
  // The plan holds the prices as a plain object keyed by ingredient id (planIngredientStep builds it so).
  const prices = pricesById as Readonly<Record<string, StoredPrice | undefined>> | undefined;
  const stored = prices?.[row.ingredientId as string];
  const next = row.newPoints[row.newPoints.length - 1];
  const change = next ? priceChange(stored, next.pricePerUnit, priceUnit) : null;
  return stored && next && change ? { stored, next, percent: change.percent } : null;
}

// A newer invoice that repeats the price already in force: the row still writes (the date moves forward, the history gets its
// point), but there is no new price to announce. Display only: the row's status is untouched.
export const isPriceConfirmed = (row: Row, pricesById: unknown, priceUnit: string): boolean =>
  replacedPrice(row, pricesById, priceUnit)?.percent === 0;
