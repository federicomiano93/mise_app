// A client's ordering link is seen only by those who may manage the Calculator.
//
// Found by the audit of 25 Oct 2026: the link's secret (`linkToken` in client-accounts) IS the
// ordering account's password, and every member could read it — the rules said member(lid), and
// Calculator Settings showed «Copy link» and «Send» to every employee. Somebody who copied it once
// kept a way to order as that client after leaving the business.
//
// The real lock is firestore.rules, proven against the emulator by tests/rules/firestore-rules-check.mjs
// (an employee is refused, a manager, the owner and the account itself are allowed). This file pins
// the screen's half: calculator-settings.js loads the Firebase SDK from a CDN and cannot run under
// node, so its shape is read as source, each check first proving it found what it is looking for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _dictionaries } from '../js/i18n.js';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const codeOf = src => src.replace(/^\s*\/\/.*$/gm, '');

const RULES = read('firestore.rules');
const SETTINGS = codeOf(read('js/calculator-settings.js'));

function body(src, header) {
  const start = src.indexOf(header);
  assert.ok(start >= 0, `${header} not found`);
  const next = src.indexOf('\nfunction ', start + header.length);
  const nextAsync = src.indexOf('\nasync function ', start + header.length);
  const ends = [next, nextAsync].filter(i => i > 0);
  return src.slice(start, ends.length ? Math.min(...ends) : undefined);
}

test('⚠️ the rules: a grant is read by its own account or by those who manage the Calculator — never every member', () => {
  const block = RULES.slice(RULES.indexOf('match /client-accounts/{uid} {'));
  assert.ok(block.length > 0, 'the client-accounts block is gone');
  const read = block.match(/^\s*allow read: if (.+);$/m);
  assert.ok(read, 'no read rule in the client-accounts block');
  assert.equal(read[1], "(signedIn() && request.auth.uid == uid) || canManage(lid, 'calculator')");
  assert.doesNotMatch(read[1], /member\(lid\)/);
});

test('the links are not even asked for by somebody who cannot manage', () => {
  const load = body(SETTINGS, 'async function loadOrderingAccounts()');
  const guard = load.indexOf("if (currentSession().canManage !== true) return;");
  const list = load.indexOf('listOrderingAccounts()');
  assert.ok(guard > 0 && list > 0, 'the guard or the read is gone');
  assert.ok(guard < list, 'the guard must come before the read');
});

test('somebody who cannot manage gets the one sentence and no link, no Copy, no Send', () => {
  const field = body(SETTINGS, 'function orderingLinkField(client)');
  const staff = field.match(/if \(!canManage\) \{\s*field\.appendChild\(el\('p', \{ class: 'cp-hint' \}, t\('calc\.orderingLinkManagersOnly'\)\)\);\s*return field;\s*\}/);
  assert.ok(staff, 'the staff branch must add only the sentence and return');
  const after = field.slice(staff.index + staff[0].length);
  for (const needle of ['orderingAccounts.get(client.id)', "t('calc.copyLink')", 'chooseHowToSend(']) {
    assert.ok(after.includes(needle), `${needle} is gone from the field`);
    assert.ok(!field.slice(0, staff.index).includes(needle), `${needle} is reachable before the staff branch returns`);
  }
});

test('the sentence exists in English and Italian, and the old promise is gone', () => {
  for (const lang of ['en', 'it']) {
    const text = _dictionaries()[lang]['calc.orderingLinkManagersOnly'];
    assert.equal(typeof text, 'string', `${lang} is missing calc.orderingLinkManagersOnly`);
    assert.ok(text.length > 20);
    assert.equal(_dictionaries()[lang]['calc.thisClientCannotOrder'], undefined,
      `${lang}: «cannot order yet» told an employee something about a link they cannot see`);
  }
});
