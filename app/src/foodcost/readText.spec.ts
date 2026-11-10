import { describe, expect, it } from 'vitest';
import { moneyOf } from '@mise/shared/currency';
import { en } from '../i18n/en';
import type { MessageKey, Messages } from '../i18n/en';
import { format } from '../i18n/i18n';
import type { Language, MessageParams } from '../i18n/i18n';
import { it as italian } from '../i18n/it';
import { amountText, gramsText, plainCount, positive } from './readText';

// The small rules of the read view's words (the current app's read-sections.js: amountText, plain, grams, positive; tests/foodcost-read-sections.test.mjs).

const BRITAIN = moneyOf('£', { decimal: '.', group: '', symbolAfter: false });
const ITALY = moneyOf('€', { decimal: ',', group: '.', symbolAfter: true });

const say = (lang: Language, messages: Messages) => (key: MessageKey, params?: MessageParams) =>
  format(lang, messages[key], params);
const english = say('en', en);
const italiano = say('it', italian);

describe('positive', () => {
  it('is true for a number above zero, however it is written, and false for everything that reads as «not said»', () => {
    expect(positive(0.5)).toBe(true);
    expect(positive('3')).toBe(true);
    for (const nothing of [0, '0', null, undefined, '', Number.NaN, -1, 'abc']) expect(positive(nothing), String(nothing)).toBe(false);
  });
});

describe('amountText', () => {
  it('writes a weight with two decimals and its unit, in the venue’s layout', () => {
    expect(amountText(english, BRITAIN, 2.5, 'kg')).toBe('2.50 kg');
    expect(amountText(italiano, ITALY, 2.5, 'kg')).toBe('2,50 kg');
    expect(amountText(italiano, ITALY, 0.5, 'g')).toBe('0,50 g');
  });

  it('writes pieces as «N pz» / «N pcs»: «pezzi» after a 1 would read «1,00 pezzi»', () => {
    expect(amountText(italiano, ITALY, 1, 'pcs')).toBe('1,00 pz');
    expect(amountText(italiano, ITALY, 12, 'pcs')).toBe('12,00 pz');
    expect(amountText(english, BRITAIN, 3, 'pcs')).toBe('3.00 pcs');
  });
});

describe('plainCount and gramsText', () => {
  it('a count the person typed keeps its own figure (7.5, not 7.50), through the venue’s layout', () => {
    expect(plainCount(7.5, ITALY)).toBe('7,5');
    expect(plainCount(30, ITALY)).toBe('30');
    expect(plainCount(7.5, BRITAIN)).toBe('7.5');
  });

  it('a weighing is grams with two decimals, and nothing weighed is nothing', () => {
    expect(gramsText(ITALY, 1000)).toBe('1.000,00 g');
    expect(gramsText(BRITAIN, 880.5)).toBe('880.50 g');
    expect(gramsText(BRITAIN, 0)).toBeNull();
  });
});
