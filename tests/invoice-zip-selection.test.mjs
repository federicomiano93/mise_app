// selection.js — what goes into the import, and what the owner's answers are remembered as. Pure, so every rule
// runs here. Invented invoices only (tests/helpers/invoice-builders.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  selectImport, decisionChanges, planDecisionBatches, decisionId, indexDecisions, supplierDecisionKey,
  MAX_DECISIONS_PER_BATCH, MAX_LABEL,
} from '../js/orders/invoice-zip/selection.js';
import { newCase } from './helpers/invoice-builders.mjs';

const FLOUR = { desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00', qty: 25, unit: 'KG', total: 14.25 };
const COLA = { desc: 'COCA COLA LATTINA 33 CL', code: 'COLA', qty: 24, unit: 'PZ', total: 12 };
const STRONG = { desc: 'SPEZIA FORTE', code: 'SP', qty: 100, unit: 'KG', total: 4 };
const SUPPLIER = 'IT00000000001';
const K_FLOUR = `${SUPPLIER}|code:F00`;
const K_COLA = `${SUPPLIER}|code:COLA`;
const K_STRONG = `${SUPPLIER}|code:SP`;

function built(lines = [FLOUR, COLA], invoiceOptions = {}) {
  const c = newCase();
  c.add(lines, invoiceOptions);
  return c.build();
}
const idOf = (key) => decisionId(key);
const keys = (selection) => selection.importFile.ingredients.map((i) => i.key);

test('the program\'s own proposal is the starting point: ingredients in, resale listed with a tick-box', () => {
  const result = built();
  const sel = selectImport(result, {});
  assert.deepEqual(keys(sel), [K_FLOUR]);
  assert.deepEqual(sel.importFile.ingredients, result.importFile.ingredients, 'the same entries the reader proposed');
  assert.deepEqual(sel.importFile.suppliers, result.importFile.suppliers);
  assert.equal(sel.importFile.format, 'mise-invoice-import');
  assert.equal(sel.importFile.version, 1);
  assert.deepEqual(sel.groups.notImported.map((g) => [g.key, g.canImport, g.checked]), [[K_COLA, true, false]]);
  assert.deepEqual(sel.groups.skippedByYou, []);
  assert.deepEqual(sel.groups.skippedSuppliers, []);
  assert.deepEqual(sel.counts, {
    invoices: 1, excludedDocuments: 0, skippedFiles: 0, p7m: 0, suppliers: 1, ingredients: 1,
  });
});

test('a product decided «skip» is left out and listed under «left out by you»', () => {
  const sel = selectImport(built(), { decisions: [{ id: idOf(K_FLOUR), decision: 'skip' }] });
  assert.deepEqual(keys(sel), []);
  assert.deepEqual(sel.importFile.suppliers, [], 'a supplier with nothing to import is not listed');
  assert.deepEqual(sel.groups.skippedByYou.map((g) => g.key), [K_FLOUR]);
  assert.equal(sel.byKey.get(K_FLOUR).included, false);
});

test('ticking «import again» puts a skipped product back, and the tick stays visible in its group', () => {
  const sel = selectImport(built(), {
    decisions: [{ id: idOf(K_FLOUR), decision: 'skip' }], overrides: { [K_FLOUR]: 'ingredient' },
  });
  assert.deepEqual(keys(sel), [K_FLOUR]);
  assert.deepEqual(sel.groups.skippedByYou.map((g) => [g.key, g.checked]), [[K_FLOUR, true]]);
});

test('a product proposed as resale is imported when decided «ingredient», or when ticked now', () => {
  assert.deepEqual(keys(selectImport(built(), { decisions: [{ id: idOf(K_COLA), decision: 'ingredient' }] })), [K_COLA, K_FLOUR]);
  const ticked = selectImport(built(), { overrides: { [K_COLA]: 'ingredient' } });
  assert.deepEqual(keys(ticked), [K_COLA, K_FLOUR]);
  assert.deepEqual(ticked.groups.notImported.map((g) => g.checked), [true]);
  // a tick on a product that is already imported changes nothing
  assert.deepEqual(keys(selectImport(built(), { overrides: { [K_FLOUR]: 'ingredient' } })), [K_FLOUR]);
});

test('⚠️ an article code already held by an ingredient of the same supplier makes the product an ingredient', () => {
  const existingSuppliers = [{ id: 's1', vatNumber: 'it 000.000.000.01' }];
  const promote = (existingIngredients, suppliers = existingSuppliers) => keys(selectImport(built(), {
    existingSuppliers: suppliers, existingIngredients,
  }));
  assert.deepEqual(promote([{ id: 'i1', supplierId: 's1', supplierCode: 'COLA' }]), [K_COLA, K_FLOUR], 'VAT matched after normalising; the code ignores case');
  assert.deepEqual(promote([{ id: 'i1', supplierId: 's1', supplierCode: ' cola ' }]), [K_COLA, K_FLOUR]);
  assert.deepEqual(promote([{ id: 'i1', supplierId: 's1', supplierCode: 'COLA', kind: 'packaging' }]), [K_FLOUR], 'packaging never promotes');
  assert.deepEqual(promote([{ id: 'i1', supplierId: 's2', supplierCode: 'COLA' }]), [K_FLOUR], 'another supplier');
  assert.deepEqual(promote([{ id: 'i1', supplierId: 's1', supplierCode: 'OTHER' }]), [K_FLOUR]);
  assert.deepEqual(promote([{ id: 'i1', supplierId: 's1', supplierCode: '' }]), [K_FLOUR]);
  assert.deepEqual(promote([{ id: 'i1', supplierId: 's1', supplierCode: 'COLA' }], [{ id: 's1', vatNumber: 'IT00000000099' }]), [K_FLOUR],
    'a supplier with another VAT number is another supplier');
  assert.deepEqual(promote([{ id: 'i1', supplierId: 's1', supplierCode: 'COLA' }], [{ id: 's1', vatNumber: '' }]), [K_FLOUR]);
});

test('a product with no article code is never promoted by an empty code', () => {
  const sel = selectImport(built([{ ...COLA, code: '' }]), {
    existingSuppliers: [{ id: 's1', vatNumber: SUPPLIER }], existingIngredients: [{ id: 'i1', supplierId: 's1', supplierCode: '' }],
  });
  assert.deepEqual(keys(sel), []);
});

test('⚠️ a supplier decided «skip» leaves out everything it sells, unless a product was decided «ingredient»', () => {
  const supplierSkip = { id: idOf(supplierDecisionKey(SUPPLIER)), decision: 'skip' };
  const sel = selectImport(built(), { decisions: [supplierSkip] });
  assert.deepEqual(keys(sel), []);
  assert.deepEqual(sel.groups.skippedSuppliers, [{ key: SUPPLIER, name: 'FORNITORE ESEMPIO SRL', products: 2, checked: false }]);
  assert.deepEqual(sel.groups.notImported, [], 'its products are not listed one by one');
  assert.deepEqual(sel.groups.skippedByYou, []);

  const wins = selectImport(built(), { decisions: [supplierSkip, { id: idOf(K_COLA), decision: 'ingredient' }] });
  assert.deepEqual(keys(wins), [K_COLA]);

  const again = selectImport(built(), { decisions: [supplierSkip], supplierOverrides: { [SUPPLIER]: 'import' } });
  assert.deepEqual(keys(again), [K_FLOUR], 'ticked «import again»: the supplier is back and the usual rules apply');
  assert.deepEqual(again.groups.skippedSuppliers.map((g) => g.checked), [true], 'still listed, now ticked');
});

test('a price «da verificare» keeps its good points; with none left the ingredient comes with a priceCheck code', () => {
  const sel = selectImport(built([FLOUR, STRONG]), {});
  assert.deepEqual(keys(sel), [K_FLOUR, K_STRONG]);
  const strong = sel.importFile.ingredients.find((i) => i.key === K_STRONG);
  assert.deepEqual(strong.prices, []);
  assert.equal(strong.priceCheck, 'price-out-of-scale');
  assert.deepEqual(sel.groups.toCheck, [{ key: K_STRONG, name: 'Spezia forte', supplierName: 'FORNITORE ESEMPIO SRL', reason: 'price-out-of-scale' }]);

  const c = newCase();
  c.add([{ desc: 'FARINA', code: 'F', qty: 10, unit: 'KG', total: 6 }], { date: '2026-09-01' });
  c.add([{ desc: 'FARINA', code: 'F', qty: 10, unit: 'KG', total: 6000 }], { date: '2026-09-10' });
  const partial = selectImport(c.build(), {});
  assert.deepEqual(partial.groups.toCheck, [], 'a product that keeps a good point needs no look');
  assert.deepEqual(partial.importFile.ingredients[0].prices.map((p) => p.invoiceDate), ['2026-09-01']);
});

test('products that cannot be read are listed with the reason and cannot be ticked', () => {
  const sel = selectImport(built([FLOUR, { desc: 'SPEZIA MISTA', code: 'MIX', qty: 4, unit: 'PZ', total: 20 }]), {});
  assert.deepEqual(keys(sel), [K_FLOUR]);
  assert.deepEqual(sel.groups.unreadable.map((g) => [g.key, g.canImport, g.reason]),
    [[`${SUPPLIER}|code:MIX`, false, 'pieces-need-price-unit-and-weight']]);
});

test('the counts and the skipped files come from what the reader saw', () => {
  const c = newCase();
  c.add([FLOUR]);
  c.add([COLA], { docType: 'TD16', number: '2' });
  c.files.push({ name: 'broken.xml', bytes: new TextEncoder().encode('<not xml') });
  const result = c.build();
  const sel = selectImport(result, {});
  assert.equal(sel.counts.invoices, result.documents.length);
  assert.equal(sel.counts.excludedDocuments, result.documents.filter((d) => d.status === 'excluded').length);
  assert.ok(sel.counts.excludedDocuments >= 1);
  assert.equal(sel.counts.skippedFiles, result.skippedFiles.length);
  assert.deepEqual(sel.groups.skippedFiles.map((f) => f.reason), result.skippedFiles.map((f) => f.reason));
});

test('the decision id is 64 lowercase hex, stable, and the SHA-256 of the key', () => {
  const id = decisionId(K_FLOUR);
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(decisionId(K_FLOUR), id);
  assert.equal(id, createHash('sha256').update(K_FLOUR).digest('hex'));
  assert.notEqual(decisionId(supplierDecisionKey(SUPPLIER)), decisionId(SUPPLIER));
  assert.equal(supplierDecisionKey(SUPPLIER), `supplier:${SUPPLIER}`);
});

test('indexDecisions keeps only well-formed decisions', () => {
  const good = idOf(K_FLOUR);
  const map = indexDecisions([
    { id: good, decision: 'skip' }, { id: 'short', decision: 'skip' }, { id: idOf(K_COLA), decision: 'maybe' },
    null, { id: idOf('x'), decision: 'ingredient' },
  ]);
  assert.deepEqual([...map], [[good, 'skip'], [idOf('x'), 'ingredient']]);
  assert.deepEqual([...indexDecisions(new Map([[good, 'skip']]))], [[good, 'skip']]);
  assert.equal(indexDecisions(undefined).size, 0);
});

// ── What is remembered ──────────────────────────────────────────────────────────

test('ticking a product the program would not take remembers «ingredient», labelled with its description', () => {
  const result = built();
  const overrides = { [K_COLA]: 'ingredient' };
  const selection = selectImport(result, { overrides });
  const changes = decisionChanges({ selection, decisions: [], overrides });
  assert.deepEqual(changes.set.map((c) => [c.id, c.key, c.decision, c.label]),
    [[idOf(K_COLA), K_COLA, 'ingredient', 'COCA COLA LATTINA 33 CL']]);
  assert.deepEqual(changes.remove, []);
  // already remembered: nothing to write
  const stored = [{ id: idOf(K_COLA), decision: 'ingredient' }];
  const again = decisionChanges({ selection: selectImport(result, { overrides, decisions: stored }), decisions: stored, overrides });
  assert.deepEqual(again, { set: [], remove: [] });
});

test('⚠️ re-including a product the program proposes anyway REMOVES the remembered skip', () => {
  const stored = [{ id: idOf(K_FLOUR), decision: 'skip' }];
  const overrides = { [K_FLOUR]: 'ingredient' };
  const selection = selectImport(built(), { decisions: stored, overrides });
  assert.deepEqual(decisionChanges({ selection, decisions: stored, overrides }), { set: [], remove: [idOf(K_FLOUR)] });
});

test('re-including a skipped product the program would not take stores «ingredient» instead', () => {
  const stored = [{ id: idOf(K_COLA), decision: 'skip' }];
  const overrides = { [K_COLA]: 'ingredient' };
  const selection = selectImport(built(), { decisions: stored, overrides });
  const changes = decisionChanges({ selection, decisions: stored, overrides });
  assert.deepEqual(changes.set.map((c) => [c.key, c.decision]), [[K_COLA, 'ingredient']]);
  assert.deepEqual(changes.remove, []);
});

test('a tick that is not in effect (untouched row, or a product that cannot be imported) writes nothing', () => {
  const selection = selectImport(built(), {});
  assert.deepEqual(decisionChanges({ selection, decisions: [], overrides: { [K_FLOUR]: 'ingredient', nope: 'ingredient' } }), { set: [], remove: [] });
});

test('supplier answers: «do not import anything» is stored, «import again» removes it', () => {
  const selection = selectImport(built(), {});
  const skip = decisionChanges({ selection, decisions: [], supplierSkips: [{ key: SUPPLIER, name: 'FORNITORE ESEMPIO SRL' }] });
  assert.deepEqual(skip.set.map((c) => [c.id, c.decision, c.label]),
    [[idOf(`supplier:${SUPPLIER}`), 'skip', 'FORNITORE ESEMPIO SRL']]);

  const stored = [{ id: idOf(`supplier:${SUPPLIER}`), decision: 'skip' }];
  const supplierOverrides = { [SUPPLIER]: 'import' };
  const back = decisionChanges({ selection: selectImport(built(), { decisions: stored, supplierOverrides }), decisions: stored, supplierOverrides });
  assert.deepEqual(back, { set: [], remove: [idOf(`supplier:${SUPPLIER}`)] });
});

test('step-3 «do not import (remember)» stores a skip, and wins over a tick on the same product', () => {
  const overrides = { [K_COLA]: 'ingredient' };
  const selection = selectImport(built(), { overrides });
  const changes = decisionChanges({ selection, decisions: [], overrides, itemSkips: [{ key: K_COLA, label: 'Coca cola' }] });
  assert.deepEqual(changes.set.map((c) => [c.key, c.decision, c.label]), [[K_COLA, 'skip', 'Coca cola']]);
});

test('a label is cut to the 300 characters the rules allow', () => {
  const selection = selectImport(built(), {});
  const { set } = decisionChanges({ selection, decisions: [], itemSkips: [{ key: 'k', label: ` ${'x'.repeat(500)} ` }] });
  assert.equal(set[0].label.length, MAX_LABEL);
});

test('the batches hold at most 20 operations and carry exactly what the rules accept', () => {
  const set = Array.from({ length: 45 }, (_, i) => ({ id: idOf(`k${i}`), key: `k${i}`, decision: 'skip', label: `p${i}` }));
  const remove = [idOf('gone')];
  const batches = planDecisionBatches({ set, remove }, { bakery: 'loc-test', nowIso: '2026-10-05T10:00:00.000Z' });
  assert.deepEqual(batches.map((b) => b.length), [20, 20, 6]);
  assert.equal(MAX_DECISIONS_PER_BATCH, 20);
  const first = batches[0][0];
  assert.equal(first.type, 'set');
  assert.deepEqual(Object.keys(first.data).sort(), ['bakery', 'decision', 'label', 'updatedAt']);
  assert.deepEqual(first.data, { bakery: 'loc-test', decision: 'skip', label: 'p0', updatedAt: '2026-10-05T10:00:00.000Z' });
  assert.deepEqual(batches[2].at(-1), { type: 'delete', id: idOf('gone') });
  assert.ok(batches.flat().every((op) => /^[0-9a-f]{64}$/.test(op.id)));
  assert.deepEqual(planDecisionBatches({ set: [], remove: [] }, { bakery: 'b', nowIso: 'x' }), []);
});
