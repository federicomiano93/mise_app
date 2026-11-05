// supplierStep.ts — step 2 of the invoice import without the screen: what a select means, what is still to write, and the write
// itself (step 3e-6, part B3a). The model decides WHAT would be written (supplierWrites); this file runs it, in order, against the
// InvoiceImportSource, and says what happened. No React, no Firestore.

import { changedSupplierKeys } from '@mise/shared/invoice-import-plan';
import { planSuppliers } from '@mise/shared/invoice-import-model';
import type { SupplierOp, SupplierPlanEntry } from '@mise/shared/invoice-import-model';
import type { ImportFile } from './importRun';
import type { InvoiceImportSource } from './importSource';

// What the person answered for a supplier the model asked about («maybe»): the model's own decision shapes.
export type SupplierDecision =
  | { readonly linkTo: string }
  | { readonly createNew: true }
  | { readonly skip: true };

// The values of the «What should happen?» select.
export const CHOICE_NONE = '';
export const CHOICE_NEW = 'new';
export const CHOICE_SKIP = 'skip';
const LINK_PREFIX = 'link:';

export const linkChoice = (supplierId: string): string => `${LINK_PREFIX}${supplierId}`;

export function choiceOf(decision: SupplierDecision | undefined): string {
  if (!decision) return CHOICE_NONE;
  if ('linkTo' in decision) return linkChoice(decision.linkTo);
  return 'createNew' in decision ? CHOICE_NEW : CHOICE_SKIP;
}

// The select's value → the answer it stands for; null = «Choose…» (no answer).
export function decisionOf(choice: string): SupplierDecision | null {
  if (choice === CHOICE_NEW) return { createNew: true };
  if (choice === CHOICE_SKIP) return { skip: true };
  if (choice.startsWith(LINK_PREFIX) && choice.length > LINK_PREFIX.length) return { linkTo: choice.slice(LINK_PREFIX.length) };
  return null;
}

// The person's answers, with every «do not import anything from this supplier» as a skip.
export function decisionsNow(
  answers: Readonly<Record<string, SupplierDecision>>,
  skips: ReadonlySet<string>,
): Record<string, SupplierDecision> {
  const out: Record<string, SupplierDecision> = { ...answers };
  skips.forEach(key => { out[key] = { skip: true }; });
  return out;
}

// What step 2 has already done: the ids of the suppliers it created (by the file supplier's key) and the keys it linked.
// Kept across retries INSIDE the screen, so a retry after a failure half-way never creates the same supplier twice (parity I28).
export interface SupplierProgress {
  readonly created: Record<string, string>;
  readonly linked: Set<string>;
}

export const newProgress = (): SupplierProgress => ({ created: {}, linked: new Set() });

export function pendingOps(ops: readonly SupplierOp[], progress: SupplierProgress): SupplierOp[] {
  return ops.filter(op => !(op.type === 'create-supplier' && progress.created[op.key] !== undefined)
    && !(op.type === 'link-supplier' && progress.linked.has(op.key)));
}

export type SaveOutcome =
  | { readonly kind: 'saved' }
  // ⚠️ NOTHING WAS WRITTEN: another phone changed the answer for these file suppliers while the owner was deciding. `fresh` is the
  // plan on what the server holds now.
  | { readonly kind: 'changed'; readonly fresh: SupplierPlanEntry[]; readonly keys: string[] }
  | { readonly kind: 'failed'; readonly error: unknown };

// ⚠️ THE FRESH CHECK, then the writes. The plan the owner confirmed is minutes old and another phone may have added one of these
// suppliers since: it is planned again on what the SERVER holds now, and if any confirmed answer is no longer the same nothing is
// written (parity I27). Suppliers this very import already wrote are not compared: they exist now by its own doing.
// The data for a new supplier is the model's own (supplierWrites → newSupplierData), unchanged.
export async function saveSupplierOps(
  source: InvoiceImportSource,
  file: ImportFile,
  plan: readonly SupplierPlanEntry[],
  pending: readonly SupplierOp[],
  progress: SupplierProgress,
): Promise<SaveOutcome> {
  try {
    const fresh = planSuppliers(file.suppliers, await source.freshSuppliers());
    const settled = [...Object.keys(progress.created), ...progress.linked];
    const keys = changedSupplierKeys(plan, fresh, settled);
    if (keys.length > 0) return { kind: 'changed', fresh, keys };
    for (const op of pending) {
      if (op.type === 'create-supplier') {
        progress.created[op.key] = await source.createSupplier(op.data);
      } else {
        await source.linkSupplierVat(op.supplierId as string, op.data.vatNumber as string);
        progress.linked.add(op.key);
      }
    }
    return { kind: 'saved' };
  } catch (error) {
    return { kind: 'failed', error };
  }
}
