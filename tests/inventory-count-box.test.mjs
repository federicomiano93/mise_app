// A stocktake box a person edits never shows a thousands separator (4 Oct 2026).
//
// ⚠️ WHY THIS EXISTS. The count boxes were filled with the DISPLAY formatter, which groups
// thousands: 1234.5 read «1,234.5» on an English screen, and 12345.5 «12.345,5» on an Italian one
// (Italian groups only from five digits, so a four-digit count there never showed the defect).
// readCount() takes ONE mark as the decimal, so the grouped text came back unreadable — the
// product turned «not counted» — or, worse, «1,234.5» edited to «1,235» was read as 1.235, a
// thousand times less, with nothing on screen to say so.
//
// ⚠️ AND THE SAME DEFECT ON A SECOND PATH (11 Oct 2026). The first fix covered the boxes as they
// are BUILT. A count that lands by a refresh — a save, another phone counting — rewrote the box
// nobody was typing into with num() again, through `parts.box.value = text`, which the property
// check below cannot see. The last test follows every `.value =` back to where its text comes from.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

// Every `.value = …` in a source, with the text it is written from: the right-hand side itself
// or, when that is a bare variable, every assignment to that variable. Returns the ones that use
// a grouping formatter (num, toLocaleString), plus how many writes it looked at.
function groupedBoxWrites(src) {
  const offenders = [];
  let writes = 0;
  for (const [line, rhs] of src.matchAll(/\.value\s*=(?!=)\s*([^;\n]+)/g)) {
    writes += 1;
    const id = rhs.trim();
    const sources = /^[A-Za-z_$][\w$]*$/.test(id)
      ? [...src.matchAll(new RegExp(`(?<![\\w$.])${id}\\s*=(?!=)\\s*([^;\\n]+)`, 'g'))].map(m => m[1])
      : [rhs];
    if (sources.length === 0) offenders.push(`${line} — cannot tell where «${id}» comes from`);
    for (const text of sources) {
      if (/\bnum\(|toLocaleString\(/.test(text)) offenders.push(`${line} ← ${text}`);
    }
  }
  return { offenders, writes };
}

test('⚠️ no box is rewritten later with the grouping formatter either', () => {
  // The check itself catches the line that shipped — otherwise it proves nothing.
  const shipped = "const text = line.closing === null ? '' : num(line.closing, locale);\n"
    + '        if (parts.box.value !== text) parts.box.value = text;';
  assert.equal(groupedBoxWrites(shipped).offenders.length, 1);

  const list = read('js/inventory/inventory-list.js');
  assert.match(list, /const text = line\.closing === null \? '' : boxNum\(line\.closing, locale\);/);
  assert.ok(groupedBoxWrites(list).writes > 0, 'the list still rewrites its boxes — so the check looked');
  // Every file of the stocktake, so a box added to a new screen is covered too.
  const files = readdirSync(new URL('../js/inventory/', import.meta.url)).filter(f => f.endsWith('.js'));
  assert.ok(files.includes('inventory-list.js') && files.includes('inventory-detail.js'));
  for (const file of files) {
    assert.deepEqual(groupedBoxWrites(read(`js/inventory/${file}`)).offenders, [], file);
  }
});
