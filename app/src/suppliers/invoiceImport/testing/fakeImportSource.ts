// fakeImportSource.ts — an in-memory InvoiceImportSource for the screen's specs (specs only).
//
// It behaves like the venue's database as far as the import can tell: suppliers it creates are in the next freshSuppliers(),
// a decision it writes is in the next loadDecisions(). On top of that it
//   • RECORDS every call (`calls`, in order) and every write (`writes`, in order), so a spec can say «nothing was written» and
//     «the decisions went before the rows»;
//   • FAILS a method with a code on request (`failWith('freshSuppliers', 'offline')`): the error carries `code`, as the real
//     source's ImportError and Firestore's do, so the screen's stopKind() reads it;
//   • HOLDS a call pending (`hold('createSupplier')`) until the spec releases it, to look at the screen while a write is in the
//     air (Back is off, the picker is off).
//
// Invented data only.

import { planBatchWrites, pointsOfDocs } from '@mise/shared/invoice-import-plan';
import type { DocWrite } from '@mise/shared/invoice-import-plan';
import type { DecisionChanges } from '@mise/shared/invoice-zip/selection';
import type { InvoiceImportSource, StoredPoints, StoredPriceChange } from '../importSource';
import type { ImportRecordData } from '../importLog';
import type { StoredDoc } from '../../suppliersSource';

export type ImportMethod = keyof InvoiceImportSource;

export type ImportWrite =
  | { readonly kind: 'createSupplier'; readonly id: string; readonly data: Readonly<Record<string, unknown>> }
  | { readonly kind: 'linkSupplierVat'; readonly supplierId: string; readonly vatNumber: string }
  | { readonly kind: 'decisions'; readonly changes: DecisionChanges }
  // The DocWrites of one row's batches, as planBatchWrites made them (the ids already minted).
  | { readonly kind: 'batches'; readonly batches: readonly (readonly DocWrite[])[] }
  | { readonly kind: 'importLog'; readonly id: string; readonly record: ImportRecordData };

export interface FakeImportSource extends InvoiceImportSource {
  // «The server»: what the next fresh read returns. A spec edits these to play another phone.
  suppliers: StoredDoc[];
  ingredients: StoredDoc[];
  decisions: StoredDoc[];
  // The import log's records (invoice-imports): what loadImportLog() returns; saveImportLog() adds to it.
  importLog: StoredDoc[];
  // The invoice points already stored, by ingredient id (none = nothing recorded yet): what step 3 reads to tell a price that is in.
  // The points the run writes are added to these on the next read.
  points: Map<string, StoredPoints>;
  // The price documents (ingredient-prices) by ingredient id, and the price changes by their id: what the run writes lands here.
  prices: Map<string, Record<string, unknown>>;
  priceChanges: Map<string, Record<string, unknown>>;
  // Every call, in order: [method, ...arguments].
  readonly calls: Array<readonly [ImportMethod, ...unknown[]]>;
  // Every write, in order.
  readonly writes: ImportWrite[];
  // Every call of this method from now on fails with this code; null stops it. With `after`, the first `after` calls (counted from the
  // start) still succeed and the ones beyond fail: a write that goes wrong half-way.
  failWith(method: ImportMethod, code: string | null, after?: number): void;
  // The next call of this method waits until `release()`. Returns the release.
  hold(method: ImportMethod): () => void;
  // Runs just before freshSuppliers() answers: another phone adds a supplier «meanwhile».
  beforeFreshSuppliers: (() => void) | null;
  countOf(method: ImportMethod): number;
}

export function fakeImportSource(
  initial: {
    suppliers?: StoredDoc[]; ingredients?: StoredDoc[]; decisions?: StoredDoc[]; importLog?: StoredDoc[];
    prices?: Record<string, Record<string, unknown>>;
  } = {},
): FakeImportSource {
  const failures = new Map<ImportMethod, { code: string; after: number }>();
  const holds = new Map<ImportMethod, Promise<void>>();
  let minted = 0;
  let mintedIngredients = 0;
  let mintedRecords = 0;
  // The history points the run wrote, by ingredient id then point id.
  const pointDocs = new Map<string, Map<string, Record<string, unknown>>>();

  const self: FakeImportSource = {
    suppliers: [...(initial.suppliers ?? [])],
    ingredients: [...(initial.ingredients ?? [])],
    decisions: [...(initial.decisions ?? [])],
    importLog: [...(initial.importLog ?? [])],
    points: new Map<string, StoredPoints>(),
    prices: new Map(Object.entries(initial.prices ?? {})),
    priceChanges: new Map<string, Record<string, unknown>>(),
    calls: [],
    writes: [],
    beforeFreshSuppliers: null,

    failWith(method, code, after = 0) {
      if (code === null) failures.delete(method);
      else failures.set(method, { code, after });
    },
    hold(method) {
      let release: () => void = () => undefined;
      holds.set(method, new Promise<void>(resolve => { release = resolve; }));
      return release;
    },
    countOf: method => self.calls.filter(call => call[0] === method).length,

    createSupplier: data => run('createSupplier', [data], () => {
      minted += 1;
      const id = `sup-${minted}`;
      self.suppliers.push({ ...data, id });
      self.writes.push({ kind: 'createSupplier', id, data });
      return id;
    }),
    linkSupplierVat: (supplierId, vatNumber) => run('linkSupplierVat', [supplierId, vatNumber], () => {
      const at = self.suppliers.findIndex(supplier => supplier.id === supplierId);
      if (at >= 0) self.suppliers[at] = { ...self.suppliers[at], vatNumber } as StoredDoc;
      self.writes.push({ kind: 'linkSupplierVat', supplierId, vatNumber });
    }),
    freshSuppliers: () => run('freshSuppliers', [], () => {
      self.beforeFreshSuppliers?.();
      return self.suppliers.map(supplier => ({ ...supplier }));
    }),
    freshIngredientsForSupplier: supplierId => run('freshIngredientsForSupplier', [supplierId],
      () => self.ingredients.filter(ingredient => ingredient.supplierId === supplierId).map(ingredient => ({ ...ingredient }))),
    invoicePoints: ingredientId => run('invoicePoints', [ingredientId], (): StoredPoints => {
      const seeded = self.points.get(ingredientId);
      const written = [...(pointDocs.get(ingredientId) ?? new Map()).entries()].map(([id, data]) => ({ id, data }));
      return {
        ids: new Set([...(seeded?.ids ?? []), ...written.map(point => point.id)]),
        points: [...(seeded?.points ?? []), ...pointsOfDocs(written)],
      };
    }),
    storedPriceChanges: ingredientId => run('storedPriceChanges', [ingredientId], (): StoredPriceChange[] =>
      [...self.priceChanges.entries()].filter(([, data]) => data.ingredientId === ingredientId).map(([id, data]) => ({
        id, oldPrice: data.oldPrice, newPrice: data.newPrice, oldDate: data.oldDate, date: data.date, priceUnit: data.priceUnit,
      }))),
    freshPrice: ingredientId => run('freshPrice', [ingredientId], () => {
      const price = self.prices.get(ingredientId);
      return price ? { ...price } : null;
    }),
    runImportBatches: batches => run('runImportBatches', [batches], () => {
      // The way the database would: a NEW ingredient gets its id here, and every write lands where its path says.
      const { batches: steps, ingredientId } = planBatchWrites(batches, { mintId: () => `ing-${++mintedIngredients}`, bakery: 'test' });
      self.writes.push({ kind: 'batches', batches: steps });
      for (const step of steps) step.forEach(write => { apply(write); });
      return ingredientId;
    }),
    loadDecisions: () => run('loadDecisions', [], () => self.decisions.map(decision => ({ ...decision }))),
    writeDecisions: changes => run('writeDecisions', [changes], () => {
      self.writes.push({ kind: 'decisions', changes });
      self.decisions = self.decisions.filter(decision => !changes.remove.includes(decision.id));
      for (const change of changes.set) {
        self.decisions = [...self.decisions.filter(decision => decision.id !== change.id),
          { id: change.id, decision: change.decision, label: change.label }];
      }
      return changes.set.length + changes.remove.length;
    }),
    loadImportLog: () => run('loadImportLog', [], () => self.importLog.map(record => ({ ...record }))),
    saveImportLog: record => run('saveImportLog', [record], () => {
      mintedRecords += 1;
      const id = `imp-${mintedRecords}`;
      self.importLog.push({ ...record, id });
      self.writes.push({ kind: 'importLog', id, record });
      return id;
    }),
  };

  // One planned write, applied to the fake's «server».
  function apply(write: DocWrite): void {
    const [folder, id, sub, pointId] = write.path;
    if (folder === 'ingredients' && id && sub === 'prices' && pointId) {
      const points = pointDocs.get(id) ?? new Map<string, Record<string, unknown>>();
      if ('remove' in write) points.delete(pointId);
      else points.set(pointId, { ...write.data });
      pointDocs.set(id, points);
    } else if (folder === 'ingredients' && id) {
      const at = self.ingredients.findIndex(ingredient => ingredient.id === id);
      if ('remove' in write) {
        if (at >= 0) self.ingredients.splice(at, 1);
      } else if (at >= 0) {
        self.ingredients[at] = { ...self.ingredients[at], ...write.data, id } as StoredDoc;
      } else {
        self.ingredients.push({ ...write.data, id } as StoredDoc);
      }
    } else if (folder === 'ingredient-prices' && id) {
      if ('remove' in write) self.prices.delete(id);
      else self.prices.set(id, { ...self.prices.get(id), ...write.data });
    } else if (folder === 'price-changes' && id) {
      if ('remove' in write) self.priceChanges.delete(id);
      else self.priceChanges.set(id, { ...write.data });
    } else {
      throw new Error(`The fake import source does not know the path ${write.path.join('/')}`);
    }
  }

  // One call: recorded when it starts, held if a spec asked, failed if a spec asked, done otherwise.
  async function run<T>(method: ImportMethod, args: unknown[], work: () => T): Promise<T> {
    self.calls.push([method, ...args]);
    const held = holds.get(method);
    if (held) {
      holds.delete(method);
      await held;
    }
    const failure = failures.get(method);
    if (failure !== undefined && self.countOf(method) > failure.after) {
      throw Object.assign(new Error(`fake-import:${failure.code}`), { code: failure.code });
    }
    return work();
  }

  return self;
}
