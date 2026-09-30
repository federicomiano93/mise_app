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
// A full-screen overlay on a phone AND on a tablet (30 Sep 2026: the tablet's
// two-pane split was removed — the owner wanted the same screen everywhere). The
// header is the app's one pattern: Back left, the title centred, an EMPTY slot
// on the right so the three-track grid keeps the title centred.

import { t } from '../i18n.js';
import { supplierLabel } from '../supplier-label.js';
import { el } from './dom.js';
import { buildIngredientList } from './ingredients.js';

const BACK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
const CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
const PLUS_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';

// ctx: { ingredients, entries, suggest, hooks, onBack, onAddIngredient }
// -> { overlay, repaint(ctx) }
//
// `repaint` rebuilds only the BODY, never the header — a live snapshot from another
// phone must not make the screen flicker or lose its title. Keystrokes never come
// through here at all: those reach the inputs via syncInputsFromState, which sets
// values without touching the DOM structure.
export function buildSupplierDetail(supplier, ctx) {
  const body = el('div', { class: 'supplier-detail-body' });

  const titleWrap = el('div', { class: 'app-header-title orders-header-title' }, [
    el('h1', { text: supplierLabel(supplier) }),
  ]);

  const overlay = el('div', { class: 'supplier-detail' }, [
    el('header', { class: 'app-header orders-header' }, [
      el('span', { class: 'app-header-slot' }, [
        el('button', {
          type: 'button', class: 'app-icon-btn orders-icon-btn', 'aria-label': t('ui.back'),
          icon: BACK_ICON, onClick: () => ctx.onBack?.(),
        }),
      ]),
      titleWrap,
      el('span', { class: 'app-header-slot' }),
    ]),
    body,
  ]);

  function repaint(next) {
    const { ingredients, entries, suggest, hooks } = next;
    body.replaceChildren();

    // ⚠️ FIRST — also for a supplier with no ingredients yet, which is exactly when it is
    // needed. It sits ABOVE the list card, outside `.ingredient-list`, so the sticky
    // Order/Stock header inside the list is untouched. The card it opens has THIS supplier
    // preset (orders-main.js openAddIngredient). Present only when orders-main hands in
    // `onAddIngredient`: it leaves it out where the owner has hidden «Suppliers &
    // ingredients» from this person (records.js mayEditRecords) — a display switch, like the
    // Catalogue's; the rules decide the save either way.
    const canAdd = typeof next.onAddIngredient === 'function';
    if (canAdd) {
      body.appendChild(el('button', {
        type: 'button',
        class: 'mgmt-add supplier-add-ing',
        'aria-label': t('orders.addIngredientToListAria', { supplier: supplierLabel(supplier) }),
        onClick: () => next.onAddIngredient(),
      }, [
        el('span', { class: 'supplier-add-ing-icon', icon: PLUS_SVG, 'aria-hidden': 'true' }),
        el('span', { text: t('orders.addIngredientToList') }),
      ]));
    }

    body.appendChild(buildIngredientList(supplier, ingredients, suggest, entries, hooks, {
      // «add the first one with the button above» only when there IS a button above.
      emptyKey: canAdd ? 'orders.noIngredientsYetAddAbove' : 'orders.noIngredientsYetAdd',
    }));

    // No products, nothing to record — the empty state inside the list already says so.
    if (!ingredients.length) return;

    const { filled } = ingredients.reduce((acc, i) => (
      (entries[i.id]?.qty || 0) > 0 ? { filled: acc.filled + 1 } : acc), { filled: 0 });

    // The money (totals box) is NOT built here: it is tablet-only and
    // permission-gated, so orders-main.js paints it onto this screen from the
    // outside (order-cost-view.js paintOrderMoney) — a phone never gets a node of it.

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
