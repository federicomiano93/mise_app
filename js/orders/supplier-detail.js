// supplier-detail.js — one supplier's order, on its own screen.
//
// Replaces the card that used to expand in place. The app's rule is "list → detail,
// one level at a time, with a Back arrow that steps up a level" and every other
// full-screen part of Orders already follows it. The practical win is that the
// supplier's name stays pinned in the header instead of scrolling away above the rows
// you are typing into.
//
// The rows themselves are still built by ingredients.js — one row implementation for
// the supplier screen, the flat list and the History editor, so a fix to how a
// quantity behaves cannot land in one of them and not the others.
//
// ⚠️⚠️ THE SAME NODE, TWO HOMES (29 Sep 2026). On a phone this is a full-screen
// overlay with a Back arrow; on a tablet split view, orders-main.js moves the very
// same `overlay` into `#orders-detail-pane` instead of appending it to
// document.body — never rebuilds it, so a quantity mid-typing survives a window
// resize. The header therefore carries BOTH sets of controls always (the Back
// arrow AND the List/Summary/Close buttons the pane needs); orders.css shows
// whichever set belongs to the current width, and the ones that stay hidden are
// simply never tapped.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { buildIngredientList } from './ingredients.js';
import { nextMatchingDay } from './split-pick.js';

const BACK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
const CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
// "See what this supplier sells" — the same list glyph suppliers.js uses for the
// same job on the phone row (LIST_SVG there).
const LIST_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
// "See the summary sheet" — the same clipboard suppliers.js uses (SUMMARY_SVG there).
const SUMMARY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2h6v4H9z"/><path d="M9 11h6M9 14h6M9 17h4"/></svg>';
const CLOSE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';

// The subline text: "orders {day} · delivery {day}" — the SAME question
// js/orders/split-pick.js answers for the tablet row's day chip, asked twice
// (order days, delivery days) so the two can never compute "today" two
// different ways. Only ever built once, at construction — see the header note
// above on why this never rebuilds on repaint.
function paneSubline(orderDays, deliveryDays, now = new Date()) {
  const order = nextMatchingDay(orderDays, now);
  const delivery = nextMatchingDay(deliveryDays, now);
  const parts = [];
  if (order) {
    const day = order.isToday ? t('day.today.inSentence') : t(`day.weekdayShort.${order.weekdayIndex}`);
    parts.push({ text: t('orders.pane.orderDay', { day }), today: order.isToday });
  }
  if (delivery) {
    const day = delivery.isToday ? t('day.today.inSentence') : t(`day.weekdayShort.${delivery.weekdayIndex}`);
    parts.push({ text: t('orders.pane.deliveryDay', { day }), today: false });
  }
  return parts;
}

// ctx: { ingredients, entries, suggest, hooks, onBack, onViewList, onSummary,
//        orderDays, deliveryDays }
// -> { overlay, repaint(ctx) }
//
// `repaint` rebuilds only the BODY, never the header — a live snapshot from another
// phone must not make the screen flicker or lose its title. Keystrokes never come
// through here at all: those reach the inputs via syncInputsFromState, which sets
// values without touching the DOM structure.
export function buildSupplierDetail(supplier, ctx) {
  const body = el('div', { class: 'supplier-detail-body' });

  // ⚠️ TABLET ONLY, IN LOOKS (orders.css) — built always, so the pane never has
  // to rebuild this header when a phone becomes a tablet mid-session (a window
  // resized, a tablet rotated: js/orders/orders-main.js relocateDetailView).
  const subline = paneSubline(ctx.orderDays, ctx.deliveryDays).map(({ text, today }) => el(
    today ? 'b' : 'span', { class: 'pane-when', text },
  ));
  const titleWrap = el('div', { class: 'orders-header-title' }, [
    el('h1', { text: supplier.name }),
    subline.length ? el('p', { class: 'pane-subline' }, subline.flatMap((n, i) => (
      i === 0 ? [n] : [' · ', n]
    ))) : null,
  ]);

  const listBtn = el('button', {
    type: 'button', class: 'pane-list-btn',
    'aria-label': t('orders.pane.listAria', { supplier: supplier.name }),
    onClick: () => ctx.onViewList?.(),
  }, [el('span', { class: 'pane-btn-icon', 'aria-hidden': 'true', icon: LIST_SVG }), t('orders.pane.list')]);
  const summaryBtn = el('button', {
    type: 'button', class: 'pane-summary-btn',
    'aria-label': t('orders.pane.summaryAria', { supplier: supplier.name }),
    onClick: () => ctx.onSummary?.(),
  }, [el('span', { class: 'pane-btn-icon', 'aria-hidden': 'true', icon: SUMMARY_SVG }), t('orders.pane.summary')]);
  const closeBtn = el('button', {
    type: 'button', class: 'orders-icon-btn pane-close-btn',
    'aria-label': t('orders.pane.closeAria', { supplier: supplier.name }),
    icon: CLOSE_ICON, onClick: () => ctx.onBack?.(),
  });

  const overlay = el('div', { class: 'supplier-detail' }, [
    el('header', { class: 'orders-header' }, [
      el('button', {
        type: 'button', class: 'orders-icon-btn pane-back-btn', 'aria-label': t('ui.back'),
        icon: BACK_ICON, onClick: () => ctx.onBack?.(),
      }),
      titleWrap,
      // Keeps the title centred on a phone: the back button needs a counterweight.
      // Hidden on a tablet, where the three buttons on the right already do that job.
      el('span', { class: 'header-spacer' }),
      listBtn, summaryBtn, closeBtn,
    ]),
    body,
  ]);

  function repaint(next) {
    const { ingredients, entries, suggest, hooks } = next;
    body.replaceChildren();
    body.appendChild(buildIngredientList(supplier, ingredients, suggest, entries, hooks));

    // No products, nothing to record — the empty state inside the list already says so.
    if (!ingredients.length) return;

    const { filled } = ingredients.reduce((acc, i) => (
      (entries[i.id]?.qty || 0) > 0 ? { filled: acc.filled + 1 } : acc), { filled: 0 });

    // The money (per-row cost lines, totals) is NOT built here: it is tablet-only
    // and permission-gated, so orders-main.js paints it onto this screen from the
    // outside (order-cost-view.js paintPaneMoney) — a phone never gets a node of it.

    const placeBtn = el('button', {
      type: 'button',
      class: 'btn-primary supplier-place-btn',
      id: `place-btn-${supplier.id}`,
      onClick: () => hooks.onPlaced(supplier.id),
    }, [
      el('span', { class: 'supplier-place-icon', icon: CHECK_SVG, 'aria-hidden': 'true' }),
      t('orders.orderPlaced'),
    ]);
    placeBtn.disabled = filled === 0;
    body.appendChild(placeBtn);

    // "I have got this wrong, start again." Deliberately a quiet text button under
    // the green one: it throws away typing, so it must never look like the main
    // action (P20). Shown only once there is something to clear.
    //
    // ⚠️ BUILT ALWAYS, HIDDEN WHEN EMPTY — never built conditionally. This function
    // runs on a snapshot, not on a keystroke (typing must not rebuild the field being
    // typed into), so a button that only EXISTS when something is filled cannot
    // appear as the first quantity is typed: there is no element for
    // refreshSupplierDerived to reveal. It waited for the next snapshot from
    // Firestore, which is why it looked like it came and went at random.
    if (hooks.onClear) {
      const clearBtn = el('button', {
        type: 'button',
        class: 'supplier-clear-btn',
        id: `clear-btn-${supplier.id}`,
        onClick: () => hooks.onClear(supplier.id),
      }, t('orders.clearQuantities'));
      clearBtn.hidden = filled === 0;
      body.appendChild(clearBtn);
    }
  }

  repaint(ctx);
  return { overlay, repaint };
}
