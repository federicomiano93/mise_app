import { describe, expect, it, vi } from 'vitest';
import { IMPORT_FORMAT, IMPORT_VERSION, parseImportFile } from '@mise/shared/invoice-import-model';
import { applyDecisions } from '@mise/shared/invoice-import-plan';
import type { PlanEntry } from '@mise/shared/invoice-import-plan';
import type { StoredDoc } from '../suppliersSource';
import type { ImportFile } from './importRun';
import {
  NO_ANSWERS, decisionCount, planIngredientStep, quietRows, runIngredientImport, unfinishedOf,
} from './ingredientsRun';
import type { IngredientAnswers, RunProgress, RunWords } from './ingredientsRun';
import { fakeImportSource } from './testing/fakeImportSource';
import type { FakeImportSource } from './testing/fakeImportSource';

// The run of step 3 without the screen (ingredientsRun.ts), against the fake database that applies what is written.
//
// PORTS (tests/invoice-import-flow.test.mjs): «the remembered decisions are written BEFORE the rows, and a failure there stops
// nothing else», «a refusal stops the run at once and says how many were not tried», «losing the connection stops the run too»,
// «any other failure is recorded with its reason and the run goes on», «a row that matches an ingredient created moments ago
// becomes a question, never a duplicate», «two NEW products with different article codes are both created», «a refused price
// change never fails the row nor stops the run», «a lost connection while recording the changes of rows already in Mise fails no
// row either», «the progress line never says “1 of 0”», «recording price changes never sets stopped». The file is built the way
// the original's flow test builds it (a parsed import file), so the run is exercised without the invoice reader.

const SUPPLIER_KEY = 'IT00000000001';
const IDS = { [SUPPLIER_KEY]: 'sup-1' };

const point = (over: Record<string, unknown> = {}) => ({
  invoiceId: '18000000001', line: 1, invoiceDate: '2026-09-10', pricePerUnit: 0.57, qty: 50, reliability: 'alta', ...over,
});
// The invoice name follows the name, as it does on a real invoice: two products never share one.
const product = (over: Record<string, unknown> = {}) => ({
  key: 'k1', supplierKey: SUPPLIER_KEY, mergeWith: '', name: 'Zucchero velo', brand: '', category: '',
  supplierCode: '', weight: '10 kg', packUnit: 'sacco', packCount: null, priceUnit: 'kg', unitWeightKg: null, vatRate: 4,
  prices: [point()], ...over,
  invoiceName: String(over.invoiceName ?? over.name ?? 'Zucchero velo').toUpperCase(),
});

function fileOf(...ingredients: Record<string, unknown>[]): ImportFile {
  const parsed = parseImportFile(JSON.stringify({
    format: IMPORT_FORMAT, version: IMPORT_VERSION, generatedAt: '2026-10-03T10:00:00Z',
    suppliers: [{ key: SUPPLIER_KEY, vatNumber: SUPPLIER_KEY, name: 'FORNITORE ESEMPIO SRL' }],
    ingredients,
  }));
  if (!parsed.ok) throw new Error(`the test file is not an import file: ${parsed.error}`);
  return parsed.file;
}

const WORDS: RunWords = {
  reason: code => `reason:${String(code)}`,
  changed: () => 'changed',
  writeFailed: code => `failed:${code}`,
  stop: kind => `stop:${kind}`,
};

async function plan(importing: FakeImportSource, file: ImportFile, answers: IngredientAnswers = NO_ANSWERS, stored: StoredDoc[] = []) {
  const planned = await planIngredientStep(importing, file.ingredients, { supplierIdByKey: IDS, ingredients: stored, pricesById: {} });
  const entries = applyDecisions(planned.plannedRows, answers.decisions, planned.ctx, answers.forgetKeys, answers.confirmKeys, answers.renames);
  return { planned, entries };
}

async function run(
  importing: FakeImportSource, file: ImportFile, options: { decisions?: { set: never[]; remove: string[] } | { set: unknown[]; remove: string[] }; stored?: StoredDoc[] } = {},
) {
  const { planned, entries } = await plan(importing, file, NO_ANSWERS, options.stored);
  const progress: RunProgress[] = [];
  const outcome = await runIngredientImport({
    source: importing, entries, ctx: planned.ctx, file, supplierIdByKey: IDS, answers: NO_ANSWERS,
    decisionChanges: (options.decisions ?? { set: [], remove: [] }) as never, language: 'en',
    ingredientsNow: () => importing.ingredients, words: WORDS, onProgress: p => { progress.push(p); },
  });
  return { outcome, progress, entries };
}

const THREE = () => fileOf(
  product({ key: 'k1', name: 'Zucchero velo' }),
  product({ key: 'k2', name: 'Olio extravergine', prices: [point({ line: 2 })] }),
  product({ key: 'k3', name: 'Sale marino', prices: [point({ line: 3 })] }),
);

describe('the rows are written one by one', () => {
  it('creates every new ingredient with its price, and says so', async () => {
    const importing = fakeImportSource();
    const { outcome } = await run(importing, THREE());
    expect(outcome.summary).toMatchObject({ created: 3, pricesAdded: 3, stopped: null, notRun: 0 });
    expect(importing.ingredients.map(ingredient => ingredient.name).sort()).toEqual(['Olio extravergine', 'Sale marino', 'Zucchero velo']);
    expect(importing.ingredients.every(ingredient => /^ing-\d+$/.test(ingredient.id))).toBe(true);
    expect(importing.prices.size).toBe(3);
  });

  it('⚠️ the remembered decisions go FIRST, and a failure there stops nothing else', async () => {
    const decisions = { set: [{ id: 'd1', key: 'k9', decision: 'skip', label: 'Sale fino' }], remove: [] };
    expect(decisionCount(decisions as never)).toBe(1);
    const ok = fakeImportSource();
    const done = await run(ok, THREE(), { decisions });
    expect(ok.writes[0]?.kind).toBe('decisions');
    expect(ok.writes.slice(1).every(write => write.kind === 'batches')).toBe(true);
    expect(done.outcome).toMatchObject({ decisionsWritten: 1, decisionsFailed: false });

    const broken = fakeImportSource();
    broken.failWith('writeDecisions', 'invalid-argument');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed = await run(broken, THREE(), { decisions });
    expect(failed.outcome).toMatchObject({ decisionsWritten: 0, decisionsFailed: true });
    expect(failed.outcome.summary.created).toBe(3);
  });

  it('⚠️ a refusal stops the run at once and says how many were not tried', async () => {
    const importing = fakeImportSource();
    importing.failWith('runImportBatches', 'permission-denied');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { outcome } = await run(importing, THREE());
    expect(importing.countOf('runImportBatches')).toBe(1);
    expect(outcome.summary).toMatchObject({ stopped: 'permission', notRun: 2, created: 0 });
    expect(outcome.summary.failed.map(failure => failure.reason)).toEqual(['stop:permission']);
  });

  it('losing the connection stops the run too, and the row before it stays', async () => {
    const importing = fakeImportSource();
    importing.failWith('runImportBatches', 'unavailable', 1);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { outcome } = await run(importing, THREE());
    expect(outcome.summary).toMatchObject({ stopped: 'offline', notRun: 1, created: 1 });
    expect(importing.ingredients).toHaveLength(1);
  });

  it('any other failure is that row\'s: its reason is kept and the next row is tried', async () => {
    const importing = fakeImportSource();
    importing.failWith('runImportBatches', 'invalid-argument');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { outcome } = await run(importing, THREE());
    expect(importing.countOf('runImportBatches')).toBe(3);
    expect(outcome.summary.stopped).toBeNull();
    expect(outcome.summary.failed.map(failure => failure.reason)).toEqual(['failed:invalid-argument', 'failed:invalid-argument', 'failed:invalid-argument']);
    expect(outcome.summary.retryable).toBe(3);
  });

  it('⚠️ two NEW products with different article codes are both created, however alike their names', async () => {
    const importing = fakeImportSource();
    const { outcome } = await run(importing, fileOf(
      product({ key: `${SUPPLIER_KEY}|code:AC-B`, supplierCode: 'AC-B', name: 'Aceto bianco 1 l' }),
      product({ key: `${SUPPLIER_KEY}|code:AC-R`, supplierCode: 'AC-R', name: 'Aceto rosso 1 l', prices: [point({ line: 2 })] }),
    ));
    expect(outcome.summary.created).toBe(2);
    expect(importing.ingredients.map(ingredient => ingredient.supplierCode).sort()).toEqual(['AC-B', 'AC-R']);
  });

  it('⚠️ a row that matches an ingredient created moments ago is told to decide again, never made a duplicate', async () => {
    const importing = fakeImportSource();
    const { outcome } = await run(importing, fileOf(
      product({ key: 'k1', name: 'Farina 00' }),
      product({ key: 'k2', name: 'Farina 00 Premium', prices: [point({ line: 2 })] }),
    ));
    expect(importing.ingredients).toHaveLength(1);
    expect(outcome.summary.created).toBe(1);
    expect(outcome.summary.failed).toEqual([{ key: 'k2', name: 'Farina 00 Premium', reason: 'changed', retry: true }]);
  });

  it('a row skipped or in error is accounted for, never dropped', async () => {
    const importing = fakeImportSource();
    const answers: IngredientAnswers = { ...NO_ANSWERS, forgetKeys: new Set(['k2']) };
    const file = fileOf(
      product({ key: 'k1' }), product({ key: 'k2', name: 'Olio', prices: [point({ line: 2 })] }),
      product({ key: 'k3', name: 'Sale', supplierKey: 'IT99999999999', prices: [point({ line: 3 })] }),
    );
    const { planned, entries } = await plan(importing, file, answers);
    const outcome = await runIngredientImport({
      source: importing, entries, ctx: planned.ctx, file, supplierIdByKey: IDS, answers, decisionChanges: { set: [], remove: [] },
      language: 'en', ingredientsNow: () => importing.ingredients, words: WORDS, onProgress: () => undefined,
    });
    expect(outcome.summary).toMatchObject({ created: 1, skipped: 1 });
    expect(outcome.summary.failed).toEqual([{ key: 'k3', name: 'Sale', reason: 'reason:supplier-missing', retry: false }]);
  });
});

describe('price changes', () => {
  const RISING = () => fileOf(product({ prices: [point({ invoiceId: '18000000001', line: 1, invoiceDate: '2026-09-01', pricePerUnit: 1 }),
    point({ invoiceId: '18000000002', line: 1, invoiceDate: '2026-09-10', pricePerUnit: 1.1 })] }));

  it('a rise between two invoices is recorded in its own batch after the prices', async () => {
    const importing = fakeImportSource();
    const { outcome } = await run(importing, RISING());
    expect(outcome.summary).toMatchObject({ created: 1, pricesAdded: 2, changesAdded: 1, changesFailed: 0 });
    expect(importing.priceChanges.size).toBe(1);
    expect(importing.countOf('runImportBatches')).toBe(2);
  });

  it('⚠️ a refused price change fails no row and stops nothing: the summary counts it', async () => {
    const importing = fakeImportSource();
    importing.failWith('runImportBatches', 'permission-denied', 1);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { outcome } = await run(importing, RISING());
    expect(outcome.summary).toMatchObject({ created: 1, changesAdded: 0, changesFailed: 1, stopped: null, notRun: 0 });
    expect(outcome.summary.failed).toEqual([]);
    expect(importing.priceChanges.size).toBe(0);
  });
});

describe('rows already in Mise', () => {
  const FILE = () => fileOf(product({ key: 'k1', name: 'Zucchero velo', supplierCode: 'Z1', prices: [point({ line: 1 })] }));
  const STORED = (): StoredDoc => ({
    id: 'ing-9', name: 'Zucchero velo', supplierId: 'sup-1', supplierCode: 'Z1', weight: '10 kg', kind: 'ingredient', invoiceName: 'ZUCCHERO VELO',
  });
  const seeded = () => {
    const importing = fakeImportSource({ ingredients: [STORED()] });
    importing.points.set('ing-9', { ids: new Set(['inv-18000000001-1']), points: [] });
    return importing;
  };

  it('are the quiet pass: nothing is written for them but their price changes, and the run is never «stopped» by it', async () => {
    const importing = seeded();
    const { outcome, entries } = await run(importing, FILE(), { stored: [STORED()] });
    expect(quietRows(entries)).toHaveLength(1);
    expect(outcome.summary).toMatchObject({ created: 0, updated: 0, unchanged: 1, stopped: null, changesAdded: 0, changesFailed: 0 });
    expect(importing.writes).toEqual([]);
  });

  it('the progress counts them, so a run of unchanged rows alone never says «1 of 0»', async () => {
    const { progress } = await run(seeded(), FILE(), { stored: [STORED()] });
    expect(progress[0]).toEqual({ done: 0, shown: 1, total: 1 });
    for (const step of progress) {
      expect(step.shown).toBeLessThanOrEqual(step.total);
      expect(step.total).toBeGreaterThan(0);
    }
  });

  it('with nothing to look at the total is 0 and nothing is shown as «n of 0»', async () => {
    const { progress } = await run(fakeImportSource(), fileOf());
    expect(progress.every(step => step.total === 0 && step.shown === 0)).toBe(true);
  });

  it('a lost connection while their points are read fails no row and does not stop the run', async () => {
    const importing = seeded();
    importing.failWith('invoicePoints', 'unavailable', 1);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { planned, entries } = await plan(importing, FILE(), NO_ANSWERS, [STORED()]);
    // ⚠️ The context forgets the points (review of 25 Oct 2026: with them known the run read nothing, and the catch this test is
    // named after was never reached), so the quiet pass must read them again — and that read fails.
    const reads = importing.countOf('invoicePoints');
    const outcome = await runIngredientImport({
      source: importing, entries, ctx: { ...planned.ctx, invoicePointIds: {} }, file: FILE(), supplierIdByKey: IDS, answers: NO_ANSWERS,
      decisionChanges: { set: [], remove: [] }, language: 'en', ingredientsNow: () => [STORED()], words: WORDS, onProgress: () => undefined,
    });
    expect(importing.countOf('invoicePoints')).toBe(reads + 1);
    expect(outcome.summary).toMatchObject({ unchanged: 1, stopped: null, changesFailed: 1 });
    expect(outcome.summary.failed).toEqual([]);
  });
});

// The import log records an invoice only when every row holding a price of it was seen through (importLog.ts).
describe('the rows not seen through (unfinishedOf)', () => {
  const entry = (key: string) => ({ planned: { key }, row: { status: 'new' } }) as unknown as PlanEntry;
  const entries = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(entry);

  it('a failure, lost price changes or a lost name, and a row the run never reached are unfinished; the rest is done', () => {
    const unfinished = unfinishedOf(entries, [
      { key: 'a', name: 'A', outcome: 'created' },
      { key: 'b', name: 'B', outcome: 'failed', reason: 'x' },
      { key: 'c', name: 'C', outcome: 'updated', changesFailed: 1 },
      { key: 'd', name: 'D', outcome: 'unchanged', namesLost: 1 },
      { key: 'e', name: 'E', outcome: 'skipped' },
      { key: 'f', name: 'F', outcome: 'unchanged' },
    ], []);
    expect([...unfinished].sort()).toEqual(['b', 'c', 'd', 'g']);
  });

  it('a row whose price was held for a look is unfinished although its result says «skipped»', () => {
    const unfinished = unfinishedOf([entry('h'), entry('s')], [
      { key: 'h', name: 'H', outcome: 'skipped' },
      { key: 's', name: 'S', outcome: 'skipped' },
    ], [], new Set(['h']));
    expect([...unfinished]).toEqual(['h']);
  });

  it('a run with a price left «for now» (the default answer to a price that needs a look) keeps that row unfinished', async () => {
    // An ingredient already in Mise whose newest invoice price is unverified: the row asks «This price?» and the default
    // answer leaves it for now. A new product beside it is created.
    const stored: StoredDoc = { id: 'ing-9', name: 'Due', supplierId: 'sup-1', supplierCode: 'D2', weight: '10 kg', kind: 'ingredient', invoiceName: 'DUE' };
    const source = fakeImportSource({ ingredients: [stored] });
    const file = fileOf(
      product({ key: 'k1', name: 'Uno' }),
      product({ key: 'k2', name: 'Due', supplierCode: 'D2', latestUnverified: true, prices: [point({ invoiceId: '18000000002' })] }),
    );
    const { outcome, entries } = await run(source, file, { stored: [stored] });
    expect(entries.find(e => e.planned.key === 'k2')?.row.held).toBe(true);
    expect([...outcome.unfinishedKeys]).toEqual(['k2']);
  });

  it('a row already in Mise that a stop passed over is unfinished although its result says «unchanged»', () => {
    const unfinished = unfinishedOf([entry('q')], [{ key: 'q', name: 'Q', outcome: 'unchanged' }], [entry('q')]);
    expect([...unfinished]).toEqual(['q']);
  });

  it('a run that stops says which rows it did not see through', async () => {
    const source = fakeImportSource();
    source.failWith('runImportBatches', 'permission-denied', 1);
    const file = fileOf(product({ key: 'k1', name: 'Uno' }), product({ key: 'k2', name: 'Due', prices: [point({ invoiceId: '18000000002' })] }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { outcome } = await run(source, file);
    expect(outcome.summary.stopped).toBe('permission');
    expect([...outcome.unfinishedKeys]).toEqual(['k2']);
  });
});
