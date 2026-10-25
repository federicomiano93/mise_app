import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { format } from '../i18n/i18n';
import { it as italian } from '../i18n/it';

// Seen on the lab tablet (14 Oct 2026): the allergen sheet said «1 ricette su 3 completamente dichiarate». Italian
// agrees the noun and the participle with the count; English reads the same both ways.
describe('the allergen sheet\'s count', () => {
  it('agrees with one recipe in Italian', () => {
    expect(format('it', italian['cat.sheet.declaredCount'], { n: 1, total: 3 })).toBe('1 ricetta su 3 completamente dichiarata');
    expect(format('it', italian['cat.sheet.declaredCount'], { n: 2, total: 3 })).toBe('2 ricette su 3 completamente dichiarate');
    expect(format('it', italian['cat.sheet.declaredCount'], { n: 0, total: 3 })).toBe('0 ricette su 3 completamente dichiarate');
  });

  it('reads the same in English', () => {
    expect(format('en', en['cat.sheet.declaredCount'], { n: 1, total: 3 })).toBe('1 of 3 recipes fully declared');
    expect(format('en', en['cat.sheet.declaredCount'], { n: 2, total: 3 })).toBe('2 of 3 recipes fully declared');
  });
});
