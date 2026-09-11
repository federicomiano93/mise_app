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
    oninput: (e) => { state.query = e.target.value; paintRows(); },
  });

  const todoToggle = el('button', {
    class: 'inv-filter', type: 'button', 'aria-pressed': 'false',
    onclick: () => {
      state.onlyTodo = !state.onlyTodo;
      todoToggle.setAttribute('aria-pressed', String(state.onlyTodo));
      todoToggle.classList.toggle('on', state.onlyTodo);
      paintRows();
    },
  }, [el('span', { text: t('inv.stillToCount') })]);

  const root = el('div', { class: 'inv-view' }, [
    summary,
    actions,
    el('div', { class: 'inv-tools' }, [search, todoToggle]),
    rows,
  ]);

  let current = { month, ingredients };

  function visible() {
    return current.ingredients
      .filter(i => i && i.active !== false && String(i.name || '').trim())
      .filter(i => matches(i, state.query))
      .filter(i => !state.onlyTodo || !consumption(current.month, i.id).counted);
  }

  function paintSummary() {
    const countable = current.ingredients.filter(i => i && i.active !== false && String(i.name || '').trim());
    const progress = progressOf(current.month, countable.map(i => i.id));
    summary.replaceChildren(
      el('p', { class: 'inv-summary-label', text: t('inv.counted') }),
      el('p', {
        class: 'inv-summary-value',
        text: t('inv.countedOf', { counted: progress.counted, total: progress.total }),
      }),
      el('p', {
        class: 'inv-summary-note',
        text: readOnly ? t('inv.monthClosedNote') : t('inv.emptyIsNotZero'),
      }),
    );
  }

  function paintRows() {
    const list = visible();
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

  function row(ingredient) {
    const line = consumption(current.month, ingredient.id);
    const name = labelOf(ingredient);

    // What the row says underneath the name: the two numbers the answer is made
    // of, and the answer. A row nobody has counted says so in words instead —
    // it is not a zero, and the screen must never let it look like one.
    const sub = line.counted && line.hasOpening
      ? t('inv.hadBoughtUsed', {
        had: num(line.opening, locale),
        bought: num(line.purchased, locale),
        used: num(line.used, locale),
      })
      : line.counted
        ? t('inv.noOpeningYet')
        : t('inv.notCountedYet');

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

    return el('div', {
      class: 'inv-row' + (line.counted ? ' counted' : ''),
    }, [
      el('button', {
        class: 'inv-row-open', type: 'button',
        'aria-label': t('inv.openProduct', { name }),
        onclick: () => onOpen(ingredient),
      }, [
        el('span', { class: 'inv-row-name', text: name }),
        el('span', { class: 'inv-row-sub' + (line.counted ? '' : ' todo'), text: sub }),
      ]),
      el('div', { class: 'inv-row-count' }, [
        box,
        el('span', { class: 'inv-row-unit', text: ingredient.unit || t('inv.packsShort') }),
      ]),
    ]);
  }

  function refresh(nextMonth, nextIngredients) {
    current = { month: nextMonth, ingredients: nextIngredients };
    paintSummary();
    paintRows();
  }

  refresh(month, ingredients);
  return { root, refresh };
}
