// pick-suggest.js — the small list that appears under a field while it is typed, offering
// things to pick with one tap. SHARED: the Catalogue links a recipe row with it, Food cost
// picks a recipe for a product's name with it.
//
// It knows nothing about recipes or ingredients: the caller says what matches (`suggest`)
// and what a pick means (`onPick`). What it owns is the behaviour, and every rule below was
// paid for on a phone:
//
// ⚠️ IN THE PAGE'S FLOW, NOT FLOATING. It is placed under the field by the caller and pushes
// the rest down. A floating box would have to be positioned against a phone keyboard that
// changes the visible area as it opens — and inside a framed list that clips its overflow,
// it would be cut off anyway.
// ⚠️ IT NEVER CHOOSES BY ITSELF. Nothing is picked without a tap, or Enter on a row
// highlighted with the arrows. Leaving the field, Escape, or no match just closes it.
// ⚠️ A TAP ON IT MUST NOT CLOSE IT FIRST. Touching the list would move the focus off the
// field before the click lands, the blur would close the list, and the tap would land on
// nothing — so the list swallows pointerdown and mousedown, which keeps the focus (and the
// keyboard) where it is.
// ⚠️ NO WORDS OF ITS OWN: the caller hands them over already translated, at draw time.

import { el } from './dom.js';

const CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

let lists = 0;

// Attach the list to a field. Returns { node, close } — `node` is placed by the caller.
//
//   suggest(typed)   → { items: [{ name, meta, linked, value }], total } — asked on every
//                      keystroke, so data still arriving is offered as it lands
//   onPick(value)    → an item was tapped (its `value`, whatever the caller put there)
//   onSeeAll(typed)  → optional: offered as a last row when `total` is more than shown
//   extra(typed)     → optional { label } for a last row that is not a match — «create it» —
//                      or null when there is none to offer
//   onExtra(typed)   → that row was tapped
//   texts            → { list: 'label for a screen reader', seeAll: n => '…', linked: '…' }
export function attachSuggestions(input, { suggest, onPick, onSeeAll = null, extra = null, onExtra = null, texts = {} }) {
  const listId = `pick-suggest-${++lists}`;
  const list = el('div', { class: 'pick-suggest', id: listId, role: 'listbox', 'aria-label': texts.list || null });
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
    const result = suggest(typed) || { items: [], total: 0 };
    const items = result.items || [];
    // ⚠️ THE «CREATE IT» ROW MAY BE THE ONLY ROW: nothing matching is exactly when it is wanted.
    const extraRow = extra && onExtra ? extra(typed) : null;
    if (!items.length && !extraRow) { close(); return; }
    entries = items.map(item => ({ item }));
    if (onSeeAll && result.total > items.length) entries.push({ seeAll: result.total, typed });
    if (extraRow) entries.push({ extra: extraRow, typed });
    active = -1;
    list.replaceChildren(...entries.map(row));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.removeAttribute('aria-activedescendant');
  }

  function row(entry, index) {
    const id = `${listId}-${index}`;
    if (entry.extra) {
      return el('div', {
        class: 'pick-suggest-row pick-suggest-extra', id, role: 'option', 'aria-selected': 'false',
        onclick: () => choose(index), text: entry.extra.label,
      });
    }
    if (entry.seeAll) {
      return el('div', {
        class: 'pick-suggest-row pick-suggest-all', id, role: 'option', 'aria-selected': 'false',
        onclick: () => choose(index), text: texts.seeAll ? texts.seeAll(entry.seeAll) : String(entry.seeAll),
      });
    }
    const { item } = entry;
    const meta = item.meta || '';
    return el('div', {
      class: 'pick-suggest-row' + (item.linked ? ' linked' : ''), id, role: 'option', 'aria-selected': 'false',
      // The tick is a picture; a screen reader is told in words.
      'aria-label': item.linked ? `${item.name}, ${meta ? `${meta}, ` : ''}${texts.linked || ''}` : null,
      onclick: () => choose(index),
    }, [
      el('span', { class: 'pick-suggest-text' }, [
        el('span', { class: 'pick-suggest-name', text: item.name }),
        meta ? el('span', { class: 'pick-suggest-meta', text: meta }) : null,
      ]),
      item.linked ? el('span', { class: 'pick-suggest-check', icon: CHECK_SVG, 'aria-hidden': 'true' }) : null,
    ]);
  }

  function choose(index) {
    const entry = entries[index];
    if (!entry) return;
    close();
    if (entry.extra) { onExtra(entry.typed); return; }
    if (entry.seeAll) { onSeeAll(entry.typed); return; }
    onPick(entry.item.value);
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
