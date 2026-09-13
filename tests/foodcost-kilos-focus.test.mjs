// The kilos / pieces box on a Food cost product keeps the finger while typing.
//
// Found driving the screen at phone size on 13 Sep 2026: typing one digit into a
// recipe line's kilos box rebuilt every row of the product — that box included — so
// the focus went back to the page and «1.7» could not be typed in one go. The handler
// called repaint(), whose own comment elsewhere in the file already warned that
// rebuilding an input under the finger loses the focus and the half-typed number.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const EDITOR = readFileSync(new URL('../js/foodcost/foodcost-editor.js', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// The quantity input's own handler, from its opening to the button built after it.
function qtyHandler() {
  const at = EDITOR.indexOf("class: 'fc-input fc-qty'");
  assert.notEqual(at, -1, 'the quantity box must exist to be guarded');
  const end = EDITOR.indexOf("el('button'", at);
  assert.notEqual(end, -1, 'and the remove button still follows it');
  const body = EDITOR.slice(at, end);
  assert.match(body, /oninput:/, 'the slice must actually contain the handler');
  return body;
}

test('⚠️ typing a quantity does not rebuild the rows it is typed in', () => {
  const body = qtyHandler();
  assert.ok(!/repaint(Lines)?\(\)/.test(body),
    'repaint() rebuilds this very box: the finger loses it after one digit');
});

test('…and still refreshes what a quantity changes: the line cost and the answer', () => {
  const body = qtyHandler();
  assert.match(body, /note\.textContent = lineNote\(entry, kind\);/, 'the line\'s own cost');
  assert.match(body, /paintAnswer\(\);/, 'the food cost at the top');
});
