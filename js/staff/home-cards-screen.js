// "Home cards" — where an owner, a manager or a head chef chooses which cards the
// venue's ordinary employees see on the Home.
//
// ⚠️ REACHED ONLY FROM THE HOME, and only by somebody who can manage the venue. The
// button is not drawn for an employee, and functions/onboarding.js setStaffCard
// refuses them as well, because hiding a control is courtesy, never security (P2).
//
// ⚠️⚠️ IT SAYS, EVERY TIME, THAT THE PERSON LOOKING STILL SEES EVERYTHING. A manager who
// hides Pastries and goes back to a Home that still shows Pastries would reasonably
// conclude the switch is broken. The sentence is beside the switches, not in a help page.
//
// ⚠️ A TAP SAVES AT ONCE, like the ingredient-card switches in js/orders/registry-
// settings.js: nothing is lost by getting it wrong, and one more tap undoes it. The
// one exception asks first — hiding the Catalogue — because the allergen sheet behind
// it is what counter staff use to answer a customer, and that is worth a sentence.

import { el } from './dom.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { setStaffCard } from './firebase-staff.js';
import { t } from '../i18n.js';
import { sectionsFor } from '../sections.js';
import { STAFF_CARDS, isHiddenForStaff } from '../home-cards.js';

const BACK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// ⚠️ WHAT HAS BEEN SWITCHED SINCE THIS PAGE LOADED. The session's copy of the location
// document is read once, when the venue opens, and does not follow a write made
// afterwards — so without this, closing and reopening the screen would show every
// switch back where it started. Module level, so it outlives one opening of the screen.
// Same problem, same answer, as `override` in js/orders/firebase-features.js.
const override = {};

function hiddenNow(location, cardId) {
  return Object.prototype.hasOwnProperty.call(override, cardId)
    ? override[cardId]
    : isHiddenForStaff(location, cardId);
}

export function openHomeCards(session) {
  const list = el('div', { class: 'people-list' });
  const status = el('p', { class: 'people-note', role: 'status' });

  // ⚠️ ONLY THE CARDS THIS VENUE HAS, AS AN EMPLOYEE WOULD HAVE THEM. A switch for a
  // section the venue does not use would promise a card nobody can ever be shown.
  const staffSections = sectionsFor(session.location, 'staff');
  const available = STAFF_CARDS.filter(card => staffSections[card.section] === true);

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

  function close() { overlay.remove(); }

  function paint() {
    list.textContent = '';
    if (!available.length) {
      list.appendChild(el('div', { class: 'people-row' }, [
        el('p', { class: 'people-note', text: t('homeCards.none') }),
      ]));
      return;
    }
    for (const card of available) {
      const shown = !hiddenNow(session.location, card.id);
      const nameId = `home-cards-name-${card.id}`;
      const pillId = `home-cards-pill-${card.id}`;
      // ⚠️ A SWITCH, READ AS ONE. The pill's word says the state; its accessible name
      // is the card AND that word, so a screen reader hears «Pastries, Visible, switch,
      // on» rather than a bare «Visible» with no idea which card it belongs to.
      list.appendChild(el('div', { class: 'people-row' }, [
        el('div', { class: 'people-row-main' }, [
          el('span', { class: 'people-name', id: nameId, text: t(card.labelKey) }),
        ]),
        el('div', { class: 'people-row-actions' }, [
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
  }

  async function toggle(card, shown) {
    const hide = shown;
    // ⚠️ THE LIST IS REBUILT AFTER EVERY SAVE, so the button that had the focus no
    // longer exists. Without putting it back, somebody on a keyboard or a screen
    // reader is thrown to the top of the page after every single switch.
    const pillId = `home-cards-pill-${card.id}`;
    const hadFocus = document.activeElement?.id === pillId;
    // ⚠️ EVERY HIDE ASKS FIRST; SHOWING NEVER DOES. Federico, 13 Sep 2026: «tutte le
    // impostazioni quando le vuoi nascondere devono chiedere conferma». Hiding takes the
    // card off the employees' Home, out of their address bar and out of their
    // notifications, so the dialog says all three that apply. The Catalogue adds why it
    // matters most: the allergen sheet is behind it.
    if (hide) {
      const lines = [t('homeCards.hide.body')];
      if (card.id === 'catalogue') lines.push(t('homeCards.catalogue.body'));
      if (card.employeePush) lines.push(t('homeCards.hide.push'));
      const ok = await confirmDialog({
        title: t('homeCards.hide.title', { card: t(card.labelKey) }),
        message: lines.join('\n\n'),
        okLabel: t('homeCards.hide.ok'),
        cancelLabel: t('ui.cancel'),
        danger: true,
      });
      if (!ok) return;
    }
    status.textContent = t('homeCards.saving');
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
    // Repainted from what is stored either way — a failed save puts the switch back.
    paint();
    if (hadFocus) list.querySelector(`#${pillId}`)?.focus();
  }

  paint();
  document.body.appendChild(overlay);
  return { close };
}
