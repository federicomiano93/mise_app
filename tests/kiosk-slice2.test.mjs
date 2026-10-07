import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { kioskOrderLines, MAX_SUPPLIERS_SHOWN } from '../js/orders/kiosk-lines.js';
import { serializeKioskSettings, readKioskSettings } from '../js/kiosk-model.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');
// A stand-in translator that shows the key and the holes it was given.
const t = (key, vars) => `${key}|${JSON.stringify(vars)}`;

test('no lines when nothing is to order and nothing is due', () => {
  assert.deepEqual(kioskOrderLines({ toOrder: [], deliveriesToday: 0 }, t), []);
  assert.deepEqual(kioskOrderLines({}, t), []);
});

test('suppliers go through supplierLabel (short name wins) and deliveries are counted', () => {
  const lines = kioskOrderLines({
    toOrder: [{ name: 'Brava Foods Ltd', shortName: 'Brava' }, { name: 'Molino' }],
    deliveriesToday: 2,
  }, t);
  assert.deepEqual(lines, [
    'kiosk.orders.toOrder|{"names":"Brava, Molino"}',
    'kiosk.orders.deliveries|{"n":2}',
  ]);
});

test('the supplier list is capped with +N', () => {
  const toOrder = Array.from({ length: 7 }, (_, i) => ({ name: `S${i + 1}` }));
  const [line] = kioskOrderLines({ toOrder, deliveriesToday: 0 }, t);
  assert.equal(MAX_SUPPLIERS_SHOWN, 4);
  assert.equal(line, 'kiosk.orders.toOrder|{"names":"S1, S2, S3, S4 +3"}');
});

test('Orders listens for the rest screen, reuses its own values and never renders', () => {
  const src = read('js/orders/orders-main.js');
  const start = src.indexOf("window.addEventListener('kiosk-rest-info'");
  assert.ok(start > 0, 'listener exists');
  const body = src.slice(start, src.indexOf('\ninit();', start));
  assert.match(body, /todayOrders\(/);
  assert.match(body, /pendingDeliveries\(/);
  assert.match(body, /kioskOrderLines\(/);
  assert.match(body, /try \{/);
  assert.match(body, /console\.warn/);
  assert.doesNotMatch(body, /scheduleRender|await |getDocs?\(/);
  assert.match(read('js/orders/kiosk-lines.js'), /supplierLabel\(/);
});

test('saving a change keeps the other kiosk settings', () => {
  const stored = JSON.stringify({ enabled: true, restMinutes: 20, nightHours: 4 });
  assert.deepEqual(readKioskSettings(serializeKioskSettings(stored, { enabled: false })),
    { enabled: false, restMinutes: 20, nightHours: 4 });
  assert.deepEqual(readKioskSettings(serializeKioskSettings(null, { enabled: true })),
    { enabled: true, restMinutes: 5, nightHours: 1 });
  assert.deepEqual(readKioskSettings(serializeKioskSettings('garbage', { nightHours: 0 })),
    { enabled: false, restMinutes: 5, nightHours: 0 });
  assert.deepEqual(readKioskSettings(serializeKioskSettings(stored, { restMinutes: 7 })),
    { enabled: true, restMinutes: 5, nightHours: 4 });
});

test('Home settings: the device card, changed by everybody, saves on the tap and tells kiosk.js', () => {
  const src = read('js/home-settings.js');
  assert.match(src, /settings\.home\.device/);
  assert.doesNotMatch(src, /settings\.home\.app'/);
  assert.match(src, /\.\.\.kioskRows\(\)/);
  assert.match(src, /role', 'switch'/);
  assert.match(src, /new Event\('kiosk-settings-changed'\)/);
  assert.match(src, /alertDialog\(t\('kiosk\.settings\.notSaved'\)\)/);
  assert.match(src, /set-seg-btn/);
  assert.match(src, /details\.hidden = !wanted/);
});

// Federico, 7 Oct 2026: the lab tablet signs in as an EMPLOYEE, and the people at that tablet
// must be able to switch kiosk mode on or off — so nothing in the card is gated on a role.
test('Home settings: an employee can change the kiosk card (no role gate, no managers-only note)', () => {
  const src = read('js/home-settings.js');
  assert.match(src, /function kioskRows\(\)/);
  assert.doesNotMatch(src, /canEdit/);
  assert.doesNotMatch(src, /managersOnly/);
  assert.doesNotMatch(src, /cb\.disabled/);
  assert.doesNotMatch(src, /btn\.disabled = /);
  assert.match(src, /noteBlock\.append\(node\('p', 'set-note', t\('kiosk\.settings\.note'\)\)\)/);
  assert.doesNotMatch(read('js/i18n.js'), /kiosk\.settings\.managersOnly/);
});
