// Screens opened FROM History must open ABOVE it (P15).
//
// ⚠️⚠️ FROM MID-AUGUST TO 25 SEP 2026, THE PENCIL ON A PAST ORDER DID NOTHING VISIBLE.
// History is a fixed overlay at z-index 900. The order editor it opens is a
// .mgmt-overlay (650) and the send-the-day chooser a .preview-overlay (600), so both
// were appended to the page UNDERNEATH it. No test could see it — every unit was
// right — and it was found by driving the screen and asking which element sits at the
// centre of it. The numbers are read from the stylesheet here, not restated, so the
// day one of them moves the comparison moves with it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const CSS = read('orders.css').replace(/\/\*[\s\S]*?\*\//g, '');

function zIndexOf(selector) {
  const rule = CSS.match(new RegExp(`(^|\\n)${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`));
  assert.ok(rule, `${selector} not found in orders.css`);
  const z = rule[2].match(/z-index:\s*(\d+)/);
  assert.ok(z, `${selector} has no z-index`);
  return Number(z[1]);
}

test('⚠️ .over-history lifts a screen above History and stays below the banner and the dialog', () => {
  const history = zIndexOf('.history-overlay');
  const over = zIndexOf('.over-history');
  assert.ok(over > history, `${over} must be above History's ${history}`);
  assert.ok(over < 9999, 'the update banner (9999) and the dialog (10000) must still cover it');
  // It ties the base rules on specificity, so it must come AFTER both of them.
  const at = sel => CSS.search(new RegExp(`(^|\\n)${sel.replace(/\./g, '\\.')}\\s*\\{`));
  assert.ok(at('.over-history') > at('.mgmt-overlay'), 'declared after .mgmt-overlay');
  assert.ok(at('.over-history') > at('.preview-overlay'), 'declared after .preview-overlay');
});

test('the order editor and the send-the-day chooser both carry it', () => {
  assert.match(read('js/orders/history-edit.js'), /class: 'mgmt-overlay over-history'/);
  const main = read('js/orders/orders-main.js');
  const send = main.slice(main.indexOf('function openSendDayScreen'), main.indexOf('function openSendDayScreen') + 1200);
  assert.match(send, /overlay\.classList\.add\('over-history'\)/);
});

test('the order editor body scrolls and has margins, like its siblings', () => {
  // Code only: the comment that explains the fix names the old class.
  const editor = read('js/orders/history-edit.js')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.match(editor, /el\('div', \{ class: 'mgmt-scroll' \}/);
  assert.doesNotMatch(editor, /mgmt-content/);
});

test('the History title is centred like every other Orders overlay', () => {
  const html = read('orders.html');
  const header = html.slice(html.indexOf('id="history-overlay"'), html.indexOf('</header>', html.indexOf('id="history-overlay"')));
  assert.match(header, /<div class="orders-header-title"><h1 data-i18n="ui.history">/);
  assert.match(header, /class="overlay-home-spacer"/, 'a counterweight to Back');
});
