// ingredient-name.js — the ONE place that decides which name of an ingredient the app SHOWS.
//
// `name` is the product as the supplier's INVOICE writes it, kept so the app stays aligned with
// it. An ingredient may also have a `shortName` («nome da mostrare»). Rule: every SCREEN shows the
// short name when there is one, else the name. Two things never follow it, on purpose:
//   * what is SENT to a supplier (js/orders/order-text.js) and the names frozen into an order
//     record say what was asked on the day — they keep `name`;
//   * what is PRINTED on a label (js/catalogue/recipe-label-model.js) keeps `name`.
// Same model as supplier-label.js.
//
// PURE, zero imports: shared by Orders, Inventory, Food cost and the Catalogue (a calculation
// shared by several features lives in js/ root).

export function ingredientDisplayName(ing) {
  const short = typeof ing?.shortName === 'string' ? ing.shortName.trim() : '';
  if (short) return short;
  return String(ing?.name || '');
}

// Does a typed search hit this ingredient by EITHER of its names? `normalize` is the caller's own
// text folding (case, accents); `query` is already normalized; an empty query matches everything.
export function ingredientNameMatches(ing, query, normalize) {
  if (!query) return true;
  return [ing?.name, ing?.shortName].some(v => normalize(v).includes(query));
}
