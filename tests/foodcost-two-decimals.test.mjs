// Food cost shows every number with exactly TWO decimals (Federico, 8 Nov 2026).
// Display only: Fornitori and Magazzino keep formatRate's six decimals, so price-model.js is
// untouched and no Food cost file may import it any more.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { setCurrency } from '../js/currency.js';
import { formatRate } from '../js/price-model.js';
import { fcNumber, fcMoney, fcWeight } from '../js/foodcost/fc-number.js';

const NB = ' ';
const italy = () => setCurrency('€', { decimal: ',', group: '.', symbolAfter: true });
const britain = () => setCurrency('£', { decimal: '.', group: '', symbolAfter: false });

test('fcNumber: always two decimals in the venue layout, grouped', () => {
  italy();
  assert.equal(fcNumber(0), '0,00');
  assert.equal(fcNumber(12.5), '12,50');
  assert.equal(fcNumber(32.5), '32,50');
  assert.equal(fcNumber(3), '3,00');
  assert.equal(fcNumber(0.01), '0,01');
  assert.equal(fcNumber(0.014), '0,01');
  assert.equal(fcNumber(1234.5), '1.234,50');
  assert.equal(fcNumber('7.5'), '7,50', 'a number stored as text still reads');
  britain();
  assert.equal(fcNumber(12.5), '12.50');
  assert.equal(fcNumber(1234.5), '1234.50');
});

test('fcNumber: a real amount that rounds to nothing reads «< 0,01», never 0,00', () => {
  italy();
  assert.equal(fcNumber(0.004), `<${NB}0,01`);
  assert.equal(fcNumber(0.0000001), `<${NB}0,01`);
  assert.equal(fcNumber(0.005), (0.005).toFixed(2) === '0.01' ? '0,01' : `<${NB}0,01`, 'whatever toFixed says wins');
  assert.equal(fcNumber(0), '0,00', 'zero stays zero');
  britain();
  assert.equal(fcNumber(0.004), `<${NB}0.01`);
});

test('fcNumber: a negative is rounded normally, but never shows minus zero', () => {
  italy();
  assert.equal(fcNumber(-1.5), '-1,50');
  assert.equal(fcNumber(-0.003), '0,00');
  assert.equal(fcNumber(-0), '0,00');
});

test('unknown values give an empty text, for the caller to replace with a dash', () => {
  italy();
  for (const bad of [null, undefined, '', NaN, Infinity, -Infinity, 'abc']) {
    assert.equal(fcNumber(bad), '', String(bad));
    assert.equal(fcMoney(bad), '', String(bad));
    assert.equal(fcWeight(bad), '', String(bad));
  }
  assert.equal(fcMoney(0), `0,00${NB}€`, 'a real zero is still zero');
});

test('fcMoney: two decimals in the currency layout; a tiny real cost reads «< 0,01 €»', () => {
  italy();
  assert.equal(fcMoney(0), `0,00${NB}€`);
  assert.equal(fcMoney(0.035), `0,04${NB}€`);
  assert.equal(fcMoney(6.5), `6,50${NB}€`);
  assert.equal(fcMoney(1234.5), `1.234,50${NB}€`);
  assert.equal(fcMoney(0.003), `<${NB}0,01${NB}€`, 'a 2 g pinch of salt');
  assert.equal(fcMoney(0.01), `0,01${NB}€`);
  assert.equal(fcMoney(0.014), `0,01${NB}€`);
  assert.equal(fcMoney(-1.5), `-1,50${NB}€`, 'a negative margin is real');
  assert.equal(fcMoney(-0.003), `0,00${NB}€`, 'no minus zero');
  britain();
  assert.equal(fcMoney(0.003), `<${NB}£0.01`);
  assert.equal(fcMoney(6.5), '£6.50');
  assert.equal(fcMoney(0), '£0.00');
  assert.equal(fcMoney(-1.5), '£-1.50');
});

test('fcMoney rounds like toFixed, so 1.005-style values follow the platform', () => {
  italy();
  assert.equal(fcMoney(1.005), `${(1.005).toFixed(2).replace('.', ',')}${NB}€`);
  assert.equal(fcMoney(2.675), `${(2.675).toFixed(2).replace('.', ',')}${NB}€`);
});

test('fcWeight: grams under a kilo, kilos from a kilo, decided on the ROUNDED grams', () => {
  italy();
  assert.equal(fcWeight(0.5), '500,00 g');
  assert.equal(fcWeight(0.0125), '12,50 g');
  assert.equal(fcWeight(0.002), '2,00 g');
  assert.equal(fcWeight(1.25), '1,25 kg');
  assert.equal(fcWeight(1), '1,00 kg');
  assert.equal(fcWeight(10), '10,00 kg');
  assert.equal(fcWeight(0.999996), '1,00 kg', '999.996 g is «1,00 kg», never «1000,00 g»');
  assert.equal(fcWeight(0.99999), '999,99 g');
  assert.equal(fcWeight(1234.5), '1.234,50 kg');
  assert.equal(fcWeight(0.0000001), `<${NB}0,01 g`, 'a tiny additive is not nothing');
  assert.equal(fcWeight(0), '0,00 g');
  britain();
  assert.equal(fcWeight(0.0125), '12.50 g');
  assert.equal(fcWeight(1.25), '1.25 kg');
});

test('pieces and percentages go through fcNumber', () => {
  italy();
  assert.equal(`${fcNumber(3)} pz`, '3,00 pz');
  assert.equal(`${fcNumber(0.004)} pz`, `<${NB}0,01 pz`);
  assert.equal(`${fcNumber(32.5)}%`, '32,50%');
});

test('price-model.js is untouched: formatRate keeps its six decimals for Fornitori and Magazzino', () => {
  britain();
  assert.equal(formatRate(0.035), '£0.035');
  assert.equal(formatRate(0.001745), '£0.001745');
  assert.equal(formatRate(7.2), '£7.20');
});

test('no file under js/foodcost/ imports formatRate or formatMoney any more', () => {
  const dir = new URL('../js/foodcost/', import.meta.url);
  const files = readdirSync(dir).filter(f => f.endsWith('.js'));
  assert.ok(files.includes('fc-number.js'));
  for (const f of files) {
    const imports = [...readFileSync(new URL(f, dir), 'utf8').matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']+'/g)].map(m => m[1]).join(',');
    assert.doesNotMatch(imports, /\bformatRate\b|\bformatMoney\b|\bformatPricePerUnit\b/, f);
  }
});

test('the screens use the new formatters where they print figures', () => {
  const src = f => readFileSync(new URL(`../js/foodcost/${f}`, import.meta.url), 'utf8');
  for (const f of ['foodcost-editor.js', 'foodcost-list.js', 'foodcost-main.js', 'preview-view.js', 'line-cost.js', 'read-sections.js']) {
    assert.match(src(f), /from '\.\/fc-number\.js'/, f);
  }
  assert.doesNotMatch(src('foodcost-weighing.js'), /fc-number/, 'the weighing model stays pure');
  assert.match(src('from-recipes-view.js'), /fcNumber\(item\.kg\)/);
  assert.match(src('read-sections.js'), /perKgWeightText[\s\S]*?fcWeight/);
});
