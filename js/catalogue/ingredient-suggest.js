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
//   mayCreate()      → may this person add a missing ingredient here (asked at draw time)
//   onCreate(name)   → «+ Crea "…" come ingrediente» was tapped
export function attachLinkSuggestions(input, { options, linked, onPick, onSeeAll, mayCreate = () => false, onCreate = null }) {
  return attachSuggestions(input, {
    // Federico, 13 Sep 2026: «se non c'è in anagrafica fammelo inserire direttamente dalla
    // ricerca degli ingredienti». Offered under whatever was typed — never when an ingredient
    // of exactly that name already exists, because then the row above it IS that ingredient.
    extra: typed => {
      const name = String(typed ?? '').trim();
      if (!onCreate || !name || !mayCreate()) return null;
      return nameTaken(options().ingredients, name) ? null : { label: t('cat.createIngredient', { name }) };
    },
    onExtra: typed => onCreate(String(typed ?? '').trim()),
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

// Is there already an ingredient called exactly this (ignoring case and spaces at the ends)
// among the ones a recipe row can be LINKED to — active, and food rather than packaging?
// ⚠️ THE SAME SET linkOptions() offers. Counting a switched-off ingredient or a box here
// withheld the «create» row while the list above offered nothing: a dead end with no reason
// given (the code review of 14 Sep 2026). `ingredients` is the store's map by id, or a list.
export function nameTaken(ingredients, name) {
  const wanted = String(name ?? '').trim().toLowerCase();
  return Object.values(ingredients || {})
    .some(ing => ing && ing.active !== false && ing.kind !== 'packaging'
      && String(ing.name ?? '').trim().toLowerCase() === wanted);
}
