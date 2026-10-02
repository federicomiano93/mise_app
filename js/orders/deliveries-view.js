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
import { NO_SUPPLIER_ID } from '../records.js';
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

// ⚠️ ITS OWN ROUND BUTTON IN THE GREEN BAR (#orders-reorder-btn, 2 Oct 2026), NOT A NOTICE IN
// THE BELL: «da riordinare» is work to do, and a bell that mixes it with reminders and
// calendar notices hides it. The button is shown only while something is to be re-ordered,
// carries the count on a small dot and opens the list. Everything it shows is DERIVED here
// from the history and the draft — nothing is stored.
export function renderReorderButton(btn, countEl, ctx) {
  // ⚠️ AN OPEN LIST IS REDRAWN FROM HERE, BEFORE ANY EARLY RETURN. orders-main calls this on
  // every snapshot and every render(), with the freshest data — so a line put back or marked
  // «Risolto» (on this phone or the other one in the kitchen) leaves the open list without a
  // second subscription. It must run even when the button has gone (missing or no items
  // left): the list stays open on its empty text until somebody taps Back.
  if (openList) openList.redraw(ctx);
  lastBannerCtx = ctx;
  reorderBtn = btn || null;
  reorderCount = countEl || null;
  if (!btn) return;
  if (!wiredButtons.has(btn)) {
    // The freshest ctx the button was drawn with; the open list then follows every render.
    btn.addEventListener('click', () => { if (lastBannerCtx) openReorderScreen(lastBannerCtx); });
    wiredButtons.add(btn);
  }
  const items = stillToReorder(ctx.history, ctx.entries);
  btn.hidden = !items.length;
  if (countEl) {
    countEl.textContent = items.length ? String(items.length) : '';
    countEl.hidden = !items.length;
  }
  // The language is read HERE, at drawing time — never when the module loads.
  btn.setAttribute('aria-label', t('orders.reorder.buttonAria', { n: items.length }));
}

// Draw the button again from the last data it had — for a change of language, which brings
// no new snapshot.
export function repaintReorderButton() {
  if (reorderBtn && lastBannerCtx) renderReorderButton(reorderBtn, reorderCount, lastBannerCtx);
}

// The open «Da riordinare» list, or null. One at a time: the button is under the overlay, so
// a second tap cannot come, but a stale handle would redraw a node that is gone.
let openList = null;
let lastBannerCtx = null;
let reorderBtn = null;
let reorderCount = null;
const wiredButtons = new WeakSet();
// Lines whose write is running («recordId|ingredientId»): both buttons of that card stay
// disabled, and stay so across a redraw that rebuilds the card.
const busy = new Set();
const busyKey = item => `${item.recordId}|${item.id}`;

// ⚠️ «PUT BACK» NAMES THE SUPPLIER THE LINE WILL REALLY GO TO — the ingredient's CURRENT
// supplier — which is not always the one it was missed from (it may have been moved since).
// A draft quantity is only ever seen on an order row, so where no visible row would carry
// it — the ingredient is gone, switched off, or has no active supplier (Orders files those
// under «No supplier», which this app does not offer as a place to put an order back) —
// there is no such button: a quantity typed into a row nobody can see is an order that is
// never placed. Returns the label to show, or null.
function putBackTarget(item, ctx) {
  const ing = ctx.ingredientsById?.[item.id];
  if (!ing || ing.active === false) return null;
  const supplier = ctx.suppliersById?.[ing.supplierId];
  if (!supplier || supplier.active === false) return null;
  return supplierLabel(supplier) || null;
}

// ⚠️ ONE CARD PER MISSING LINE, AND EACH LINE WAITS UNTIL SOMEBODY DECIDES. Federico buys a
// missing ingredient «da un'altra parte» as often as from the same supplier, so there is no
// single «put everything back» any more: per line, «put it back in {supplier}'s order» or
// «Risolto» (bought elsewhere — it leaves this list for good, and goes in no order).
function openReorderScreen(firstCtx) {
  if (openList) return;
  let latest = firstCtx;

  const body = el('div', { class: 'reorder-list' });

  // Escape closes — but not when a dialog is on top, whose own Escape must only close it.
  const onKey = e => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.querySelector?.('.app-dialog-backdrop')) return;
    // The supplier chooser is on top: Escape closes THAT, not the list under it.
    if (document.querySelector?.('.reorder-chooser')) return;
    close();
  };

  // ⚠️ FOCUS GOES BACK TO THE BUTTON IN THE BAR, which is hidden once nothing is left to
  // re-order — then the Order tab is a visible, focusable place on the same screen; focus
  // must never fall to <body>.
  function close() {
    overlay.remove();
    openList = null;
    document.removeEventListener('keydown', onKey);
    (reorderBtn && !reorderBtn.hidden ? reorderBtn : document.getElementById('tab-order-btn'))?.focus();
  }

  const backBtn = el('button', {
    class: 'app-icon-btn orders-icon-btn', type: 'button', 'aria-label': t('ui.back'),
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    onclick: close,
  });

  // The same three attributes as the order summary sheet (orders-main.js).
  const overlay = el('div', {
    class: 'missing-overlay reorder-overlay',
    role: 'dialog', 'aria-modal': 'true', 'aria-label': t('orders.reorder.screenTitle'),
  }, [
    el('header', { class: 'app-header orders-header' }, [
      el('span', { class: 'app-header-slot' }, [backBtn]),
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
    // ⚠️ FOCUS SURVIVES THE REDRAW. A card that is answered disappears, taking the focused
    // button with it — a keyboard or screen-reader user would be dropped on <body>. So the
    // card holding focus is noted first, and focus then goes to the card now at that place
    // (the next one), or to Back when none is left.
    const focusedAt = cardIndexHoldingFocus(body);
    body.textContent = '';
    const items = stillToReorder(latest.history, latest.entries);
    // ⚠️ AN EMPTY LIST STAYS OPEN, with a sentence. Closing it when the last line goes would
    // yank the screen from under the thumb that just tapped.
    if (!items.length) {
      body.appendChild(el('p', { class: 'ing-empty', text: t('orders.reorder.empty') }));
    } else {
      items.forEach(item => body.appendChild(reorderCard(item, () => latest)));
    }
    if (focusedAt >= 0) {
      const cardNodes = Array.from(body.children).filter(c => c.classList.contains('reorder-card'));
      const next = cardNodes[Math.min(focusedAt, cardNodes.length - 1)];
      const buttons = next ? Array.from(next.querySelectorAll('button')) : [];
      (buttons.find(b => !b.disabled) || buttons[0] || backBtn).focus();
    }
  };

  openList = { redraw };
  redraw();
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
  // Moves focus INTO the screen once it is in the document (focusing a detached node is
  // silently ignored) — the order summary does the same.
  backBtn.focus();
}

// The index of the card that holds keyboard focus, or -1.
function cardIndexHoldingFocus(body) {
  let node = document.activeElement;
  while (node && node.parentNode !== body) node = node.parentNode;
  return node ? Array.from(body.children).indexOf(node) : -1;
}

function reorderCard(item, getCtx) {
  const ctx = getCtx();
  // ⚠️ THE NAMES FROZEN INTO THE ORDER are the fallback, never `{}`: the ingredient list can
  // arrive after the order history, and a card drawn in between said «Ingrediente eliminato»
  // for an ingredient that exists (found driving it, 1 Oct 2026).
  const record = (ctx.history || []).find(r => r && (r.id === item.recordId));
  const name = recordedName(item.id, ctx.ingredientsById || {}, record?.names || {});
  const supplier = ctx.suppliersById?.[item.supplierId] || null;
  // Same fallback for the supplier: the name the order was placed under.
  const supplierName = supplierLabel(supplier) || record?.supplierName || t('orders.deliveries.unknownSupplier');

  // The supplier the line will really go to; null = no «put back» button on this card.
  const target = putBackTarget(item, ctx);

  const putBtn = target === null ? null : el('button', {
    class: 'btn-primary reorder-put', type: 'button',
    text: t('orders.reorder.putBackIn', { supplier: target }),
    'aria-label': t('orders.reorder.putBackInAria', { supplier: target, name }),
  });
  // «Ordina da un altro fornitore» — FOR THIS ORDER ONLY, the ingredient keeps its usual
  // supplier. Offered wherever a typed quantity would be seen (the ingredient is live) and
  // there is another supplier to choose.
  const choices = otherSupplierChoices(item, ctx);
  const otherBtn = !choices.length ? null : el('button', {
    class: 'btn-secondary reorder-other', type: 'button',
    text: t('orders.reorder.otherSupplier'),
    'aria-label': t('orders.reorder.otherSupplierAria', { name }),
  });
  const resolveBtn = el('button', {
    class: 'reorder-resolve', type: 'button',
    text: t('orders.reorder.resolved'),
    'aria-label': t('orders.reorder.resolvedAria', { name }),
  });
  const buttons = [putBtn, otherBtn, resolveBtn].filter(Boolean);

  // ⚠️ BOTH BUTTONS OF A CARD ARE OFF WHILE ITS WRITE RUNS: a second tap on a slow phone
  // would send the same line twice. Re-enabled only on failure — on success the card is
  // about to go, and a re-enabled button on it would invite the second tap anyway.
  const lock = (on, { keepDisabled = false } = {}) => {
    if (on) busy.add(busyKey(item)); else busy.delete(busyKey(item));
    buttons.forEach(b => { b.disabled = on || keepDisabled; });
  };
  if (busy.has(busyKey(item))) buttons.forEach(b => { b.disabled = true; });

  putBtn?.addEventListener('click', () => putBackOne(item, getCtx(), lock));
  otherBtn?.addEventListener('click', () => chooseOtherSupplier(item, name, otherBtn, getCtx, lock));
  resolveBtn.addEventListener('click', () => resolveOne(item, name, getCtx(), lock));

  return el('div', { class: 'reorder-card' }, [
    el('div', { class: 'reorder-main' }, [
      el('span', { class: 'reorder-name', text: name }),
      el('span', { class: 'missing-qty', text: qtyWithUnit(item.qty, item.unit) }),
    ]),
    el('div', {
      class: 'reorder-meta',
      text: t('orders.reorder.rowMeta', { supplier: supplierName, day: spellDay(item.missedOn) }),
    }),
    ...buttons,
  ]);
}

// The suppliers a missing line may be ordered from INSTEAD: active, sorted by the name a
// person reads, never the ingredient's usual supplier and never the pseudo «no supplier».
// Empty when the ingredient is gone or switched off (a quantity typed for it would be on a
// row nobody can see).
function otherSupplierChoices(item, ctx) {
  const ing = ctx.ingredientsById?.[item.id];
  if (!ing || ing.active === false) return [];
  return Object.values(ctx.suppliersById || {})
    .filter(s => s && s.active !== false && s.id !== NO_SUPPLIER_ID && s.id !== ing.supplierId)
    .sort((a, b) => supplierLabel(a).localeCompare(supplierLabel(b)));
}

// The chooser: one screen over the list, a row per supplier. Back (or Escape) returns to the
// list with NOTHING written; choosing a supplier makes the one write and closes it.
function chooseOtherSupplier(item, name, opener, getCtx, lock) {
  const ctx = getCtx();
  const choices = otherSupplierChoices(item, ctx);
  const ing = ctx.ingredientsById?.[item.id];
  const usual = ctx.suppliersById?.[ing?.supplierId];
  // An ingredient with no usual supplier has nobody for it to «stay with»: that sentence is left out.
  const usualName = usual ? supplierLabel(usual) : '';

  const onKey = e => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.querySelector?.('.app-dialog-backdrop')) return;
    close();
  };
  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    // Back to the button that opened it — or to the list's own Back when that card was redrawn.
    const target = opener?.parentNode ? opener : document.querySelector?.('.reorder-overlay .app-icon-btn');
    target?.focus();
  }

  const backBtn = el('button', {
    class: 'app-icon-btn orders-icon-btn', type: 'button', 'aria-label': t('ui.back'),
    icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    onclick: close,
  });

  const rows = choices.map(supplier => el('button', {
    class: 'supplier-row-open delivery-row reorder-choice', type: 'button',
    'aria-label': t('orders.reorder.chooseAria', { name, supplier: supplierLabel(supplier) }),
    onclick: async () => {
      const { applied, skipped } = applyReorder([item], getCtx().entries);
      // The same refusal as «put back»: a row that already has a quantity was typed by a
      // person, and is never overwritten.
      if (!applied.length) {
        await alertDialog(t('orders.reorder.someSkipped', { n: skipped.length || 1 }));
        return;
      }
      lock(true);
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      try {
        await getCtx().onOtherSupplier({ ...applied[0], recordId: item.recordId }, supplier.id);
        lock(false, { keepDisabled: true });
      } catch (err) {
        lock(false);
        await alertDialog(t('orders.deliveries.couldNotSave'));
      }
    },
  }, [
    el('span', { class: 'delivery-name', text: supplierLabel(supplier) }),
    el('span', { class: 'delivery-chevron', icon: CHEVRON }),
  ]));

  const overlay = el('div', {
    class: 'missing-overlay reorder-overlay reorder-chooser',
    role: 'dialog', 'aria-modal': 'true', 'aria-label': t('orders.reorder.chooseTitle'),
  }, [
    el('header', { class: 'app-header orders-header' }, [
      el('span', { class: 'app-header-slot' }, [backBtn]),
      el('div', { class: 'app-header-title orders-header-title' }, [
        el('h1', { text: t('orders.reorder.chooseTitle') }),
      ]),
      el('span', { class: 'app-header-slot' }),
    ]),
    el('div', { class: 'scroll-area' }, [
      el('p', { class: 'missing-hint', text: usualName
        ? t('orders.reorder.chooseHint', { name, supplier: usualName })
        : t('orders.reorder.chooseHintNoUsual', { name }) }),
      ...(rows.length ? rows : [el('p', { class: 'ing-empty', text: t('orders.reorder.chooseEmpty') })]),
    ]),
  ]);

  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
  backBtn.focus();
}

async function putBackOne(item, ctx, lock) {
  const { applied, skipped } = applyReorder([item], ctx.entries);
  // ⚠️ A SKIP IS REPORTED, NEVER SWALLOWED. A row already carrying a quantity was
  // typed by a person — possibly seconds ago on another phone — so it is left alone;
  // saying nothing would look exactly like the button having failed.
  if (!applied.length) {
    await alertDialog(t('orders.reorder.someSkipped', { n: skipped.length || 1 }));
    return;
  }
  lock(true);
  try {
    // onReorder ends in render(), which redraws this list from fresh data.
    await ctx.onReorder(applied);
    lock(false, { keepDisabled: true });
  } catch {
    lock(false);
    await alertDialog(t('orders.deliveries.couldNotSave'));
  }
}

async function resolveOne(item, name, ctx, lock) {
  const go = await confirmDialog({
    title: t('orders.reorder.resolveTitle'),
    message: t('orders.reorder.resolveMessage', { name }),
    okLabel: t('orders.reorder.resolved'),
    cancelLabel: t('ui.cancel'),
  });
  if (!go) return;
  lock(true);
  try {
    // The row leaves when the history snapshot carrying the mark lands (renderReorderButton).
    await ctx.onResolve(item);
    lock(false, { keepDisabled: true });
  } catch {
    lock(false);
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
