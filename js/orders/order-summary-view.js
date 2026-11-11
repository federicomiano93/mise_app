// order-summary-view.js — a look at one supplier's CURRENT order: exactly what
// buildSendScreen (preview.js) and the WhatsApp message would show, without
// opening either. Opening it writes nothing, anywhere — same promise as
// supplier-items.js, and the same reason: it can be opened mid-order without
// a second thought. Since 6 Nov 2026 it carries the buttons that close TODAY's
// order (see buildOrderSummaryView); each writes only behind its own tap.
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
import { supplierLabel } from '../supplier-label.js';
import { el } from './dom.js';
import { supplierSummary } from './order-summary.js';
import { qtyWithUnit } from '../order-unit.js';
import { lineCostText, buildTotalsBox } from './order-cost-view.js';

const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

const BACK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// supplier: { id, name }; ingredients: that supplier's products (already
// lensed — the same list the order screen and supplier-items.js use);
// entries: state.entries. ctx: { onBack, onPlaced, onSkip, onReopen, closeOffer }
// -> { overlay, scrim, repaint(ingredients, entries) }
//
// ⚠️ THE ONLY BUTTONS ON THIS SHEET ACT ON TODAY'S ORDER (Federico's tablet notes, 2–3 Nov 2026):
//   • «Ordine fatto» — with something written: the SAME placeOrder() the supplier's own green
//     button runs (its confirmation, the «did you send it?», the record in History). Nothing new.
//   • «Chiudi come non ordinato» — nothing written and its order day is today: nothing needed, so
//     it leaves «Ordina oggi», the Home badge and the kiosk (drafts/current.skipped).
//   • «Riapri» — the undo of the line above, shown while it is closed.
// `closeOffer()` is asked on every repaint ('skip' | 'reopen' | '', reminders.js closeOffer), so
// a close made on another phone shows here at once. Writing still happens only behind a tap.

//
// ⚠️ `scrim` IS A SEPARATE ELEMENT, NEVER PART OF `overlay`. On a phone the
// screen already covers everything, so the scrim is invisible CSS-wise and
// harmless; on a tablet, where this is a side sheet with the supplier list
// still showing beside it, it is what dims the rest of the page and gives a
// tap anywhere outside the sheet the same effect as Back. The caller
// (orders-main.js) appends and removes both together.
export function buildOrderSummaryView(supplier, ingredients, entries, ctx) {
  // ⚠️ TWO PARTS, REBUILT APART. The lines are rebuilt on every snapshot (cheap, nothing in them
  // holds a finger); the buttons only when what they offer changes — rebuilt on every colleague's
  // keystroke, a tap straddling a snapshot was lost and a keyboard user's focus fell to <body>.
  const content = el('div', {});
  const actionsHost = el('div', { class: 'order-summary-actions' });
  actionsHost.hidden = true;
  const body = el('div', { class: 'order-summary-body' }, [content, actionsHost]);
  const subtitle = el('p', {});
  let actionsKey = null;

  const scrim = el('div', {
    class: 'order-summary-scrim', 'aria-hidden': 'true', onClick: () => ctx.onBack?.(),
  });

  const overlay = el('div', {
    class: 'order-summary-view', role: 'dialog', 'aria-modal': 'true', 'aria-label': supplierLabel(supplier),
  }, [
    el('header', { class: 'app-header orders-header' }, [
      el('span', { class: 'app-header-slot' }, [
        el('button', {
          type: 'button', class: 'app-icon-btn orders-icon-btn', 'aria-label': t('ui.back'),
          icon: BACK_ICON, onClick: () => ctx.onBack?.(),
        }),
      ]),
      el('div', { class: 'app-header-title orders-header-title' }, [
        el('h1', { text: supplierLabel(supplier) }),
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
    content.replaceChildren();

    if (!lines.length) {
      subtitle.textContent = '';
      content.appendChild(el('p', { class: 'ing-empty', text: t('orders.summary.empty') }));
      paintActions(false);
      return;
    }

    subtitle.textContent = t('orders.summary.itemCount', { n: lines.length });

    // ⚠️ THIS LINE ALWAYS SAYS SOMETHING ABOUT COST — never checks a
    // permission, because there is nothing here TO check. For an account the
    // rules never hand a price to, EVERY ingredient's unitCost comes back
    // null the same way an ingredient nobody has priced yet always does, so
    // "no price" is what they see: no number, ever — just like today.
    const card = el('div', { class: 'order-summary-list' });
    costLines.forEach(({ label, qty, unit, unitCost, vatRate }) => {
      const cost = showMoney ? lineCostText({ qty, unitCost, vatRate }) : null;
      card.appendChild(el('div', { class: 'order-summary-row' }, [
        el('span', { class: 'order-summary-label', text: label }),
        el('div', { class: 'order-summary-qty-wrap' }, [
          el('span', { class: 'order-summary-qty', text: qtyWithUnit(qty, unit) }),
          cost ? el('span', { class: `order-summary-cost${cost.warn ? ' order-summary-cost--warn' : ''}`, text: cost.text }) : null,
        ]),
      ]));
    });
    content.appendChild(card);

    const box = showMoney ? buildTotalsBox(totals) : null;
    if (box) content.appendChild(box);
    paintActions(true);
  }

  // The sheet's buttons, under everything else (see the note at the top of the builder). Rebuilt
  // only when the offer changes; when they are, a focus that was on the old buttons moves to the
  // first new one («Riapri» → «Chiudi come non ordinato»), never to <body>.
  function paintActions(hasLines) {
    const offer = ctx?.closeOffer ? ctx.closeOffer() : '';
    const key = `${hasLines}|${offer}`;
    if (key === actionsKey) return;
    actionsKey = key;
    const hadFocus = Boolean(globalThis.document?.activeElement && actionsHost.contains?.(globalThis.document.activeElement));
    const actions = actionsHost;
    actions.replaceChildren();

    if (offer === 'reopen') {
      // Plain text, not a live region: rebuilt with its words already inside it, a live region is
      // either never read or read again on every repaint. The status line says what just happened.
      actions.appendChild(el('div', { class: 'order-summary-closed' }, [
        el('span', { class: 'order-summary-closed-text', text: t('orders.summary.closedToday') }),
        el('button', {
          type: 'button', class: 'btn-secondary order-summary-reopen',
          onClick: () => ctx.onReopen?.(),
        }, t('orders.summary.reopen')),
      ]));
    }
    if (hasLines && ctx?.onPlaced) {
      actions.appendChild(el('button', {
        type: 'button', class: 'btn-primary order-summary-place',
        onClick: () => ctx.onPlaced(),
      }, [
        el('span', { class: 'order-summary-place-icon', icon: CHECK_ICON, 'aria-hidden': 'true' }),
        el('span', { text: t('orders.orderPlaced') }),
      ]));
    }
    // ⚠️ ONLY WITH NOTHING WRITTEN: «non mi serve niente». With quantities on the sheet the
    // honest choices are «Ordine fatto» or clearing them on the supplier's screen first.
    if (!hasLines && offer === 'skip') {
      actions.appendChild(el('p', { class: 'order-summary-hint', text: t('orders.summary.closeHint') }));
      actions.appendChild(el('button', {
        type: 'button', class: 'btn-secondary order-summary-skip',
        onClick: () => ctx.onSkip?.(),
      }, t('orders.summary.closeNotOrdered')));
    }
    actionsHost.hidden = actions.childElementCount === 0;
    if (hadFocus) actionsHost.querySelector?.('button')?.focus();
  }

  repaint(ingredients, entries, ctx?.showMoney === true);
  return { overlay, scrim, repaint };
}
