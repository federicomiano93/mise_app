import { describe, expect, test } from 'vitest';
import {
  NEW_INGREDIENT_PATH, NEW_PACKAGING_PATH, NEW_SUPPLIER_PATH, PACKAGING_TAB_PATH, SUPPLIERS_PATH, SUPPLIERS_SETTINGS_PATH, SUPPLIERS_TAB_PATH,
  ingredientPath, newIngredientPath, parseSuppliersPath, supplierEditPath, supplierPath, suppliersScreenName, tabOf, tabPath,
} from './suppliersPath';

const rest = (path: string) => path.slice(SUPPLIERS_PATH.length);

describe('the addresses of Ingredients & suppliers', () => {
  test('the three tabs: Ingredients is the plain address', () => {
    expect(parseSuppliersPath('')).toEqual({ kind: 'list', tab: 'ingredients' });
    expect(parseSuppliersPath('/')).toEqual({ kind: 'list', tab: 'ingredients' });
    expect(parseSuppliersPath(rest(SUPPLIERS_TAB_PATH))).toEqual({ kind: 'list', tab: 'suppliers' });
    expect(parseSuppliersPath(rest(PACKAGING_TAB_PATH))).toEqual({ kind: 'list', tab: 'packaging' });
    expect(tabPath('ingredients')).toBe(SUPPLIERS_PATH);
    expect(tabPath('suppliers')).toBe(SUPPLIERS_TAB_PATH);
    expect(tabPath('packaging')).toBe(PACKAGING_TAB_PATH);
  });

  test('a supplier, its card and a new one', () => {
    expect(parseSuppliersPath(rest(supplierPath('abc')))).toEqual({ kind: 'supplier', id: 'abc' });
    expect(parseSuppliersPath(rest(supplierEditPath('abc')))).toEqual({ kind: 'supplier-edit', id: 'abc' });
    expect(parseSuppliersPath(rest(NEW_SUPPLIER_PATH))).toEqual({ kind: 'supplier-new' });
    expect(parseSuppliersPath(rest(SUPPLIERS_SETTINGS_PATH))).toEqual({ kind: 'settings' });
  });

  test('an id with a slash, a percent sign or a space comes back whole', () => {
    for (const id of ['a/b', '50%', 'two words', 'è']) {
      expect(parseSuppliersPath(rest(supplierPath(id)))).toEqual({ kind: 'supplier', id });
      expect(parseSuppliersPath(rest(supplierEditPath(id)))).toEqual({ kind: 'supplier-edit', id });
    }
  });

  test('«new» is never a supplier, and «new/edit» is nothing', () => {
    expect(parseSuppliersPath('/supplier/new/edit')).toEqual({ kind: 'unknown' });
    expect(parseSuppliersPath('/supplier/%6Eew')).toEqual({ kind: 'supplier-new' });
  });

  test('an ingredient, a new ingredient, a new packaging item, and a supplier to start a new one on', () => {
    expect(parseSuppliersPath(rest(ingredientPath('abc')))).toEqual({ kind: 'ingredient', id: 'abc' });
    expect(parseSuppliersPath(rest(NEW_INGREDIENT_PATH))).toEqual({ kind: 'ingredient-new', packaging: false, supplier: null });
    expect(parseSuppliersPath('/ingredient/new', '?kind=packaging')).toEqual({ kind: 'ingredient-new', packaging: true, supplier: null });
    expect(parseSuppliersPath('/ingredient/new', '?supplier=s-1')).toEqual({ kind: 'ingredient-new', packaging: false, supplier: 's-1' });
    expect(parseSuppliersPath('/ingredient/new', '?kind=packaging&supplier=s%201')).toEqual({ kind: 'ingredient-new', packaging: true, supplier: 's 1' });
    // Anything but the word «packaging» is an ingredient, and an empty supplier is none.
    expect(parseSuppliersPath('/ingredient/new', '?kind=food&supplier=')).toEqual({ kind: 'ingredient-new', packaging: false, supplier: null });
  });

  test('the addresses are built the way they are read', () => {
    expect(newIngredientPath()).toBe('/suppliers/ingredient/new');
    expect(newIngredientPath({ packaging: true })).toBe(NEW_PACKAGING_PATH);
    expect(NEW_PACKAGING_PATH).toBe('/suppliers/ingredient/new?kind=packaging');
    expect(newIngredientPath({ supplier: 's 1' })).toBe('/suppliers/ingredient/new?supplier=s+1');
    for (const id of ['a/b', '50%', 'two words', 'è']) {
      expect(parseSuppliersPath(rest(ingredientPath(id)))).toEqual({ kind: 'ingredient', id });
    }
    const made = newIngredientPath({ packaging: true, supplier: 'x&y' });
    const [path = '', search = ''] = made.slice(SUPPLIERS_PATH.length).split('?');
    expect(parseSuppliersPath(path, `?${search}`)).toEqual({ kind: 'ingredient-new', packaging: true, supplier: 'x&y' });
  });

  test('⚠️ «new» is never an ingredient\'s id either, and «new/x» is nothing', () => {
    expect(parseSuppliersPath('/ingredient/%6Eew')).toEqual({ kind: 'ingredient-new', packaging: false, supplier: null });
    expect(parseSuppliersPath('/ingredient/new/edit')).toEqual({ kind: 'unknown' });
  });

  test('anything else is unknown (the section goes back to the list)', () => {
    for (const path of ['/supplier', '/supplier/', '/supplier/%', '/supplier/a/b', '/supplier/a/edit/x', '/ingredient',
      '/ingredient/', '/ingredient/%', '/ingredient/a/b', '/ingredient/a/edit', '/import', '/nope', '/suppliers/x', '/settings/x']) {
      expect(parseSuppliersPath(path)).toEqual({ kind: 'unknown' });
    }
  });

  test('a supplier’s screens belong to the Suppliers tab', () => {
    expect(tabOf({ kind: 'supplier', id: 'a' })).toBe('suppliers');
    expect(tabOf({ kind: 'supplier-edit', id: 'a' })).toBe('suppliers');
    expect(tabOf({ kind: 'supplier-new' })).toBe('suppliers');
    expect(tabOf({ kind: 'list', tab: 'packaging' })).toBe('packaging');
    expect(tabOf({ kind: 'settings' })).toBe('ingredients');
    expect(tabOf({ kind: 'ingredient-new', packaging: true, supplier: null })).toBe('packaging');
    expect(tabOf({ kind: 'ingredient-new', packaging: false, supplier: 's' })).toBe('ingredients');
  });

  test('the usage record names the screens of decision T1', () => {
    expect(suppliersScreenName('')).toBe('suppliers');
    expect(suppliersScreenName('/packaging')).toBe('suppliers');
    expect(suppliersScreenName('/supplier/abc')).toBe('suppliers-supplier');
    expect(suppliersScreenName('/supplier/abc/edit')).toBe('suppliers-supplier-edit');
    expect(suppliersScreenName('/supplier/new')).toBe('suppliers-supplier-edit');
    expect(suppliersScreenName('/settings')).toBe('suppliers-settings');
    expect(suppliersScreenName('/ingredient/abc')).toBe('suppliers-ingredient');
    expect(suppliersScreenName('/ingredient/new')).toBe('suppliers-ingredient');
    expect(suppliersScreenName('/junk')).toBe('suppliers');
  });
});
