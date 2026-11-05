// Tests for «Did you send the order?» (P15), run against BOTH implementations: the TypeScript port in shared/
// and js/orders/sent-check.js, which the live app uses today. Ported from tests/order-sent-check.test.mjs; the
// module is a FULL port, so parity.spec.ts also compares its exports.
//
// PORTED: 7 of 13 tests of tests/order-sent-check.test.mjs — the ones that call the pure functions (the
// question asked or skipped, the words for one or several, the three outcomes, the suppliers to record, and the
// two «Send it now» message tests).
//
// NOT PORTED (6): the wiring test that reads the source of orders-main.js (1), the fake-DOM
// test of the dialog and the one that reads its source (2), the words in the dictionary (1), and the two about
// sendOffers / sendTexts, which are the send chooser's, not this file's.

import { describe, expect, test } from 'vitest';
import * as ported from './sent-check';
import * as portedText from './order-text';
import * as legacyJs from '../../js/orders/sent-check.js';
import * as legacyTextJs from '../../js/orders/order-text.js';

const legacy = legacyJs as unknown as typeof ported;
const legacyText = legacyTextJs as unknown as typeof portedText;

describe.each([
  ['shared/ (TypeScript)', ported, portedText],
  ['js/ (current app)', legacy, legacyText],
] as const)('%s', (_name, m, text) => {
  const { shouldAskSent, sentCheckPhrases, outcomeOf, suppliersToRecord, confirmedRows } = m;
  const { orderedItems, buildOrderMessage } = text;

  test('the question is asked for a normal recording and for the post-send prompt', () => {
    expect(shouldAskSent({ confirm: true })).toBe(true);
    expect(shouldAskSent({})).toBe(true);
  });

  test('the «placed yesterday» banner and the already-asked batch path skip it', () => {
    expect(shouldAskSent({ confirm: true, alreadySent: true })).toBe(false);
    expect(shouldAskSent({ confirm: false })).toBe(false);
  });

  test('one supplier or several picks the matching words', () => {
    expect(sentCheckPhrases(1, 'Brava')).toStrictEqual({
      titleKey: 'orders.sentCheck.one', titleVars: { name: 'Brava' },
      yesKey: 'orders.sentCheck.yes', sendNowKey: 'orders.sentCheck.sendNow',
    });
    expect(sentCheckPhrases(2, 'A and B')).toStrictEqual({
      titleKey: 'orders.sentCheck.many', titleVars: { names: 'A and B' },
      yesKey: 'orders.sentCheck.yesMany', sendNowKey: 'orders.sentCheck.sendNowMany',
    });
  });

  test('three outcomes: yes records, send-now sends first, anything else records nothing', () => {
    expect(outcomeOf('yes')).toStrictEqual({ record: true, sendFirst: false });
    expect(outcomeOf('sendNow')).toStrictEqual({ record: true, sendFirst: true });
    for (const cancelled of [null, undefined, false, 'cancel']) {
      expect(outcomeOf(cancelled)).toStrictEqual({ record: false, sendFirst: false });
    }
  });

  test('after a send only the suppliers the road reached are recorded; a backed-out chooser records none', () => {
    expect(suppliersToRecord(['a', 'b', 'c'], ['c', 'a'])).toStrictEqual(['a', 'c']);
    expect(suppliersToRecord(['a', 'b'], [])).toStrictEqual([]);
    expect(suppliersToRecord(['a'], undefined)).toStrictEqual([]);
  });

  // ⚠️ «Send it now» must write the SAME message the normal send screen writes for the same
  // numbers. The confirmed units are the unit every row showed (the card's own included); the
  // send screen drops it again wherever the card offers no choice.
  const cards = {
    s1: [
      { id: 'flour', name: 'Flour', weight: '', unit: 'kg' },                         // unit, no packUnit
      { id: 'oil', name: 'Oil', weight: '5 L', unit: 'KG' },                          // invoice-style unit
      { id: 'tom', name: 'Tomatoes', weight: '', unit: 'cartone', packUnit: 'busta' }, // a real choice
      { id: 'sugar', name: 'Sugar', weight: '', unit: 'kg', packUnit: 'busta' },
    ],
  };
  const draft = {                      // what the draft holds: no unit unless a non-default one was chosen
    flour: { qty: 3 }, oil: { qty: 2 }, tom: { qty: 4 }, sugar: { qty: 5, unit: 'busta' },
  };
  const confirmed = {                  // what the review screen froze: every row's unit, defaults included
    quantities: { s1: { flour: 3, oil: 2, tom: 4, sugar: 5 } },
    units: { s1: { flour: 'kg', oil: 'KG', tom: 'cartone', sugar: 'busta' } },
  };

  test('«Send it now» writes byte-for-byte the message of the normal send screen', () => {
    const normal = orderedItems(cards.s1, draft);
    const now = confirmedRows([{ id: 's1', name: 'Brava' }], cards, confirmed)[0]!.items;
    const message = (items: typeof normal) => buildOrderMessage([{ supplierName: 'Brava', items }], { locationName: 'Venue' });
    expect(message(now)).toBe(message(normal));
    // And the lines really are the expected ones: a unit only where there is a choice.
    expect(message(now)).toMatch(/- Flour: 3\n/);
    expect(message(now)).toMatch(/- Oil: 2\n/);
    expect(message(now)).toMatch(/- Tomatoes: 4 × cartone$/);
    expect(message(now)).toMatch(/- Sugar: 5 × busta\n/);
  });

  test('«Send it now» carries the CORRECTED number, not the draft one', () => {
    const corrected = { ...confirmed, quantities: { s1: { flour: 9, oil: 2, tom: 4, sugar: 5 } } };
    const items = confirmedRows([{ id: 's1', name: 'Brava' }], cards, corrected)[0]!.items;
    expect(items.find(i => i.name === 'Flour')!.qty).toBe(9);
    expect(confirmedRows([{ id: 's1', name: 'Brava' }], cards, { quantities: { s1: {} }, units: {} })).toStrictEqual([]);
  });
});
