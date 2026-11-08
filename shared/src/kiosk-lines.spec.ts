// The Orders sections of the kiosk rest screen (P15), run against BOTH implementations: the TypeScript port in shared/ and
// js/orders/kiosk-lines.js, which the live app uses today. A FULL port, so parity.spec.ts also compares the exports.
//
// PORTED: the five pure tests of tests/kiosk-slice2.test.mjs about kioskOrderSections and kioskSectionsFromData, plus two more
// (a supplier switched off, an order already said to have arrived), and the kiosk test of tests/orders-close-not-ordered.test.mjs (a
// supplier closed as not ordered today, checklist item 3, 8 Nov 2026).
// NOT PORTED: the tests of that file that read the source of orders-main.js and the kiosk's own settings (kiosk-model.js): they
// test the current app's wiring and the kiosk, which is step 3g.

import { describe, expect, test } from 'vitest';
import * as ported from './kiosk-lines';
import * as legacyJs from '../../js/orders/kiosk-lines.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('no sections when nothing is to order and nothing arrives', () => {
    expect(m.kioskOrderSections({ toOrder: [], arriving: [] })).toStrictEqual([]);
    expect(m.kioskOrderSections({})).toStrictEqual([]);
    expect(m.kioskOrderSections()).toStrictEqual([]);
  });

  test('names go through supplierLabel (short name wins); an empty section is not shown', () => {
    const sections = m.kioskOrderSections({
      toOrder: [{ id: 'a', name: 'Brava Foods Ltd', shortName: 'Brava' }, { id: 'b', name: 'Molino' }],
      arriving: [],
    });
    expect(sections).toStrictEqual([{ titleKey: 'kiosk.rest.toOrderTitle', names: ['Brava', 'Molino'], more: 0 }]);
    const both = m.kioskOrderSections({ toOrder: [{ id: 'a', name: 'A' }], arriving: [{ id: 'c', name: 'C' }] });
    expect(both.map(s => s.titleKey)).toStrictEqual(['kiosk.rest.toOrderTitle', 'kiosk.rest.arrivingTitle']);
    expect(m.kioskOrderSections({ toOrder: [], arriving: [{ id: 'c', name: 'C' }] }).map(s => s.titleKey))
      .toStrictEqual(['kiosk.rest.arrivingTitle']);
  });

  test('each section is capped at four names with the rest counted as +N', () => {
    const toOrder = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, name: `S${i + 1}` }));
    const [section] = m.kioskOrderSections({ toOrder });
    expect(m.MAX_SUPPLIERS_SHOWN).toBe(4);
    expect(section?.names).toStrictEqual(['S1', 'S2', 'S3', 'S4']);
    expect(section?.more).toBe(3);
  });

  test('a missing (deleted) supplier is skipped and a supplier is never listed twice', () => {
    const [section] = m.kioskOrderSections({ arriving: [null, undefined, { id: 'a', name: 'A' }, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
    expect(section?.names).toStrictEqual(['A', 'B']);
    expect(section?.more).toBe(0);
  });

  // 2026-10-07 is a Wednesday.
  const suppliers = [
    { id: 'm', name: 'Molino', orderDays: ['Wednesday'], deliveryDays: ['Wednesday'], active: true },
    { id: 'p', name: 'Placed', orderDays: ['Wednesday'], deliveryDays: ['Friday'], active: true },
    { id: 'g', name: 'Gone', orderDays: [], deliveryDays: ['Wednesday'], active: true },
    { id: 'off', name: 'Switched off', orderDays: ['Wednesday'], deliveryDays: ['Wednesday'], active: false },
  ];

  test('from Orders data: unplaced order days, and deliveries due today that are not delivered', () => {
    const history = [
      { id: '2026-10-07_p', date: '2026-10-07', supplierId: 'p' },
      { id: '2026-10-06_m', date: '2026-10-06', supplierId: 'm' },
      { id: '2026-10-06_x', date: '2026-10-06', supplierId: 'deleted' },
      { id: '2026-10-06_g', date: '2026-10-06', supplierId: 'g', deliveredAt: '2026-10-07T08:00:00Z' },
    ];
    const sections = m.kioskSectionsFromData({ suppliers, history, today: '2026-10-07', weekStartsOn: 'Sunday' });
    const byKey = Object.fromEntries(sections.map(s => [s.titleKey, s.names]));
    expect(byKey['kiosk.rest.toOrderTitle']).toStrictEqual(['Molino']);
    expect(byKey['kiosk.rest.arrivingTitle']).toStrictEqual(['Molino']);
  });

  test('from Orders data: nothing at all, and no day, give no sections', () => {
    expect(m.kioskSectionsFromData({ suppliers: [], history: [], today: '2026-10-07' })).toStrictEqual([]);
    expect(m.kioskSectionsFromData({ suppliers, history: [], today: '' })).toStrictEqual([]);
  });

  test('a supplier closed as not ordered today is not listed as to order', () => {
    // 6 November 2026 is a Friday.
    const FRIDAY = '2026-11-06';
    const ALBA = { id: 'alba', name: 'Alba', orderDays: ['Friday'], active: true };
    const BRAVA = { id: 'brava', name: 'Brava', orderDays: ['Friday'], active: true };
    const sections = m.kioskSectionsFromData({
      suppliers: [ALBA, BRAVA], history: [], today: FRIDAY, weekStartsOn: 'Sunday', skipped: { brava: FRIDAY },
    });
    expect(sections.find(s => s.titleKey === 'kiosk.rest.toOrderTitle')?.names).toStrictEqual(['Alba']);
    const none = m.kioskSectionsFromData({
      suppliers: [BRAVA], history: [], today: FRIDAY, weekStartsOn: 'Sunday', skipped: { brava: FRIDAY },
    });
    expect(none.find(s => s.titleKey === 'kiosk.rest.toOrderTitle')).toBeUndefined();
    // A close from another day changes nothing.
    const old = m.kioskSectionsFromData({
      suppliers: [BRAVA], history: [], today: FRIDAY, weekStartsOn: 'Sunday', skipped: { brava: '2026-10-30' },
    });
    expect(old.find(s => s.titleKey === 'kiosk.rest.toOrderTitle')?.names).toStrictEqual(['Brava']);
  });
});
