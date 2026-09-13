// ingredient-suggest.js — the small list that appears under a recipe row's name while it
// is typed, so the row can be linked to an ingredient (or a recipe) with one tap.
//
// Federico, 13 Sep 2026: «quando compilo una ricetta ed inserisco un ingrediente fammi
// comparire una piccola lista per collegare agli ingredienti disponibili nel catalogo,
// ad esempio digito burro subito dopo mi si apre la piccola finestra dove scelgo tra i
// burri che abbiamo a disposizione». And, asked what the row should then say: «il nome
// dell'ingrediente lo scrivo io» — the list LINKS; it never changes what was typed.
//
// ⚠️ IN THE PAGE'S FLOW, NOT FLOATING. It is placed under the row and pushes the rest
// down. A floating box would have to be positioned against a phone keyboard that changes
// the visible area as it opens — and inside the framed ingredient list, which clips its
// overflow, it would be cut off anyway.
// ⚠️ IT NEVER CHOOSES BY ITSELF. Nothing is linked without a tap, or Enter on a row
// highlighted with the arrows. Leaving the field, Escape, or no match just closes it.
// ⚠️ A TAP ON IT MUST NOT CLOSE IT FIRST. Touching the list would move the focus off the
// field before the click lands, the blur would close the list, and the tap would land on
// nothing — so the list swallows pointerdown and mousedown, which keeps the focus (and the
// keyboard) where it is.
//
// What is offered, and in what order, is suggestLinks()'s (catalogue-model.js, tested).

import { t } from '../i18n.js';
import { el } from './dom.js';
import { suggestLinks } from './catalogue-model.js';

const CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

let lists = 0;

// Attach the list to a row's name field. Returns { node, close } — `node` is placed by the
// caller, under the row.
//
//   options()        → { ingredients, recipes, suppliers, excludeRecipeId } — read on
//                      every keystroke, so data still arriving is offered as it lands
//   linked()         → the row's current { kind, refId }, or null
//   onPick(chosen)   → { kind, refId, name } was tapped
//   onSeeAll(query)  → open the full chooser with what was typed
export function attachLinkSuggestions(input, { options, linked, onPick, onSeeAll }) {
  const listId = `cat-suggest-${++lists}`;
  const list = el('div', { class: 'cat-suggest', id: listId, role: 'listbox', 'aria-label': t('cat.suggest.label') });
  list.hidden = true;

  let entries = [];   // what each row of the list stands for
  let active = -1;    // the row highlighted with the arrow keys, -1 for none

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', listId);

  function close() {
    list.hidden = true;
    list.replaceChildren();
    entries = [];
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function paint() {
    const typed = input.value;
    const result = suggestLinks({ ...options(), query: typed, linked: linked() });
    if (!result.items.length) { close(); return; }
    entries = result.items.map(item => ({ item }));
    if (result.total > result.items.length) entries.push({ seeAll: result.total, typed });
    active = -1;
    list.replaceChildren(...entries.map(row));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.removeAttribute('aria-activedescendant');
  }

  function row(entry, index) {
    const id = `${listId}-${index}`;
    if (entry.seeAll) {
      return el('div', {
        class: 'cat-suggest-row cat-suggest-all', id, role: 'option', 'aria-selected': 'false',
        onclick: () => choose(index), text: t('cat.suggest.seeAll', { n: entry.seeAll }),
      });
    }
    const { item } = entry;
    const meta = item.kind === 'recipe'
      ? t('cat.recipe')
      : [item.weight, item.supplierName].filter(Boolean).join('  ·  ');
    return el('div', {
      class: 'cat-suggest-row' + (item.linked ? ' linked' : ''), id, role: 'option', 'aria-selected': 'false',
      // The tick is a picture; a screen reader is told in words.
      'aria-label': item.linked ? `${item.name}, ${meta ? `${meta}, ` : ''}${t('cat.suggest.linked')}` : null,
      onclick: () => choose(index),
    }, [
      el('span', { class: 'cat-suggest-text' }, [
        el('span', { class: 'cat-suggest-name', text: item.name }),
        meta ? el('span', { class: 'cat-suggest-meta', text: meta }) : null,
      ]),
      item.linked ? el('span', { class: 'cat-suggest-check', icon: CHECK_SVG, 'aria-hidden': 'true' }) : null,
    ]);
  }

  function choose(index) {
    const entry = entries[index];
    if (!entry) return;
    close();
    if (entry.seeAll) { onSeeAll(entry.typed); return; }
    onPick({ kind: entry.item.kind, refId: entry.item.refId, name: entry.item.name });
  }

  function highlight(index) {
    if (!entries.length) return;
    active = (index + entries.length) % entries.length;
    [...list.children].forEach((node, i) => {
      node.classList.toggle('active', i === active);
      node.setAttribute('aria-selected', i === active ? 'true' : 'false');
    });
    input.setAttribute('aria-activedescendant', `${listId}-${active}`);
  }

  input.addEventListener('input', paint);
  input.addEventListener('keydown', e => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active < 0 ? entries.length - 1 : active - 1); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  input.addEventListener('blur', close);
  list.addEventListener('pointerdown', e => e.preventDefault());
  list.addEventListener('mousedown', e => e.preventDefault());

  return { node: list, close };
}
