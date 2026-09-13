// ingredient-suggest.js — the small list that appears under a recipe row's name while it
// is typed, so the row can be linked to an ingredient (or a recipe) with one tap.
//
// Federico, 13 Sep 2026: «quando compilo una ricetta ed inserisco un ingrediente fammi
// comparire una piccola lista per collegare agli ingredienti disponibili nel catalogo,
// ad esempio digito burro subito dopo mi si apre la piccola finestra dove scelgo tra i
// burri che abbiamo a disposizione». And, asked what the row should then say: «il nome
// dell'ingrediente lo scrivo io» — the list LINKS; it never changes what was typed.
//
// ⚠️ THE LIST ITSELF IS SHARED since 13 Sep 2026 (js/pick-suggest.js), because Food cost
// needs the same one under a product's name. Its behaviour rules live there. This file is
// only the catalogue's half: what matches (suggestLinks(), catalogue-model.js, tested),
// what each row says, and the catalogue's words.

import { t } from '../i18n.js';
import { attachSuggestions } from '../pick-suggest.js';
import { suggestLinks } from './catalogue-model.js';

// Attach the list to a row's name field. Returns { node, close } — `node` is placed by the
// caller, under the row.
//
//   options()        → { ingredients, recipes, suppliers, excludeRecipeId } — read on
//                      every keystroke, so data still arriving is offered as it lands
//   linked()         → the row's current { kind, refId }, or null
//   onPick(chosen)   → { kind, refId, name } was tapped
//   onSeeAll(query)  → open the full chooser with what was typed
export function attachLinkSuggestions(input, { options, linked, onPick, onSeeAll }) {
  return attachSuggestions(input, {
    suggest: typed => {
      const result = suggestLinks({ ...options(), query: typed, linked: linked() });
      return {
        total: result.total,
        items: result.items.map(item => ({
          name: item.name,
          // ⚠️ NO PRICE: the catalogue shows no money (tests/catalogue-no-money.test.mjs).
          meta: item.kind === 'recipe'
            ? t('cat.recipe')
            : [item.weight, item.supplierName].filter(Boolean).join('  ·  '),
          linked: item.linked,
          value: { kind: item.kind, refId: item.refId, name: item.name },
        })),
      };
    },
    onPick,
    onSeeAll,
    texts: {
      list: t('cat.suggest.label'),
      seeAll: n => t('cat.suggest.seeAll', { n }),
      linked: t('cat.suggest.linked'),
    },
  });
}
