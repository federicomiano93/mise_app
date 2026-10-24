import { describe, expect, it } from 'vitest';
import { planSuppliers, supplierWrites } from '@mise/shared/invoice-import-model';
import type { FileSupplier } from '@mise/shared/invoice-import-model';
import type { ImportFile } from './importRun';
import {
  CHOICE_NEW, CHOICE_NONE, CHOICE_SKIP, choiceOf, decisionOf, decisionsNow, linkChoice, newProgress, pendingOps, saveSupplierOps,
} from './supplierStep';
import { fakeImportSource } from './testing/fakeImportSource';

// Step 2 without the screen: what the «What should happen?» select means, what is still to write, and the write itself — the fresh
// check, the order, and the progress that makes a retry safe. (Parity I26–I28.) The model's own rules are in
// shared/src/invoice-import-model.spec.ts; the screen's in InvoiceImport.suppliers.spec.tsx.

const A: FileSupplier = { key: 'IT00000000001', vatNumber: 'IT00000000001', name: 'ALFA SRL' };
const B: FileSupplier = { key: 'IT00000000002', vatNumber: 'IT00000000002', name: 'BETA SPA' };
const file = (...suppliers: FileSupplier[]): ImportFile => ({ generatedAt: '', suppliers, ingredients: [] });

describe('the select', () => {
  it('says what each answer is, and reads it back', () => {
    for (const decision of [{ linkTo: 's9' }, { createNew: true }, { skip: true }] as const) {
      expect(decisionOf(choiceOf(decision))).toEqual(decision);
    }
    expect(choiceOf(undefined)).toBe(CHOICE_NONE);
    expect(decisionOf(CHOICE_NONE)).toBeNull();
    expect(decisionOf(CHOICE_NEW)).toEqual({ createNew: true });
    expect(decisionOf(CHOICE_SKIP)).toEqual({ skip: true });
    expect(decisionOf(linkChoice('s 9'))).toEqual({ linkTo: 's 9' });
    expect(decisionOf('link:')).toBeNull();
    expect(decisionOf('rubbish')).toBeNull();
  });

  it('«do not import anything from this supplier» is a skip, and beats an answer', () => {
    expect(decisionsNow({ a: { createNew: true }, b: { linkTo: 's' } }, new Set(['a', 'c']))).toEqual({
      a: { skip: true }, b: { linkTo: 's' }, c: { skip: true },
    });
  });
});

describe('what is still to write', () => {
  it('leaves out what the progress already did', () => {
    const plan = planSuppliers([A, B], []);
    const { ops } = supplierWrites(plan, {});
    expect(ops.map(op => op.key)).toEqual([A.key, B.key]);
    const progress = newProgress();
    progress.created[A.key] = 'sup-1';
    expect(pendingOps(ops, progress).map(op => op.key)).toEqual([B.key]);
    const link = supplierWrites(planSuppliers([A], [{ id: 's9', name: 'Alfa srl', vatNumber: '' }]), { [A.key]: { linkTo: 's9' } }).ops;
    expect(link.map(op => op.type)).toEqual(['link-supplier']);
    const linked = newProgress();
    linked.linked.add(A.key);
    expect(pendingOps(link, linked)).toEqual([]);
  });
});

describe('the write', () => {
  const plan = planSuppliers([A, B], []);
  const pending = supplierWrites(plan, {}).ops;

  it('⚠️ reads the suppliers from the server FIRST, then creates them in order with the model\'s payload', async () => {
    const source = fakeImportSource();
    const progress = newProgress();
    const outcome = await saveSupplierOps(source, file(A, B), plan, pending, progress);
    expect(outcome).toEqual({ kind: 'saved' });
    expect(source.calls.map(call => call[0])).toEqual(['freshSuppliers', 'createSupplier', 'createSupplier']);
    expect(source.calls[1]).toEqual(['createSupplier', pending[0]?.data]);
    expect(progress.created).toEqual({ [A.key]: 'sup-1', [B.key]: 'sup-2' });
  });

  it('⚠️ writes NOTHING when a confirmed answer is no longer true, and says which', async () => {
    const source = fakeImportSource();
    source.suppliers.push({ id: 'other', name: 'Beta', vatNumber: 'IT00000000002' });
    const outcome = await saveSupplierOps(source, file(A, B), plan, pending, newProgress());
    expect(outcome.kind).toBe('changed');
    if (outcome.kind !== 'changed') return;
    expect(outcome.keys).toEqual([B.key]);
    expect(outcome.fresh.find(entry => entry.key === B.key)?.status).toBe('present');
    expect(source.writes).toEqual([]);
  });

  it('a supplier this very import created is not «a change» when the retry reads the server again', async () => {
    const source = fakeImportSource();
    source.failWith('createSupplier', 'unavailable', 1);
    const progress = newProgress();
    const first = await saveSupplierOps(source, file(A, B), plan, pending, progress);
    expect(first.kind).toBe('failed');
    expect(progress.created).toEqual({ [A.key]: 'sup-1' });
    source.failWith('createSupplier', null);
    const retry = await saveSupplierOps(source, file(A, B), plan, pendingOps(pending, progress), progress);
    expect(retry).toEqual({ kind: 'saved' });
    expect(source.suppliers.map(supplier => supplier.name)).toEqual([A.name, B.name]);
  });

  it('a failed read of the suppliers is a failure, and nothing is written', async () => {
    const source = fakeImportSource();
    source.failWith('freshSuppliers', 'offline');
    const outcome = await saveSupplierOps(source, file(A, B), plan, pending, newProgress());
    expect(outcome).toMatchObject({ kind: 'failed', error: { code: 'offline' } });
    expect(source.writes).toEqual([]);
  });

  it('linking writes the VAT number of the supplier it was linked to, and remembers it', async () => {
    const existing = { id: 's9', name: 'Alfa srl', shortName: '', vatNumber: '' };
    const source = fakeImportSource({ suppliers: [existing] });
    const linkPlan = planSuppliers([A], [existing]);
    const ops = supplierWrites(linkPlan, { [A.key]: { linkTo: 's9' } }).ops;
    const progress = newProgress();
    expect(await saveSupplierOps(source, file(A), linkPlan, ops, progress)).toEqual({ kind: 'saved' });
    expect(source.writes).toEqual([{ kind: 'linkSupplierVat', supplierId: 's9', vatNumber: 'IT00000000001' }]);
    expect(progress.linked.has(A.key)).toBe(true);
  });
});
