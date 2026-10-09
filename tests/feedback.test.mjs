// «Write to Claude»: the venue switch, the payload, the dialog's Tab trap, and the
// wiring that a unit test can pin without a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { feedbackOn } from '../js/venue-features.js';
import { feedbackPayload, FEEDBACK_MAX } from '../js/feedback-model.js';
import { nextInTrap } from '../js/confirm-dialog.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('feedbackOn: only the literal true switches it on (default OFF, opens a write path)', () => {
  assert.equal(feedbackOn(undefined), false);
  assert.equal(feedbackOn(null), false);
  assert.equal(feedbackOn({}), false);
  assert.equal(feedbackOn({ feedbackToClaude: false }), false);
  assert.equal(feedbackOn({ feedbackToClaude: 'yes' }), false);
  assert.equal(feedbackOn({ feedbackToClaude: 1 }), false);
  assert.equal(feedbackOn('feedbackToClaude'), false);
  assert.equal(feedbackOn({ feedbackToClaude: true }), true);
});

test('feedbackOn is not a callable-settable feature key', () => {
  assert.doesNotMatch(read('js/venue-features.js'), /FEATURE_KEYS = Object\.freeze\([^)]*feedback/);
});

test('feedbackPayload: blank text gives null', () => {
  assert.equal(feedbackPayload({ text: '   \n ' }), null);
  assert.equal(feedbackPayload({ text: undefined }), null);
  assert.equal(feedbackPayload(), null);
});

test('feedbackPayload: trims, caps the text, keeps a sane screen and version', () => {
  assert.deepEqual(
    feedbackPayload({ text: '  hello  ', screen: 'orders', appVersion: '643' }),
    { text: 'hello', screen: 'orders', appVersion: '643' },
  );
  assert.equal(feedbackPayload({ text: 'x'.repeat(FEEDBACK_MAX + 50) }).text.length, FEEDBACK_MAX);
});

test('feedbackPayload: a bad screen is omitted, a bad version is null', () => {
  const p = feedbackPayload({ text: 'a', screen: 's'.repeat(41), appVersion: '1234567890123' });
  assert.equal('screen' in p, false);
  assert.equal(p.appVersion, null);
  assert.equal('screen' in feedbackPayload({ text: 'a', screen: 7 }), false);
  assert.equal(feedbackPayload({ text: 'a', appVersion: null }).appVersion, null);
});

test('nextInTrap: Tab and Shift+Tab cycle through every control in order', () => {
  const list = ['textarea', 'cancel', 'ok'];
  assert.equal(nextInTrap(list, 'textarea', false), 'cancel');
  assert.equal(nextInTrap(list, 'cancel', false), 'ok');
  assert.equal(nextInTrap(list, 'ok', false), 'textarea');
  assert.equal(nextInTrap(list, 'textarea', true), 'ok');
  assert.equal(nextInTrap(list, 'ok', true), 'cancel');
  assert.equal(nextInTrap(list, 'outside', false), 'textarea');
  assert.equal(nextInTrap(list, 'outside', true), 'ok');
  assert.equal(nextInTrap([], 'x', false), null);
});

test('the dialog traps Tab through nextInTrap, over all the box\'s controls', () => {
  const src = read('js/confirm-dialog.js');
  assert.match(src, /nextInTrap\(/);
  assert.match(src, /textarea/);
  assert.match(src, /e\.shiftKey/);
});

test('help sheet: «Write to Claude» is the OK button, behind the venue switch', () => {
  const src = read('js/help-button.js');
  assert.match(src, /feedbackOn\(currentSession\(\)\.location\)/);
  assert.match(src, /okLabel:\s*t\('feedback\.write'\)/);
  assert.match(src, /cancelLabel:\s*t\('help\.gotIt'\)/);
  assert.match(src, /import\('\.\/feedback\.js'\)/);
});

test('sendFeedback writes to the venue\'s feedback collection with a server timestamp', () => {
  for (const file of ['js/firebase.js', 'js/firebase.example.js']) {
    const src = read(file);
    assert.match(src, /export function sendFeedback\(/, file);
    assert.match(src, /addDoc\(collection\(db, pathFor\('feedback'\)\)/, file);
    assert.match(src, /createdAt: serverTimestamp\(\)/, file);
  }
});

test('feedback.js: no innerHTML, no native dialogs, no text in the error log', () => {
  const src = read('js/feedback.js');
  assert.doesNotMatch(src, /innerHTML/);
  assert.doesNotMatch(src, /\b(window\.)?(alert|confirm)\(/);
  assert.match(src, /console\.error\([^)]*err(or)?\??\.code/);
});
