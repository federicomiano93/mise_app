import { costProduct, currentProduct, productCooking, productionCost } from '@mise/shared/foodcost-model';
import type { CostTables } from '@mise/shared/foodcost-model';
import { costPerKg } from '@mise/shared/per-kg-model';

// The few figures of the summary that productPreview() does not carry: the cost of a kilo, the whole batch, the price without VAT
// and the share of it that the work takes (11 Nov 2026, the tidy card).
//
// ⚠️ NOTHING IS ADDED UP HERE: every figure is the one its own screen already shows — the kilo is the «Baking» result line's and
// «Cost breakdown»'s (costPerKg), the batch is productionCost()'s, the rest are costProduct()'s. The summary can never disagree.
// POST-SWITCH (11 Nov 2026, «solo l'impasto»): the kilo is the DOUGH only (`{ packaging: false }`), as in «Baking» and «Cost
// breakdown»; the packaging stays per unit sold, in «Details».
export interface SummaryExtras {
  // A cooked weight is typed: the kilo is «1 kg cooked», else «1 kg (no oven loss)».
  cooked: boolean;
  // What the dough costs per kilo, packaging left out; null while there is none, or while the cooked weight is heavier than the
  // raw one (as in «Baking»). perKgPartial: a line of «Made of» has no cost (the packaging never makes it partial).
  perKg: number | null;
  perKgPartial: boolean;
  // Materials and packaging of the whole batch, and, for a product sold by the piece, how many pieces that batch makes.
  batchCost: number | null;
  batchPieces: number | null;
  // The selling price without VAT, and what the work takes of it (and everything takes), in percent.
  netPrice: number | null;
  labourPct: number | null;
  totalCostPct: number | null;
}

// null when the cost model faults: a reading aid never takes the card down (P17), the summary then simply leaves these rows out.
export function summaryExtras(product: unknown, tables: CostTables): SummaryExtras | null {
  try {
    const current = currentProduct(product, tables);
    const cooking = productCooking(current, tables);
    const kilo = costPerKg(current, tables, { packaging: false });
    const cost = productionCost(current, tables);
    const result = costProduct(current, tables);
    const perKg = kilo.total !== null && !cooking.heavier ? kilo.total : null;
    const pieces = current !== null && current.sellingMode === 'piece' && current.piecesPerBatch !== null && current.piecesPerBatch > 0
      ? current.piecesPerBatch
      : null;
    return {
      cooked: cooking.cookedKg !== null,
      perKg,
      perKgPartial: perKg !== null && kilo.partial,
      batchCost: cost.batchCost,
      batchPieces: pieces,
      netPrice: result.netUnitPrice,
      labourPct: result.labourPct,
      totalCostPct: result.totalCostPct,
    };
  } catch {
    return null;
  }
}
