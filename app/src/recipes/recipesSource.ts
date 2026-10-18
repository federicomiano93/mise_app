// recipesSource.ts — the Recipe catalogue's data in Firestore, and nothing else.
//
// A port of js/catalogue/firebase-catalogue.js, one function at a time as the steps of 3d need them
// (docs/parity/catalogue.md, «Proposed slices»). Steps 3d-1 to 3d-3 only READ (3d-5 writes config/labels, merge only; 3d-6 writes and
// deletes recipes and reads the suppliers and, once before a delete, config/calculator): the recipes, the
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

import { CONFIG_MODEL, normalizeConfig } from '@mise/shared/calculator-config';
import { mergeImportedRecipe, toCalculatorRecipe, type CatalogueRecipe, type ImportAction } from '@mise/shared/catalogue-model';
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
  // The shop computers that report in (print-agents), live: each document carries a `lastSeenAt` heartbeat.
  // No metadata: a heartbeat is a statement about RIGHT NOW, so the answer is believed whichever way it arrived.
  watchPrintAgents(
    onChange: (list: StoredDoc[]) => void,
    onError: (err: unknown) => void,
  ): () => void;
  // Puts a label job in the queue (print-jobs) for the shop computer to take. The job is built by
  // @mise/shared/print-queue-model; the venue stamp is applied here. REJECTS when the write cannot be made.
  queuePrintJob(job: Readonly<Record<string, unknown>>): Promise<void>;
  // Merges a patch into the venue's label profile (config/labels). ⚠️ A MERGE, NEVER A WHOLE WRITE: two people can
  // have Settings open, and a whole write would take the other one's paper size with it. The venue stamp is applied
  // here. Local-first on Firestore's side (the promise settles when the SERVER answers); REJECTS when refused.
  saveLabelConfig(patch: Readonly<Record<string, unknown>>): Promise<void>;
  // The suppliers, live, so the link chooser can tell two similar articles apart (their names only). Same contract
  // as watchIngredients, and as quiet when it fails (step 3d-6).
  watchSuppliers(
    onChange: (list: StoredDoc[], meta: RecipesMeta) => void,
    onError: (err: unknown) => void,
  ): () => void;
  // Creates or merges a recipe document at a known id (made on the phone by newRecipeId). ⚠️ A MERGE of the fields
  // handed over, never a whole write: the fields it is not sent (the oven loss Food cost weighed, the mixing steps)
  // stay as they are. A field handed over as null (netWeightG, shelfLifeDays) is REMOVED. The venue stamp is applied
  // here. Settles when the SERVER answers; REJECTS when refused (offline, it simply waits).
  saveRecipeDoc(id: string, data: Readonly<Record<string, unknown>>): Promise<void>;
  // Deletes a recipe document. Same promise contract.
  removeRecipeDoc(id: string): Promise<void>;
  // The Calculator's configuration (config/calculator) as stored, read ONCE, or null when there is none. Read only
  // to warn before a delete that the Calculator uses the recipe.
  getCalculatorConfig(): Promise<Record<string, unknown> | null>;
  // LINKS a recipe to the Calculator (config/calculator) in ONE transaction on the document as the server holds it: a tab
  // linked to it is added at the end, or the tab that already stands for it (an old copy 'cat-<id>', or one linked by hand)
  // is refreshed in place and linked (owner's decision, 18 Oct 2026; the current app copies). NOT local-first —
  // a transaction needs the server; offline it REJECTS and the screen says so. `marketOrderTitle` is the translated
  // word the Calculator's normaliser gives a legacy market order (the same one the Calculator passes).
  importIntoCalculator(recipe: CatalogueRecipe, marketOrderTitle: string): Promise<ImportAction>;
}

// The recipe fields a person can EMPTY. A merge never deletes a key it is not sent, and the rules refuse a stored null,
// so an emptied box travels as a removal (js/catalogue/firebase-catalogue.js, CLEARABLE_RECIPE_FIELDS).
export const CLEARABLE_RECIPE_FIELDS = ['netWeightG', 'shelfLifeDays'] as const;

// A new recipe's id, made on the phone (no write), so a new recipe appears at once and offline. The same shape as the
// id Firestore makes itself (20 letters and digits, from the browser's cryptographic random source): the current app's
// newRecipeId() asks the SDK for exactly that, and here the SDK may not have finished loading when Save is tapped.
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function newRecipeId(
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer> = bytes => crypto.getRandomValues(bytes),
): string {
  let id = '';
  while (id.length < 20) {
    // 62 × 4 = 248: a byte of 248 or more is thrown away, so every character is equally likely.
    for (const byte of random(new Uint8Array(new ArrayBuffer(40)))) {
      if (byte < 248 && id.length < 20) id += ID_ALPHABET.charAt(byte % 62);
    }
  }
  return id;
}

const RECIPES = 'recipes';
const INGREDIENTS = 'ingredients';
const CONFIG = 'config';
const LABELS_DOC = 'labels';
const PRINT_AGENTS = 'print-agents';
const PRINT_JOBS = 'print-jobs';
const SUPPLIERS = 'suppliers';
const CALCULATOR_DOC = 'calculator';

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
  const printAgentsPath = buildPath(locationId, PRINT_AGENTS);
  const printJobsPath = buildPath(locationId, PRINT_JOBS);
  const suppliersPath = buildPath(locationId, SUPPLIERS);

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

    // ⚠️ QUIET (warn): a venue that has never run an agent has no documents here, and «nothing is listening» is
    // the right answer for it rather than an error. One document per shop computer, so the cost is a single read
    // at a time (P14), attached only while the section is open.
    watchPrintAgents: (onChange, onError) => listen(kit => kit.fs.onSnapshot(
      kit.fs.collection(kit.db, printAgentsPath) as Query,
      snap => onChange(snap.docs.map(d => ({ ...d.data(), id: d.id }))),
      err => {
        console.warn('watchPrintAgents failed:', err);
        onError(err);
      },
    ), onError),

    // ⚠️ NOT LOCAL-FIRST, THE ONE WRITE THAT MUST NOT BE (the current app's rule, catalogue-store.js). Everything
    // else belongs to the venue and can wait for the network; a print job is a request to a machine in another
    // room, and pretending it was queued when it was not leaves somebody standing at a printer that will never
    // move. So it is awaited and it rejects, and the screen says so. The venue stamp is applied here, never by a
    // caller: the rules check `bakery` against the folder the document lands in.
    queuePrintJob: async job => {
      const kit = await firestore();
      await kit.fs.addDoc(kit.fs.collection(kit.db, printJobsPath), { ...job, bakery: locationId });
    },

    // The rules check `bakery` against the folder the document lands in, so the stamp is applied here, after the
    // patch (a caller cannot name another venue). `merge: true` keeps every field this build does not know about.
    saveLabelConfig: async patch => {
      const kit = await firestore();
      await kit.fs.setDoc(kit.fs.doc(kit.db, configPath, LABELS_DOC), { ...patch, bakery: locationId }, { merge: true });
    },

    // ⚠️ QUIET (warn), like the ingredients: a venue without Orders has no suppliers, and the chooser then simply shows
    // no supplier beside an article.
    watchSuppliers: (onChange, onError) => listen(kit => kit.fs.onSnapshot(
      kit.fs.collection(kit.db, suppliersPath) as Query,
      { includeMetadataChanges: true },
      snap => onChange(
        snap.docs.map(d => ({ ...d.data(), id: d.id })),
        { fromServer: !snap.metadata.fromCache },
      ),
      err => {
        console.warn('watchSuppliers failed:', err);
        onError(err);
      },
    ), onError),

    // The stamp goes on LAST, so a caller cannot name another venue; `id` is never a field (the rules' closed key list
    // would refuse the whole save).
    saveRecipeDoc: async (id, data) => {
      const kit = await firestore();
      const out: Record<string, unknown> = { ...data };
      delete out.id;
      for (const key of CLEARABLE_RECIPE_FIELDS) {
        if (key in out && out[key] === null) out[key] = kit.fs.deleteField();
      }
      await kit.fs.setDoc(kit.fs.doc(kit.db, recipesPath, id), { ...out, bakery: locationId }, { merge: true });
    },

    removeRecipeDoc: async id => {
      const kit = await firestore();
      await kit.fs.deleteDoc(kit.fs.doc(kit.db, recipesPath, id));
    },

    // ⚠️ A TRANSACTION, NOT LOCAL-FIRST (js/catalogue/import-to-calculator.js + updateConfigInTransaction): the whole
    // document is rewritten, so it is read AGAIN inside the transaction, where Firestore re-reads and retries on a
    // conflict — a concurrent Calculator save is never undone, and the recipe merges into what the SERVER holds now,
    // not into what this phone last saw (the update function runs once per attempt and keeps nothing between them).
    // ⚠️ configRev IS BUMPED (the server's + 1) so a Calculator save that loaded the old revision notices (its
    // reconcileConfigWrite) and keeps the cat-* recipe instead of overwriting it.
    // ⚠️ THE KEYS ARE normalizeConfig's, the closed list the rules accept and the Calculator's own saveConfig writes;
    // configModel and the venue stamp come LAST, after the spread, so whatever normalizeConfig carried the document
    // leaves with this build's shape number and the folder it is written to (never a venue named by a caller).
    importIntoCalculator: async (recipe, marketOrderTitle) => {
      const kit = await firestore();
      const ref = kit.fs.doc(kit.db, configPath, CALCULATOR_DOC);
      return kit.fs.runTransaction(kit.db, async tx => {
        const snap = await tx.get(ref);
        const raw = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
        const merged = mergeImportedRecipe(normalizeConfig(raw, marketOrderTitle), toCalculatorRecipe(recipe));
        // A tab already linked to this recipe: nothing to write, and the revision is not bumped (a Calculator save in the air
        // would otherwise be told to reload for no reason).
        if (merged.action === 'already') return merged.action;
        const configRev = (Number(raw?.configRev) || 0) + 1;
        tx.set(ref, { ...normalizeConfig(merged.config, marketOrderTitle), configRev, configModel: CONFIG_MODEL, bakery: locationId });
        return merged.action;
      });
    },

    getCalculatorConfig: async () => {
      const kit = await firestore();
      const snap = await kit.fs.getDoc(kit.fs.doc(kit.db, configPath, CALCULATOR_DOC));
      return snap.exists() ? { ...(snap.data() as Record<string, unknown>) } : null;
    },
  };
}
