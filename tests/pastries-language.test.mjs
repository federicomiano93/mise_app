// The proving lists in the venue's language (P15). On 25 Sep 2026 Panificio Miano's
// screen read «Mon Tue Wed» on its day strip, «Saturday» on each record, «Last 15
// days» under the title and «Saturday recorded.» after a confirm — around Italian
// text, because each of these either built its words before the venue was open or
// printed the stored weekday identifier as if it were a word.
//
// Read as TEXT where the behaviour needs a DOM, the same trade the other source-level
// suites here make; the dictionary half is behaviour.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { t, setLanguage, DEFAULT_LANGUAGE } from '../js/i18n.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

function inLanguage(lang, fn) {
  setLanguage(lang);
  try { return fn(); } finally { setLanguage(DEFAULT_LANGUAGE); }
}

// ⚠️ The strip is built at module load, when no venue is open and the language is
// the default. Painting its words once is painting them in English.
test('⚠️ the day strip repaints its words when the language arrives', () => {
  const strip = read('js/pastries/pastries-strip.js');
  assert.match(strip, /onLanguageChange\(paintLabels\)/);
  assert.match(strip, /setAttribute\('aria-label', weekdayLabel\(day\)\)/,
    'the accessible name is the day in the reader’s language, not the stored identifier');
  assert.doesNotMatch(strip, /'aria-label': day\b/);
});

test('a record names its day in words, never by its stored identifier', () => {
  const logs = read('js/pastries/pastries-logs.js');
  assert.match(logs, /text: weekdayLabel\(log\.day\)/);
  assert.doesNotMatch(logs, /text: log\.day\b/);
  assert.match(logs, /t\('day\.spelledNoYear'/, 'the date is spelled from the dictionary');
  assert.doesNotMatch(logs, /'Jan', 'Feb'/, 'no English month list of its own');
});

test('the records subtitle and the confirm toast are dictionary phrases', () => {
  const main = read('js/pastries/pastries-main.js');
  assert.match(main, /sub: t\('past\.lastNDays', \{ n: LOG_VISIBLE_DAYS \}\)/);
  assert.match(main, /toast\(t\('past\.dayRecorded', \{ day: weekdayLabel\(day\) \}\)\)/);
});

test('the Italian toast fits all seven days, domenica included', () => {
  inLanguage('it', () => {
    assert.equal(t('past.dayRecorded', { day: t('weekday.sunday') }), 'Registrato: Domenica.');
    assert.equal(t('past.dayRecorded', { day: t('weekday.saturday') }), 'Registrato: Sabato.');
    assert.equal(t('past.lastNDays', { n: 15 }), 'Ultimi 15 giorni');
  });
  inLanguage('en', () => {
    assert.equal(t('past.dayRecorded', { day: t('weekday.saturday') }), 'Saturday recorded.');
    assert.equal(t('past.lastNDays', { n: 15 }), 'Last 15 days');
  });
});

test('a record’s date reads in the venue’s language', () => {
  const spell = (wd, d, m) => t('day.spelledNoYear', {
    weekday: t(`day.weekdayShort.${wd}`), d, month: t(`day.monthShort.${m}`),
  });
  inLanguage('it', () => assert.equal(spell(5, 25, 8), 'ven 25 set'));
  inLanguage('en', () => assert.equal(spell(5, 25, 8), 'Fri 25 Sep'));
});
