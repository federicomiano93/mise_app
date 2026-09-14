// ingredient-picker.js — the full-screen chooser that links a recipe row to a
// real ingredient (or to another recipe).
//
// ⚠️ THE CHOOSER ITSELF IS SHARED since 13 Sep 2026 (js/pick-screen.js), because Food cost
// needs the same one. This file is the catalogue's half: what can be linked (linkOptions(),
// catalogue-model.js, tested), what each row says, and the catalogue's words and header.

import { t } from '../i18n.js';
import { openPickScreen } from '../pick-screen.js';
import { linkOptions } from './catalogue-model.js';
import { nameTaken } from './ingredient-suggest.js';

// Open the picker. Resolves with { kind, refId, name } when something is chosen,
// with null when the link is removed, and with undefined when it is dismissed —
// three different answers, because "cancel" must not silently clear a link.
//
// `initialQuery` opens it already searching — «Vedi tutti» under a row's suggestion list
// hands over what was typed, so nobody has to type it twice.
//
// `mayCreate` offers «+ Crea "…" come ingrediente» at the end of the list; choosing it
// resolves with { create: name }, a fourth answer the caller turns into a new ingredient.
export function openLinkPicker({ ingredients, recipes, suppliers, excludeRecipeId, hasLink, initialQuery = '', mayCreate = false }) {
  return openPickScreen({
    extraAction: query => {
      const name = String(query ?? '').trim();
      if (!mayCreate || !name || nameTaken(ingredients, name)) return null;
      return { label: t('cat.createIngredient', { name }), value: { create: name } };
    },
    title: t('cat.linkTo'),
    backLabel: t('ui.back'),
    searchLabel: t('cat.searchAnIngredient'),
    initialQuery,
    chrome: { header: 'cat-header cat-pick-header', slot: 'cat-pick-spacer', title: 'cat-pick-title', icon: 'cat-icon-btn' },
    // Only offered when there IS a link: a "remove" on a row that has none does nothing.
    topAction: hasLink ? { label: t('cat.removeTheLink'), value: null } : null,
    sections: query => {
      const options = linkOptions({ ingredients, recipes, suppliers, query, excludeRecipeId });
      return [
        {
          heading: t('cat.ingredients'),
          // Name · weight · supplier — what tells two similar-looking articles apart.
          // ⚠️ NO PRICE SINCE 13 SEP 2026: the catalogue shows no money at all (a cost
          // is real only in Food cost, where the oven loss and the rest of the product
          // are known), and it no longer even loads the prices.
          items: options.ingredients.map(opt => ({
            name: opt.name,
            meta: [opt.weight, opt.supplierName].filter(Boolean).join('  ·  '),
            value: { kind: 'ingredient', refId: opt.id, name: opt.name },
          })),
        },
        {
          heading: t('ui.recipes'),
          // ⚠️ Was the English word 'Recipe' written into the code, on an Italian venue too.
          items: options.recipes.map(opt => ({
            name: opt.name, meta: t('cat.recipe'),
            value: { kind: 'recipe', refId: opt.id, name: opt.name },
          })),
        },
      ];
    },
    emptyText: query => (query ? t('cat.nothingMatchesYourSearch') : t('cat.noIngredientsYetAdd')),
  });
}
