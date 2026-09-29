// catalogue-list.js — the recipe list view: a name search plus the recipes as
// clean name-only cards, most-used first. Returns { root, refresh } so the live
// Firestore listener can update the cards without rebuilding (and losing) the
// search box.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { sortByUsage, filterByName } from './catalogue-model.js';
import { buildCatalogueSearch } from './search-box.js';

// The one arrow: the same chevron every other list in the app draws.
const CHEVRON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

export function renderList({ recipes, usageMap, initialQuery = '', selectedId = null, onQueryChange, onOpen, onAdd }) {
  let query = initialQuery;
  // The recipe open beside the list on a tablet, marked aria-current (tokens.css gives it
  // the picked look). Held here because refresh() repaints every row on each snapshot.
  let selected = selectedId;
  let currentRecipes = recipes;
  let currentUsage = usageMap;

  const listContainer = el('div', { class: 'cat-list' });

  // The field itself moved to search-box.js so the allergen sheet gets the same
  // one. Same behaviour: the query is stored on every keystroke, the repaint is
  // debounced.
  const { node: search } = buildCatalogueSearch({
    value: query,
    placeholder: t('cat.searchARecipe'),
    ariaLabel: t('cat.searchARecipeBy'),
    onInput: (text) => {
      query = text;
      if (onQueryChange) onQueryChange(query);
    },
    onChange: () => paint(),
  });

  function paint() {
    listContainer.replaceChildren();
    const visible = sortByUsage(filterByName(currentRecipes, query), currentUsage);
    if (!visible.length) {
      // A search that matches nothing stays a small line under the box; a catalogue
      // with NO recipes is the screen-level empty state, with the header «+»'s action.
      listContainer.appendChild(currentRecipes.length
        ? el('div', { class: 'cat-empty', text: t('cat.noRecipeMatchesYour') })
        : el('div', { class: 'empty-state' }, [
          el('p', { class: 'empty-title', text: t('calc.noRecipesYet') }),
          el('p', { class: 'empty-sub', text: t('cat.empty.sub') }),
          el('button', { class: 'empty-action', type: 'button', text: t('calc.addARecipe'), onclick: onAdd }),
        ]));
      return;
    }
    for (const recipe of visible) {
      listContainer.appendChild(el('button', {
        class: 'cat-card',
        type: 'button',
        dataset: { id: recipe.id },
        'aria-current': recipe.id === selected ? 'true' : null,
        onclick: () => onOpen(recipe),
      }, [
        el('span', { class: 'name', text: recipe.name || t('cat.noName') }),
        el('span', { class: 'chev', 'aria-hidden': 'true', icon: CHEVRON_SVG }),
      ]));
    }
  }

  paint();
  const listPanel = el('div', { class: 'cat-list-panel' }, [listContainer]);
  // ⚠ THE ALLERGEN SHEET IS NO LONGER HERE. It was a full-width row between the
  // search and the recipes, which put a screen nobody opens daily above the one
  // thing this page exists for. Federico, 22 Aug 2026: it belongs in the bottom bar
  // beside Settings — see catalogue.html and setHeader() in catalogue-main.js, where
  // each button carries its own permission.
  const root = el('div', { class: 'cat-view' }, [search, listPanel]);

  return {
    root,
    refresh(newRecipes, newUsage) {
      currentRecipes = newRecipes;
      currentUsage = newUsage;
      paint();
    },
    // Mark another row as the open one WITHOUT repainting: the search text, the scroll and
    // the focus of the list stay exactly where they are.
    select(id) {
      selected = id;
      listContainer.querySelectorAll('.cat-card').forEach((row) => {
        if (id !== null && row.dataset.id === id) row.setAttribute('aria-current', 'true');
        else row.removeAttribute('aria-current');
      });
    },
  };
}
