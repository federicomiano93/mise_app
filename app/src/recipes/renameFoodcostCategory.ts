// renameFoodcostCategory.ts — keeps Food cost's own category documents in step with a Ricettario word being renamed.
//
// Food cost's cards that were not made from a recipe are grouped by the NAME of a `foodcost-categories` document, matched to a
// Ricettario word with the Ricettario's own fold (`categoryKey`: capitals and repeated spaces do not count, accents do). Renaming
// the word must carry those documents' names along, or those cards would drop into «No category». It goes through the data
// services (the Food cost source), never through a `foodcost/` import: the recipes folder only needs two calls of it, so it
// describes them here.
import { categoryKey } from '@mise/shared/recipe-shelf';

type Doc = { readonly id: string } & Readonly<Record<string, unknown>>;

export interface CategoryDocsSource {
  watchCategories(onChange: (list: Doc[], meta: { readonly fromServer: boolean }) => void, onError: (err: unknown) => void): () => void;
  saveCategory(id: string, data: Readonly<{ name: string; rank: number }>): Promise<void>;
}

// How long the server is given to answer.
export const FOOD_COST_READ_MS = 10_000;

// The category documents as the SERVER holds them, read once: null when only this phone's own copy answered, when the read
// failed, or when nothing came in time. ⚠️ A cache-only answer is no answer (it may be empty, or old): renaming from it could miss
// a document. Always unsubscribed.
function readFromServer(source: CategoryDocsSource, timeoutMs: number): Promise<Doc[] | null> {
  return new Promise(resolve => {
    let settled = false;
    let stop: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (list: Doc[] | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(list);
      stop?.();
    };
    timer = setTimeout(() => { finish(null); }, timeoutMs);
    try {
      stop = source.watchCategories(
        (list, meta) => { if (meta.fromServer) finish(list); },
        () => { finish(null); },
      );
    } catch {
      finish(null);
    }
    if (settled) stop?.();
  });
}

// 'done': every matching document was renamed (rank kept), or none matched. 'failed': the server could not be asked in time, or a
// write was refused — the caller says so in one line. Quiet otherwise: Food cost never fails the Ricettario's rename.
export type FoodCostRename = 'done' | 'failed';

export async function renameFoodcostCategory(
  source: CategoryDocsSource, oldWord: string, newWord: string, timeoutMs: number = FOOD_COST_READ_MS,
): Promise<FoodCostRename> {
  try {
    const docs = await readFromServer(source, timeoutMs);
    if (docs === null) return 'failed';
    const wanted = categoryKey(oldWord);
    const matching = docs.filter(doc => typeof doc['name'] === 'string' && categoryKey(doc['name']) === wanted);
    await Promise.all(matching.map(doc => {
      const rank = typeof doc['rank'] === 'number' && Number.isFinite(doc['rank']) ? doc['rank'] : 0;
      return source.saveCategory(doc.id, { name: newWord, rank });
    }));
    return 'done';
  } catch (err) {
    console.warn('The Food cost category did not follow the rename:', err);
    return 'failed';
  }
}
