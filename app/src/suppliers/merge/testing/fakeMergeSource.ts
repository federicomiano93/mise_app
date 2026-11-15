// fakeMergeSource.ts — an in-memory MergeSource for the screen's specs (specs only).
//
// It answers what the spec sets: `usage` (where B is still used, by B's id), `preview` (what the confirmation quotes) and
// `counts` (what a merge returns). On top of that it
//   • RECORDS every call (`calls`, in order), so a spec can say «nothing was written» (no `merge` call) and «the usage was
//     checked first»;
//   • FAILS a method on request (`failWith('mergeIngredients', 'permission-denied', { committed: true })`): the error is a real
//     MergeError, as the screen receives from the real source;
//   • HOLDS a call pending (`hold('mergeIngredients')`) until the spec releases it, to look at the screen while the merge writes
//     (the rows and Back are off, «Merging…» is said).
//
// Invented data only.

import type { MergePlan, UsageFound } from '@mise/shared/ingredient-merge';
import { MergeError } from '../mergeSource';
import type { MergePreview, MergeSource } from '../mergeSource';

export type MergeMethod = keyof MergeSource;

export interface FakeMergeSource extends MergeSource {
  usage: Map<string, UsageFound[]>;
  preview: MergePreview;
  counts: MergePlan['counts'];
  readonly calls: Array<{ readonly method: MergeMethod; readonly args: readonly string[] }>;
  failWith(method: MergeMethod, code: string, options?: { committed?: boolean; used?: readonly UsageFound[] }): void;
  hold(method: MergeMethod): () => void;
}

export const DEFAULT_PREVIEW: MergePreview = {
  counts: { prices: 2, codes: 1, droppedCodes: 0 }, takeover: false, bLostPrice: null, hasChanges: false, aPrice: null, bPrice: null,
};

export function fakeMergeSource(): FakeMergeSource {
  const failures = new Map<MergeMethod, MergeError>();
  const gates = new Map<MergeMethod, Promise<void>>();

  async function run<T>(method: MergeMethod, args: readonly string[], make: () => T): Promise<T> {
    fake.calls.push({ method, args });
    const gate = gates.get(method);
    if (gate) {
      gates.delete(method);
      await gate;
    }
    const failure = failures.get(method);
    if (failure) {
      failures.delete(method);
      throw failure;
    }
    return make();
  }

  const fake: FakeMergeSource = {
    usage: new Map(),
    preview: DEFAULT_PREVIEW,
    counts: DEFAULT_PREVIEW.counts,
    calls: [],
    failWith(method, code, options = {}) { failures.set(method, new MergeError(code, options)); },
    hold(method) {
      let release: () => void = () => undefined;
      gates.set(method, new Promise<void>(resolve => { release = resolve; }));
      return release;
    },
    checkUsage: bId => run('checkUsage', [bId], () => fake.usage.get(bId) ?? []),
    previewMerge: (aId, bId) => run('previewMerge', [aId, bId], () => fake.preview),
    mergeIngredients: (aId, bId) => run('mergeIngredients', [aId, bId], () => fake.counts),
  };
  return fake;
}
