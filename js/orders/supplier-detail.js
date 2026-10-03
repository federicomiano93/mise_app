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
    el('h1', { text: supplierLabel(supplier), tabindex: '-1' }),
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

  // A polite live region on this screen: the result of the day buttons is spoken, not only
  // drawn (the button may disappear with the line). Declared BEFORE the overlay that holds it:
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

  // The «Order for <day>» line at the top of the body (see buildDayLine). Repaint rebuilds
  // the body, so the live one is kept here for refreshDay() to find.
  let dayLine = null;

  function repaint(next) {
    const { ingredients, entries, suggest, hooks } = next;
    body.replaceChildren();

    // ⚠️ BUILT ALWAYS, HIDDEN WHEN THERE IS NOTHING TO SAY — same trap as the clear
    // button below: this function runs on a snapshot, not a keystroke, so a line that
    // only existed when needed could not appear as the first quantity creates a stamp.
    dayLine = buildDayLine(next.dayInfo);
    body.appendChild(dayLine.node);

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
    focusTitle: () => titleWrap.querySelector('h1')?.focus({ preventScroll: true }),
  };
}

// The line above the ingredient list: which day these quantities are for, and one
// button to change it.
// info: () => ({ text, buttonLabel, onClick }) | null, supplied by orders-main (which
// owns the draft and the language of the day words). Asked again on every refresh.
function buildDayLine(info) {
  const text = el('span', { class: 'supplier-day-text' });
  const button = el('button', { type: 'button', class: 'supplier-day-btn' });
  let action = null;
  button.addEventListener('click', () => action?.());
  const node = el('div', { class: 'supplier-day-line' }, [text, button]);

  function refresh() {
    const now = typeof info === 'function' ? info() : null;
    node.hidden = !now;
    action = now ? now.onClick : null;
    text.textContent = now ? now.text : '';
    button.textContent = now ? now.buttonLabel : '';
    // The visible words alone («For today») would not say what they change.
    if (now) button.setAttribute('aria-label', `${now.text}: ${now.buttonLabel}`);
    else button.removeAttribute('aria-label');
    return Boolean(now);
  }
  refresh();
  return { node, refresh };
}
