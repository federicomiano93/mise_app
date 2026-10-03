// "Supplier order" — where an owner or a manager drags the suppliers into the order the
// Orders main screen lists them in, for EVERY phone of the venue.
//
// ⚠️ REACHED ONLY FROM ORDERS → SETTINGS, from a door only a manager sees. The database
// says the same: config/orders is write-gated on canManage, so hiding the door is courtesy.
//
// ⚠️ THE ORDER IS DRAGGED AND ALSO MOVED WITH THE KEYBOARD (P18). Dragging is how a finger
// does it (the vendored SortableJS, with the same hold-to-drag delay on touch as the Home
// cards screen, js/staff/home-cards-screen.js, which this is modelled on); the grip is a
// real button that moves its row with the arrow keys.

import { el } from './dom.js';
import { alertDialog } from './confirm-dialog.js';
import { t } from '../i18n.js';
import { supplierLabel } from '../supplier-label.js';
import { sortSuppliersByOrder } from './supplier-order.js';
import Sortable from '../vendor/sortable.esm.js';

const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
const GRIP_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';

// `suppliers` and `order` are GETTERS, read when the screen opens, so what it shows is
// what the venue has now. `saveOrdersConfig(patch)` is the merge write of config/orders.
export function openSupplierOrder({ suppliers, order: currentOrder, saveOrdersConfig }) {
  const list = el('div', { class: 'people-list' });
  const status = el('p', { class: 'people-note', role: 'status', 'aria-live': 'polite' });

  const active = suppliers();
  const byId = new Map(active.map(s => [s.id, s]));
  let order = sortSuppliersByOrder(active, currentOrder(), supplierLabel).map(s => s.id);

  const overlay = el('div', { class: 'people-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'supplier-order-title' }, [
    el('header', { class: 'app-header orders-header' }, [
      el('span', { class: 'app-header-slot' }, [
        el('button', {
          type: 'button', class: 'app-icon-btn orders-icon-btn', 'aria-label': t('ui.back'),
          icon: BACK_ICON, onClick: close,
        }),
      ]),
      el('div', { class: 'app-header-title orders-header-title' }, [
        el('h1', { id: 'supplier-order-title', text: t('orders.supplierOrder.title') }),
      ]),
      el('span', { class: 'app-header-slot' }),
    ]),
    el('div', { class: 'people-scroll' }, [
      el('div', { class: 'people-row' }, [
        el('p', { class: 'people-hint', id: 'supplier-order-hint', text: t('orders.supplierOrder.hint') }),
      ]),
      list,
      status,
    ]),
  ]);

  function onKey(event) {
    // A dialog or another layer on top handled the key first: leave it alone.
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    close();
  }

  function close() {
    sortable?.destroy();
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    // The settings panel may have been rebuilt meanwhile, so the door is looked up again.
    document.getElementById('supplier-order-door')?.focus();
  }

  function paint() {
    list.textContent = '';
    if (!order.length) {
      list.appendChild(el('div', { class: 'people-row' }, [
        el('p', { class: 'people-note', text: t('orders.supplierOrder.none') }),
      ]));
      return;
    }
    const draggable = order.length > 1;
    for (const id of order) {
      const name = supplierLabel(byId.get(id));
      list.appendChild(el('div', { class: 'people-row home-cards-row supplier-order-row', dataset: { supplier: id } }, [
        draggable ? el('button', {
          type: 'button',
          class: 'home-cards-grip',
          'data-grip': id,
          'aria-label': t('orders.supplierOrder.move', { name }),
          'aria-describedby': 'supplier-order-hint',
          icon: GRIP_ICON,
          onKeydown: event => moveWithKeys(id, event),
        }) : null,
        el('div', { class: 'people-row-main' }, [
          el('span', { class: 'people-name', text: name }),
        ]),
      ]));
    }
  }

  function gripOf(id) {
    return [...list.querySelectorAll('[data-grip]')].find(b => b.dataset.grip === id);
  }

  function idsOnScreen() {
    return [...list.querySelectorAll('.supplier-order-row')].map(row => row.dataset.supplier);
  }

  // The order the server last agreed to — where a failed save goes back to.
  let confirmedOrder = order;
  // ⚠️ SAVES RUN ONE AT A TIME, AND ONLY THE NEWEST IS SENT (same reasoning as the Home
  // cards screen): four quick arrow presses must not send four overlapping writes, and a
  // failure must not put the screen back over a later save that succeeded.
  let latest = order;
  let chain = Promise.resolve();
  let savedTimer = null;

  function saveOrder(next, focusId) {
    if (next.join('\n') === order.join('\n')) return;
    order = next;
    latest = next;
    paint();
    if (focusId) gripOf(focusId)?.focus();
    clearTimeout(savedTimer);
    status.textContent = t('orders.supplierOrder.saving');
    chain = chain.then(async () => {
      if (latest !== next) return;
      try {
        await saveOrdersConfig({ supplierOrder: next });
        confirmedOrder = next;
        if (latest === next) {
          status.textContent = t('settings.saved');
          savedTimer = setTimeout(() => { status.textContent = ''; }, 2000);
        }
      } catch (err) {
        if (latest !== next) return;
        status.textContent = '';
        const focused = document.activeElement?.closest?.('.supplier-order-row')?.dataset.supplier;
        order = confirmedOrder;
        latest = confirmedOrder;
        paint();
        if (focused) gripOf(focused)?.focus();
        await alertDialog(t('orders.supplierOrder.err'));
      }
    });
  }

  function moveWithKeys(id, event) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const from = order.indexOf(id);
    const to = event.key === 'ArrowUp' ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= order.length) return;
    const next = order.slice();
    next.splice(from, 1);
    next.splice(to, 0, id);
    saveOrder(next, id);
  }

  paint();
  // Hold to drag on a phone (200ms), so scrolling the list with a thumb never moves a row.
  const sortable = order.length > 1 ? Sortable.create(list, {
    animation: 150,
    delay: 200,
    delayOnTouchOnly: true,
    draggable: '.supplier-order-row',
    ghostClass: 'cp-sortable-ghost',
    chosenClass: 'cp-sortable-chosen',
    dragClass: 'cp-sortable-drag',
    onEnd: () => { saveOrder(idsOnScreen()); },
  }) : null;

  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  overlay.querySelector('.orders-icon-btn')?.focus();
  return { close };
}
