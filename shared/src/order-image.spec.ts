// Tests for the order picture's layout (P15), run against BOTH implementations: the TypeScript port in shared/ and
// js/orders/order-image.js, which the live app uses today. Ported from tests/order-image.test.mjs.
//
// order-image.ts is a PARTIAL port, so parity.spec.ts does not pair it: the last describe compares what IS ported with
// the js/ file itself (names, constants, arity), and checks the original still exports what is left out.
//
// PORTED: 7 of 30 tests of tests/order-image.test.mjs — bold parsing, the five layout tests and the file name.
// NOT PORTED here: the ink pinned to the current app's tokens.css (it pins the js/ constant, and the port's is compared
// with it below); canSharePhotos and sharePhoto (browser half, specced in app/src/orders/orderImage.spec.ts); and the
// twenty-two tests of the send chooser and the picker that live in the same file (send-chooser.spec.ts takes the pure ones;
// the rest read the current app's DOM code and have their Mise 2 counterparts in the app's specs).

import { describe, expect, test } from 'vitest';
import * as ported from './order-image';
import * as portedText from './order-text';
import * as legacyJs from '../../js/orders/order-image.js';
import * as legacyTextJs from '../../js/orders/order-text.js';

const legacy = legacyJs as unknown as typeof ported;
const legacyText = legacyTextJs as unknown as typeof portedText;

// 20px per character, bold the same: easy to reason about.
const measure = (s: string) => [...s].length * 20;
const WIDTH = { width: 400 + 2 * 10, padding: 10 };   // room for exactly 20 characters

describe.each([
  ['shared/ (TypeScript)', ported, portedText],
  ['js/ (current app)', legacy, legacyText],
] as const)('%s', (_name, m, text) => {
  const { parseBold, layoutOrder, plainLines, imageFileName } = m;

  test('*bold* is drawn bold without its asterisks; a lone asterisk stays', () => {
    expect(parseBold('*Ordine — X*')).toStrictEqual([{ text: 'Ordine — X', bold: true }]);
    expect(parseBold('- a: 2')).toStrictEqual([{ text: '- a: 2', bold: false }]);
    expect(parseBold('x *y* z')).toStrictEqual([
      { text: 'x ', bold: false }, { text: 'y', bold: true }, { text: ' z', bold: false }]);
    expect(parseBold('A*B')).toStrictEqual([{ text: 'A*B', bold: false }]);
  });

  test('the picture shows the same lines as buildOrderMessage, bold marks removed', () => {
    const message = text.buildOrderMessage([
      { supplierName: 'Alfa', items: [{ name: 'Flour', weight: '25kg', qty: 2 }] },
      { supplierName: 'Beta', items: [{ name: 'Milk', weight: '', qty: 6 }] },
    ], { grouped: true, locationName: 'Venue', language: 'it' });
    const layout = layoutOrder(message, () => 1);   // nothing ever wraps
    expect(plainLines(layout)).toStrictEqual(message.replace(/\*/g, '').split('\n'));
    const boldRuns = layout.lines.flat().filter(s => s.bold).map(s => s.text);
    expect(boldRuns).toContain('Alfa');
    expect(boldRuns).toContain('Beta');
  });

  test('long lines wrap to the width and no word is lost', () => {
    const source = 'alpha beta gamma delta epsilon zeta eta theta';
    const rows = plainLines(layoutOrder(source, measure, WIDTH));
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) expect(measure(r), r).toBeLessThanOrEqual(400);
    expect(rows.join(' ')).toBe(source);
  });

  test('a word wider than the page is cut by character, nothing dropped', () => {
    const word = 'x'.repeat(45);
    const rows = plainLines(layoutOrder(word, measure, WIDTH));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.join('')).toBe(word);
  });

  test('wrapping keeps bold on the bold words', () => {
    const layout = layoutOrder('*one two three four five six seven*', measure, WIDTH);
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.lines.flat().every(s => s.bold)).toBe(true);
  });

  test('blank lines are kept and the height is fitted to the content', () => {
    const layout = layoutOrder('a\n\nb', measure, WIDTH);
    expect(plainLines(layout)).toStrictEqual(['a', '', 'b']);
    expect(layout.height).toBe(2 * 10 + 3 * layout.step);
    expect(layout.step).toBe(Math.round(40 * 1.45));
  });

  test('the page is 1080 wide with 64px of padding; nothing at all is one empty line', () => {
    expect(m.IMAGE_WIDTH).toBe(1080);
    expect(m.IMAGE_PADDING).toBe(64);
    expect(layoutOrder('a', measure).width).toBe(1080);
    expect(plainLines(layoutOrder(null, measure))).toStrictEqual(['']);
  });

  test('the file name is the order word of the venue language plus the date, nothing else', () => {
    expect(imageFileName(new Date(2026, 9, 7), 'en')).toBe('order-2026-10-07.png');
    expect(imageFileName(new Date(2026, 9, 7), 'it')).toBe('ordine-2026-10-07.png');
    expect(imageFileName(new Date(2026, 9, 7))).toBe('order-2026-10-07.png');
  });
});

describe('what is ported, compared with the original', () => {
  const port = ported as unknown as Record<string, unknown>;
  const original = legacyJs as unknown as Record<string, unknown>;
  const shared = ['INK', 'PAPER', 'IMAGE_WIDTH', 'IMAGE_PADDING', 'FONT_SIZE', 'LINE_HEIGHT',
    'parseBold', 'layoutOrder', 'plainLines', 'imageFileName'];
  const LEFT_OUT = ['FONT_FAMILY', 'renderOrderImage', 'probeFile', 'canSharePhotos', 'sharePhoto'];

  test('the original still exports everything this port leaves out', () => {
    for (const name of LEFT_OUT) expect(name in original, name).toBe(true);
  });

  test('the port and the original together export exactly the ported names and the left-out ones', () => {
    expect(Object.keys(original).sort()).toStrictEqual([...shared, ...LEFT_OUT].sort());
    expect(Object.keys(port).sort()).toStrictEqual([...shared].sort());
  });

  test('every constant is equal; every function has the same name and the same number of required parameters', () => {
    for (const name of shared) {
      if (typeof original[name] !== 'function') { expect(port[name], name).toStrictEqual(original[name]); continue; }
      const mine = port[name] as (...args: unknown[]) => unknown;
      const theirs = original[name] as (...args: unknown[]) => unknown;
      expect(mine.name, name).toBe(theirs.name);
      expect(mine.length, `${name}: arity`).toBe(theirs.length);
    }
  });
});
