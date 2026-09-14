// catalogue-editor.js — add / edit / delete a catalogue recipe.
//
// Clones the safe editing pattern from js/recipes.js: work on a COPY, explicit
// confirm-gated Save, required-field validation before saving (jump + highlight),
// low-key Delete with a confirm, discard protection for unsaved edits, and — under each
// ingredient name as it is typed — a short list of catalogue ingredients to link the row
// to (ingredient-suggest.js). Persists per document to recipes/{id} via the store (not
// into config).

import { t } from '../i18n.js';
import { canManageHere } from './firebase-catalogue.js';
import { el } from './dom.js';
import {
  findInvalidRecipe, unitOf, CATALOGUE_UNITS, isWeighableUnit, weighableTotalGrams,
  linkOf, applyLink, normalizeWeight, normalizeShelfLifeDays, moveRow,
} from './catalogue-model.js';
// Drag to reorder the rows — the library the Calculator's clients and the Home cards use,
// vendored into the repo and precached (P19).
import Sortable from '../vendor/sortable.esm.js';
import { openLinkPicker } from './ingredient-picker.js';
import { attachLinkSuggestions } from './ingredient-suggest.js';

// Whole grams, no thousands separator — the same reading as the recipe view.
const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0, useGrouping: false });

const TRASH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';

const CAMERA_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';

// `draft` is a recipe read from a photograph: not saved, not saveable without a
// person, and NOT an existing recipe.
//
// ⚠️ IT IS A THIRD ARGUMENT AND NOT A VALUE FOR `recipe`, ON PURPOSE. Passing it as
// `recipe` would work and then be wrong in four separate places: the screen would
// be titled "Edit recipe", the toast would say "saved" rather than "added", the
// Delete button would appear — and calling it would delete `undefined` — and
// line 1 below would read `.ingredients` off something that might not have any.
// Keeping `recipe` null is what makes all four correct without touching them.
export function renderEditor({ recipe, draft, allRecipes, app, getLabelProfile = () => ({}) }) {
  // Working copy — nothing touches the stored recipe until Save.
  // ⚠️ ...i, NOT a hand-listed set of fields. This copy and cleanWorking() below
  // both rebuild every row, so any field named in neither is dropped on save —
  // which is how opening a recipe to fix a typo would have wiped every ingredient
  // link it had. Spreading the row keeps whatever it carries; only the fields the
  // editor actually edits are overwritten.
  const working = recipe
    ? {
      ...recipe,
      ingredients: recipe.ingredients.map(i => ({ ...i, unit: unitOf(i) })),
    }
    : draft
      ? {
        id: null,
        name: typeof draft.name === 'string' ? draft.name : '',
        ingredients: (Array.isArray(draft.ingredients) && draft.ingredients.length
          ? draft.ingredients
          : [{ label: '', grams: '', unit: 'g' }]).map(i => ({ ...i, unit: unitOf(i) })),
        // ⚠️ NO OVEN LOSS HERE, AND THAT IS NOT AN OVERSIGHT. Since 13 Sep 2026 the dough
        // is weighed raw and cooked on a product's recipe line in Food cost, and the
        // catalogue store no longer writes the loss at all — a value carried on a draft
        // would be thrown away on Save while looking kept.
        // ⚠️ ABSENT RATHER THAN 0: a recipe nobody has given a net weight or a shelf
        // life must stay without them, because 0 days would print today's date as a
        // use-by.
        ...(normalizeWeight(draft.netWeightG) > 0 ? { netWeightG: normalizeWeight(draft.netWeightG) } : {}),
        ...(normalizeShelfLifeDays(draft.shelfLifeDays) !== null
          ? { shelfLifeDays: normalizeShelfLifeDays(draft.shelfLifeDays) } : {}),
      }
      : { id: null, name: '', ingredients: [{ label: '', grams: '', unit: 'g' }] };

  // ⚠️ A DRAFT STARTS DIRTY. It is unsaved work that somebody has already paid for
  // — leaving it with `dirty` false means Back walks away in silence and the read
  // is simply gone, with no question asked and nothing to show for it.
  let dirty = !!draft;
  let showErrors = false;
  let busy = false; // guards against re-entrant Save/Delete while a confirm is open
  const markDirty = () => { dirty = true; };

  const nameInput = el('input', {
    id: 'catRecipeName',
    class: 'cat-name-input', type: 'text', placeholder: t('cat.recipeName'), value: working.name,
    'aria-label': t('cat.recipeName'),
    oninput: (e) => { working.name = e.target.value; markDirty(); if (showErrors) validateUI(); },
  });

  // One ingredient = ONE row (name · amount · unit · remove), inside a single framed
  // list closed by a live Total — the same shape as the read-only recipe, so there is
  // one way to read a recipe, not two. It replaces a layout that gave each ingredient
  // two full-width boxes: 8 ingredients became 16 identical white cards with nothing
  // tying a name to its amount.
  const rowsContainer = el('div', { class: 'cat-ing-editrows' });
  const countEl = el('span', { class: 'cat-ing-count' });
  const totalEl = el('span', { class: 'cat-edit-total-num' });
  const totalNote = el('span', { class: 'cat-edit-total-note' });

  // ⚠️ THE TOTAL SITS IN THE SAME CELL SHAPE AS THE AMOUNTS ABOVE IT, frameless. The
  // row shares .cat-ing-editrow's grid, so once the amount and the unit moved into one
  // cell the total had to follow — otherwise «Totale 8380 g» stops lining up with the
  // column of numbers it is the sum of, which is the one thing it exists to do.
  const totalRow = el('div', { class: 'cat-ing-editrow cat-edit-total' }, [
    el('span', { class: 'cat-edit-total-label', text: t('cat.total') }),
    el('div', { class: 'cat-amount cat-amount--plain' }, [
      totalEl,
      el('span', { class: 'cat-edit-total-unit', text: 'g' }),
    ]),
  ]);

  // The weight the recipe actually adds up to, live as it is typed. Its absence is
  // what let a "Croissant (4 x 3500gr.)" quietly weigh 14153 g instead of 14000.
  // Pieces / to-taste rows carry no weight, so they are excluded — and said to be.
  function updateTotal() {
    totalEl.textContent = nf.format(weighableTotalGrams(working));
    const skipped = working.ingredients
      .filter(i => String(i.label || '').trim() && !isWeighableUnit(unitOf(i))).length;
    // ⚠ THE PLURAL IS THE DICTIONARY'S, NOT THIS FILE'S. It used to be
    // `skipped === 1 ? 'ingredient is' : 'ingredients are'` — English grammar written
    // into the code, which no translation can reach.
    totalNote.textContent = skipped ? t('cat.notWeighed', { n: skipped }) : '';
    totalNote.hidden = !skipped;
    countEl.textContent = String(working.ingredients.length);
    // Nothing to put in order with a single row.
    reorderBtn.hidden = working.ingredients.length < 2;
  }

  // ── Reordering the rows (13 Sep 2026) ───────────────────────────────────────
  //
  // Federico: «nella scheda ricetta dammi la possibilità di spostare l'ordine degli
  // ingredienti già compilati».
  // ⚠️ A MODE, NOT A GRIP ON EVERY ROW. At 296px a row already holds a name, an amount, a
  // unit and a bin; a fifth control would take its width from the NAME. While reordering,
  // each row is its grip, its name and its amount — nothing to type into, nothing to hit
  // by accident while a finger is dragging.
  // ⚠️ THE SAME ROW OBJECTS MOVE (moveRow), so a guided mixing step, which points at a row
  // by its `rid`, still points at the right ingredient afterwards.
  const GRIP_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
  let reordering = false;
  let sortable = null;

  function renderReorderRows() {
    working.ingredients.forEach((ing, idx) => {
      const name = String(ing.label || '').trim() || t('cat.unnamedRow');
      const unit = unitOf(ing);
      const qty = ing.grams === '' || ing.grams === undefined || unit === 'to taste' ? '' : String(ing.grams);
      rowsContainer.appendChild(el('div', { class: 'cat-ing-editgroup cat-reorder-row' }, [
        el('button', {
          type: 'button', class: 'home-cards-grip cat-reorder-grip', icon: GRIP_ICON,
          'aria-label': t('cat.moveRow', { name }), 'aria-describedby': 'catReorderHint',
          onkeydown: (event) => moveWithKeys(idx, event),
        }),
        el('span', { class: 'cat-reorder-name', text: name }),
        el('span', { class: 'cat-reorder-amount', text: [qty, unit].filter(Boolean).join(' ') }),
      ]));
    });
    // ⚠️ HOLD TO DRAG ON A PHONE (200ms), so scrolling the recipe with a thumb never moves
    // a row by accident — the rule the Home cards and the Calculator's clients follow.
    if (working.ingredients.length > 1) {
      sortable = Sortable.create(rowsContainer, {
        animation: 150,
        delay: 200,
        delayOnTouchOnly: true,
        draggable: '.cat-reorder-row',
        ghostClass: 'cat-sortable-ghost',
        chosenClass: 'cat-sortable-chosen',
        dragClass: 'cat-sortable-drag',
        onEnd: (evt) => moveTo(evt.oldDraggableIndex, evt.newDraggableIndex),
      });
    }
  }

  // Move a row in the WORKING COPY and redraw from it — the list on screen is always the
  // model's, never whatever the drag left behind.
  function moveTo(from, to, focusGrip = false) {
    if (from === undefined || to === undefined || from === to) return;
    working.ingredients = moveRow(working.ingredients, from, to);
    markDirty();
    renderIngredientRows();
    // The rows were rebuilt: put the focus back on the grip that moved (P18).
    if (focusGrip) rowsContainer.querySelectorAll('.cat-reorder-grip')[to]?.focus();
  }

  function moveWithKeys(idx, event) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const to = event.key === 'ArrowUp' ? idx - 1 : idx + 1;
    if (to < 0 || to >= working.ingredients.length) return;
    moveTo(idx, to, true);
  }

  function renderIngredientRows() {
    // ⚠️ THE OLD SORTABLE GOES FIRST: it holds the container, and a second instance on the
    // same rows would move each of them twice.
    sortable?.destroy();
    sortable = null;
    rowsContainer.replaceChildren();
    if (reordering) {
      renderReorderRows();
      updateTotal();
      return;
    }
    working.ingredients.forEach((ing, idx) => {
      const labelInput = el('input', {
        class: 'cat-lbl', type: 'text', placeholder: t('cat.ingredient'), value: ing.label,
        'aria-label': t('cat.ingredientName'),
        oninput: (e) => { ing.label = e.target.value; markDirty(); updateTotal(); if (showErrors) validateUI(); },
      });
      // Under the name, while it is typed: catalogue ingredients to link THIS row to.
      // ⚠️ A tap links the row and leaves the name exactly as typed (applyLink), then
      // moves on to the amount — the next thing a person fills in. ingredient-suggest.js.
      const suggest = attachLinkSuggestions(labelInput, {
        options: () => ({
          ingredients: app.ingredients(), recipes: app.allRecipes(), suppliers: app.suppliers(),
          excludeRecipeId: working.id,
        }),
        linked: () => linkOf(working.ingredients[idx]),
        onPick: (chosen) => { linkTo(idx, chosen); focusAmount(idx); },
        onSeeAll: (query) => pickFromChooser(idx, query),
      });
      const gramsInput = el('input', {
        class: 'cat-grm', type: 'number', min: '0', step: 'any', inputmode: 'decimal',
        placeholder: '0', value: ing.grams === '' || ing.grams === undefined ? '' : ing.grams,
        'aria-label': t('cat.amount'),
        oninput: (e) => { ing.grams = e.target.value; markDirty(); updateTotal(); },
      });
      // Per-ingredient unit (g by default). Reuses the model's whitelist so the
      // editor and the scaling/import logic can never drift apart.
      const unitSelect = el('select', {
        class: 'cat-unit', 'aria-label': t('cat.unit'),
        onchange: (e) => { ing.unit = e.target.value; paintAmount(); markDirty(); updateTotal(); },
      }, CATALOGUE_UNITS.map(u => el('option', { value: u }, u)));
      unitSelect.value = unitOf(ing);
      // ⚠️ THE CELL IS HELD IN A VARIABLE because its shape changes with the unit —
      // see paintAmount() below, built after the cell it paints.
      const amountCell = el('div', { class: 'cat-amount' }, [
        gramsInput,
        // ⚠️ THE CHEVRON IS A SIBLING OF THE SELECT INSIDE ITS OWN CELL, not a
        // child of it: a <select> renders only <option>s, so anything put inside is
        // silently dropped. The cell is what carries the frame and the position.
        el('span', { class: 'cat-unit-cell' }, [
          unitSelect,
          el('span', { class: 'cat-unit-chev', 'aria-hidden': 'true', text: '›' }),
        ]),
      ]);
      // ⚠️⚠️ «to taste» IS THE ONE UNIT THAT CARRIES NO NUMBER, and the model has said so
      // since it was written: scaleRecipe() returns null for that unit and for no other,
      // and the read-only recipe screen prints no amount beside it. Only this editor
      // still drew a «0» there — a number that means nothing, sitting in the box that
      // forces the unit beside it to be wide enough for the longest word in the list.
      // Federico, 24 Aug 2026: «la casella dei g può essere anche più piccola della
      // quantità, non serve che sia più grande addirittura». It could not be, while
      // «to taste» had to fit next to a number.
      //
      // ⚠️ THE STORED AMOUNT IS HIDDEN, NEVER CLEARED. Switching to «to taste» and back
      // to «g» has to give the number back, and nothing counts it meanwhile:
      // ingredientGrams() is 0 for every unit that is not weighable, so hiding it
      // cannot move a total, a cost or a label.
      function paintAmount() {
        const noQty = unitOf(ing) === 'to taste';
        gramsInput.hidden = noQty;
        amountCell.classList.toggle('cat-amount--noqty', noQty);
      }
      paintAmount();
      const delIcon = el('button', {
        class: 'cat-del-icon', type: 'button', 'aria-label': t('cat.removeIngredient'), icon: TRASH_SVG,
        onclick: () => {
          working.ingredients.splice(idx, 1);
          if (!working.ingredients.length) working.ingredients.push({ label: '', grams: '', unit: 'g' });
          markDirty();
          renderIngredientRows();
          if (showErrors) validateUI();
        },
      });
      // The link lives on its OWN line under the row, not as a fifth control in it.
      // At 296px the row already holds a name, an amount, a unit and a bin; a fifth
      // target takes its width from the ingredient NAME, which is the one thing that
      // has to stay readable. Under it there is room to say what it points at.
      rowsContainer.appendChild(el('div', { class: 'cat-ing-editgroup' }, [
        // ⚠️ TWO FRAMES, ONE ROW, and the width to do it was BOUGHT, not found.
        // Federico, 23 Aug: «lo spazio dove scrivere la quantità e la tipologia devono
        // essere ben distinte» — answered then with a single frame divided down the
        // middle, because two frames measured ~24px more and started truncating the
        // ingredient NAME at 320px. Looking at it again on 24 Aug: «separa la casella
        // della quantità con quella del tipo di gr o kg (fallo che si capisce che è un
        // menù a tendina)», and «fai in modo di farlo tutto in una riga».
        //
        // ⚠️⚠️ WHAT PAID FOR IT IS THE NATIVE ARROW. `appearance: none` on the select
        // gives back the ~16px Chromium reserves for its own dropdown arrow, and the
        // `›` we draw instead is both narrower and — the actual request — visible. The
        // measurement that refused two frames was taken WITH that arrow still there;
        // re-measuring in the wrong order is how the same decision gets re-litigated
        // with the wrong number.
        el('div', { class: 'cat-ing-editrow' }, [labelInput, amountCell, delIcon]),
        suggest.node,
        linkRow(ing, idx),
      ]));
    });
    rowsContainer.appendChild(totalRow);
    updateTotal();
  }

  // What this row points at — an ingredient in Orders, or another recipe — and the
  // button that changes it. A row with no link is not an error: it is how every
  // recipe in the catalogue reads today, and it stays perfectly usable. It just
  // cannot contribute a cost, and says so.
  function linkRow(ing, idx) {
    const link = linkOf(ing);
    const button = el('button', {
      class: 'cat-ing-link' + (link ? ' linked' : ''), type: 'button',
      onclick: () => pickFromChooser(idx),
    }, linkText(ing));
    return button;
  }

  // The full-screen chooser — already searching what was typed, when «See all» under a
  // row's suggestion list opened it.
  async function pickFromChooser(idx, initialQuery = '') {
    const chosen = await openLinkPicker({
      ingredients: app.ingredients(),
      recipes: app.allRecipes(),
      suppliers: app.suppliers(),
      excludeRecipeId: working.id,
      hasLink: !!linkOf(working.ingredients[idx]),
      initialQuery,
    });
    if (chosen === undefined) return;              // dismissed: change nothing
    linkTo(idx, chosen);
  }

  // Link row `idx` to what was chosen; null removes the link.
  // ⚠️ applyLink() IS THE ONE PLACE A ROW'S LINK IS WRITTEN, and it never overwrites a
  // name somebody typed: that wording is chosen for THIS recipe ("strong flour" for an
  // article filed as "Flour T55"), and Federico writes it himself on purpose.
  function linkTo(idx, chosen) {
    applyLink(working.ingredients[idx], chosen);
    markDirty();
    renderIngredientRows();
    if (showErrors) validateUI();
  }

  // After a link from the suggestion list, on to that row's amount. The rows were just
  // rebuilt, so the field is looked up afresh; a «to taste» row has no amount to go to.
  function focusAmount(idx) {
    const group = rowsContainer.querySelectorAll('.cat-ing-editgroup')[idx];
    const amount = group && group.querySelector('.cat-grm');
    if (!amount || amount.hidden) return;
    try { amount.focus(); } catch (e) { /* focus is best-effort */ }
  }

  // "→ Flour 0 · 25 kg · Supplier", or an invitation when there is no link.
  //
  // ⚠️ NO PRICE SINCE 13 SEP 2026. Federico: a recipe's cost on its own is not real — it
  // knows neither its oven loss nor what is added to the product later — so the
  // catalogue shows no money anywhere, and Food cost is where a cost is read. What still
  // catches a link to the wrong article is the pack weight and the supplier.
  function linkText(ing) {
    const link = linkOf(ing);
    if (!link) return t('cat.linkToAnIngredient');

    if (link.kind === 'recipe') {
      const sub = app.allRecipes().find(r => r.id === link.refId);
      // ⚠️ «recipe» used to be English written into the code, on an Italian venue too.
      return sub ? `→ ${sub.name}  ·  ${t('cat.recipe')}` : t('cat.aRecipeThatNo');
    }

    const ingredient = app.ingredients()[link.refId];
    if (!ingredient) return t('cat.anIngredientThatNo');
    const supplier = (app.suppliers()[ingredient.supplierId] || {}).name || '';
    const weight = String(ingredient.weight || '').trim();
    return ['→ ' + (ingredient.name || t('cat.ingredient')), weight, supplier]
      .filter(Boolean).join('  ·  ');
  }

  // Highlight the empty required fields (name, and every ingredient missing a label).
  function validateUI() {
    nameInput.classList.toggle('cat-invalid', showErrors && !String(working.name || '').trim());
    const labelInputs = rowsContainer.querySelectorAll('.cat-lbl');
    working.ingredients.forEach((ing, i) => {
      if (labelInputs[i]) {
        labelInputs[i].classList.toggle('cat-invalid', showErrors && !String(ing.label || '').trim());
      }
    });
  }

  // Trim labels, coerce grams to non-negative numbers, drop rows with no name.
  // Spreads each row first (see `working` above) so an ingredient link survives a
  // save; only the three fields this editor owns are rewritten.
  function cleanWorking() {
    return {
      ...working,
      name: String(working.name || '').trim(),
      ingredients: working.ingredients
        .map(i => ({ ...i, label: String(i.label || '').trim(), grams: Math.max(0, Number(i.grams) || 0), unit: unitOf(i) }))
        .filter(i => i.label),
    };
  }

  async function onSave() {
    if (busy) return;
    const clean = cleanWorking();
    const problem = findInvalidRecipe(clean);
    if (problem) {
      showErrors = true;
      renderIngredientRows();
      validateUI();
      if (problem === 'name') nameInput.focus();
      app.toast(
        problem === 'name' ? t('cat.pleaseEnterARecipe')
          : problem === 'weight' ? t('cat.enterAnAmountFor')
            : t('cat.addAtLeastOne'),
      );
      return;
    }
    busy = true;
    const ok = await app.confirm({ title: t('cat.saveRecipe'), message: t('cat.saveTheseChanges'), okLabel: t('ui.save'), cancelLabel: t('ui.cancel') });
    if (!ok) { busy = false; return; }
    dirty = false;
    // Local-first: the store updates the list instantly and syncs in the background;
    // a rejected write is rolled back and surfaced by the store (no freeze here).
    app.saveRecipe(clean);
    app.toast(recipe ? t('cat.recipeSaved') : t('cat.recipeAdded'));
    app.showList();
  }

  async function onDelete() {
    if (busy) return;
    busy = true;
    // Route through the shared guard so the editor and the detail view share the
    // same confirm + Calculator-link warning. It deletes and navigates on success.
    const done = await app.confirmAndDelete(recipe);
    if (done) dirty = false;   // deleted + navigated away
    else busy = false;         // cancelled — stay in the editor
  }

  // Discard protection: Back with unsaved edits asks first.
  app.setLeaveGuard(async () => {
    if (!dirty) return true;
    return app.confirm({ title: t('cat.discardChanges'), message: t('cat.youHaveUnsavedChanges'), okLabel: t('ui.discard'), danger: true, cancelLabel: t('ui.cancel') });
  });

  // ── What a FULL label needs, and a PPDS one does not ───────────────────────
  //
  // ⚠️⚠️ SHOWN ONLY WHEN THE VENUE PRINTS THEM. A venue selling over its own counter
  // needs neither, and two boxes nobody can explain on a screen everybody uses is
  // exactly the clutter this project keeps having to remove. It is the same rule the
  // printer resolution follows: a control that changes nothing is one somebody sets
  // wrongly and then trusts.
  const labelProfile = getLabelProfile();
  const wantsWeight = labelProfile.showWeight === true;
  const wantsShelfLife = labelProfile.showDate === true;

  const netInput = el('input', {
    id: 'catRecipeNetWeight', class: 'cat-loss-input', type: 'number',
    min: '0', step: 'any', inputmode: 'decimal', placeholder: '—',
    value: normalizeWeight(working.netWeightG) > 0 ? String(Math.round(normalizeWeight(working.netWeightG))) : '',
    'aria-label': t('cat.netWeight'),
    oninput: (e) => { working.netWeightG = normalizeWeight(e.target.value); markDirty(); },
  });

  const shelfInput = el('input', {
    id: 'catRecipeShelfLife', class: 'cat-loss-input', type: 'number',
    min: '0', step: '1', inputmode: 'numeric', placeholder: '—',
    // ⚠️ EMPTY IS «NOBODY HAS SAID», AND IT IS NOT ZERO. Zero days means «today», and
    // printing today's date as a use-by on food that keeps a week is a safety
    // statement nobody made. normalizeShelfLifeDays() answers null for an empty box
    // and the field is then left OFF the document entirely.
    value: normalizeShelfLifeDays(working.shelfLifeDays) !== null
      ? String(normalizeShelfLifeDays(working.shelfLifeDays)) : '',
    'aria-label': t('cat.shelfLife'),
    oninput: (e) => {
      const days = normalizeShelfLifeDays(e.target.value);
      if (days === null) delete working.shelfLifeDays;
      else working.shelfLifeDays = days;
      markDirty();
    },
  });

  const labelField = el('div', { class: 'cat-loss-field' }, [
    el('div', { class: 'cat-loss-pair' }, [
      wantsWeight ? el('label', { class: 'cat-loss-cell' }, [
        el('span', { class: 'cat-loss-label', text: t('cat.netWeight') }),
        el('span', { class: 'cat-loss-row' }, [netInput, el('span', { class: 'cat-loss-unit', text: 'g' })]),
      ]) : null,
      wantsShelfLife ? el('label', { class: 'cat-loss-cell' }, [
        el('span', { class: 'cat-loss-label', text: t('cat.shelfLife') }),
        el('span', { class: 'cat-loss-row' }, [shelfInput, el('span', { class: 'cat-loss-unit', text: t('cat.days') })]),
      ]) : null,
    ]),
    el('p', { class: 'cat-loss-out', text: t('cat.labelFieldsNote') }),
  ]);
  labelField.hidden = !wantsWeight && !wantsShelfLife;

  const addRowBtn = el('button', {
    class: 'cat-add-row', type: 'button', text: t('cat.addIngredient'),
    onclick: () => { working.ingredients.push({ label: '', grams: '', unit: 'g' }); markDirty(); renderIngredientRows(); if (showErrors) validateUI(); },
  });

  // «Riordina» / «Fine» beside the ingredients heading, and the one sentence that says how.
  const reorderHint = el('p', { class: 'cat-reorder-hint', id: 'catReorderHint', text: t('cat.reorderHint') });
  reorderHint.hidden = true;
  const reorderBtn = el('button', {
    class: 'cat-reorder-btn', type: 'button', text: t('cat.reorder'), 'aria-pressed': 'false',
    onclick: () => {
      reordering = !reordering;
      reorderBtn.textContent = reordering ? t('cat.reorderDone') : t('cat.reorder');
      reorderBtn.setAttribute('aria-pressed', String(reordering));
      reorderHint.hidden = !reordering;
      // No new row while reordering: it would be a row with nothing to drag by its name.
      addRowBtn.hidden = reordering;
      renderIngredientRows();
      if (showErrors && !reordering) validateUI();
      const first = rowsContainer.querySelector(reordering ? '.cat-reorder-grip' : '.cat-lbl');
      try { first?.focus({ preventScroll: true }); } catch (e) { /* focus is best-effort */ }
    },
  });

  const actions = el('div', { class: 'cat-editor-actions' }, [
    el('button', { class: 'cat-save-btn', type: 'button', text: t('ui.save'), onclick: onSave }),
    // ⚠️ Owner only, same as the detail screen. Staff may still edit and save.
    recipe && canManageHere() ? el('button', { class: 'cat-del-btn', type: 'button', onclick: onDelete }, [
      el('span', { icon: TRASH_SVG, 'aria-hidden': 'true' }),
      // ⚠️ SEEN ON A SCREENSHOT OF AN ITALIAN VENUE, 13 Sep 2026: «Salva» beside
      // «Delete». The detail screen's own button has always used this key.
      t('cat.deleteRecipe'),
    ]) : null,
  ]);

  renderIngredientRows();

  // ⚠️ ONLY ON A NEW RECIPE, AND ONLY WHEN THE VENUE HAS IT SWITCHED ON. `recipe` is
  // null exactly when this is a new one — the same flag that already decides the
  // title, the toast and the absent Delete button. Federico, 23 Aug 2026: this is
  // needed at the moment you ADD a recipe, so this is where it lives.
  //
  // ⚠️ AND IF ANYTHING HAS BEEN TYPED, IT ASKS FIRST. Leaving for the photo screen
  // abandons this form, and coming back builds a fresh one — so a half-typed name
  // would vanish without a word. This is the "merge or replace?" question the old
  // comment said had no safe answer; on a NEW recipe it has one, because the choice
  // is small and it is asked out loud.
  const photoBtn = (!recipe && app.photoOn && app.photoOn())
    ? el('button', {
      class: 'cat-import-btn cat-photo-fill', type: 'button',
      onclick: async () => {
        if (dirty) {
          const ok = await app.confirm({
            title: t('cat.photo.replaceTitle'),
            message: t('cat.photo.replaceBody'),
            okLabel: t('cat.photo.replaceOk'),
            cancelLabel: t('ui.cancel'),
            danger: true,
          });
          if (!ok) return;
        }
        // The guard belongs to a form that is about to stop existing; leaving it in
        // place would ask a second time on the way out of the photo screen.
        app.setLeaveGuard(null);
        // ⚠ THE TYPED COPY TRAVELS WITH THE NAVIGATION. The guard is dropped because
        // this IS the answer to it, but nothing is thrown away: back out of the photo
        // screen and the form comes back exactly as it was left.
        app.openPhotoCapture(working);
      },
    }, [el('span', { icon: CAMERA_ICON, 'aria-hidden': 'true' }), el('span', { text: t('cat.photo.fill') })])
    : null;

  return el('div', { class: 'cat-view cat-editor' }, [
    el('label', { for: 'catRecipeName', text: t('cat.recipeName') }),
    nameInput,
    el('div', { class: 'cat-ing-head' }, [
      el('label', { class: 'cat-ing-head-label', text: t('cat.ingredients') }),
      countEl,
      reorderBtn,
    ]),
    reorderHint,
    rowsContainer,
    totalNote,
    addRowBtn,
    labelField,
    actions,
    // ⚠️ LAST, UNDER SAVE. Federico, 13 Sep 2026: «il compila da una foto mettilo sotto
    // alla fine della pagina». It sat under the name, between the one field every recipe
    // starts from and the ingredients it is typed into — in the way of the job it is an
    // alternative to. On a new recipe there is no Delete, so it is directly under Save.
    photoBtn,
  ]);
}
