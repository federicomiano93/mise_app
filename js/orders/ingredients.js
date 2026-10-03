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
import { wholeNumber, sortByLabel, ingredientDisplayLabel } from './archive.js';
import { ingredientDisplayName } from '../ingredient-name.js';
import { unitChoices, entryUnit, storedUnitFor, sameUnit, isDefaultUnit } from '../order-unit.js';

// How many of a supplier's ingredients already have a quantity entered — used to
// paint the progress bar correctly on first render (before any typing), so a
// supplier is never stuck on a placeholder. refreshSupplierDerived (suppliers.js)
// keeps it in sync as the operator types.
//
// ⚠️ A row ordered ELSEWHERE this time (`elsewhereId`, see orders-main.js screenRowsFor) is
// not counted: its quantity belongs to another supplier's order.
function countFilled(ingredients, entries) {
  return ingredients.filter(i => !i.elsewhereId && (entries[i.id]?.qty || 0) > 0).length;
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

const MINUS_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/></svg>';
const PLUS_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';

// A row with a quantity shows its «clear» button (orders.css keys off this class) and can
// step down with «−». One helper, used by the row itself AND by orders-main when a value
// arrives from another phone, so neither button can be out of step with the box beside it.
export function markFilled(row, qty) {
  const filled = (Number(qty) || 0) > 0;
  row?.classList.toggle('ing-row--filled', filled);
  const minus = row?.querySelector('.ing-step-minus');
  if (minus) minus.disabled = !filled;
}

// The option a line's unit selects: the one spelled like it, whatever its capitals
// («Busta» stored, «busta» on the card), else the unit itself.
function optionFor(select, unit) {
  const same = [...select.options].find(o => sameUnit(o.value, unit));
  return same ? same.value : unit;
}

// Show a draft entry's unit in a row's unit menu, if it has one. Called when the draft
// arrives from another phone: without it this phone would keep showing — and pricing —
// the old unit. It skips the menu being used right now, exactly as the number boxes are
// skipped, so nothing jumps under a finger.
export function paintUnitSelect(row, ing, entry) {
  const select = row?.querySelector('.ing-unit-select');
  if (!select || !ing || select === document.activeElement) return;
  const unit = entryUnit(entry, ing);
  if (![...select.options].some(o => sameUnit(o.value, unit))) {
    select.appendChild(el('option', { value: unit, text: unit }));
  }
  select.value = optionFor(select, unit);
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

  const total = ingredients.filter(i => !i.elsewhereId).length;
  const filled = countFilled(ingredients, entries);

  const fill = el('div', { class: 'progress-fill', id: `progress-fill-${supplier.id}`,
    style: { width: `${total ? Math.round((filled / total) * 100) : 0}%` } });
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
    'aria-label': t('orders.stockOnHandFor', { name: ingredientDisplayName(ing) }),
  });
  const qtyInput = el('input', {
    type: 'number', class: 'ing-qty', min: '0', inputmode: 'numeric',
    'aria-label': t('orders.qtyToOrderFor', { name: ingredientDisplayName(ing) }),
  });
  const hint = el('div', { class: 'ing-suggestion' });

  // ⚠️ WHOSE ORDER THIS LINE IS IN («Ordina da un altro fornitore», line-supplier.js). One
  // ingredient is in ONE order at a time, so a quantity typed on a row settles it:
  //   * a row SENT HERE from another supplier (`usualSupplierId`) keeps the line in this
  //     supplier's order while it has a quantity, and lets it go back at zero;
  //   * a row of THIS supplier's that is ordered elsewhere this time (`away`) shows an
  //     empty box; typing a quantity takes the line back (override cleared, same write);
  //   * any other row never carries an override — a stale one is cleared on the way.
  // The key is sent as '' (never left behind) by changedEntries when it goes.
  let away = ing.elsewhereId || '';
  const note = el('div', { class: 'ing-line-note' });
  function paintNote() {
    const text = away
      ? t('orders.line.thisTimeFrom', { supplier: ing.elsewhereLabel || '' })
      : ing.usualSupplierId ? t('orders.line.usuallyFrom', { supplier: ing.usualLabel || '' }) : '';
    note.textContent = text;
    note.hidden = !text;
  }
  function claimLine(entry, qty) {
    if (ing.usualSupplierId) entry.supplierId = qty > 0 ? supplier.id : '';
    else if (entry.supplierId) entry.supplierId = '';
    if (away) {
      away = '';
      delete row.dataset.elsewhere;
      paintNote();
    }
  }

  function setQty(value, fromInput) {
    const qty = wholeNumber(value);
    const entry = entryFor(entries, ing.id);
    entry.qty = qty;
    claimLine(entry, qty);
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
    // Nothing to suggest for a row whose line is in another supplier's order.
    if (away) {
      hint.textContent = '';
      hint.className = 'ing-suggestion';
      return { active: false };
    }
    // ⚠️ NO HINT, AND NO AUTO-FILL, FOR A LINE IN ANOTHER UNIT THAN THE CARD'S. The history
    // the suggestion is worked out from counts the card's unit, so «Suggested: 4» under a
    // line of buste — or 4 typed into it from the stock box — would be a number of the
    // wrong thing. Returning an inactive result stops both (the stock handler fills only
    // on an active one); switching back to the card's unit brings them back.
    if (!isDefaultUnit(entryFor(entries, ing.id), ing)) {
      hint.textContent = '';
      hint.className = 'ing-suggestion';
      return { active: false };
    }
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
    // ⚠️ stockOnly: counting stock says nothing about WHICH order the rows are for, so it must
    // never move the supplier's day stamp (orders-main afterChange).
    else hooks.afterChange(supplier.id, { stockOnly: true });   // still autosave the stock value
    updateHint();                                  // the auto-filled qty may itself be worth a word
  });
  qtyInput.addEventListener('input', () => {
    setQty(qtyInput.value, true);
    updateHint();   // the warning has to appear as the extra digit is typed
  });

  // «−» and «+» under the Order box (owner, 3 Oct 2026). They start from what the BOX shows
  // and go through setQty, the one path typing uses, so autosave, the filled state, the ×,
  // the totals and the «much more than usual» line all follow. Reading the box (not the
  // draft) is what makes a row ordered elsewhere behave like typing into its empty box:
  // «+» gives 1 and takes the line back. Never below 0; 0 shows an empty box.
  function step(delta) {
    setQty(wholeNumber(qtyInput.value) + delta);
    updateHint();
  }
  const stepLabel = ingredientDisplayLabel(ing) || t('orders.unnamedProduct');
  const stepButton = (cls, key, icon, delta) => el('button', {
    type: 'button', class: `ing-step ${cls}`, icon,
    'aria-label': t(key, { name: stepLabel }),
    onClick: () => step(delta),
  });

  // ⚠️ A MENU ONLY WHEN THE CARD OFFERS A CHOICE («cartone» or «busta»); any other row keeps
  // the caption and is untouched. The options are the card's own words — venue data, never
  // translated. The quantity is kept when the unit changes: the person is correcting the
  // unit, not the number. Read at build time, so the list is always the card as it is now.
  const choices = unitChoices(ing, entry.unit);
  const unitSelect = choices.length >= 2
    ? el('select', {
      class: 'ing-unit-select',
      'aria-label': t('orders.unitToOrderFor', { name: ingredientDisplayLabel(ing) || t('orders.unnamedProduct') }),
    }, choices.map(unit => el('option', { value: unit, text: unit })))
    : null;
  if (unitSelect) {
    unitSelect.value = optionFor(unitSelect, entryUnit(entry, ing));
    unitSelect.addEventListener('change', () => {
      entryFor(entries, ing.id).unit = storedUnitFor(unitSelect.value, ing);
      hooks.afterChange(supplier.id);
      updateHint();
    });
  }

  // ⚠️ THE NAME IS A BUTTON ONLY FOR WHOEVER MAY EDIT INGREDIENTS (Federico, 1 Oct 2026: the
  // card «Modifica ingrediente» one tap from the order, instead of going back to «Fornitori e
  // ingredienti»). Everybody else keeps plain text — a control that opens a card the person may
  // not use teaches them the app is broken. The question is put to the caller on EVERY build,
  // and rows are rebuilt on every snapshot, so it follows the owner's switch live.
  // It is a real <button> (keyboard, focus ring, an accessible name that says what it does) drawn
  // to look exactly like the span it replaces (.ing-name-btn, orders.css): the row must not move.
  // The quantity / stock boxes and the × button are SIBLINGS of it, never inside it.
  const editable = typeof hooks.onEditIngredient === 'function' && hooks.mayEditIngredient?.() === true;
  const nameNode = editable
    ? el('button', {
      type: 'button', class: 'ing-name ing-name-btn', text: ingredientDisplayName(ing),
      'aria-label': t('orders.editIngredientFor', { name: ingredientDisplayLabel(ing) || t('orders.unnamedProduct') }),
      onClick: () => hooks.onEditIngredient(ing),
    })
    : el('span', { class: 'ing-name', text: ingredientDisplayName(ing) });

  // One LINE per ingredient, three columns: the name (with the supplier and the hint
  // under it), the Order box, the Stock box. «Order» / «Stock» are named ONCE, by the
  // sticky header (buildIngredientHeader), not under every box — each input keeps its
  // own aria-label, which already names the ingredient.
  // `ing-row--line` is the hook orders.css scopes every one of these rules to:
  // `.ing-row` alone is also the Calculator's, and both stylesheets load on both pages.
  row = el('div', { class: 'ing-row ing-row--line', dataset: { ing: ing.id } }, [
    el('div', { class: 'ing-main' }, [
      el('div', { class: 'ing-top' }, [
        nameNode,
      ]),
      // The pack weight on a small line of its own (29 Sep 2026): beside the name it pushed
      // «Marmellata di albicocche 1kg» onto four lines in the 86px a 296px phone leaves.
      ing.weight ? el('div', { class: 'ing-weight', text: ing.weight }) : null,
      // Its own block, not a second child of .ing-top: that is a baseline-aligned flex
      // row, so the supplier would sit BESIDE the name instead of under it.
      meta ? el('div', { class: 'ing-supplier', text: meta }) : null,
      note,
      hint,
      // In the name column on purpose: it holds nothing tappable, so a 44px target here
      // steals no tap from the Order / Stock boxes. Shown only while there is a quantity.
      el('button', {
        type: 'button', class: 'ing-qty-clear', icon: CLEAR_ICON,
        // Name AND weight: «Flour 1kg» and «Flour 25kg» must not both read «clear Flour».
        'aria-label': t('orders.clearQtyFor', { name: ingredientDisplayLabel(ing) || t('orders.unnamedProduct') }),
        onClick: (event) => {
          // A cleared line starts again in the card's own unit (the default), exactly as
          // «Clear quantities» does — the unit goes first so the one autosave carries both.
          const cleared = entryFor(entries, ing.id);
          cleared.unit = '';
          paintUnitSelect(row, ing, cleared);
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
      el('div', { class: 'ing-steps' }, [
        stepButton('ing-step-minus', 'orders.qtyOneFewerFor', MINUS_ICON, -1),
        stepButton('ing-step-plus', 'orders.qtyOneMoreFor', PLUS_ICON, 1),
      ]),
      !unitSelect && ing.unit ? el('span', { class: 'ing-order-unit', text: ing.unit }) : null,
    ]),
    // `stock-field` is what body.hide-stock hides (Settings → hide stock).
    el('div', { class: 'ing-col stock-field' }, [stockInput]),
    unitSelect,
  ]);
  if (unitSelect) row.classList.add('ing-row--choice');
  if (away) row.dataset.elsewhere = away;
  paintNote();

  stockInput.value = entry.stock || '';
  // A row ordered elsewhere this time shows an EMPTY box: that number is the other order's.
  qtyInput.value = away ? '' : entry.qty || '';
  markFilled(row, away ? 0 : entry.qty);
  updateHint(); // show suggestion without overwriting a restored quantity
  return row;
}
