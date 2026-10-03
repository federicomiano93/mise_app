// suppliers.js — the supplier LIST on the Order tab.
//
// A plain list of rows, one per supplier: a list icon, then name, category · delivery
// days, how many items are already typed for them, and a chevron. Tapping the row
// opens that supplier's ORDER (supplier-detail.js); tapping the icon opens the
// read-only list of what it sells (supplier-items.js).
//
// It used to be collapsible cards that expanded in place. The app's own rule is
// "list → detail, one level at a time, with a Back arrow that steps up" — Catalogue,
// the management panel, the History editor and the send screens all work that way, so
// the accordion was the odd one out. A dedicated screen also keeps the supplier's name
// pinned in the header instead of letting it scroll away while you type.
//
// MOUNTED ONCE, ROWS REPAINTED. The Orders screen re-renders on every suppliers /
// ingredients / history snapshot, including ones caused by another phone. If the
// search box were rebuilt each time, the text being typed would be wiped mid-search.
// So the box and the filter are built once and only the rows are repainted — the same
// arrangement as the flat ingredient list.

import { t } from '../i18n.js';
import { supplierLabel } from '../supplier-label.js';
import { el } from './dom.js';
import { buildSearchBox } from './search-box.js';
import { filterSuppliers } from './ingredient-search.js';
import { itemsLabel, summaryBarLabel } from './supplier-picker.js';
import { spellShortDate } from './day.js';
import { nextDeliveryAfter } from './order-day.js';

// ⚠️ THE KEYS OF THE STORED DAYS, MAPPED TO THE DICTIONARY'S SHORT FORMS. The left
// side is DATA — exactly what a supplier's deliveryDays holds, and it must stay English
// or a Monday supplier stops matching a Monday. The right side is what reaches a screen,
// so it is looked up, not written here: this table used to print 'Tue, Fri' under every
// supplier whatever language the app was in.
const DAY_INDEX = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};
// ⚠️ EXPORTED, because the Fornitori screen prints the same days on a supplier's own
// record. Its first draft did `.slice(0, 3)` and printed «consegna Tue, Fri» under an
// Italian heading — the same list, two screens, two answers. Found by looking at a
// screenshot; nothing measured it.
export const dayShort = (stored) => (stored in DAY_INDEX ? t(`day.weekdayShort.${DAY_INDEX[stored]}`) : stored);

const CHEVRON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

// "See what this supplier sells" — a list, not an eye: what it opens IS a list.
const LIST_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';

// "See what is in this supplier's order right now" — a clipboard, tablet only.
const SUMMARY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2h6v4H9z"/><path d="M9 11h6M9 14h6M9 17h4"/></svg>';

// The small «delivery Mon 12» tag under a supplier's name (the delivery day that follows the
// order day the quantities are for); «for Thu 8» — the order day itself — when the supplier
// has no delivery days. Always in the DOM, shown or hidden (see refreshSupplierDerived) —
// read the language here, when it is drawn.
function paintForDay(node, forDay, supplier) {
  if (!node) return;
  const delivery = forDay ? nextDeliveryAfter(supplier, forDay) : '';
  node.textContent = !forDay ? ''
    : delivery ? t('day.delivery', { day: spellShortDate(delivery) })
      : t('day.for', { day: spellShortDate(forDay) });
  node.hidden = !forDay;
}

// How many of a supplier's products have a quantity entered.
export function supplierStats(ingredients, entries) {
  const total = ingredients.length;
  const filled = ingredients.filter(i => (entries[i.id]?.qty || 0) > 0).length;
  return { total, filled };
}

// Refresh everything derived from the entries for one supplier, WITHOUT rebuilding
// anything — so an input keeps its focus while it is being typed into. Each piece
// guards on presence, because the count lives on the list row while the progress bar
// and the "Order placed" button live on the detail screen, and only one of the two is
// ever on screen.
export function refreshSupplierDerived(supplier, ingredients, entries, forDay = '') {
  const { total, filled } = supplierStats(ingredients, entries);

  // «for Mon 13»: the quantities typed are meant for a LATER order day. The first
  // keystroke on a non-order day can create that stamp, so it is revealed in place. ⚠️ Only
  // with something typed: a stock-only edit can create the stamp too, and must not tag the row.
  paintForDay(document.getElementById(`for-${supplier.id}`), filled ? forDay : '', supplier);

  const count = document.getElementById(`count-${supplier.id}`);
  if (count) {
    count.textContent = filled ? itemsLabel(filled) : '';
    count.hidden = filled === 0;
  }

  const fill = document.getElementById(`progress-fill-${supplier.id}`);
  if (fill) fill.style.width = `${total ? Math.round((filled / total) * 100) : 0}%`;

  const placeBtn = document.getElementById(`place-btn-${supplier.id}`);
  if (placeBtn) placeBtn.disabled = filled === 0;

  // "Clear quantities" is HIDDEN rather than disabled: with nothing typed there is
  // nothing to start again, and a permanently dead red button under the green one is
  // just noise. Hiding works here only because tokens.css forces
  // `[hidden] { display: none !important }` — .supplier-clear-btn's own
  // `display: block` would otherwise beat the browser's rule and paint a button every
  // script on the page believed was gone.
  const clearBtn = document.getElementById(`clear-btn-${supplier.id}`);
  if (clearBtn) clearBtn.hidden = filled === 0;

  // ⚠️ TABLET ONLY (orders.css), BUT UPDATED UNCONDITIONALLY, IN PLACE — the
  // same rule as every other derived bit on this row: the summary button and
  // its spacer both always exist, and only their `hidden` state swaps as
  // quantities change, so a keystroke never rebuilds the row it happened on.
  const summaryBtn = document.getElementById(`summary-${supplier.id}`);
  if (summaryBtn) summaryBtn.hidden = filled === 0;
  const spacer = document.getElementById(`spacer-${supplier.id}`);
  if (spacer) spacer.hidden = filled > 0;

  // The bar at the foot of the supplier's own screen: the count, on every keystroke.
  const barText = document.getElementById(`summary-bar-text-${supplier.id}`);
  if (barText) barText.textContent = summaryBarLabel(filled);
}

// container: #suppliers-list.
// ctx: { query, filterActive, onQuery(text), onFilter(active), onOpen(supplierId),
//        onView(supplierId) }
// -> { repaint({ suppliers, ingredientsBySupplier, entries }) }
export function mountSupplierList(container, ctx) {
  let data = { suppliers: [], ingredientsBySupplier: {}, entries: {} };
  let query = ctx.query || '';
  let filtering = Boolean(ctx.filterActive);

  const search = buildSearchBox({
    value: query,
    placeholder: t('orders.searchASupplier'),
    onInput: text => { query = text; ctx.onQuery?.(text); },
    onChange: paint,
  });

  // All / Ordering. A radiogroup rather than tabs: it picks how one list is filtered,
  // it does not swap between two panels.
  const allBtn = el('button', {
    type: 'button', class: 'view-switch-btn', role: 'radio',
    onClick: () => setFilter(false),
  });
  const orderingBtn = el('button', {
    type: 'button', class: 'view-switch-btn', role: 'radio',
    onClick: () => setFilter(true),
  });
  const filterSwitch = el('div', {
    class: 'view-switch ing-filter', role: 'radiogroup', 'aria-label': t('aria.whichSuppliers'),
  }, [allBtn, orderingBtn]);

  function setFilter(active) {
    if (filtering === active) return;
    filtering = active;
    ctx.onFilter?.(active);
    paint();
  }

  const list = el('div');

  // How many suppliers currently have something typed. Unlike the ingredient filter,
  // this needs no freezing: you cannot type a quantity on this screen, you tap into a
  // supplier — so no row can vanish under the finger that is editing it.
  function orderingCount(suppliers) {
    return suppliers.filter(s =>
      supplierStats(data.ingredientsBySupplier[s.id] || [], data.entries).filled > 0).length;
  }

  function paint() {
    const all = data.suppliers;
    const ordering = orderingCount(all);

    allBtn.textContent = t('orders.filter.all', { n: all.length });
    orderingBtn.textContent = t('orders.filter.ordering', { n: ordering });
    // Nothing typed anywhere — there is no "just what I'm ordering" to offer.
    filterSwitch.hidden = ordering === 0 && !filtering;
    [[allBtn, !filtering], [orderingBtn, filtering]].forEach(([btn, on]) => {
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', String(on));
    });

    const inScope = filtering
      ? all.filter(s => supplierStats(data.ingredientsBySupplier[s.id] || [], data.entries).filled > 0)
      : all;
    const rows = filterSuppliers(inScope, query);

    list.replaceChildren();
    if (!rows.length) {
      list.appendChild(el('p', {
        class: 'mgmt-empty',
        text: query ? t('orders.noSupplierMatchesYour') : t('orders.nothingIsBeingOrdered'),
      }));
      return;
    }
    rows.forEach(s => list.appendChild(buildSupplierRow(s, data, ctx)));
  }

  // `ctx.searchExtras` is the "⇄ Ingredienti" swap button orders-main.js builds
  // once. Since 29 Sep 2026 it shows at every screen size (no JS gate: the phone's
  // two-pill switch is hidden by orders.css instead).
  const searchRow = el('div', { class: 'search-row' }, [search.node, ctx.searchExtras || null]);
  container.appendChild(searchRow);
  container.appendChild(filterSwitch);
  container.appendChild(list);

  return {
    repaint(next) {
      data = next;
      paint();
    },
    // The counts move on every keystroke inside a supplier's screen; the ROW list must
    // not be rebuilt for that, so refreshSupplierDerived updates the numbers in place
    // and this only refreshes the two filter labels.
    updateCounts() {
      const ordering = orderingCount(data.suppliers);
      orderingBtn.textContent = t('orders.filter.ordering', { n: ordering });
      filterSwitch.hidden = ordering === 0 && !filtering;
    },
  };
}

// TWO buttons, not one with something clickable inside it.
//
// ⚠️ The row used to BE the <button>. A second button nested in it is invalid HTML
// and, in practice, a tap on the inner one runs the outer one's handler too — so the
// list icon would open the ORDER as well as the list. The row is therefore a plain
// container holding two siblings: the wide one opens the order, the narrow one opens
// the read-only list.
function buildSupplierRow(supplier, data, ctx) {
  const days = (supplier.deliveryDays || []).map(dayShort).join(', ');
  const { filled } = supplierStats(data.ingredientsBySupplier[supplier.id] || [], data.entries);

  const count = el('span', { class: 'supplier-row-count', id: `count-${supplier.id}` },
    filled ? itemsLabel(filled) : '');
  count.hidden = filled === 0;

  const forDay = el('span', { class: 'supplier-for-day', id: `for-${supplier.id}` });
  paintForDay(forDay, filled ? data.forDay?.(supplier.id) || '' : '', supplier);

  const open = el('button', {
    type: 'button',
    class: 'supplier-row-open',
    // Where focus returns when the full-screen order is closed (orders-main.js leaveSupplier).
    id: `open-${supplier.id}`,
    onClick: () => ctx.onOpen?.(supplier.id),
  }, [
    el('div', { class: 'supplier-row-main' }, [
      el('span', { class: 'supplier-name', text: supplierLabel(supplier) }),
      el('span', { class: 'supplier-meta', text: [supplier.category, days].filter(Boolean).join(' · ') }),
      forDay,
    ]),
    count,
    el('span', { class: 'supplier-row-chevron', icon: CHEVRON_SVG, 'aria-hidden': 'true' }),
  ]);

  // An icon on its own says nothing to a screen reader, and "list" would not say
  // WHOSE list — hence the supplier's name in the label (P18).
  const view = el('button', {
    type: 'button',
    class: 'supplier-row-view',
    'aria-label': t('aria.ingredientsFrom', { supplier: supplierLabel(supplier) }),
    icon: LIST_SVG,
    onClick: () => ctx.onView?.(supplier.id),
  });

  // ⚠️ TABLET ONLY (orders.css), AND ALWAYS BOTH IN THE DOM — see the long
  // note on refreshSupplierDerived above, which is what keeps `hidden` in
  // step with `filled` as quantities change, without ever touching this row
  // again. Only ever ONE of the two is visible at a time; the other keeps the
  // 52px of width so every row's card starts at the same x, whether or not
  // this supplier has anything typed.
  const summaryBtn = el('button', {
    type: 'button',
    class: 'supplier-row-summary',
    id: `summary-${supplier.id}`,
    'aria-label': t('aria.orderSummaryFor', { supplier: supplierLabel(supplier) }),
    icon: SUMMARY_SVG,
    onClick: () => ctx.onSummary?.(supplier.id),
  });
  summaryBtn.hidden = filled === 0;
  const spacer = el('span', {
    class: 'supplier-row-spacer', id: `spacer-${supplier.id}`, 'aria-hidden': 'true',
  });
  spacer.hidden = filled > 0;

  return el('div', {
    class: 'supplier-row',
    dataset: { supplier: supplier.id },
  }, [view, open, summaryBtn, spacer]);
}
