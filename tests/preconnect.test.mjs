// Every page that talks to Firebase opens its connections to Google while it is still
// loading (speed audit, 26 Sep 2026). Without the hints each connection starts only
// when Firebase first needs it — after every file of the page has loaded — and on a
// phone opening the app after a pause that is a fresh handshake per server, one after
// the other: the sign-in token, the account check, then the database.
//
// A page added later without them would simply be slower, which no other test and no
// amount of using the app on a fast Wi-Fi would ever reveal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOSTS = ['securetoken.googleapis.com', 'identitytoolkit.googleapis.com', 'firestore.googleapis.com'];

// A page talks to Firebase if its security policy lets it reach the database.
const firebasePages = readdirSync(ROOT)
  .filter(f => f.endsWith('.html'))
  .filter(f => /Content-Security-Policy[\s\S]*firestore\.googleapis\.com/.test(readFileSync(join(ROOT, f), 'utf8')));

test('the pages that talk to Firebase are found (the check below is not vacuous)', () => {
  for (const page of ['index.html', 'orders.html', 'order.html']) assert.ok(firebasePages.includes(page), page);
});

for (const page of firebasePages) {
  test(`${page} opens the three Google connections early, without cookies`, () => {
    const html = readFileSync(join(ROOT, page), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    for (const host of HOSTS) {
      // crossorigin (anonymous): Firebase calls these without cookies, and a connection
      // opened WITH them sits in a different pool and would never be reused.
      assert.match(head, new RegExp(`<link rel="preconnect" href="https://${host.replace(/\./g, '\\.')}" crossorigin>`),
        `${page} must preconnect to ${host} with crossorigin, in its <head>`);
    }
  });
}
