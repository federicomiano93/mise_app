import { describe, expect, it } from 'vitest';
import { NO_FROZEN_PRICE, NO_PACK, NO_PRICE } from '@mise/shared/inventory-value';
import { en } from '../i18n/en';
import type { MessageKey } from '../i18n/en';
import { format } from '../i18n/i18n';
import type { Language, MessageParams } from '../i18n/i18n';
import { it as italian } from '../i18n/it';
import { moneyForVenue } from '../session/useMoney';
import { blockerText, isPricedByUnit, packNoteText } from './productValue';

// The words the money of a product rests on: why a row has none, and the note under the pack
// weight. Pure, so every variant is a sentence read here, in both languages and both venues' money.

const translator = (lang: Language) => (key: MessageKey, params?: MessageParams) =>
  format(lang, (lang === 'it' ? italian : en)[key], params);
const tEn = translator('en');
const tIt = translator('it');

// ⚠️ Italy's layout writes a NO-BREAK space (U+00A0) between the number and «€», so a price never
// breaks across two lines: the Italian expectations below hold that character, not a plain space.
const GB = moneyForVenue({ country: 'GB' });
const IT = moneyForVenue({ country: 'IT' });

// The same fixtures the shared value spec prices: flour by the kilo, a box by the piece, and the two
// cases (eggs: 50 pieces for 20; flour: 4 × 2.5 kg for 20).
const byKg = (over: Record<string, unknown> = {}) =>
  ({ id: 'flour', name: 'Flour', weight: '25kg', unit: 'sacco', priceUnit: 'kg', pricePerUnit: 0.8, ...over });
const byPiece = (over: Record<string, unknown> = {}) =>
  ({ id: 'box', name: 'Box', weight: '', unit: 'pz', priceUnit: 'pcs', pricePerUnit: 0.15, ...over });
const EGGS = { casePrice: 20, caseCount: 50, caseItemSize: null, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.4 };
const FLOUR_CASE = { casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg', priceUnit: 'kg', pricePerUnit: 2 };

const OPEN = { packKg: {} };
const note = (product: Record<string, unknown> & { id: string }, extra: Partial<Parameters<typeof packNoteText>[1]> = {}, t = tEn) =>
  packNoteText(t, { month: OPEN, product, closed: false, money: GB, locale: 'en-GB', ...extra });

describe('why a row has no money', () => {
  it.each([
    [NO_PRICE, 'no price entered', 'prezzo non inserito'],
    [NO_PACK, 'pack weight unknown', 'peso della confezione sconosciuto'],
    [NO_FROZEN_PRICE, 'no price recorded when the month closed', 'nessun prezzo registrato alla chiusura'],
  ] as const)('says %s in words, in both languages', (blocker, english, ital) => {
    expect(blockerText(tEn, blocker)).toBe(english);
    expect(blockerText(tIt, blocker)).toBe(ital);
  });

  it('says «no price entered» when the model gives no reason', () => {
    expect(blockerText(tEn, null)).toBe('no price entered');
  });
});

describe('a product priced by the unit', () => {
  it('is one priced by the piece or by the case, and no other', () => {
    expect(isPricedByUnit(byPiece())).toBe(true);
    expect(isPricedByUnit({ id: 'e', unit: 'pz', ...EGGS })).toBe(true);
    expect(isPricedByUnit(byKg())).toBe(false);
    // A rate typed over a case makes it stale: not a case at all.
    expect(isPricedByUnit({ id: 'e', unit: 'pz', ...EGGS, pricePerUnit: 9, priceUnit: 'kg' })).toBe(false);
  });
});

describe('the pack note: by weight', () => {
  it('says what one pack is read as, with the cost, in the venue\'s money', () => {
    expect(note(byKg())).toBe('One pack is read as 25 kg, and costs about £20.00.');
    expect(note(byKg(), { money: IT, locale: 'it-IT' }, tIt)).toBe('Una confezione risulta di 25 kg e costa circa 20,00 €.');
  });

  it('lays the kilos out in the price\'s layout beside a price (a comma in Italy)', () => {
    expect(note(byKg({ weight: '2.5kg' }), { money: IT, locale: 'en-GB' })).toBe('One pack is read as 2,5 kg, and costs about 2,00 €.');
  });

  it('says only the kilos when there is no price, in the interface language\'s layout', () => {
    expect(note(byKg({ pricePerUnit: null, weight: '2.5kg' }), { locale: 'it-IT' })).toBe('One pack is read as 2,5 kg.');
    expect(note(byKg({ pricePerUnit: null, weight: '2.5kg' }), { locale: 'en-GB' })).toBe('One pack is read as 2.5 kg.');
  });

  it('prefers the weight somebody typed to the one in the pack text', () => {
    expect(note(byKg(), { month: { packKg: { flour: 20 } } })).toBe('One pack is read as 20 kg, and costs about £16.00.');
  });

  it('says what cannot be read from the pack text, quoting it', () => {
    expect(note(byKg({ weight: 'sacco' }))).toBe('No weight can be read from “sacco”. Write the kilos in and this product gets a cost.');
  });

  it('says there is no pack size when there is no text at all', () => {
    expect(note(byKg({ weight: '' }))).toBe('This product has no pack size. Write the kilos in and it gets a cost.');
    expect(note(byKg({ weight: undefined }))).toBe('This product has no pack size. Write the kilos in and it gets a cost.');
  });
});

describe('the pack note: by the piece', () => {
  it('says the price of one, with no weight needed', () => {
    expect(note(byPiece())).toBe('Priced by the piece, about £0.15 each — no weight needed.');
    expect(note(byPiece(), { money: IT }, tIt)).toBe('Prezzo a pezzo, circa 0,15 € l’uno — non serve il peso.');
  });

  it('says so when no price has been entered', () => {
    expect(note(byPiece({ pricePerUnit: null }))).toBe('Priced by the piece, but no price has been entered.');
  });
});

describe('the pack note: by the case', () => {
  it('says what one counted unit costs, in the order unit', () => {
    expect(note({ id: 'e', unit: 'pz', ...EGGS })).toBe('Priced by the case: £0.40 per pz');
    expect(note({ id: 'e', unit: 'cartone', ...EGGS })).toBe('Priced by the case: £20.00 per cartone');
    expect(note({ id: 'f', unit: 'kg', ...FLOUR_CASE })).toBe('Priced by the case: £2.00 per kg');
  });

  it('writes the rate in the venue\'s layout', () => {
    expect(note({ id: 'e', unit: 'pz', ...EGGS }, { money: IT })).toBe('Priced by the case: 0,40 € per pz');
  });

  it('falls back to «packs» when the order unit is empty', () => {
    expect(note({ id: 'f', unit: '', ...FLOUR_CASE })).toBe('Priced by the case: £20.00 per packs');
  });

  // ⚠️ formatRate, not formatMoney: one straw out of 2000 is 0.17 pence, and «£0.00» reads as free.
  it('never shows a tiny rate as 0.00', () => {
    const straw = { id: 's', unit: 'pz', casePrice: 3.49, caseCount: 2000, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.001745 };
    const text = note(straw);
    expect(text).toBe('Priced by the case: £0.001745 per pz');
    expect(text).not.toContain('0.00 ');
  });

  it('names the fix when the order unit leaves doubt', () => {
    expect(note({ id: 'f', unit: 'busta', ...FLOUR_CASE })).toBe(
      'Priced by the case: set the order unit to pcs, case or kg to value it',
    );
  });

  it('treats a rate typed over a case as no case: the weight decides again', () => {
    expect(note({ id: 'f', unit: 'kg', weight: '25kg', ...FLOUR_CASE, pricePerUnit: 3 })).toBe(
      'One pack is read as 25 kg, and costs about £75.00.',
    );
  });
});

describe('the pack note: on a closed month', () => {
  const frozen = { packKg: {}, unitPrice: { flour: 20 } };

  it('says only what was frozen into the month', () => {
    expect(note(byKg(), { month: frozen, closed: true })).toBe('One of these was worth about £20.00 when the month was closed.');
    expect(note(byKg(), { month: frozen, closed: true, money: IT }, tIt)).toBe(
      'Alla chiusura del mese una di queste valeva circa 20,00 €.',
    );
  });

  it('says nothing was recorded, and never reaches for today\'s price', () => {
    expect(note(byKg(), { month: { packKg: {}, unitPrice: {} }, closed: true })).toBe(
      'Nothing was recorded about what this cost when the month was closed, so it has no value here. A price entered today belongs to today.',
    );
  });

  it('answers the same for a case or a piece: the closed month has its own figure only', () => {
    expect(note({ id: 'e', unit: 'pz', ...EGGS }, { month: { packKg: {}, unitPrice: { e: 0.4 } }, closed: true })).toBe(
      'One of these was worth about £0.40 when the month was closed.',
    );
    expect(note(byPiece(), { month: { packKg: {}, unitPrice: {} }, closed: true })).toContain('Nothing was recorded');
  });
});
