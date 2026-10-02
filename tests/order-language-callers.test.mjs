// Source-level pin (P15): the message language is passed at EVERY place a supplier message
// is built or an email subject is made. Dropping one line would silently put an Italian
// venue's order back into English, with every other test green.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const count = (src, re) => (src.match(re) || []).length;

test('orders-main passes the venue language when it builds a message and a record row', () => {
  const src = read('js/orders/orders-main.js');
  assert.equal(count(src, /language: outputLanguage\(currentSession\(\)\.location\)/g), 1,
    'sendMessageFor passes language to buildOrderMessage');
  assert.equal(count(src, /const language = outputLanguage\(currentSession\(\)\.location\);/g), 1,
    'recordToRow reads the language');
  assert.match(src, /fallbackSupplierName\(language\)/);
  assert.match(src, /record\.units, language\)/);
});

test('preview.js hands the venue language to the send chooser', () => {
  assert.equal(count(read('js/orders/preview.js'), /language: outputLanguage\(currentSession\(\)\.location\),/g), 1);
});

test('send-chooser passes the language to both message builders and the email subject', () => {
  const src = read('js/orders/send-chooser.js');
  assert.equal(count(src, /\{ grouped, locationName, language \}/g), 1);
  assert.equal(count(src, /\{ grouped: true, locationName, language \}/g), 1);
  assert.equal(count(src, /emailSubject\(locationName, language\)/g), 1);
  assert.doesNotMatch(src, /orders\.send\.emailSubject/, 'the subject never follows the screen language');
});
