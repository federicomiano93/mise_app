import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { format } from '../i18n/i18n';
import type { Language, MessageParams } from '../i18n/i18n';
import { it as italian } from '../i18n/it';
import type { MessageKey } from '../i18n/en';
import { moneyForVenue } from '../session/useMoney';
import { pricePerUnitText } from './priceText';

const translator = (lang: Language) => (key: MessageKey, params?: MessageParams) =>
  format(lang, (lang === 'it' ? italian : en)[key], params);

const plain = (text: string): string => text.replace(/ /g, ' ');

const GB = moneyForVenue({ country: 'GB' });
const IT = moneyForVenue({ country: 'IT' });

describe('the price per unit on a row', () => {
  it('writes the rate and the unit it is counted in', () => {
    expect(pricePerUnitText({ pricePerUnit: 7.2, priceUnit: 'kg' }, GB, translator('en'))).toBe('£7.20 / kg');
    expect(pricePerUnitText({ pricePerUnit: 1.5, priceUnit: 'l' }, GB, translator('en'))).toBe('£1.50 / l');
  });

  it('writes pieces with the «each» phrase, in English', () => {
    expect(pricePerUnitText({ pricePerUnit: 0.35, priceUnit: 'pcs' }, GB, translator('en'))).toBe('£0.35 / each');
  });

  it('writes pieces with the «each» phrase, in Italian, and the money of the venue\'s country', () => {
    // The money is written with a no-break space before the symbol.
    expect(plain(pricePerUnitText({ pricePerUnit: 0.35, priceUnit: 'pcs' }, IT, translator('it')))).toBe('0,35 € al pezzo');
    expect(plain(pricePerUnitText({ pricePerUnit: 7.2, priceUnit: 'kg' }, IT, translator('it')))).toBe('7,20 € / kg');
  });

  it('is empty when the item carries no usable price', () => {
    const t = translator('en');
    expect(pricePerUnitText({}, GB, t)).toBe('');
    expect(pricePerUnitText({ pricePerUnit: 0, priceUnit: 'kg' }, GB, t)).toBe('');
    expect(pricePerUnitText({ pricePerUnit: -2, priceUnit: 'kg' }, GB, t)).toBe('');
    expect(pricePerUnitText({ pricePerUnit: 'abc', priceUnit: 'kg' }, GB, t)).toBe('');
    expect(pricePerUnitText({ pricePerUnit: 3, priceUnit: 'box' }, GB, t)).toBe('');
    expect(pricePerUnitText({ pricePerUnit: 3 }, GB, t)).toBe('');
  });
});
