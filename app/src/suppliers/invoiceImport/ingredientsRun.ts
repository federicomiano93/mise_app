// ingredientsRun.ts — step 3 of the invoice import without the screen: what is already recorded, the plan of the rows, the
// remembered decisions the answers leave, and THE RUN that writes the rows one by one (step 3e-6, part B3b; the port of
// js/orders/invoice-import-screen.js `startIngredients`, `decisionChangesNow` and `runImport`, docs/parity/suppliers.md items
// I24, I88, I93–I97). No React and no Firestore: the model (@mise/shared/invoice-import-model) decides what a row writes, the
// plan (@mise/shared/invoice-import-plan) applies the answers and re-checks, importSource.ts reads and writes. The screen asks,
// shows and confirms, and hands this file the words it needs (`RunWords`), so no phrase is chosen here.
//
// ⚠️ THE RUN, IN ORDER (parity I95): the remembered decisions FIRST (a run that stops half-way keeps what the person decided —
// I24; a failure there stops nothing else); then every row that is not written is accounted for (skipped, error); then every
// writing row, each RE-PLANNED on what the server holds NOW (I93); then the rows already in Mise, whose stored history may hold
// price changes nobody recorded (I97). Only a refusal and a lost connection STOP the run (`stopKind`); any other failure is that
// row's, and the next row is tried.

import { decisionChanges } from '@mise/shared/invoice-zip/selection';
import type { DecisionChanges } from '@mise/shared/invoice-zip/selection';
import { foldInvoiceName, ingredientWrites, packLabelOf, planIngredients } from '@mise/shared/invoice-import-model';
import type { ExistingIngredient, FileIngredient, IngredientRow, PlanContext } from '@mise/shared/invoice-import-model';
import {
  idsToCheck, ingredientDisplayName, isRetryableReason, planPriceChanges, priceChangeBatches, replanRow, rowToWrite, stopKind,
  summarizeRun, writesRow,
} from '@mise/shared/invoice-import-plan';
import type { PlanEntry, PlanOp, PointIds, ReplanInput, RunResult, RunTotals } from '@mise/shared/invoice-import-plan';
import type { StoredDoc } from '../suppliersSource';
import type { ImportFile, ImportRun } from './importRun';
import type { InvoiceImportSource, StoredPoints } from './importSource';

// Reading the invoice points of a few ingredients at the same time is fine; a hundred at once is not (the original's READ_CHUNK).
export const READ_CHUNK = 8;

// An article code the way the model compares them (invoice-import-model codeOf): trimmed, lower case.
export const codeKey = (code: unknown): string => (typeof code === 'string' ? code.trim().toLowerCase() : '');

// The source answers { ids, points }; the plan reads a Set of ids with the stored points hung on it (the original's shape).
export function asPointIds(stored: StoredPoints): PointIds {
  const ids = new Set(stored.ids) as PointIds;
  ids.points = [...stored.points];
  return ids;
}

// What the person answered on step 3, held by the screen.
export interface IngredientAnswers {
  // A question («maybe-duplicate», «choose») answered: { sameAs: id } | { createNew: true } | { skip: true }.
  readonly decisions: Readonly<Record<string, unknown>>;
  // NEW rows answered «Do not import (remember)».
  readonly forgetKeys: ReadonlySet<string>;
  // Rows whose price needs a look, answered «Use this price».
  readonly confirmKeys: ReadonlySet<string>;
  // «Save the new name», for exactly the old → new pair the person saw.
  readonly renames: ReadonlyMap<string, { readonly stored: string; readonly file: string }>;
}

export const NO_ANSWERS: IngredientAnswers = Object.freeze({
  decisions: Object.freeze({}),
  forgetKeys: new Set<string>(),
  confirmKeys: new Set<string>(),
  renames: new Map<string, { stored: string; file: string }>(),
});

// The rows step 3 offers: the file's ingredients less those of a supplier the person skipped at step 2.
export const activeIngredients = (file: ImportFile, supplierSkips: ReadonlySet<string>): FileIngredient[] =>
  file.ingredients.filter(ingredient => !supplierSkips.has(ingredient.supplierKey));

export interface IngredientPlan {
  readonly ctx: PlanContext;
  readonly plannedRows: IngredientRow[];
}

// «Checking what is already in Mise…» (parity I88): what the venue holds comes from the section's store (from the server — step 1
// refuses Next before that); which invoice prices are already recorded is a server read per ingredient, made only for the ones a
// row could be matched with, READ_CHUNK at a time. Throws when a read fails (the screen says so and offers «Try again»).
export async function planIngredientStep(
  source: InvoiceImportSource,
  active: readonly FileIngredient[],
  venue: {
    readonly supplierIdByKey: Readonly<Record<string, string>>;
    readonly ingredients: readonly StoredDoc[];
    readonly pricesById: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  },
): Promise<IngredientPlan> {
  const ctxFor = (invoicePointIds: Record<string, PointIds>): PlanContext => ({
    supplierIdByKey: { ...venue.supplierIdByKey },
    ingredients: venue.ingredients as unknown as ExistingIngredient[],
    pricesById: { ...venue.pricesById } as PlanContext['pricesById'],
    invoicePointIds,
  });
  const ids = idsToCheck(planIngredients(active, ctxFor({})));
  const known: Record<string, PointIds> = {};
  for (let i = 0; i < ids.length; i += READ_CHUNK) {
    const part = ids.slice(i, i + READ_CHUNK);
    const sets = await Promise.all(part.map(id => source.invoicePoints(id)));
    part.forEach((id, k) => { known[id] = asPointIds(sets[k] as StoredPoints); });
  }
  const ctx = ctxFor(known);
  return { ctx, plannedRows: planIngredients(active, ctx) };
}

// What the person's answers of this import would leave in the remembered decisions (parity I24): products ticked back on the
// first screen, suppliers brought back, suppliers «do not import anything» at step 2, NEW rows «do not import (remember)» here.
// A forgotten row of a skipped supplier is not stored twice: the supplier's own decision covers it.
export function decisionChangesOf(run: ImportRun, supplierSkips: ReadonlySet<string>, forgetKeys: ReadonlySet<string>): DecisionChanges {
  const fileByKey = new Map(run.file.ingredients.map(ingredient => [ingredient.key, ingredient]));
  const nameOf = (key: string) => run.file.suppliers.find(supplier => supplier.key === key)?.name ?? key;
  const itemLabel = (key: string) => {
    const info = run.selection.byKey.get(key);
    const ingredient = fileByKey.get(key);
    return info ? info.label : (ingredient ? ingredient.name : key);
  };
  return decisionChanges({
    selection: run.selection,
    decisions: run.storedDecisions,
    overrides: { ...run.ticks.overrides },
    supplierOverrides: { ...run.ticks.supplierOverrides },
    supplierSkips: [...supplierSkips].map(key => ({ key, name: nameOf(key) })),
    itemSkips: [...forgetKeys]
      .filter(key => { const ingredient = fileByKey.get(key); return ingredient !== undefined && !supplierSkips.has(ingredient.supplierKey); })
      .map(key => ({ key, label: itemLabel(key) })),
  });
}

export const decisionCount = (changes: DecisionChanges): number => changes.set.length + changes.remove.length;

// The rows already in Mise that write nothing of their own: their stored history may hold price changes nobody recorded yet (a
// file loaded again, last year's zips).
export const quietRows = (entries: readonly PlanEntry[]): PlanEntry[] =>
  entries.filter(entry => entry.row.status === 'unchanged' && Boolean(entry.row.ingredientId) && !writesRow(entry));

// The sentences a result row carries into the summary, chosen by the screen (every word through t()).
export interface RunWords {
  // A reason code of a row (REASON_KEYS) → its sentence.
  reason(code: unknown): string;
  // «A similar ingredient appeared during the import. Load the file again to decide.»
  changed(): string;
  // «Could not be saved ({code})».
  writeFailed(code: string): string;
  // The stop sentence of a refusal or a lost connection.
  stop(kind: 'permission' | 'offline'): string;
}

export interface RunProgress {
  // The rows looked at so far (the bar's value) and the one being looked at now (the live line's «n»), out of `total`.
  readonly done: number;
  readonly shown: number;
  readonly total: number;
}

export interface RunInput {
  readonly source: InvoiceImportSource;
  readonly entries: readonly PlanEntry[];
  readonly ctx: PlanContext;
  readonly file: ImportFile;
  readonly supplierIdByKey: Readonly<Record<string, string>>;
  readonly answers: IngredientAnswers;
  readonly decisionChanges: DecisionChanges;
  // The venue's OUTPUT language (a new Cartone's words — outputLanguage(location)).
  readonly language: string;
  // What the section's store holds now (a row already in Mise reads its stored ingredient from it).
  readonly ingredientsNow: () => readonly StoredDoc[];
  readonly words: RunWords;
  readonly onProgress: (progress: RunProgress) => void;
  readonly now?: () => Date;
}

export interface RunOutcome {
  readonly summary: RunTotals;
  // How many remembered decisions were written or deleted, and whether that write failed (the summary says either).
  readonly decisionsWritten: number;
  readonly decisionsFailed: boolean;
  // The rows NOT seen through (importLog.ts): failed, never reached because the run stopped, or with price changes or a chosen
  // name that did not land. The invoices they hold a price of stay out of the import log, so the same file offers them again.
  readonly unfinishedKeys: ReadonlySet<string>;
}

type Read = ReplanInput['read'];
type StoredPointList = Parameters<typeof planPriceChanges>[0]['storedPoints'];

// The model's ops are the plan's ops less the index signature: the same objects, told apart only by the two files' types.
const asBatches = (batches: ReturnType<typeof ingredientWrites>): PlanOp[][] => batches as unknown as PlanOp[][];

export async function runIngredientImport(input: RunInput): Promise<RunOutcome> {
  const { source, entries, ctx, file, supplierIdByKey, answers, words, language } = input;
  const now = input.now ?? (() => new Date());
  const fileByKey = new Map(file.ingredients.map(ingredient => [ingredient.key, ingredient]));
  const writing = entries.filter(writesRow);
  const quiet = quietRows(entries);
  // «n of total» counts every row that is looked at, so a run of unchanged rows alone never says «1 of 0».
  const total = writing.length + quiet.length;
  const progress = (done: number) => { input.onProgress({ done, shown: Math.min(done + 1, total), total }); };

  const read: Read & { changeIds: (id: string) => ReturnType<InvoiceImportSource['storedPriceChanges']> } = {
    ingredients: async supplierId => (await source.freshIngredientsForSupplier(supplierId)) as unknown as ExistingIngredient[],
    pointIds: async id => asPointIds(await source.invoicePoints(id)),
    price: id => source.freshPrice(id),
    changeIds: id => source.storedPriceChanges(id),
  };

  // The price changes of one ingredient, in their OWN batches after the row's prices: a refused change never undoes a price that
  // is already in (parity I21). ⚠️ A FAILURE HERE IS NEVER THE ROW'S (parity I97): the row keeps its real outcome, the run goes
  // on, and the summary counts the ingredients whose changes are missing (a second load completes them).
  const recordChanges = async (
    fileIngredient: FileIngredient | undefined,
    info: Omit<Parameters<typeof planPriceChanges>[0], 'read' | 'nowIso' | 'packLabel' | 'packCode' | 'unitWeightKg'>,
  ): Promise<{ added: number; failed: number }> => {
    try {
      const ops = await planPriceChanges({
        ...info, read, nowIso: now().toISOString(),
        packLabel: fileIngredient ? packLabelOf(fileIngredient) : undefined,
        packCode: fileIngredient ? fileIngredient.supplierCode : undefined,
        unitWeightKg: fileIngredient ? fileIngredient.unitWeightKg : undefined,
      });
      const batches = priceChangeBatches(ops);
      if (batches.length > 0) await source.runImportBatches(batches);
      return { added: ops.create.length, failed: 0 };
    } catch (error) {
      console.error('Recording the price changes of one ingredient failed:', error);
      return { added: 0, failed: 1 };
    }
  };

  // ⚠️ THE RE-CHECK MUST NOT TRIP OVER THIS VERY RUN (parity I94; 5 Oct 2026, the first real zip: 43 of 238 rows came back «a
  // similar ingredient appeared»). Two invoice products of one supplier with DIFFERENT article codes are two products by the
  // supplier's own numbering — «Aceto bianco» and «Aceto rosso» — and both were planned «new» on the screen the owner confirmed.
  // So an ingredient created by this run is hidden from the re-check of a row whose code differs from its own. Without a code on
  // either side (or a «unisci con» row) nothing is hidden: then a similar name really may be the same product, and the row still
  // becomes a question rather than a duplicate.
  const createdThisRun = new Map<string, string>();   // ingredient id → its article code (normalised), created by this run
  const readFor = (fileIngredient: FileIngredient): Read => {
    const code = codeKey(fileIngredient.supplierCode);
    if (!code || fileIngredient.mergeWith) return read;
    return {
      ...read,
      ingredients: async supplierId => (await read.ingredients(supplierId)).filter(ingredient => {
        const created = createdThisRun.get(ingredient.id as string);
        return created === undefined || !created || created === code;
      }),
    };
  };
  const replan = (fileIngredient: FileIngredient, key: string) => replanRow({
    fileIngredient, decision: answers.decisions[key], supplierIdByKey: { ...supplierIdByKey }, read: readFor(fileIngredient),
  });
  const toWrite = (fresh: IngredientRow, key: string, held: boolean) => rowToWrite(fresh, {
    confirmed: answers.confirmKeys.has(key), rename: answers.renames.get(key) ?? null, held,
  });

  const results: RunResult[] = [];
  let stopped: 'permission' | 'offline' | null = null;
  let notRun = 0;
  progress(0);

  // ⚠️ THE REMEMBERED ANSWERS GO FIRST (parity I24), in small batches: a run that stops half-way must not lose what the person
  // decided. A failure here stops nothing else; the summary says so.
  let decisionsWritten = 0;
  let decisionsFailed = false;
  if (decisionCount(input.decisionChanges) > 0) {
    try {
      decisionsWritten = await source.writeDecisions(input.decisionChanges);
    } catch (error) {
      console.error('Remembering the decisions failed:', error);
      decisionsFailed = true;
    }
  }

  // Rows whose price waits for a look («Lascia per ora», or a reason only the fresh read found): their invoices are NOT done, so
  // the import log leaves them out and the next load offers that price again.
  const held = new Set<string>();
  // Everything that is not written is accounted for first: nothing is dropped silently.
  entries.forEach(({ planned, row }) => {
    if (row.status === 'skipped' && row.held === true) held.add(planned.key);
    if (row.status === 'skipped') results.push({ key: planned.key, name: planned.name, outcome: 'skipped' });
    else if (row.status === 'error') {
      results.push({ key: planned.key, name: planned.name, outcome: 'failed', reason: words.reason(row.reason), retry: isRetryableReason(row.reason) });
    }
  });

  for (let i = 0; i < writing.length; i++) {
    const { planned, row: shown } = writing[i] as PlanEntry;
    const fileIngredient = fileByKey.get(planned.key) as FileIngredient;
    progress(i);
    try {
      // ⚠️ THE RE-CHECK (parity I93): the plan on screen is minutes old, and the rows before this one have changed the catalogue.
      // This one row is planned again on what the server holds NOW, so a name that now matches an ingredient created a moment ago
      // becomes an update, never a second copy.
      const fresh = await replan(fileIngredient, planned.key);
      const wrow = fresh.waiting ? null : toWrite(fresh.row, planned.key, shown.held === true);
      if (fresh.waiting) {
        results.push({ key: planned.key, name: planned.name, outcome: 'failed', reason: words.changed(), retry: true });
      } else if (!wrow) {
        // The fresh read found a price that needs a look which the screen did not show: nobody confirmed it.
        held.add(planned.key);
        results.push({ key: planned.key, name: planned.name, outcome: 'skipped' });
      } else if (wrow.status === 'unchanged') {
        // Every price is in already, but the file may carry a pack code (or a chosen name) the ingredient has not learnt yet.
        const codeBatches = asBatches(ingredientWrites(wrow, fileIngredient, now().toISOString(), { language }));
        if (codeBatches.length > 0) await source.runImportBatches(codeBatches);
        const recorded = await recordChanges(fileIngredient, {
          ingredientId: wrow.ingredientId, supplierId: wrow.supplierId, name: ingredientDisplayName(fresh.ingredient),
          storedPoints: fresh.storedPoints as StoredPointList, newPoints: [],
          priceUnit: fileIngredient.priceUnit, isNew: false, ingredient: fresh.ingredient ?? null,
        });
        if (wrow.held) held.add(planned.key);
        results.push({
          // A row held for its price whose name was saved is a held row, not an unchanged one.
          key: planned.key, name: planned.name, outcome: wrow.held ? 'skipped' : 'unchanged', changesAdded: recorded.added,
          changesFailed: recorded.failed, codesFull: wrow.codesFull === true,
          namesSaved: wrow.patchInvoiceName && codeBatches.length > 0 ? 1 : 0,
        });
      } else if (['new', 'update-price', 'history-only'].includes(wrow.status)) {
        const batches = asBatches(ingredientWrites(wrow, fileIngredient, now().toISOString(), { language }));
        const isNew = wrow.status === 'new';
        const writtenId = batches.length > 0 ? await source.runImportBatches(batches) : (wrow.ingredientId as string | undefined) ?? null;
        if (isNew && writtenId) createdThisRun.set(writtenId, codeKey(fileIngredient.supplierCode));
        const recorded = await recordChanges(fileIngredient, {
          ingredientId: writtenId, supplierId: wrow.supplierId,
          name: isNew ? fileIngredient.name : ingredientDisplayName(fresh.ingredient),
          storedPoints: (isNew ? [] : fresh.storedPoints) as StoredPointList,
          newPoints: wrow.newPoints as unknown as StoredPointList, ingredient: isNew ? null : fresh.ingredient ?? null,
          priceUnit: fileIngredient.priceUnit, isNew,
        });
        results.push({
          key: planned.key, name: planned.name, pricesAdded: wrow.newPoints.length,
          changesAdded: recorded.added, changesFailed: recorded.failed, codesFull: wrow.codesFull === true,
          namesSaved: wrow.status !== 'new' && wrow.patchInvoiceName && batches.length > 0 ? 1 : 0,
          outcome: batches.length === 0 ? 'unchanged' : (isNew ? 'created' : 'updated'),
        });
      } else {
        results.push({
          key: planned.key, name: planned.name, outcome: 'failed', reason: words.reason(fresh.row.reason),
          retry: isRetryableReason(fresh.row.reason),
        });
      }
      // A rename the person chose that is not going to be written (the name or the file moved since they looked): the summary says
      // so, never silently.
      const rename = answers.renames.get(planned.key);
      if (rename && !fresh.waiting && !(wrow && wrow.patchInvoiceName)) {
        // Somebody saved the very same name meanwhile: nothing to write, and nothing lost.
        const stored = fresh.ingredient && typeof fresh.ingredient.invoiceName === 'string' ? fresh.ingredient.invoiceName : '';
        const last = results[results.length - 1] as RunResult;
        if (foldInvoiceName(stored) === foldInvoiceName(rename.file)) last.namesSaved = 1;
        else last.namesLost = 1;
      }
    } catch (error) {
      console.error('Importing one ingredient failed:', error);
      const kind = stopKind(error);
      const code = (error as { code?: unknown } | null)?.code;
      results.push({
        key: planned.key, name: planned.name, outcome: 'failed', retry: true,
        reason: kind ? words.stop(kind) : words.writeFailed(String(code ? code : 'unknown')),
      });
      if (kind) { stopped = kind; notRun = writing.length - i - 1; break; }
    }
  }

  // The rows already in Mise: the points come from the read made when the plan was drawn.
  for (let i = 0; i < quiet.length; i++) {
    const { planned, row } = quiet[i] as PlanEntry;
    if (stopped) { results.push({ key: planned.key, name: planned.name, outcome: 'unchanged' }); continue; }
    progress(writing.length + i);
    // Nothing here can fail the row (it writes nothing of its own) nor stop the run: a point read or a change write that fails is
    // counted in the summary, and the next ingredient is tried.
    let recorded: { added: number; failed: number };
    let codesFull = false;
    try {
      const ingredientId = row.ingredientId as string;
      const known = (ctx.invoicePointIds as Record<string, PointIds> | undefined)?.[ingredientId];
      const points = known && Array.isArray(known.points) ? known.points : ((await read.pointIds(ingredientId)).points ?? []);
      const stored = input.ingredientsNow().find(ingredient => ingredient.id === ingredientId) as ExistingIngredient | undefined;
      // A pack code the ingredient has not learnt yet is written from a FRESH plan, never the one on screen: another row of this
      // run may have added a code to the same ingredient a moment ago. A failure here is logged only: the price changes below are
      // still recorded.
      const fileIngredient = fileByKey.get(planned.key);
      if (fileIngredient && (row.patchSupplierCode || row.setSupplierCodes || row.codesFull || row.patchInvoiceName)) {
        try {
          const fresh = await replan(fileIngredient, planned.key);
          // A row whose fresh plan needs a confirmation nobody gave is left alone.
          const wrow = toWrite(fresh.row, planned.key, row.held === true);
          if (wrow && wrow.status === 'unchanged') {
            const codeBatches = asBatches(ingredientWrites(wrow, fileIngredient, now().toISOString(), { language }));
            if (codeBatches.length > 0) await source.runImportBatches(codeBatches);
            codesFull = wrow.codesFull === true;
          }
        } catch (error) {
          console.error('Remembering a pack code failed:', error);
        }
      }
      recorded = await recordChanges(fileIngredient, {
        ingredientId, supplierId: row.supplierId, name: ingredientDisplayName(stored) || planned.name,
        storedPoints: points as StoredPointList, newPoints: [],
        priceUnit: row.priceUnit ?? undefined, isNew: false, ingredient: stored ?? null,
      });
    } catch (error) {
      console.error('Reading the stored prices of one ingredient failed:', error);
      recorded = { added: 0, failed: 1 };
    }
    results.push({ key: planned.key, name: planned.name, outcome: 'unchanged', changesAdded: recorded.added, changesFailed: recorded.failed, codesFull });
  }

  return {
    summary: summarizeRun(results, { stopped, notRun }), decisionsWritten, decisionsFailed,
    unfinishedKeys: unfinishedOf(entries, results, stopped ? quiet : [], held),
  };
}

// Every row of the run that was not seen through: no result at all (the run stopped before it), a failed one, price changes or a
// chosen name that did not land, or a row already in Mise that the stop passed over (`passedOver`: its result says «unchanged»,
// but its price changes were never looked at), or a row whose price was held for a look (`held`: its result says «skipped», but
// the price waits — «Lascia per ora» is a promise to come back, not a choice to leave the invoice out).
export function unfinishedOf(
  entries: readonly PlanEntry[], results: readonly RunResult[], passedOver: readonly PlanEntry[], held: ReadonlySet<string> = new Set(),
): Set<string> {
  const done = new Set<string>();
  results.forEach(result => {
    if (result.outcome !== 'failed' && !(Number(result.changesFailed) > 0) && !result.namesLost) done.add(result.key);
  });
  passedOver.forEach(entry => { done.delete(entry.planned.key); });
  held.forEach(key => { done.delete(key); });
  // A row with two results (never today) is done only if every one of them is.
  results.forEach(result => {
    if (result.outcome === 'failed' || Number(result.changesFailed) > 0 || result.namesLost) done.delete(result.key);
  });
  return new Set(entries.map(entry => entry.planned.key).filter(key => !done.has(key)));
}
