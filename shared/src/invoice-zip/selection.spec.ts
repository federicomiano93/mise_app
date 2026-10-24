// selection — what goes into the import, and what the owner's answers are remembered as (P15), run against BOTH
// implementations: the TypeScript port in shared/ and js/orders/invoice-zip/selection.js. Pure, so every rule runs here.
// Ported from tests/invoice-zip-selection.test.mjs; the module is a FULL port, so parity.spec.ts also compares its
// exports. Invented invoices only (testing/invoice-builders.ts).
//
// PORTED: 20 of 20 tests of tests/invoice-zip-selection.test.mjs. The port is driven with the build of `looseRead`
// (every invoice here is a loose file; the zip reader is app code), the original with its own reader. One difference of
// means, not of what is checked: 'the decision id is … the SHA-256 of the key' compares with the platform's Web Crypto
// (async) where the original uses node:crypto, which shared/ cannot import.

import { describe, expect, test } from 'vitest';
import { implementations } from './testing/implementations';
import { makeCase, platformSha256 } from './testing/invoice-builders';
import type { InvoiceCase, InvoiceSpec, LineSpec } from './testing/invoice-builders';
import type { ImportResult } from './build-import';
import type { Selection } from './selection';

const FLOUR: LineSpec = { desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00', qty: 25, unit: 'KG', total: 14.25 };
const COLA: LineSpec = { desc: 'COCA COLA LATTINA 33 CL', code: 'COLA', qty: 24, unit: 'PZ', total: 12 };
const STRONG: LineSpec = { desc: 'SPEZIA FORTE', code: 'SP', qty: 100, unit: 'KG', total: 4 };
const SUPPLIER = 'IT00000000001';
const K_FLOUR = `${SUPPLIER}|code:F00`;
const K_COLA = `${SUPPLIER}|code:COLA`;
const K_STRONG = `${SUPPLIER}|code:SP`;

describe.each(implementations)('%s', (_name, impl) => {
  const {
    selectImport, decisionChanges, planDecisionBatches, decisionId, indexDecisions, supplierDecisionKey,
    MAX_DECISIONS_PER_BATCH, MAX_LABEL,
  } = impl.selection;
  const newCase = (): InvoiceCase => makeCase(impl.caseImpl);

  function built(lines: LineSpec[] = [FLOUR, COLA], invoiceOptions: InvoiceSpec = {}): ImportResult {
    const c = newCase();
    c.add(lines, invoiceOptions);
    return c.build();
  }
  const idOf = (key: string): string => decisionId(key);
  const keys = (selection: Selection): string[] => selection.importFile.ingredients.map((i) => i.key);

  test('the program\'s own proposal is the starting point: ingredients in, resale listed with a tick-box', () => {
    const result = built();
    const sel = selectImport(result, {});
    expect(keys(sel)).toStrictEqual([K_FLOUR]);
    expect(sel.importFile.ingredients, 'the same entries the reader proposed').toStrictEqual(result.importFile.ingredients);
    expect(sel.importFile.suppliers).toStrictEqual(result.importFile.suppliers);
    expect(sel.importFile.format).toBe('mise-invoice-import');
    expect(sel.importFile.version).toBe(1);
    expect(sel.groups.notImported.map((g) => [g.key, g.canImport, g.checked])).toStrictEqual([[K_COLA, true, false]]);
    expect(sel.groups.skippedByYou).toStrictEqual([]);
    expect(sel.groups.skippedSuppliers).toStrictEqual([]);
    expect(sel.counts).toStrictEqual({
      invoices: 1, excludedDocuments: 0, skippedFiles: 0, p7m: 0, salesSkipped: 0, suppliers: 1, ingredients: 1,
    });
  });

  test('a product decided «skip» is left out and listed under «left out by you»', () => {
    const sel = selectImport(built(), { decisions: [{ id: idOf(K_FLOUR), decision: 'skip' }] });
    expect(keys(sel)).toStrictEqual([]);
    expect(sel.importFile.suppliers, 'a supplier with nothing to import is not listed').toStrictEqual([]);
    expect(sel.groups.skippedByYou.map((g) => g.key)).toStrictEqual([K_FLOUR]);
    expect((sel.byKey.get(K_FLOUR) as { included: boolean }).included).toBe(false);
  });

  test('ticking «import again» puts a skipped product back, and the tick stays visible in its group', () => {
    const sel = selectImport(built(), {
      decisions: [{ id: idOf(K_FLOUR), decision: 'skip' }], overrides: { [K_FLOUR]: 'ingredient' },
    });
    expect(keys(sel)).toStrictEqual([K_FLOUR]);
    expect(sel.groups.skippedByYou.map((g) => [g.key, g.checked])).toStrictEqual([[K_FLOUR, true]]);
  });

  test('a product proposed as resale is imported when decided «ingredient», or when ticked now', () => {
    expect(keys(selectImport(built(), { decisions: [{ id: idOf(K_COLA), decision: 'ingredient' }] }))).toStrictEqual([K_COLA, K_FLOUR]);
    const ticked = selectImport(built(), { overrides: { [K_COLA]: 'ingredient' } });
    expect(keys(ticked)).toStrictEqual([K_COLA, K_FLOUR]);
    expect(ticked.groups.notImported.map((g) => g.checked)).toStrictEqual([true]);
    // a tick on a product that is already imported changes nothing
    expect(keys(selectImport(built(), { overrides: { [K_FLOUR]: 'ingredient' } }))).toStrictEqual([K_FLOUR]);
  });

  test('⚠️ an article code already held by an ingredient of the same supplier makes the product an ingredient', () => {
    const existingSuppliers = [{ id: 's1', vatNumber: 'it 000.000.000.01' }];
    const promote = (existingIngredients: object[], suppliers: object[] = existingSuppliers): string[] => keys(selectImport(built(), {
      existingSuppliers: suppliers, existingIngredients,
    }));
    expect(promote([{ id: 'i1', supplierId: 's1', supplierCode: 'COLA' }]), 'VAT matched after normalising; the code ignores case').toStrictEqual([K_COLA, K_FLOUR]);
    expect(promote([{ id: 'i1', supplierId: 's1', supplierCode: ' cola ' }])).toStrictEqual([K_COLA, K_FLOUR]);
    expect(promote([{ id: 'i1', supplierId: 's1', supplierCode: 'COLA', kind: 'packaging' }]), 'packaging never promotes').toStrictEqual([K_FLOUR]);
    expect(promote([{ id: 'i1', supplierId: 's2', supplierCode: 'COLA' }]), 'another supplier').toStrictEqual([K_FLOUR]);
    expect(promote([{ id: 'i1', supplierId: 's1', supplierCode: 'OTHER' }])).toStrictEqual([K_FLOUR]);
    expect(promote([{ id: 'i1', supplierId: 's1', supplierCode: '' }])).toStrictEqual([K_FLOUR]);
    expect(promote([{ id: 'i1', supplierId: 's1', supplierCode: 'COLA' }], [{ id: 's1', vatNumber: 'IT00000000099' }]),
      'a supplier with another VAT number is another supplier').toStrictEqual([K_FLOUR]);
    expect(promote([{ id: 'i1', supplierId: 's1', supplierCode: 'COLA' }], [{ id: 's1', vatNumber: '' }])).toStrictEqual([K_FLOUR]);
  });

  test('a product with no article code is never promoted by an empty code', () => {
    const sel = selectImport(built([{ ...COLA, code: '' }]), {
      existingSuppliers: [{ id: 's1', vatNumber: SUPPLIER }], existingIngredients: [{ id: 'i1', supplierId: 's1', supplierCode: '' }],
    });
    expect(keys(sel)).toStrictEqual([]);
  });

  test('⚠️ a supplier decided «skip» leaves out everything it sells, unless a product was decided «ingredient»', () => {
    const supplierSkip = { id: idOf(supplierDecisionKey(SUPPLIER)), decision: 'skip' };
    const sel = selectImport(built(), { decisions: [supplierSkip] });
    expect(keys(sel)).toStrictEqual([]);
    expect(sel.groups.skippedSuppliers).toStrictEqual([{ key: SUPPLIER, name: 'FORNITORE ESEMPIO SRL', products: 2, checked: false }]);
    expect(sel.groups.notImported, 'its products are not listed one by one').toStrictEqual([]);
    expect(sel.groups.skippedByYou).toStrictEqual([]);

    const wins = selectImport(built(), { decisions: [supplierSkip, { id: idOf(K_COLA), decision: 'ingredient' }] });
    expect(keys(wins)).toStrictEqual([K_COLA]);

    const again = selectImport(built(), { decisions: [supplierSkip], supplierOverrides: { [SUPPLIER]: 'import' } });
    expect(keys(again), 'ticked «import again»: the supplier is back and the usual rules apply').toStrictEqual([K_FLOUR]);
    expect(again.groups.skippedSuppliers.map((g) => g.checked), 'still listed, now ticked').toStrictEqual([true]);
  });

  test('a price «da verificare» keeps its good points; with none left the ingredient comes with a priceCheck code', () => {
    const sel = selectImport(built([FLOUR, STRONG]), {});
    expect(keys(sel)).toStrictEqual([K_FLOUR, K_STRONG]);
    const strong = sel.importFile.ingredients.find((i) => i.key === K_STRONG);
    expect((strong as { prices: unknown[] }).prices).toStrictEqual([]);
    expect((strong as { priceCheck: string }).priceCheck).toBe('price-out-of-scale');
    expect(sel.groups.toCheck).toStrictEqual([{ key: K_STRONG, name: 'Spezia forte', supplierName: 'FORNITORE ESEMPIO SRL', reason: 'price-out-of-scale' }]);

    const c = newCase();
    c.add([{ desc: 'FARINA', code: 'F', qty: 10, unit: 'KG', total: 6 }], { date: '2026-09-01' });
    c.add([{ desc: 'FARINA', code: 'F', qty: 10, unit: 'KG', total: 6000 }], { date: '2026-09-10' });
    const partial = selectImport(c.build(), {});
    expect(partial.groups.toCheck, 'a product that keeps a good point needs no look').toStrictEqual([]);
    expect(((partial.importFile.ingredients[0] as { prices: { invoiceDate: string }[] }).prices).map((p) => p.invoiceDate)).toStrictEqual(['2026-09-01']);
  });

  test('products that cannot be read are listed with the reason and cannot be ticked', () => {
    const sel = selectImport(built([FLOUR, { desc: 'SPEZIA MISTA', code: 'MIX', qty: 4, unit: 'PZ', total: 20 }]), {});
    expect(keys(sel)).toStrictEqual([K_FLOUR]);
    expect(sel.groups.unreadable.map((g) => [g.key, g.canImport, g.reason]))
      .toStrictEqual([[`${SUPPLIER}|code:MIX`, false, 'pieces-need-price-unit-and-weight']]);
  });

  test('the counts and the skipped files come from what the reader saw', () => {
    const c = newCase();
    c.add([FLOUR]);
    c.add([COLA], { docType: 'TD16', number: '2' });
    c.files.push({ name: 'broken.xml', bytes: new Uint8Array([...'<not xml'].map((ch) => ch.charCodeAt(0))) });
    const result = c.build();
    const sel = selectImport(result, {});
    expect(sel.counts.invoices).toBe(result.documents.length);
    expect(sel.counts.excludedDocuments).toBe(result.documents.filter((d) => d.status === 'excluded').length);
    expect(sel.counts.excludedDocuments).toBeGreaterThanOrEqual(1);
    expect(sel.counts.skippedFiles).toBe(result.skippedFiles.length);
    expect(sel.groups.skippedFiles.map((f) => f.reason)).toStrictEqual(result.skippedFiles.map((f) => f.reason));
  });

  test('the decision id is 64 lowercase hex, stable, and the SHA-256 of the key', async () => {
    const id = decisionId(K_FLOUR);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(decisionId(K_FLOUR)).toBe(id);
    expect(id).toBe(await platformSha256(K_FLOUR));
    expect(decisionId(supplierDecisionKey(SUPPLIER))).not.toBe(decisionId(SUPPLIER));
    expect(supplierDecisionKey(SUPPLIER)).toBe(`supplier:${SUPPLIER}`);
  });

  test('indexDecisions keeps only well-formed decisions', () => {
    const good = idOf(K_FLOUR);
    const map = indexDecisions([
      { id: good, decision: 'skip' }, { id: 'short', decision: 'skip' }, { id: idOf(K_COLA), decision: 'maybe' },
      null, { id: idOf('x'), decision: 'ingredient' },
    ]);
    expect([...map]).toStrictEqual([[good, 'skip'], [idOf('x'), 'ingredient']]);
    expect([...indexDecisions(new Map([[good, 'skip']]))]).toStrictEqual([[good, 'skip']]);
    expect(indexDecisions(undefined).size).toBe(0);
  });

  // ── What is remembered ──────────────────────────────────────────────────────────

  test('ticking a product the program would not take remembers «ingredient», labelled with its description', () => {
    const result = built();
    const overrides = { [K_COLA]: 'ingredient' };
    const selection = selectImport(result, { overrides });
    const changes = decisionChanges({ selection, decisions: [], overrides });
    expect(changes.set.map((c) => [c.id, c.key, c.decision, c.label]))
      .toStrictEqual([[idOf(K_COLA), K_COLA, 'ingredient', 'COCA COLA LATTINA 33 CL']]);
    expect(changes.remove).toStrictEqual([]);
    // already remembered: nothing to write
    const stored = [{ id: idOf(K_COLA), decision: 'ingredient' }];
    const again = decisionChanges({ selection: selectImport(result, { overrides, decisions: stored }), decisions: stored, overrides });
    expect(again).toStrictEqual({ set: [], remove: [] });
  });

  test('⚠️ re-including a product the program proposes anyway REMOVES the remembered skip', () => {
    const stored = [{ id: idOf(K_FLOUR), decision: 'skip' }];
    const overrides = { [K_FLOUR]: 'ingredient' };
    const selection = selectImport(built(), { decisions: stored, overrides });
    expect(decisionChanges({ selection, decisions: stored, overrides })).toStrictEqual({ set: [], remove: [idOf(K_FLOUR)] });
  });

  test('re-including a skipped product the program would not take stores «ingredient» instead', () => {
    const stored = [{ id: idOf(K_COLA), decision: 'skip' }];
    const overrides = { [K_COLA]: 'ingredient' };
    const selection = selectImport(built(), { decisions: stored, overrides });
    const changes = decisionChanges({ selection, decisions: stored, overrides });
    expect(changes.set.map((c) => [c.key, c.decision])).toStrictEqual([[K_COLA, 'ingredient']]);
    expect(changes.remove).toStrictEqual([]);
  });

  test('a tick that is not in effect (untouched row, or a product that cannot be imported) writes nothing', () => {
    const selection = selectImport(built(), {});
    expect(decisionChanges({ selection, decisions: [], overrides: { [K_FLOUR]: 'ingredient', nope: 'ingredient' } })).toStrictEqual({ set: [], remove: [] });
  });

  test('supplier answers: «do not import anything» is stored, «import again» removes it', () => {
    const selection = selectImport(built(), {});
    const skip = decisionChanges({ selection, decisions: [], supplierSkips: [{ key: SUPPLIER, name: 'FORNITORE ESEMPIO SRL' }] });
    expect(skip.set.map((c) => [c.id, c.decision, c.label]))
      .toStrictEqual([[idOf(`supplier:${SUPPLIER}`), 'skip', 'FORNITORE ESEMPIO SRL']]);

    const stored = [{ id: idOf(`supplier:${SUPPLIER}`), decision: 'skip' }];
    const supplierOverrides = { [SUPPLIER]: 'import' };
    const back = decisionChanges({ selection: selectImport(built(), { decisions: stored, supplierOverrides }), decisions: stored, supplierOverrides });
    expect(back).toStrictEqual({ set: [], remove: [idOf(`supplier:${SUPPLIER}`)] });
  });

  test('step-3 «do not import (remember)» stores a skip, and wins over a tick on the same product', () => {
    const overrides = { [K_COLA]: 'ingredient' };
    const selection = selectImport(built(), { overrides });
    const changes = decisionChanges({ selection, decisions: [], overrides, itemSkips: [{ key: K_COLA, label: 'Coca cola' }] });
    expect(changes.set.map((c) => [c.key, c.decision, c.label])).toStrictEqual([[K_COLA, 'skip', 'Coca cola']]);
  });

  test('a label is cut to the 300 characters the rules allow', () => {
    const selection = selectImport(built(), {});
    const { set } = decisionChanges({ selection, decisions: [], itemSkips: [{ key: 'k', label: ` ${'x'.repeat(500)} ` }] });
    expect((set[0] as { label: string }).label.length).toBe(MAX_LABEL);
  });

  test('the batches hold at most 20 operations and carry exactly what the rules accept', () => {
    const set = Array.from({ length: 45 }, (_, i) => ({ id: idOf(`k${i}`), key: `k${i}`, decision: 'skip' as const, label: `p${i}` }));
    const remove = [idOf('gone')];
    const batches = planDecisionBatches({ set, remove }, { bakery: 'loc-test', nowIso: '2026-10-05T10:00:00.000Z' });
    expect(batches.map((b) => b.length)).toStrictEqual([20, 20, 6]);
    expect(MAX_DECISIONS_PER_BATCH).toBe(20);
    const first = (batches[0] as unknown[])[0] as { type: string; data: object };
    expect(first.type).toBe('set');
    expect(Object.keys(first.data).sort()).toStrictEqual(['bakery', 'decision', 'label', 'updatedAt']);
    expect(first.data).toStrictEqual({ bakery: 'loc-test', decision: 'skip', label: 'p0', updatedAt: '2026-10-05T10:00:00.000Z' });
    expect((batches[2] as unknown[]).at(-1)).toStrictEqual({ type: 'delete', id: idOf('gone') });
    expect(batches.flat().every((op) => /^[0-9a-f]{64}$/.test(op.id))).toBeTruthy();
    expect(planDecisionBatches({ set: [], remove: [] }, { bakery: 'b', nowIso: 'x' })).toStrictEqual([]);
  });
});
