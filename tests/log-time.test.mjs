// Unit tests for the log timestamp formatting (P15 — the owner cannot read code).
// They lock the 12-hour AM/PM format and the date string built by logTimestamp.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { logTimestamp, localLogDate, localLogTime, logStampText } from '../js/log-time.js';

test('midnight reads as 12:MM AM', () => {
  // 2026-06-08 is a Monday; midnight, 7 minutes past.
  const { time } = logTimestamp(new Date(2026, 5, 8, 0, 7));
  assert.equal(time, '12:07 AM');
});

test('morning reads as AM with no leading zero on the hour', () => {
  const { time } = logTimestamp(new Date(2026, 5, 8, 9, 5));
  assert.equal(time, '9:05 AM');
});

test('noon reads as 12:MM PM', () => {
  const { time } = logTimestamp(new Date(2026, 5, 8, 12, 0));
  assert.equal(time, '12:00 PM');
});

test('afternoon converts 24h to 12h with PM', () => {
  const { time } = logTimestamp(new Date(2026, 5, 8, 14, 5));
  assert.equal(time, '2:05 PM');
});

test('late evening reads as PM', () => {
  const { time } = logTimestamp(new Date(2026, 5, 8, 23, 59));
  assert.equal(time, '11:59 PM');
});

test('minutes are zero-padded', () => {
  const { time } = logTimestamp(new Date(2026, 5, 8, 8, 3));
  assert.equal(time, '8:03 AM');
});

test('date string is "Weekday DD Month" with padded day', () => {
  const { date } = logTimestamp(new Date(2026, 5, 8, 8, 3));
  assert.equal(date, 'Monday 08 June');
});

// ── The Dough history shows the stored English in the interface language ──────
// Found on the lab tablet, 31 Oct 2026: an Italian venue read «Saturday 31 October — 8:19 PM».
// What is stored stays English (Mise 2 reads the same logs); only the screen translates.

test('Italian: the stored date reads as «sabato 31 ottobre», the day without its zero', () => {
  assert.equal(localLogDate('Saturday 31 October', 'it'), 'sabato 31 ottobre');
  assert.equal(localLogDate('Monday 08 June', 'it'), 'lunedì 8 giugno');
});

test('Italian: every weekday and month name is translated, none left in English', () => {
  for (let day = 0; day < 7; day++) {
    for (let month = 0; month < 12; month++) {
      const { date } = logTimestamp(new Date(2026, month, 1 + ((day - new Date(2026, month, 1).getDay() + 7) % 7)));
      const shown = localLogDate(date, 'it');
      assert.notEqual(shown, date, date);
      assert.doesNotMatch(shown, /[A-Z]|day|January|February|March|April|June|July|August|October|November|December/, shown);
    }
  }
});

test('Italian: the stored 12-hour time reads on the 24-hour clock', () => {
  assert.equal(localLogTime('8:19 PM', 'it'), '20:19');
  assert.equal(localLogTime('12:07 AM', 'it'), '00:07');
  assert.equal(localLogTime('12:00 PM', 'it'), '12:00');
  assert.equal(localLogTime('9:05 AM', 'it'), '09:05');
  assert.equal(localLogTime('11:59 PM', 'it'), '23:59');
});

test('round trip: what logTimestamp stores is shown in Italian at the same instant', () => {
  const at = logTimestamp(new Date(2026, 9, 31, 20, 19));
  assert.equal(logStampText(at, 'it'), 'sabato 31 ottobre — 20:19');
});

test('English is shown exactly as stored', () => {
  const at = { date: 'Saturday 31 October', time: '8:19 PM' };
  assert.equal(logStampText(at, 'en'), 'Saturday 31 October — 8:19 PM');
});

test('a stored text that is not the usual shape is shown as written, never guessed', () => {
  assert.equal(localLogDate('31/10/2026', 'it'), '31/10/2026');
  assert.equal(localLogDate('Caturday 31 October', 'it'), 'Caturday 31 October');
  assert.equal(localLogDate('sabato 31 ottobre', 'it'), 'sabato 31 ottobre');
  assert.equal(localLogTime('20:19', 'it'), '20:19');
  assert.equal(localLogTime('13:05 PM', 'it'), '13:05 PM');
  assert.equal(logStampText({}, 'it'), ' — ');
  assert.equal(logStampText(null, 'it'), ' — ');
});

test('every Dough history screen draws the «when» line through logStampText', () => {
  for (const file of ['js/log.js', 'js/log-view.js', 'js/log-edit.js']) {
    const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.match(src, /logStampText\(/, file);
    assert.doesNotMatch(src, /at\.date \|\| ''\) \+ ' — '|at\.date \+ ' — ' \+ at\.time/, file);
  }
});
