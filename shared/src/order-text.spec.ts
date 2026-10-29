// Unit tests for the Orders WhatsApp message builder (P15), run against BOTH implementations: the TypeScript
// port in shared/ and js/orders/order-text.js, which the live app uses today. Ported from
// tests/order-text.test.mjs; the module is a FULL port, so parity.spec.ts also compares its exports.
//
// PORTED: 42 of 42 tests of tests/order-text.test.mjs. (tests/order-cost-message.test.mjs and
// tests/same-day-sends.test.mjs are left out: they exercise order-cost, the sends and the archive, which are not
// all ported yet.)
//
// This text is what the SUPPLIER actually receives, so a mistake here is not a UI
// glitch: it is a wrong order arriving at the bakery. The same builder is now used
// from two sources — the draft being typed, and a history record being re-sent — and
// these tests pin that both produce byte-identical output for the same order.

import { describe, expect, test } from 'vitest';
import * as ported from './order-text';
import * as legacyJs from '../../js/orders/order-text.js';

const legacy = legacyJs as unknown as typeof ported;

// The location placing the order. It used to be baked into the builder as a
// constant; it now comes from the signed-in session, so every message test says
// it out loud — that is the point of the change.
const CLUB = { locationName: 'The Italian Club' };

const ingredients = [
  { id: 'i1', name: 'Bacon', weight: '2.27kg', unit: 'casse' },
  { id: 'i2', name: 'Mozzarella', weight: '1kg', unit: 'box' },
  { id: 'i3', name: 'Loose apples', weight: '' },
];

const CHOICE = { id: 'f', name: 'Flour', weight: '2.5kg', unit: 'cartone', packUnit: 'busta' };
const PLAIN = { id: 'b', name: 'Bacon', weight: '2.27kg', unit: 'casse' };

const THREE_SUPPLIERS = [
  { supplierName: 'Cielo', items: [{ name: 'Bacon', weight: '2.27kg', qty: 4 }] },
  { supplierName: 'Alba', items: [{ name: 'Mozzarella', weight: '5kg', qty: 2 }] },
  { supplierName: 'No supplier', items: [{ name: 'Baking Paper', weight: '', qty: 2 }] },
];

const ONE = [{ supplierName: 'Etna', items: [{ name: 'Flour', weight: '25kg', qty: 1 }] }];
const TWO = [...ONE, { supplierName: 'Alba', items: [{ name: 'Olives', weight: '', qty: 2 }] }];

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const {
    buildOrderMessage, orderTitle, itemsFromQuantities, indexById, itemLabel, whatsappUrl, sortItems,
    orderedItems, summaryLines, fallbackSupplierName, emailSubject,
  } = m;

  test('a one-supplier message is the title, a blank line and the lines', () => {
    const text = buildOrderMessage([
      { supplierName: 'Brava Fresh', items: [
        { name: 'Bacon', weight: '2.27kg', qty: 5 },
        { name: 'Mozzarella', weight: '1kg', qty: 2 },
      ] },
    ], CLUB);
    expect(text).toBe('*Order — The Italian Club*\n\n' + '- Bacon: 5\n' + '- Mozzarella: 2');
  });

  test('several suppliers are separated by a blank line', () => {
    const text = buildOrderMessage([
      { supplierName: 'Etna', items: [{ name: 'Flour', weight: '25kg', qty: 4 }] },
      { supplierName: 'Alba', items: [{ name: 'Olives', weight: '', qty: 1 }] },
    ], CLUB);
    expect(text).toBe('*Order — The Italian Club*\n\n' + '*Etna*\n- Flour: 4\n\n' + '*Alba*\n- Olives: 1');
  });

  test('an empty weight is skipped, leaving no double space', () => {
    expect(itemLabel('Loose apples', '')).toBe('Loose apples');
    expect(itemLabel('Bacon', '2.27kg')).toBe('Bacon 2.27kg');
  });

  test('the order unit never reaches the supplier for an ingredient WITHOUT a unit choice — only the number', () => {
    const text = buildOrderMessage([
      { supplierName: 'S', items: [{ name: 'Bacon', weight: '2.27kg', qty: 3 }] },
    ], CLUB);
    expect(text.includes('casse'), 'the order unit is a private reminder').toBe(false);
    expect(text.includes('- Bacon: 3')).toBe(true);
  });

  test('a supplier with no items is dropped, and an empty order builds no message', () => {
    const text = buildOrderMessage([
      { supplierName: 'Empty', items: [] },
      { supplierName: 'Real', items: [{ name: 'Flour', weight: '', qty: 2 }] },
    ], CLUB);
    expect(text.includes('Empty')).toBe(false);
    expect(buildOrderMessage([{ supplierName: 'Empty', items: [] }])).toBe('');
    expect(buildOrderMessage([])).toBe('');
    expect(buildOrderMessage(null)).toBe('');
  });

  // ── Building from a stored history record ──────────────────────────────────
  test('a history record produces the same message as the draft did', () => {
    const byId = indexById(ingredients);
    const fromHistory = buildOrderMessage([{
      supplierName: 'Brava Fresh',
      items: itemsFromQuantities({ i1: 5, i2: 2 }, byId),
    }], CLUB);
    const fromDraft = buildOrderMessage([{
      supplierName: 'Brava Fresh',
      items: [
        { name: 'Bacon', weight: '2.27kg', qty: 5 },
        { name: 'Mozzarella', weight: '1kg', qty: 2 },
      ],
    }], CLUB);
    expect(fromHistory, 're-sending a placed order must read exactly like the original').toBe(fromDraft);
  });

  test('items are sorted by their displayed label, not by id', () => {
    const byId = indexById(ingredients);
    const items = itemsFromQuantities({ i2: 1, i1: 1, i3: 1 }, byId);
    expect(items.map(i => i.name)).toStrictEqual(['Bacon', 'Loose apples', 'Mozzarella']);
  });

  test('an ingredient deleted since the order keeps the name it was ordered under', () => {
    // The record froze the label when the order was placed, so re-sending it still
    // tells the supplier what to bring.
    const items = itemsFromQuantities({ gone: 3 }, indexById(ingredients), { gone: 'Ricotta 1.5kg' });
    expect(items).toStrictEqual([{ name: 'Ricotta 1.5kg', weight: '', qty: 3 }]);
  });

  test('an order recorded before names were kept says so, never sends a raw id', () => {
    // Every record written before this feature has no `names`. "gone: 3" in a WhatsApp
    // message is worse than useless to a supplier — it looks like a product code.
    const items = itemsFromQuantities({ gone: 3 }, indexById(ingredients));
    expect(items).toStrictEqual([{ name: 'Deleted ingredient', weight: '', qty: 3 }]);
  });

  test('a live ingredient always wins over the frozen name — a rename shows through', () => {
    const items = itemsFromQuantities({ i1: 2 }, indexById(ingredients), { i1: 'Old name' });
    expect(items).toStrictEqual([{ name: 'Bacon', weight: '2.27kg', qty: 2 }]);
  });

  test('zero and junk quantities are dropped, never sent to a supplier', () => {
    const byId = indexById(ingredients);
    expect(itemsFromQuantities({ i1: 0 }, byId)).toStrictEqual([]);
    expect(itemsFromQuantities({ i1: -2 }, byId)).toStrictEqual([]);
    expect(itemsFromQuantities({ i1: 'HELLO' }, byId)).toStrictEqual([]);
    expect(itemsFromQuantities({ i1: null }, byId)).toStrictEqual([]);
    expect(itemsFromQuantities({}, byId)).toStrictEqual([]);
    expect(itemsFromQuantities(null, byId)).toStrictEqual([]);
  });

  test('a decimal quantity is rounded, so no supplier is asked for 2.5 boxes', () => {
    const items = itemsFromQuantities({ i1: 2.4 }, indexById(ingredients));
    expect(items).toStrictEqual([{ name: 'Bacon', weight: '2.27kg', qty: 2 }]);
  });

  test('the WhatsApp url carries no recipient — the operator picks the chat', () => {
    const url = whatsappUrl('*Order*\n- x: 1');
    expect(url.startsWith('https://wa.me/?text='), 'empty path = no recipient').toBe(true);
    expect(decodeURIComponent(url.split('?text=')[1] as string)).toBe('*Order*\n- x: 1');
  });

  test('the builder sorts the lines itself, whatever order the caller passes', () => {
    // The draft used to hand items over in raw Firestore order. Sorting inside the
    // builder is what makes a draft send and a later re-send from History identical.
    const shuffled = buildOrderMessage([{
      supplierName: 'S',
      items: [
        { name: 'Mozzarella', weight: '1kg', qty: 2 },
        { name: 'Bacon', weight: '2.27kg', qty: 5 },
      ],
    }], CLUB);
    expect(shuffled).toBe('*Order — The Italian Club*\n\n- Bacon: 5\n- Mozzarella: 2');
  });

  test('sortItems does not mutate the caller\'s array', () => {
    const items = [{ name: 'B', weight: '', qty: 1 }, { name: 'A', weight: '', qty: 1 }];
    const sorted = sortItems(items);
    expect(items.map(i => i.name), 'the original must be untouched').toStrictEqual(['B', 'A']);
    expect(sorted.map(i => i.name)).toStrictEqual(['A', 'B']);
  });

  // ── "One list": a shopping list for yourself, not an order for a supplier ──
  //
  // The second format has no supplier headings, so it must never be reachable by
  // accident. These tests pin the new shape AND stand guard over the old one.

  test('One list drops every supplier heading and sorts the whole order A-Z', () => {
    expect(buildOrderMessage(THREE_SUPPLIERS, { grouped: false, ...CLUB })).toBe(
      '*Order — The Italian Club*\n\n' + '- Bacon: 4\n' + '- Baking Paper: 2\n' + '- Mozzarella: 2');
  });

  test('the By supplier format is byte-identical with or without the option', () => {
    // The guard that matters most: this is the message a SUPPLIER receives, and adding
    // a second format must not have moved a single character of it.
    const golden =
      '*Order — The Italian Club*\n\n' +
      '*Cielo*\n- Bacon: 4\n\n' +
      '*Alba*\n- Mozzarella: 2\n\n' +
      '*No supplier*\n- Baking Paper: 2';
    expect(buildOrderMessage(THREE_SUPPLIERS, CLUB)).toBe(golden);
    expect(buildOrderMessage(THREE_SUPPLIERS, { ...CLUB })).toBe(golden);
    expect(buildOrderMessage(THREE_SUPPLIERS, { grouped: true, ...CLUB })).toBe(golden);
  });

  test('One list adds up two lines carrying the same label', () => {
    // The same product bought from two suppliers is one thing to buy.
    const text = buildOrderMessage([
      { supplierName: 'Etna', items: [{ name: 'Flour', weight: '25kg', qty: 4 }] },
      { supplierName: 'Alba', items: [{ name: 'Flour', weight: '25kg', qty: 3 }] },
    ], { grouped: false, ...CLUB });
    expect(text).toBe('*Order — The Italian Club*\n\n- Flour: 7');
  });

  test('…while the By supplier format keeps them apart, one line per supplier', () => {
    const text = buildOrderMessage([
      { supplierName: 'Etna', items: [{ name: 'Flour', weight: '25kg', qty: 4 }] },
      { supplierName: 'Alba', items: [{ name: 'Flour', weight: '25kg', qty: 3 }] },
    ], CLUB);
    expect(text).toBe('*Order — The Italian Club*\n\n*Etna*\n- Flour: 4\n\n*Alba*\n- Flour: 3');
  });

  test('One list distinguishes two weights of the same product', () => {
    const text = buildOrderMessage([
      { supplierName: 'S', items: [
        { name: 'Flour', weight: '25kg', qty: 1 },
        { name: 'Flour', weight: '1kg', qty: 2 },
      ] },
    ], { grouped: false, ...CLUB });
    expect(text).toBe('*Order — The Italian Club*\n\n- Flour 1kg: 2\n- Flour 25kg: 1');
  });

  test('One list never sends a line worth nothing', () => {
    const text = buildOrderMessage([
      { supplierName: 'S', items: [
        { name: 'Bacon', weight: '', qty: 0 },
        { name: 'Flour', weight: '', qty: 3 },
      ] },
    ], { grouped: false, ...CLUB });
    expect(text).toBe('*Order — The Italian Club*\n\n- Flour: 3');
  });

  test('One list with nothing to send builds no message at all', () => {
    expect(buildOrderMessage([], { grouped: false, ...CLUB })).toBe('');
    expect(buildOrderMessage(null, { grouped: false, ...CLUB })).toBe('');
    expect(buildOrderMessage(
      [{ supplierName: 'S', items: [{ name: 'x', weight: '', qty: 0 }] }],
      { grouped: false },
    ), 'a group whose every quantity is zero must not open an empty chat').toBe('');
  });

  test('One list rounds and ignores junk exactly as the grouped format does', () => {
    const text = buildOrderMessage([
      { supplierName: 'S', items: [
        { name: 'Bacon', weight: '', qty: 2.4 },
        { name: 'Cream', weight: '', qty: 'HELLO' },
        { name: 'Dates', weight: '', qty: -5 },
        { name: 'Eggs', weight: '', qty: 1 },
      ] },
    ], { grouped: false, ...CLUB });
    expect(text).toBe('*Order — The Italian Club*\n\n- Bacon: 2\n- Eggs: 1');
  });

  // ── Who the order is from ──────────────────────────────────────────────────
  // The title used to be a constant. With more than one location that constant
  // would have signed one location's order with another's name — the supplier
  // would deliver to the wrong place and nothing on screen would have looked odd.

  test('the title names the location that is placing the order', () => {
    expect(orderTitle('Trattoria Rosa')).toBe('*Order — Trattoria Rosa*');
    const text = buildOrderMessage(
      [{ supplierName: 'Etna', items: [{ name: 'Flour', weight: '25kg', qty: 1 }] }],
      { locationName: 'Trattoria Rosa' });
    expect(text.startsWith('*Order — Trattoria Rosa*')).toBe(true);
    expect(text.includes('Italian Club')).toBe(false);
  });

  test('with no name the order goes out anonymous rather than wrongly signed', () => {
    ['', '   ', null, undefined].forEach(missing => {
      expect(orderTitle(missing), `${JSON.stringify(missing)} must not invent a name`).toBe('*Order*');
    });
    const text = buildOrderMessage(
      [{ supplierName: 'Etna', items: [{ name: 'Flour', weight: '25kg', qty: 1 }] }]);
    expect(text.startsWith('*Order*\n')).toBe(true);
  });

  // ── Ingredients that can be ordered in more than one unit (30 Sep 2026) ────
  // «2 cartoni» and «2 buste» are different orders, so a line of such an ingredient says
  // which — and ONLY such a line: everything else stays byte-identical.

  test('a line with a unit choice says its unit; the default choice says it too', () => {
    const chosen = orderedItems([CHOICE], { f: { qty: 2, stock: 0, unit: 'busta' } });
    expect(buildOrderMessage([{ supplierName: 'S', items: chosen }], CLUB)).toBe(
      '*Order — The Italian Club*\n\n- Flour: 2 × busta');
    const dflt = orderedItems([CHOICE], { f: { qty: 2, stock: 0 } });
    expect(buildOrderMessage([{ supplierName: 'S', items: dflt }], CLUB)).toBe(
      '*Order — The Italian Club*\n\n- Flour: 2 × cartone');
  });

  test('lines of ingredients WITHOUT a choice are byte-identical to before', () => {
    const items = orderedItems([PLAIN], { b: { qty: 3, stock: 0 } });
    expect(items).toStrictEqual([{ name: 'Bacon', weight: '2.27kg', qty: 3 }]);
    expect(buildOrderMessage([{ supplierName: 'S', items }], CLUB)).toBe(
      '*Order — The Italian Club*\n\n- Bacon: 3');
  });

  test('summary lines and message lines stay the same thing for a unit line', () => {
    const items = orderedItems([CHOICE, PLAIN], { f: { qty: 2, unit: 'busta' }, b: { qty: 1 } });
    const text = buildOrderMessage([{ supplierName: 'S', items }], CLUB);
    // The summary keeps the weight (the tablet matches lines to ingredients by it); the
    // message drops it — same lines, same order, same quantities and units.
    const fromSummary = summaryLines(items).map(({ label, qty, unit }) =>
      `- ${label.replace(/ [0-9.]+kg$/, '')}: ${unit ? `${qty} × ${unit}` : qty}`);
    expect(text.split('\n').slice(2)).toStrictEqual(fromSummary);
    expect(summaryLines(items).map(l => l.label)).toStrictEqual(['Bacon 2.27kg', 'Flour 2.5kg']);
  });

  test('the weight is not in the message, and the lines keep their order', () => {
    const text = buildOrderMessage([{ supplierName: 'S', items: [
      { name: 'Mozzarella', weight: '1kg', qty: 2 },
      { name: 'Bacon', weight: '2.27kg', qty: 5 },
    ] }], CLUB);
    expect(text).toBe('*Order — The Italian Club*\n\n- Bacon: 5\n- Mozzarella: 2');
  });

  test('same name twice in one supplier: those lines keep their weights, a third item does not', () => {
    const text = buildOrderMessage([{ supplierName: 'S', items: [
      { name: 'Flour', weight: '25kg', qty: 3 },
      { name: 'Bacon', weight: '2.27kg', qty: 1 },
      { name: 'FLOUR', weight: '5kg', qty: 2 },
    ] }], CLUB);
    expect(text).toBe('*Order — The Italian Club*\n\n- Bacon: 1\n- FLOUR 5kg: 2\n- Flour 25kg: 3');
  });

  test('the same name in two DIFFERENT suppliers does not keep the weight (grouped)', () => {
    const text = buildOrderMessage([
      { supplierName: 'Etna', items: [{ name: 'Flour', weight: '25kg', qty: 4 }] },
      { supplierName: 'Alba', items: [{ name: 'Flour', weight: '5kg', qty: 3 }] },
    ], CLUB);
    expect(text).toBe('*Order — The Italian Club*\n\n*Etna*\n- Flour: 4\n\n*Alba*\n- Flour: 3');
  });

  test('the same name from two suppliers keeps the weight in the flat list', () => {
    const text = buildOrderMessage([
      { supplierName: 'Etna', items: [{ name: 'Flour', weight: '25kg', qty: 4 }, { name: 'Bacon', weight: '1kg', qty: 1 }] },
      { supplierName: 'Alba', items: [{ name: 'Flour', weight: '5kg', qty: 3 }] },
    ], { grouped: false, ...CLUB });
    expect(text).toBe('*Order — The Italian Club*\n\n- Bacon: 1\n- Flour 25kg: 4\n- Flour 5kg: 3');
  });

  test('one shopping list never adds different units together, and does add equal ones', () => {
    const text = buildOrderMessage([
      { supplierName: 'A', items: [{ name: 'Flour', weight: '2.5kg', qty: 2, unit: 'busta' }] },
      { supplierName: 'B', items: [
        { name: 'Flour', weight: '2.5kg', qty: 1, unit: 'cartone' },
        { name: 'Flour', weight: '2.5kg', qty: 3, unit: 'Busta' },
      ] },
    ], { ...CLUB, grouped: false });
    expect(text).toBe('*Order — The Italian Club*\n\n- Flour 2.5kg: 5 × busta\n- Flour 2.5kg: 1 × cartone');
  });

  test('a re-sent record shows only the units it froze', () => {
    const byId = indexById([CHOICE, PLAIN]);
    const items = itemsFromQuantities({ f: 4, b: 2 }, byId, {}, { f: 'busta' });
    expect(items.find(i => i.name === 'Flour')?.unit).toBe('busta');
    expect('unit' in (items.find(i => i.name === 'Bacon') as object)).toBe(false);
    // An old record with no `units` reads exactly as it always did.
    expect('unit' in (itemsFromQuantities({ f: 4 }, byId, {})[0] as object)).toBe(false);
  });

  // ── Title language and supplier headings (1 Oct 2026) ──────────────────────
  // The title word is the venue's COUNTRY language (outputLanguage), passed in by the caller;
  // a message carrying ONE supplier has no heading, several keep theirs.

  test('an Italian venue titles the message «Ordine», an English one «Order»', () => {
    expect(orderTitle('Panificio Miano', 'it')).toBe('*Ordine — Panificio Miano*');
    expect(orderTitle('The Italian Club', 'en')).toBe('*Order — The Italian Club*');
    expect(buildOrderMessage(ONE, { locationName: 'Panificio Miano', language: 'it' })
      .startsWith('*Ordine — Panificio Miano*\n\n')).toBe(true);
    expect(buildOrderMessage(ONE, { locationName: 'The Italian Club', language: 'en' })
      .startsWith('*Order — The Italian Club*\n\n')).toBe(true);
  });

  test('an unknown country falls back to English, and a nameless Italian order is «Ordine»', () => {
    expect(orderTitle('X', null)).toBe('*Order — X*');
    expect(orderTitle('X')).toBe('*Order — X*');
    expect(orderTitle('', 'it')).toBe('*Ordine*');
  });

  test('the One list format takes the title word too', () => {
    expect(buildOrderMessage(TWO, { grouped: false, locationName: 'Panificio Miano', language: 'it' })).toBe(
      '*Ordine — Panificio Miano*\n\n- Flour: 1\n- Olives: 2');
  });

  test('a message for ONE supplier has no supplier heading', () => {
    expect(buildOrderMessage(ONE, CLUB)).toBe('*Order — The Italian Club*\n\n- Flour: 1');
    // A second supplier with nothing in it does not count as a second supplier.
    const withEmpty = [...ONE, { supplierName: 'Empty', items: [] }];
    expect(buildOrderMessage(withEmpty, CLUB)).toBe('*Order — The Italian Club*\n\n- Flour: 1');
  });

  test('a grouped message for SEVERAL suppliers keeps every heading', () => {
    expect(buildOrderMessage(TWO, CLUB)).toBe(
      '*Order — The Italian Club*\n\n*Etna*\n- Flour: 1\n\n*Alba*\n- Olives: 2');
  });

  // ── The other words a supplier reads follow the country too (1 Oct 2026) ───

  test('the heading of a nameless supplier follows the country language', () => {
    const two = [
      { supplierName: '', items: [{ name: 'Flour', weight: '', qty: 1 }] },
      { supplierName: 'Alba', items: [{ name: 'Olives', weight: '', qty: 2 }] },
    ];
    expect(buildOrderMessage(two, { language: 'it' }).includes('*Ordine*\n- Flour: 1')).toBe(true);
    expect(buildOrderMessage(two, { language: 'en' }).includes('*Order*\n- Flour: 1')).toBe(true);
    expect(fallbackSupplierName('it')).toBe('Ordine');
    expect(fallbackSupplierName(null)).toBe('Order');
  });

  test('an ingredient deleted since the order is named in the country language', () => {
    expect(itemsFromQuantities({ gone: 3 }, {}, {}, {}, 'it')).toStrictEqual(
      [{ name: 'Ingrediente eliminato', weight: '', qty: 3 }]);
    expect(itemsFromQuantities({ gone: 3 }, {}, {}, {}, 'en')).toStrictEqual(
      [{ name: 'Deleted ingredient', weight: '', qty: 3 }]);
    expect(itemsFromQuantities({ gone: 3 }, {})[0]?.name).toBe('Deleted ingredient');
  });

  test('the email subject follows the country language, like the body', () => {
    expect(emailSubject('Panificio Miano', 'it')).toBe('Ordine da Panificio Miano');
    expect(emailSubject('The Italian Club', 'en')).toBe('Order from The Italian Club');
    expect(emailSubject('X', null)).toBe('Order from X');
    expect(emailSubject(null, 'it')).toBe('Ordine da ');
  });
});

describe('order-text: what only the port can say', () => {
  test('compareLabels compares numerically, so «Flour 5kg» comes before «Flour 25kg»', () => {
    expect(ported.compareLabels('Flour 5kg', 'Flour 25kg')).toBeLessThan(0);
    expect(legacy.compareLabels('Flour 5kg', 'Flour 25kg')).toBeLessThan(0);
  });
});
