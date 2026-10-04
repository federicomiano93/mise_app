// A stocktake box a person edits never shows a thousands separator (4 Oct 2026).
//
// ⚠️ WHY THIS EXISTS. The count boxes were filled with the DISPLAY formatter, which groups
// thousands: 1234.5 read «1,234.5» on an English screen and «1.234,5» on an Italian one.
// readCount() takes ONE mark as the decimal, so the grouped text came back unreadable — the
// product turned «not counted» — or, worse, «1,234.5» edited to «1,235» was read as 1.235, a
// thousand times less, with nothing on screen to say so.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readCount } from '../js/inventory/inventory-model.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const boxText = (value, locale) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 3, useGrouping: false }).format(value);

test('what a count box shows reads back as the same number, in both languages', () => {
  for (const locale of ['en-GB', 'it-IT']) {
    for (const value of [0, 3, 3.5, 999.999, 1000, 1234.5, 25000, 1234567.125]) {
      assert.equal(readCount(boxText(value, locale)), value, `${locale} ${value}`);
    }
  }
});

test('the grouped display text is exactly what readCount cannot read — the defect this guards', () => {
  const grouped = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 }).format(1234.5);
  assert.equal(grouped, '1,234.5');
  assert.equal(readCount(grouped), null);
  assert.equal(readCount('1,235'), 1.235, 'an edited grouped figure is read a thousand times smaller');
});

test('every stocktake box a person edits is filled without grouping', () => {
  const detail = read('js/inventory/inventory-detail.js');
  assert.match(detail, /useGrouping: false/);
  assert.match(detail, /value: value === null \|\| value === undefined \? '' : boxNum\(value, locale\),/);
  assert.match(detail, /value: stored === null \|\| stored === undefined \? '' : boxNum\(stored, locale\),/);
  assert.match(detail, /placeholder: closed \|\| parsed === null \? '' : boxNum\(parsed, locale\),/);
  const list = read('js/inventory/inventory-list.js');
  assert.match(list, /useGrouping: false/);
  assert.match(list, /value: line\.closing === null \? '' : boxNum\(line\.closing, locale\),/);
  // and no input value anywhere in the stocktake is filled with the grouping formatter
  for (const src of [detail, list]) {
    assert.doesNotMatch(src, /(value|placeholder): [^\n]*\bnum\(/);
  }
});
