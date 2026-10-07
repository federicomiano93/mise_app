import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { kioskOrderSections, kioskSectionsFromData, MAX_SUPPLIERS_SHOWN } from '../js/orders/kiosk-lines.js';
import { serializeKioskSettings, readKioskSettings } from '../js/kiosk-model.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');

// The rest cover used to get plain text lines («To order today: A, B» and a delivery COUNT).
// It now gets structured sections — a title key plus supplier names — so the centre of the
// cover can lay out a big title and a big list; deliveries carry NAMES, not a count.
test('no sections when nothing is to order and nothing arrives', () => {
  assert.deepEqual(kioskOrderSections({ toOrder: [], arriving: [] }), []);
  assert.deepEqual(kioskOrderSections({}), []);
  assert.deepEqual(kioskOrderSections(), []);
});

test('names go through supplierLabel (short name wins); an empty section is not shown', () => {
  const sections = kioskOrderSections({
    toOrder: [{ id: 'a', name: 'Brava Foods Ltd', shortName: 'Brava' }, { id: 'b', name: 'Molino' }],
    arriving: [],
  });
  assert.deepEqual(sections, [
    { titleKey: 'kiosk.rest.toOrderTitle', names: ['Brava', 'Molino'], more: 0 },
  ]);
  const both = kioskOrderSections({ toOrder: [{ id: 'a', name: 'A' }], arriving: [{ id: 'c', name: 'C' }] });
  assert.deepEqual(both.map(s => s.titleKey), ['kiosk.rest.toOrderTitle', 'kiosk.rest.arrivingTitle']);
  assert.deepEqual(kioskOrderSections({ toOrder: [], arriving: [{ id: 'c', name: 'C' }] }).map(s => s.titleKey),
    ['kiosk.rest.arrivingTitle']);
});

test('each section is capped at four names with the rest counted as +N', () => {
  const toOrder = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, name: `S${i + 1}` }));
  const [section] = kioskOrderSections({ toOrder });
  assert.equal(MAX_SUPPLIERS_SHOWN, 4);
  assert.deepEqual(section.names, ['S1', 'S2', 'S3', 'S4']);
  assert.equal(section.more, 3);
});

test('a missing (deleted) supplier is skipped and a supplier is never listed twice', () => {
  const [section] = kioskOrderSections({ arriving: [null, undefined, { id: 'a', name: 'A' }, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
  assert.deepEqual(section.names, ['A', 'B']);
  assert.equal(section.more, 0);
});

test('from Orders data: unplaced order days, and deliveries due today that are not delivered', () => {
  // 2026-10-07 is a Wednesday.
  const suppliers = [
    { id: 'm', name: 'Molino', orderDays: ['Wednesday'], deliveryDays: ['Wednesday'], active: true },
    { id: 'p', name: 'Placed', orderDays: ['Wednesday'], deliveryDays: ['Friday'], active: true },
    { id: 'g', name: 'Gone', orderDays: [], deliveryDays: ['Wednesday'], active: true },
  ];
  const history = [
    { id: '2026-10-07_p', date: '2026-10-07', supplierId: 'p' },
    { id: '2026-10-06_m', date: '2026-10-06', supplierId: 'm' },
    { id: '2026-10-06_x', date: '2026-10-06', supplierId: 'deleted' },
    { id: '2026-10-06_g', date: '2026-10-06', supplierId: 'g', deliveredAt: '2026-10-07T08:00:00Z' },
  ];
  const sections = kioskSectionsFromData({ suppliers, history, today: '2026-10-07', weekStartsOn: 'Sunday' });
  const byKey = Object.fromEntries(sections.map(s => [s.titleKey, s.names]));
  assert.deepEqual(byKey['kiosk.rest.toOrderTitle'], ['Molino']);
  assert.deepEqual(byKey['kiosk.rest.arrivingTitle'], ['Molino']);
});

test('Orders claims the rest screen, reuses its own values and never renders', () => {
  const src = read('js/orders/orders-main.js');
  const start = src.indexOf("window.addEventListener('kiosk-rest-info'");
  assert.ok(start > 0, 'listener exists');
  const body = src.slice(start, src.indexOf('\ninit();', start));
  assert.match(body, /event\.detail\.live = true/);
  assert.match(body, /kioskSectionsFromData\(/);
  assert.match(body, /try \{/);
  assert.match(body, /console\.warn/);
  assert.doesNotMatch(body, /scheduleRender|await |getDocs?\(/);
  assert.match(read('js/orders/kiosk-lines.js'), /supplierLabel\(/);
  assert.match(read('js/orders/kiosk-lines.js'), /todayOrders\(/);
  assert.match(read('js/orders/kiosk-lines.js'), /pendingDeliveries\(/);
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
