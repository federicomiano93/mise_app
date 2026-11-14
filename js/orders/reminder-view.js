// reminder-view.js — the banners at the top of the Orders screen.
//
// What to order TODAY, and what is already done. The alert itself is not new
// (computeAlerts has always produced it), but it used to be filtered out of this
// screen because it could only nag: it had no way of knowing what you had already
// ordered. Now that an order is one day and one supplier, it does — so it can
// tick suppliers off instead of repeating itself.
//
// Small on purpose: one line of chips, not a numbered list. A supplier still to
// order is a button — tapping it opens that supplier's card.

import { t } from '../i18n.js';
import { supplierLabel } from '../supplier-label.js';
import { el } from './dom.js';
import { daySpoken, dayPhrase, spellShortDate } from './day.js';

const CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

// list: [{ supplier, placed, skipped }] from reminders.todayOrders
// A supplier closed as «non ordinato» today (`skipped`) is done too: nothing was needed. Its chip
// stays a button, but it opens the supplier's summary (`onOpenSkipped`), where «Riapri» lives.
export function renderTodayOrders(container, list, { onPick, onOpenSkipped } = {}) {
  if (!container) return;
  container.textContent = '';

  // Nothing is ordered today — say nothing at all.
  if (!list.length) return;

  // ⚠️ «All placed» only when they really were all PLACED. Closed ones done too, the banner goes
  // quiet (all-done) but keeps its chips: «tutti fatti» would be false, and the closed chip is
  // the way to «Riapri».
  if (list.every(item => item.placed)) {
    container.appendChild(el('div', { class: 'today-banner all-done' }, [
      el('span', { class: 'today-check', icon: CHECK_SVG, 'aria-hidden': 'true' }),
      el('span', { text: t('orders.todaySOrdersAre') }),
    ]));
    return;
  }

  const chips = list.map(({ supplier, placed, skipped }) => (placed
    ? el('span', { class: 'today-chip placed' }, [
      el('span', { class: 'today-check', icon: CHECK_SVG, 'aria-hidden': 'true' }),
      el('span', { text: supplierLabel(supplier) }),
    ])
    : skipped ? el('button', {
      type: 'button',
      class: 'today-chip skipped',
      onClick: () => onOpenSkipped?.(supplier.id),
    }, [
      el('span', { text: supplierLabel(supplier) }),
      // The visible words ARE the button's name («Brava Fresh · non ordinato»): no aria-label
      // that a screen reader would read differently from what is on screen.
      el('span', { class: 'today-chip-note', text: t('orders.today.notOrdered') }),
    ])
    : el('button', {
      type: 'button',
      class: 'today-chip',
      onClick: () => onPick?.(supplier.id),
    }, supplierLabel(supplier))));

  const handled = list.every(item => item.placed || item.skipped);
  container.appendChild(el('div', { class: `today-banner${handled ? ' all-done' : ''}` }, [
    el('span', { class: 'today-label', text: t('orders.orderToday') }),
    el('div', { class: 'today-chips' }, chips),
  ]));
}

// An order typed on an earlier day and never marked as placed.
//
// A banner, not a dialog: several suppliers can be waiting at once, and a queue
// of modals on app open would be hostile (confirm-dialog is single-instance
// anyway — a second one raised while the first is open resolves false silently).
//
// Three answers, because there are genuinely three cases. It was ordered that day
// and the tap was forgotten (Placed) — the record must be filed under THAT day,
// not today, which is the whole reason the draft carries the day. It was never
// actually ordered and is still wanted (It's today's) — the rows stay, restamped
// to today. It is not wanted at all (Discard) — the rows go, behind a red confirm.
//
// list: [{ supplier, day, itemCount }] from reminders.pendingSuppliers
// A fourth answer, only when the supplier has a next order day: the rows are next
// week's, typed early (`nextDayOf(supplier)` → "YYYY-MM-DD" | null, `onNext(id, day)`).
export function renderPending(container, list, {
  onPlaced, onToday, onNext, nextDayOf, onDiscard, now,
} = {}) {
  if (!container) return;
  container.textContent = '';
  if (!list.length) return;

  list.forEach(({ supplier, day, itemCount }) => {
    const nextDay = nextDayOf ? nextDayOf(supplier) : null;
    container.appendChild(el('div', { class: 'pending-banner' }, [
      el('div', { class: 'pending-main' }, [
        el('span', { class: 'pending-title', text: t('orders.notPlacedFor', { supplier: supplierLabel(supplier) }) }),
        el('span', { class: 'pending-sub', text: t('orders.pendingItems', { n: itemCount, when: dayPhrase(day, now) }) }),
      ]),
      el('div', { class: 'pending-actions' }, [
        el('button', {
          type: 'button', class: 'pending-btn primary',
          onClick: () => onPlaced?.(supplier.id, day),
        }, t('orders.placedWhen', { when: daySpoken(day, now) })),
        el('button', {
          type: 'button', class: 'pending-btn',
          onClick: () => onToday?.(supplier.id),
        }, t('orders.itSTodayS')),
        nextDay ? el('button', {
          type: 'button', class: 'pending-btn',
          onClick: () => onNext?.(supplier.id, nextDay),
        }, t('orders.pendingForNext', { day: spellShortDate(nextDay) })) : null,
        el('button', {
          type: 'button', class: 'pending-btn danger',
          onClick: () => onDiscard?.(supplier.id),
        }, t('ui.discard')),
      ]),
    ]));
  });
}

// «Ordine a Bruno inviato alle 10:42: è partito?» — one banner per supplier whose order was handed
// to WhatsApp (or the mail app) and not answered yet (js/orders/awaiting-sent.js). On EVERY
// device, until somebody answers: «Sì» records what went, «No» leaves the quantities in the order.
// Persistent on purpose — nothing to dismiss: an order handed over and never answered is exactly
// the order that used to go unrecorded.
//
// list: [{ supplier, at, … }] from awaitingList; question(supplier, entry) → the sentence;
// busy(supplierId) → true while this device is answering (both buttons wait).
// onYes / onNo(supplierId, at): `at` names the send the banner was showing.
let awaitingSeq = 0;
export function renderAwaiting(container, list, { question, onYes, onNo, busy } = {}) {
  if (!container) return;
  // ⚠️ REDRAWN ONLY WHEN SOMETHING CHANGED. This runs on every draft snapshot (every keystroke
  // on any phone); a rebuild each time would throw the keyboard or screen-reader focus off «Sì»
  // and make the polite live region on the host repeat the question.
  const sentences = list.map(entry => (question ? question(entry.supplier, entry) : supplierLabel(entry.supplier)));
  const key = JSON.stringify(list.map((e, i) => [e.supplier.id, e.at, sentences[i], Boolean(busy?.(e.supplier.id))]));
  if (container.dataset.awaitingKey === key) return;
  container.dataset.awaitingKey = key;
  container.textContent = '';
  if (!list.length) return;

  list.forEach((entry, i) => {
    const { supplier } = entry;
    const id = `awaiting-q-${++awaitingSeq}`;
    const waiting = Boolean(busy?.(supplier.id));
    // The two answers are named by their own word AND described by the question, so a screen
    // reader moving from button to button hears which order «Sì» is about.
    const answer = (label, cls, fn) => el('button', {
      type: 'button', class: `pending-btn${cls}`, 'aria-describedby': id,
      onClick: () => fn?.(supplier.id, entry.at),
    }, label);
    const yes = answer(t('orders.awaiting.yes'), ' primary', onYes);
    const no = answer(t('orders.awaiting.no'), '', onNo);
    yes.disabled = waiting;
    no.disabled = waiting;
    container.appendChild(el('div', { class: 'pending-banner awaiting-banner' }, [
      el('div', { class: 'pending-main' }, [
        el('span', { class: 'pending-title', id, text: sentences[i] }),
      ]),
      el('div', { class: 'pending-actions' }, [yes, no]),
    ]));
  });
}
