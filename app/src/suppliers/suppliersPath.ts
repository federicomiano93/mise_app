// The addresses of «Ingredients & suppliers», in one place so the section, the list's rows and the screens one level
// down cannot disagree (docs/parity/suppliers.md, decision T1).
//
//   /suppliers                      the Ingredients tab (the default: «this list IS the work», parity S45)
//   /suppliers/suppliers            the Suppliers tab
//   /suppliers/packaging            the Packaging tab
//   /suppliers/supplier/new         a new supplier (the supplier card on an empty copy)
//   /suppliers/supplier/<id>        one supplier's own screen («What they sell»)
//   /suppliers/supplier/<id>/edit   that supplier's card, one level below its screen
//   /suppliers/settings             Settings of this page (owner and manager), full width at every size
//   /suppliers/ingredient/<id>      an ingredient's or a packaging item's card, one level below the list
//   /suppliers/ingredient/new       a new ingredient; `?kind=packaging` makes it a new packaging item and
//                                   `?supplier=<id>` starts it on that supplier (opened from the supplier's screen)
//   anything else                   unknown: the section goes back to /suppliers
//
// ⚠️ `new` IS NEVER AN ID (a supplier's or an ingredient's): a Firestore auto id is 20 characters, so it cannot be one, and
// an address that happens to say it must open the empty card, not an item that does not exist. suppliersPath.spec.ts pins it.

export const SUPPLIERS_PATH = '/suppliers';
export const SUPPLIERS_TAB_PATH = '/suppliers/suppliers';
export const PACKAGING_TAB_PATH = '/suppliers/packaging';
export const NEW_SUPPLIER_PATH = '/suppliers/supplier/new';
export const SUPPLIERS_SETTINGS_PATH = '/suppliers/settings';
export const NEW_INGREDIENT_PATH = '/suppliers/ingredient/new';
export const NEW_PACKAGING_PATH = `${NEW_INGREDIENT_PATH}?kind=packaging`;

export type SuppliersTab = 'ingredients' | 'suppliers' | 'packaging';

export type SuppliersView =
  | { readonly kind: 'list'; readonly tab: SuppliersTab }
  | { readonly kind: 'supplier'; readonly id: string }
  | { readonly kind: 'supplier-edit'; readonly id: string }
  | { readonly kind: 'supplier-new' }
  | { readonly kind: 'ingredient'; readonly id: string }
  // A new ingredient or packaging item; `supplier` is the preset of a new item opened from a supplier's screen.
  | { readonly kind: 'ingredient-new'; readonly packaging: boolean; readonly supplier: string | null }
  | { readonly kind: 'settings' }
  | { readonly kind: 'unknown' };

export const supplierPath = (id: string): string => `${SUPPLIERS_PATH}/supplier/${encodeURIComponent(id)}`;
export const supplierEditPath = (id: string): string => `${supplierPath(id)}/edit`;
export const ingredientPath = (id: string): string => `${SUPPLIERS_PATH}/ingredient/${encodeURIComponent(id)}`;

// A new item's address: the kind and the supplier it starts on, when there are any.
export function newIngredientPath({ packaging = false, supplier = null }: { packaging?: boolean; supplier?: string | null } = {}): string {
  const query = new URLSearchParams();
  if (packaging) query.set('kind', 'packaging');
  if (supplier !== null) query.set('supplier', supplier);
  const text = query.toString();
  return text === '' ? NEW_INGREDIENT_PATH : `${NEW_INGREDIENT_PATH}?${text}`;
}

// The address of a tab's list.
export function tabPath(tab: SuppliersTab): string {
  if (tab === 'suppliers') return SUPPLIERS_TAB_PATH;
  if (tab === 'packaging') return PACKAGING_TAB_PATH;
  return SUPPLIERS_PATH;
}

// Which tab the list shows beside (or behind) a view: a supplier's screens belong to the Suppliers tab, a new item to the
// tab of its kind. An EXISTING item's tab depends on how it was opened (the tab it came from, a supplier's screen) and on
// its kind, which only the data knows: the section works it out, and this is its default.
export function tabOf(view: SuppliersView): SuppliersTab {
  if (view.kind === 'list') return view.tab;
  if (view.kind === 'supplier' || view.kind === 'supplier-edit' || view.kind === 'supplier-new') return 'suppliers';
  if (view.kind === 'ingredient-new' && view.packaging) return 'packaging';
  return 'ingredients';
}

// A segment as it was typed, back to the id it stands for; null when it is not valid percent-encoding.
function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

const isSupplierId = (id: string | null): id is string => id !== null && id !== '' && id !== 'new';

// `rest` is what follows /suppliers in the address AS IT IS WRITTEN: each segment is split first and decoded after, so
// an id with a slash, a percent sign or a space in it comes back whole. `search` is the address's query («?kind=packaging»).
export function parseSuppliersPath(rest: string | undefined, search = ''): SuppliersView {
  const parts = (rest ?? '').split('/').filter(part => part !== '');
  if (parts.length === 0) return { kind: 'list', tab: 'ingredients' };
  const [first, second, third] = parts;
  if (parts.length === 1) {
    if (first === 'suppliers') return { kind: 'list', tab: 'suppliers' };
    if (first === 'packaging') return { kind: 'list', tab: 'packaging' };
    if (first === 'settings') return { kind: 'settings' };
    return { kind: 'unknown' };
  }
  if (first === 'ingredient' && second !== undefined && parts.length === 2) {
    const id = decoded(second);
    if (id === 'new') {
      const query = new URLSearchParams(search);
      const supplier = query.get('supplier');
      return { kind: 'ingredient-new', packaging: query.get('kind') === 'packaging', supplier: supplier === null || supplier === '' ? null : supplier };
    }
    return isSupplierId(id) ? { kind: 'ingredient', id } : { kind: 'unknown' };
  }
  if (first !== 'supplier' || second === undefined) return { kind: 'unknown' };
  const id = decoded(second);
  if (parts.length === 2) {
    if (id === 'new') return { kind: 'supplier-new' };
    return isSupplierId(id) ? { kind: 'supplier', id } : { kind: 'unknown' };
  }
  if (parts.length === 3 && third === 'edit' && isSupplierId(id)) return { kind: 'supplier-edit', id };
  return { kind: 'unknown' };
}

// What the usage record calls the screen at an address (shell/sections.ts screenNameFor), the names of decision T1.
// ⚠️ ONLY AN ADDRESS THE SECTION DRAWS counts as its screen: an unknown one is sent back to the list.
export function suppliersScreenName(rest: string): string {
  const view = parseSuppliersPath(rest);
  if (view.kind === 'supplier') return 'suppliers-supplier';
  // A new supplier and an existing one's card are one screen in the statistics.
  if (view.kind === 'supplier-edit' || view.kind === 'supplier-new') return 'suppliers-supplier-edit';
  if (view.kind === 'settings') return 'suppliers-settings';
  // A new item and an existing one's card are one screen in the statistics.
  if (view.kind === 'ingredient' || view.kind === 'ingredient-new') return 'suppliers-ingredient';
  return 'suppliers';
}
