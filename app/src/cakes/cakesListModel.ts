import { nameMatches } from '@mise/shared/foodcost-model';
import type { CostTables, FoodCostStatus } from '@mise/shared/foodcost-model';
import { cakeTotals } from '@mise/shared/cake-model';
import type { Cake } from '@mise/shared/cake-model';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';

type Translate = (key: MessageKey, params?: MessageParams) => string;

// One row of the list: the cake, and what its food cost says. `partial`: a card in it has no price yet, so the figure would be too
// low — the row says «?» instead of a percentage.
export interface CakeRowData {
  cake: Cake;
  pct: number | null;
  status: FoodCostStatus | null;
  partial: boolean;
}

// By name, in Italian collation (Food cost's own tie-break); a cake with no name sorts as an empty one, first.
export function sortCakes(cakes: readonly Cake[]): Cake[] {
  return [...cakes].sort((a, b) => a.name.localeCompare(b.name, 'it') || a.id.localeCompare(b.id));
}

// ⚠️ THE COSTS COME FROM cakeTotals — the ONE money engine, run on the product built from the cake — never from a figure kept on
// the cake. Called inside a useMemo keyed on the tables: it costs every cake.
export function costCakes(cakes: readonly Cake[], tables: CostTables): CakeRowData[] {
  return sortCakes(cakes).map(cake => {
    const totals = cakeTotals(cake, tables);
    return { cake, pct: totals.foodCostPct, status: totals.status, partial: totals.partial };
  });
}

export function matchingCakes(rows: readonly CakeRowData[], query: string): CakeRowData[] {
  return rows.filter(({ cake }) => nameMatches(cake, query));
}

// «2 piani · Ø 20 · 2 dischi · costo incompleto»: the tiers only from two up (a one-tier cake is just «Ø 24 · 3 dischi»).
export function cakeSubLine(t: Translate, cake: Cake, partial: boolean): string {
  const parts: string[] = [];
  if (cake.tiers > 1) parts.push(t('cakes.row.tiers', { n: cake.tiers }));
  parts.push(t('cakes.row.diameter', { d: cake.diameterCm }));
  parts.push(t('cakes.row.discs', { n: cake.discs }));
  if (partial) parts.push(t('cakes.row.incomplete'));
  return parts.join(' · ');
}
