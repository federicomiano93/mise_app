import type { CostTables, Product } from '@mise/shared/foodcost-model';
import { firstInvalidNumber } from '@mise/shared/product-limits';
import { firstBadWeight, marginPointFor } from '../productEditorModel';
import { MAX_COMPONENTS, applyLab, baseProduct, changedLineCount } from './labModel';
import type { LabDraft } from './labModel';

// What «Salva nella scheda» is about to do, worked out BEFORE the confirmation (so the list shows the truth) and used for the write
// after it (so the write is what the list said).
//
// ⚠️ APPLIED ONTO THE LATEST SAVED PRODUCT, READ AT THE MOMENT OF THE SAVE, not onto the copy the lab started from: the card may have
// been changed on another tablet meanwhile (a price, a packaging line, a rename), and the lab only owns the weights, the cooking, the
// pieces and the work. See applyLab for how lines are matched.
// ⚠️ THE SAME CHECKS AS THE CARD'S SAVE: the numbers the rules would refuse (product-limits) and the two weights of «Cottura» stop
// the save while the work is on screen, because past this point the write is local-first and a refusal arrives too late. A cooked
// weight heavier than the raw one is NOT a refusal (the card lets it be saved after a question; the lab says it on the screen).
// ⚠️ THE MARGIN POINT is the card's own (marginPointFor): recorded when the composition changes, which the two weights are part of.
export type LabSavePlan =
  | { ok: true; product: Product; snapshot: Record<string, unknown> | null; changedLines: number; before: Product }
  | { ok: false; reason: 'gone' | 'invalid' | 'tooMany' };

export function planLabSave(
  stored: Product | null | undefined, tables: CostTables, draft: LabDraft, now: number, nowIso: string,
): LabSavePlan {
  const before = baseProduct(stored, tables);
  if (before === null) return { ok: false, reason: 'gone' };
  const product = applyLab(before, draft, tables, now);
  // The rules refuse more than 100 lines: said here, while the work is on screen and the draft is intact.
  if (product.components.length > MAX_COMPONENTS) return { ok: false, reason: 'tooMany' };
  if (firstInvalidNumber(product) !== null || firstBadWeight(product) !== null) return { ok: false, reason: 'invalid' };
  return {
    ok: true,
    product,
    snapshot: marginPointFor(before, product, tables, nowIso),
    changedLines: changedLineCount(before, product),
    before,
  };
}
