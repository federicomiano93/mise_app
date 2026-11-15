import { ingredientDisplayName } from '@mise/shared/ingredient-name';

// The counting list's own small decisions: which products a search keeps, which group a product
// sits in, and in what order. Pure, so the order and the folding are specs and not guesses.

export type Product = { readonly id: string } & Readonly<Record<string, unknown>>;

// Case and accents folded, so «però» is found by «pero»: nobody types accents into a search. The
// range is the Unicode block of combining marks, which NFD splits an accent into.
export function fold(text: unknown): string {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Whether a search keeps a product: the name to show, the invoice name that is the product's
// `name`, the brand and the category, folded. Nothing typed keeps everything.
//
// Surrounding spaces are not part of the search: a phone's keyboard adds one after a suggested word.
export function matches(product: Product, query: string): boolean {
  const needle = fold(query.trim());
  if (needle === '') return true;
  return [product.name, product.shortName, product.brand, product.category]
    .some(field => fold(field).includes(needle));
}

// A product with no category typed, or the default «Other», belongs to the same group: three ways
// of saying «nothing was chosen here» that must not become three headings.
export function categoryOf(product: Product): string {
  const raw = typeof product.category === 'string' ? product.category.trim() : '';
  return raw === 'Other' ? '' : raw;
}

export type Group = { readonly category: string; readonly products: readonly Product[] };

// Grouped by category, because that is how a storeroom is walked: everything in the dry store, then
// everything in the fridge. The groups are in the venue's alphabetical order and the products
// without a category come last — they are the ones nobody has filed yet. Rows by the name shown.
export function groupProducts(products: readonly Product[], locale: string): Group[] {
  const groups = new Map<string, Product[]>();
  for (const product of products) {
    const category = categoryOf(product);
    const group = groups.get(category);
    if (group) group.push(product);
    else groups.set(category, [product]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, locale)))
    .map(([category, list]) => ({
      category,
      products: list.sort((a, b) => ingredientDisplayName(a).localeCompare(ingredientDisplayName(b), locale)),
    }));
}

// «Still to count», on: the products nobody has counted — plus those `stay` holds, which were shown
// uncounted a moment ago. ⚠️ A ROW COUNTED WHILE THE FILTER IS ON STAYS (marked counted) until the
// next search or the next press of the toggle: it must never disappear from under the finger that
// is reaching for the next box.
export function stillToCount(
  products: readonly Product[],
  stay: ReadonlySet<string>,
  isCounted: (id: string) => boolean,
): Product[] {
  return products.filter(product => stay.has(product.id) || !isCounted(product.id));
}
