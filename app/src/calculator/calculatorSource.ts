// calculatorSource.ts — the Calculator's data in Firestore, and nothing else.
//
// A port of the Calculator's half of js/firebase.js (`watchCalculatorConfig`, `saveCalculatorConfig`,
// `watchCatalogueRecipe`, `getCatalogueRecipesOnce`, `stampRecipeRowIds`, `watchLogs`, `saveLogDoc`), write for
// write, because firestore.rules (the `config/{doc}`, `recipes` and `logs` blocks) accept exactly these shapes
// and nothing else. Behind an interface, so the store (calculatorStore.ts) is a spec with a fake source and
// never needs a database to be tested.
//
// Under the open venue:
//   • config/calculator — the clients, products and recipes. Watched live; written WHOLE, in a transaction, by
//     the Settings (step 3c-2), never by the work view.
//   • recipes/{id} — a catalogue recipe a tab is LINKED to, read live one by one. The whole collection is read
//     ONCE, only when the link picker opens; the one write is the row-id stamp (a merge of `ingredients`) at
//     the moment a recipe is linked.
//   • logs/{id} — one confirmed dough each, WHOLE, with its append-only version chain inside; deleted one at a
//     time from the Dough history (step 3c-3).
//
// ⚠️ NO ROLE IS READ HERE, ON PURPOSE: the section gate and firestore.rules decide (P2).
//
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore(): its settings are
// fixed by its first use (src/firestore-access.spec.ts).
//
// ⚠️ EVERY LISTENER REPORTS WHETHER THE ANSWER CAME FROM THE SERVER (includeMetadataChanges): the browser's
// own database can answer «nothing» because this phone never synced it (the Pastries' trap), and only the
// store can decide whether to believe that. Without includeMetadataChanges the server's answer that is
// identical to the cached one is never reported, and a cached «nothing» would never be confirmed.

import { CONFIG_MODEL, reconcileConfigWrite } from '@mise/shared/calculator-config';
import type { CalculatorConfig } from '@mise/shared/calculator-config';
import { withRowIds } from '@mise/shared/guided-model';
import { buildPath } from '@mise/shared/location-id';
import type { Query } from 'firebase/firestore';
import type { FirestoreKit } from '../session/firebaseBackend';

// A document as the store reads it: its id beside its fields.
export type StoredDoc = { readonly id: string } & Record<string, unknown>;

// Where an answer came from: true when the SERVER sent it, false when it came from the browser's own
// database (possibly empty because this phone never synced it).
export interface AnswerMeta {
  readonly fromServer: boolean;
}

export interface CalculatorSource {
  // config/calculator, live: its fields, or null when it does not exist. Returns the unsubscribe at once
  // (Firestore may still be loading). ⚠️ A refusal or a listener that never starts calls onError, NEVER
  // onChange: «called at all» would count as the server's answer (the current app's serverAnswered guard).
  watchConfig(
    onChange: (data: Record<string, unknown> | null, meta: AnswerMeta) => void,
    onError: (err: unknown) => void,
  ): () => void;
  // One linked catalogue recipe, live: the recipe, or null when it does not exist. A refusal is an answer
  // too («cannot be read»), reported as null from the server — the tab then says the recipe is missing,
  // exactly as the current app does.
  watchLinkedRecipe(id: string, onChange: (recipe: StoredDoc | null, meta: AnswerMeta) => void): () => void;
  // The logs created since `sinceMs`, live. Ordering is the caller's.
  watchLogs(
    sinceMs: number,
    onChange: (list: StoredDoc[], meta: AnswerMeta) => void,
    onError: (err: unknown) => void,
  ): () => void;
  // One log document, WHOLE (create or overwrite), with the open venue stamped. Resolves when the server has
  // it (offline: never); rejects when it is refused.
  saveLog(log: Readonly<Record<string, unknown>> & { readonly id: string }): Promise<void>;
  // Deletes one log document (the Dough history's trash icon). Resolves when the server has done it (offline:
  // never); rejects when it is refused.
  deleteLog(id: string): Promise<void>;
  // config/calculator, WHOLE, inside a transaction (see the function). Resolves with the revision written when
  // the server has it; rejects when it is refused or cannot be reached (a transaction needs the server: offline
  // it fails, it never queues).
  saveConfig(config: CalculatorConfig): Promise<number>;
  // Every catalogue recipe, read ONCE from the SERVER (the link picker). Rejects when it cannot be read —
  // offline included: the browser's own database would answer with whatever this phone happened to see.
  listCatalogueRecipes(): Promise<StoredDoc[]>;
  // Gives every ingredient row of recipes/{id}, AS THE SERVER HOLDS IT NOW, a stable id, in a transaction, and
  // resolves with those rows. Writes only when a row lacked one (a merge of `ingredients`). Rejects when refused,
  // unreachable, or when the recipe no longer exists.
  stampRowIds(id: string): Promise<unknown[]>;
}

const CONFIG = 'config';
const CONFIG_DOC = 'calculator';
const RECIPES = 'recipes';
const LOGS = 'logs';

// ⚠️ An id that could name a different path never reaches Firestore.
export function checkId(id: unknown): string {
  if (typeof id !== 'string' || !id || id.includes('/') || id === '.' || id === '..') {
    throw new Error(`Not a document id: ${JSON.stringify(id)}`);
  }
  return id;
}

export function createFirestoreCalculatorSource(
  firestore: () => Promise<FirestoreKit>,
  locationId: string,
): CalculatorSource {
  // Throws on a venue id that could point a write anywhere else (@mise/shared/location-id).
  const configPath = buildPath(locationId, CONFIG);
  const recipesPath = buildPath(locationId, RECIPES);
  const logsPath = buildPath(locationId, LOGS);

  // A live listener whose Firestore may not be loaded yet. The returned stop works at any moment.
  // ⚠️ onSnapshot does NOT resubscribe after an error; onError lets the store say so.
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
    watchConfig: (onChange, onError) => listen(kit => kit.fs.onSnapshot(
      kit.fs.doc(kit.db, configPath, CONFIG_DOC),
      { includeMetadataChanges: true },
      snap => onChange(snap.exists() ? snap.data() : null, { fromServer: !snap.metadata.fromCache }),
      err => {
        console.error('Config listener failed:', err);
        onError(err);
      },
    ), err => {
      console.error('Config listener never started:', err);
      onError(err);
    }),

    // ⚠️ null IS AN ANSWER, NOT A SKIP: «we looked and it is gone» and «we have not looked yet» are two
    // different sentences on screen (js/calculator-catalogue-link.js). A refusal reads as gone.
    watchLinkedRecipe: (id, onChange) => {
      let safeId: string;
      try {
        safeId = checkId(id);
      } catch (err) {
        console.error('Linked recipe id refused:', err);
        onChange(null, { fromServer: true });
        return () => {};
      }
      const gone = (err: unknown) => {
        console.error(`Linked recipe ${safeId} could not be read:`, err);
        onChange(null, { fromServer: true });
      };
      return listen(kit => kit.fs.onSnapshot(
        kit.fs.doc(kit.db, recipesPath, safeId),
        { includeMetadataChanges: true },
        snap => onChange(
          snap.exists() ? { ...snap.data(), id: snap.id } : null,
          { fromServer: !snap.metadata.fromCache },
        ),
        gone,
      ), gone);
    },

    // ⚠️ BOUNDED ON PURPOSE (P14): logs are never deleted, so unbounded this would re-read the whole history
    // at every opening. A single-field range needs no composite index (js/firebase.js `watchLogs`).
    watchLogs: (sinceMs, onChange, onError) => listen(kit => kit.fs.onSnapshot(
      kit.fs.query(
        kit.fs.collection(kit.db, logsPath) as Query,
        kit.fs.where('createdAtMs', '>=', sinceMs),
      ),
      { includeMetadataChanges: true },
      snap => onChange(
        snap.docs.map(d => ({ ...d.data(), id: d.id })),
        { fromServer: !snap.metadata.fromCache },
      ),
      err => {
        console.error('Logs listener failed:', err);
        onError(err);
      },
    ), err => {
      console.error('Logs listener never started:', err);
      onError(err);
    }),

    // ⚠️ WHOLE, NOT MERGED: the version chain lives INSIDE the document, so overwriting it is right — and the
    // rules' closed key list must see exactly the log's keys.
    // ⚠️ THE VENUE IS STAMPED HERE, never trusted from the caller: log-model's createLog writes the
    // placeholder 'main', and the rules want `bakery` to name the folder written to.
    async saveLog(log) {
      const { fs, db } = await firestore();
      await fs.setDoc(fs.doc(db, logsPath, checkId(log.id)), { ...log, bakery: locationId });
    },

    // ⚠️ THE ID IS CHECKED BEFORE FIRESTORE IS EVEN LOADED: an id with a slash would delete a document of another
    // path (js/firebase.js `deleteLogDoc`).
    async deleteLog(id) {
      const safeId = checkId(id);
      const { fs, db } = await firestore();
      await fs.deleteDoc(fs.doc(db, logsPath, safeId));
    },

    // ⚠️ AN OPTIMISTIC-CONCURRENCY WRITE, IN A TRANSACTION (js/firebase.js `saveCalculatorConfig`): it always
    // writes the caller's configuration, but when the server's document changed since this one was loaded (its
    // configRev differs — a Catalogue import added a recipe meanwhile), every imported `cat-*` recipe the caller
    // lacks is kept (reconcileConfigWrite). The next revision is always the server's + 1.
    // ⚠️ configModel IS STAMPED AFTER THE SPREAD, and so is the venue: whatever the caller built, the document
    // leaves with this build's shape number (never max(stored, own): the rules refuse a lower one, which is how
    // an older build is stopped from dropping keys it does not know) and the folder it is written to.
    async saveConfig(config) {
      const { fs, db } = await firestore();
      const ref = fs.doc(db, configPath, CONFIG_DOC);
      return fs.runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        const server = snap.exists() ? snap.data() : null;
        const { recipes, configRev } = reconcileConfigWrite(config, server);
        tx.set(ref, { ...config, recipes, configRev, configModel: CONFIG_MODEL, bakery: locationId });
        return configRev;
      });
    },

    // ⚠️ READ ONCE, WHEN THE PICKER OPENS — never on opening the Calculator and never as a listener: the tabs read
    // only the two or three recipes they are linked to (P14, the v207 mistake).
    // ⚠️ FROM THE SERVER, never the browser's own database: offline that would list only the recipes this phone
    // happened to cache (or none, read as «the Catalogue is empty»).
    async listCatalogueRecipes() {
      const { fs, db } = await firestore();
      const snap = await fs.getDocsFromServer(fs.collection(db, recipesPath));
      return snap.docs.map(d => ({ ...d.data(), id: d.id }));
    },

    // ⚠️ STAMPED ON THE RECIPE AS IT IS NOW, IN A TRANSACTION — never on the picker's copy. The current app wrote
    // the list it had read when the picker opened, so a colleague's edit to that recipe in the Catalogue
    // meanwhile (an ingredient removed — the list the allergen labels are built from) was silently undone.
    // ⚠️ A MERGE OF ONE FIELD, and only when a row lacked an id: the Catalogue owns the recipe; the Calculator
    // only gives every row a stable id so the leavening is found by the row's own id, never by its name.
    async stampRowIds(id) {
      const { fs, db } = await firestore();
      const ref = fs.doc(db, recipesPath, checkId(id));
      return fs.runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw Object.assign(new Error(`Catalogue recipe ${id} no longer exists`), { code: 'not-found' });
        const rows: unknown[] = Array.isArray(snap.data().ingredients) ? snap.data().ingredients : [];
        const stamped = withRowIds(rows);
        if (stamped.some((row, i) => row !== rows[i])) tx.set(ref, { ingredients: stamped }, { merge: true });
        return stamped;
      });
    },
  };
}
