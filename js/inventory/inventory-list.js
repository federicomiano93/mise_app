// inventory-list.js — the shelves, as a list you walk down once a month.
//
// The job this screen is built around is physical: somebody is standing in a
// storeroom with a phone in one hand, reading a number off a shelf and typing it.
// So the count box is ON the row — no tapping in and out of 67 detail screens —
// and everything else about the product is one tap away for the rare row that
// needs correcting.
//
// ⚠️ THE ROW IS A DIV, NOT A BUTTON, and that is not a style choice: a button
// cannot contain another button or an input, so a tappable card with a count box
// inside it is invalid markup that browsers then treat as they please. The frame
// belongs to the row; the name is the button and the box is the input, side by
// side inside it. Same lesson, same shape, as the delete icon in the WhatsApp
// entry card (PR #31).
//
// ⚠️⚠️ AND THE RULE THAT COST THIS SCREEN A RELEASE: A COUNT BEING TYPED MUST
// NEVER REBUILD THE LIST. Every box change runs setCount → the store saves and
// announces → refresh() — synchronously, inside the `change` handler, which fires
// the instant a finger leaves one box for the next. Rebuilding there destroys the
// box being reached for: the tap lands on a node that no longer exists and the
// keyboard closes. Sixty-seven times, on the one screen somebody spends an hour on.
// So refresh() UPDATES the rows in place and only rebuilds when the set of rows
// itself has changed — which a count never does. js/inventory/inventory-detail.js
// documents and avoids the same trap; this file used to do the opposite.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { consumption, progressOf } from './inventory-model.js';

// A product with no category typed, or the default 'Other', belongs to the same
// group: three ways of saying "nothing was chosen here" that must not become
// three headings. Copied from the Orders rule rather than imported — a feature
// never imports from another feature's folder.
function categoryOf(ingredient) {
  const raw = String((ingredient && ingredient.category) || '').trim();
  return raw === 'Other' ? '' : raw;
}

function labelOf(ingredient) {
  return [ingredient.name, ingredient.weight].filter(Boolean).join(' ').trim()
    || t('inv.unnamedProduct');
}

// Fold accents and case so "però" matches "pero" — the same normalising the
// Orders search does, for the same reason: nobody types accents into a search.
function fold(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function matches(ingredient, query) {
  if (!query) return true;
  const needle = fold(query);
  return fold(ingredient.name).includes(needle)
    || fold(ingredient.brand).includes(needle)
    || fold(ingredient.category).includes(needle);
}

// The number as it should read on a phone: 3 stays 3, 3.5 becomes "3,5" in
// Italian. Intl does the comma, so no locale is ever written into this file.
function num(value, locale) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value);
}

export function renderList({ month, ingredients, locale, onOpen, onCount, onCarry, onPurchases, readOnly }) {
  const state = { query: '', onlyTodo: false };

  const summary = el('div', { class: 'inv-summary' });
  const summaryLabel = el('p', { class: 'inv-summary-label', text: t('inv.counted') });
  const summaryValue = el('p', { class: 'inv-summary-value' });
  const summaryNote = el('p', {
    class: 'inv-summary-note',
    text: readOnly ? t('inv.monthClosedNote') : t('inv.emptyIsNotZero'),
  });
  summary.append(summaryLabel, summaryValue, summaryNote);

  const rows = el('div', { class: 'inv-list' });

  // The two things the app can fill in for you, once each per month. They sit
  // with the list because they change what is in it — and NOT in the bottom bar,
  // which belongs to the one action that ends the month.
  const actions = readOnly ? null : el('div', { class: 'inv-actions' }, [
    el('button', { class: 'inv-action', type: 'button', text: t('inv.carryShort'), onclick: onCarry }),
    el('button', { class: 'inv-action', type: 'button', text: t('inv.purchasesShort'), onclick: onPurchases }),
  ]);

  const search = el('input', {
    class: 'inv-search',
    type: 'search',
    autocomplete: 'off',
    'data-i18n': 'inv.searchProducts',
    'data-i18n-attr': 'placeholder',
    placeholder: t('inv.searchProducts'),
    'aria-label': t('inv.searchProducts'),
    oninput: (e) => { state.query = e.target.value; buildRows(); },
  });

  const todoToggle = el('button', {
    class: 'inv-filter', type: 'button', 'aria-pressed': 'false',
    onclick: () => {
      state.onlyTodo = !state.onlyTodo;
      todoToggle.setAttribute('aria-pressed', String(state.onlyTodo));
      todoToggle.classList.toggle('on', state.onlyTodo);
      buildRows();
    },
  }, [el('span', { text: t('inv.stillToCount') })]);

  const root = el('div', { class: 'inv-view' }, [
    summary,
    actions,
    el('div', { class: 'inv-tools' }, [search, todoToggle]),
    rows,
  ]);

  let current = { month, ingredients };
  // The rows that are in the document right now: id → its parts, in render order.
  // What is rendered is a FACT about the DOM, never recomputed from the data — the
  // whole point is that a count leaves it alone.
  let rendered = [];
  let nodes = new Map();

  // Everything the search matches, whether counted or not. This — not what is
  // VISIBLE — decides whether the list has to be rebuilt: the "still to count"
  // filter must not drop a row the moment its number is typed, or it drops it
  // under the finger reaching for the next one.
  function matching() {
    return current.ingredients.filter(i => matches(i, state.query));
  }

  function visible() {
    return matching().filter(i => !state.onlyTodo || !consumption(current.month, i.id).counted);
  }

  function paintSummary() {
    const progress = progressOf(current.month, current.ingredients.map(i => i.id));
    summaryValue.textContent = t('inv.countedOf', {
      counted: progress.counted, total: progress.total,
    });
  }

  // The rows, from scratch. Only ever on mount, on a search, on the filter, and
  // when the products themselves have changed.
  function buildRows() {
    const list = visible();
    nodes = new Map();
    rendered = [];
    rows.replaceChildren();

    if (!list.length) {
      rows.appendChild(el('p', {
        class: 'inv-empty',
        text: state.query || state.onlyTodo ? t('inv.nothingMatches') : t('inv.noProductsYet'),
      }));
      return;
    }

    // Grouped by category, because that is how a storeroom is walked: everything
    // in the dry store, then everything in the fridge. Products with no category
    // come last — they are the ones nobody has filed yet.
    const groups = new Map();
    list.forEach(ingredient => {
      const key = categoryOf(ingredient);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ingredient);
    });

    [...groups.keys()]
      .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, locale)))
      .forEach(key => {
        rows.appendChild(el('h2', {
          class: 'inv-group',
          text: key || t('inv.noCategory'),
        }));
        groups.get(key)
          .sort((a, b) => String(a.name).localeCompare(String(b.name), locale))
          .forEach(ingredient => rows.appendChild(row(ingredient)));
      });
  }

  // What the row says underneath the name: the two numbers the answer is made of,
  // and the answer. A row nobody has counted says so in words instead — it is not
  // a zero, and the screen must never let it look like one.
  function subText(line) {
    if (line.counted && line.hasOpening) {
      return t('inv.hadBoughtUsed', {
        had: num(line.opening, locale),
        bought: num(line.purchased, locale),
        used: num(line.used, locale),
      });
    }
    return line.counted ? t('inv.noOpeningYet') : t('inv.notCountedYet');
  }

  function row(ingredient) {
    const line = consumption(current.month, ingredient.id);
    const name = labelOf(ingredient);

    const nameEl = el('span', { class: 'inv-row-name', text: name });
    const subEl = el('span', {
      class: 'inv-row-sub' + (line.counted ? '' : ' todo'),
      text: subText(line),
    });

    const box = el('input', {
      // text + inputmode, never type="number": a numeric field refuses the comma
      // an Italian keyboard produces, and its spinner arrows are useless on a
      // phone and eat the width the number needs.
      class: 'inv-count', type: 'text', inputmode: 'decimal',
      autocomplete: 'off', enterkeyhint: 'next',
      value: line.closing === null ? '' : num(line.closing, locale),
      'aria-label': t('inv.countFor', { name }),
      disabled: readOnly ? 'disabled' : null,
      onchange: (e) => onCount(ingredient.id, e.target.value),
    });

    const node = el('div', {
      class: 'inv-row' + (line.counted ? ' counted' : ''),
    }, [
      el('button', {
        class: 'inv-row-open', type: 'button',
        'aria-label': t('inv.openProduct', { name }),
        onclick: () => onOpen(ingredient),
      }, [nameEl, subEl]),
      el('div', { class: 'inv-row-count' }, [
        box,
        el('span', { class: 'inv-row-unit', text: ingredient.unit || t('inv.packsShort') }),
      ]),
    ]);

    // ⚠️ THE CATEGORY IS REMEMBERED, because it is what the row was FILED under and
    // in-place updates cannot move a row between headings. See structureChanged().
    nodes.set(ingredient.id, { node, nameEl, subEl, box, category: categoryOf(ingredient) });
    rendered.push(ingredient.id);
    return node;
  }

  // The same rows, told what changed. Nothing is created, moved or removed.
  //
  // ⚠️ THE BOX BEING TYPED INTO IS LEFT ALONE. Writing a value into the focused
  // input would move the caret to the end mid-number; and "3," on its way to "3,5"
  // is not yet a number the store can canonicalise.
  function updateRows() {
    const byId = new Map(current.ingredients.map(i => [i.id, i]));
    for (const id of rendered) {
      const parts = nodes.get(id);
      if (!parts) continue;
      const ingredient = byId.get(id);
      const line = consumption(current.month, id);

      if (ingredient) {
        const name = labelOf(ingredient);
        if (parts.nameEl.textContent !== name) parts.nameEl.textContent = name;
      }
      const sub = subText(line);
      if (parts.subEl.textContent !== sub) parts.subEl.textContent = sub;
      parts.subEl.classList.toggle('todo', !line.counted);
      parts.node.classList.toggle('counted', line.counted);

      if (document.activeElement !== parts.box) {
        const text = line.closing === null ? '' : num(line.closing, locale);
        if (parts.box.value !== text) parts.box.value = text;
      }
    }
  }

  // Whether the LIST has changed, as opposed to the numbers in it.
  //
  // ⚠️ A COUNT CAN NEVER MAKE THIS TRUE, and that is what makes it safe to trust.
  // Two questions only: is there a row on screen whose product is gone, and is
  // there a product that should be on screen and is not. With the "still to count"
  // filter on, a row that has just been counted is neither — it stays where it is,
  // marked counted, until the next search, filter tap or reload. Dropping it the
  // instant its number was typed is precisely what took the next box away from
  // under the finger.
  // ⚠️ AND A THIRD QUESTION, WHICH A COUNT ALSO CANNOT CHANGE: has a row's CATEGORY
  // moved? The products arrive from Firestore a moment after the first paint, so the
  // first rows are drawn with nothing to file them under — and a closed month, whose
  // rows come from the frozen list rather than from a search, kept every one of them
  // under «No category» for ever, because in-place updates cannot move a row between
  // headings. Seen on a phone-sized window; no unit test was looking at headings.
  function structureChanged() {
    const rows = matching();
    const matched = new Set(rows.map(i => i.id));
    if (rendered.some(id => !matched.has(id))) return true;
    if (rows.some(i => nodes.has(i.id) && nodes.get(i.id).category !== categoryOf(i))) return true;
    return visible().some(i => !nodes.has(i.id));
  }

  function refresh(nextMonth, nextIngredients) {
    current = { month: nextMonth, ingredients: nextIngredients };
    paintSummary();
    if (structureChanged()) buildRows(); else updateRows();
  }

  paintSummary();
  buildRows();
  return { root, refresh };
}
