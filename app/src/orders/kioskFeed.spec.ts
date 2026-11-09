// The kiosk's Orders lines honour the goods-arrived switch (step 3f-8, decision F4 (c)).
import { describe, expect, test } from 'vitest';
import { deliveryCheckOf } from '@mise/shared/delivery-check';
import { kioskSectionsFor } from './kioskFeed';

// 2026-10-07 is a Wednesday.
const suppliers = [
  { id: 'm', name: 'Molino', orderDays: ['Wednesday'], deliveryDays: ['Wednesday'], active: true },
  { id: 'b', name: 'Brava', orderDays: [], deliveryDays: ['Wednesday'], active: true },
];
const history = [
  // Both expected today, Wednesday (the next delivery day after the day each was recorded).
  { id: '2026-10-05_m', date: '2026-10-05', supplierId: 'm' },
  { id: '2026-10-06_b', date: '2026-10-06', supplierId: 'b' },
];
const base = { suppliers, history, today: '2026-10-07', weekStartsOn: 'Sunday' };
const byKey = (sections: ReturnType<typeof kioskSectionsFor>) => Object.fromEntries(sections.map(s => [s.titleKey, s.names]));

describe('kioskSectionsFor', () => {
  test('the check on (absent = on): both lines, as the current app draws them', () => {
    const sections = kioskSectionsFor({ ...base, deliveryCheck: deliveryCheckOf(null) });
    expect(sections.map(s => s.titleKey)).toStrictEqual(['kiosk.rest.toOrderTitle', 'kiosk.rest.arrivingTitle']);
    expect(byKey(sections)['kiosk.rest.toOrderTitle']).toStrictEqual(['Molino']);
    expect(byKey(sections)['kiosk.rest.arrivingTitle']).toStrictEqual(['Molino', 'Brava']);
  });

  test('the check off: no «arriving» line at all, «to order» unchanged', () => {
    const sections = kioskSectionsFor({ ...base, deliveryCheck: deliveryCheckOf({ deliveryCheck: false }) });
    expect(sections.map(s => s.titleKey)).toStrictEqual(['kiosk.rest.toOrderTitle']);
    expect(sections[0]?.names).toStrictEqual(['Molino']);
  });

  test('turned back on yesterday: an order recorded before that day is not «arriving»', () => {
    const sections = kioskSectionsFor({ ...base, deliveryCheck: deliveryCheckOf({ deliveryCheck: true, deliveryCheckFrom: '2026-10-06' }) });
    expect(byKey(sections)['kiosk.rest.arrivingTitle']).toStrictEqual(['Brava']);
    // «To order today» still sees every record: Molino has no order under today, so it is still to order.
    expect(byKey(sections)['kiosk.rest.toOrderTitle']).toStrictEqual(['Molino']);
  });

  test('an order placed today takes the supplier off «to order», whatever the switch says', () => {
    const placed = [...history, { id: '2026-10-07_m', date: '2026-10-07', supplierId: 'm' }];
    const sections = kioskSectionsFor({ ...base, history: placed, deliveryCheck: deliveryCheckOf({ deliveryCheck: false }) });
    expect(sections).toStrictEqual([]);
  });
});
