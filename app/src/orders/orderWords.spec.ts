import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { format } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { joinList, whoWords } from './orderWords';

const sayEn = (key: MessageKey, params?: MessageParams) => format('en', en[key], params);
const sayIt = (key: MessageKey, params?: MessageParams) => format('it', italian[key], params);

describe('joinList', () => {
  it('joins with the interface language’s «and»', () => {
    expect(joinList(sayEn, [])).toBe('');
    expect(joinList(sayEn, ['A'])).toBe('A');
    expect(joinList(sayEn, ['A', 'B'])).toBe('A and B');
    expect(joinList(sayEn, ['A', 'B', 'C'])).toBe('A, B and C');
    expect(joinList(sayIt, ['A', 'B', 'C'])).toBe('A, B e C');
  });
});

describe('whoWords', () => {
  it('names one, up to three, and counts more', () => {
    expect(whoWords(sayEn, ['A'])).toBe('A');
    expect(whoWords(sayEn, ['A', 'B', 'C'])).toBe('A, B, C');
    expect(whoWords(sayEn, ['A', 'B', 'C', 'D'])).toBe('4 suppliers');
    expect(whoWords(sayIt, ['A', 'B', 'C', 'D'])).toBe('4 fornitori');
  });
});
