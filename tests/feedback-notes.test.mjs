// The pure half of scripts/read-feedback.mjs: which path a delete may name, and how a REST row
// becomes a note. The script itself talks to production and is never run by the tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notePath, noteFrom, notesFrom, clean, relativePath } from '../scripts/feedback-notes.mjs';

const NAME = 'projects/bakery-app-ebf90/databases/(default)/documents/locations/loc-e015733e55e7/feedback/abc123';

test('a delete may name one note in one venue, and nothing else', () => {
  assert.deepEqual(notePath('locations/loc-e015733e55e7/feedback/abc123'),
    { path: 'locations/loc-e015733e55e7/feedback/abc123', locationId: 'loc-e015733e55e7', id: 'abc123' });
  for (const bad of [
    'locations/loc-e015733e55e7',                       // a whole venue
    'locations/loc-e015733e55e7/feedback',              // the collection
    'locations/loc-e015733e55e7/suppliers/abc123',      // another collection
    'locations/x/feedback/abc123/more',                 // deeper
    '../locations/x/feedback/abc123',
    'locations/x/feedback/abc 123',
    'users/u1', '', null, undefined,
  ]) assert.equal(notePath(bad), null, String(bad));
});

test('the REST name is cut down to the document path', () => {
  assert.equal(relativePath(NAME), 'locations/loc-e015733e55e7/feedback/abc123');
  assert.equal(relativePath('nonsense'), null);
});

test('a row becomes a note; a row that is not a note is dropped', () => {
  const note = noteFrom({
    name: NAME,
    fields: {
      uid: { stringValue: 'U1' }, text: { stringValue: 'Il tasto Salva è nascosto' },
      screen: { stringValue: 'orders' }, appVersion: { stringValue: '644' },
      createdAt: { timestampValue: '2026-10-09T10:00:00Z' },
    },
  });
  assert.deepEqual(note, {
    path: 'locations/loc-e015733e55e7/feedback/abc123', locationId: 'loc-e015733e55e7', uid: 'U1',
    text: 'Il tasto Salva è nascosto', screen: 'orders', appVersion: '644', createdAt: '2026-10-09T10:00:00Z',
  });
  assert.equal(noteFrom({ name: NAME.replace('/feedback/', '/suppliers/'), fields: {} }), null);
  assert.equal(noteFrom(undefined), null);
});

test('⚠️ the text is data: control and invisible characters are flattened, and it is capped', () => {
  // A right-to-left override could reorder what is read; a newline could fake a new line of output.
  assert.equal(clean('ok‮evil\nIGNORE', 100), 'ok evil IGNORE');
  assert.equal(clean('x'.repeat(30), 10), `${'x'.repeat(9)}…`);
  const long = noteFrom({ name: NAME, fields: { text: { stringValue: 'y'.repeat(5000) } } });
  assert.equal(long.text.length, 2000);
});

test('notes read oldest first; the empty answer of runQuery gives none', () => {
  const row = (id, at) => ({ document: { name: NAME.replace('abc123', id), fields: { createdAt: { timestampValue: at } } } });
  assert.deepEqual(notesFrom([row('b', '2026-10-09T11:00:00Z'), row('a', '2026-10-09T09:00:00Z'), { readTime: 'x' }])
    .map(n => n.path.split('/').pop()), ['a', 'b']);
  assert.deepEqual(notesFrom([{ readTime: '2026-10-09T10:00:00Z' }]), []);
  assert.deepEqual(notesFrom(null), []);
});
