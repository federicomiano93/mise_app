// «Import from invoices» — the review points of the import (P15), run against BOTH implementations: the TypeScript port in
// shared/ and the js/ files the live app uses today. Ported from tests/invoice-import-review.test.mjs: the weight the venue
// keeps wins over the description, a big move from a «media» reading and an older invoice's price wait for a person, sales
// invoices are skipped, a held row writes nothing, and a price is never confirmed by an answer it was not shown for.
// Every name, VAT number and price below is INVENTED.
//
// The original file has 51 tests, and they are all accounted for here:
//
// PORTED HERE: 34 of the 51 (the model, the plan and the reader's selection, with the invented invoices of
// testing/invoice-builders.ts — loose files, so no zip is needed):
//   the eight '1 ·' tests (the stored pack weight wins, up to the `fromPack` flag of the file), the four '2 ·' tests (the
//   30% limit and its constant), '3 · the owner is the buyer most invoices are issued to', '3 · an invoice SOLD by the owner is
//   skipped and counted…', '3 · with no buyer VAT number to find, nothing is skipped', '4 · the file says the newest invoice
//   was left out…', '4 · a NEW ingredient from the older invoice…', '4 · a MATCHED row waits for a person…', '7 · the
//   remembered «skip this supplier» still stores the name as its label…' (it reads selection's SOURCE as text, as the original
//   does, through Vite's `?raw`: the source of each file against its own spelling), 'A', 'B', 'C' and 'A · a real difference
//   in the TOTAL…', '8 · a held row yields no batches…', '9 · the owner needs a STRICT MAJORITY…', 'R1' … 'R5', 'S1' and 'S2'.
//   TWO are ported WITHOUT their last assertion, which reads the current app's screen as text (the screen comes with slice B3):
//   '3 · the held row still carries the row it would be…' (the screen takes `row.heldRow`) and 'S4 · a new answer clears the
//   «Use this price» of the row…' (the screen deletes `confirmKeys` / `renames` on a new answer; the model half is here).
//
// PORTED IN app/src/suppliers/invoiceImport/zipRead.spec.ts: the SIX '5 · entry count' tests (they open zip archives, and the
// zip reader is app code).
//
// NOT PORTED, because they read the current app's dictionary or screen as text (ELEVEN tests; the screen and the
// dictionary come with slice B3): '3 · the summary line exists in English and Italian…', '4 · the reason sentences exist in
// both languages…', '4 · the unreadable-weight sentence says the price below uses the invoice weight', '7 · a NEW row with the
// older-invoice reason says it WILL BE CREATED', '10 · the confirm select comes AFTER the «same as» question…', '11 · a «do not
// import» answer on a priceCheck row keeps the Skipped pill', 'R6 · the rescaled sentence names both packs…', 'R7 · a new row
// answered «do not import» does not say it will be created', 'S3 · the screen takes the shown price from the effective row…',
// and the two '6 ·' tests about the file picker and the focus after a read (P18).

import { describe, expect, test } from 'vitest';
import { implementations } from './invoice-zip/testing/implementations';
import { makeCase } from './invoice-zip/testing/invoice-builders';
import type { InvoiceCase } from './invoice-zip/testing/invoice-builders';
import * as ported from './invoice-import-model';
import * as portedPlan from './invoice-import-plan';
import * as legacyJs from '../../js/orders/invoice-import-model.js';
import * as legacyPlanJs from '../../js/orders/invoice-import-plan.js';
import legacySelectionSource from '../../js/orders/invoice-zip/selection.js?raw';
import portedSelectionSource from './invoice-zip/selection.ts?raw';

const legacy = legacyJs as unknown as typeof ported;
const legacyPlan = legacyPlanJs as unknown as typeof portedPlan;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Loose = any;

const SUPPLIER_ID = 'sup-1';

describe.each([
  ['shared/ (TypeScript)', ported, portedPlan, implementations[0][1], portedSelectionSource],
  ['js/ (current app)', legacy, legacyPlan, implementations[1][1], legacySelectionSource],
] as const)('%s', (_name, m, plan, impl, selectionSource) => {
  const { IMPORT_FORMAT, IMPORT_VERSION, AVERAGED_PRICE_JUMP_LIMIT, CHECK_REASONS, parseImportFile } = m;
  const planIngredients = m.planIngredients as (file: Loose, ctx?: Loose) => Loose[];
  const resolveRow = m.resolveRow as (row: Loose, decision?: Loose, ctx?: Loose) => Loose;
  const ingredientWrites = m.ingredientWrites as (row: Loose, file: Loose, nowIso?: Loose, options?: Loose) => Loose;
  const { bucketOf, importTotals, needsConfirmation } = plan;
  const applyDecisions = plan.applyDecisions as (rows: Loose, decisions?: Loose, ctx?: Loose, forget?: Loose, confirm?: Loose, renames?: Loose) => Loose[];
  const { ownerVatOf } = impl.fatturapa as { ownerVatOf: (documents: Loose[]) => string };
  const { selectImport } = impl.selection;
  const newCase = (): InvoiceCase => makeCase(impl.caseImpl);

  const point = (over: Loose = {}): Loose => ({
    invoiceId: '18000000001', line: 5, invoiceDate: '2026-09-10', pricePerUnit: 0.57, qty: 50, reliability: 'media', fromPack: true, ...over,
  });
  const rawIngredient = (over: Loose = {}): Loose => ({
    key: 'IT00000000001|code:F00-25', supplierKey: 'IT00000000001', mergeWith: '', name: 'Farina tipo 00',
    brand: '', category: '', supplierCode: 'F00-25', weight: '25 kg', packUnit: 'sacco', packCount: null,
    priceUnit: 'kg', unitWeightKg: null, vatRate: 4, prices: [point()], ...over,
  });
  const fileOf = (ingredients: Loose[]): Loose => {
    const r = parseImportFile(JSON.stringify({
      format: IMPORT_FORMAT, version: IMPORT_VERSION, generatedAt: '2026-10-03T10:00:00Z',
      suppliers: [{ key: 'IT00000000001', vatNumber: 'IT00000000001', name: 'FORNITORE ESEMPIO SRL' }],
      ingredients,
    }));
    expect(r.ok).toBe(true);
    return (r as Loose).file;
  };
  const stored = (over: Loose = {}): Loose => ({
    id: 'ing-1', name: 'Farina tipo 00', shortName: '', supplierId: SUPPLIER_ID, supplierCode: 'F00-25', weight: '20 kg', kind: 'ingredient', ...over,
  });
  const ctxOf = (over: Loose = {}): Loose => ({
    supplierIdByKey: { IT00000000001: SUPPLIER_ID }, ingredients: [stored()], pricesById: {}, invoicePointIds: {}, ...over,
  });
  const planOne = (raw: Loose, ctx: Loose): Loose => planIngredients(fileOf([raw]).ingredients, ctx)[0];
  const entryOf = (planned: Loose, over: { confirm?: Loose } = {}): Loose =>
    applyDecisions([planned], {}, ctxOf(), new Set(), over.confirm || new Set())[0];

  // ── 1 · the stored pack weight wins ──────────────────────────────────────────────

  test('1 · a price worked out from the description is re-read with the weight the venue keeps (main code)', () => {
    const row = planOne(rawIngredient(), ctxOf());
    // 0.57 €/kg over 25 kg = 14.25 per sack; the venue says the sack is 20 kg: 14.25 / 20 = 0.7125
    expect(row.newPoints[0].pricePerUnit).toBe(0.7125);
    expect(row.newPoints[0].qty, 'the quantity follows the weight too: 50 kg of 25 kg sacks = 40 kg of 20 kg sacks').toBe(40);
    expect(row.checkReason, 'a rescaled price is never applied silently').toBe(CHECK_REASONS.WEIGHT_RESCALED);
    const set = (ingredientWrites(row, fileOf([rawIngredient()]).ingredients[0], '2026-10-06T10:00:00Z', {}).flat() as Loose[])
      .find((op) => op.type === 'set-current-price');
    expect(set.data.pricePerUnit, 'the current price written is the re-read one').toBe(0.7125);
    const history = (ingredientWrites(row, fileOf([rawIngredient()]).ingredients[0], '2026-10-06T10:00:00Z', {}).flat() as Loose[])
      .find((op) => op.type === 'add-price-point');
    expect(history.data.pricePerUnit).toBe(0.7125);
  });

  test('1 · an equal weight, an empty stored weight and a price read by weight are left exactly as they are', () => {
    expect(planOne(rawIngredient(), ctxOf({ ingredients: [stored({ weight: '25 kg' })] })).newPoints[0].pricePerUnit).toBe(0.57);
    expect(planOne(rawIngredient(), ctxOf({ ingredients: [stored({ weight: '' })] })).newPoints[0].pricePerUnit).toBe(0.57);
    const byWeight = rawIngredient({ prices: [point({ fromPack: undefined, reliability: 'alta' })] });
    expect(planOne(byWeight, ctxOf()).newPoints[0].pricePerUnit, 'the invoice said kilos: no pack weight in it').toBe(0.57);
  });

  test('1 · the weight in another unit is compared in kilos (500 g stored, 1 kg in the file)', () => {
    const raw = rawIngredient({ weight: '1 kg', prices: [point({ pricePerUnit: 2 })] });
    const row = planOne(raw, ctxOf({ ingredients: [stored({ weight: '500 g' })] }));
    expect(row.newPoints[0].pricePerUnit).toBe(4);
  });

  test('1 · a code that is only an EXTRA code of the ingredient is another pack, not a correction', () => {
    const ing = stored({ supplierCode: 'OTHER-1', supplierCodes: ['F00-25'], weight: '20 kg' });
    const row = planOne(rawIngredient(), ctxOf({ ingredients: [ing] }));
    expect(row.ingredientId).toBe('ing-1');
    expect(row.newPoints[0].pricePerUnit, 'the extra pack keeps the file\'s own weight').toBe(0.57);
    expect(row.checkReason).toBe(undefined);
  });

  test('1 · a stored weight that cannot be read sends the row to «Price to check» and writes nothing until confirmed', () => {
    const row = planOne(rawIngredient(), ctxOf({ ingredients: [stored({ weight: 'sacco grande' })] }));
    expect(row.checkReason).toBe(CHECK_REASONS.WEIGHT_UNREADABLE);
    expect(row.newPoints[0].pricePerUnit, 'never a guess: the price is the file\'s, unchanged').toBe(0.57);
    const entry = entryOf(row);
    expect(bucketOf(entry)).toBe('check');
    expect(entry.row.status).toBe('skipped');
    expect(entry.row.held).toBe(true);
    expect(importTotals([entry]).rows).toBe(0);
    const confirmed = entryOf(row, { confirm: new Set([row.key]) });
    expect(confirmed.row.status).toBe('update-price');
    expect(importTotals([confirmed]).rows).toBe(1);
    expect(bucketOf(confirmed), 'it stays under the same chip once answered').toBe('check');
  });

  test('1 · a stored weight in litres against a file in kilos is unreadable too, not converted', () => {
    const row = planOne(rawIngredient(), ctxOf({ ingredients: [stored({ weight: '25 l' })] }));
    expect(row.checkReason).toBe(CHECK_REASONS.WEIGHT_UNREADABLE);
  });

  test('1 · the rule holds for a row the person answered «Same as» when two ingredients share the main code', () => {
    const ingredients = [stored({ weight: '20 kg' }), stored({ id: 'ing-2', name: 'Farina doppia', weight: '10 kg' })];
    const ctx = ctxOf({ ingredients });
    const asked = planOne(rawIngredient(), ctx);
    expect(asked.status).toBe('maybe-duplicate');
    expect(asked.newPoints[0].pricePerUnit, 'nothing is re-read until somebody says which one it is').toBe(0.57);
    const resolved = resolveRow(asked, { sameAs: 'ing-1' }, ctx);
    expect(resolved.newPoints[0].pricePerUnit).toBe(0.7125);
    expect(resolveRow(asked, { sameAs: 'ing-2' }, ctx).newPoints[0].pricePerUnit).toBe(1.425);
  });

  test('1 · the file carries `fromPack` for a price worked out from the description, and not for one read by weight', () => {
    const pack = newCase();
    pack.add([{ desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00-25', qty: 2, unit: 'PZ', total: 28.5 }]);
    const packed = (pack.build().importFile.ingredients as Loose[])[0];
    expect(packed.prices[0].fromPack).toBe(true);
    expect(packed.prices[0].reliability).toBe('media');
    expect(packed.prices[0].pricePerUnit).toBe(0.57);
    const weight = newCase();
    weight.add([{ desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00-25', qty: 25, unit: 'KG', total: 14.25 }]);
    const byWeight = (weight.build().importFile.ingredients as Loose[])[0];
    expect(byWeight.prices[0].fromPack).toBe(undefined);
    expect(byWeight.prices[0].reliability).toBe('alta');
  });

  // ── 2 · a big move from a «media» reading ─────────────────────────────────────────

  const priceDoc = (over: Loose = {}): Loose => ({ priceUnit: 'kg', pricePerUnit: 1, priceUpdatedAt: '2026-01-01T12:00:00.000Z', ...over });
  const withStoredPrice = (raw: Loose, doc: Loose, weight = '25 kg'): Loose => planOne(raw, ctxOf({
    ingredients: [stored({ weight })], pricesById: { 'ing-1': doc },
  }));

  test('2 · the limit is one named constant, 30%', () => {
    expect(AVERAGED_PRICE_JUMP_LIMIT).toBe(0.3);
  });

  test('2 · a «media» price more than 30% away from the current one waits for a person', () => {
    const up = withStoredPrice(rawIngredient({ prices: [point({ pricePerUnit: 1.4 })] }), priceDoc());
    expect(up.checkReason).toBe(CHECK_REASONS.PRICE_JUMP);
    expect(up.status).toBe('update-price');
    const down = withStoredPrice(rawIngredient({ prices: [point({ pricePerUnit: 0.6 })] }), priceDoc());
    expect(down.checkReason, 'a fall counts as much as a rise').toBe(CHECK_REASONS.PRICE_JUMP);
    const entry = entryOf(up);
    expect(entry.row.status).toBe('skipped');
    expect(bucketOf(entry)).toBe('check');
    expect(needsConfirmation(up)).toBe(true);
  });

  test('2 · inside 30%, or an «alta» reading, or another unit: no question', () => {
    expect(withStoredPrice(rawIngredient({ prices: [point({ pricePerUnit: 1.3 })] }), priceDoc()).checkReason,
      'exactly +30% is not MORE than 30%').toBe(undefined);
    expect(withStoredPrice(rawIngredient({ prices: [point({ pricePerUnit: 1.2 })] }), priceDoc()).checkReason).toBe(undefined);
    expect(withStoredPrice(rawIngredient({ prices: [point({ pricePerUnit: 2, reliability: 'alta' })] }), priceDoc()).checkReason)
      .toBe(undefined);
    expect(withStoredPrice(rawIngredient({ prices: [point({ pricePerUnit: 5 })] }), priceDoc({ priceUnit: 'l' })).checkReason,
      'a price in another unit goes to the history only, as before').toBe(undefined);
  });

  test('2 · an invoice older than the price in force only feeds the history: nothing to confirm', () => {
    const row = withStoredPrice(rawIngredient({ prices: [point({ pricePerUnit: 3, invoiceDate: '2025-05-01' })] }), priceDoc());
    expect(row.status).toBe('history-only');
    expect(row.checkReason).toBe(undefined);
  });

  // ── 3 · sales invoices ──────────────────────────────────────────────────────────

  const LINE = { desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00-25', qty: 25, unit: 'KG', total: 14.25 };
  const OWNER = '00000000099';

  test('3 · the owner is the buyer most invoices are issued to', () => {
    expect(ownerVatOf([{ buyerVat: 'IT1' }, { buyerVat: 'IT2' }, { buyerVat: 'IT1' }, { buyerVat: '' }])).toBe('IT1');
    expect(ownerVatOf([{ buyerVat: '' }, {}]), 'no buyer anywhere: nobody').toBe('');
    expect(ownerVatOf([{ buyerVat: 'IT1' }, { buyerVat: 'IT2' }]), 'a tie says nothing').toBe('');
  });

  test('3 · an invoice SOLD by the owner is skipped and counted; his purchases stay', () => {
    const c = newCase();
    c.add([LINE], { buyerVat: OWNER, vat: '00000000001', date: '2026-09-01' });
    c.add([LINE], { buyerVat: OWNER, vat: '00000000001', date: '2026-09-08' });
    c.add([{ ...LINE, desc: 'PANE VENDUTO KG 5', code: 'SALE-1' }], { buyerVat: '00000000055', vat: OWNER, name: 'IL MIO FORNO', date: '2026-09-09' });
    const load = c.load();
    expect(load.salesSkipped).toBe(1);
    expect(load.documents.length).toBe(2);
    expect(load.documents.every((d) => d.vatNumber === 'IT00000000001')).toBeTruthy();
    const built = c.build();
    expect(built.salesSkipped).toBe(1);
    expect(built.importFile.suppliers.map((s) => s.vatNumber)).toStrictEqual(['IT00000000001']);
    expect(selectImport(built, {}).counts.salesSkipped).toBe(1);
  });

  test('3 · with no buyer VAT number to find, nothing is skipped', () => {
    const c = newCase();
    c.add([LINE], { vat: '00000000001' });
    c.add([LINE], { vat: OWNER, date: '2026-09-05' });
    const load = c.load();
    expect(load.salesSkipped).toBe(0);
    expect(load.documents.length).toBe(2);
  });

  // ── 4 · the newest invoice is «da verificare», older ones are good ─────────────────

  const OLD = { desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00-25', qty: 25, unit: 'KG', total: 14.25 };
  const NEWEST_ABSURD = { desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00-25', qty: 25, unit: 'KG', total: 10000 };

  function twoInvoices(): Loose {
    const c = newCase();
    c.add([OLD], { date: '2026-08-01' });
    c.add([NEWEST_ABSURD], { date: '2026-09-12', number: '2' });
    return (c.build().importFile.ingredients as Loose[])[0];
  }

  test('4 · the file says the newest invoice was left out, and holds only the good price', () => {
    const ing = twoInvoices();
    expect(ing.latestUnverified).toBe(true);
    expect(ing.prices.map((p: Loose) => p.invoiceDate)).toStrictEqual(['2026-08-01']);
    const clean = newCase();
    clean.add([OLD], { date: '2026-08-01' });
    expect((clean.build().importFile.ingredients as Loose[])[0].latestUnverified).toBe(undefined);
  });

  test('4 · a NEW ingredient from the older invoice names its date and sits under «Price to check»', () => {
    const file = fileOf([twoInvoices()]).ingredients;
    const row = planIngredients(file, ctxOf({ ingredients: [] }))[0] as Loose;
    expect(row.status).toBe('new');
    expect(row.checkReason).toBe(CHECK_REASONS.OLDER_INVOICE);
    expect(row.checkDate).toBe('2026-08-01');
    expect(bucketOf(applyDecisions([row], {}, ctxOf(), new Set(), new Set())[0])).toBe('check');
  });

  test('4 · a MATCHED row waits for a person, and the reason names the date the price comes from', () => {
    const file = fileOf([twoInvoices()]).ingredients;
    const row = planIngredients(file, ctxOf({ ingredients: [stored({ weight: '25 kg' })] }))[0] as Loose;
    expect(row.status).toBe('update-price');
    expect(row.checkReason).toBe(CHECK_REASONS.OLDER_INVOICE);
    expect(row.checkDate).toBe('2026-08-01');
    expect(entryOf(row).row.held).toBe(true);
    expect(entryOf(row, { confirm: new Set([row.key]) }).row.status).toBe('update-price');
  });

  // ── 7 · the stored supplier name ───────────────────────────────────────────────────

  test('7 · the remembered «skip this supplier» still stores the name as its label, and says why in a comment', () => {
    expect(selectionSource).toMatch(/supplierSkips\.forEach\(\(s\) => setTo\(supplierDecisionKey\(s\.key\), DECISION_SKIP, s\.name\)\);/);
    expect(selectionSource).toMatch(/PERSONAL DATA \(P13\)[\s\S]{0,500}«import again»/);
  });

  // ── review round 2 ──────────────────────────────────────────────────────────────

  // Whole pack, not one item (a Cartone stores ONE item's weight beside its packCount).
  const singolaFile = (over: Loose = {}): Loose => rawIngredient({ weight: '10 kg', packCount: null, prices: [point({ pricePerUnit: 8, qty: 80 })], ...over });
  const cartonFile = (over: Loose = {}): Loose => rawIngredient({ weight: '1 kg', packCount: 10, prices: [point({ pricePerUnit: 8, qty: 80 })], ...over });

  test('A · a file «10 kg» Singola against a card Cartone 10 × 1 kg is the same pack: the price stays 8 (update-price)', () => {
    const card = stored({ weight: '1 kg', packCount: 10 });
    const row = planOne(singolaFile(), ctxOf({ ingredients: [card] }));
    expect(row.status).toBe('update-price');
    expect(row.newPoints[0].pricePerUnit, 'not 80').toBe(8);
    expect(row.checkReason).toBe(undefined);
  });

  test('B · the same, when the invoice is older than the price in force (history-only): the history keeps 8', () => {
    const card = stored({ weight: '1 kg', packCount: 10 });
    const doc = { priceUnit: 'kg', pricePerUnit: 9, priceUpdatedAt: '2026-12-01T12:00:00.000Z' };
    const row = planOne(singolaFile(), ctxOf({ ingredients: [card], pricesById: { 'ing-1': doc } }));
    expect(row.status).toBe('history-only');
    expect(row.newPoints[0].pricePerUnit, 'a wrong history point would be permanent').toBe(8);
  });

  test('C · a file Cartone 10 × 1 kg against a card Singola 10 kg is the same pack too: the price stays 8', () => {
    const card = stored({ weight: '10 kg' });
    const row = planOne(cartonFile(), ctxOf({ ingredients: [card] }));
    expect(row.newPoints[0].pricePerUnit, 'not 0.8').toBe(8);
  });

  test('A · a real difference in the TOTAL is still corrected, with the counts on both sides', () => {
    // file: 10 × 1 kg = 10 kg at 8 per kg; card: 10 × 2 kg = 20 kg: the sack is bigger, so the kilo is cheaper
    const row = planOne(cartonFile(), ctxOf({ ingredients: [stored({ weight: '2 kg', packCount: 10 })] }));
    expect(row.newPoints[0].pricePerUnit).toBe(4);
  });

  // A held row writes nothing, supplier-code patches included.
  test('8 · a held row yields no batches, even when it would have taught the ingredient a new article code', () => {
    const doc = priceDoc();
    const jump = [point({ pricePerUnit: 1.5 })];
    const extra = planOne(rawIngredient({ mergeWith: 'Farina tipo 00', prices: jump }), ctxOf({
      ingredients: [stored({ supplierCode: 'OTHER-1', weight: '25 kg' })], pricesById: { 'ing-1': doc },
    }));
    expect(extra.setSupplierCodes).toStrictEqual(['F00-25']);
    expect(extra.checkReason).toBe(CHECK_REASONS.PRICE_JUMP);
    const noCode = planOne(rawIngredient({ mergeWith: 'Farina tipo 00', prices: jump }), ctxOf({
      ingredients: [stored({ supplierCode: '', weight: '25 kg' })], pricesById: { 'ing-1': doc },
    }));
    expect(noCode.patchSupplierCode).toBe('F00-25');
    for (const row of [extra, noCode]) {
      const held = entryOf(row).row;
      expect(held.held).toBe(true);
      expect(ingredientWrites(held, fileOf([rawIngredient({ prices: jump })]).ingredients[0], '2026-10-06T10:00:00Z', {})).toStrictEqual([]);
      const released = entryOf(row, { confirm: new Set([row.key]) }).row;
      expect(ingredientWrites(released, fileOf([rawIngredient({ prices: jump })]).ingredients[0], '2026-10-06T10:00:00Z', {}).length).toBeGreaterThan(0);
    }
  });

  // The original's last assertion reads the current app's screen as text (slice B3): the model half is here.
  test('3 · the held row still carries the row it would be, for the old-price comparison on screen', () => {
    const row = withStoredPrice(rawIngredient({ prices: [point({ pricePerUnit: 1.5 })] }), priceDoc());
    const held = entryOf(row).row;
    expect(held.status).toBe('skipped');
    expect(held.heldRow.status).toBe('update-price');
    expect(held.heldRow.newPoints[0].pricePerUnit).toBe(1.5);
  });

  test('9 · the owner needs a STRICT MAJORITY of the invoices that name a buyer', () => {
    const buyers = (...list: string[]): Loose[] => list.map((buyerVat) => ({ buyerVat }));
    expect(ownerVatOf(buyers('A', 'A', 'B'))).toBe('A');
    expect(ownerVatOf(buyers('A', 'A', 'B', 'C')), 'the top buyer, but 2 of 4 is not a majority').toBe('');
    expect(ownerVatOf(buyers('B', 'B', 'B', 'A', 'A', 'C', 'C')), 'two venues in one zip: nothing is skipped').toBe('');
    expect(ownerVatOf([...buyers('A', 'A'), { buyerVat: '' }, {}]), 'invoices that name no buyer do not count').toBe('A');
    const c = newCase();
    c.add([LINE], { buyerVat: '00000000098', vat: '00000000001', date: '2026-09-01' });
    c.add([LINE], { buyerVat: '00000000098', vat: '00000000002', name: 'ALTRO FORNITORE', date: '2026-09-02' });
    c.add([LINE], { buyerVat: '00000000097', vat: '00000000003', name: 'TERZO FORNITORE', date: '2026-09-03' });
    c.add([LINE], { buyerVat: '00000000096', vat: '00000000098', name: 'VENDITORE', date: '2026-09-04' });
    const load = c.load();
    expect(load.salesSkipped, 'B is the top buyer with 2 of 4, so nothing is dropped').toBe(0);
    expect(load.documents.length).toBe(4);
  });

  // ── review round 3: a factor other than 1 is never applied silently ──────────────────

  const cartonOnInvoice = (): Loose => rawIngredient({ weight: '1 kg', packCount: 10, prices: [point({ pricePerUnit: 8, qty: 80 })] });
  const FILE_ING = (): Loose => fileOf([cartonOnInvoice()]).ingredients[0];
  const NOW = '2026-10-06T10:00:00Z';

  function assertHeldUntilConfirmed(row: Loose, { rescaledPrice, stored: storedText, file }: { rescaledPrice: number; stored: string; file: string }): void {
    expect(row.checkReason).toBe(CHECK_REASONS.WEIGHT_RESCALED);
    expect(row.checkStored).toBe(storedText);
    expect(row.checkFile).toBe(file);
    const held = entryOf(row);
    expect(bucketOf(held)).toBe('check');
    expect(held.row.held).toBe(true);
    expect(importTotals([held]).rows).toBe(0);
    expect(ingredientWrites(held.row, FILE_ING(), NOW, {}), 'nothing is written while it is held').toStrictEqual([]);
    expect(held.row.heldRow.newPoints[0].pricePerUnit, 'the held comparison is the rescaled price').toBe(rescaledPrice);
    const confirmed = entryOf(row, { confirm: new Set([row.key]) });
    expect(confirmed.row.held).toBe(undefined);
    expect(confirmed.row.newPoints[0].pricePerUnit).toBe(rescaledPrice);
    expect(ingredientWrites(confirmed.row, FILE_ING(), NOW, {}).length).toBeGreaterThan(0);
  }

  test('R1 · a Singola card against an invoice «10 × 1 kg»: 80, never silently — no price in force (update-price)', () => {
    const row = planOne(cartonOnInvoice(), ctxOf({ ingredients: [stored({ weight: '1 kg' })] }));
    expect(row.status).toBe('update-price');
    assertHeldUntilConfirmed(row, { rescaledPrice: 80, stored: '1 kg', file: '10 × 1 kg' });
  });

  test('R2 · the same with a stored price in ANOTHER unit (history-only)', () => {
    const doc = { priceUnit: 'pcs', pricePerUnit: 3, unitWeightKg: 1, priceUpdatedAt: '2026-01-01T12:00:00.000Z' };
    const row = planOne(cartonOnInvoice(), ctxOf({ ingredients: [stored({ weight: '1 kg' })], pricesById: { 'ing-1': doc } }));
    expect(row.status).toBe('history-only');
    assertHeldUntilConfirmed(row, { rescaledPrice: 80, stored: '1 kg', file: '10 × 1 kg' });
  });

  test('R3 · the same with a stored price NEWER than the invoice (history-only)', () => {
    const doc = priceDoc({ priceUpdatedAt: '2026-12-01T12:00:00.000Z' });
    const row = planOne(cartonOnInvoice(), ctxOf({ ingredients: [stored({ weight: '1 kg' })], pricesById: { 'ing-1': doc } }));
    expect(row.status).toBe('history-only');
    assertHeldUntilConfirmed(row, { rescaledPrice: 80, stored: '1 kg', file: '10 × 1 kg' });
  });

  test('R4 · the mirror: a Cartone 10 × 1 kg card against an invoice for one 1 kg item: 0.8, held', () => {
    const single = rawIngredient({ weight: '1 kg', packCount: null, prices: [point({ pricePerUnit: 8, qty: 8 })] });
    const row = planOne(single, ctxOf({ ingredients: [stored({ weight: '1 kg', packCount: 10 })] }));
    expect(row.status).toBe('update-price');
    expect(row.checkReason).toBe(CHECK_REASONS.WEIGHT_RESCALED);
    expect(row.checkStored).toBe('10 × 1 kg');
    expect(row.checkFile).toBe('1 kg');
    expect(entryOf(row).row.heldRow.newPoints[0].pricePerUnit).toBe(0.8);
    expect(entryOf(row).row.held).toBe(true);
    expect(entryOf(row, { confirm: new Set([row.key]) }).row.newPoints[0].pricePerUnit).toBe(0.8);
  });

  test('R5 · priority: unreadable weight, then rescaled, then price jump, then older invoice', () => {
    const doc = priceDoc();
    const both = planOne(rawIngredient({ prices: [point({ pricePerUnit: 3 })], latestUnverified: true }),
      ctxOf({ ingredients: [stored({ weight: '20 kg' })], pricesById: { 'ing-1': doc } }));
    expect(both.checkReason, 'rescaled beats a jump and an older invoice').toBe(CHECK_REASONS.WEIGHT_RESCALED);
    const unreadable = planOne(rawIngredient({ prices: [point({ pricePerUnit: 3 })] }),
      ctxOf({ ingredients: [stored({ weight: 'sacco' })], pricesById: { 'ing-1': doc } }));
    expect(unreadable.checkReason).toBe(CHECK_REASONS.WEIGHT_UNREADABLE);
  });

  // ── review round 4: the price shown and the confirmation follow the ANSWER ───────────

  test('S1 · «Same as A» on a code-ambiguous question: the row shown and held carries the rescaled 80, not the file\'s 8', () => {
    const ingredients = [stored({ weight: '1 kg' }), stored({ id: 'ing-2', name: 'Burro doppio', weight: '10 kg' })];
    const ctx = ctxOf({ ingredients });
    const asked = planOne(cartonOnInvoice(), ctx);
    expect(asked.status).toBe('maybe-duplicate');
    expect(asked.allPoints[0].pricePerUnit, 'the question row itself is not re-read').toBe(8);
    const entry = applyDecisions([asked], { [asked.key]: { sameAs: 'ing-1' } }, ctx, new Set(), new Set())[0]!;
    expect(entry.row.held).toBe(true);
    expect(entry.row.checkReason).toBe(CHECK_REASONS.WEIGHT_RESCALED);
    expect(entry.row.allPoints[0].pricePerUnit, 'what the screen shows comes from here (heldRow / row.allPoints)').toBe(80);
    expect(entry.row.heldRow.allPoints[0].pricePerUnit).toBe(80);
    expect(entry.planned.allPoints[0].pricePerUnit).toBe(8);
  });

  test('S2 · the same on the «choose» path (a «unisci con» name that matches nothing)', () => {
    const ctx = ctxOf({ ingredients: [stored({ weight: '1 kg' })] });
    const asked = planOne({ ...cartonOnInvoice(), mergeWith: 'Nome che non esiste' }, ctx);
    expect(asked.status).toBe('choose');
    const entry = applyDecisions([asked], { [asked.key]: { sameAs: 'ing-1' } }, ctx, new Set(), new Set())[0]!;
    expect(entry.row.heldRow.allPoints[0].pricePerUnit).toBe(80);
    expect(entry.row.allPoints[0].pricePerUnit).toBe(80);
  });

  // The original first reads the current app's screen as text (the screen deletes `confirmKeys` and `renames` on a new answer;
  // slice B3). The model half is here: a confirmation never reaches another price.
  test('S4 · a new answer clears the «Use this price» of the row, so a confirmation never reaches another price', () => {
    const ingredients = [stored({ weight: '1 kg' }), stored({ id: 'ing-2', name: 'Burro doppio', weight: '10 kg' })];
    const ctx = ctxOf({ ingredients });
    const asked = planOne(cartonOnInvoice(), ctx);
    const confirmed = new Set([asked.key]);
    const a = applyDecisions([asked], { [asked.key]: { sameAs: 'ing-1' } }, ctx, new Set(), confirmed)[0]!.row;
    expect(a.newPoints[0].pricePerUnit).toBe(80);
    confirmed.delete(asked.key);
    const b = applyDecisions([asked], { [asked.key]: { sameAs: 'ing-2' } }, ctx, new Set(), confirmed)[0]!.row;
    expect(b.status, 'the other ingredient is the same pack: 10 kg = 10 x 1 kg').toBe('update-price');
    expect(b.checkReason).toBe(undefined);
    expect(b.newPoints[0].pricePerUnit, 'another answer, another price').toBe(8);
  });
});
