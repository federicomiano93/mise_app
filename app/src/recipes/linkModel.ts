// linkModel.ts — what a recipe row's link line says. The pure half of `linkText` in js/catalogue/catalogue-editor.js.
//
// ⚠️ NO PRICE ANYWHERE (13 Sep 2026): a recipe's cost on its own is not real — it knows neither its oven loss nor what is
// added to the product later — so the catalogue shows no money, and Food cost is where a cost is read. What still catches a
// link to the wrong article is the pack weight and the supplier.

import { linkOf, linkedItemName, supplierLabel } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import type { MessageKey } from '../i18n/en';
import type { StoredDoc } from './recipesSource';

// The separator of the original: two spaces, a dot, two spaces.
export const LINK_SEPARATOR = '  ·  ';

type Say = (key: MessageKey) => string;

// «→ Flour 0  ·  25 kg  ·  Supplier», «→ Focaccia  ·  Recipe», an invitation when there is no link, or the sentence that
// says the target is gone. `ingredients` is the id → document map, `recipes` the list.
export function linkText(
  row: unknown,
  ingredients: Readonly<Record<string, StoredDoc>>,
  recipes: readonly CatalogueRecipe[],
  suppliers: Readonly<Record<string, StoredDoc>>,
  t: Say,
): string {
  const link = linkOf(row);
  if (!link) return t('cat.linkToAnIngredient');

  if (link.kind === 'recipe') {
    const name = linkedItemName(link, {}, recipes);
    return name ? `→ ${name}${LINK_SEPARATOR}${t('cat.recipe')}` : t('cat.aRecipeThatNo');
  }

  const ingredient = ingredients[link.refId];
  if (!ingredient) return t('cat.anIngredientThatNo');
  const supplier = supplierLabel(suppliers[String(ingredient.supplierId)]);
  const weight = String(ingredient.weight || '').trim();
  return [`→ ${linkedItemName(link, ingredients, []) || t('cat.ingredient')}`, weight, supplier]
    .filter(Boolean).join(LINK_SEPARATOR);
}
