// calculatorSource.ts — the Calculator's data in Firestore, and nothing else (step 3c-1: the work view).
//
// A port of the Calculator's half of js/firebase.js (`watchCalculatorConfig`, `watchCatalogueRecipe`,
// `watchLogs`, `saveLogDoc`), write for write, because firestore.rules (the `config/{doc}`, `recipes` and
// `logs` blocks) accept exactly these shapes and nothing else. Behind an interface, so the store
// (calculatorStore.ts) is a spec with a fake source and never needs a database to be tested.
//
// Under the open venue:
//   • config/calculator — the clients, products and recipes. READ here; written whole by the Settings
//     (step 3c-2), never by the work view.
//   • recipes/{id} — a catalogue recipe a tab is LINKED to, read live one by one. Never written here.
//   • logs/{id} — one confirmed dough each, WHOLE, with its append-only version chain inside.
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
  };
}
