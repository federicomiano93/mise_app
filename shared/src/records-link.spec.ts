// The addresses and states of the doors from Orders to the cards (records-link.ts). New in Mise 2: no original to compare with.

import { describe, expect, it } from 'vitest';
import { fromOrdersList, fromOrdersSupplier, ingredientCardAddress, newIngredientAddress, supplierScreenAddress } from './records-link';

describe('records-link addresses', () => {
  it('builds a card, a supplier screen and a new ingredient, encoding ids', () => {
    expect(ingredientCardAddress('i-flour')).toBe('/suppliers/ingredient/i-flour');
    expect(ingredientCardAddress('a/b c%')).toBe('/suppliers/ingredient/a%2Fb%20c%25');
    expect(supplierScreenAddress('s-alp')).toBe('/suppliers/supplier/s-alp');
    expect(supplierScreenAddress('a/b')).toBe('/suppliers/supplier/a%2Fb');
    expect(newIngredientAddress(null)).toBe('/suppliers/ingredient/new');
    expect(newIngredientAddress('s-alp')).toBe('/suppliers/ingredient/new?supplier=s-alp');
    expect(newIngredientAddress('a b')).toBe('/suppliers/ingredient/new?supplier=a+b');
  });
});

describe('records-link states', () => {
  it('says «came from a list» with the tab, keeping the focus where the card puts it', () => {
    expect(fromOrdersList('ingredients')).toEqual({ keepFocus: true, fromList: true, tab: 'ingredients' });
    expect(fromOrdersList('suppliers').tab).toBe('suppliers');
    expect(fromOrdersList('packaging').tab).toBe('packaging');
  });

  it('says «came from this supplier’s screen»', () => {
    expect(fromOrdersSupplier('s-alp')).toEqual({ keepFocus: true, fromSupplierScreen: 's-alp' });
  });
});
