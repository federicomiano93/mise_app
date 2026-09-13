// The Home's holiday signals: a band at the top while away, and a reminder the first
// time a card is opened each day — whose job is to catch a holiday somebody forgot.
//
// Federico, 13 Sep 2026: «l'app mi ricorda che sono in ferie così se non lo sono più e
// ho dimenticato di togliere la spunta la tolgo». The day logic is pure and RUN here;
// the wiring is read from source, and the driven run on the emulators is its witness.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reminderDue, dayFromISO, AWAY_REMINDER_KEY } from '../js/away-reminder.js';
import { KEEP_PREFIXES } from '../js/local-data.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const code = p => read(p).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

// ── The day, run ─────────────────────────────────────────────────────────────

test('⚠️ once a day: the first card of the day reminds, the second does not', () => {
  assert.equal(reminderDue(true, null, '2026-09-13'), true, 'never reminded');
  assert.equal(reminderDue(true, '2026-09-12', '2026-09-13'), true, 'reminded yesterday');
  assert.equal(reminderDue(true, '2026-09-13', '2026-09-13'), false, 'already reminded today');
});

test('nobody on holiday is ever reminded, and nor is a value that only looks like true', () => {
  for (const away of [false, undefined, null, 'true', 1]) {
    assert.equal(reminderDue(away, null, '2026-09-13'), false, String(away));
  }
});

test('a today that is not a real ISO day reminds nobody rather than every time', () => {
  for (const today of ['', '13/09/2026', null, undefined, '2026-9-13']) {
    assert.equal(reminderDue(true, null, today), false, String(today));
  }
});

test('the stored day reads back as that calendar day, and an impossible one as nothing', () => {
  const d = dayFromISO('2026-09-16');
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2026, 8, 16]);
  for (const bad of ['2026-02-30', '2026-13-01', '', 'soon', null, 20260916]) {
    assert.equal(dayFromISO(bad), null, String(bad));
  }
});

test('the reminder\'s memory is cleared with the venue — it comes back once, the safe way', () => {
  assert.ok(!KEEP_PREFIXES.some(p => AWAY_REMINDER_KEY.startsWith(p)));
});

// ── The wiring ───────────────────────────────────────────────────────────────

const HOME_AWAY = code('js/home-away.js');
const AWAY = code('js/away-screen.js');
const SESSION = code('js/home-session.js');

function bodyOf(src, head) {
  const start = src.indexOf(head);
  assert.ok(start >= 0, `${head} not found`);
  const next = src.slice(start + head.length).search(/\n(export )?(async )?function /);
  return next === -1 ? src.slice(start) : src.slice(start, start + head.length + next);
}

test('⚠️ the band is drawn at the top only while away, and tapping it offers «I am back»', () => {
  const paint = bodyOf(HOME_AWAY, 'function paintBand(');
  assert.match(paint, /document\.getElementById\('home-reminder'\)/, 'in the top slot, where «order to place today» sits');
  const gate = paint.indexOf('if (!state?.away) return;');
  assert.ok(gate > 0 && gate < paint.indexOf("createElement('button')"), 'nothing is drawn unless away');
  assert.match(paint, /host\.querySelector\('\.home-away'\)\?\.remove\(\);/, 'a redraw replaces the band, never adds a second');
  assert.match(paint, /band\.addEventListener\('click', \(\) => \{\s*askComeBack\(state\)/);
  assert.match(paint, /host\.prepend\(band\);/);
});

test('⚠️⚠️ the reminder holds the tap back only when one is due, and marks the day before asking', () => {
  const tap = bodyOf(HOME_AWAY, 'async function onCardTap(');
  const away = tap.indexOf('if (!state?.away) return;');
  const due = tap.indexOf('if (!reminderDue(state.away, last, today)) return;');
  const hold = tap.indexOf('event.preventDefault();');
  const mark = tap.indexOf('localStorage.setItem(AWAY_REMINDER_KEY, today)');
  const ask = tap.indexOf('await confirmDialog(');
  assert.ok(away > 0 && away < due && due < hold, 'a tap that needs no reminder must open the card untouched');
  assert.ok(hold < mark && mark < ask, 'marked before the dialog, so a reload cannot ask twice in a day');
});

test('⚠️ «I am back» is the reminder\'s main button; «Continue» keeps the holiday; the card opens either way', () => {
  const tap = bodyOf(HOME_AWAY, 'async function onCardTap(');
  assert.match(tap, /okLabel: t\('away\.back'\),\s*cancelLabel: t\('away\.reminder\.continue'\),/);
  assert.doesNotMatch(tap, /danger:\s*true/, 'coming back is not a destructive act');
  assert.match(tap, /if \(back\) await comeBack\(state\.uid\);\s*location\.href = href;/);
  assert.ok(tap.indexOf("getAttribute('href')") < tap.indexOf('await confirmDialog('),
    'the link is read BEFORE the await — event.currentTarget is null after it');
});

test('coming back writes an empty holiday; asked once from the band, not at all from the reminder', () => {
  assert.match(bodyOf(AWAY, 'export async function comeBack('), /await write\(uid, ''\);/);
  const ask = bodyOf(AWAY, 'export async function askComeBack(');
  assert.ok(ask.indexOf('await confirmDialog(') < ask.indexOf('await comeBack(state.uid)'));
  assert.doesNotMatch(bodyOf(AWAY, 'export async function comeBack('), /confirmDialog/);
});

test('a person reads «16 settembre», not 2026-09-16', () => {
  assert.match(bodyOf(AWAY, 'export function awayDayLabel('),
    /dayFromISO\(until\)[\s\S]*toLocaleDateString\(localeTag\(\), \{ day: 'numeric', month: 'long' \}\)/);
  assert.doesNotMatch(AWAY, /\{ day: mine\.until \}|\{ day: state\.mine\.until \}/, 'no raw stored day in a sentence');
});

test('the Home reads the holiday when the venue opens and again whenever it changes', () => {
  const ready = SESSION.slice(SESSION.indexOf('onSession(session => {'), SESSION.indexOf('});', SESSION.indexOf('onSession(session => {')));
  assert.ok(ready.indexOf('filterCards(session);') < ready.indexOf('wireAwayReminder();'),
    'wired after the filter, so a removed card is never listened to');
  assert.match(ready, /refreshAway\(\);/);
  assert.match(SESSION, /window\.addEventListener\('away-changed', \(\) => \{\s*if \(currentSessionForStrip\) refreshAway\(\);/);
});

test('both new files are precached', () => {
  const sw = read('sw.js');
  assert.match(sw, /'\.\/js\/away-reminder\.js'/);
  assert.match(sw, /'\.\/js\/home-away\.js'/);
});
