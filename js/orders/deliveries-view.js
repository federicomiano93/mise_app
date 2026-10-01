// deliveries-view.js — the "Incoming" tab, the arrival confirmation, and the
// "still to re-order" banner.
//
// All the DECIDING lives in the pure js/orders/deliveries.js; this is the screen.
//
// ⚠️ AN ORDER LEAVES THIS SCREEN ONLY WHEN SOMEBODY SAYS IT ARRIVED. Nothing here
// deduces a delivery from the supplier's delivery days — that would drop an order off
// the list the day it was due, so the one that NEVER came would be the only one
// nobody sees, on a screen that looks perfectly healthy because it is empty.

import { t } from '../i18n.js';
import { supplierLabel } from '../supplier-label.js';
import { el } from './dom.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { spellDay, dayLabel } from './day.js';
import { recordedName, wholeNumber } from './archive.js';
import { qtyWithUnit } from '../order-unit.js';
import {
  pendingDeliveries, shortfall, stillToReorder, applyReorder, unansweredBefore,
} from './deliveries.js';

const CHEVRON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

// ── The "Incoming" tab ───────────────────────────────────────────────────────

// host: the element to fill. `ctx` supplies the data and the one write.
//   { history, suppliersById, ingredientsById, today, onConfirm(order, missingIds) }
export function renderDeliveries(host, ctx) {
  if (!host) return;
  host.textContent = '';

  const groups = pendingDeliveries(ctx.history, ctx.suppliersById, ctx.today,
    { weekStartsOn: ctx.weekStartsOn });
  const total = groups.late.length + groups.dueToday.length + groups.coming.length;

  if (!total) {
    // ⚠️ TWO DIFFERENT SILENCES, TOLD APART. "Nothing has been ordered" and
    // "everything ordered has arrived" look identical on a screen that only shows
    // what is still coming, and only the first is a reason to go and order.
    const everSent = (ctx.history || []).length > 0;
    host.appendChild(el('p', {
      class: 'ing-empty',
      text: everSent ? t('orders.deliveries.allArrived') : t('orders.deliveries.noneYet'),
    }));
    return;
  }

  section(host, groups.late, 'orders.deliveries.late', 'late', ctx);
  section(host, groups.dueToday, 'orders.deliveries.dueToday', 'due', ctx);
  section(host, groups.coming, 'orders.deliveries.coming', '', ctx);
}

function section(host, entries, headingKey, tone, ctx) {
  if (!entries.length) return;
  host.appendChild(el('div', { class: 'ing-category', text: t(headingKey) }));
  entries.forEach(entry => host.appendChild(deliveryRow(entry, tone, ctx)));
}

function deliveryRow({ order, supplier, expected }, tone, ctx) {
  const name = supplierLabel(supplier) || order.supplierName || t('orders.deliveries.unknownSupplier');
  const count = Object.keys(order.quantities || {}).length;

  // ⚠️ AN ORDER WITH NO EXPECTED DATE SAYS SO, rather than showing a blank where a
  // date belongs. "We do not know" is an answer; an empty gap is a bug people report.
  const when = expected
    ? t('orders.deliveries.expectedOn', { day: dayLabel(expected, new Date(`${ctx.today}T12:00:00`)) })
    : t('orders.deliveries.noExpectedDay');

  return el('button', {
    class: `supplier-row-open delivery-row${tone ? ' delivery-row--' + tone : ''}`,
    type: 'button',
    onclick: () => openArrival({ order, supplier, expected }, ctx),
  }, [
    el('div', { class: 'delivery-main' }, [
      el('span', { class: 'delivery-name', text: name }),
      el('span', { class: 'delivery-meta', text: when }),
      el('span', {
        class: 'delivery-meta',
        // ⚠️ `n` AS A NUMBER, not a string: Intl.PluralRules picks the form from
        // it, and '1' is not 1.
        text: t('orders.deliveries.orderedOn', { day: spellDay(order.date), n: count }),
      }),
    ]),
    el('span', { class: 'delivery-chevron', icon: CHEVRON }),
  ]);
}

// ── Confirming an arrival ────────────────────────────────────────────────────

// ⚠️ TWO STRAIGHT ANSWERS, NOT A LIST TO TICK. A list that starts unticked means
// twenty taps on every delivery, so nobody would use it and the feature would die
// quietly. A list that starts ticked is a declaration made by not looking. Answering
// a question is neither: "everything arrived" is one tap for the normal case, and
// "something is missing" is the only path that opens the rows.
async function openArrival(entry, ctx) {
  const { order } = entry;
  const name = supplierLabel(entry.supplier) || order.supplierName || '';

  // ⚠️ AN ORDER THAT ALREADY CARRIES «DID NOT ARRIVE» MARKS goes straight to the rows. It is
  // asked again only because a second order was added the same day (js/orders/archive.js
  // mergeArchives), and «everything arrived» would then also tick the lines that were
  // already known to be missing — one tap erasing what somebody said earlier.
  if (carriedMissingIds(order).length) return openMissingPicker(entry, ctx);

  const answer = await confirmDialog({
    title: t('orders.deliveries.arrivedTitle', { supplier: name }),
    message: t('orders.deliveries.arrivedMessage', { day: spellDay(order.date) }),
    okLabel: t('orders.deliveries.allArrivedBtn'),
    cancelLabel: t('orders.deliveries.somethingMissing'),
  });

  if (answer) { await confirm(entry, [], ctx); return true; }
  return openMissingPicker(entry, ctx);
}

// The rows of one order, every one considered arrived until told otherwise.
//
// ⚠️ IT RESOLVES WHEN THE SCREEN CLOSES — true if it was saved, false if somebody backed
// out. It used to return immediately, which was harmless while one order was answered at
// a time; the debt answers SEVERAL IN SEQUENCE, and without the wait every dialog would
// open at once, one behind the other, and the taps would land on the wrong order.
function openMissingPicker(entry, ctx) {
  return new Promise(resolve => openMissingPickerScreen(entry, ctx, resolve));
}

function openMissingPickerScreen(entry, ctx, done) {
  const { order } = entry;
  const ids = Object.keys(order.quantities || {}).sort((a, b) =>
    label(a, order, ctx).localeCompare(label(b, order, ctx)));
  // Lines already marked as missing start unticked; everything else is considered arrived.
  const missing = new Set(carriedMissingIds(order).filter(id => ids.includes(id)));

  const list = el('div', { class: 'missing-list' });
  ids.forEach(id => {
    const box = el('input', { type: 'checkbox', class: 'missing-check',
      ...(missing.has(id) ? {} : { checked: 'checked' }) });
    box.addEventListener('change', () => {
      if (box.checked) missing.delete(id); else missing.add(id);
    });
    // ⚠️ THE WHOLE ROW IS THE TARGET, and it is 44px tall — not the 31px a bare
    // checkbox gives. A mis-tap here does not cost a keystroke: it says something
    // arrived that never did, and that ingredient then never reaches the re-order list.
    list.appendChild(el('label', { class: 'missing-row' }, [
      box,
      el('span', { class: 'missing-name', text: label(id, order, ctx) }),
      el('span', { class: 'missing-qty', text: qtyWithUnit(wholeNumber(order.quantities[id]), order.units?.[id]) }),
    ]));
  });

  const overlay = el('div', { class: 'missing-overlay' }, [
    el('header', { class: 'app-header orders-header' }, [
      el('span', { class: 'app-header-slot' }, [
        el('button', {
          class: 'app-icon-btn orders-icon-btn', type: 'button', 'aria-label': t('ui.back'),
          icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
          onclick: () => { overlay.remove(); done(false); },
        }),
      ]),
      el('div', { class: 'app-header-title orders-header-title' }, [
        el('h1', { text: t('orders.deliveries.whatArrived') }),
      ]),
      el('span', { class: 'app-header-slot' }),
    ]),
    el('div', { class: 'scroll-area' }, [
      el('p', { class: 'missing-hint', text: t('orders.deliveries.untickHint') }),
      list,
      el('button', {
        class: 'btn-primary missing-save', type: 'button',
        text: t('orders.deliveries.saveArrival'),
        onclick: async () => {
          overlay.remove();
          await confirm(entry, [...missing], ctx);
          done(true);
        },
      }),
    ]),
  ]);

  document.body.appendChild(overlay);
}

function carriedMissingIds(order) {
  return Object.keys(order?.missing || {}).filter(id => order.missing[id] === true);
}

function label(id, order, ctx) {
  return recordedName(id, ctx.ingredientsById || {}, order.names || {});
}

async function confirm(entry, missingIds, ctx) {
  try {
    await ctx.onConfirm(entry.order, missingIds);
  } catch (err) {
    // ⚠️ A FAILED WRITE IS SAID OUT LOUD. Five write paths in this feature once
    // failed in silence (v186); the order would simply still be there next time,
    // looking like the tap had not registered.
    await alertDialog(t('orders.deliveries.couldNotSave'));
  }
}

// ── "Still to re-order" ──────────────────────────────────────────────────────

// ⚠️ IT LIVES AT THE TOP OF THE ORDER TAB, WHERE THE WORK HAPPENS. A list on a screen
// nobody opens does not answer "so I do not forget to order them".
export function renderReorderBanner(host, ctx) {
  // ⚠️ AN OPEN LIST IS REDRAWN FROM HERE, BEFORE ANY EARLY RETURN. orders-main calls this on
  // every snapshot and every render(), with the freshest data — so a line put back or marked
  // «Risolto» (on this phone or the other one in the kitchen) leaves the open list without a
  // second subscription. It must run even when the banner has gone (host missing or no
  // items left): the list stays open on its empty text until somebody taps Back.
  if (openList) openList.redraw(ctx);
  if (!host) return;
  host.textContent = '';
  const items = stillToReorder(ctx.history, ctx.entries);
  host.hidden = !items.length;
  if (!items.length) return;

  // ⚠️ `today-banner` IS THE APP'S EXISTING BANNER, not a new look invented here.
  // The reminders directly below it already use it, and two banners on one screen
  // that are dressed differently read as two different KINDS of thing.
  host.appendChild(el('button', {
    class: 'today-banner reorder-banner', type: 'button',
    // ⚠️ A PLURAL ENTRY, not two keys picked by an `if`. Which forms a language has
    // is the language's business, not the caller's — Italian and English agree on
    // two, and a language with three would need the code changed rather than the
    // dictionary. Intl.PluralRules already does this for every other count here.
    text: t('orders.reorder.count', { n: items.length }),
    onclick: () => openReorderScreen(ctx),
  }));
}

// The open «Da riordinare» list, or null. One at a time: the banner is under the overlay, so
// a second tap cannot come, but a stale handle would redraw a node that is gone.
let openList = null;

// ⚠️ ONE CARD PER MISSING LINE, AND EACH LINE WAITS UNTIL SOMEBODY DECIDES. Federico buys a
// missing ingredient «da un'altra parte» as often as from the same supplier, so there is no
// single «put everything back» any more: per line, «put it back in {supplier}'s order» or
// «Risolto» (bought elsewhere — it leaves this list for good, and goes in no order).
function openReorderScreen(firstCtx) {
  if (openList) return;
  let latest = firstCtx;

  const body = el('div', { class: 'reorder-list' });

  const close = () => { overlay.remove(); openList = null; };

  const overlay = el('div', { class: 'missing-overlay reorder-overlay' }, [
    el('header', { class: 'app-header orders-header' }, [
      el('span', { class: 'app-header-slot' }, [
        el('button', {
          class: 'app-icon-btn orders-icon-btn', type: 'button', 'aria-label': t('ui.back'),
          icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
          onclick: close,
        }),
      ]),
      el('div', { class: 'app-header-title orders-header-title' }, [
        el('h1', { text: t('orders.reorder.screenTitle') }),
      ]),
      el('span', { class: 'app-header-slot' }),
    ]),
    el('div', { class: 'scroll-area' }, [body]),
  ]);

  // Redrawn from the LATEST ctx, never from a list captured at open: the data under it moves.
  const redraw = ctx => {
    if (ctx) latest = ctx;
    body.textContent = '';
    const items = stillToReorder(latest.history, latest.entries);
    // ⚠️ AN EMPTY LIST STAYS OPEN, with a sentence. Closing it when the last line goes would
    // yank the screen from under the thumb that just tapped.
    if (!items.length) {
      body.appendChild(el('p', { class: 'ing-empty', text: t('orders.reorder.empty') }));
      return;
    }
    items.forEach(item => body.appendChild(reorderCard(item, () => latest)));
  };

  openList = { redraw };
  redraw();
  document.body.appendChild(overlay);
}

function reorderCard(item, getCtx) {
  const ctx = getCtx();
  const name = recordedName(item.id, ctx.ingredientsById || {}, {});
  const supplier = ctx.suppliersById?.[item.supplierId] || null;
  const supplierName = supplierLabel(supplier) || t('orders.deliveries.unknownSupplier');

  return el('div', { class: 'reorder-card' }, [
    el('div', { class: 'reorder-main' }, [
      el('span', { class: 'reorder-name', text: name }),
      el('span', { class: 'missing-qty', text: qtyWithUnit(item.qty, item.unit) }),
    ]),
    el('div', {
      class: 'reorder-meta',
      text: t('orders.reorder.rowMeta', { supplier: supplierName, day: spellDay(item.missedOn) }),
    }),
    el('button', {
      class: 'btn-secondary reorder-put', type: 'button',
      text: t('orders.reorder.putBackIn', { supplier: supplierName }),
      'aria-label': t('orders.reorder.putBackInAria', { supplier: supplierName, name }),
      onclick: () => putBackOne(item, getCtx()),
    }),
    el('button', {
      class: 'reorder-resolve', type: 'button',
      text: t('orders.reorder.resolved'),
      'aria-label': t('orders.reorder.resolvedAria', { name }),
      onclick: () => resolveOne(item, name, getCtx()),
    }),
  ]);
}

async function putBackOne(item, ctx) {
  const { applied, skipped } = applyReorder([item], ctx.entries);
  // ⚠️ A SKIP IS REPORTED, NEVER SWALLOWED. A row already carrying a quantity was
  // typed by a person — possibly seconds ago on another phone — so it is left alone;
  // saying nothing would look exactly like the button having failed.
  if (!applied.length) {
    await alertDialog(t('orders.reorder.someSkipped', { n: skipped.length || 1 }));
    return;
  }
  try {
    // onReorder ends in render(), which redraws this list from fresh data.
    await ctx.onReorder(applied);
  } catch {
    await alertDialog(t('orders.deliveries.couldNotSave'));
  }
}

async function resolveOne(item, name, ctx) {
  const go = await confirmDialog({
    title: t('orders.reorder.resolveTitle'),
    message: t('orders.reorder.resolveMessage', { name }),
    okLabel: t('orders.reorder.resolved'),
    cancelLabel: t('ui.cancel'),
  });
  if (!go) return;
  try {
    // The row leaves when the history snapshot carrying the mark lands (renderReorderBanner).
    await ctx.onResolve(item);
  } catch {
    await alertDialog(t('orders.deliveries.couldNotSave'));
  }
}

// ── ⚠️ THE DEBT: what left the week without an answer ────────────────────────
//
// ⚠️⚠️ THIS BANNER NEVER GOES QUIET BY ITSELF, and that is the entire difference
// between it and the "still to re-order" one above. That one switches off because the
// work got done; this one switches off only because somebody ANSWERED. It is the half
// that makes a strict week window safe: without it an order that never arrived would
// vanish, unanswered, on the day the week turned — which is exactly the control
// Federico said he must not lose.
//
// ⚠️ AND IT IS A BANNER, NOT A MODAL THAT BLOCKS THE APP. The compulsory update (v211)
// already taught this project that a dialog nobody can dismiss strands somebody in the
// middle of service, and had to grow an escape hatch after two attempts. An order that
// did not turn up is not a kitchen emergency; remembering it for ever is.
// ⚠️ RETURNS THE COUNT — added on top of the render, not instead of it, when
// the tablet's tab badge (js/orders/orders-main.js) was given the debt count
// to show. The DOM is still the single source of truth for the banner itself;
// this is only a convenience for a caller that already has to call this
// function anyway and would otherwise recompute unansweredBefore() a second
// time and risk the two numbers disagreeing.
export function renderOwedBanner(host, ctx) {
  if (!host) return 0;
  host.textContent = '';
  const owed = unansweredBefore(ctx.history, ctx.today, { weekStartsOn: ctx.weekStartsOn });
  host.hidden = !owed.length;
  if (!owed.length) return 0;

  host.appendChild(el('button', {
    class: 'today-banner owed-banner', type: 'button',
    text: t('orders.deliveries.owed', { n: owed.length }),
    onclick: () => openOwed(owed, ctx),
  }));
  return owed.length;
}

// One at a time, oldest first — the same two answers as a delivery in the week, because
// it IS the same question, only later.
async function openOwed(owed, ctx) {
  for (const order of owed) {
    const supplier = ctx.suppliersById?.[order.supplierId] || null;
    // ⚠️ AWAITED IN SEQUENCE, not fired in a loop: two dialogs racing each other would
    // put one behind the other and answer the wrong order.
    // eslint-disable-next-line no-await-in-loop
    const answered = await openArrival({ order, supplier, expected: '' }, ctx);
    // ⚠️ Somebody who backs out keeps the rest of the debt — it is not "all or nothing",
    // and abandoning halfway must not mark the remainder as dealt with.
    if (answered === false) return;
  }
}
