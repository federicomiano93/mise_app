// renameFoodcostCategory.ts — keeps Food cost's own category documents in step with a Ricettario word being renamed.
//
// Food cost's cards that were not made from a recipe are grouped by the NAME of a `foodcost-categories` document, matched to a
// Ricettario word (capitals and accents not counting). Renaming the word must carry that document's name along, or those cards
// would drop into «No category». It goes through the data services (the Food cost source), never through a `foodcost/` import:
// the recipes folder only needs two calls of it, so it describes them here.
import { normalizeSearchText } from '@mise/shared/catalogue-model';

type Doc = { readonly id: string } & Readonly<Record<string, unknown>>;

export interface CategoryDocsSource {
  watchCategories(onChange: (list: Doc[], meta: { readonly fromServer: boolean }) => void, onError: (err: unknown) => void): () => void;
  saveCategory(id: string, data: Readonly<{ name: string; rank: number }>): Promise<void>;
}

// The category documents, read once: the first answer, or none when they cannot be read.
function readOnce(source: CategoryDocsSource): Promise<Doc[]> {
  return new Promise(resolve => {
    let settled = false;
    let stop: (() => void) | null = null;
    const finish = (list: Doc[]) => {
      if (settled) return;
      settled = true;
      resolve(list);
      stop?.();
    };
    stop = source.watchCategories(list => { finish(list); }, () => { finish([]); });
    if (settled) stop();
  });
}

// Renames the document whose name folds to `oldWord`, keeping its rank. Quiet: resolves true when a document was renamed, false
// when there was none or it could not be written (the Ricettario's rename never waits for, or fails because of, Food cost).
export async function renameFoodcostCategory(source: CategoryDocsSource, oldWord: string, newWord: string): Promise<boolean> {
  try {
    const wanted = normalizeSearchText(oldWord);
    const found = (await readOnce(source)).find(doc => typeof doc['name'] === 'string' && normalizeSearchText(doc['name']) === wanted);
    if (!found) return false;
    const rank = typeof found['rank'] === 'number' && Number.isFinite(found['rank']) ? found['rank'] : 0;
    await source.saveCategory(found.id, { name: newWord, rank });
    return true;
  } catch (err) {
    console.warn('The Food cost category did not follow the rename:', err);
    return false;
  }
}
