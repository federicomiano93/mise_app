// The addresses of the «Allergen book» (the owner's «Libro allergeni», 27 Nov 2026), in one place so the section, its screens
// and the shell's usage names cannot disagree.
//
//   /allergen-book          the book: the products sold loose, with their allergens, ready to print
//   /allergen-book/choose   «Prodotti nel libro»: the pencil screen where whoever runs the place ticks the products
//   anything else           unknown: the section goes back to /allergen-book
export const ALLERGEN_BOOK_PATH = '/allergen-book';
export const CHOOSE_PATH = '/allergen-book/choose';

export type AllergenBookView = { readonly kind: 'book' } | { readonly kind: 'choose' } | { readonly kind: 'unknown' };

// `rest` is what follows /allergen-book in the address.
export function parseAllergenBookPath(rest: string | undefined): AllergenBookView {
  const parts = (rest ?? '').split('/').filter(part => part !== '');
  if (parts.length === 0) return { kind: 'book' };
  if (parts.length === 1 && parts[0] === 'choose') return { kind: 'choose' };
  return { kind: 'unknown' };
}

// What the usage record calls each screen (shell/sections.ts, screenNameFor). A junk address is sent back to the book, so it is
// counted as the book, the screen a person actually sees.
export function allergenBookScreenName(rest: string): string {
  return parseAllergenBookPath(rest).kind === 'choose' ? 'allergen-book-choose' : 'allergen-book';
}
