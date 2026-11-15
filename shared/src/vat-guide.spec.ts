// Unit tests for «which products take which VAT rate» (P15), run against BOTH implementations: the
// TypeScript port in shared/ and js/foodcost/vat-guide.js, which the live app uses today. Ported from
// tests/foodcost-vat-guide.test.mjs. The module is a FULL port, so parity.spec.ts also compares its
// exports name by name and deep-frozen-ness; this file additionally demands that the DATA, every Italian
// and English string, equals the original's.
//
// WHAT THESE GUARD IS THE SHAPE AND THE PROVENANCE, NOT THE LAW. No test can say an item is at the right
// rate; what a test CAN say is that every country has a guide, that every rate the menu offers is
// explained, that each guide names its sources and the day they were checked.
//
// NOT PORTED, because they read a file or the dictionary: '⚠️ the guide's words follow the COUNTRY: the
// data file cannot reach the interface language' (the first half reads the source — the port imports
// nothing, which the compiler shows; the second half, Italian in IT and English in GB, is ported),
// '⚠️ the editor opens it beside the VAT rate…', 'the screen around the guide speaks the interface
// language…' and 'the precache carries both files…'.

import { describe, expect, test } from 'vitest';
import * as ported from './vat-guide';
import { vatRatesFor } from './vat-rates';
import { COUNTRIES } from './market';
import * as legacyJs from '../../js/foodcost/vat-guide.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('⚠️ every country the app sells in has its own guide', () => {
    for (const country of COUNTRIES) {
      expect(Object.prototype.hasOwnProperty.call(m.VAT_GUIDE_BY_COUNTRY, country), `${country} needs a VAT guide`).toBe(true);
    }
  });

  test('⚠️⚠️ every rate the VAT menu offers is explained in that country’s guide', () => {
    for (const country of COUNTRIES) {
      const explained = m.vatGuideFor(country).rates.map(r => r.rate);
      for (const { rate } of vatRatesFor(country)) {
        expect(explained.includes(rate), `${country}: the menu offers ${rate}% and the guide says nothing about it`).toBe(true);
      }
    }
  });

  test('each guide names its official sources and the day they were checked', () => {
    for (const country of COUNTRIES) {
      const guide = m.vatGuideFor(country);
      expect(guide.checkedOn, `${country}: checkedOn is a date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(guide.sources.length, `${country}: at least one source`).toBeGreaterThanOrEqual(1);
      for (const source of guide.sources) {
        expect(typeof source.title === 'string' && source.title.trim() !== '', `${country}: every source has a title`).toBe(true);
        expect(source.url, `${country}: every source is a link`).toMatch(/^https:\/\//);
      }
    }
    expect(m.vatGuideFor('IT').sources.some(s => /normattiva\.it|agenziaentrate\.gov\.it/.test(s.url)),
      'the Italian guide cites the law or the Agenzia delle Entrate').toBe(true);
    expect(m.vatGuideFor('GB').sources.some(s => /gov\.uk/.test(s.url)), 'the UK guide cites HMRC on gov.uk').toBe(true);
  });

  test('every rate has at least one item, each a short plain line, and no rate twice', () => {
    for (const country of COUNTRIES) {
      const rates = m.vatGuideFor(country).rates;
      expect(new Set(rates.map(r => r.rate)).size, `${country}: a rate listed twice`).toBe(rates.length);
      for (const group of rates) {
        expect(Number.isFinite(group.rate) && group.rate >= 0 && group.rate <= 100, `${country}: ${group.rate} is a rate`).toBe(true);
        expect(group.items.length, `${country} ${group.rate}%: at least one example`).toBeGreaterThanOrEqual(1);
        for (const item of group.items) {
          expect(typeof item === 'string' && item.trim().length >= 3 && item.length <= 160,
            `${country} ${group.rate}%: «${item}» must be a short line`).toBe(true);
        }
      }
      expect(rates.map(r => r.rate), `${country}: highest rate first, the order of the VAT menu`)
        .toStrictEqual([...rates.map(r => r.rate)].sort((a, b) => b - a));
    }
  });

  test('a country the app does not know gets the UK guide, never an empty screen', () => {
    for (const unknown of [null, undefined, '', 'FR', '__proto__', 'constructor']) {
      expect(m.vatGuideFor(unknown), String(unknown)).toBe(m.VAT_GUIDE_BY_COUNTRY.GB);
    }
  });

  test('⚠️ the guide’s words follow the COUNTRY: Italian for Italy, English for the UK', () => {
    const it = m.vatGuideFor('IT').rates.flatMap(r => r.items).join(' ');
    expect(it, 'the Italian guide is written in Italian').toMatch(/\bpane\b/i);
    const gb = m.vatGuideFor('GB').rates.flatMap(r => r.items).join(' ');
    expect(gb, 'the UK guide is written in English').toMatch(/\bbread\b/i);
  });

  test('a VAT group that says nothing takes that rate offers no button to use it', () => {
    const none = Object.values(m.VAT_GUIDE_BY_COUNTRY).flatMap(g => g.rates).filter(r => r.none);
    expect(none.length, 'the UK 5% group is marked').toBeGreaterThanOrEqual(1);
    expect(none.every(r => r.items.length === 1), 'a `none` group carries only the sentence that says so').toBe(true);
  });
});

describe('the port against the original', () => {
  test('the data is equal, string for string', () => {
    expect(ported.VAT_GUIDE_BY_COUNTRY).toStrictEqual(legacy.VAT_GUIDE_BY_COUNTRY);
  });
});
