// Port of invoice-import/tests/test_classify.py (+ the egg-count part of test_review_fixes.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, cleanName, eggsPerPack, formatPackSize, isEgg, isUnattributedDiscount, normaliseName, packInfo, packWord,
  parsePack, parsePackText, productKey,
} from '../js/orders/invoice-zip/classify.js';

const checkPack = (description, size, unit, count = null) => {
  assert.deepEqual(parsePack(description), packInfo(size, unit, count), description);
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
  assert.deepEqual(parsePack('BOH 1/0 KG'), packInfo(0, 'kg', null), 'a zero denominator does not crash (Python raised)');
});

test('pack parsing: the unit does not match inside a word', () => {
  assert.equal(parsePack('BUSTE ML'), null);
  assert.equal(parsePack('DOLCE5X3'), null);
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
  assert.equal(parsePack('VITAMINA G 5'), null);
});

test('pack parsing: no size in the description', () => {
  assert.equal(parsePack('BUSTE CARTA'), null);
  assert.equal(parsePack(''), null);
});

test('pack parsing: an accented letter next to a unit is part of a word, as in Python', () => {
  // Python's \b treats «À» as a word character: «5GÀ» is not «5 G», «KGÈ 25» is not «KG 25».
  assert.equal(parsePack('PASTA 5GÀ'), null);
  assert.equal(parsePack('XKGÈ 25'), null);
  checkPack('PASTA 5G À', 5, 'g');
});

test('pack size formatting is dot decimal and has no trailing zeros', () => {
  assert.equal(formatPackSize(2.5, 'kg'), '2.5 kg');
  assert.equal(formatPackSize(25.0, 'kg'), '25 kg');
  assert.equal(formatPackSize(250, 'g'), '250 g');
});

test('typed weights', () => {
  assert.deepEqual(parsePackText('2,5 kg'), [2.5, 'kg']);
  assert.deepEqual(parsePackText('250g'), [250, 'g']);
  assert.deepEqual(parsePackText('1 l'), [1, 'l']);
  assert.deepEqual(parsePackText('500 ML'), [500, 'ml']);
  assert.equal(parsePackText('un sacco'), null);
  assert.equal(parsePackText('0 kg'), null);
  assert.equal(parsePackText(''), null);
});

test('eggs: the count in the description', () => {
  assert.ok(isEgg('UOVA FRESCHE DA 30 UOVA'));
  assert.equal(eggsPerPack('UOVA FRESCHE DA 30 UOVA'), 30);
  assert.equal(eggsPerPack('30 UOVA CAT. M'), 30);
  assert.equal(eggsPerPack('UOVA CAT. M X30'), 30);
  assert.equal(eggsPerPack('UOVA CAT. M'), null);
  assert.ok(!isEgg('PASTA FRESCA'));
});

test('eggs: trays of trays are multiplied, the plain ways still work', () => {
  assert.equal(eggsPerPack('UOVA 6 X 10 UOVA'), 60);
  assert.equal(eggsPerPack('UOVA CAT. M 6x10 UOVA'), 60);
  assert.equal(eggsPerPack('UOVA 2 * 15 UOVA'), 30);
  assert.equal(eggsPerPack('UOVA FRESCHE DA 30 UOVA'), 30);
  assert.equal(eggsPerPack('UOVA CAT. M X30'), 30);
  assert.equal(eggsPerPack('30 UOVA CAT. M'), 30);
  assert.equal(eggsPerPack('UOVA CAT. M'), null);
});

const kind = (description, qty = 1.0, total = 5.0) => classify(description, qty, total);

test('classify: sugar in sacks is an ingredient, not packaging', () => {
  assert.deepEqual(kind('ZUCCHERO SACCHI DA KG 25'), ['ingrediente', '']);
});

test('classify: real packaging still is packaging', () => {
  assert.equal(kind('SACCHETTI CARTA PANE')[0], 'packaging');
  assert.equal(kind('BUSTE PLASTICA')[0], 'packaging');
  assert.equal(kind('CARTA FORNO')[0], 'packaging');
});

test('classify: beverages and ready-made are resale', () => {
  assert.equal(kind('ACQUA NATURALE 50 CL')[0], 'rivendita');
  assert.equal(kind('COCA COLA LATTINA')[0], 'rivendita');
  assert.equal(kind('CORNETTO ALLA CREMA')[0], 'rivendita');
  assert.equal(kind('FECOLA DI PATATE')[0], 'ingrediente');
});

// Mirrored word for word in invoice-import/tests/test_classify.py.
test('classify: bar, shelf and non-food goods are not ingredients', () => {
  for (const text of ['YOG. GR.125X2 FRAGOLA', 'KEFIR GR.150 FRAGOLA', 'DOLCIFICANTE PZ.150',
    'CAPS BAR DECAFF 7GX80', "CAFFE'CIALDEX15 ESEMPIO"]) {
    assert.equal(kind(text)[0], 'rivendita', text);
  }
  for (const text of ['ROT. ALLUMINIO KG 1 CM. 33', 'SET GREMBIULE PASTICCERIA', 'PALETTE BAMBOO 50X200',
    '500 COPRIVASSOI 18X24', '100 CARTE PIZZO D35', 'SHOPPER BIO 35X10X65',
    'BORSA SPESA 45X37', 'ECO BAGS ROSSO SMALL', 'CARAFFA GRADUATA 2 LT',
    'COPPETTA CONICA CM 20', 'L2 ANTICALCARE ESEMPIO', 'DETERSIVO PAVIMENTI 5 L',
    'PENNELLO 60MM', 'ASCIUGAMANI RIPIEGATI', 'PADEL ALLUMINIO 24CM', 'GUANTI NITRILE M']) {
    assert.equal(kind(text)[0], 'packaging', text);
  }
  // Food words still win, and a word inside another word is not the keyword.
  for (const text of ['OLIO EVO ML10X102', 'ZUCCHERO BUSTINA 4G', 'PAN DI SPUGNA KG 1', 'PEPERONI CAPSICUM']) {
    assert.equal(kind(text)[0], 'ingrediente', text);
  }
});

test('classify: a food word glued to an accented letter is a different word, as in Python', () => {
  assert.equal(kind('SALÈ BUSTE')[0], 'packaging'); // «salè» is not the food word «sale»
  assert.equal(kind('SALE GROSSO')[0], 'ingrediente');
  assert.equal(kind('ACQUÀ MINERALE')[0], 'ingrediente'); // «acquà» is not «acqua»: not resale
  assert.equal(kind('MANDORLE PELATE')[0], 'ingrediente');
});

test('classify: noise and costs are excluded', () => {
  assert.deepEqual(classify('LOTTO 12345', null, null), ['excluded', 'info-line']);
  assert.deepEqual(classify('', 1, 5), ['excluded', 'info-line']);
  assert.deepEqual(classify('OFFERTA SPECIALE', 1, 5), ['excluded', 'info-line']);
  assert.deepEqual(classify('DESCRIZIONE QUALSIASI', 0, 0), ['excluded', 'info-line']);
  assert.deepEqual(classify('SPESE DI TRASPORTO', 1, 5), ['excluded', 'costs']);
  assert.deepEqual(classify('INCASSO CONTRASSEGNO', 1, 5), ['excluded', 'costs']);
});

test('classify: a discount line without a product', () => {
  assert.ok(isUnattributedDiscount('SCONTO COMMERCIALE', null, -3.0));
  assert.ok(isUnattributedDiscount('QUALCOSA', null, -3.0));
  assert.ok(!isUnattributedDiscount('FARINA', 5, -3.0));
  assert.ok(!isUnattributedDiscount('FARINA', null, 3.0));
  assert.ok(isUnattributedDiscount('SCONTO SU FARINA', 5, -3.0));
});

test('the normalised name', () => {
  assert.equal(normaliseName('*Crème  brûlée {LOTTO 55 SCAD. 01/27}'), 'creme brulee');
  assert.equal(normaliseName('FARINA T.00 / KG-25'), 'farina t 00 kg 25');
  assert.equal(normaliseName('Perché è così_così'), 'perche e cosi cosi');
});

test('the key prefers the article code', () => {
  assert.equal(productKey('IT1', 'F00-25', 'FARINA'), 'IT1|code:F00-25');
  assert.equal(productKey('IT1', ' ', 'Farina {x}'), 'IT1|name:farina');
});

test('lot text does not change the key', () => {
  assert.equal(productKey('IT1', '', 'BURRO {LOTTO 1}'), productKey('IT1', '', 'BURRO {LOTTO 2}'));
});

test('the proposed name', () => {
  assert.equal(cleanName('ZUCCHERO SACCHI DA KG 25'), 'Zucchero');
  assert.equal(cleanName('FARINA TIPO 00 SACCO KG 25', 'F00-25'), 'Farina tipo 00');
  assert.equal(cleanName('*PASSATA 2,5kg* 4pz {LOTTO 7}'), 'Passata');
  assert.equal(cleanName('OLIO EXTRA VERGINE LT 5'), 'Olio extra vergine');
  assert.equal(cleanName('KG 25'), 'Kg 25');
  assert.equal(cleanName('FARINA TIPO 00 F00-25 SACCO KG 25', 'F00-25'), 'Farina tipo 00');
  assert.equal(cleanName('ÈLITE PASTA'), 'Èlite pasta');
});

test('the pack word', () => {
  assert.equal(packWord('ZUCCHERO SACCHI DA KG 25'), 'sacco');
  assert.equal(packWord('PASSATA BUSTE'), 'busta');
  assert.equal(packWord('OLIO LATTA LT 5'), 'latta');
  assert.equal(packWord('LATTE INTERO'), '');
  assert.equal(packWord('FARINA'), '');
});
