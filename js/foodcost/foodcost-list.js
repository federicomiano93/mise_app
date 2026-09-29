// foodcost-list.js — the product list, worst margin first.
//
// The reason to open this screen is to find what is losing money, so that is what
// the top of the list shows. A product that cannot be costed sorts LAST: it is a
// data-entry job, not a margin problem, and at the top it would bury the answer.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { sortByMargin, blockerText } from './foodcost-model.js';
import { formatRate, formatMoney } from '../price-model.js';

// Keys, resolved at draw time — see js/calculator-render.js.
const STATUS_TEXT = { green: 'fc.onTarget', amber: 'fc.slightlyOver', red: 'fc.overTarget' };

// `filter` — { title, onShowAll } — is set when the page was opened from a recipe that
// more than one product uses (Federico's choice, 13 Sep 2026): the caller passes only
// those products, and this says so on screen and offers the way back to all of them.
export function renderList({ products, tables, onOpen, onAdd, filter = null, selectedId = null }) {
  // The product open beside the list on a tablet, marked aria-current (tokens.css gives it
  // the picked look). Held here because refresh() repaints every row.
  let selected = selectedId;
  const rows = el('div', { class: 'fc-list' });

  const root = el('div', { class: 'fc-view' }, [
    filter ? el('div', { class: 'fc-filter' }, [
      el('p', { class: 'fc-filter-title', text: filter.title }),
      el('button', { class: 'fc-link', type: 'button', text: t('fc.showAll'), onclick: filter.onShowAll }),
    ]) : null,
    rows,
  ]);

  function paint(nextProducts, nextTables) {
    const list = sortByMargin(nextProducts, nextTables);
    rows.replaceChildren();

    if (!list.length) {
      // The screen-level empty state (tokens.css). Its button does what the header «+»
      // does — the header one is the only other way to add, so a first-time viewer is
      // never left hunting for it. Narrowed to a recipe, the header «+» still adds, and
      // so does this.
      rows.appendChild(el('div', { class: 'empty-state' }, [
        el('p', { class: 'empty-title', text: t('fc.empty.title') }),
        el('p', { class: 'empty-sub', text: t('fc.empty.sub') }),
        el('button', { class: 'empty-action', type: 'button', text: t('fc.empty.action'), onclick: onAdd }),
      ]));
      return;
    }

    list.forEach(({ product, result }) => {
      rows.appendChild(row(product, result, onOpen, product.id === selected));
    });
  }

  paint(products, tables);
  return {
    root,
    refresh: paint,
    // Move the mark WITHOUT repainting: the search, the scroll and the focus stay put.
    select(id) {
      selected = id;
      rows.querySelectorAll('.fc-row').forEach((r) => {
        if (id !== null && r.dataset.id === id) r.setAttribute('aria-current', 'true');
        else r.removeAttribute('aria-current');
      });
    },
  };
}

function row(product, result, onOpen, isSelected) {
  const costed = result.foodCostPct !== null;

  // The traffic light is a dot AND a word. Colour alone is not a signal for
  // everyone (P18), and a screen-reader user gets nothing from a coloured circle.
  const light = el('span', {
    class: `fc-dot ${result.status || 'none'}`, 'aria-hidden': 'true',
  });

  const figure = costed
    ? el('span', { class: 'fc-pct', text: `${result.foodCostPct}%` })
    : el('span', { class: 'fc-pct fc-pct-none', text: '—' });

  // What is still missing, or what it earns. Either way ONE line, so every card is
  // the same height and the list stays scannable.
  const sub = costed
    // ⚠️ «cost» and «margin» were English written into the code, on an Italian venue
    // too — no dictionary could reach them. Keys since 13 Sep 2026.
    ? [result.status ? t(STATUS_TEXT[result.status]) : t('fc.noTargetSet'),
       t('fc.listCost', { cost: formatRate(result.unitCost) }),
       t('fc.listMargin', { margin: formatMoney(result.margin) })].join('  ·  ')
    : (result.blockers.length ? blockerText(result.blockers[0]) : t('fc.notCostedYet'));

  return el('button', {
    class: 'fc-row' + (costed ? '' : ' incomplete'), type: 'button',
    dataset: { id: product.id },
    'aria-current': isSelected ? 'true' : null,
    onclick: () => onOpen(product),
  }, [
    el('div', { class: 'fc-row-main' }, [
      el('span', { class: 'fc-row-name', text: product.name || t('fc.untitledProduct') }),
      el('span', { class: 'fc-row-sub', text: sub }),
    ]),
    el('div', { class: 'fc-row-figure' }, [light, figure]),
  ]);
}
