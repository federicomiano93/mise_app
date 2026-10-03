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
// header is the app's one pattern: Back left, the title centred, «+ Add ingredient» in
// the slot on the right (an empty-looking slot when hidden, so the three-track grid keeps
// the title centred either way).

import { t } from '../i18n.js';
import { supplierLabel } from '../supplier-label.js';
import { el } from './dom.js';
import { buildIngredientList } from './ingredients.js';

const BACK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
const CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
const PLUS_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';

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

  // ⚠️ «+ ADD INGREDIENT» LIVES IN THE HEADER, on the right (Federico, 1 Oct 2026): it used
  // to be a dashed button at the top of the body and scrolled away on a long list. The
  // header is never rebuilt by repaint, so this one button is built once and only shown,
  // hidden or re-pointed there. Also for a supplier with no ingredients yet, which is
  // exactly when it is needed. The card it opens has THIS supplier preset (orders-main.js
  // openAddIngredient). Hidden — not disabled — when orders-main hands in no
  // `onAddIngredient`: it leaves it out where the owner has hidden «Suppliers &
  // ingredients» from this person (records.js mayEditRecords) — a display switch, like the
  // Catalogue's; the rules decide the save either way.
  let addIngredient = null;
  const addBtn = el('button', {
    type: 'button', class: 'app-icon-btn orders-icon-btn',
    'aria-label': t('orders.addIngredientToListAria', { supplier: supplierLabel(supplier) }),
    title: t('orders.addIngredientToList'),
    icon: PLUS_SVG, onClick: () => addIngredient?.(),
  });

  // A polite live region on this screen: the result of the day select is spoken, not only
  // drawn. Declared BEFORE the overlay that holds it:
  // used earlier, it was a TDZ crash and the supplier screen would not open at all.
  const live = el('p', { class: 'supplier-day-live', role: 'status', 'aria-live': 'polite' });

  const overlay = el('div', { class: 'supplier-detail' }, [
    el('header', { class: 'app-header orders-header' }, [
      el('span', { class: 'app-header-slot' }, [
        el('button', {
          type: 'button', class: 'app-icon-btn orders-icon-btn', 'aria-label': t('ui.back'),
          icon: BACK_ICON, onClick: () => ctx.onBack?.(),
        }),
      ]),
      titleWrap,
      el('span', { class: 'app-header-slot' }, [addBtn]),
    ]),
    body,
    live,
  ]);

  // The «Order: …» line at the top of the body (see buildDayLine). Repaint rebuilds
  // the body, so the live one is kept here for refreshDay() to find.
  let dayLine = null;

  function repaint(next) {
    const { ingredients, entries, suggest, hooks } = next;
    // A snapshot rebuilds the body, and the select the person is using with it: give the
    // new one the focus back, or a screen reader loses its place mid-choice.
    const hadFocus = Boolean(dayLine) && globalThis.document?.activeElement === dayLine.select;
    body.replaceChildren();

    // ⚠️ BUILT ALWAYS, HIDDEN WHEN THERE IS ONLY ONE ANSWER TO GIVE — same trap as the clear
    // button below: this function runs on a snapshot, not a keystroke, so a line that
    // only existed when needed could not appear as the first quantity creates a stamp.
    dayLine = buildDayLine(next.dayInfo, supplier.id);
    body.appendChild(dayLine.node);
    if (hadFocus) dayLine.select.focus({ preventScroll: true });

    const canAdd = typeof next.onAddIngredient === 'function';
    addIngredient = canAdd ? () => next.onAddIngredient() : null;
    addBtn.hidden = !canAdd;

    body.appendChild(buildIngredientList(supplier, ingredients, suggest, entries, hooks, {
      // «add the first one with the button above» only when there IS a button above.
      emptyKey: canAdd ? 'orders.noIngredientsYetAddAbove' : 'orders.noIngredientsYetAdd',
    }));

    // No products, nothing to record — the empty state inside the list already says so.
    if (!ingredients.length) return;

    // A row ordered elsewhere this time (`elsewhereId`) is not this supplier's line.
    const { filled } = ingredients.reduce((acc, i) => (
      !i.elsewhereId && (entries[i.id]?.qty || 0) > 0 ? { filled: acc.filled + 1 } : acc), { filled: 0 });

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
  // refreshDay: re-read the day line in place, for the keystroke path (afterChange).
  return {
    overlay,
    repaint,
    // true while the line is showing, false once hidden, undefined with no line built
    refreshDay: () => dayLine?.refresh(),
    announce: text => { live.textContent = text; },
  };
}

// The line above the ingredient list: «Order: [Today | Next order (Thu 8)]» and, under it,
// «Expected delivery: <day>». A native <select>, so the phone's own picker and screen
// reader support come free; its accessible name is the visible label.
// info: () => ({ label, options: [{value, label}], selected, deliveryText, onChange(value) })
// | null when there is only one answer to give, supplied by orders-main (which owns the draft
// and the language of the day words).
// Asked again on every refresh, so the select always shows the CURRENT stamp.
//
// Why a select and not a sentence plus a button: «Ordine per lunedì» + «Per oggi» read as
// «this order is for today» (owner, 3 Oct 2026). Both answers are always visible now.
function buildDayLine(info, supplierId) {
  const selectId = `supplier-day-select-${supplierId}`;
  const label = el('label', { class: 'supplier-day-label', for: selectId });
  const select = el('select', { class: 'supplier-day-select', id: selectId });
  const delivery = el('p', { class: 'supplier-day-delivery' });
  let change = null;
  let shown = '';
  select.addEventListener('change', event => change?.(event.target.value));
  const node = el('div', { class: 'supplier-day-line' }, [
    el('div', { class: 'supplier-day-row' }, [label, select]),
    delivery,
  ]);

  function refresh() {
    const now = typeof info === 'function' ? info() : null;
    node.hidden = !now;
    change = now ? now.onChange : null;
    if (!now) return false;
    label.textContent = now.label;
    // Rebuild the options only when their words changed, so a refresh does not reset the
    // list under a finger.
    const key = now.options.map(o => `${o.value}:${o.label}`).join('|');
    if (key !== shown) {
      shown = key;
      select.replaceChildren(...now.options.map(o => el('option', { value: o.value, text: o.label })));
    }
    select.value = now.selected;
    delivery.textContent = now.deliveryText || '';
    delivery.hidden = !now.deliveryText;
    return true;
  }
  refresh();
  return { node, select, refresh };
}
