// ingredients.js — builds the ingredient list for one supplier.
//
// Minimal, chef-first: each row shows the ingredient name + unit and two plain
// number inputs side by side — STOCK ON HAND (entered first) and the ORDER
// quantity. Entering stock auto-fills the suggested order quantity from history
// (Phase 5) — the operator can always override it. When enough history exists a
// small line shows the suggestion; otherwise nothing (no countdown noise).
//
// State lives in the shared `entries` object ({ [id]: { qty, stock } }).
// `suggest(ingredientId, stock)` returns the suggestion engine result.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { isUnusualQuantity } from './suggestions.js';
import { wholeNumber, sortByLabel, ingredientLabel } from './archive.js';

// How many of a supplier's ingredients already have a quantity entered — used to
// paint the progress bar correctly on first render (before any typing), so a
// supplier is never stuck on a placeholder. refreshSupplierDerived (suppliers.js)
// keeps it in sync as the operator types.
function countFilled(ingredients, entries) {
  return ingredients.filter(i => (entries[i.id]?.qty || 0) > 0).length;
}

// The row's slice of the shared draft, re-created if it is gone.
//
// It CAN be gone while the row is still on screen: archiving a supplier deletes
// its keys out of `entries`, and so does the same clear arriving from another
// phone — neither rebuilds the rows (they only reset the input values, so the
// operator never loses focus mid-typing). Reaching straight for entries[id].qty
// in a keystroke handler would then throw on a live screen. Always go through
// this.
function entryFor(entries, id) {
  return entries[id] || (entries[id] = { qty: 0, stock: 0 });
}

const CLEAR_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>';

// A row with a quantity shows its «clear» button (orders.css keys off this class). One
// helper, used by the row itself AND by orders-main when a value arrives from another
// phone, so the button can never be out of step with the box beside it.
export function markFilled(row, qty) {
  row?.classList.toggle('ing-row--filled', (Number(qty) || 0) > 0);
}

export function buildIngredientList(supplier, ingredients, suggest, entries, hooks,
  { emptyKey = 'orders.noIngredientsYetAddAbove' } = {}) {
  // A supplier with no ingredients shows a clear empty state, not a progress bar
  // stuck at 0 of 0 (the old "Loading…" bug: nothing ever replaced the placeholder).
  if (!ingredients.length) {
    return el('div', { class: 'ingredient-list' }, [
      el('p', { class: 'ing-empty', text: t(emptyKey) }),
    ]);
  }

  const total = ingredients.length;
  const filled = countFilled(ingredients, entries);

  const fill = el('div', { class: 'progress-fill', id: `progress-fill-${supplier.id}`,
    style: { width: `${Math.round((filled / total) * 100)}%` } });
  // The bar stays (a quick "how full is this order" cue); the "X of Y filled" text
  // was removed — the bar already says it.
  const progress = el('div', { class: 'progress' }, [
    el('div', { class: 'progress-track' }, [fill]),
  ]);

  const body = el('div', { class: 'ingredient-list' }, [progress, buildIngredientHeader()]);

  // ⚠️ ONE FLAT LIST, A→Z BY NAME AND WEIGHT, NO CATEGORY HEADINGS (the owner asked for it,
  // 30 Sep 2026: at the counter he looks a product up by its name, not by the shelf it
  // lives on). It is the same order as the read-only supplier-items screen (both go through
  // sortByLabel) and as the message sent to the supplier (order-text.js sortItems): all of
  // them compare labels with the one numeric collator, compareLabels.
  sortByLabel(ingredients)
    .forEach(ing => body.appendChild(buildRow(ing, supplier, suggest, entries, hooks)));

  return body;
}

// The line that names the two columns, once, at the top of a list. Sticky (orders.css),
// so it stays in sight while the rows scroll under it. The language is read HERE, inside
// the function, never at module load (no venue is open then).
export function buildIngredientHeader() {
  return el('div', { class: 'ing-head', 'aria-hidden': 'true' }, [
    el('span'),
    el('span', { class: 'ing-head-col', text: t('orders.field.order') }),
    el('span', { class: 'ing-head-col ing-head-stock', text: t('orders.field.stock') }),
  ]);
}

// One ingredient row. Exported because the flat "All ingredients" view builds the
// very same row — one row implementation, so a fix to the stock/order behaviour can
// never land in one view and not the other.
//
// `meta` is the line under the name (the supplier, in the flat list). It is left out
// entirely in the by-supplier view: the card heading already says whose it is.
export function buildRow(ing, supplier, suggest, entries, hooks, { meta = '' } = {}) {
  const entry = entryFor(entries, ing.id);
  let row;

  const stockInput = el('input', {
    type: 'number', class: 'ing-stock', min: '0', inputmode: 'numeric',
    'aria-label': t('orders.stockOnHandFor', { name: ing.name }),
  });
  const qtyInput = el('input', {
    type: 'number', class: 'ing-qty', min: '0', inputmode: 'numeric',
    'aria-label': t('orders.qtyToOrderFor', { name: ing.name }),
  });
  const hint = el('div', { class: 'ing-suggestion' });

  function setQty(value, fromInput) {
    const qty = wholeNumber(value);
    entryFor(entries, ing.id).qty = qty;
    if (!fromInput) qtyInput.value = qty || '';
    markFilled(row, qty);
    hooks.afterChange(supplier.id);
  }

  // Show the "Suggested: X" hint only when history has produced an active
  // suggestion; otherwise leave the line empty (no "available in N orders" noise).
  //
  // The one thing that outranks the suggestion on that line is a quantity that looks
  // like a typing mistake (300 for 30). It takes the line over rather than adding a
  // second one: the row is 273px on a 320px phone and has no space for another, and
  // "Suggested: 8" sitting beside "much more than usual" would be saying the same
  // thing twice anyway.
  function updateHint() {
    const result = suggest(ing.id, entryFor(entries, ing.id).stock || 0);
    const qty = entryFor(entries, ing.id).qty || 0;

    if (result.active && isUnusualQuantity(qty, result.par)) {
      hint.textContent = t('orders.muchMoreThanUsual', { n: result.par });
      hint.className = 'ing-suggestion warn';
    } else if (result.active) {
      hint.textContent = t('orders.suggestedN', { n: result.suggestion });
      hint.className = 'ing-suggestion active';
    } else {
      hint.textContent = '';
      hint.className = 'ing-suggestion';
    }
    return result;
  }

  stockInput.addEventListener('input', () => {
    entryFor(entries, ing.id).stock = wholeNumber(stockInput.value);
    const result = updateHint();
    if (result.active) setQty(result.suggestion); // auto-fill the suggested order (also autosaves)
    else hooks.afterChange(supplier.id);           // still autosave the stock value
    updateHint();                                  // the auto-filled qty may itself be worth a word
  });
  qtyInput.addEventListener('input', () => {
    setQty(qtyInput.value, true);
    updateHint();   // the warning has to appear as the extra digit is typed
  });


  // One LINE per ingredient, three columns: the name (with the supplier and the hint
  // under it), the Order box, the Stock box. «Order» / «Stock» are named ONCE, by the
  // sticky header (buildIngredientHeader), not under every box — each input keeps its
  // own aria-label, which already names the ingredient.
  // `ing-row--line` is the hook orders.css scopes every one of these rules to:
  // `.ing-row` alone is also the Calculator's, and both stylesheets load on both pages.
  row = el('div', { class: 'ing-row ing-row--line', dataset: { ing: ing.id } }, [
    el('div', { class: 'ing-main' }, [
      el('div', { class: 'ing-top' }, [
        el('span', { class: 'ing-name', text: ing.name || '' }),
      ]),
      // The pack weight on a small line of its own (29 Sep 2026): beside the name it pushed
      // «Marmellata di albicocche 1kg» onto four lines in the 86px a 296px phone leaves.
      ing.weight ? el('div', { class: 'ing-weight', text: ing.weight }) : null,
      // Its own block, not a second child of .ing-top: that is a baseline-aligned flex
      // row, so the supplier would sit BESIDE the name instead of under it.
      meta ? el('div', { class: 'ing-supplier', text: meta }) : null,
      hint,
      // In the name column on purpose: it holds nothing tappable, so a 44px target here
      // steals no tap from the Order / Stock boxes. Shown only while there is a quantity.
      el('button', {
        type: 'button', class: 'ing-qty-clear', icon: CLEAR_ICON,
        // Name AND weight: «Flour 1kg» and «Flour 25kg» must not both read «clear Flour».
        'aria-label': t('orders.clearQtyFor', { name: ingredientLabel(ing) || t('orders.unnamedProduct') }),
        onClick: (event) => {
          setQty(0);
          updateHint();
          // Only a keyboard activation goes back to the box: after a tap the phone's
          // on-screen keyboard would pop up over the list for no reason.
          if (event.detail === 0) qtyInput.focus();
        },
      }),
    ]),
    el('div', { class: 'ing-col' }, [
      qtyInput,
      ing.unit ? el('span', { class: 'ing-order-unit', text: ing.unit }) : null,
    ]),
    // `stock-field` is what body.hide-stock hides (Settings → hide stock).
    el('div', { class: 'ing-col stock-field' }, [stockInput]),
  ]);

  stockInput.value = entry.stock || '';
  qtyInput.value = entry.qty || '';
  markFilled(row, entry.qty);
  updateHint(); // show suggestion without overwriting a restored quantity
  return row;
}
