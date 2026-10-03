// history.js — past orders view.
//
// One section per DAY (most recent first), and inside it one card per supplier —
// because that is what an order now is. Before, a whole week of every supplier's
// items was crushed into a single card, so the screen could never answer the only
// two questions it is asked: what did I order, and when.
//
// Records written by the old weekly model are still shown, as a "Week of …" card
// that groups its items by supplier the way the old view did. Nothing was
// migrated, so they stay exactly as they were written.
//
// Ingredient names and units are resolved at RENDER time from the current
// ingredient list; one deleted since then falls back to its id rather than
// disappearing from its own order.

import { t, localeTag } from '../i18n.js';
import { supplierLabel } from '../supplier-label.js';
import { sendIconSvg } from '../send-icon.js';
import { recordUnit } from '../order-unit.js';
import { el, groupBy } from './dom.js';
import { dayLabel } from './day.js';
import {
  groupHistoryByDay, isLegacyRecord, splitHistoryByAge, countRecords, recordedName, sendSections,
} from './archive.js';
import { isNoSupplier } from './no-supplier.js';
import { HISTORY_LIVE_MONTHS, olderFooterState, historyFooter } from './history-window.js';
// The one definition of "3 items", shared rather than copied — the two copies had
// already drifted into two different English plurals, and neither was translated.
import { itemsLabel } from './supplier-picker.js';

// Whether the operator has asked to see past the recent window. Kept for the life of
// the page on purpose: this view is repainted on EVERY Firestore snapshot, so without
// it another phone recording an order would silently fold the old orders away again
// under the finger of whoever was reading them.
let showingOlder = false;

// The window the list was last painted with. Changing the setting is a deliberate
// statement about how much to show, so it must WIN over an earlier "show me
// everything" — otherwise Settings appears to do nothing until the app is reloaded,
// which is precisely what someone adjusting the number is watching for.
let lastWindow = null;

const PENCIL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

// ⚠️ THE SAME SEND ARROW AS EVERY OTHER SCREEN, since 24 Aug 2026. These two buttons
// carried the filled WhatsApp brand mark — one of three copies of it in the app — and
// Federico asked for one arrow everywhere. The WORDS still name WhatsApp, and honestly:
// unlike the footer button in orders.html, re-sending from History really does take one
// road and only one (see orders-main.js sendMessageFor).
// 📌 THAT IS ALSO AN OPEN QUESTION FOR HIM, NOT A DECISION TAKEN HERE: a venue that has
// switched «email to the supplier» on in Settings still gets WhatsApp when it re-sends
// yesterday's order, because this path never goes through the chooser.
const SEND_SVG = sendIconSvg(16);

function indexById(items) {
  return (items || []).reduce((acc, it) => { acc[it.id] = it; return acc; }, {});
}

// What to head a group of items with when no supplier document matches. Bought
// without a supplier is a deliberate, named thing; a genuinely unresolvable id is
// not, and calling that "No supplier" too would hide a real problem.
function supplierHeading(supplierId, supById) {
  const label = supplierLabel(supById[supplierId]);
  if (label) return label;
  return isNoSupplier(supplierId) ? t('orders.noSupplier') : t('orders.unknownSupplier');
}

// callbacks: { onEdit(record), onSend(record), onSendDay(date, records), onLoadOlder() }
// options:   { historyDays, now, older } — how many days to show at a glance, see archive.js;
//            older = { loading, done, error }: where the on-demand paging of orders beyond
//            the live window stands. It comes in through the options on EVERY repaint and is
//            never kept in the DOM, so a snapshot arriving mid-load cannot lose «Loading…».
//            Left out, it reads as done — no «Load older orders» button.
export function renderHistory(container, history, suppliers, ingredients, callbacks = {}, options = {}) {
  if (!container) return;
  // Focus is restored below when a button the person just pressed is about to be redrawn.
  const refocus = wantsLoadFocus;
  container.textContent = '';

  const days = groupHistoryByDay(history);
  const paging = options.older || { done: true };

  if (options.historyDays !== lastWindow) {
    lastWindow = options.historyDays;
    showingOlder = false;
  }

  const { recent, older } = splitHistoryByAge(days, options.historyDays, options.now);
  const foot = historyFooter({
    recentCount: recent.length, olderInMemory: older.length, showingOlder, older: paging,
  });

  if (foot.empty) {
    // Nothing live, but older orders may exist: never say there are none until they were
    // looked at.
    container.appendChild(el('p', { class: 'history-empty', text: foot.empty === 'none'
      ? t('orders.noPastOrdersYet')
      : t('orders.noOrdersInLastMonths', { n: HISTORY_LIVE_MONTHS }) }));
    if (foot.load) container.appendChild(loadOlderFooter(paging, callbacks));
    settleFocus(container, refocus, foot.load);
    return;
  }

  const supById = indexById(suppliers);
  const ingById = indexById(ingredients);

  const appendDay = ({ date, records }) => {
    container.appendChild(dayHeader(date, records, callbacks));
    records.forEach(record => container.appendChild(
      isLegacyRecord(record)
        ? buildLegacyCard(record, supById, ingById, callbacks)
        : buildOrderCard(record, ingById, callbacks),
    ));
  };

  (foot.days === 'all' ? days : recent).forEach(appendDay);

  if (foot.parkedFoot) {
    // The note and the button live in ONE element so revealing the old orders takes the
    // note with it. Left behind, "No orders in the last day" would sit above the orders
    // it just said were not there.
    const parkedFoot = el('div', { class: 'history-older' });
    // Nothing recent but plenty older: say so, or the screen reads as "the orders are
    // gone" with a lone button under it.
    if (foot.note) {
      parkedFoot.appendChild(el('p', { class: 'history-empty', text:
        t('orders.noOrdersInTheLast', { n: Number(options.historyDays) }) }));
    }
    parkedFoot.appendChild(olderButton(older, appendDay, parkedFoot, container, () => {
      // Revealing the parked days can bring the load button in under them.
      if (historyFooter({
        recentCount: recent.length, olderInMemory: older.length, showingOlder: true, older: paging,
      }).load) container.appendChild(loadOlderFooter(paging, callbacks));
    }));
    container.appendChild(parkedFoot);
  } else if (foot.load) {
    container.appendChild(loadOlderFooter(paging, callbacks));
  }
  settleFocus(container, refocus, foot.load);
}

// Reveal the orders older than the window that are ALREADY in memory — the live window
// plus any pages loaded on demand — so this fetches nothing and cannot fail. Fetching
// orders beyond them is loadOlderFooter's job.
function olderButton(older, appendDay, foot, container, appendLoadFoot) {
  return el('button', {
    type: 'button',
    class: 'history-older-btn',
    onClick: () => {
      showingOlder = true;
      foot.remove();
      const before = container.lastElementChild;
      older.forEach(appendDay);
      appendLoadFoot();
      // The button that held focus has just been removed; without this focus drops to the
      // page and a keyboard or screen-reader user starts again from the top. It goes to the
      // first revealed card.
      let node = before ? before.nextElementSibling : container.firstElementChild;
      while (node && !node.querySelector?.('.supplier-head') && !node.classList?.contains('supplier-card')) {
        node = node.nextElementSibling;
      }
      (node?.querySelector?.('.supplier-head') || node?.firstElementChild)?.focus?.();
    },
  }, [t('orders.showOlderOrders', { n: countRecords(older) })]);
}

// Whether the «Load older orders» button was the last thing pressed, so the next repaint
// gives focus back to its replacement. Set on the click and cleared once it has been
// honoured; the repaint BEFORE the page arrives draws a disabled button, which cannot take
// focus, so the wish waits for the repaint after it.
let wantsLoadFocus = false;

function settleFocus(container, wanted, loadVisible) {
  if (!wanted) return;
  // The load footer, when drawn, is always the last thing in the list.
  const btn = container.lastElementChild?.querySelector?.('.history-older-btn');
  if (loadVisible && btn && !btn.disabled) {
    btn.focus();
    wantsLoadFocus = false;
    return;
  }
  if (loadVisible) return;   // still loading, or the button is about to come back
  // Paging is finished and the button is gone: park focus on the list itself.
  wantsLoadFocus = false;
  if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
  container.focus();
}

// «Load older orders»: fetches the next page from Firestore (orders-main.js loadOlderHistory).
// Its whole state comes from `paging`; a failed attempt shows a line above the same button,
// which is then the retry (the failure is also announced in History's status line).
function loadOlderFooter(paging, callbacks) {
  const state = olderFooterState(paging);
  const foot = el('div', { class: 'history-older' });
  if (state.failed) {
    foot.appendChild(el('p', { class: 'history-empty', text: t('orders.olderOrdersFailed') }));
  }
  foot.appendChild(el('button', {
    type: 'button',
    class: 'history-older-btn',
    disabled: state.disabled ? '' : null,   // el() would set disabled="false" for a boolean
    onClick: () => {
      // The loaded page is entirely older than historyDays: without this it would be parked
      // behind «Show older orders» and the person would see nothing happen.
      showingOlder = true;
      wantsLoadFocus = true;
      callbacks.onLoadOlder?.();
    },
  }, [state.disabled ? t('orders.loading') : t('orders.loadOlderOrders')]));
  return foot;
}

// The day heading, with a "Send all" beside it once there is more than one order to
// send. Recording an order clears its rows from the draft, so the archive is the only
// place the message can still be built from — which is exactly why sending has to be
// possible from here and not only before placing.
function dayHeader(date, records, callbacks) {
  const label = el('span', { text: dayLabel(date) });
  if (records.length < 2 || !callbacks.onSendDay) {
    return el('div', { class: 'history-day-label' }, [label]);
  }
  return el('div', { class: 'history-day-label history-day-row' }, [
    label,
    el('button', {
      type: 'button',
      class: 'history-send-day',
      onClick: () => callbacks.onSendDay(date, records),
    }, [
      el('span', { class: 'history-send-icon', icon: SEND_SVG, 'aria-hidden': 'true' }),
      t('orders.sendAll'),
    ]),
  ]);
}

// The quiet foot-of-card actions: send this order again, or correct it.
function cardActions(record, callbacks) {
  const actions = [];
  if (callbacks.onSend) {
    actions.push(el('button', {
      type: 'button',
      class: 'history-edit-btn history-send-btn',
      onClick: () => callbacks.onSend(record),
    }, [
      el('span', { class: 'history-edit-icon', icon: SEND_SVG, 'aria-hidden': 'true' }),
      t('orders.sendOnWhatsapp'),
    ]));
  }
  actions.push(el('button', {
    type: 'button',
    class: 'history-edit-btn',
    onClick: () => callbacks.onEdit?.(record),
  }, [
    el('span', { class: 'history-edit-icon', icon: PENCIL_SVG, 'aria-hidden': 'true' }),
    t('orders.editOrder'),
  ]));
  return actions;
}

// The rows of one record: "name weight … qty unit", by name.
// The unit is the one the order was PLACED in (frozen into the record), else the card's.
function itemRows(record, ingById) {
  const quantities = record.quantities;
  return Object.keys(quantities || {})
    .map(id => ({
      name: recordedName(id, ingById, record.names),
      unit: recordUnit(record, id, ingById[id]),
      qty: quantities[id],
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(r => el('div', { class: 'history-item' }, [
      el('span', { class: 'history-item-name', text: r.name }),
      el('span', { class: 'history-item-qty', text: `${r.qty} ${r.unit}`.trim() }),
    ]));
}

// One order: one supplier, one day.
//
// ⚠️ SEVERAL ORDERS THE SAME DAY ARE SHOWN APART, each with its time (Federico, 3 Oct 2026: «se
// ci sono problemi è più semplice risalire agli ordini fatti»): «Ordine · ore 9:12», «Aggiunta ·
// ore 15:40», then the day's total — the numbers every other screen counts. One send shows only
// its time above the rows. A record from before sends existed looks exactly as it always did.
function buildOrderCard(record, ingById, callbacks) {
  const count = Object.keys(record.quantities || {}).length;
  const rows = itemRows(record, ingById);
  const { sections, total } = sendSections(record);

  let content;
  if (!rows.length) {
    content = [el('p', { class: 'history-empty', text: t('orders.noItemsRecorded') })];
  } else {
    content = [
      ...sections.flatMap(section => [
        el('div', { class: 'history-supplier', text: sendHeading(section) }),
        // A lone send is only a heading over the total; with several, each lists its own lines.
        ...(section.quantities
          ? itemRows({ quantities: section.quantities, units: section.units, names: record.names }, ingById)
          : []),
      ]),
      ...(total ? [el('div', { class: 'history-supplier', text: t('orders.history.dayTotal') })] : []),
      ...rows,
    ];
  }

  const body = el('div', { class: 'history-body' }, [
    ...content,
    ...cardActions(record, callbacks),
  ]);
  body.hidden = true;

  return el('div', { class: 'supplier-card' }, [
    collapsibleHead(record.supplierName || t('orders.unknownSupplier'), itemsLabel(count), body),
    body,
  ]);
}

// «Ordine · ore 9:12» / «Aggiunta · ore 15:40» / «Corretto · ore 16:20», or «Ordini precedenti»
// for what was ordered before the time of each order was kept (archive.js sendsBefore).
const SEND_HEADING = {
  first: 'orders.history.firstSend',
  later: 'orders.history.laterSend',
  edit: 'orders.history.editedSend',
};
function sendHeading(section) {
  const time = timeOf(section.time);
  if (!time || section.heading === 'earlier') return t('orders.history.earlierSends');
  return t(SEND_HEADING[section.heading] || SEND_HEADING.later, { time });
}

// The local time of an ISO timestamp, «9:12», in the interface language's own format.
function timeOf(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(localeTag(), { hour: 'numeric', minute: '2-digit' }).format(d);
}

// A record from the old weekly model: a whole week, every supplier in one
// document. Shown the way the old view showed it — grouped by supplier — so
// nothing that was recorded is lost or reinterpreted.
function buildLegacyCard(record, supById, ingById, callbacks) {
  const quantities = record.quantities || {};
  const bySupplier = groupBy(
    Object.keys(quantities).map(id => ({
      supplierId: ingById[id]?.supplierId || 'unknown',
      name: recordedName(id, ingById, record.names),
      unit: ingById[id]?.unit || '',
      qty: quantities[id],
    })),
    'supplierId',
  );

  const body = el('div', { class: 'history-body' });
  Object.keys(bySupplier).forEach(supplierId => {
    body.appendChild(el('div', { class: 'history-supplier', text: supplierHeading(supplierId, supById) }));
    bySupplier[supplierId]
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(r => body.appendChild(el('div', { class: 'history-item' }, [
        el('span', { class: 'history-item-name', text: r.name }),
        el('span', { class: 'history-item-qty', text: `${r.qty} ${r.unit}`.trim() }),
      ])));
  });
  if (!body.childElementCount) {
    body.appendChild(el('p', { class: 'history-empty', text: t('orders.noItemsRecorded') }));
  }
  cardActions(record, callbacks).forEach(btn => body.appendChild(btn));
  body.hidden = true;

  const count = Object.keys(quantities).length;
  return el('div', { class: 'supplier-card' }, [
    collapsibleHead(t('orders.wholeWeekAllSuppliers'), itemsLabel(count), body),
    body,
  ]);
}


// "1 day" / "15 days" — a window of one is a legal setting, and "the last 1 days"
// reads like a bug to the person who typed it.
function collapsibleHead(title, meta, body) {
  const chevron = el('span', { class: 'supplier-chevron' }, '▸');
  const head = el('button', { type: 'button', class: 'supplier-head', 'aria-expanded': 'false' }, [
    el('div', { class: 'supplier-head-main' }, [
      el('span', { class: 'supplier-name', text: title }),
      el('span', { class: 'supplier-meta', text: meta }),
    ]),
    el('div', { class: 'supplier-head-right' }, [chevron]),
  ]);
  head.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
    chevron.classList.toggle('open', open);
  });
  return head;
}
