// «Who can get in» — the layout of js/staff/people.js, pinned by reading the source.
//
// ⚠️ SOURCE-READING, NOT A BROWSER: it proves what the screen is built from (which
// list feeds the selects, that the label is a real label, that a cancelled change
// puts the select back), not how it looks — layout is the ui-check skill's job.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { _dictionaries } from '../js/i18n.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCREEN = readFileSync(join(ROOT, 'js', 'staff', 'people.js'), 'utf8');
const I18N = readFileSync(join(ROOT, 'js', 'i18n.js'), 'utf8');
const TOKENS = readFileSync(join(ROOT, 'tokens.css'), 'utf8');

test('every role option comes from ROLE_CHOICES, in a native select', () => {
  const at = SCREEN.indexOf('function roleSelect');
  assert.notEqual(at, -1);
  const fn = SCREEN.slice(at, SCREEN.indexOf('\n  }', at));
  assert.match(fn, /el\('select', \{ class: 'set-select'/);
  assert.match(fn, /for \(const choice of ROLE_CHOICES\)/);
  assert.match(fn, /el\('option', \{ value: choice\.key \}, choiceLabel\(choice\)\)/);
});

test('the invite select has a real label bound by for/id', () => {
  assert.match(SCREEN, /const selectId = '([\w-]+)'/);
  const id = SCREEN.match(/const selectId = '([\w-]+)'/)[1];
  assert.match(SCREEN, /roleSelect\(newChoice\.key, \{ id: selectId \}\)/);
  assert.match(SCREEN, /el\('label', \{ class: 'set-label', for: selectId, text: t\('people\.roleGroup'\) \}\)/);
  assert.ok(id.length > 0);
});

test('changing the invite role rewrites the sentence and does not rebuild the select', () => {
  const at = SCREEN.indexOf("roleField.addEventListener('change'");
  assert.notEqual(at, -1);
  const handler = SCREEN.slice(at, SCREEN.indexOf('});', at));
  assert.match(handler, /newChoice = /);
  assert.match(handler, /roleNote\.textContent = t\(ROLE_MEANS\[newChoice\.key\]\)/);
  assert.doesNotMatch(handler, /paintCode\(\)/, 'a repaint would drop the keyboard focus');
});

test('each roster select is named after the person, through people.roleOf', () => {
  // The name when there is one, the email when there is not: two selects both
  // read out as «Role of (no name yet)» would leave a screen reader guessing.
  assert.match(SCREEN, /'aria-label': t\('people\.roleOf', \{ name: named \|\| person\.email \|\| displayName\(person\) \}\)/);
});

test('a cancelled or failed role change puts the select back', () => {
  assert.match(SCREEN, /const applied = next \? await change\(person, next\) : false;/);
  assert.match(SCREEN, /if \(!applied\) select\.value = currentKey;/);

  const at = SCREEN.indexOf('async function change(');
  const fn = SCREEN.slice(at, SCREEN.indexOf('async function remove', at));
  assert.match(fn, /if \(!ok\) return false;/, 'cancel reports not applied');
  assert.match(fn, /alertDialog[\s\S]*return false;/, 'failure reports not applied');
  assert.match(fn, /return true;/);
  assert.match(fn, /setMemberRole\(person\.uid, choice\.role, choice\.title\)/);
});

test('the two invitation buttons sit together in .people-add-row', () => {
  assert.match(SCREEN, /el\('div', \{ class: 'people-add-row' \}, \[byLink, byDigits\]\)/);
  assert.match(TOKENS, /\.people-add-row \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(130px, 1fr\)\)/);
});

test('the old pills and the «how do you want to send it» label are gone', () => {
  assert.doesNotMatch(SCREEN, /rolePills/);
  assert.doesNotMatch(SCREEN, /people\.sendHow/);
  assert.doesNotMatch(I18N, /people\.sendHow/);
});

test('the two sections exist and the member count is repainted', () => {
  assert.match(SCREEN, /t\('people\.section\.invite'\)/);
  assert.match(SCREEN, /t\('people\.section\.members', \{ n: members\.length \}\)/);
  assert.match(SCREEN, /t\('people\.section\.membersPlain'\)/);
});

test('the new keys exist in every dictionary, and the count has its hole', () => {
  const dicts = _dictionaries();
  for (const lang of Object.keys(dicts)) {
    for (const key of ['people.section.invite', 'people.section.members',
      'people.section.membersPlain', 'people.roleOf']) {
      assert.ok(dicts[lang][key], `${lang} is missing ${key}`);
    }
    assert.match(dicts[lang]['people.section.members'], /\{n\}/, `${lang} count`);
    assert.match(dicts[lang]['people.roleOf'], /\{name\}/, `${lang} name`);
    assert.equal(dicts[lang]['people.sendHow'], undefined, `${lang} still has sendHow`);
  }
});

// ⚠️ On Windows Chrome/Edge an arrow key on a CLOSED select fires `change` at once:
// on a roster select that asked «Make X a head chef?» at the first keystroke.
test('on a roster select, step keys and typed letters open the list instead of choosing', () => {
  const at = SCREEN.indexOf('function pickFromOpenList');
  assert.notEqual(at, -1, 'the keydown guard exists');
  const fn = SCREEN.slice(at, SCREEN.indexOf('\n  }', at));
  for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
    assert.ok(SCREEN.includes(`'${key}'`), `${key} is caught`);
  }
  assert.match(fn, /event\.preventDefault\(\)/);
  assert.match(fn, /showPicker\(\)/);
  assert.match(SCREEN, /select\.addEventListener\('keydown', pickFromOpenList\)/,
    'the roster select carries the guard');
});

test('after an invitation, Done puts the next one back on Employee', () => {
  const at = SCREEN.indexOf('function doneButton');
  const fn = SCREEN.slice(at, SCREEN.indexOf('\n  }', at));
  assert.match(fn, /newChoice = ROLE_CHOICES\.find\(c => c\.key === 'staff'\)/);
});

test('a roster repaint gives the keyboard focus back to the same person\'s select', () => {
  assert.match(SCREEN, /select\.dataset\.uid = person\.uid/);
  assert.match(SCREEN, /x\.dataset\.uid === focusUid/);
});
