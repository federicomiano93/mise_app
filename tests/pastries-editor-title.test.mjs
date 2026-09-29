// The Pastries editor named itself in English — «Edit Tuesday / Pastries» — on the
// Italian venue from 5 Aug 2026 until a code review found it (29 Sep 2026): a template
// string with English words and the STORED day id, invisible to the English-words
// sweep. The title must come from t() with the day's LABEL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _dictionaries } from '../js/i18n.js';

const src = readFileSync(new URL('../js/pastries/pastries-main.js', import.meta.url), 'utf8');

test('the editor title is translated and uses the day label', () => {
  const body = src.slice(src.indexOf('function openEditor'), src.indexOf('function showLogs'));
  assert.match(body, /title: t\('past\.editDay', \{ day: weekdayLabel\(day\) \}\)/);
  assert.match(body, /sub: t\('section\.pastries'\)/);
  assert.doesNotMatch(body, /`Edit /);
  assert.doesNotMatch(body, /sub: 'Pastries'/);
});

test('the phrase exists in both languages', () => {
  const d = _dictionaries();
  assert.equal(d.en['past.editDay'], 'Edit {day}');
  assert.equal(d.it['past.editDay'], 'Modifica {day}');
});
