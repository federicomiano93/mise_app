// recipesSource.ts — the Recipe catalogue's data in Firestore, and nothing else.
//
// A port of js/catalogue/firebase-catalogue.js, one function at a time as the steps of 3d need them
// (docs/parity/catalogue.md, «Proposed slices»). Steps 3d-1 to 3d-3 only READ: the recipes, the
// ingredients and the label profile (config/labels), live, while the section is on screen. Behind an interface, so the store (recipesStore.ts) is a spec with a fake
// source and never needs a database to be tested.
//
// Under the open venue:
//   • recipes — one document per recipe. Read as a whole-collection live listener, attached only
//     while the section is open, never at boot (P14).
//   • config/labels — the paper, the printer and the optional blocks of a printed label (3d-3). One
//     small document; a MISSING one is not an error (no venue has it until somebody opens the label
//     Settings), so it is reported as null and the shared normalizer answers with the safe defaults.
//     ⚠️ It is config/labels and not a field on locations/{lid} (that document is written by no client).
//
// ⚠️ NO ROLE IS READ HERE, ON PURPOSE: the section gate and firestore.rules decide (P2).
//
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore(): its
// settings are fixed by its first use (src/firestore-access.spec.ts).

import { buildPath } from '@mise/shared/location-id';
import { PRICE_FIELDS } from '@mise/shared/price-model';
import type { Query } from 'firebase/firestore';
import type { FirestoreKit } from '../session/firebaseBackend';

// A document as the store reads it: its id beside its fields.
export type StoredDoc = { readonly id: string } & Record<string, unknown>;

// Where a snapshot came from: true when the SERVER sent it, false when it came from the browser's own
// database — which can be empty, or hold only the few recipes the Calculator once read one by one,
// because this phone never synced the whole collection. The store must be able to tell.
export interface RecipesMeta {
  readonly fromServer: boolean;
}

export interface RecipesSource {
  // The recipes, live. Returns the unsubscribe at once (Firestore may still be loading).
  // ⚠️ onSnapshot does NOT resubscribe after an error; onError lets the screen say so.
  watchRecipes(
    onChange: (list: StoredDoc[], meta: RecipesMeta) => void,
    onError: (err: unknown) => void,
  ): () => void;
  // The ingredients, live, with every price key removed. Same contract as watchRecipes.
  watchIngredients(
    onChange: (list: StoredDoc[], meta: RecipesMeta) => void,
    onError: (err: unknown) => void,
  ): () => void;
  // The label profile document as stored (null when there is none), live. Same contract.
  watchLabelConfig(
    onChange: (data: Record<string, unknown> | null, meta: RecipesMeta) => void,
    onError: (err: unknown) => void,
  ): () => void;
}

const RECIPES = 'recipes';
const INGREDIENTS = 'ingredients';
const CONFIG = 'config';
const LABELS_DOC = 'labels';

// A copy of the document without any of the price keys (header).
export function withoutPrice(doc: StoredDoc): StoredDoc {
  const out: Record<string, unknown> = { ...doc };
  for (const key of PRICE_FIELDS) delete out[key];
  return out as StoredDoc;
}

export function createFirestoreRecipesSource(
  firestore: () => Promise<FirestoreKit>,
  locationId: string,
): RecipesSource {
  // Throws on a venue id that could point a read anywhere else (@mise/shared/location-id).
  const recipesPath = buildPath(locationId, RECIPES);
  const ingredientsPath = buildPath(locationId, INGREDIENTS);
  const configPath = buildPath(locationId, CONFIG);

  // A live listener whose Firestore may not be loaded yet. The returned stop works at any moment.
  function listen(subscribe: (kit: FirestoreKit) => () => void, onError: (err: unknown) => void): () => void {
    let stopped = false;
    let unsubscribe: (() => void) | null = null;
    firestore().then(kit => {
      if (stopped) return;
      unsubscribe = subscribe(kit);
    }).catch(err => {
      if (!stopped) onError(err);
    });
    return () => {
      stopped = true;
      unsubscribe?.();
      unsubscribe = null;
    };
  }

  return {
    // ⚠️ includeMetadataChanges: without it, the server's answer that is IDENTICAL to the browser's
    // copy is never reported, and the store would never learn that the list is the server's.
    watchRecipes: (onChange, onError) => listen(kit => kit.fs.onSnapshot(
      kit.fs.collection(kit.db, recipesPath) as Query,
      { includeMetadataChanges: true },
      snap => onChange(
        snap.docs.map(d => ({ ...d.data(), id: d.id })),
        { fromServer: !snap.metadata.fromCache },
      ),
      err => {
        console.error('watchRecipes failed:', err);
        onError(err);
      },
    ), onError),

    // ⚠️ A FAILURE HERE IS QUIET (warn, not error): a venue without Orders may have no ingredients, or no
    // right to read them; every linked row then reads «not declared», which is the honest answer.
    watchIngredients: (onChange, onError) => listen(kit => kit.fs.onSnapshot(
      kit.fs.collection(kit.db, ingredientsPath) as Query,
      { includeMetadataChanges: true },
      snap => onChange(
        snap.docs.map(d => withoutPrice({ ...d.data(), id: d.id })),
        { fromServer: !snap.metadata.fromCache },
      ),
      err => {
        console.warn('watchIngredients failed:', err);
        onError(err);
      },
    ), onError),

    // ⚠️ QUIET TOO (warn): a refused or failed read leaves the profile the phone already holds, or the
    // safe defaults — the label screen says nothing about it, as the current app.
    watchLabelConfig: (onChange, onError) => listen(kit => kit.fs.onSnapshot(
      kit.fs.doc(kit.db, configPath, LABELS_DOC),
      { includeMetadataChanges: true },
      snap => onChange(
        snap.exists() ? { ...(snap.data() as Record<string, unknown>) } : null,
        { fromServer: !snap.metadata.fromCache },
      ),
      err => {
        console.warn('watchLabelConfig failed:', err);
        onError(err);
      },
    ), onError),
  };
}
