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
import { unitCost, orderCost } from '../order-cost.js';

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

  // ⚠️ NOTHING PRICED IS NOT «£0.00». With no costed line a total would be a bold
  // zero that reads as «this order is free»; say what is missing instead.
  if (!totals.costed) {
    return el('div', { class: 'totbox', 'aria-label': t('orders.cost.orderTotal') }, [
      el('p', { class: 'totbox-warn', text: t('orders.cost.nothingPriced') }),
    ]);
  }

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

// The money inside the tablet PANE: one `.ing-cost` line under each ordered row and
// the totals box above «Order placed». Painted from OUTSIDE the shared row builder
// (js/orders/ingredients.js serves the phone, the flat list and the History editor
// too, and none of them shows money), onto the rows already on screen — so a
// keystroke adds or swaps one small line and never rebuilds the field being typed.
//
// `show` false — the account may not read prices, the prices have not arrived yet,
// or the screen is not in the tablet split — removes every trace instead: money is
// never drawn from a guess, and never on a phone.
//
// root: the supplier screen's node; ingredients: that supplier's (with prices);
// entries: the draft quantities.
export function paintPaneMoney(root, ingredients, entries, show) {
  if (!root) return;
  root.querySelectorAll('.pane-money').forEach(node => node.remove());
  if (!show) return;

  const byId = new Map((ingredients || []).map(ing => [ing.id, ing]));
  const lines = [];
  root.querySelectorAll('.ing-row[data-ing]').forEach(row => {
    const ing = byId.get(row.dataset.ing);
    const qty = Number(entries?.[row.dataset.ing]?.qty);
    if (!ing || !Number.isFinite(qty) || qty <= 0) return;
    const line = { qty, unitCost: unitCost(ing, ing), vatRate: ing.vatRate != null ? Number(ing.vatRate) : null };
    lines.push(line);
    const cost = lineCostText(line);
    row.appendChild(el('span', {
      class: `ing-cost pane-money${cost.warn ? ' ing-cost--warn' : ''}`, text: cost.text,
    }));
  });

  const box = buildTotalsBox(orderCost(lines));
  if (!box) return;
  box.classList.add('pane-money');
  const place = root.querySelector('.supplier-place-btn');
  if (place) place.before(box);
  else root.querySelector('.supplier-detail-body')?.appendChild(box);
}
