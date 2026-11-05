// mergeSource.ts — the database half of «Merge another pack…» (step 3e-7, parity I117–I130): the port of
// js/orders/ingredient-merge-data.js, read for read and write for write. @mise/shared/ingredient-merge decides WHAT happens
// (findUsage, planMerge, deletionBatches); this file only reads and writes, through the same session and the same rules as
// every form (so nothing here can do what the signed-in person could not do by hand, P2). Behind an interface, so the screen
// is specced with a fake (testing/fakeMergeSource.ts) and never needs a database to be tested.
//
// ⚠️ IT NEEDS THE NETWORK (parity I127), like the invoice import: with the offline cache a write is «saved» at once and sent
// later, and a merge half-queued behind a screen that looks finished would be worse than no merge. So every read comes from
// the SERVER (it rejects offline instead of answering from the cache — a stale «B is free» would let a used ingredient be
// deleted) and every write is refused up front when the browser says it is offline. One of the two places of Mise 2 that are
// NOT local-first, on purpose (decision T3).
// ⚠️ A CALL THAT NEVER ANSWERS IS A STOP, NOT A HANG: every read and every commit is bounded by MERGE_TIMEOUT_MS (30 s, the
// current app's withTimeout) and then throws code 'timeout'.
// ⚠️ THE WRITE WORKS ON FRESH DATA (parity I125). The screen's copies of A and B are minutes old; mergeIngredients reads both
// again from the server, stops if either is gone, plans from the FRESH A (its codes may have changed under the owner's
// finger) and checks where B is used ONCE MORE, right before the first write.
// ⚠️ NOT IN THE ORIGINAL: the fresh reads wait for this phone's queue first (`waitForPendingWrites`, as the import's
// «new or already there» reads do). Mise 2 saves a card local-first, so a save of A or B made a moment ago may not have reached
// the server yet: planning from the server without it would compute A's codes from the version before the save.
// ⚠️ THE ORDER IS THE SAFETY; NO TRANSACTION (parity I124): the plan's batches in order (B's points onto A, A's codes, A's
// price), then B's price changes deleted, then B itself with its price document LAST, then its line in the order in progress
// cleared (logged, never awaited by the person). Stopping anywhere loses nothing; a second try finishes the job.
//
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore() (src/firestore-access.spec.ts).
// ⚠️ NO ROLE IS READ HERE: the door is courtesy; firestore.rules decide (canManage Food cost for prices and price changes,
// canManage Orders for deleting an ingredient).

import { deletePlan } from '@mise/shared/ingredient-edit-model';
import { deletionBatches, findUsage, monthKeyOf, planMerge, previousMonthKeyOf } from '@mise/shared/ingredient-merge';
import type { MergeIngredient, MergePlan, UsageFound } from '@mise/shared/ingredient-merge';
import { buildPath } from '@mise/shared/location-id';
import type { Query } from 'firebase/firestore';
import type { FirestoreKit } from '../../session/firebaseBackend';

const INGREDIENTS = 'ingredients';
const INGREDIENT_PRICES = 'ingredient-prices';
const PRICES = 'prices';
const PRICE_CHANGES = 'price-changes';
const PRODUCTS = 'products';
const RECIPES = 'recipes';
const INVENTORY = 'inventory';
const DRAFTS = 'drafts';
const CURRENT_DRAFT = 'current';
const ORDER_REQUESTS = 'order-requests';

export const MERGE_TIMEOUT_MS = 30_000;

// Why the merge stopped BEFORE writing anything: A or B no longer exists, or B is still used somewhere.
export type MergeStop = 'gone' | 'used';

// Every failure of this source. `code` is what the screen words: 'offline' | 'timeout' | 'gone' | 'used', or the Firestore
// code of a refusal, untouched ('unknown' when the error carried none). `committed` says whether at least one batch already
// landed OR MAY HAVE: a commit that timed out is not cancelled by Firestore and can still land, so it counts as landed (a
// read that timed out before any write does not) — the only thing that decides between «nothing was changed» and «stopped half way» (parity I126).
export class MergeError extends Error {
  readonly code: string;
  readonly committed: boolean;
  readonly used: readonly UsageFound[];
  constructor(code: string, { committed = false, used = [] }: { committed?: boolean; used?: readonly UsageFound[] } = {}) {
    // The message is the code: nobody reads it (the screen words each code), and it stays out of the dictionary.
    super(`ingredient-merge:${code}`);
    this.code = code;
    this.committed = committed;
    this.used = used;
  }
}

// What the confirmation quotes (parity I128), planned from the server's data without writing.
export interface MergePreview {
  readonly counts: MergePlan['counts'];
  readonly takeover: boolean;
  readonly bLostPrice: MergePlan['bLostPrice'];
  readonly hasChanges: boolean;
  readonly aPrice: Record<string, unknown> | null;
  readonly bPrice: Record<string, unknown> | null;
}

export interface MergeSource {
  // Where ingredient B is still used → empty when it is free to merge. Every read from the server; the first failure REJECTS
  // («could not check» must never read as «not used»). This month's AND last month's stocktake are read.
  checkUsage(bId: string): Promise<UsageFound[]>;
  // The plan of merging B into A, from the server, without writing. Rejects with code 'gone' when either no longer exists.
  previewMerge(aId: string, bId: string): Promise<MergePreview>;
  // Merges B into A → the plan's counts. Rejects with a MergeError (code, committed, used).
  mergeIngredients(aId: string, bId: string): Promise<MergePlan['counts']>;
}

export interface MergeEnvironment {
  // Whether the browser says it is offline now (navigator.onLine === false). A spec passes its own.
  readonly isOffline: () => boolean;
  // The clock that names this month and last month for the stocktake check.
  readonly now: () => number;
}

const BROWSER: MergeEnvironment = {
  isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
  now: () => Date.now(),
};

// ⚠️ An id that could name a different path never reaches Firestore.
function checkId(id: unknown): string {
  if (typeof id !== 'string' || !id || id.includes('/') || id === '.' || id === '..') {
    throw new Error(`Not a document id: ${JSON.stringify(id)}`);
  }
  return id;
}

// The Firestore code of an error, when it has one.
function codeOf(err: unknown): string {
  const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined;
  return typeof code === 'string' && code ? code : 'unknown';
}

type Snapshot = { docs: Array<{ id: string; data: () => Record<string, unknown> }> };
type DocSnapshot = { id: string; exists: () => boolean; data: () => Record<string, unknown> | undefined };

export function createFirestoreMergeSource(
  firestore: () => Promise<FirestoreKit>,
  locationId: string,
  env: MergeEnvironment = BROWSER,
): MergeSource {
  // Throws on a venue id that could point a read anywhere else (@mise/shared/location-id).
  const pathOf = (folder: string) => buildPath(locationId, folder);

  function refuseOffline(): void {
    if (env.isOffline()) throw new MergeError('offline');
  }

  function bounded<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new MergeError('timeout')), MERGE_TIMEOUT_MS);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  const docsOf = (snap: Snapshot) => snap.docs.map(d => ({ ...d.data(), id: d.id }));
  const dataOf = (snap: DocSnapshot) => (snap.exists() ? (snap.data() ?? null) : null);

  async function kit(): Promise<FirestoreKit> {
    refuseOffline();
    return bounded(firestore());
  }

  async function usage({ fs, db }: FirestoreKit, bId: string): Promise<UsageFound[]> {
    const nowMs = env.now();
    const months = [monthKeyOf(nowMs), previousMonthKeyOf(nowMs)].filter((m): m is string => Boolean(m));
    const [products, recipes, draft, requests, ...inventories] = await Promise.all([
      bounded(fs.getDocsFromServer(fs.collection(db, pathOf(PRODUCTS)) as Query)),
      bounded(fs.getDocsFromServer(fs.collection(db, pathOf(RECIPES)) as Query)),
      bounded(fs.getDocFromServer(fs.doc(db, pathOf(DRAFTS), CURRENT_DRAFT))),
      bounded(fs.getDocsFromServer(fs.collection(db, pathOf(ORDER_REQUESTS)) as Query)),
      ...months.map(month => bounded(fs.getDocFromServer(fs.doc(db, pathOf(INVENTORY), month)))),
    ]);
    return findUsage(bId, {
      products: docsOf(products as Snapshot),
      recipes: docsOf(recipes as Snapshot),
      inventories: months.map((month, i) => ({ month, data: inventories[i] ? dataOf(inventories[i] as DocSnapshot) : null })),
      draft: dataOf(draft as DocSnapshot),
      requests: docsOf(requests as Snapshot),
    });
  }

  // A stored ingredient as the server holds it NOW, or null when it is gone.
  async function freshIngredient({ fs, db }: FirestoreKit, id: string): Promise<MergeIngredient | null> {
    const snap = await bounded(fs.getDocFromServer(fs.doc(db, pathOf(INGREDIENTS), id))) as DocSnapshot;
    const data = dataOf(snap);
    return data ? { ...data, id: snap.id } : null;
  }

  // Both ingredients fresh from the server, after this phone's queue has drained; 'gone' when either no longer exists.
  async function freshPair(k: FirestoreKit, aId: string, bId: string): Promise<[MergeIngredient, MergeIngredient]> {
    await bounded(k.fs.waitForPendingWrites(k.db));
    const [a, b] = await Promise.all([freshIngredient(k, aId), freshIngredient(k, bId)]);
    if (!a || !b) throw new MergeError('gone');
    return [a, b];
  }

  // What the plan reads: B's whole price history, the ids A already holds, both current prices and the ids of B's changes.
  async function readInputs({ fs, db }: FirestoreKit, aId: string, bId: string) {
    const pricesOf = (id: string) => fs.collection(db, pathOf(INGREDIENTS), id, PRICES) as Query;
    const [bPoints, aPoints, aPrice, bPrice, changes] = await Promise.all([
      bounded(fs.getDocsFromServer(pricesOf(bId))),
      bounded(fs.getDocsFromServer(pricesOf(aId))),
      bounded(fs.getDocFromServer(fs.doc(db, pathOf(INGREDIENT_PRICES), aId))),
      bounded(fs.getDocFromServer(fs.doc(db, pathOf(INGREDIENT_PRICES), bId))),
      bounded(fs.getDocsFromServer(fs.query(fs.collection(db, pathOf(PRICE_CHANGES)), fs.where('ingredientId', '==', bId)))),
    ]);
    return {
      bPoints: (bPoints as Snapshot).docs.map(d => ({ id: d.id, data: d.data() })),
      aPointIds: new Set((aPoints as Snapshot).docs.map(d => d.id)),
      aPrice: dataOf(aPrice as DocSnapshot),
      bPrice: dataOf(bPrice as DocSnapshot),
      changeIds: (changes as Snapshot).docs.map(d => d.id),
    };
  }

  // A planned write's document: only A's own document, A's price document or a point of A's history (the id is compared).
  function refOf({ fs, db }: FirestoreKit, path: readonly string[], aId: string) {
    const [folder, ...rest] = path;
    const point = folder === INGREDIENTS && rest.length === 3 && rest[1] === PRICES;
    const own = (folder === INGREDIENTS || folder === INGREDIENT_PRICES) && rest.length === 1;
    if ((!point && !own) || rest[0] !== aId) throw new Error(`The merge may not write to ${JSON.stringify(path.join('/'))}`);
    return fs.doc(db, pathOf(folder as string), ...rest.map(checkId));
  }

  return {
    async checkUsage(bId) {
      try {
        return await usage(await kit(), checkId(bId));
      } catch (err) {
        throw err instanceof MergeError ? err : new MergeError(codeOf(err));
      }
    },

    async previewMerge(aId, bId) {
      try {
        const k = await kit();
        const [a, b] = await freshPair(k, checkId(aId), checkId(bId));
        const input = await readInputs(k, a.id, b.id);
        const plan = planMerge({ a, b, ...input });
        return {
          counts: plan.counts, takeover: plan.takeover, bLostPrice: plan.bLostPrice, hasChanges: plan.hasChanges,
          aPrice: input.aPrice, bPrice: input.bPrice,
        };
      } catch (err) {
        throw err instanceof MergeError ? err : new MergeError(codeOf(err));
      }
    },

    async mergeIngredients(aId, bId) {
      let committed = false;
      // ⚠️ A TIMED-OUT COMMIT MAY STILL LAND (Firestore does not cancel it): it is treated as landed, so the screen says «stopped
      // half way, tap Merge again» (the second try is safe) rather than «nothing was changed».
      const commit = async (batch: { commit(): Promise<unknown> }) => {
        try {
          await bounded(batch.commit());
        } catch (err) {
          if (err instanceof MergeError && err.code === 'timeout') committed = true;
          throw err;
        }
        committed = true;
      };
      try {
        const k = await kit();
        const { fs, db } = k;
        const [a, b] = await freshPair(k, checkId(aId), checkId(bId));
        const input = await readInputs(k, a.id, b.id);
        const plan = planMerge({ a, b, ...input });
        const used = await usage(k, b.id);
        if (used.length > 0) throw new MergeError('used', { used });

        for (const step of plan.batches) {
          refuseOffline();
          const batch = fs.writeBatch(db);
          for (const { path, data, merge } of step) {
            const ref = refOf(k, path, a.id);
            if (merge) batch.set(ref, { ...data, bakery: locationId }, { merge: true });
            else batch.set(ref, { ...data, bakery: locationId });
          }
          await commit(batch);
        }

        // B's price changes go with B (A's own are recomputed by the next import).
        for (const ids of deletionBatches(input.changeIds)) {
          refuseOffline();
          const batch = fs.writeBatch(db);
          for (const id of ids) batch.delete(fs.doc(db, pathOf(PRICE_CHANGES), checkId(id)));
          await commit(batch);
        }

        // B itself, with its price document, LAST. Its history under it stays (the rules forbid deleting it), unreachable.
        refuseOffline();
        const last = fs.writeBatch(db);
        for (const step of deletePlan({ id: b.id, mayPrice: true })) {
          last.delete(fs.doc(db, pathOf(step.collection), step.id));
        }
        await commit(last);

        // Its line in the order in progress (a quantity of zero: above zero the merge was refused). ⚠️ updateDoc and a
        // FieldPath, as suppliersSource.clearDraftEntry: no draft means nothing to clear, and an id is data, not a path.
        // Fire-and-forget like the current app's dropDeletedIngredientFromDraft: the merge has already succeeded.
        fs.updateDoc(
          fs.doc(db, pathOf(DRAFTS), CURRENT_DRAFT),
          new fs.FieldPath('entries', b.id), fs.deleteField(),
          'updatedAt', new Date(env.now()).toISOString(),
          'bakery', locationId,
        ).catch((err: unknown) => console.error('The draft still holds a deleted ingredient:', codeOf(err)));
        return plan.counts;
      } catch (err) {
        if (err instanceof MergeError) {
          throw committed === err.committed ? err : new MergeError(err.code, { committed, used: err.used });
        }
        throw new MergeError(codeOf(err), { committed });
      }
    },
  };
}
