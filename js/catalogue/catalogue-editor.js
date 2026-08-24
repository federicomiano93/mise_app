// catalogue-editor.js — add / edit / delete a catalogue recipe.
//
// Clones the safe editing pattern from js/recipes.js: work on a COPY, explicit
// confirm-gated Save, required-field validation before saving (jump + highlight),
// low-key Delete with a confirm, discard protection for unsaved edits, and an
// ingredient-name autocomplete built from the other recipes. Persists per document
// to recipes/{id} via the store (not into config).

import { t } from '../i18n.js';
import { canManageHere } from './firebase-catalogue.js';
import { el } from './dom.js';
import {
  findInvalidRecipe, unitOf, CATALOGUE_UNITS, isWeighableUnit, weighableTotalGrams,
  linkOf, normalizeLossPct, MAX_LOSS_PCT,
  normalizeWeight, weightLoss,
} from './catalogue-model.js';
import { openLinkPicker } from './ingredient-picker.js';
import { pricePerKg, formatRate } from '../price-model.js';

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
export function renderEditor({ recipe, draft, allRecipes, app }) {
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
        // ⚠️ CARRIED, NOT ZEROED. A draft used to come only from a photograph, which
        // never reads a cooking loss, so 0 was always right. It now also carries a
        // form somebody backed out of — and silently resetting a typed 12% while
        // keeping every other field is the kind of loss nobody notices until the
        // costing is wrong.
        lossPct: normalizeLossPct(draft.lossPct),
        // Carried for the same reason, and only when the draft really has them.
        ...(normalizeWeight(draft.rawGrams) > 0 ? { rawGrams: normalizeWeight(draft.rawGrams) } : {}),
        ...(normalizeWeight(draft.cookedGrams) > 0 ? { cookedGrams: normalizeWeight(draft.cookedGrams) } : {}),
      }
      : { id: null, name: '', ingredients: [{ label: '', grams: '', unit: 'g' }], lossPct: 0 };

  // ⚠️ A DRAFT STARTS DIRTY. It is unsaved work that somebody has already paid for
  // — leaving it with `dirty` false means Back walks away in silence and the read
  // is simply gone, with no question asked and nothing to show for it.
  let dirty = !!draft;
  let showErrors = false;
  let busy = false; // guards against re-entrant Save/Delete while a confirm is open
  const markDirty = () => { dirty = true; };

  // Autocomplete pool: distinct ingredient names across the catalogue.
  const names = new Set();
  for (const r of allRecipes) {
    for (const ing of (r.ingredients || [])) {
      const n = String(ing.label || '').trim();
      if (n) names.add(n);
    }
  }
  const datalist = el('datalist', { id: 'cat-ingredient-names' },
    [...names].sort((a, b) => a.localeCompare(b)).map(n => el('option', { value: n })));

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
    // ⚠️ The raw-dough box follows this total until somebody overrides it, so it is
    // refreshed from here — the one function that already runs on every keystroke.
    refreshLoss();
  }

  function renderIngredientRows() {
    rowsContainer.replaceChildren();
    working.ingredients.forEach((ing, idx) => {
      const labelInput = el('input', {
        class: 'cat-lbl', type: 'text', placeholder: t('cat.ingredient'), value: ing.label,
        list: 'cat-ingredient-names', 'aria-label': t('cat.ingredientName'),
        oninput: (e) => { ing.label = e.target.value; markDirty(); updateTotal(); if (showErrors) validateUI(); },
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
      onclick: async () => {
        const chosen = await openLinkPicker({
          ingredients: app.ingredients(),
          recipes: app.allRecipes(),
          suppliers: app.suppliers(),
          excludeRecipeId: working.id,
          hasLink: !!linkOf(working.ingredients[idx]),
        });
        if (chosen === undefined) return;              // dismissed: change nothing

        const row = working.ingredients[idx];
        if (chosen === null) {
          delete row.kind;
          delete row.refId;
        } else {
          row.kind = chosen.kind;
          row.refId = chosen.refId;
          // Pre-fill the name only when the row has none. An existing label is the
          // wording somebody chose for THIS recipe ("strong flour" for an article
          // filed as "Flour T55"), and overwriting it would undo that every time
          // the link is corrected.
          if (!String(row.label || '').trim()) row.label = chosen.name;
        }
        markDirty();
        renderIngredientRows();
        if (showErrors) validateUI();
      },
    }, linkText(ing));
    return button;
  }

  // "→ Flour · Supplier · £2.00 / kg", or an invitation when there is no link.
  // The price is shown here because it is the number the cost is built from, and
  // seeing it beside the row is what catches a link to the wrong article.
  function linkText(ing) {
    const link = linkOf(ing);
    if (!link) return t('cat.linkToAnIngredient');

    if (link.kind === 'recipe') {
      const sub = app.allRecipes().find(r => r.id === link.refId);
      return sub ? `→ ${sub.name}  ·  recipe` : t('cat.aRecipeThatNo');
    }

    const ingredient = app.ingredients()[link.refId];
    if (!ingredient) return t('cat.anIngredientThatNo');
    const rate = pricePerKg(ingredient);
    const supplier = (app.suppliers()[ingredient.supplierId] || {}).name || '';
    return ['→ ' + (ingredient.name || 'Ingredient'), supplier,
      rate === null ? 'no price yet' : `${formatRate(rate)} / kg`]
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

  // ── What the dough weighs before the oven, and after ────────────────────────
  //
  // The loss is the divisor of the cost per kilo: a dough that goes in at 1000 g and
  // comes out at 800 g costs 25% more per kilo than its ingredients suggest, and a 0
  // here is what makes a baked product look cheaper than it is. This used to ask for
  // the PERCENTAGE — a number nobody has, because it has to be worked out from two
  // weighings — so it stayed 0 on every recipe. Now it asks for the two weights.
  //
  // ⚠️⚠️ THE TWO STATES, AND THEY ARE THE WHOLE SAFETY OF THIS SCREEN.
  //   untouched — nobody has typed in a weight box. The percentage stays EXACTLY the
  //     stored lossPct whatever else is edited; crudo shows the live total and cotto
  //     stays EMPTY. Nothing is written back, so a recipe opened to fix a typo comes
  //     out of the database byte-identical.
  //   touched — a person has typed. The percentage is computed from the boxes, crudo
  //     stops following the total, and all three are saved.
  // Without the split, correcting 10 g of flour would silently move the number that
  // decides what every product built on this recipe costs.
  //
  // ⚠️⚠️ CRUDO IS FILLED IN AND COTTO IS NOT, AND THE ASYMMETRY IS THE POINT — it
  // looks like an oversight and a future reader will want to "finish" it. Crudo is
  // derived from something TRUE and live: the recipe's own ingredient total, which is
  // on the screen above it. Cotto would be derived from a percentage nobody measured,
  // and until 24 Aug 2026 it was: cookedFromLossPct(total, lossPct). With lossPct 0 —
  // every one of the twelve real recipes — that put the RAW total in the cooked box,
  // so the screen read «weighed, and it loses nothing». Federico, looking at it:
  // «la casella del impasto cotto deve essere vuota di default». An empty box says
  // «nobody has weighed this», which is the truth, and the stored percentage is still
  // printed underneath so nothing is hidden.
  let weighed = normalizeWeight(working.rawGrams) > 0 && normalizeWeight(working.cookedGrams) > 0;
  // Only true once the PERSON edits a box — not when the app fills one in.
  let rawTyped = weighed;

  // ⚠️⚠️ «—» AND NOT «0», ON BOTH BOXES. Found by looking at a screenshot after every
  // measurement had passed: with the cooked box emptied, its grey `0` placeholder sat
  // there on every recipe — a weaker version of the exact claim this change removes,
  // since an empty box here means «nobody has weighed this» and never «it weighed
  // nothing». Neither box's emptiness is a zero, so neither may look like one.
  const rawInput = el('input', {
    id: 'catRecipeRaw', class: 'cat-loss-input', type: 'number',
    min: '0', step: 'any', inputmode: 'decimal', placeholder: '—',
    // ⚠️ ITS STORED VALUE, AT BUILD TIME. refreshLoss() below only rewrites this box
    // while it is still following the recipe total, so a recipe that HAS been weighed
    // would otherwise open with an empty box and the number simply gone from the screen.
    value: normalizeWeight(working.rawGrams) > 0 ? String(Math.round(normalizeWeight(working.rawGrams))) : '',
    'aria-label': t('cat.rawDoughWeight'),
    oninput: (e) => {
      rawTyped = String(e.target.value).trim() !== '';
      // ⚠️ Clearing the box hands it back to the recipe total. That is the way back
      // from an override, and it needs no extra control on a screen this long.
      working.rawGrams = normalizeWeight(e.target.value);
      weighed = true;
      markDirty(); refreshLoss();
    },
  });
  const cookedInput = el('input', {
    id: 'catRecipeCooked', class: 'cat-loss-input', type: 'number',
    min: '0', step: 'any', inputmode: 'decimal', placeholder: '—',
    // ⚠️ ITS STORED VALUE, AND NOW THAT IS THE ONLY THING THAT EVER FILLS IT. A recipe
    // somebody HAS weighed opens showing what they weighed; every other recipe opens
    // empty, because empty is what «nobody has weighed this» looks like.
    value: normalizeWeight(working.cookedGrams) > 0 ? String(Math.round(normalizeWeight(working.cookedGrams))) : '',
    'aria-label': t('cat.cookedDoughWeight'),
    oninput: (e) => {
      working.cookedGrams = normalizeWeight(e.target.value);
      weighed = true;
      markDirty(); refreshLoss();
    },
  });
  const lossOut = el('p', { class: 'cat-loss-out' });
  const lossWarn = el('p', { class: 'cat-loss-warn' });

  // What the screen says when the two boxes do not answer the question — on open, and
  // again the moment somebody fills in one of the pair and not the other.
  //
  // ⚠️⚠️ A STORED 0 IS «NOBODY HAS SAID», NOT «MEASURED ZERO», and the document cannot
  // tell the two apart: lossPct is absent-or-zero on every recipe written before the
  // two weighings existed. So a 0 gets no percentage sentence at all. Printing «loses
  // 0%» is precisely the false statement this change exists to remove — and it is the
  // false one that costs money, because a loss of zero makes every baked product's cost
  // per kilo too low.
  function storedLossText(pct) {
    return pct > 0 ? t('cat.lossStored', { pct: String(pct) }) : t('cat.lossNotYet');
  }

  // The number the boxes currently mean, and what the screen says about it.
  function refreshLoss() {
    const total = weighableTotalGrams(working);
    // Crudo follows the recipe until somebody overrides it.
    if (!rawTyped) {
      working.rawGrams = total;
      rawInput.value = total ? String(Math.round(total)) : '';
    }
    const before = normalizeWeight(working.rawGrams);

    if (!weighed) {
      // ⚠️ EMPTY, AND NOTHING IS WRITTEN BACK. See the note at the top of this block
      // for why nothing is derived into it any more.
      cookedInput.value = '';
      lossOut.textContent = storedLossText(working.lossPct);
      lossWarn.hidden = true;
      return;
    }

    const { pct, problem } = weightLoss(before, working.cookedGrams);
    if (pct === null) {
      // ⚠️ NOT ZERO. Two numbers that do not answer the question must leave the stored
      // loss alone — zeroing it would quietly declare «this recipe loses nothing».
      // ⚠️ And they must not hide it either: half-filling the pair used to print «weigh
      // the cooked dough» over a recipe that already carried a real percentage.
      lossOut.textContent = storedLossText(working.lossPct);
    } else {
      working.lossPct = pct;
      lossOut.textContent = t('cat.lossIs', { pct: String(pct) });
    }
    lossWarn.textContent = problem === 'cookedHeavier' ? t('cat.lossCookedHeavier')
      : problem === 'capped' ? t('cat.lossCapped', { max: String(MAX_LOSS_PCT) })
        : '';
    lossWarn.hidden = !problem;
  }

  const lossField = el('div', { class: 'cat-loss-field' }, [
    el('div', { class: 'cat-loss-pair' }, [
      el('label', { class: 'cat-loss-cell' }, [
        el('span', { class: 'cat-loss-label', text: t('cat.rawDoughWeight') }),
        el('span', { class: 'cat-loss-row' }, [rawInput, el('span', { class: 'cat-loss-unit', text: 'g' })]),
      ]),
      el('label', { class: 'cat-loss-cell' }, [
        el('span', { class: 'cat-loss-label', text: t('cat.cookedDoughWeight') }),
        el('span', { class: 'cat-loss-row' }, [cookedInput, el('span', { class: 'cat-loss-unit', text: 'g' })]),
      ]),
    ]),
    lossOut,
    lossWarn,
  ]);

  const addRowBtn = el('button', {
    class: 'cat-add-row', type: 'button', text: t('cat.addIngredient'),
    onclick: () => { working.ingredients.push({ label: '', grams: '', unit: 'g' }); markDirty(); renderIngredientRows(); if (showErrors) validateUI(); },
  });

  const actions = el('div', { class: 'cat-editor-actions' }, [
    el('button', { class: 'cat-save-btn', type: 'button', text: t('ui.save'), onclick: onSave }),
    // ⚠️ Owner only, same as the detail screen. Staff may still edit and save.
    recipe && canManageHere() ? el('button', { class: 'cat-del-btn', type: 'button', onclick: onDelete }, [
      el('span', { icon: TRASH_SVG, 'aria-hidden': 'true' }),
      'Delete',
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
    datalist,
    el('label', { for: 'catRecipeName', text: t('cat.recipeName') }),
    nameInput,
    photoBtn,
    el('div', { class: 'cat-ing-head' }, [
      el('label', { class: 'cat-ing-head-label', text: t('cat.ingredients') }),
      countEl,
    ]),
    rowsContainer,
    totalNote,
    addRowBtn,
    lossField,
    actions,
  ]);
}
