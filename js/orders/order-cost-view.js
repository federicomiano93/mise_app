// order-cost-view.js — the money DRAWN on screen: one line's cost, and the
// totals box under a supplier's whole order. Shared by js/orders/
// supplier-detail.js (the tablet pane) and js/orders/order-summary-view.js
// (the summary sheet) — both show the SAME numbers from js/order-cost.js, so
// this is the one place that turns them into DOM rather than two.
//
// ⚠️ NEVER CALLED FOR SOMEBODY WHO MAY NOT SEE MONEY. Nothing here checks a
// permission — it draws whatever js/order-cost.js handed it. The gate is
// upstream: an ingredient this account may not read the price of has no
// unitCost at all (js/orders/firebase-orders.js watchIngredientPrices fails
// permission-denied into an empty map, silently), which reads here exactly
// like an ingredient nobody has priced yet — "no price", never a wrong one.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { formatMoney } from '../price-model.js';

// One ordered line's money, as the small mono line under its quantity box /
// beside its label: "4 × €45.00 = €180.00 + VAT 4%", or the two things that
// can be missing instead.
export function lineCostText({ qty, unitCost, vatRate }) {
  if (unitCost === null || unitCost === undefined) return { text: t('orders.cost.noPrice'), warn: true };
  const total = qty * unitCost;
  const base = t('orders.cost.lineTotal', { qty, rate: formatMoney(unitCost), total: formatMoney(total) });
  if (vatRate === null || vatRate === undefined) {
    return { text: `${base} · ${t('orders.cost.vatNotStated')}`, warn: true };
  }
  return { text: `${base} · ${t('orders.cost.vatAtRate', { rate: vatRate })}`, warn: false };
}

// The box under an order's rows: Net, one line per VAT rate, then the bold
// Order total — and, only when something could not be counted, a warning
// that the total is therefore lower than the real one. Returns `null` when
// there is nothing ordered at all (filled === 0), so a caller can skip it
// entirely rather than draw an empty card.
export function buildTotalsBox(totals) {
  if (!totals || (totals.net === 0 && totals.missingPrice === 0)) return null;

  const rows = [
    el('div', { class: 'totbox-row' }, [
      el('span', { text: t('orders.cost.net') }),
      el('span', { text: formatMoney(totals.net) }),
    ]),
  ];
  Object.keys(totals.vatByRate)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach(rate => rows.push(el('div', { class: 'totbox-row' }, [
      el('span', { text: t('orders.cost.vatAtRate', { rate }) }),
      el('span', { text: formatMoney(totals.vatByRate[rate]) }),
    ])));
  rows.push(el('div', { class: 'totbox-row totbox-row--total' }, [
    el('span', { text: t('orders.cost.orderTotal') }),
    el('span', { text: formatMoney(totals.gross) }),
  ]));

  const warnings = [];
  if (totals.missingPrice > 0) {
    warnings.push(el('p', { class: 'totbox-warn', text: t('orders.cost.missingPrice', { n: totals.missingPrice }) }));
  }
  if (totals.missingVat > 0) {
    warnings.push(el('p', { class: 'totbox-warn', text: t('orders.cost.missingVatTotal', { n: totals.missingVat }) }));
  }

  return el('div', { class: 'totbox', 'aria-label': t('orders.cost.orderTotal') }, [...rows, ...warnings]);
}
