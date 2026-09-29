// order-summary-view.js — a read-only look at one supplier's CURRENT order:
// exactly what buildSendScreen (preview.js) and the WhatsApp message would
// show, without opening either. Writes nothing, anywhere — same promise as
// supplier-items.js, and the same reason: it can be opened mid-order without
// a second thought.
//
// Same shape as supplier-items.js on purpose: opened from the list, repainted
// on every snapshot (orders-main.js renderSummary), and closed by itself if
// the supplier goes away.
//
// ⚠️ ON TABLET IT IS A SIDE SHEET (orders.css .order-summary-view), not a full
// page — the phone gets the same full-screen overlay every other read-only
// Orders screen already uses. The MARKUP is identical either way; only the
// CSS decides which one it looks like, so there is exactly one thing to test.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { supplierSummary } from './order-summary.js';
import { lineCostText, buildTotalsBox } from './order-cost-view.js';

const BACK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// supplier: { id, name }; ingredients: that supplier's products (already
// lensed — the same list the order screen and supplier-items.js use);
// entries: state.entries. ctx: { onBack }
// -> { overlay, scrim, repaint(ingredients, entries) }
//
// ⚠️ `scrim` IS A SEPARATE ELEMENT, NEVER PART OF `overlay`. On a phone the
// screen already covers everything, so the scrim is invisible CSS-wise and
// harmless; on a tablet, where this is a side sheet with the supplier list
// still showing beside it, it is what dims the rest of the page and gives a
// tap anywhere outside the sheet the same effect as Back. The caller
// (orders-main.js) appends and removes both together.
export function buildOrderSummaryView(supplier, ingredients, entries, ctx) {
  const body = el('div', { class: 'order-summary-body' });
  const subtitle = el('p', {});

  const scrim = el('div', {
    class: 'order-summary-scrim', 'aria-hidden': 'true', onClick: () => ctx.onBack?.(),
  });

  const overlay = el('div', {
    class: 'order-summary-view', role: 'dialog', 'aria-label': supplier.name,
  }, [
    el('header', { class: 'app-header orders-header' }, [
      el('span', { class: 'app-header-slot' }, [
        el('button', {
          type: 'button', class: 'app-icon-btn orders-icon-btn', 'aria-label': t('ui.back'),
          icon: BACK_ICON, onClick: () => ctx.onBack?.(),
        }),
      ]),
      el('div', { class: 'app-header-title orders-header-title' }, [
        el('h1', { text: supplier.name }),
        subtitle,
      ]),
      el('span', { class: 'app-header-slot' }),
    ]),
    body,
  ]);

  // `repaint` rebuilds the body only, never the header — a snapshot must not
  // make the supplier's name flicker. Nothing here holds typing, so rebuilding
  // costs nothing: there is no field to rip out from under a finger.
  // `showMoney` is false for an account the rules refuse prices to, or before the
  // prices have arrived: then the sheet is what it was in v1.90.0 — labels and
  // quantities, no «no price», no total.
  function repaint(nextIngredients, nextEntries, showMoney = false) {
    const { lines, costLines, totals } = supplierSummary(supplier, nextIngredients, nextEntries);
    body.replaceChildren();

    if (!lines.length) {
      subtitle.textContent = '';
      body.appendChild(el('p', { class: 'ing-empty', text: t('orders.summary.empty') }));
      return;
    }

    subtitle.textContent = t('orders.summary.itemCount', { n: lines.length });

    // ⚠️ THIS LINE ALWAYS SAYS SOMETHING ABOUT COST — never checks a
    // permission, because there is nothing here TO check. For an account the
    // rules never hand a price to, EVERY ingredient's unitCost comes back
    // null the same way an ingredient nobody has priced yet always does, so
    // "no price" is what they see: no number, ever — just like today.
    const card = el('div', { class: 'order-summary-list' });
    costLines.forEach(({ label, qty, unitCost, vatRate }) => {
      const cost = showMoney ? lineCostText({ qty, unitCost, vatRate }) : null;
      card.appendChild(el('div', { class: 'order-summary-row' }, [
        el('span', { class: 'order-summary-label', text: label }),
        el('div', { class: 'order-summary-qty-wrap' }, [
          el('span', { class: 'order-summary-qty', text: String(qty) }),
          cost ? el('span', { class: `order-summary-cost${cost.warn ? ' order-summary-cost--warn' : ''}`, text: cost.text }) : null,
        ]),
      ]));
    });
    body.appendChild(card);

    const box = showMoney ? buildTotalsBox(totals) : null;
    if (box) body.appendChild(box);
  }

  repaint(ingredients, entries, ctx?.showMoney === true);
  return { overlay, scrim, repaint };
}
