// importSource.ts — the database half of «Import from invoices» (step 3e-6, part B). The port of
// js/orders/invoice-import-data.js, read for read and write for write: the model (@mise/shared/invoice-import-model) decides
// WHAT would be written, the plan (@mise/shared/invoice-import-plan) turns it into documents, this file only reads and
// writes them. Same session and the same rules as every form: nothing here can do what the signed-in person could not do by
// hand (P2). Behind an interface, so the screen is specced with a fake (testing/fakeImportSource.ts) and never needs a
// database to be tested.
//
// ⚠️ THE IMPORT NEEDS THE NETWORK (parity I8). With the offline cache a write is «saved» at once and sent later, so a bulk
// import would sit half-queued behind a screen that looks finished. So every read here comes from the SERVER
// (getDocsFromServer / getDocFromServer reject offline; getDocs would answer from the cache and the «fresh» check would be a
// lie), and every write is refused before it starts when the browser says it is offline. This is the one place of Mise 2
// that is NOT local-first, on purpose (decision T3 says so).
// ⚠️ A CALL THAT NEVER ANSWERS IS A STOP, NOT A HANG (parity I9): a connection that says it is up and carries nothing leaves a
// commit pending for ever; after IMPORT_COMMIT_TIMEOUT_MS it throws code 'timeout'. ⚠️ DIFFERENCE FROM THE CURRENT APP, ON
// PURPOSE: EVERY read is bounded too (the original bounds only some of them — freshIngredientsForSupplier, invoicePointIds and
// freshPrice wait for ever), because a read that hangs freezes the run exactly like a commit does.
// ⚠️ AT MOST FIVE DOCUMENTS IN ONE BATCH (decision T8, parity I20): the plan makes them so (MAX_DOCS_PER_BATCH); the batches of
// ONE row are committed one after the other, in order, each awaited — a refused batch stops that row there (parity I23).
//
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore() (src/firestore-access.spec.ts).
// ⚠️ NO ROLE IS READ HERE: the section gate and firestore.rules decide (P2).

import { planBatchWrites, pointsOfDocs } from '@mise/shared/invoice-import-plan';
import type { DocWrite } from '@mise/shared/invoice-import-plan';
import { planDecisionBatches } from '@mise/shared/invoice-zip/selection';
import type { DecisionChanges } from '@mise/shared/invoice-zip/selection';
import { buildPath } from '@mise/shared/location-id';
import type { Query } from 'firebase/firestore';
import type { FirestoreKit } from '../../session/firebaseBackend';
import { makeSupplierId } from '../suppliersSource';
import type { StoredDoc } from '../suppliersSource';
import type { ImportRecordData } from './importLog';

const SUPPLIERS = 'suppliers';
const INGREDIENTS = 'ingredients';
const INGREDIENT_PRICES = 'ingredient-prices';
const PRICES = 'prices';
const PRICE_CHANGES = 'price-changes';
const DECISIONS = 'invoice-decisions';
const IMPORT_LOG = 'invoice-imports';

// The only folders a planned write may name (the first segment of a DocWrite path). Anything else is a bug, and is refused
// before it reaches Firestore.
const WRITABLE = new Set([SUPPLIERS, INGREDIENTS, INGREDIENT_PRICES, PRICE_CHANGES]);

export const IMPORT_COMMIT_TIMEOUT_MS = 30_000;

// An Error whose `code` the screen reads (stopKind in @mise/shared/invoice-import-plan): 'offline' | 'timeout', or the
// Firestore code of a refusal, untouched.
export class ImportError extends Error {
  readonly code: string;
  constructor(code: string) {
    // The message is the code: nobody reads it (the screen words each code), and it stays out of the dictionary.
    super(`invoice-import:${code}`);
    this.code = code;
  }
}

// The point ids already stored from an invoice for one ingredient, with the same documents read as points (so the price
// changes need no second read of the folder — parity I10).
export interface StoredPoints {
  readonly ids: ReadonlySet<string>;
  readonly points: ReturnType<typeof pointsOfDocs>;
}

// A price change already stored for one ingredient: the fields too, because an invoice that arrives out of order makes a
// stored change wrong, and the plan has to see that to remove it.
export interface StoredPriceChange {
  readonly id: string;
  readonly oldPrice: unknown;
  readonly newPrice: unknown;
  readonly oldDate: unknown;
  readonly date: unknown;
  readonly priceUnit: unknown;
}

export interface InvoiceImportSource {
  // A new supplier from the file → its id (minted here, as the supplier card does). The one supplier-card-shaped write: a
  // merge stamped with the venue.
  createSupplier(data: Readonly<Record<string, unknown>>): Promise<string>;
  // ⚠️ THE ONLY FIELD EVER WRITTEN ONTO A SUPPLIER THAT ALREADY EXISTS (parity I13). A merge: name, phone, days stay.
  linkSupplierVat(supplierId: string, vatNumber: string): Promise<void>;
  // The venue's suppliers, from the server NOW (parity I27).
  freshSuppliers(): Promise<StoredDoc[]>;
  // The venue's ingredients of one supplier, from the server NOW (parity I93).
  freshIngredientsForSupplier(supplierId: string): Promise<StoredDoc[]>;
  // The invoice points already stored for one ingredient (single-field equality, no composite index — parity I10).
  invoicePoints(ingredientId: string): Promise<StoredPoints>;
  // The price changes already stored for one ingredient.
  storedPriceChanges(ingredientId: string): Promise<StoredPriceChange[]>;
  // The ingredient's price document, null when it has none. THROWS when it cannot be read (null means «no price»).
  freshPrice(ingredientId: string): Promise<Record<string, unknown> | null>;
  // The batches of ONE row (the plan's ingredientWrites) → committed in order; a NEW ingredient's id is minted here and
  // filled into the later ops (parity I22). Resolves with the ingredient's id.
  runImportBatches(batches: Parameters<typeof planBatchWrites>[0]): Promise<string | null>;
  // The venue's remembered decisions, from the server (parity I24).
  loadDecisions(): Promise<StoredDoc[]>;
  // The selection's decisionChanges → how many documents were written or deleted (batches of at most 20, parity I24).
  writeDecisions(changes: DecisionChanges): Promise<number>;
  // The venue's import log (Mise 2 only, importLog.ts), from the server NOW: what the reader sets aside and what the screen lists.
  loadImportLog(): Promise<StoredDoc[]>;
  // One run's record, written ONCE under a new id (the rules refuse an edit) → its id.
  saveImportLog(record: ImportRecordData): Promise<string>;
}

// ⚠️ An id that could name a different path never reaches Firestore.
function checkId(id: unknown): string {
  if (typeof id !== 'string' || !id || id.includes('/') || id === '.' || id === '..') {
    throw new Error(`Not a document id: ${JSON.stringify(id)}`);
  }
  return id;
}

export interface ImportEnvironment {
  // Whether the browser says it is offline now (navigator.onLine === false). A spec passes its own.
  readonly isOffline: () => boolean;
  // The clock of the remembered decisions' `updatedAt`.
  readonly now: () => Date;
}

const BROWSER: ImportEnvironment = {
  isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
  now: () => new Date(),
};

export function createFirestoreImportSource(
  firestore: () => Promise<FirestoreKit>,
  locationId: string,
  env: ImportEnvironment = BROWSER,
): InvoiceImportSource {
  // Throws on a venue id that could point a read anywhere else (@mise/shared/location-id).
  const pathOf = (folder: string) => buildPath(locationId, folder);

  function refuseOffline(): void {
    if (env.isOffline()) throw new ImportError('offline');
  }

  function withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ImportError('timeout')), IMPORT_COMMIT_TIMEOUT_MS);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // Every call: refused offline before it starts, bounded by the timeout, Firestore loaded inside the bound.
  async function guarded<T>(run: (kit: FirestoreKit) => Promise<T>): Promise<T> {
    refuseOffline();
    return withTimeout(firestore().then(run));
  }

  const docsOf = (snap: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }): StoredDoc[] =>
    snap.docs.map(d => ({ ...d.data(), id: d.id }));

  // The venue stamp on a supplier write (the rules' stampedFor); `id` is never a field.
  const supplierData = (data: Readonly<Record<string, unknown>>) => {
    const out: Record<string, unknown> = { ...data };
    delete out.id;
    return { ...out, bakery: locationId };
  };

  // A planned write's document: its folder must be one this import writes, every segment a plain id.
  function refOf(kit: FirestoreKit, path: readonly string[]) {
    const [folder, ...rest] = path;
    if (!folder || !WRITABLE.has(folder)) throw new Error(`The import may not write to ${JSON.stringify(folder)}`);
    if (rest.length === 0) throw new Error('A planned write names no document');
    // A price point is the one write four segments deep, and only under an ingredient (review of 25 Oct 2026).
    if (rest.length === 3 && (folder !== INGREDIENTS || rest[1] !== PRICES)) throw new Error(`The import may not write to ${JSON.stringify(path.join('/'))}`);
    if (rest.length !== 1 && rest.length !== 3) throw new Error(`Not a document path: ${JSON.stringify(path.join('/'))}`);
    return kit.fs.doc(kit.db, pathOf(folder), ...rest.map(checkId));
  }

  return {
    createSupplier: data => guarded(async ({ fs, db }) => {
      const id = makeSupplierId();
      await fs.setDoc(fs.doc(db, pathOf(SUPPLIERS), id), supplierData(data), { merge: true });
      return id;
    }),

    linkSupplierVat: (supplierId, vatNumber) => guarded(async ({ fs, db }) => {
      await fs.setDoc(fs.doc(db, pathOf(SUPPLIERS), checkId(supplierId)), supplierData({ vatNumber }), { merge: true });
    }),

    // ⚠️ THE TWO READS THAT DECIDE «NEW OR ALREADY THERE» WAIT FOR THIS PHONE'S QUEUE FIRST (review of 25 Oct 2026; NOT IN THE
    // ORIGINAL, which has the same hole). A write that timed out was only given up on here: the SDK keeps it in its persistent
    // queue and sends it later, even after a reload. Without the wait, «load the same file again» on a weak connection reads a
    // server that has not got the earlier supplier or ingredient yet, and creates it a second time. `waitForPendingWrites`
    // answers at once when nothing is queued; inside the same 30 s bound, a queue that cannot drain is «no connection».
    freshSuppliers: () => guarded(async ({ fs, db }) => {
      await fs.waitForPendingWrites(db);
      return docsOf(await fs.getDocsFromServer(fs.collection(db, pathOf(SUPPLIERS)) as Query));
    }),

    freshIngredientsForSupplier: supplierId => guarded(async ({ fs, db }) => {
      await fs.waitForPendingWrites(db);
      return docsOf(await fs.getDocsFromServer(fs.query(
        fs.collection(db, pathOf(INGREDIENTS)),
        fs.where('supplierId', '==', String(supplierId)),
      )));
    }),

    invoicePoints: ingredientId => guarded(async ({ fs, db }) => {
      const snap = await fs.getDocsFromServer(fs.query(
        fs.collection(db, pathOf(INGREDIENTS), checkId(ingredientId), PRICES),
        fs.where('source', '==', 'invoice'),
      ));
      return {
        ids: new Set(snap.docs.map(d => d.id)),
        points: pointsOfDocs(snap.docs.map(d => ({ id: d.id, data: d.data() as Record<string, unknown> }))),
      };
    }),

    storedPriceChanges: ingredientId => guarded(async ({ fs, db }) => {
      const snap = await fs.getDocsFromServer(fs.query(
        fs.collection(db, pathOf(PRICE_CHANGES)),
        fs.where('ingredientId', '==', checkId(ingredientId)),
      ));
      return snap.docs.map(d => {
        const { oldPrice, newPrice, oldDate, date, priceUnit } = d.data() as Record<string, unknown>;
        return { id: d.id, oldPrice, newPrice, oldDate, date, priceUnit };
      });
    }),

    freshPrice: ingredientId => guarded(async ({ fs, db }) => {
      const snap = await fs.getDocFromServer(fs.doc(db, pathOf(INGREDIENT_PRICES), checkId(ingredientId)));
      return snap.exists() ? { ...(snap.data() as Record<string, unknown>) } : null;
    }),

    // ⚠️ EACH BATCH IS AWAITED BEFORE THE NEXT (unlike the card's category delete): the import is network-only, and a row's
    // later batches (its points) must never land when its first one (the ingredient, the price) was refused.
    async runImportBatches(batches) {
      refuseOffline();
      const kit = await withTimeout(firestore());
      const { batches: steps, ingredientId } = planBatchWrites(batches, {
        mintId: () => makeSupplierId(),
        bakery: locationId,
      });
      for (const step of steps) {
        refuseOffline();
        const batch = kit.fs.writeBatch(kit.db);
        step.forEach((write: DocWrite) => {
          const ref = refOf(kit, write.path);
          if ('remove' in write) batch.delete(ref);
          else if (write.merge) batch.set(ref, write.data, { merge: true });
          else batch.set(ref, write.data);
        });
        await withTimeout(batch.commit());
      }
      return ingredientId;
    },

    loadDecisions: () => guarded(async ({ fs, db }) =>
      docsOf(await fs.getDocsFromServer(fs.collection(db, pathOf(DECISIONS)) as Query))),

    async writeDecisions(changes) {
      refuseOffline();
      const kit = await withTimeout(firestore());
      const steps = planDecisionBatches(changes, { bakery: locationId, nowIso: env.now().toISOString() });
      let count = 0;
      for (const ops of steps) {
        refuseOffline();
        const batch = kit.fs.writeBatch(kit.db);
        ops.forEach(op => {
          const ref = kit.fs.doc(kit.db, pathOf(DECISIONS), checkId(op.id));
          if (op.type === 'set') batch.set(ref, op.data, { merge: true });
          else batch.delete(ref);
        });
        await withTimeout(batch.commit());
        count += ops.length;
      }
      return count;
    },

    loadImportLog: () => guarded(async ({ fs, db }) =>
      docsOf(await fs.getDocsFromServer(fs.collection(db, pathOf(IMPORT_LOG)) as Query))),

    // ⚠️ THE RECORD IS EXACTLY THE SIX KEYS THE RULES LIST, stamped with the venue; never a spread of anything else (no «who»).
    saveImportLog: record => guarded(async ({ fs, db }) => {
      const id = makeSupplierId();
      const { fileName, importedAt, firstDate, lastDate, months, invoiceIds } = record;
      await fs.setDoc(fs.doc(db, pathOf(IMPORT_LOG), id), {
        bakery: locationId, fileName, importedAt, firstDate, lastDate, months: [...months], invoiceIds: [...invoiceIds],
      });
      return id;
    }),
  };
}
