// The agreement between Orders' doors (shared/src/records-link.ts) and the Suppliers section: the same addresses, and states the
// Suppliers screens read as «came from a list» / «came from this supplier's screen» (suppliersNav.ts).

import { describe, expect, it } from 'vitest';
import { fromOrdersList, fromOrdersSupplier, ingredientCardAddress, newIngredientAddress, supplierScreenAddress } from '@mise/shared/records-link';
import { cameFromList, cameFromListOrSupplierScreen, supplierScreenOf, tabOfState } from './suppliersNav';
import { ingredientPath, newIngredientPath, supplierPath } from './suppliersPath';

const IDS = ['i-flour', 'no-supplier', 'a/b c%', 'Café & Co', 'x?y#z'];

describe('the addresses the doors push', () => {
  it.each(IDS)('are the Suppliers section’s own for %s', id => {
    expect(ingredientCardAddress(id)).toBe(ingredientPath(id));
    expect(supplierScreenAddress(id)).toBe(supplierPath(id));
    expect(newIngredientAddress(id)).toBe(newIngredientPath({ supplier: id }));
  });

  it('start a new ingredient with no preset when there is no supplier', () => {
    expect(newIngredientAddress(null)).toBe(newIngredientPath({ supplier: null }));
    expect(newIngredientAddress(null)).toBe(newIngredientPath());
  });
});

describe('the states the doors push', () => {
  it('from an Orders list read as «from a list», on the tab the door names', () => {
    for (const tab of ['ingredients', 'packaging', 'suppliers'] as const) {
      const state = fromOrdersList(tab);
      expect(cameFromList(state)).toBe(true);
      expect(cameFromListOrSupplierScreen(state)).toBe(true);
      expect(tabOfState(state)).toBe(tab);
      expect(supplierScreenOf(state)).toBeNull();
    }
  });

  it('from an Orders supplier screen read as «from that supplier’s screen», and not from a list', () => {
    const state = fromOrdersSupplier('s-alp');
    expect(supplierScreenOf(state)).toBe('s-alp');
    expect(cameFromList(state)).toBe(false);
    expect(cameFromListOrSupplierScreen(state)).toBe(true);
    expect(tabOfState(state)).toBeNull();
  });
});
