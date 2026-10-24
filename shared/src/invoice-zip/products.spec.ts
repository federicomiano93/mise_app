// Unit tests for the grouping of invoice lines into products and the proposals made for each (P15), run against BOTH
// implementations: the TypeScript port in shared/ and js/orders/invoice-zip/products.js. The module is a FULL port, so
// parity.spec.ts also compares its exports.
//
// PORTED: products.js has no test file of its own. Its behaviour is pinned by the 32 price tests of
// tests/invoice-zip-pricing.test.mjs (now in pricing.spec.ts, which reads every price through `evaluate`,
// `makeConfig`, `proposeParams`, `typeOf` and `vatOf`) and by the parsing and build tests (fatturapa.spec.ts, the
// build spec in the app). Everything below is ADDED here, so that each export is exercised on its own: the cell
// round trip (`paramsFromCells`, `unitCell`), the proposals (`proposeName`, `proposePackWord`), the configuration
// (`makeConfig`), the catalogue (`buildCatalogue`) and the accessors. Each test runs against both files.

import { describe, expect, test } from 'vitest';
import { implementations } from './testing/implementations';
import { makeCase } from './testing/invoice-builders';
import type { InvoiceCase, LineSpec } from './testing/invoice-builders';

const FLOUR: LineSpec = { desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00-25', qty: 25, unit: 'KG', total: 14.25 };

describe.each(implementations)('%s', (_name, impl) => {
  const p = impl.products;
  const newCase = (): InvoiceCase => makeCase(impl.caseImpl);

  test('the constants', () => {
    expect(p.DEFAULT_EGG_WEIGHT_G).toBe(50);
    expect(p.EGG_PACK_WORD).toBe('uovo');
    expect(p.NO_SDI_REASON).toBe('no-sdi-id');
    expect(p.TYPE_ORDER).toStrictEqual({ ingrediente: 0, packaging: 1, rivendita: 2 });
  });

  test('makeConfig: the egg weight must be a positive number, supplier keys are normalised', () => {
    expect(p.makeConfig().eggWeightG).toBe(50);
    expect(p.makeConfig({ eggWeightG: 60 }).eggWeightG).toBe(60);
    expect(p.makeConfig({ eggWeightG: Infinity }).eggWeightG).toBe(50);
    expect(p.makeConfig({ excludedSuppliers: { 'it 00000000099': 'utenze', ' x y ': 5 } }).excludedSuppliers)
      .toStrictEqual({ IT00000000099: 'utenze', XY: '5' });
    expect(p.makeConfig({ excludedSuppliers: null }).excludedSuppliers).toStrictEqual({});
  });

  test('unitCell writes the price unit as the cell holds it', () => {
    expect([p.unitCell('pcs'), p.unitCell('kg'), p.unitCell('l'), p.unitCell(null)]).toStrictEqual(['pz', 'kg', 'l', '']);
  });

  test('paramsFromCells: every spelling of the unit, the weight and the count', () => {
    const proposal = { egg: false, eggWeightKg: 0.05 };
    for (const [cell, unit] of [['kg', 'kg'], ['KG', 'kg'], ['lt', 'l'], ['Litri', 'l'], ['pz', 'pcs'], ['pezzi', 'pcs']]) {
      expect(p.paramsFromCells(cell, '', '', proposal).params.priceUnit, String(cell)).toBe(unit);
    }
    const full = p.paramsFromCells('kg', '2,5 kg', '4', proposal);
    expect(full.problems).toStrictEqual([]);
    expect(full.params.priceUnit).toBe('kg');
    expect(full.params.pack).toMatchObject({ size: 2.5, unit: 'kg' });
    expect(full.params.packCount).toBe(4);
    expect(p.paramsFromCells('pz', '', 1, proposal).params.packCount).toBe(null);
    expect(p.paramsFromCells(null, undefined, null, proposal)).toStrictEqual(
      { params: { priceUnit: null, pack: null, packCount: null, egg: false, eggWeightKg: 0.05 }, problems: [] });
    expect(p.paramsFromCells('kg', '', '', { egg: true, eggWeightKg: 0.06 }).params).toMatchObject({ egg: true, eggWeightKg: 0.06 });
  });

  test('paramsFromCells: what cannot be read is reported, never guessed', () => {
    const proposal = { egg: false, eggWeightKg: 0.05 };
    expect(p.paramsFromCells('boxes', '', '', proposal).problems).toStrictEqual(['price-unit-unreadable']);
    expect(p.paramsFromCells('kg', 'heavy', '', proposal).problems).toStrictEqual(['pack-weight-unreadable']);
    for (const bad of ['0', '-2', '2.5', 'many']) {
      expect(p.paramsFromCells('kg', '', bad, proposal).problems, bad).toStrictEqual(['pack-count-unreadable']);
    }
    expect(p.paramsFromCells('boxes', 'heavy', 'many', proposal).problems)
      .toStrictEqual(['price-unit-unreadable', 'pack-weight-unreadable', 'pack-count-unreadable']);
  });

  test('evaluate: a problem in the cells makes the whole product «da verificare» with those reasons', () => {
    const c = newCase();
    c.add([FLOUR]);
    const [catalogue, product] = c.onlyProduct();
    const ev = p.evaluate(product, p.proposeParams(product, catalogue.config), catalogue, ['price-unit-unreadable', 'pack-count-unreadable']);
    expect([ev.reliability, ev.note]).toStrictEqual(['da verificare', 'price-unit-unreadable; pack-count-unreadable']);
    expect(ev.points.length).toBe(1);
  });

  test('the proposals: the name loses the size and the pack word; sacks are «sacco»; eggs are «uovo»', () => {
    const c = newCase();
    c.add([FLOUR]);
    const [, flour] = c.onlyProduct();
    expect(p.proposeName(flour)).toBe('Farina tipo 00');
    expect(p.proposePackWord(flour)).toBe('sacco');
    expect(p.descriptionOf(flour)).toBe('FARINA TIPO 00 SACCO KG 25');
    expect(p.typeOf(flour)).toBe('ingrediente');
    expect(p.latestOf(flour).lines.length).toBe(1);

    const eggs = newCase();
    eggs.add([{ desc: 'UOVA FRESCHE DA 30 UOVA', qty: 2, unit: 'CT', total: 36 }]);
    const [, tray] = eggs.onlyProduct();
    expect(p.proposePackWord(tray)).toBe('uovo');
  });

  test('buildCatalogue: the newest invoice decides the description, and the entries run oldest first', () => {
    const c = newCase();
    c.add([{ ...FLOUR, desc: 'FARINA 00 NUOVA KG 25' }], { date: '2026-09-10' });
    c.add([FLOUR], { date: '2026-09-01' });
    const [, product] = c.onlyProduct();
    expect(product.entries.map((e) => e.doc.date)).toStrictEqual(['2026-09-01', '2026-09-10']);
    expect(p.latestOf(product).doc.date).toBe('2026-09-10');
    expect(p.descriptionOf(product)).toBe('FARINA 00 NUOVA KG 25');
    expect(product.code).toBe('F00-25');
  });

  test('buildCatalogue: a line that is not goods is listed with its reason, a document with its detail', () => {
    const c = newCase();
    c.add([FLOUR, { desc: 'SPESE DI TRASPORTO', qty: 1, total: 4 }], { number: '5' });
    c.add([FLOUR], { docType: 'TD04', date: '2026-09-02', number: '6' });
    const catalogue = c.catalogue();
    expect(catalogue.excluded.map((e) => [e.level, e.reason, e.detail, e.number]).sort()).toStrictEqual([
      ['document', 'document-type', 'TD04', '6'],
      ['line', 'costs', '', '5'],
    ]);
    expect([...catalogue.docStatus.values()].map((s) => s.status).sort()).toStrictEqual(['excluded', 'included']);
    expect(catalogue.discountDocs.size).toBe(0);
  });
});
