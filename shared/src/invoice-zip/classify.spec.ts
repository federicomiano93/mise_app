// Unit tests for the invoice line classifier (P15), run against BOTH implementations: the TypeScript port in
// shared/ and js/orders/invoice-zip/classify.js, which the live app uses today. Ported test for test from
// tests/invoice-zip-classify.test.mjs (itself a port of invoice-import/tests/test_classify.py); the two must stay
// equal until the switch to Mise 2. The module is a FULL port, so parity.spec.ts also compares its exports.
//
// PORTED: 23 of 23 tests of tests/invoice-zip-classify.test.mjs. Added: the «Nome in fattura» (invoiceNameOf).
// The keyword lists themselves are pinned against invoice-import/classify.py by keywords.spec.ts.

import { describe, expect, test } from 'vitest';
import * as ported from './classify';
import * as legacyJs from '../../../js/orders/invoice-zip/classify.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const checkPack = (description: string, size: number, unit: ported.PackUnit, count: number | null = null): void => {
    expect(m.parsePack(description), description).toStrictEqual(m.packInfo(size, unit, count));
  };

  test('pack parsing: unit first, size times count', () => {
    checkPack('ML10X102 OLIO EVO MONODOSE', 10, 'ml', 102);
    checkPack('GR25X40 ZUCCHERO BUSTINE', 25, 'g', 40);
    checkPack('KG1X10 FARINA', 1, 'kg', 10);
    checkPack('CL 5 X 24 SCIROPPO', 50, 'ml', 24);
    checkPack('LT 1,5 x 6 ACETO', 1.5, 'l', 6);
  });

  test('pack parsing: a fraction of a unit is not its denominator', () => {
    checkPack('BRESAOLA STELLA 1/2KG', 0.5, 'kg');
    checkPack('SALAME 1/4 KG', 0.25, 'kg');
    checkPack('FARINA KG 25', 25, 'kg');
    expect(m.parsePack('BOH 1/0 KG'), 'a zero denominator does not crash (Python raised)')
      .toStrictEqual(m.packInfo(0, 'kg', null));
  });

  test('pack parsing: the unit does not match inside a word', () => {
    expect(m.parsePack('BUSTE ML')).toBe(null);
    expect(m.parsePack('DOLCE5X3')).toBe(null);
  });

  test('pack parsing: the prototype patterns', () => {
    checkPack('PASTA 2,5kg* 4pz', 2.5, 'kg', 4);
    checkPack('PASTA 85gr* 50pz', 85, 'g', 50);
    checkPack('PASTA PZ.50 GR.85', 85, 'g', 50);
    checkPack('BISCOTTI gr.70x6', 70, 'g', 6);
    checkPack('ZUCCHERO KG 25', 25, 'kg');
    checkPack('SEMOLA 2,5KG', 2.5, 'kg');
    checkPack('LIEVITO GR.250', 250, 'g');
    checkPack('SALE G.1000', 1000, 'g');
    checkPack('SALE GR 250', 250, 'g');
    checkPack('MANDORLE 500 g', 500, 'g');
    checkPack('OLIO LT 1', 1, 'l');
    checkPack('ACETO 1L', 1, 'l');
    checkPack('SCIROPPO ML 500', 500, 'ml');
  });

  test('pack parsing: the newer patterns', () => {
    checkPack('PASSATA kg 2,5 x 4', 2.5, 'kg', 4);
    checkPack('PASSATA KG.2,5X4', 2.5, 'kg', 4);
    checkPack('CAFFE GRANI 1kgx6', 1, 'kg', 6);
    checkPack('CAPSULE 7gx80', 7, 'g', 80);
    checkPack('POLVERE G 570 (X12PZ)', 570, 'g', 12);
    expect(m.parsePack('VITAMINA G 5')).toBe(null);
  });

  test('pack parsing: no size in the description', () => {
    expect(m.parsePack('BUSTE CARTA')).toBe(null);
    expect(m.parsePack('')).toBe(null);
  });

  test('pack parsing: an accented letter next to a unit is part of a word, as in Python', () => {
    // Python's \b treats «À» as a word character: «5GÀ» is not «5 G», «KGÈ 25» is not «KG 25».
    expect(m.parsePack('PASTA 5GÀ')).toBe(null);
    expect(m.parsePack('XKGÈ 25')).toBe(null);
    checkPack('PASTA 5G À', 5, 'g');
  });

  test('pack size formatting is dot decimal and has no trailing zeros', () => {
    expect(m.formatPackSize(2.5, 'kg')).toBe('2.5 kg');
    expect(m.formatPackSize(25.0, 'kg')).toBe('25 kg');
    expect(m.formatPackSize(250, 'g')).toBe('250 g');
  });

  test('typed weights', () => {
    expect(m.parsePackText('2,5 kg')).toStrictEqual([2.5, 'kg']);
    expect(m.parsePackText('250g')).toStrictEqual([250, 'g']);
    expect(m.parsePackText('1 l')).toStrictEqual([1, 'l']);
    expect(m.parsePackText('500 ML')).toStrictEqual([500, 'ml']);
    expect(m.parsePackText('un sacco')).toBe(null);
    expect(m.parsePackText('0 kg')).toBe(null);
    expect(m.parsePackText('')).toBe(null);
  });

  test('eggs: the count in the description', () => {
    expect(m.isEgg('UOVA FRESCHE DA 30 UOVA')).toBe(true);
    expect(m.eggsPerPack('UOVA FRESCHE DA 30 UOVA')).toBe(30);
    expect(m.eggsPerPack('30 UOVA CAT. M')).toBe(30);
    expect(m.eggsPerPack('UOVA CAT. M X30')).toBe(30);
    expect(m.eggsPerPack('UOVA CAT. M')).toBe(null);
    expect(m.isEgg('PASTA FRESCA')).toBe(false);
  });

  test('eggs: trays of trays are multiplied, the plain ways still work', () => {
    expect(m.eggsPerPack('UOVA 6 X 10 UOVA')).toBe(60);
    expect(m.eggsPerPack('UOVA CAT. M 6x10 UOVA')).toBe(60);
    expect(m.eggsPerPack('UOVA 2 * 15 UOVA')).toBe(30);
    expect(m.eggsPerPack('UOVA FRESCHE DA 30 UOVA')).toBe(30);
    expect(m.eggsPerPack('UOVA CAT. M X30')).toBe(30);
    expect(m.eggsPerPack('30 UOVA CAT. M')).toBe(30);
    expect(m.eggsPerPack('UOVA CAT. M')).toBe(null);
  });

  const kind = (description: string, qty = 1.0, total = 5.0) => m.classify(description, qty, total);

  test('classify: sugar in sacks is an ingredient, not packaging', () => {
    expect(kind('ZUCCHERO SACCHI DA KG 25')).toStrictEqual(['ingrediente', '']);
  });

  test('classify: real packaging still is packaging', () => {
    expect(kind('SACCHETTI CARTA PANE')[0]).toBe('packaging');
    expect(kind('BUSTE PLASTICA')[0]).toBe('packaging');
    expect(kind('CARTA FORNO')[0]).toBe('packaging');
  });

  test('classify: beverages and ready-made are resale', () => {
    expect(kind('ACQUA NATURALE 50 CL')[0]).toBe('rivendita');
    expect(kind('COCA COLA LATTINA')[0]).toBe('rivendita');
    expect(kind('CORNETTO ALLA CREMA')[0]).toBe('rivendita');
    expect(kind('FECOLA DI PATATE')[0]).toBe('ingrediente');
  });

  // Mirrored word for word in invoice-import/tests/test_classify.py.
  test('classify: bar, shelf and non-food goods are not ingredients', () => {
    for (const text of ['YOG. GR.125X2 FRAGOLA', 'KEFIR GR.150 FRAGOLA', 'DOLCIFICANTE PZ.150',
      'CAPS BAR DECAFF 7GX80', "CAFFE'CIALDEX15 ESEMPIO"]) {
      expect(kind(text)[0], text).toBe('rivendita');
    }
    for (const text of ['ROT. ALLUMINIO KG 1 CM. 33', 'SET GREMBIULE PASTICCERIA', 'PALETTE BAMBOO 50X200',
      '500 COPRIVASSOI 18X24', '100 CARTE PIZZO D35', 'SHOPPER BIO 35X10X65',
      'BORSA SPESA 45X37', 'ECO BAGS ROSSO SMALL', 'CARAFFA GRADUATA 2 LT',
      'COPPETTA CONICA CM 20', 'L2 ANTICALCARE ESEMPIO', 'DETERSIVO PAVIMENTI 5 L',
      'PENNELLO 60MM', 'ASCIUGAMANI RIPIEGATI', 'PADEL ALLUMINIO 24CM', 'GUANTI NITRILE M']) {
      expect(kind(text)[0], text).toBe('packaging');
    }
    // Food words still win, and a word inside another word is not the keyword.
    for (const text of ['OLIO EVO ML10X102', 'ZUCCHERO BUSTINA 4G', 'PAN DI SPUGNA KG 1', 'PEPERONI CAPSICUM']) {
      expect(kind(text)[0], text).toBe('ingrediente');
    }
  });

  test('classify: a food word glued to an accented letter is a different word, as in Python', () => {
    expect(kind('SALÈ BUSTE')[0]).toBe('packaging'); // «salè» is not the food word «sale»
    expect(kind('SALE GROSSO')[0]).toBe('ingrediente');
    expect(kind('ACQUÀ MINERALE')[0]).toBe('ingrediente'); // «acquà» is not «acqua»: not resale
    expect(kind('MANDORLE PELATE')[0]).toBe('ingrediente');
  });

  test('classify: noise and costs are excluded', () => {
    expect(m.classify('LOTTO 12345', null, null)).toStrictEqual(['excluded', 'info-line']);
    expect(m.classify('', 1, 5)).toStrictEqual(['excluded', 'info-line']);
    expect(m.classify('OFFERTA SPECIALE', 1, 5)).toStrictEqual(['excluded', 'info-line']);
    expect(m.classify('DESCRIZIONE QUALSIASI', 0, 0)).toStrictEqual(['excluded', 'info-line']);
    expect(m.classify('SPESE DI TRASPORTO', 1, 5)).toStrictEqual(['excluded', 'costs']);
    expect(m.classify('INCASSO CONTRASSEGNO', 1, 5)).toStrictEqual(['excluded', 'costs']);
  });

  test('classify: a discount line without a product', () => {
    expect(m.isUnattributedDiscount('SCONTO COMMERCIALE', null, -3.0)).toBe(true);
    expect(m.isUnattributedDiscount('QUALCOSA', null, -3.0)).toBe(true);
    expect(m.isUnattributedDiscount('FARINA', 5, -3.0)).toBe(false);
    expect(m.isUnattributedDiscount('FARINA', null, 3.0)).toBe(false);
    expect(m.isUnattributedDiscount('SCONTO SU FARINA', 5, -3.0)).toBe(true);
  });

  test('the normalised name', () => {
    expect(m.normaliseName('*Crème  brûlée {LOTTO 55 SCAD. 01/27}')).toBe('creme brulee');
    expect(m.normaliseName('FARINA T.00 / KG-25')).toBe('farina t 00 kg 25');
    expect(m.normaliseName('Perché è così_così')).toBe('perche e cosi cosi');
  });

  test('the key prefers the article code', () => {
    expect(m.productKey('IT1', 'F00-25', 'FARINA')).toBe('IT1|code:F00-25');
    expect(m.productKey('IT1', ' ', 'Farina {x}')).toBe('IT1|name:farina');
  });

  test('lot text does not change the key', () => {
    expect(m.productKey('IT1', '', 'BURRO {LOTTO 1}')).toBe(m.productKey('IT1', '', 'BURRO {LOTTO 2}'));
  });

  test('the proposed name', () => {
    expect(m.cleanName('ZUCCHERO SACCHI DA KG 25')).toBe('Zucchero');
    expect(m.cleanName('FARINA TIPO 00 SACCO KG 25', 'F00-25')).toBe('Farina tipo 00');
    expect(m.cleanName('*PASSATA 2,5kg* 4pz {LOTTO 7}')).toBe('Passata');
    expect(m.cleanName('OLIO EXTRA VERGINE LT 5')).toBe('Olio extra vergine');
    expect(m.cleanName('KG 25')).toBe('Kg 25');
    expect(m.cleanName('FARINA TIPO 00 F00-25 SACCO KG 25', 'F00-25')).toBe('Farina tipo 00');
    expect(m.cleanName('ÈLITE PASTA')).toBe('Èlite pasta');
  });

  test('the pack word', () => {
    expect(m.packWord('ZUCCHERO SACCHI DA KG 25')).toBe('sacco');
    expect(m.packWord('PASSATA BUSTE')).toBe('busta');
    expect(m.packWord('OLIO LATTA LT 5')).toBe('latta');
    expect(m.packWord('LATTE INTERO')).toBe('');
    expect(m.packWord('FARINA')).toBe('');
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('the name on the invoice keeps case and punctuation, losing only the lot blocks and extra spaces', () => {
    expect(m.invoiceNameOf('  Farina  T.00 {LOTTO 5}  KG 25 ')).toBe('Farina T.00 KG 25');
    expect(m.invoiceNameOf(null)).toBe('');
    expect(m.invoiceNameOf(undefined)).toBe('');
  });
});
