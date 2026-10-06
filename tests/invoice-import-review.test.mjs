// «Import from invoices» — the seven review points: the weight the venue keeps wins over the description, a big
// move from a «media» reading and an older invoice's price wait for a person, sales invoices are skipped, the zip's
// entry count is read before fflate walks it, and the file picker is off while a zip is read.
// Every name, VAT number and price below is INVENTED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from '../js/vendor/fflate.esm.js';
import { _dictionaries } from '../js/i18n.js';
import {
  IMPORT_FORMAT, IMPORT_VERSION, AVERAGED_PRICE_JUMP_LIMIT, CHECK_REASONS, parseImportFile, planIngredients,
  resolveRow, ingredientWrites,
} from '../js/orders/invoice-import-model.js';
import { applyDecisions, bucketOf, importTotals, needsConfirmation } from '../js/orders/invoice-import-plan.js';
import { declaredEntryCount, readInvoiceArchives } from '../js/orders/invoice-zip/zip-read.js';
import { ownerVatOf } from '../js/orders/invoice-zip/fatturapa.js';
import { selectImport } from '../js/orders/invoice-zip/selection.js';
import { newCase } from './helpers/invoice-builders.mjs';

const DICT = _dictionaries();
const SUPPLIER_ID = 'sup-1';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const point = (over = {}) => ({
  invoiceId: '18000000001', line: 5, invoiceDate: '2026-09-10', pricePerUnit: 0.57, qty: 50, reliability: 'media', fromPack: true, ...over,
});
const rawIngredient = (over = {}) => ({
  key: 'IT00000000001|code:F00-25', supplierKey: 'IT00000000001', mergeWith: '', name: 'Farina tipo 00',
  brand: '', category: '', supplierCode: 'F00-25', weight: '25 kg', packUnit: 'sacco', packCount: null,
  priceUnit: 'kg', unitWeightKg: null, vatRate: 4, prices: [point()], ...over,
});
const fileOf = (ingredients) => {
  const r = parseImportFile(JSON.stringify({
    format: IMPORT_FORMAT, version: IMPORT_VERSION, generatedAt: '2026-10-03T10:00:00Z',
    suppliers: [{ key: 'IT00000000001', vatNumber: 'IT00000000001', name: 'FORNITORE ESEMPIO SRL' }],
    ingredients,
  }));
  assert.equal(r.ok, true);
  return r.file;
};
const stored = (over = {}) => ({
  id: 'ing-1', name: 'Farina tipo 00', shortName: '', supplierId: SUPPLIER_ID, supplierCode: 'F00-25', weight: '20 kg', kind: 'ingredient', ...over,
});
const ctxOf = (over = {}) => ({
  supplierIdByKey: { IT00000000001: SUPPLIER_ID }, ingredients: [stored()], pricesById: {}, invoicePointIds: {}, ...over,
});
const planOne = (raw, ctx) => planIngredients(fileOf([raw]).ingredients, ctx)[0];
const entryOf = (planned, over = {}) => applyDecisions([planned], {}, ctxOf(), new Set(), over.confirm || new Set())[0];

// ── 1 · the stored pack weight wins ──────────────────────────────────────────────

test('1 · a price worked out from the description is re-read with the weight the venue keeps (main code)', () => {
  const row = planOne(rawIngredient(), ctxOf());
  // 0.57 €/kg over 25 kg = 14.25 per sack; the venue says the sack is 20 kg: 14.25 / 20 = 0.7125
  assert.equal(row.newPoints[0].pricePerUnit, 0.7125);
  assert.equal(row.newPoints[0].qty, 40, 'the quantity follows the weight too: 50 kg of 25 kg sacks = 40 kg of 20 kg sacks');
  assert.equal(row.checkReason, CHECK_REASONS.WEIGHT_RESCALED, 'a rescaled price is never applied silently');
  const set = ingredientWrites(row, fileOf([rawIngredient()]).ingredients[0], '2026-10-06T10:00:00Z', {}).flat()
    .find(op => op.type === 'set-current-price');
  assert.equal(set.data.pricePerUnit, 0.7125, 'the current price written is the re-read one');
  const history = ingredientWrites(row, fileOf([rawIngredient()]).ingredients[0], '2026-10-06T10:00:00Z', {}).flat()
    .find(op => op.type === 'add-price-point');
  assert.equal(history.data.pricePerUnit, 0.7125);
});

test('1 · an equal weight, an empty stored weight and a price read by weight are left exactly as they are', () => {
  assert.equal(planOne(rawIngredient(), ctxOf({ ingredients: [stored({ weight: '25 kg' })] })).newPoints[0].pricePerUnit, 0.57);
  assert.equal(planOne(rawIngredient(), ctxOf({ ingredients: [stored({ weight: '' })] })).newPoints[0].pricePerUnit, 0.57);
  const byWeight = rawIngredient({ prices: [point({ fromPack: undefined, reliability: 'alta' })] });
  assert.equal(planOne(byWeight, ctxOf()).newPoints[0].pricePerUnit, 0.57, 'the invoice said kilos: no pack weight in it');
});

test('1 · the weight in another unit is compared in kilos (500 g stored, 1 kg in the file)', () => {
  const raw = rawIngredient({ weight: '1 kg', prices: [point({ pricePerUnit: 2 })] });
  const row = planOne(raw, ctxOf({ ingredients: [stored({ weight: '500 g' })] }));
  assert.equal(row.newPoints[0].pricePerUnit, 4);
});

test('1 · a code that is only an EXTRA code of the ingredient is another pack, not a correction', () => {
  const ing = stored({ supplierCode: 'OTHER-1', supplierCodes: ['F00-25'], weight: '20 kg' });
  const row = planOne(rawIngredient(), ctxOf({ ingredients: [ing] }));
  assert.equal(row.ingredientId, 'ing-1');
  assert.equal(row.newPoints[0].pricePerUnit, 0.57, 'the extra pack keeps the file\'s own weight');
  assert.equal(row.checkReason, undefined);
});

test('1 · a stored weight that cannot be read sends the row to «Price to check» and writes nothing until confirmed', () => {
  const row = planOne(rawIngredient(), ctxOf({ ingredients: [stored({ weight: 'sacco grande' })] }));
  assert.equal(row.checkReason, CHECK_REASONS.WEIGHT_UNREADABLE);
  assert.equal(row.newPoints[0].pricePerUnit, 0.57, 'never a guess: the price is the file\'s, unchanged');
  const entry = entryOf(row);
  assert.equal(bucketOf(entry), 'check');
  assert.equal(entry.row.status, 'skipped');
  assert.equal(entry.row.held, true);
  assert.equal(importTotals([entry]).rows, 0);
  const confirmed = entryOf(row, { confirm: new Set([row.key]) });
  assert.equal(confirmed.row.status, 'update-price');
  assert.equal(importTotals([confirmed]).rows, 1);
  assert.equal(bucketOf(confirmed), 'check', 'it stays under the same chip once answered');
});

test('1 · a stored weight in litres against a file in kilos is unreadable too, not converted', () => {
  const row = planOne(rawIngredient(), ctxOf({ ingredients: [stored({ weight: '25 l' })] }));
  assert.equal(row.checkReason, CHECK_REASONS.WEIGHT_UNREADABLE);
});

test('1 · the rule holds for a row the person answered «Same as» when two ingredients share the main code', () => {
  const ingredients = [stored({ weight: '20 kg' }), stored({ id: 'ing-2', name: 'Farina doppia', weight: '10 kg' })];
  const ctx = ctxOf({ ingredients });
  const asked = planOne(rawIngredient(), ctx);
  assert.equal(asked.status, 'maybe-duplicate');
  assert.equal(asked.newPoints[0].pricePerUnit, 0.57, 'nothing is re-read until somebody says which one it is');
  const resolved = resolveRow(asked, { sameAs: 'ing-1' }, ctx);
  assert.equal(resolved.newPoints[0].pricePerUnit, 0.7125);
  assert.equal(resolveRow(asked, { sameAs: 'ing-2' }, ctx).newPoints[0].pricePerUnit, 1.425);
});

test('1 · the file carries `fromPack` for a price worked out from the description, and not for one read by weight', () => {
  const pack = newCase();
  pack.add([{ desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00-25', qty: 2, unit: 'PZ', total: 28.5 }]);
  const packed = pack.build().importFile.ingredients[0];
  assert.equal(packed.prices[0].fromPack, true);
  assert.equal(packed.prices[0].reliability, 'media');
  assert.equal(packed.prices[0].pricePerUnit, 0.57);
  const weight = newCase();
  weight.add([{ desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00-25', qty: 25, unit: 'KG', total: 14.25 }]);
  const byWeight = weight.build().importFile.ingredients[0];
  assert.equal(byWeight.prices[0].fromPack, undefined);
  assert.equal(byWeight.prices[0].reliability, 'alta');
});

// ── 2 · a big move from a «media» reading ─────────────────────────────────────────

const priceDoc = (over = {}) => ({ priceUnit: 'kg', pricePerUnit: 1, priceUpdatedAt: '2026-01-01T12:00:00.000Z', ...over });
const withStoredPrice = (raw, doc, weight = '25 kg') => planOne(raw, ctxOf({
  ingredients: [stored({ weight })], pricesById: { 'ing-1': doc },
}));

test('2 · the limit is one named constant, 30%', () => {
  assert.equal(AVERAGED_PRICE_JUMP_LIMIT, 0.3);
});

test('2 · a «media» price more than 30% away from the current one waits for a person', () => {
  const up = withStoredPrice(rawIngredient({ prices: [point({ pricePerUnit: 1.4 })] }), priceDoc());
  assert.equal(up.checkReason, CHECK_REASONS.PRICE_JUMP);
  assert.equal(up.status, 'update-price');
  const down = withStoredPrice(rawIngredient({ prices: [point({ pricePerUnit: 0.6 })] }), priceDoc());
  assert.equal(down.checkReason, CHECK_REASONS.PRICE_JUMP, 'a fall counts as much as a rise');
  const entry = entryOf(up);
  assert.equal(entry.row.status, 'skipped');
  assert.equal(bucketOf(entry), 'check');
  assert.equal(needsConfirmation(up), true);
});

test('2 · inside 30%, or an «alta» reading, or another unit: no question', () => {
  assert.equal(withStoredPrice(rawIngredient({ prices: [point({ pricePerUnit: 1.3 })] }), priceDoc()).checkReason, undefined,
    'exactly +30% is not MORE than 30%');
  assert.equal(withStoredPrice(rawIngredient({ prices: [point({ pricePerUnit: 1.2 })] }), priceDoc()).checkReason, undefined);
  assert.equal(withStoredPrice(rawIngredient({ prices: [point({ pricePerUnit: 2, reliability: 'alta' })] }), priceDoc()).checkReason,
    undefined);
  assert.equal(withStoredPrice(rawIngredient({ prices: [point({ pricePerUnit: 5 })] }), priceDoc({ priceUnit: 'l' })).checkReason,
    undefined, 'a price in another unit goes to the history only, as before');
});

test('2 · an invoice older than the price in force only feeds the history: nothing to confirm', () => {
  const row = withStoredPrice(rawIngredient({ prices: [point({ pricePerUnit: 3, invoiceDate: '2025-05-01' })] }), priceDoc());
  assert.equal(row.status, 'history-only');
  assert.equal(row.checkReason, undefined);
});

// ── 3 · sales invoices ──────────────────────────────────────────────────────────

const LINE = { desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00-25', qty: 25, unit: 'KG', total: 14.25 };
const OWNER = '00000000099';

test('3 · the owner is the buyer most invoices are issued to', () => {
  assert.equal(ownerVatOf([{ buyerVat: 'IT1' }, { buyerVat: 'IT2' }, { buyerVat: 'IT1' }, { buyerVat: '' }]), 'IT1');
  assert.equal(ownerVatOf([{ buyerVat: '' }, {}]), '', 'no buyer anywhere: nobody');
  assert.equal(ownerVatOf([{ buyerVat: 'IT1' }, { buyerVat: 'IT2' }]), '', 'a tie says nothing');
});

test('3 · an invoice SOLD by the owner is skipped and counted; his purchases stay', () => {
  const c = newCase();
  c.add([LINE], { buyerVat: OWNER, vat: '00000000001', date: '2026-09-01' });
  c.add([LINE], { buyerVat: OWNER, vat: '00000000001', date: '2026-09-08' });
  c.add([{ ...LINE, desc: 'PANE VENDUTO KG 5', code: 'SALE-1' }], { buyerVat: '00000000055', vat: OWNER, name: 'IL MIO FORNO', date: '2026-09-09' });
  const load = c.load();
  assert.equal(load.salesSkipped, 1);
  assert.equal(load.documents.length, 2);
  assert.ok(load.documents.every(d => d.vatNumber === 'IT00000000001'));
  const built = c.build();
  assert.equal(built.salesSkipped, 1);
  assert.deepEqual(built.importFile.suppliers.map(s => s.vatNumber), ['IT00000000001']);
  assert.equal(selectImport(built, {}).counts.salesSkipped, 1);
});

test('3 · with no buyer VAT number to find, nothing is skipped', () => {
  const c = newCase();
  c.add([LINE], { vat: '00000000001' });
  c.add([LINE], { vat: OWNER, date: '2026-09-05' });
  const load = c.load();
  assert.equal(load.salesSkipped, 0);
  assert.equal(load.documents.length, 2);
});

test('3 · the summary line exists in English and Italian, with a singular and a plural', () => {
  for (const lang of ['en', 'it']) {
    const entry = DICT[lang]['invoiceImport.zip.sales'];
    assert.equal(typeof entry.one, 'string', lang);
    assert.equal(typeof entry.other, 'string', lang);
    assert.match(entry.other, /\{n\}/);
  }
  assert.equal(DICT.it['invoiceImport.zip.sales'].other, '{n} fatture di vendita ignorate');
  assert.equal(DICT.en['invoiceImport.zip.sales'].other, '{n} sales invoices skipped');
  assert.match(codeOf(read('js/orders/invoice-import-screen.js')), /counts\.salesSkipped > 0 \? t\('invoiceImport\.zip\.sales', \{ n: counts\.salesSkipped \}\)/);
});

// ── 4 · the newest invoice is «da verificare», older ones are good ─────────────────

const OLD = { desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00-25', qty: 25, unit: 'KG', total: 14.25 };
const NEWEST_ABSURD = { desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00-25', qty: 25, unit: 'KG', total: 10000 };

function twoInvoices() {
  const c = newCase();
  c.add([OLD], { date: '2026-08-01' });
  c.add([NEWEST_ABSURD], { date: '2026-09-12', number: '2' });
  return c.build().importFile.ingredients[0];
}

test('4 · the file says the newest invoice was left out, and holds only the good price', () => {
  const ing = twoInvoices();
  assert.equal(ing.latestUnverified, true);
  assert.deepEqual(ing.prices.map(p => p.invoiceDate), ['2026-08-01']);
  const clean = newCase();
  clean.add([OLD], { date: '2026-08-01' });
  assert.equal(clean.build().importFile.ingredients[0].latestUnverified, undefined);
});

test('4 · a NEW ingredient from the older invoice names its date and sits under «Price to check»', () => {
  const file = fileOf([twoInvoices()]).ingredients;
  const row = planIngredients(file, ctxOf({ ingredients: [] }))[0];
  assert.equal(row.status, 'new');
  assert.equal(row.checkReason, CHECK_REASONS.OLDER_INVOICE);
  assert.equal(row.checkDate, '2026-08-01');
  assert.equal(bucketOf(applyDecisions([row], {}, ctxOf(), new Set(), new Set())[0]), 'check');
});

test('4 · a MATCHED row waits for a person, and the reason names the date the price comes from', () => {
  const file = fileOf([twoInvoices()]).ingredients;
  const row = planIngredients(file, ctxOf({ ingredients: [stored({ weight: '25 kg' })] }))[0];
  assert.equal(row.status, 'update-price');
  assert.equal(row.checkReason, CHECK_REASONS.OLDER_INVOICE);
  assert.equal(row.checkDate, '2026-08-01');
  assert.equal(entryOf(row).row.held, true);
  assert.equal(entryOf(row, { confirm: new Set([row.key]) }).row.status, 'update-price');
});

test('4 · the reason sentences exist in both languages, with their holes', () => {
  assert.equal(DICT.it['invoiceImport.check.olderInvoice'], 'Prezzo dalla fattura del {date}: la più recente è da verificare.');
  for (const key of ['weightUnreadable', 'priceJump', 'olderInvoice']) {
    for (const lang of ['en', 'it']) assert.equal(typeof DICT[lang][`invoiceImport.check.${key}`], 'string', `${lang} ${key}`);
  }
  for (const lang of ['en', 'it']) {
    assert.match(DICT[lang]['invoiceImport.check.priceJump'], /\{limit\}/);
    assert.match(DICT[lang]['invoiceImport.check.olderInvoice'], /\{date\}/);
    assert.equal(typeof DICT[lang]['invoiceImport.ing.confirm.use'], 'string');
    assert.equal(typeof DICT[lang]['invoiceImport.ing.confirm.hold'], 'string');
  }
});

// ── 5 · the entry count, before fflate ─────────────────────────────────────────────

const zipOfEntries = (n) => {
  const members = {};
  for (let i = 0; i < n; i += 1) members[`n${i}.xml`] = strToU8('<x/>');
  return zipSync(members);
};
// The position of the End Of Central Directory record of a zip made by fflate (no comment: it is the last 22 bytes).
const eocdAt = (bytes) => bytes.length - 22;
const forge = (bytes, { onDisk, total, offset }) => {
  const copy = new Uint8Array(bytes);
  const view = new DataView(copy.buffer);
  const at = eocdAt(copy);
  if (onDisk !== undefined) view.setUint16(at + 8, onDisk, true);
  if (total !== undefined) view.setUint16(at + 10, total, true);
  if (offset !== undefined) view.setUint32(at + 16, offset, true);
  return copy;
};
const refusal = (bytes, options) => {
  const read = readInvoiceArchives([{ name: 'forged.zip', bytes }], options);
  assert.deepEqual(read.containers, []);
  return [read.skipped[0].reason, read.skipped[0].detail];
};

test('5 · the entry count is read from the End Of Central Directory record', () => {
  assert.equal(declaredEntryCount(zipOfEntries(3)), 3);
  assert.equal(declaredEntryCount(zipOfEntries(1)), 1);
  assert.equal(declaredEntryCount(new Uint8Array(10)), null);
  assert.equal(declaredEntryCount(strToU8('not a zip, only long enough to be looked at, no record in it')), null);
});

// ⚠️ WHICH CASES PROVE THE PRE-CHECK (measured by removing it): a forged +8 count of 60000, 6000/6000 and the 0xFFFF
// count are ALSO caught by the check made after fflate has walked the directory. Only the two below are not — a
// SMALL +8 count with a huge +10 count, and the ZIP64 offset — fflate reads those archives without complaint, so
// without the pre-check they would be accepted.
test('5 · a record that declares too many entries is refused first (+8 is what fflate loops on, +10 must not hide it)', () => {
  const real = zipOfEntries(1);
  assert.deepEqual(refusal(forge(real, { onDisk: 1, total: 60000 })), ['too-many-entries', '5000'],
    'PROVES THE PRE-CHECK: without it this archive is read as if it were honest');
  assert.deepEqual(refusal(forge(real, { onDisk: 60000, total: 1 })), ['too-many-entries', '5000']);
  assert.deepEqual(refusal(forge(real, { onDisk: 6000, total: 6000 })), ['too-many-entries', '5000']);
  assert.equal(declaredEntryCount(forge(real, { onDisk: 60000, total: 1 })), 60000);
});

test('5 · a ZIP64 marker is «zip unreadable» (not «too many entries»): an invoice zip never needs the format', () => {
  const real = zipOfEntries(1);
  assert.deepEqual(refusal(forge(real, { offset: 0xffffffff })), ['zip-unreadable', ''],
    'PROVES THE PRE-CHECK: without it fflate reads this archive as an honest one');
  assert.deepEqual(refusal(forge(real, { onDisk: 0xffff, total: 0xffff })), ['zip-unreadable', '']);
  assert.equal(declaredEntryCount(forge(real, { offset: 0xffffffff })), Infinity);
});

test('5 · the record is searched down to exactly 65559 bytes from the end, like fflate', () => {
  const real = zipOfEntries(1);
  const padded = (extra) => { const out = new Uint8Array(real.length + extra); out.set(real); return out; };
  const exact = padded(65559 - 22);
  assert.equal(exact.length - (real.length - 22), 65559);
  assert.equal(declaredEntryCount(exact), 1, 'at len - 65559: found');
  assert.equal(declaredEntryCount(padded(65559 - 22 + 1)), null, 'at len - 65560: not found');
});

test('5 · the limit is the one the caller gives, and an honest archive is read', () => {
  const three = zipOfEntries(3);
  assert.equal(refusal(three, { limits: { maxEntries: 2 } })[0], 'too-many-entries');
  assert.equal(readInvoiceArchives([{ name: 'a.zip', bytes: three }], { limits: { maxEntries: 3 } }).skipped.length, 0);
});

test('5 · the record is found in the same window as fflate (a comment as long as the format allows)', () => {
  const real = zipOfEntries(1);
  const comment = 65535;
  const withComment = new Uint8Array(real.length + comment);
  withComment.set(real);
  new DataView(withComment.buffer).setUint16(real.length - 2, comment, true);
  assert.equal(declaredEntryCount(withComment), 1);
  assert.equal(Object.keys(readInvoiceArchives([{ name: 'a.zip', bytes: withComment }]).containers[0].entries).length, 1);
});

// ── 6 · the file picker while a zip is read ────────────────────────────────────────

test('6 · the picker is off and busy while a zip is read, and comes back on every way out', () => {
  const src = codeOf(read('js/orders/invoice-import-screen.js'));
  assert.match(src, /fileInput\.disabled = s\.reading;/);
  assert.match(src, /if \(s\.reading\) fileInput\.setAttribute\('aria-busy', 'true'\); else fileInput\.removeAttribute\('aria-busy'\);/);
  assert.match(src, /'aria-disabled': s\.reading \? 'true' : null/);
  const reader = src.slice(src.indexOf('async function readInvoices(files)'), src.indexOf('async function readInvoicesNow'));
  assert.match(reader, /try \{\s*await readInvoicesNow\(files\);\s*\} catch \(err\) \{[\s\S]*?invoicesUnreadable[\s\S]*?\} finally \{\s*s\.reading = false;\s*render\(\);\s*focusAfterRead\(\);/,
    'whatever throws, the message is the plain one and the picker is redrawn');
  const now = src.slice(src.indexOf('async function readInvoicesNow'), src.indexOf('// ── Step 2 of 3'));
  assert.doesNotMatch(now, /s\.reading = false/, 'only the finally resets it, AFTER the selection ran');
  assert.match(read('orders.css'), /\.invimp-file-input:disabled \+ \.invimp-file-btn \{/);
});

test('6 · after a read the focus goes to the result status line, else to the Next button, inside the dialog (P18)', () => {
  const src = codeOf(read('js/orders/invoice-import-screen.js'));
  const focus = src.slice(src.indexOf('function focusAfterRead'), src.indexOf('async function readInvoicesNow'));
  assert.match(focus, /\[data-fid="invimp-next"\]/);
  assert.match(focus, /\.orders-status\[tabindex\]/);
  assert.ok(focus.indexOf('.orders-status[tabindex]') < focus.indexOf('invimp-next'), 'the result line first, Next as the fallback');
  assert.match(focus, /\.focus\(/);
  assert.match(focus, /node\.querySelector/, 'looked up inside the dialog, never the page');
  assert.match(src, /'orders-status ok', role: 'status', tabindex: '-1'/);
  assert.match(src, /'orders-status error', role: 'alert', tabindex: '-1', text: s\.fileError/);
});

// ── 7 · the stored supplier name ───────────────────────────────────────────────────

test('7 · the remembered «skip this supplier» still stores the name as its label, and says why in a comment', () => {
  const src = read('js/orders/invoice-zip/selection.js');
  assert.match(src, /supplierSkips\.forEach\(\(s\) => setTo\(supplierDecisionKey\(s\.key\), DECISION_SKIP, s\.name\)\);/);
  assert.match(src, /PERSONAL DATA \(P13\)[\s\S]{0,500}«import again»/);
});

// ── review round 2 ──────────────────────────────────────────────────────────────

// Whole pack, not one item (a Cartone stores ONE item's weight beside its packCount).
const singolaFile = (over = {}) => rawIngredient({ weight: '10 kg', packCount: null, prices: [point({ pricePerUnit: 8, qty: 80 })], ...over });
const cartonFile = (over = {}) => rawIngredient({ weight: '1 kg', packCount: 10, prices: [point({ pricePerUnit: 8, qty: 80 })], ...over });

test('A · a file «10 kg» Singola against a card Cartone 10 × 1 kg is the same pack: the price stays 8 (update-price)', () => {
  const card = stored({ weight: '1 kg', packCount: 10 });
  const row = planOne(singolaFile(), ctxOf({ ingredients: [card] }));
  assert.equal(row.status, 'update-price');
  assert.equal(row.newPoints[0].pricePerUnit, 8, 'not 80');
  assert.equal(row.checkReason, undefined);
});

test('B · the same, when the invoice is older than the price in force (history-only): the history keeps 8', () => {
  const card = stored({ weight: '1 kg', packCount: 10 });
  const doc = { priceUnit: 'kg', pricePerUnit: 9, priceUpdatedAt: '2026-12-01T12:00:00.000Z' };
  const row = planOne(singolaFile(), ctxOf({ ingredients: [card], pricesById: { 'ing-1': doc } }));
  assert.equal(row.status, 'history-only');
  assert.equal(row.newPoints[0].pricePerUnit, 8, 'a wrong history point would be permanent');
});

test('C · a file Cartone 10 × 1 kg against a card Singola 10 kg is the same pack too: the price stays 8', () => {
  const card = stored({ weight: '10 kg' });
  const row = planOne(cartonFile(), ctxOf({ ingredients: [card] }));
  assert.equal(row.newPoints[0].pricePerUnit, 8, 'not 0.8');
});

test('A · a real difference in the TOTAL is still corrected, with the counts on both sides', () => {
  // file: 10 × 1 kg = 10 kg at 8 per kg; card: 10 × 2 kg = 20 kg: the sack is bigger, so the kilo is cheaper
  const row = planOne(cartonFile(), ctxOf({ ingredients: [stored({ weight: '2 kg', packCount: 10 })] }));
  assert.equal(row.newPoints[0].pricePerUnit, 4);
});

// A held row writes nothing, supplier-code patches included.
test('8 · a held row yields no batches, even when it would have taught the ingredient a new article code', () => {
  const doc = priceDoc();
  const jump = [point({ pricePerUnit: 1.5 })];
  const extra = planOne(rawIngredient({ mergeWith: 'Farina tipo 00', prices: jump }), ctxOf({
    ingredients: [stored({ supplierCode: 'OTHER-1', weight: '25 kg' })], pricesById: { 'ing-1': doc },
  }));
  assert.deepEqual(extra.setSupplierCodes, ['F00-25']);
  assert.equal(extra.checkReason, CHECK_REASONS.PRICE_JUMP);
  const noCode = planOne(rawIngredient({ mergeWith: 'Farina tipo 00', prices: jump }), ctxOf({
    ingredients: [stored({ supplierCode: '', weight: '25 kg' })], pricesById: { 'ing-1': doc },
  }));
  assert.equal(noCode.patchSupplierCode, 'F00-25');
  for (const row of [extra, noCode]) {
    const held = entryOf(row).row;
    assert.equal(held.held, true);
    assert.deepEqual(ingredientWrites(held, fileOf([rawIngredient({ prices: jump })]).ingredients[0], '2026-10-06T10:00:00Z', {}), []);
    const released = entryOf(row, { confirm: new Set([row.key]) }).row;
    assert.ok(ingredientWrites(released, fileOf([rawIngredient({ prices: jump })]).ingredients[0], '2026-10-06T10:00:00Z', {}).length > 0);
  }
});

test('3 · the held row still carries the row it would be, for the old-price comparison on screen', () => {
  const row = withStoredPrice(rawIngredient({ prices: [point({ pricePerUnit: 1.5 })] }), priceDoc());
  const held = entryOf(row).row;
  assert.equal(held.status, 'skipped');
  assert.equal(held.heldRow.status, 'update-price');
  assert.equal(held.heldRow.newPoints[0].pricePerUnit, 1.5);
  const src = codeOf(read('js/orders/invoice-import-screen.js'));
  assert.match(src, /const effective = row && row\.heldRow \? row\.heldRow : row;/);
});

test('4 · the unreadable-weight sentence says the price below uses the invoice weight', () => {
  assert.equal(DICT.en['invoiceImport.check.weightUnreadable'],
    'The pack weight saved in Mise cannot be read: the price per kilo or litre below uses the weight on the invoice. Check it.');
  assert.equal(DICT.it['invoiceImport.check.weightUnreadable'],
    'Il peso della confezione salvato in Mise non si legge: il prezzo al chilo o al litro qui sotto usa il peso scritto in fattura. Controllalo.');
});

test('7 · a NEW row with the older-invoice reason says it WILL BE CREATED', () => {
  assert.equal(DICT.en['invoiceImport.check.olderInvoiceNew'],
    'It will be created with the price of the invoice of {date}: the most recent one needs checking.');
  assert.equal(DICT.it['invoiceImport.check.olderInvoiceNew'],
    'Verrà creato con il prezzo della fattura del {date}: la più recente è da verificare.');
  const src = codeOf(read('js/orders/invoice-import-screen.js'));
  assert.match(src, /row\.status === 'new'\) return t\('invoiceImport\.check\.olderInvoiceNew'/);
  assert.match(src, /checkText\(row, planned\)/);
});

test('9 · the owner needs a STRICT MAJORITY of the invoices that name a buyer', () => {
  const buyers = (...list) => list.map(buyerVat => ({ buyerVat }));
  assert.equal(ownerVatOf(buyers('A', 'A', 'B')), 'A');
  assert.equal(ownerVatOf(buyers('A', 'A', 'B', 'C')), '', 'the top buyer, but 2 of 4 is not a majority');
  assert.equal(ownerVatOf(buyers('B', 'B', 'B', 'A', 'A', 'C', 'C')), '', 'two venues in one zip: nothing is skipped');
  assert.equal(ownerVatOf([...buyers('A', 'A'), { buyerVat: '' }, {}]), 'A', 'invoices that name no buyer do not count');
  const c = newCase();
  c.add([LINE], { buyerVat: '00000000098', vat: '00000000001', date: '2026-09-01' });
  c.add([LINE], { buyerVat: '00000000098', vat: '00000000002', name: 'ALTRO FORNITORE', date: '2026-09-02' });
  c.add([LINE], { buyerVat: '00000000097', vat: '00000000003', name: 'TERZO FORNITORE', date: '2026-09-03' });
  c.add([LINE], { buyerVat: '00000000096', vat: '00000000098', name: 'VENDITORE', date: '2026-09-04' });
  const load = c.load();
  assert.equal(load.salesSkipped, 0, 'B is the top buyer with 2 of 4, so nothing is dropped');
  assert.equal(load.documents.length, 4);
});

test('10 · the confirm select comes AFTER the «same as» question and has its own label', () => {
  const src = codeOf(read('js/orders/invoice-import-screen.js'));
  const row = src.slice(src.indexOf('function ingredientRow'), src.indexOf('function drawIngredients'));
  assert.ok(row.indexOf('invimp-ing-') < row.indexOf('invimp-confirm-'), 'question first, then «This price?»');
  assert.match(row, /choice\(`invimp-confirm-\$\{index\}`, t\('invoiceImport\.ing\.confirm\.label'\)/);
  assert.equal(DICT.en['invoiceImport.ing.confirm.label'], 'This price?');
  assert.equal(DICT.it['invoiceImport.ing.confirm.label'], 'Questo prezzo?');
});

test('11 · a «do not import» answer on a priceCheck row keeps the Skipped pill', () => {
  const src = codeOf(read('js/orders/invoice-import-screen.js'));
  assert.match(src, /bucketOf\(entry\) === 'check'\s*&& \(\['new', 'unchanged'\]\.includes\(row\.status\) \|\| row\.held === true \|\| needsConfirmation\(row\) \|\| Boolean\(row\.invoiceRename\)\)/);
});

// ── review round 3: a factor other than 1 is never applied silently ──────────────────

const cartonOnInvoice = () => rawIngredient({ weight: '1 kg', packCount: 10, prices: [point({ pricePerUnit: 8, qty: 80 })] });
const FILE_ING = () => fileOf([cartonOnInvoice()]).ingredients[0];
const NOW = '2026-10-06T10:00:00Z';

function assertHeldUntilConfirmed(row, { rescaledPrice, stored, file }) {
  assert.equal(row.checkReason, CHECK_REASONS.WEIGHT_RESCALED);
  assert.equal(row.checkStored, stored);
  assert.equal(row.checkFile, file);
  const held = entryOf(row);
  assert.equal(bucketOf(held), 'check');
  assert.equal(held.row.held, true);
  assert.equal(importTotals([held]).rows, 0);
  assert.deepEqual(ingredientWrites(held.row, FILE_ING(), NOW, {}), [], 'nothing is written while it is held');
  assert.equal(held.row.heldRow.newPoints[0].pricePerUnit, rescaledPrice, 'the held comparison is the rescaled price');
  const confirmed = entryOf(row, { confirm: new Set([row.key]) });
  assert.equal(confirmed.row.held, undefined);
  assert.equal(confirmed.row.newPoints[0].pricePerUnit, rescaledPrice);
  assert.ok(ingredientWrites(confirmed.row, FILE_ING(), NOW, {}).length > 0);
}

test('R1 · a Singola card against an invoice «10 × 1 kg»: 80, never silently — no price in force (update-price)', () => {
  const row = planOne(cartonOnInvoice(), ctxOf({ ingredients: [stored({ weight: '1 kg' })] }));
  assert.equal(row.status, 'update-price');
  assertHeldUntilConfirmed(row, { rescaledPrice: 80, stored: '1 kg', file: '10 × 1 kg' });
});

test('R2 · the same with a stored price in ANOTHER unit (history-only)', () => {
  const doc = { priceUnit: 'pcs', pricePerUnit: 3, unitWeightKg: 1, priceUpdatedAt: '2026-01-01T12:00:00.000Z' };
  const row = planOne(cartonOnInvoice(), ctxOf({ ingredients: [stored({ weight: '1 kg' })], pricesById: { 'ing-1': doc } }));
  assert.equal(row.status, 'history-only');
  assertHeldUntilConfirmed(row, { rescaledPrice: 80, stored: '1 kg', file: '10 × 1 kg' });
});

test('R3 · the same with a stored price NEWER than the invoice (history-only)', () => {
  const doc = priceDoc({ priceUpdatedAt: '2026-12-01T12:00:00.000Z' });
  const row = planOne(cartonOnInvoice(), ctxOf({ ingredients: [stored({ weight: '1 kg' })], pricesById: { 'ing-1': doc } }));
  assert.equal(row.status, 'history-only');
  assertHeldUntilConfirmed(row, { rescaledPrice: 80, stored: '1 kg', file: '10 × 1 kg' });
});

test('R4 · the mirror: a Cartone 10 × 1 kg card against an invoice for one 1 kg item: 0.8, held', () => {
  const single = rawIngredient({ weight: '1 kg', packCount: null, prices: [point({ pricePerUnit: 8, qty: 8 })] });
  const row = planOne(single, ctxOf({ ingredients: [stored({ weight: '1 kg', packCount: 10 })] }));
  assert.equal(row.status, 'update-price');
  assert.equal(row.checkReason, CHECK_REASONS.WEIGHT_RESCALED);
  assert.equal(row.checkStored, '10 × 1 kg');
  assert.equal(row.checkFile, '1 kg');
  assert.equal(entryOf(row).row.heldRow.newPoints[0].pricePerUnit, 0.8);
  assert.equal(entryOf(row).row.held, true);
  assert.equal(entryOf(row, { confirm: new Set([row.key]) }).row.newPoints[0].pricePerUnit, 0.8);
});

test('R5 · priority: unreadable weight, then rescaled, then price jump, then older invoice', () => {
  const doc = priceDoc();
  const both = planOne(rawIngredient({ prices: [point({ pricePerUnit: 3 })], latestUnverified: true }),
    ctxOf({ ingredients: [stored({ weight: '20 kg' })], pricesById: { 'ing-1': doc } }));
  assert.equal(both.checkReason, CHECK_REASONS.WEIGHT_RESCALED, 'rescaled beats a jump and an older invoice');
  const unreadable = planOne(rawIngredient({ prices: [point({ pricePerUnit: 3 })] }),
    ctxOf({ ingredients: [stored({ weight: 'sacco' })], pricesById: { 'ing-1': doc } }));
  assert.equal(unreadable.checkReason, CHECK_REASONS.WEIGHT_UNREADABLE);
});

test('R6 · the rescaled sentence names both packs, in English and Italian, and the screen passes them', () => {
  assert.equal(DICT.en['invoiceImport.check.weightRescaled'],
    'Price worked out with the pack saved in Mise ({stored}) instead of the one on the invoice ({file}). Check it.');
  assert.equal(DICT.it['invoiceImport.check.weightRescaled'],
    'Prezzo calcolato con la confezione salvata in Mise ({stored}) invece di quella in fattura ({file}). Controllalo.');
  const src = codeOf(read('js/orders/invoice-import-screen.js'));
  assert.match(src, /t\('invoiceImport\.check\.weightRescaled', \{ stored: row\.checkStored, file: row\.checkFile \}\)/);
});

test('R7 · a new row answered «do not import» does not say it will be created', () => {
  const src = codeOf(read('js/orders/invoice-import-screen.js'));
  assert.doesNotMatch(src, /planned && planned\.status === 'new'\) return t\('invoiceImport\.check\.olderInvoiceNew'/);
  assert.match(src, /if \(row\.status === 'new'\) return t\('invoiceImport\.check\.olderInvoiceNew'/, 'the row\'s CURRENT status decides');
});

// ── review round 4: the price shown and the confirmation follow the ANSWER ───────────

test('S1 · «Same as A» on a code-ambiguous question: the row shown and held carries the rescaled 80, not the file\'s 8', () => {
  const ingredients = [stored({ weight: '1 kg' }), stored({ id: 'ing-2', name: 'Burro doppio', weight: '10 kg' })];
  const ctx = ctxOf({ ingredients });
  const asked = planOne(cartonOnInvoice(), ctx);
  assert.equal(asked.status, 'maybe-duplicate');
  assert.equal(asked.allPoints[0].pricePerUnit, 8, 'the question row itself is not re-read');
  const entry = applyDecisions([asked], { [asked.key]: { sameAs: 'ing-1' } }, ctx, new Set(), new Set())[0];
  assert.equal(entry.row.held, true);
  assert.equal(entry.row.checkReason, CHECK_REASONS.WEIGHT_RESCALED);
  assert.equal(entry.row.allPoints[0].pricePerUnit, 80, 'what the screen shows comes from here (heldRow / row.allPoints)');
  assert.equal(entry.row.heldRow.allPoints[0].pricePerUnit, 80);
  assert.equal(entry.planned.allPoints[0].pricePerUnit, 8);
});

test('S2 · the same on the «choose» path (a «unisci con» name that matches nothing)', () => {
  const ctx = ctxOf({ ingredients: [stored({ weight: '1 kg' })] });
  const asked = planOne({ ...cartonOnInvoice(), mergeWith: 'Nome che non esiste' }, ctx);
  assert.equal(asked.status, 'choose');
  const entry = applyDecisions([asked], { [asked.key]: { sameAs: 'ing-1' } }, ctx, new Set(), new Set())[0];
  assert.equal(entry.row.heldRow.allPoints[0].pricePerUnit, 80);
  assert.equal(entry.row.allPoints[0].pricePerUnit, 80);
});

test('S3 · the screen takes the shown price from the effective row, with the planned row as the fallback', () => {
  const src = codeOf(read('js/orders/invoice-import-screen.js'));
  const fn = src.slice(src.indexOf('function priceText'), src.indexOf('function ingredientRow'));
  assert.match(fn, /const effective = row && row\.heldRow \? row\.heldRow : row;\s*const points = \(effective && effective\.allPoints && effective\.allPoints\.length > 0\) \? effective\.allPoints : planned\.allPoints;/);
  assert.doesNotMatch(fn, /const last = planned\.allPoints/);
});

test('S4 · a new answer clears the «Use this price» of the row, so a confirmation never reaches another price', () => {
  const src = codeOf(read('js/orders/invoice-import-screen.js'));
  const question = src.slice(src.indexOf("choice(`invimp-ing-"), src.indexOf('A matched row whose price needs a look') > 0 ? src.indexOf('A matched row whose price') : undefined);
  assert.match(src, /\(picked\) => \{\s*s\.confirmKeys\.delete\(planned\.key\);\s*s\.renames\.delete\(planned\.key\);\s*if \(!picked\)/);
  assert.match(src, /\(picked\) => \{\s*s\.confirmKeys\.delete\(planned\.key\);\s*s\.renames\.delete\(planned\.key\);\s*if \(picked === 'forget'\)/);
  assert.ok(question.length > 0);
  // and the model agrees: answering the other ingredient gives another price, which was never confirmed
  const ingredients = [stored({ weight: '1 kg' }), stored({ id: 'ing-2', name: 'Burro doppio', weight: '10 kg' })];
  const ctx = ctxOf({ ingredients });
  const asked = planOne(cartonOnInvoice(), ctx);
  const confirmed = new Set([asked.key]);
  const a = applyDecisions([asked], { [asked.key]: { sameAs: 'ing-1' } }, ctx, new Set(), confirmed)[0].row;
  assert.equal(a.newPoints[0].pricePerUnit, 80);
  confirmed.delete(asked.key);
  const b = applyDecisions([asked], { [asked.key]: { sameAs: 'ing-2' } }, ctx, new Set(), confirmed)[0].row;
  assert.equal(b.status, 'update-price', 'the other ingredient is the same pack: 10 kg = 10 x 1 kg');
  assert.equal(b.checkReason, undefined);
  assert.equal(b.newPoints[0].pricePerUnit, 8, 'another answer, another price');
});
