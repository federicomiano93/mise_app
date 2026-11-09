// ingredient-name.ts — the ONE place that decides which name of an ingredient the app SHOWS.
//
// TypeScript port of js/ingredient-name.js for Mise 2. Behaviour is identical, input for input:
// ingredient-name.spec.ts runs every test against BOTH files, parity.spec.ts compares their
// exports and odd-inputs.spec.ts feeds both the same strange values. The comments below are the
// ones the original paid for in bugs.
//
// An ingredient has THREE names: `invoiceName` («nome in fattura») is the description as the supplier's invoice
// writes it, saved by the invoice import and never typed — it is how the import recognises the product;
// `name` («nome nel messaggio») is what the supplier reads in an order; `shortName` («nome nelle liste») is
// optional. Rule: every SCREEN shows the short name when there is one, else the name. Two things never follow
// it, on purpose:
//   * what is SENT to a supplier (the order text) and the names frozen into an order
//     record say what was asked on the day — they keep `name`;
//   * what is PRINTED on a label (the recipe label model) keeps `name`.
// Same model as supplier-label.js.
//
// PURE, zero imports: shared by Orders, Inventory, Food cost and the Catalogue (a calculation
// shared by several features lives in the shared base).

// The three names an ingredient may carry. Anything at all may arrive (a document is data), so
// every field is `unknown`; `?.` is the original's own way of reading them, kept as it was.
interface NamedIngredient {
  name?: unknown;
  shortName?: unknown;
  invoiceName?: unknown;
}

export function ingredientDisplayName(ing: unknown): string {
  const card = ing as NamedIngredient | null | undefined;
  const short = typeof card?.shortName === 'string' ? card.shortName.trim() : '';
  if (short) return short;
  return String(card?.name || '');
}

// Does a typed search hit this ingredient by ANY of its three names? `normalize` is the caller's own
// text folding (case, accents); `query` is already normalized; an empty query matches everything.
export function ingredientNameMatches(ing: unknown, query: string, normalize: (value: unknown) => string): boolean {
  if (!query) return true;
  const card = ing as NamedIngredient | null | undefined;
  return [card?.name, card?.shortName, card?.invoiceName].some(v => normalize(v).includes(query));
}
