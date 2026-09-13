// "Home cards" — where an owner, a manager or a head chef chooses which Home cards the
// venue's ordinary employees see, and in what order EVERYBODY sees them.
//
// ⚠️ REACHED ONLY FROM THE HOME'S SETTINGS, and only by somebody who can manage the
// venue. functions/onboarding.js setStaffCard / setHomeCardOrder refuse everybody else
// as well, because hiding a control is courtesy, never security (P2).
//
// ⚠️⚠️ IT SAYS, EVERY TIME, THAT THE PERSON LOOKING STILL SEES EVERYTHING. A manager who
// hides Pastries and goes back to a Home that still shows Pastries would reasonably
// conclude the switch is broken. The sentence is beside the switches, not in a help page.
//
// ⚠️ WHAT ASKS FIRST (Federico, 13 Sep 2026): hiding ANY card, because hiding also
// silences its notifications for employees; and SHOWING a money card (Food cost,
// Stocktake), because that gives employees access to the accounts. Showing an everyday
// card back saves at once.
//
// ⚠️ THE ORDER IS DRAGGED, AND ALSO MOVED WITH THE KEYBOARD. Dragging is how a finger
// does it (the same vendored SortableJS the Calculator's client list uses, with the
// same hold-to-drag delay on touch); the grip is a real button that moves its row with
// the arrow keys, so the order can be changed without a pointer at all (P18).

import { el } from './dom.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { setStaffCard, setHomeCardOrder } from './firebase-staff.js';
import { t } from '../i18n.js';
import { allowedSections } from '../sections.js';
import { STAFF_CARDS, isHiddenForStaff, orderedCardIds } from '../home-cards.js';
import Sortable from '../vendor/sortable.esm.js';

const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
const GRIP_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';

// ⚠️ WHAT HAS BEEN CHANGED SINCE THIS PAGE LOADED. The session's copy of the location
// document is read once, when the venue opens, and does not follow a write made
// afterwards — so without these, closing and reopening the screen would show every
// switch, and the order, back where they started. Module level, so they outlive one
// opening of the screen. Same problem, same answer, as js/orders/firebase-features.js.
const override = {};        // card id → hidden from employees
let orderOverride = null;   // the order last agreed by the server

function hiddenNow(location, cardId) {
  return Object.prototype.hasOwnProperty.call(override, cardId)
    ? override[cardId]
    : isHiddenForStaff(location, cardId);
}

// What to ask before changing a card, or null to change it at once.
function questionFor(card, hide) {
  const name = t(card.labelKey);
  if (hide) {
    const lines = [t('homeCards.hide.body')];
    if (card.id === 'catalogue') lines.push(t('homeCards.catalogue.body'));
    if (card.employeePush) lines.push(t('homeCards.hide.push'));
    return {
      title: t('homeCards.hide.title', { card: name }),
      message: lines.join('\n\n'),
      okLabel: t('homeCards.hide.ok'),
      danger: true,
    };
  }
  if (card.optIn) {
    return {
      title: t('homeCards.show.title', { card: name }),
      message: card.id === 'foodcost' ? t('homeCards.show.foodcost') : t('homeCards.show.inventory'),
      okLabel: t('homeCards.show.ok'),
      danger: false,
    };
  }
  return null;
}

export function openHomeCards(session) {
  const list = el('div', { class: 'people-list home-cards-list' });
  const status = el('p', { class: 'people-note', role: 'status' });

  // ⚠️ EVERY CARD THIS VENUE HAS — the money cards included — and none it does not.
  // A switch for a part of the app the venue does not use would promise a card nobody
  // can ever be shown.
  const venueSections = allowedSections(session.location);
  const available = STAFF_CARDS.filter(card => venueSections[card.section] === true);
  const byId = new Map(available.map(card => [card.id, card]));
  const availableIds = available.map(card => card.id);
  let order = orderedCardIds(orderOverride ? { homeCardOrder: orderOverride } : session.location, availableIds);
  // While a switch is being saved every button is disabled; a repaint for the order must
  // not quietly enable them again.
  let toggling = false;

  const overlay = el('div', { class: 'people-overlay' }, [
    el('header', { class: 'orders-header' }, [
      el('button', {
        type: 'button', class: 'orders-icon-btn', 'aria-label': t('auth.back'),
        icon: BACK_ICON, onClick: close,
      }),
      el('div', { class: 'orders-header-title' }, [el('h1', { text: t('homeCards.title') })]),
      el('span', { style: { width: '36px', flexShrink: '0' } }),
    ]),
    el('div', { class: 'people-scroll' }, [
      el('div', { class: 'people-row' }, [
        el('p', { class: 'people-hint', text: t('homeCards.intro') }),
        el('p', { class: 'people-note', id: 'home-cards-move-hint', text: t('homeCards.moveHint') }),
      ]),
      list,
      el('div', { class: 'people-row' }, [
        el('p', { class: 'people-note', text: t('homeCards.managersSeeAll') }),
      ]),
      el('div', { class: 'people-row' }, [
        el('p', { class: 'people-note', text: t('homeCards.applies') }),
      ]),
      status,
    ]),
  ]);

  function close() {
    sortable?.destroy();
    overlay.remove();
  }

  function paint() {
    list.textContent = '';
    if (!order.length) {
      list.appendChild(el('div', { class: 'people-row' }, [
        el('p', { class: 'people-note', text: t('homeCards.none') }),
      ]));
      return;
    }
    for (const id of order) {
      const card = byId.get(id);
      const shown = !hiddenNow(session.location, card.id);
      const name = t(card.labelKey);
      const nameId = `home-cards-name-${card.id}`;
      const pillId = `home-cards-pill-${card.id}`;
      list.appendChild(el('div', { class: 'people-row home-cards-row', dataset: { card: card.id } }, [
        el('button', {
          type: 'button',
          class: 'home-cards-grip',
          id: `home-cards-grip-${card.id}`,
          'aria-label': t('homeCards.move', { card: name }),
          'aria-describedby': 'home-cards-move-hint',
          icon: GRIP_ICON,
          onKeydown: (event) => moveWithKeys(card.id, event),
        }),
        el('div', { class: 'people-row-main' }, [
          el('span', { class: 'people-name', id: nameId, text: name }),
        ]),
        el('div', { class: 'people-row-actions' }, [
          // ⚠️ A SWITCH, READ AS ONE: the card AND its state, so a screen reader hears
          // «Pastries, Visible, switch, on» rather than a bare «Visible».
          el('button', {
            type: 'button',
            id: pillId,
            role: 'switch',
            'aria-checked': shown ? 'true' : 'false',
            'aria-labelledby': `${nameId} ${pillId}`,
            class: `people-pill people-pill--switch${shown ? ' people-pill--on' : ''}`,
            onClick: () => toggle(card, shown),
          }, shown ? t('homeCards.shown') : t('homeCards.hidden')),
        ]),
      ]));
    }
    if (toggling) for (const b of list.querySelectorAll('button')) b.disabled = true;
  }

  async function toggle(card, shown) {
    const hide = shown;
    // ⚠️ THE LIST IS REBUILT AFTER EVERY SAVE, so the button that had the focus no
    // longer exists. Without putting it back, somebody on a keyboard or a screen
    // reader is thrown to the top of the page after every single switch.
    const pillId = `home-cards-pill-${card.id}`;
    const hadFocus = document.activeElement?.id === pillId;
    const ask = questionFor(card, hide);
    if (ask) {
      const ok = await confirmDialog({ ...ask, cancelLabel: t('ui.cancel') });
      if (!ok) return;
    }
    status.textContent = t('homeCards.saving');
    toggling = true;
    for (const b of list.querySelectorAll('button')) b.disabled = true;
    try {
      await setStaffCard(session.locationId, card.id, hide);
      // Only after the server has agreed. Setting it first would leave the screen
      // showing a change the venue never got.
      override[card.id] = hide;
      status.textContent = '';
    } catch (err) {
      status.textContent = '';
      await alertDialog(t('homeCards.err.save'));
    }
    toggling = false;
    // Repainted from what is stored either way — a failed save puts the switch back.
    paint();
    if (hadFocus) list.querySelector(`#${pillId}`)?.focus();
  }

  // ── The order ────────────────────────────────────────────────────────────

  function idsOnScreen() {
    return [...list.querySelectorAll('.home-cards-row')].map(row => row.dataset.card);
  }

  // The order the server last agreed to — where a failed save goes back to.
  let confirmedOrder = order;
  // ⚠️ SAVES RUN ONE AT A TIME, AND ONLY THE NEWEST IS SENT. Four quick arrow presses used
  // to send four overlapping calls: whichever FINISHED last was what got stored, and one
  // that failed put the screen back over a later one that had succeeded (code review of
  // 819cadc). Now each save waits its turn, and a save that is no longer the newest when
  // its turn comes is skipped — the fourth order is the one the venue gets.
  let latest = order;
  let chain = Promise.resolve();

  // ⚠️ THE WHOLE LIST, AFTER THE SERVER AGREES — and back where it was if it does not,
  // so the screen never shows an order the venue did not get.
  function saveOrder(next, focusId) {
    // A drag while a switch is saving: put the rows back, change nothing.
    if (toggling) { paint(); return; }
    if (next.join() === order.join()) return;
    order = next;
    latest = next;
    paint();
    if (focusId) list.querySelector(`#home-cards-grip-${focusId}`)?.focus();
    status.textContent = t('homeCards.saving');
    chain = chain.then(async () => {
      if (latest !== next) return;
      try {
        await setHomeCardOrder(session.locationId, next);
        confirmedOrder = next;
        orderOverride = next;
        if (latest === next) status.textContent = '';
      } catch (err) {
        if (latest !== next) return;
        status.textContent = '';
        const focused = document.activeElement?.closest?.('.home-cards-row')?.dataset.card;
        order = confirmedOrder;
        latest = confirmedOrder;
        paint();
        if (focused) list.querySelector(`#home-cards-grip-${focused}`)?.focus();
        await alertDialog(t('homeCards.err.order'));
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
  // ⚠️ HOLD TO DRAG ON A PHONE (200ms), so scrolling the list with a thumb never moves
  // a card by accident — and never from the switch, which must stay a plain tap.
  const sortable = order.length > 1 ? Sortable.create(list, {
    animation: 150,
    delay: 200,
    delayOnTouchOnly: true,
    draggable: '.home-cards-row',
    filter: '.people-pill',
    preventOnFilter: false,
    ghostClass: 'cp-sortable-ghost',
    chosenClass: 'cp-sortable-chosen',
    dragClass: 'cp-sortable-drag',
    onEnd: () => { saveOrder(idsOnScreen()); },
  }) : null;

  document.body.appendChild(overlay);
  return { close };
}
