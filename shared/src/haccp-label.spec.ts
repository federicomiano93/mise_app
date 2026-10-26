// The HACCP label: its settings as config/labels holds them, what it says, and where everything goes — measured with the
// label's real width table, as the screen measures it.

import { describe, expect, test } from 'vitest';
import {
  BLANK_ROW, HACCP_DEFAULTS, HACCP_DEFAULT_SIZE, HACCP_FIELDS, HACCP_MARGIN, HACCP_SIZES, ROW,
  dateFromInput, firstNameOf, haccpCaption, haccpContent, haccpListCategory, haccpSettingsOf, haccpSizeDots, inputFromDate,
  layoutHaccpLabel, lotFromDate,
} from './haccp-label';
import type { HaccpContent, HaccpField, HaccpState, HaccpValues } from './haccp-label';
import { measureLikePillow } from './label-image-fonts';
import { BODY_PX, S } from './label-image-layout';
import type { LayoutElement, Measure } from './label-image-layout';
import { labelMetrics } from './label-image-metrics';

const measure: Measure = (text, font, px) => measureLikePillow(labelMetrics(), text, font, px);

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

const values = (over: Partial<HaccpValues> = {}): HaccpValues => ({
  name: 'Crema pasticcera',
  preparedOn: day(2026, 10, 26),
  useBy: day(2026, 10, 29),
  lot: '261026',
  preparedBy: 'Anna',
  storage: 'In frigorifero a +4 °C',
  blastChilledOn: day(2026, 10, 26),
  frozenOn: null,
  openedOn: day(2026, 10, 27),
  quantity: '2 kg',
  allergens: ['latte', 'uova'],
  mayContain: [],
  ...over,
});

const only = (on: Partial<Record<HaccpField, HaccpState>>): Record<HaccpField, HaccpState> => {
  const fields = {} as Record<HaccpField, HaccpState>;
  for (const f of HACCP_FIELDS) fields[f] = on[f] ?? 'off';
  return fields;
};
const all = (state: HaccpState) => only(Object.fromEntries(HACCP_FIELDS.map(f => [f, state])));

type Text = Extract<LayoutElement, { kind: 'text' }>;
type Rect = Extract<LayoutElement, { kind: 'rect' }>;
const texts = (els: readonly LayoutElement[]) => els.filter((e): e is Text => e.kind === 'text');
const rects = (els: readonly LayoutElement[]) => els.filter((e): e is Rect => e.kind === 'rect');

describe('the settings', () => {
  test('a venue that never opened the card gets the defaults: name, dates, allergens; the person off (P13)', () => {
    const s = haccpSettingsOf(undefined);
    expect(s.fields).toEqual(HACCP_DEFAULTS);
    expect(s.fields.preparedBy).toBe('off');
    expect(s.size).toBe(HACCP_DEFAULT_SIZE);
    expect(s.category).toBeNull();
  });

  test('each field is read on its own; an unknown state is that field\'s default, never «off»', () => {
    const s = haccpSettingsOf({ haccpFields: { lot: 'blank', allergens: 'nope', storage: 'print', later: 'print' } });
    expect(s.fields.lot).toBe('blank');
    expect(s.fields.storage).toBe('print');
    expect(s.fields.allergens).toBe('print');
    expect(Object.keys(s.fields)).toEqual([...HACCP_FIELDS]);
  });

  test('odd shapes are the defaults', () => {
    for (const odd of [null, 'x', 3, [], { haccpFields: ['print'] }, { haccpFields: null }]) {
      expect(haccpSettingsOf(odd).fields).toEqual(HACCP_DEFAULTS);
    }
    expect(haccpSettingsOf({ haccpSize: '100x100' }).size).toBe(HACCP_DEFAULT_SIZE);
    expect(haccpSettingsOf({ haccpSize: '62x29' }).size).toBe('62x29');
    expect(haccpSettingsOf({ haccpCategory: '  ' }).category).toBeNull();
    expect(haccpSettingsOf({ haccpCategory: 7 }).category).toBeNull();
  });

  test('the list category counts only while the word is on the venue\'s list', () => {
    const s = haccpSettingsOf({ haccpCategory: 'Semilavorati' });
    expect(haccpListCategory(s, ['Pane', 'Semilavorati'])).toBe('Semilavorati');
    expect(haccpListCategory(s, ['Pane'])).toBeNull();
    expect(haccpListCategory(haccpSettingsOf({}), ['Pane'])).toBeNull();
  });

  test('every size is landscape and whole millimetres at 8 dots each', () => {
    for (const size of HACCP_SIZES) {
      const d = haccpSizeDots(size);
      expect(d.width).toBeGreaterThan(d.height);
      expect(d.width % 8).toBe(0);
    }
    expect(haccpSizeDots('60x40')).toEqual({ width: 480, height: 320 });
  });
});

describe('the words', () => {
  test('captions follow the label\'s language; use by and storage are the product label\'s own words', () => {
    expect(haccpCaption('preparedOn', 'it')).toBe('Preparato il');
    expect(haccpCaption('useBy', 'it')).toBe('Da consumarsi entro il');
    expect(haccpCaption('storage', 'it')).toBe('Conservazione');
    expect(haccpCaption('blastChilledOn', 'en')).toBe('Blast-chilled on');
    expect(haccpCaption('lot', 'fr')).toBe('Lot');
  });
});

describe('what the label says', () => {
  test('off is left out, blank is a line, printed carries its value', () => {
    const c = haccpContent(only({ name: 'print', preparedOn: 'print', lot: 'blank', quantity: 'off' }), values(), 'it');
    expect(c.title).toBe('Crema pasticcera');
    expect(c.rows).toEqual([
      { field: 'preparedOn', caption: 'Preparato il', value: '26/10/2026', bold: false },
      { field: 'lot', caption: 'Lotto', value: null, bold: false },
    ]);
  });

  test('a printed field left empty prints its blank line, never a caption with nothing after it', () => {
    const c = haccpContent(only({ preparedBy: 'print', frozenOn: 'print', useBy: 'print' }),
      values({ preparedBy: '   ', frozenOn: null, useBy: null }), 'it');
    expect(c.rows.map(r => r.value)).toEqual([null, null, null]);
  });

  test('an empty name is a blank «Prodotto» line, not an empty title; a blank name likewise', () => {
    expect(haccpContent(only({ name: 'print' }), values({ name: ' ' }), 'it'))
      .toEqual({ title: null, rows: [{ field: 'name', caption: 'Prodotto', value: null, bold: false }] });
    expect(haccpContent(only({ name: 'blank' }), values(), 'it').rows[0]?.caption).toBe('Prodotto');
  });

  test('the allergens in bold capitals; none is said; the traces get their own row', () => {
    const fields = only({ allergens: 'print' });
    expect(haccpContent(fields, values(), 'it').rows).toEqual([
      { field: 'allergens', caption: 'Allergeni', value: 'LATTE, UOVA', bold: true },
    ]);
    expect(haccpContent(fields, values({ allergens: [] }), 'it').rows[0]?.value).toBe('Nessuno dei 14');
    expect(haccpContent(fields, values({ mayContain: ['frutta a guscio'] }), 'it').rows[1])
      .toEqual({ field: 'allergens', caption: 'Può contenere', value: 'FRUTTA A GUSCIO', bold: true });
    // Not declared: the screen refuses before this when the field is printed; here it can only be the line.
    expect(haccpContent(fields, values({ allergens: null }), 'it').rows[0]?.value).toBeNull();
  });

  test('the rows come in the fixed order whatever the settings', () => {
    const c = haccpContent(all('print'), values(), 'en');
    expect(c.rows.map(r => r.field)).toEqual(HACCP_FIELDS.filter(f => f !== 'name'));
  });
});

describe('the small helpers', () => {
  test('the lot is the day as digits, day first', () => {
    expect(lotFromDate(day(2026, 1, 5))).toBe('050126');
    expect(lotFromDate(null)).toBe('');
  });

  test('a date box is a local day; a day that does not exist is none', () => {
    expect(dateFromInput('2026-10-26')?.getTime()).toBe(day(2026, 10, 26).getTime());
    expect(dateFromInput('2026-02-31')).toBeNull();
    expect(dateFromInput('26/10/2026')).toBeNull();
    expect(dateFromInput(undefined)).toBeNull();
    expect(inputFromDate(day(2026, 3, 9))).toBe('2026-03-09');
    expect(inputFromDate(dateFromInput('2026-12-31'))).toBe('2026-12-31');
    expect(inputFromDate(null)).toBe('');
  });

  test('the first name is the roster\'s first word only', () => {
    expect(firstNameOf({ firstName: '  Anna Maria ', lastName: 'Rossi' })).toBe('Anna');
    expect(firstNameOf({ firstName: 3 })).toBe('');
    expect(firstNameOf(null)).toBe('');
  });
});

describe('where everything goes', () => {
  const lay = (c: HaccpContent, size: Parameters<typeof layoutHaccpLabel>[1] = '60x40') => layoutHaccpLabel(c, size, measure);

  test('the default label fits the default size, inside the margins', () => {
    const c = haccpContent(HACCP_DEFAULTS, values(), 'it');
    const l = lay(c);
    expect(l.refused).toBe(false);
    expect(l.titleLines).toEqual(['Crema pasticcera']);
    for (const t of texts(l.elements)) {
      expect(t.x).toBeGreaterThanOrEqual(HACCP_MARGIN * S);
      expect(t.x + measure(t.text, t.font, t.px)).toBeLessThanOrEqual(l.width - HACCP_MARGIN * S + 0.001);
    }
    expect(l.endY).toBeLessThanOrEqual(320 - HACCP_MARGIN);
  });

  test('a blank row is taller and its line runs from after the caption to the right margin', () => {
    const l = lay({ title: null, rows: [{ field: 'lot', caption: 'Lotto', value: null, bold: false }] });
    expect(l.endY).toBe(HACCP_MARGIN + BLANK_ROW);
    const [line] = rects(l.elements);
    const caption = texts(l.elements)[0] as Text;
    expect(caption.text).toBe('Lotto:');
    expect(line?.x0).toBeGreaterThan(caption.x + measure('Lotto:', 'bold', BODY_PX));
    expect((line?.x1 ?? 0) + 1).toBe(l.width - HACCP_MARGIN * S);
  });

  test('a long value goes on over lines of its own from the left margin', () => {
    const long = 'In frigorifero a +4 °C, coperto, lontano da carni crude e da prodotti non confezionati';
    const l = lay({ title: null, rows: [{ field: 'storage', caption: 'Conservazione', value: long, bold: false }] });
    expect(l.refused).toBe(false);
    expect(l.endY).toBeGreaterThan(HACCP_MARGIN + ROW);
    const lefts = texts(l.elements).filter(t => t.x === HACCP_MARGIN * S);
    expect(lefts.length).toBeGreaterThan(1);
  });

  test('every field on, every value filled, does not fit the smallest label: refused as too long, never shrunk', () => {
    const l = lay(haccpContent(all('print'), values(), 'it'), '40x30');
    expect(l.tooLong).toBe(true);
    expect(l.refused).toBe(true);
    expect(texts(l.elements).every(t => t.px === BODY_PX || t.font === 'title')).toBe(true);
  });

  test('a long name shrinks, then goes on two lines, then is refused', () => {
    const shrunk = lay({ title: 'Crema pasticcera al pistacchio', rows: [] }, '50x30');
    expect(shrunk.titleLines).toHaveLength(1);
    expect(shrunk.titleSize).toBeLessThan(32);
    const two = lay({ title: 'Crema pasticcera al pistacchio di Bronte con granella', rows: [] }, '50x30');
    expect(two.titleLines).toHaveLength(2);
    expect(two.refused).toBe(false);
    const one = lay({ title: 'Precipitevolissimevolmenteprecipitevolissimevolmente', rows: [] }, '50x30');
    expect(one.tooWide).toContain('title');
    expect(one.refused).toBe(true);
  });

  test('a character the fonts do not hold refuses the label', () => {
    const l = lay({ title: 'Crema ☃', rows: [] });
    expect(l.unmeasurable).toBe(true);
    expect(l.refused).toBe(true);
  });

  test('nothing to print is refused', () => {
    const l = lay(haccpContent(all('off'), values(), 'it'));
    expect(l.empty).toBe(true);
    expect(l.refused).toBe(true);
  });

  test('the canvas is the size\'s dots four times over', () => {
    const l = lay({ title: 'X', rows: [] }, '62x29');
    expect(l.width).toBe(62 * 8 * S);
    expect(l.height).toBe(29 * 8 * S);
  });
});
