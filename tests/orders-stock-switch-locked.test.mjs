// The «Show the Stock box» switch in Orders settings (13 Oct 2026).
//
// config/orders is write-gated on canManage() in the rules, but the switch was live for
// employees: the shared lab tablet (an employee account) tapped it, the write was refused
// with permission-denied, the switch sprang back and the staff wrote «non riesco a
// mostrare la giacenza». It now stays visible to everybody but only the owner or a
// manager can flip it; everybody else reads who can. Read from source: management.js
// pulls the Firebase SDK from an https: URL and cannot be imported under Node.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _dictionaries } from '../js/i18n.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const withoutComments = src => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const MGMT = withoutComments(read('js/orders/management.js').replace(/\r\n/g, '\n'));

test('the stock switch is given the boss flag and locks for everybody else', () => {
  assert.match(MGMT, /buildStockSwitch\(config, boss\)/);
  assert.match(MGMT, /function buildStockSwitch\(config, boss\)/);
  assert.match(MGMT, /lockedNote: boss \? null : t\('orders\.onlyOwnerOrManager'\)/);
});

test('a locked switch starts disabled and stays disabled after a save attempt', () => {
  assert.match(MGMT, /const locked = Boolean\(lockedNote\);\s*input\.disabled = locked;/);
  // The finally of the change handler must not re-enable a locked switch.
  assert.match(MGMT, /finally \{\s*input\.disabled = locked;/);
  const switchRow = MGMT.slice(MGMT.indexOf('function switchRow('), MGMT.indexOf('function buildOrderListsSwitch('));
  assert.doesNotMatch(switchRow, /input\.disabled = false/);
});

test('the history-days field is locked the same way for everybody else', () => {
  assert.match(MGMT, /buildHistoryDaysField\(config, boss\)/);
  assert.match(MGMT, /input\.disabled = !boss;\s*const lockedLine = boss \? null : el\('p', \{[^}]*t\('orders\.onlyOwnerOrManager'\)/);
  assert.match(MGMT, /finally \{\s*input\.disabled = !boss;/);
  assert.match(MGMT, /input\.setAttribute\('aria-describedby', 'history-days-locked'\)/);
});

test('the «who can change this» line is drawn and announced with the switch', () => {
  assert.match(MGMT, /input\.setAttribute\('aria-describedby', lockedEl\.id\)/);
  assert.match(MGMT, /subEl, lockedEl\]/);
});

test('every control that writes config/orders is either boss-only or locked', () => {
  // The other config/orders controls sit inside `if (boss)`; the stock switch and the
  // history-days field are drawn for everybody, so they must lock. A new control drawn
  // outside the boss branch that saves config/orders would repeat the tablet's refused save.
  const render = MGMT.slice(MGMT.indexOf('function render()'), MGMT.indexOf('function section('))
    .replace(/if \(boss\) \{[\s\S]*?\n {4}\}/g, '');           // the boss-only block
  const outsideBoss = render.split('\n').filter(l => /build\w+\(/.test(l) && !/if \(boss\)|boss &&/.test(l));
  const builders = outsideBoss.map(l => l.match(/(build\w+)\(/)[1]);
  assert.deepEqual(builders.sort(), ['buildHistoryDaysField', 'buildMuteOrderRequests', 'buildStockSwitch'],
    'the controls drawn for everybody changed — check each one against the rules');
  for (const name of builders) {
    const body = MGMT.slice(MGMT.indexOf(`function ${name}(`));
    const fn = body.slice(0, body.indexOf('\n  }\n') + 4);
    assert.ok(fn.length > 50, `could not read ${name}`);
    if (/saveOrdersConfig/.test(fn)) {
      assert.match(fn, /lockedNote: boss \? null : |input\.disabled = !boss/, `${name} saves config/orders for everybody`);
    }
  }
  // A control written straight into render(), not through a builder, would slip past the
  // loop above — so render() itself must not save anything.
  assert.doesNotMatch(render, /saveOrdersConfig|switchRow\(/);
});

test('a locked number box looks locked, not editable', () => {
  const css = read('tokens.css');
  assert.match(css, /\.set-input:disabled \{[^}]*background: var\(--surface-2\)/);
});

test('the line exists in English and Italian', () => {
  assert.equal(_dictionaries().en['orders.onlyOwnerOrManager'], 'Only an owner or a manager can change this.');
  assert.equal(_dictionaries().it['orders.onlyOwnerOrManager'], 'Può cambiarla solo un titolare o un responsabile.');
});
