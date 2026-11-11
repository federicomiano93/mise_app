import { batchTotals, productCooking } from '@mise/shared/foodcost-model';
import type { CostTables } from '@mise/shared/foodcost-model';

// The foot of «Made of» (step 3b, 11 Nov 2026): «Raw dough   790.00 g · £1.53».
//
// ⚠️ NOTHING IS ADDED UP HERE: the weight is productCooking's raw total — the very figure the «Baking» raw box follows — and the money
// is batchTotals' cost of the lines, recipes and ingredients, no packaging (packaging is per unit sold, not part of the dough). The
// line money, the foot and the summary are the same calls, so they cannot disagree.
export interface MadeOfFoot {
  rawKg: number;
  // null when not one line is costed: the foot shows a dash, never «0.00» (free).
  cost: number | null;
  // A line has no cost (gone, unpriced, or a recipe priced in part): the foot says «more than», as the summary does.
  partial: boolean;
}

// null when the cost model faults: a reading aid never takes the lines down (P17), the foot is then simply not drawn.
export function madeOfFoot(product: unknown, tables: CostTables): MadeOfFoot | null {
  try {
    const cooking = productCooking(product, tables);
    const batch = batchTotals(product, tables);
    const costed = batch.rows.some(row => row.cost !== null);
    return { rawKg: cooking.rawTotalKg, cost: costed ? batch.cost : null, partial: batch.partial };
  } catch {
    return null;
  }
}
