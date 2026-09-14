// foodcost-editor.js — one product, on one page.
//
// ONE PAGE, NOT A WIZARD (the design's decision): the fields that only apply to
// one way of selling appear and disappear with the choice, rather than the product
// being built through a sequence nobody can go back through.
//
// The editing pattern is the app's own (P20): work on a COPY, nothing touches the
// stored product until Save, Save is confirmed, the required field is validated
// before saving, Delete is low-key and confirmed, and leaving with unsaved edits
// asks first.

import { t } from '../i18n.js';
import { canManageHere } from './firebase-foodcost.js';
import { el } from './dom.js';
import {
  vatRatesFor, vatSelection, costProduct, productionCost, blockerText,
  snapshotWorthTaking, productSnapshot, normalizeProduct, suggestedGrossPrice,
  ingredientLineCost, productsUsingRecipe, LINE_UNITS, PACK_UNITS,
} from './foodcost-model.js';
import { formatRate, formatMoney } from '../price-model.js';
import { openVatGuide } from './vat-guide-view.js';
import { firstInvalidNumber } from './product-limits.js';
// ⚠️ READ WHERE THE FIELD IS DRAWN, never at module load: the venue — and therefore
// its country, and therefore its currency — arrives with the session, after every
// module has been evaluated. See js/currency.js.
import { currentCurrency } from '../currency.js';
import { costRecipe } from '../catalogue/recipe-cost-model.js';
// Pure models only, like recipe-cost-model.js above: what a typed name matches, and how
// search text is compared. The screens that SHOW the choices are shared, in js/ root.
import { suggestLinks, normalizeSearchText } from '../catalogue/catalogue-model.js';
import { attachSuggestions } from '../pick-suggest.js';
import { openPickScreen } from '../pick-screen.js';
import {
  startWeighing, typeRaw, typeCooked, readWeighing, withWeighings, weighingPatches,
  otherProductsUsing,
} from './foodcost-weighing.js';

const TRASH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';

// An open book: «read which products take which rate». Stroked, 24×24, currentColor —
// the app's icon rule (inline SVG, never an emoji).
const GUIDE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/></svg>';

// Keys, resolved at draw time — see js/calculator-render.js.
const STATUS_TEXT = { green: 'fc.onTarget', amber: 'fc.slightlyOverTarget', red: 'fc.overTarget' };
const UNIT_TEXT = { piece: 'fc.perPiece', kg: 'fc.perKg', pack: 'fc.perPack' };
const PACKAGING_PER = { piece: 'fc.packagingPer.piece', pack: 'fc.packagingPer.pack', weight: 'fc.packagingPer.kg' };
const LINE_REASON_TEXT = {
  'no-ingredient-price': 'fc.ingredientNoPrice',
  'no-piece-weight': 'fc.ingredientNoPieceWeight',
  'no-piece-price': 'fc.ingredientNoPiecePrice',
};

// The unit word for a selling mode's figures: «per piece», «per kg», «per pack».
function unitWord(mode) {
  return t(UNIT_TEXT[mode === 'weight' ? 'kg' : mode === 'pack' ? 'pack' : 'piece']);
}

// `draft` is a NEW product nobody has typed yet — built by draftFromRecipe() when a
// recipe's «Apri nel Food cost» finds no product using it.
//
// ⚠️ `product` STAYS null FOR IT, exactly as for «+ Add product»: the title, the toast,
// the absent Delete and the absent margin history all key off `product`, and a draft is
// none of those. And it opens NOT dirty — nobody has typed anything, so leaving at once
// asks nothing and saves nothing.
export function renderEditor({ product, draft = null, app }) {
  // A working COPY. Nothing reaches the stored product until Save.
  const working = product
    ? JSON.parse(JSON.stringify(normalizeProduct(product)))
    : draft && normalizeProduct(draft)
      ? JSON.parse(JSON.stringify({ ...normalizeProduct(draft), id: null }))
      : {
        id: null, name: '', components: [], packaging: [],
        sellingMode: null, piecesPerBatch: null, packSize: null, packUnit: null, sellingPrice: null,
        vatRate: null, foodCostTarget: null,
      };

  let dirty = false;
  let busy = false;
  let showErrors = false;
  // ⚠️ `touched` NEVER GOES BACK TO false, unlike `dirty` (which Save clears). The page
  // asks it whether a product opened from a recipe is still exactly as it arrived — see
  // isUntouched() at the bottom, and foodcost-main.js.
  let touched = false;
  const markDirty = () => { dirty = true; touched = true; };

  // The recipes on this product. Ingredient lines have none.
  const recipeIdsOn = components => components.filter(c => c.recipeId).map(c => c.recipeId);

  // ── The oven loss of each recipe on this product ───────────────────────────
  //
  // Federico, 13 Sep 2026: the dough is weighed raw and cooked HERE, no longer in the
  // recipe editor — and the number belongs to the RECIPE, so it is written there
  // (foodcost-weighing.js says why, and holds every rule). Since the same day the boxes
  // sit at the END of «Composto da», one pair per recipe: «impasto crudo e cotto va alla
  // fine del riquadro bianco della sezione "composto da"».
  //
  // ⚠️ HELD OUTSIDE THE DOM, PER RECIPE ID. This screen rebuilds its rows whenever a
  // line changes, and two lines may carry the same recipe; keeping the typing here is
  // what makes a rebuild lose nothing and the two lines agree.
  const weighings = {};
  let weighViews = [];
  let lineNotes = [];

  function weighingOf(recipeId) {
    // An untouched line is read again from the recipe every time, so a weighing saved
    // on another phone shows up here; only a line a person has typed on is kept.
    if (!weighings[recipeId] || !weighings[recipeId].touched) {
      weighings[recipeId] = startWeighing(app.tables().recipes[recipeId]);
    }
    return weighings[recipeId];
  }

  // What Save would write onto the recipes, right now.
  function currentPatches() {
    return weighingPatches(app.tables().recipes, weighings, recipeIdsOn(working.components));
  }

  // ⚠️ EVERY NUMBER ON THIS SCREEN COMES FROM HERE: the stored recipes with the weighings
  // typed on this product laid over them. Reading app.tables() directly would keep
  // showing the old cost per kilo until after Save.
  function liveTables() {
    return withWeighings(app.tables(), currentPatches());
  }

  // One recipe's two weighings. `titled` names the recipe, when the product has more than
  // one and the boxes would otherwise not say whose dough they are.
  function weighBlock(id, titled) {
    // ⚠️ NO BOXES WHERE THEIR SAVE WOULD BE REFUSED: a venue with the catalogue switched
    // off can read its recipes here but not write them (canWriteRecipes() says why).
    if (!id || !app.tables().recipes[id] || !app.canWeigh()) return null;
    const box = (label, onType) => el('input', {
      class: 'fc-input fc-number', type: 'number', min: '0', step: 'any',
      inputmode: 'decimal', placeholder: '—', 'aria-label': label,
      oninput: e => { weighings[id] = onType(weighingOf(id), e.target.value); markDirty(); refreshLive(); },
    });
    const rawInput = box(t('fc.rawDough'), typeRaw);
    const cookedInput = box(t('fc.cookedDough'), typeCooked);
    const out = el('p', { class: 'fc-weigh-out' });
    const warn = el('p', { class: 'fc-weigh-warn' });
    const shared = el('p', { class: 'fc-note fc-weigh-shared' });
    weighViews.push({ id, rawInput, cookedInput, out, warn, shared });

    const cell = (label, input) => el('label', { class: 'fc-weigh-cell' }, [
      el('span', { class: 'fc-weigh-label', text: label }),
      el('span', { class: 'fc-weigh-row' }, [input, el('span', { class: 'fc-weigh-unit', text: 'g' })]),
    ]);
    return el('div', { class: 'fc-weigh' }, [
      titled ? el('p', { class: 'fc-weigh-title', text: t('fc.weighFor', { name: app.tables().recipes[id].name || '' }) }) : null,
      el('div', { class: 'fc-weigh-pair' }, [
        cell(t('fc.rawDough'), rawInput),
        cell(t('fc.cookedDough'), cookedInput),
      ]),
      out, warn, shared,
    ]);
  }

  function paintWeighViews() {
    const recipes = app.tables().recipes;
    const focused = document.activeElement;
    for (const view of weighViews) {
      const recipe = recipes[view.id];
      if (!recipe) continue;
      const state = weighingOf(view.id);
      const shown = readWeighing(recipe, state);
      // ⚠️ NEVER REWRITE THE BOX UNDER THE FINGER: «12.» is a number half-typed, and
      // putting the parsed 12 back would eat the decimal point.
      if (focused !== view.rawInput) {
        view.rawInput.value = state.rawTyped ? (state.raw > 0 ? String(state.raw) : '') : shown.rawShown;
      }
      if (focused !== view.cookedInput) {
        view.cookedInput.value = state.weighed && state.cooked > 0 ? String(state.cooked) : '';
      }
      view.out.textContent = t(shown.message.key, shown.message.params);
      view.warn.textContent = shown.warning ? t(shown.warning.key, shown.warning.params) : '';
      view.warn.hidden = !shown.warning;
      // ⚠️ SAID THE MOMENT IT BECOMES TRUE: the loss belongs to the recipe, so a
      // weighing typed on this product changes every other product built on it, and
      // nobody opening those would know why their cost moved.
      const others = shown.patch ? otherProductsUsing(app.products(), view.id, working.id) : 0;
      view.shared.textContent = others ? t('fc.lossSharedWith', { n: others }) : '';
      view.shared.hidden = !others;
    }
  }

  // After a keystroke in a weighing: every figure that depends on it, and nothing that
  // holds an input — rebuilding the rows here would take the box from under the finger.
  function refreshLive() {
    const tables = liveTables();
    for (const { note, entry, kind } of lineNotes) note.textContent = lineNote(entry, kind, tables);
    paintWeighViews();
    paintAnswer();
  }

  // ── What it costs to make, on its own ──────────────────────────────────────
  //
  // Federico, 13 Sep 2026: «inserisci il costo prodotto in food cost». Until now it was
  // readable only inside the food cost sentence, and only once a selling price and a
  // VAT rate were in — so a product being built showed no cost at all. It is also the
  // only place a product's cost is shown now: the recipe screen stopped showing one,
  // because a recipe on its own knows neither its oven loss nor what is added later.
  //
  // ⚠️ NO TRAFFIC-LIGHT EDGE: a cost is neither good nor bad until there is a price.
  const prodCost = el('div', { class: 'fc-prodcost' });

  function paintProductionCost() {
    const cost = productionCost(working, liveTables());
    prodCost.replaceChildren();
    // Nothing costed yet: no box at all, never «€0.00», which reads as free.
    prodCost.hidden = cost.batchCost === null;
    if (cost.batchCost === null) return;

    const perUnit = cost.unitCost !== null;
    prodCost.appendChild(el('div', { class: 'fc-prodcost-head' }, [
      el('span', { class: 'fc-answer-label', text: t('fc.productionCost') }),
      el('span', { class: 'fc-prodcost-value' }, [
        el('span', { class: 'fc-prodcost-num', text: perUnit ? formatRate(cost.unitCost) : formatMoney(cost.batchCost) }),
        el('span', { class: 'fc-prodcost-unit', text: perUnit
          ? t(UNIT_TEXT[cost.unit])
          : t('fc.wholeBatchWord') }),
      ]),
    ]));
    if (perUnit) {
      prodCost.appendChild(el('p', { class: 'fc-answer-basis', text: t('fc.wholeBatch', { cost: formatMoney(cost.batchCost) }) }));
    }
    // The work, beside the materials — drawn only when there is a figure, which needs the
    // hourly rate, which only whoever runs the place is ever sent.
    if (cost.labourUnitCost !== null) {
      prodCost.appendChild(el('p', { class: 'fc-answer-basis', text: t('fc.costSplit', {
        materials: formatRate(cost.unitCost), labour: formatRate(cost.labourUnitCost),
      }) }));
      prodCost.appendChild(el('p', { class: 'fc-answer-basis', text: t('fc.costTotal', {
        total: formatRate(cost.totalUnitCost), unit: t(UNIT_TEXT[cost.unit]),
      }) }));
    }
    // ⚠️ THE SAME RULE AS THE ANSWER BELOW: a partial cost is always too LOW, so it may
    // never be shown without saying so.
    if (cost.partial) prodCost.appendChild(el('p', { class: 'fc-answer-partial', text: t('fc.costPartial') }));
  }

  // ── The answer, live ───────────────────────────────────────────────────────
  const answer = el('div', { class: 'fc-answer' });

  function paintAnswer() {
    const tables = liveTables();
    paintProductionCost();
    paintSuggestion(tables);
    // Minutes typed but no rate to turn them into money: say where the rate is set — and
    // only to somebody who can set it; an employee is simply shown no labour money.
    labourNote.textContent = working.labourMinutes > 0 && app.mayManage() && !(Number(tables.labourCostPerHour) > 0)
      ? t('fc.labourSetRate') : '';
    const result = costProduct(working, tables);
    answer.replaceChildren();

    if (result.foodCostPct === null) {
      answer.className = 'fc-answer muted';
      answer.appendChild(el('p', { class: 'fc-answer-none', text: t('fc.notCostedYet') }));
      // Everything still missing, in the order a person would fill it in — not
      // just the first one, so the screen is a checklist rather than a drip-feed.
      const list = el('ul', { class: 'fc-blockers' });
      result.blockers.forEach(key => {
        list.appendChild(el('li', { text: blockerText(key) }));
      });
      answer.appendChild(list);
      return;
    }

    const status = result.status;
    answer.className = `fc-answer ${status || 'none'}`;
    answer.appendChild(el('div', { class: 'fc-answer-head' }, [
      el('span', { class: 'fc-answer-label', text: t('fc.foodCost') }),
      el('span', { class: 'fc-answer-value', text: `${result.foodCostPct}%` }),
    ]));

    answer.appendChild(el('p', { class: 'fc-answer-basis', text: t('fc.answerBasis', {
      cost: formatRate(result.unitCost),
      unit: unitWord(working.sellingMode),
      net: formatMoney(result.netUnitPrice),
      margin: formatMoney(result.margin),
    }) }));

    if (status) answer.appendChild(el('p', { class: 'fc-answer-status', text: t(STATUS_TEXT[status]) }));

    // ⚠️ BESIDE THE FOOD COST, NEVER INSIDE IT: the percentage above stays what the
    // ingredients and packaging take; this says what the work takes, and everything.
    if (result.labourPct !== null) {
      answer.appendChild(el('p', { class: 'fc-answer-basis', text: t('fc.labourPctLine', {
        labour: String(result.labourPct), total: String(result.totalCostPct),
      }) }));
    }

    // ⚠️ A PARTIAL COST MUST NEVER LOOK COMPLETE. If a recipe inside this product
    // is only partly priced, the percentage is real but too LOW — the one
    // direction a food cost must not be wrong in.
    if (result.partial) {
      answer.appendChild(el('p', { class: 'fc-answer-partial', text:
        t('fc.partOfThisProduct') }));
    }
  }

  // ── Name ───────────────────────────────────────────────────────────────────
  const nameInput = el('input', {
    id: 'fcName', class: 'fc-input', type: 'text', placeholder: t('fc.productName'),
    value: working.name, 'aria-label': t('fc.productName'),
    oninput: e => { working.name = e.target.value; markDirty(); if (showErrors) validateUI(); },
  });
  const nameNote = el('p', { class: 'fc-name-note', 'aria-live': 'polite' });

  // Under the name, while it is typed: the recipes it matches. Federico, 13 Sep 2026:
  // «quando scrivo il nome e quello che sto scrivendo corrisponde ad una ricetta che ho nel
  // ricettario fammi uscire un suggerimento per la selezione veloce». A tap names the
  // product after the recipe (his choice — the name can still be edited) and puts the
  // recipe first in «Composto da».
  // ⚠️ ONLY WHILE «COMPOSTO DA» IS EMPTY: renaming a product already made of something must
  // not keep offering to rebuild it.
  const nameSuggest = attachSuggestions(nameInput, {
    suggest: typed => {
      if (working.components.length) return { items: [], total: 0 };
      const result = suggestLinks({ ingredients: {}, recipes: app.tables().recipes, query: typed });
      return {
        total: result.total,
        items: result.items.map(item => ({ name: item.name, meta: '', linked: false, value: item.refId })),
      };
    },
    onPick: recipeId => useRecipeForName(recipeId),
    onSeeAll: async typed => {
      const chosen = await pick('recipe', typed);
      if (chosen) useRecipeForName(chosen.id);
    },
    texts: { list: t('fc.suggest.label'), seeAll: n => t('cat.suggest.seeAll', { n }) },
  });

  function useRecipeForName(recipeId) {
    const recipe = app.tables().recipes[recipeId];
    if (!recipe) return;
    working.name = String(recipe.name || '').trim();
    nameInput.value = working.name;
    if (!working.components.some(c => c.recipeId === recipeId)) working.components.unshift({ recipeId, qtyKg: 0 });
    // Said, never prevented: two products on one recipe is normal (a small and a large
    // loaf), but making the same one twice by accident is what this catches.
    const others = productsUsingRecipe((app.products() || []).filter(p => p && p.id !== working.id), recipeId).length;
    nameNote.textContent = others ? t('fc.recipeAlreadyUsed', { n: others, name: working.name }) : '';
    markDirty();
    if (showErrors) validateUI();
    repaint();
    focusQty(componentRows, 0);
  }

  // ── What it is made of ─────────────────────────────────────────────────────
  //
  // Federico, 13 Sep 2026: with nothing in it, the button adds a recipe; once there is one
  // it adds «una ricetta o un ingrediente» — a cream cornetto is the cornetto recipe, the
  // cream recipe, and icing sugar on top. The choice is a search screen, not a menu:
  // there are too many ingredients for a <select> on a phone.
  const componentRows = el('div', { class: 'fc-rows' });
  const weighRows = el('div', { class: 'fc-weighs' });
  const addLineBtn = el('button', { class: 'fc-add-row', type: 'button', onclick: () => addLine() });
  const madeOf = el('div', { class: 'fc-madeof' }, [componentRows, addLineBtn, weighRows]);

  const packagingRows = el('div', { class: 'fc-rows' });
  const packagingQty = el('p', { class: 'fc-label' });

  // The full-screen chooser, in this page's own header.
  //   mode: 'recipe' | 'ingredient' | 'line' (recipes and ingredients) | 'packaging'
  // Resolves { kind, id } or undefined.
  function pick(mode, initialQuery = '') {
    const titles = { recipe: 'fc.pickRecipe', ingredient: 'fc.pickIngredient', line: 'fc.pickRecipeOrIngredient', packaging: 'fc.pickPackaging' };
    const both = mode === 'line';
    return openPickScreen({
      title: t(titles[mode]),
      backLabel: t('ui.back'),
      searchLabel: t('fc.searchPick'),
      initialQuery,
      chrome: { header: 'fc-header', slot: 'fc-header-slot', title: 'fc-header-title', icon: 'fc-icon-btn' },
      sections: query => {
        const q = normalizeSearchText(query);
        const matches = name => !q || normalizeSearchText(name).includes(q);
        const out = [];
        if (mode === 'recipe' || both) {
          out.push({
            heading: both ? t('ui.recipes') : '',
            items: app.recipeOptions().filter(o => matches(o.label))
              .map(o => ({ name: o.label, meta: both ? t('fc.recipeWord') : '', value: { kind: 'recipe', id: o.id } })),
          });
        }
        if (mode === 'ingredient' || both) {
          out.push({
            heading: both ? t('fc.ingredients') : '',
            // ⚠️ NO PRICE: «nella sezione "composto da" non mostrare il prezzo».
            items: app.ingredientOptions().filter(o => matches(o.name))
              .map(o => ({ name: o.name, meta: o.meta, value: { kind: 'ingredient', id: o.id } })),
          });
        }
        if (mode === 'packaging') {
          out.push({
            heading: '',
            items: app.packagingOptions().filter(o => matches(o.name))
              .map(o => ({ name: o.name, meta: o.meta, value: { kind: 'packaging', id: o.id } })),
          });
        }
        return out;
      },
      emptyText: query => (query ? t('fc.nothingMatches') : mode === 'packaging' ? t('fc.noPackagingYet') : t('fc.noRecipesYet')),
    });
  }

  async function addLine() {
    const chosen = await pick(working.components.length ? 'line' : 'recipe');
    if (!chosen) return;
    working.components.push(chosen.kind === 'recipe'
      ? { recipeId: chosen.id, qtyKg: 0 }
      : { kind: 'ingredient', ingredientId: chosen.id, qty: 0, unit: 'g' });
    markDirty();
    repaint();
    focusQty(componentRows, working.components.length - 1);
  }

  async function addPackaging() {
    const chosen = await pick('packaging');
    if (!chosen) return;
    working.packaging.push({ ingredientId: chosen.id, qtyPcs: 0 });
    markDirty();
    repaint();
    focusQty(packagingRows, working.packaging.length - 1);
  }

  // Point an existing line at something else of the same kind.
  async function changeLine(list, index, kind) {
    const chosen = await pick(kind);
    if (!chosen) return;
    const entry = list[index];
    if (!entry) return;
    if (kind === 'recipe') entry.recipeId = chosen.id;
    else entry.ingredientId = chosen.id;
    markDirty();
    repaint();
  }

  // Straight to the amount of a line just added — the next thing a person fills in.
  function focusQty(container, index) {
    const line = container.querySelectorAll('.fc-line')[index];
    const box = line && line.querySelector('.fc-qty');
    try { if (box) box.focus(); } catch (e) { /* focus is best-effort */ }
  }

  function lineName(entry, kind) {
    if (kind === 'recipe') {
      const recipe = app.tables().recipes[entry.recipeId];
      return recipe ? { text: String(recipe.name || '').trim(), missing: false } : { text: t('fc.thisRecipeNoLonger'), missing: true };
    }
    const item = app.tables().ingredients[entry.ingredientId];
    return item ? { text: String(item.name || '').trim(), missing: false } : { text: t('fc.thisItemNoLonger'), missing: true };
  }

  //   kind: 'recipe' | 'ingredient' | 'packaging'
  function lineRow({ list, index, entry, kind }) {
    const name = lineName(entry, kind);
    const nameBtn = el('button', {
      class: 'fc-line-name' + (name.missing ? ' missing' : ''), type: 'button',
      'aria-label': t('fc.aria.changeLine', { name: name.text }),
      onclick: () => changeLine(list, index, kind),
    }, [el('span', { text: name.text })]);

    const qtyKey = kind === 'recipe' ? 'qtyKg' : kind === 'ingredient' ? 'qty' : 'qtyPcs';
    const qty = el('input', {
      class: 'fc-input fc-qty', type: 'number', min: '0', step: 'any',
      inputmode: 'decimal', placeholder: '0', value: entry[qtyKey] || '',
      'aria-label': kind === 'recipe' ? t('fc.aria.kilos') : kind === 'ingredient' ? t('fc.aria.quantity') : t('fc.aria.pieces'),
      // ⚠️ NOT repaint(). That rebuilds every row — THIS BOX INCLUDED — so the finger lost
      // the box after one digit and «1.7» could not be typed at all. Found driving the
      // screen on 13 Sep 2026. A quantity changes two things, and only those are
      // refreshed: this line's note and the answer at the top. (`note` is declared below;
      // the handler only ever runs after it exists.)
      oninput: e => {
        entry[qtyKey] = Number(e.target.value) || 0;
        markDirty();
        note.textContent = lineNote(entry, kind);
        paintAnswer();
      },
    });

    // An ingredient is added in grams, kilos or pieces; a recipe is always kilos, and
    // packaging always pieces per unit sold.
    let unit;
    if (kind === 'ingredient') {
      unit = el('select', {
        class: 'fc-input fc-select fc-line-unit-select', 'aria-label': t('fc.aria.unit'),
        // ⚠️ Not repaint() either, for the same reason as the quantity box.
        onchange: e => { entry.unit = e.target.value; markDirty(); note.textContent = lineNote(entry, kind); paintAnswer(); },
      }, LINE_UNITS.map(u => el('option', { value: u }, u === 'pcs' ? t('fc.unit.pieces') : u)));
      unit.value = entry.unit;
    } else {
      unit = el('span', { class: 'fc-line-unit', text: kind === 'recipe' ? 'kg' : t('fc.unit.pieces') });
    }

    const remove = el('button', {
      class: 'fc-del-icon', type: 'button', icon: TRASH_SVG,
      'aria-label': kind === 'recipe' ? t('fc.removeRecipe') : kind === 'ingredient' ? t('fc.removeIngredient') : t('fc.removePackagingItem'),
      onclick: () => { list.splice(index, 1); markDirty(); repaint(); },
    });

    const note = el('p', { class: 'fc-line-note', text: lineNote(entry, kind) });
    lineNotes.push({ note, entry, kind });

    return el('div', { class: 'fc-line' }, [
      el('div', { class: 'fc-line-row' }, [nameBtn, remove]),
      el('div', { class: 'fc-line-row fc-line-qtyrow' }, [qty, unit]),
      note,
    ]);
  }

  function lineNote(entry, kind, tables = liveTables()) {
    if (kind === 'recipe') {
      const recipe = tables.recipes[entry.recipeId];
      if (!recipe) return entry.recipeId ? t('fc.thisRecipeNoLonger') : '';
      // ⚠️ NO MONEY UNDER A RECIPE LINE. Federico, 13 Sep 2026: «nella sezione "composto
      // da" non mostrare il prezzo». What stays is what a person must ACT on — a recipe
      // with no price, or only part of one — because a silent gap is a cost too low.
      const costed = costRecipe(recipe, tables);
      if (costed.pricePerKg === null) return t('fc.thisRecipeIsNot');
      return costed.partial ? t('fc.thisRecipePartlyPriced') : '';
    }
    const ingredient = tables.ingredients[entry.ingredientId];
    if (!ingredient) return entry.ingredientId ? t('fc.thisItemNoLonger') : '';
    if (kind === 'ingredient') {
      // No money here either — only what stops the line from being costed.
      const line = ingredientLineCost(entry, ingredient);
      return line.reason ? t(LINE_REASON_TEXT[line.reason]) : '';
    }
    if (ingredient.priceUnit !== 'pcs') {
      // Counted in pieces, so it has to be BOUGHT by the piece. Said plainly
      // rather than silently costing nothing.
      return t('fc.pricedByWeightSet');
    }
    const each = Number(ingredient.pricePerUnit) || 0;
    return `${t('fc.priceEach', { price: formatRate(each) })}  ·  ${formatMoney((Number(entry.qtyPcs) || 0) * each)}`;
  }

  function repaintLines() {
    weighViews = [];
    lineNotes = [];
    componentRows.replaceChildren(...working.components.map((entry, index) =>
      lineRow({ list: working.components, index, entry, kind: entry.kind === 'ingredient' ? 'ingredient' : 'recipe' })));
    // One pair of weighings per RECIPE, however many lines carry it.
    const recipeIds = [...new Set(recipeIdsOn(working.components))];
    weighRows.replaceChildren(...recipeIds.map(id => weighBlock(id, recipeIds.length > 1)).filter(Boolean));
    packagingRows.replaceChildren(...working.packaging.map((entry, index) =>
      lineRow({ list: working.packaging, index, entry, kind: 'packaging' })));
    paintWeighViews();
  }

  // ── How it is sold ─────────────────────────────────────────────────────────
  const modeSelect = el('select', {
    id: 'fcMode', class: 'fc-input', 'aria-label': t('fc.howItIsSold'),
    onchange: e => {
      working.sellingMode = e.target.value || null;
      markDirty();
      repaint();
    },
  }, [
    el('option', { value: '' }, t('fc.choose')),
    el('option', { value: 'piece' }, t('fc.byThePiece')),
    el('option', { value: 'weight' }, t('fc.byWeightPerKg')),
    el('option', { value: 'pack' }, t('fc.byThePack')),
  ]);
  modeSelect.value = working.sellingMode || '';

  const piecesInput = numberInput('fcPieces', t('fc.howManyPiecesCome'),
    working.piecesPerBatch, v => { working.piecesPerBatch = v; });
  const piecesField = field(t('fc.piecesPerBatch'), piecesInput,
    t('fc.howManyFinishedPieces'));

  // «A confezione» (Federico, 13 Sep 2026): «sotto fammi inserire il peso e fammi scegliere
  // il gr, kg ecc» — what one pack holds, as a weight or as a number of pieces.
  const packSizeInput = numberInput('fcPackSize', t('fc.packHoldsAs'),
    working.packSize, v => { working.packSize = v; });
  const packUnitSelect = el('select', {
    id: 'fcPackUnit', class: 'fc-input fc-select', 'aria-label': t('fc.aria.unit'),
    onchange: e => { working.packUnit = e.target.value || null; markDirty(); repaint(); },
  }, [
    el('option', { value: '' }, t('fc.choose')),
    ...PACK_UNITS.map(u => el('option', { value: u }, u === 'pcs' ? t('fc.unit.pieces') : u)),
  ]);
  packUnitSelect.value = working.packUnit || '';
  const packField = el('div', { class: 'fc-field' }, [
    el('label', { class: 'fc-label', for: 'fcPackSize', text: t('fc.packHolds') }),
    el('div', { class: 'fc-pack-row' }, [packSizeInput, packUnitSelect]),
    el('p', { class: 'fc-note', text: t('fc.packHoldsNote') }),
  ]);

  // ── The time it takes (13 Sep 2026) ─────────────────────────────────────────
  //
  // Federico: «nella sezione food cost dobbiamo aggiungere tempo di produzione della
  // ricetta … il costo del lavoro orario e l'app mi dice quanto è il costo del lavoro».
  // His choice: minutes and people ON THE PRODUCT, one hourly cost for the venue.
  // ⚠️ THE MINUTES ARE NOT MONEY, so whoever edits the product sees them; what they COST
  // is drawn only when the rate is known, which is only for whoever runs the place.
  const labourMinutesInput = numberInput('fcLabourMinutes', t('fc.labourMinutes'),
    working.labourMinutes, v => { working.labourMinutes = v; });
  const labourPeopleInput = numberInput('fcLabourPeople', t('fc.labourPeople'),
    working.labourPeople, v => { working.labourPeople = v; });
  labourPeopleInput.placeholder = '1';
  const labourNote = el('p', { class: 'fc-labour-note' });

  // ⚠️ GROSS, and the label says so. The number typed here is the one on the
  // label; the app takes the VAT out before working out the food cost.
  const priceInput = numberInput('fcPrice', t('fc.sellingPriceIncludingVat'),
    working.sellingPrice, v => { working.sellingPrice = v; });

  // A dropdown of the venue's COUNTRY's rates plus a free field, because which rate
  // applies to a bakery product is a question for an accountant, not for this app.
  // ⚠️ ASKED HERE, WHERE THE MENU IS DRAWN: the venue — and so its country — arrives
  // with the session, after every module has loaded (the js/currency.js rule).
  const country = app.country();
  const vatChoices = vatRatesFor(country);
  const vatSelect = el('select', {
    id: 'fcVat', class: 'fc-input', 'aria-label': t('fc.vatRate'),
    onchange: e => {
      const value = e.target.value;
      if (value === 'other') {
        // ⚠️ THE BOX SHOWS THE RATE THAT WILL BE SAVED. Found by the code review of the
        // Italian rates: going back to «another rate» after picking one from the menu left
        // the box on its OLD number while Save stored the one just picked — a VAT rate on
        // screen that was not the one in the margin.
        vatOther.value = working.vatRate === null ? '' : String(working.vatRate);
      } else {
        working.vatRate = value === '' ? null : Number(value);
      }
      vatOther.hidden = value !== 'other';
      markDirty();
      repaint();
    },
  }, [
    el('option', { value: '' }, t('fc.choose')),
    ...vatChoices.map(choice => el('option', { value: String(choice.rate) },
      t(choice.key, { rate: String(choice.rate) }))),
    el('option', { value: 'other' }, t('fc.anotherRate')),
  ]);
  const vatOther = numberInput('fcVatOther', t('fc.anotherVatRateAs'),
    null, v => { working.vatRate = v; });
  // ⚠️ A stored rate this country's list does not offer — a product saved at 20% before
  // the venue had Italian choices — goes in the free field, UNCHANGED. The decision is
  // vatSelection()'s, where a test runs it for both countries.
  const initialVat = vatSelection(working.vatRate, country);
  vatSelect.value = initialVat.select;
  vatOther.value = initialVat.other;
  vatOther.hidden = initialVat.select !== 'other';

  // «Which products take which VAT rate», beside the menu. Federico, 13 Sep 2026:
  // «accanto alla casella aliquota iva mettimi un tasto che apre una lista».
  const guideBtn = el('button', {
    class: 'fc-guide-btn', type: 'button', icon: GUIDE_SVG,
    'aria-label': t('fc.vatGuide.open'), title: t('fc.vatGuide.open'),
    onclick: () => openVatGuide({ country, currentRate: working.vatRate, onUse: applyVat, returnFocus: guideBtn }),
  });

  // A rate chosen in the guide goes through the SAME rule the menu opens with: a rate the
  // country's menu does not offer — Italy's 5% — lands in «another rate», unchanged.
  function applyVat(rate) {
    const selection = vatSelection(rate, country);
    working.vatRate = Number(rate);
    vatSelect.value = selection.select;
    vatOther.value = selection.other;
    vatOther.hidden = selection.select !== 'other';
    markDirty();
    repaint();
  }

  const vatField = el('div', { class: 'fc-field' }, [
    el('label', { class: 'fc-label', for: 'fcVat', text: t('fc.vatRate') }),
    el('div', { class: 'fc-vat-row' }, [vatSelect, guideBtn]),
  ]);

  // ── The price to sell it at ────────────────────────────────────────────────
  //
  // Federico, 13 Sep 2026: with the cost known, type the VAT and the food cost you want,
  // and the app says what to sell it at — on the SAME screen as the food cost of the price
  // typed (his choice, over a switch between two modes).
  const suggestion = el('div', { class: 'fc-suggest-price', tabindex: '-1', 'aria-live': 'polite' });

  function paintSuggestion(tables) {
    const cost = productionCost(working, tables);
    suggestion.replaceChildren();
    // Nothing to suggest until the product has a cost per piece, kilo or pack.
    suggestion.hidden = cost.unitCost === null;
    if (cost.unitCost === null) return;

    const price = suggestedGrossPrice({ unitCost: cost.unitCost, vatRate: working.vatRate, targetPct: working.foodCostTarget });
    if (price === null) {
      suggestion.appendChild(el('p', { class: 'fc-note', text: t('fc.suggestedPriceNeeds') }));
      return;
    }
    suggestion.appendChild(el('div', { class: 'fc-prodcost-head' }, [
      el('span', { class: 'fc-answer-label', text: t('fc.suggestedPrice') }),
      el('span', { class: 'fc-prodcost-value' }, [
        el('span', { class: 'fc-prodcost-num', text: formatMoney(price) }),
        el('span', { class: 'fc-prodcost-unit', text: t(UNIT_TEXT[cost.unit]) }),
      ]),
    ]));
    suggestion.appendChild(el('p', { class: 'fc-answer-basis', text: t('fc.suggestedPriceBasis', {
      vat: String(working.vatRate), target: String(working.foodCostTarget),
    }) }));
    // ⚠️ THE SAME RULE AS THE COST ABOVE: a partly priced product costs more than it says,
    // so the price that would hit the target is HIGHER than this one — say so.
    if (cost.partial) suggestion.appendChild(el('p', { class: 'fc-answer-partial', text: t('fc.suggestedPricePartial') }));

    const inUse = working.sellingPrice !== null && Math.abs(working.sellingPrice - price) < 0.005;
    suggestion.appendChild(inUse
      ? el('p', { class: 'fc-note', text: t('fc.suggestedPriceInUse') })
      : el('button', {
        class: 'fc-use-price', type: 'button', text: t('fc.useThisPrice'),
        onclick: () => {
          working.sellingPrice = price;
          priceInput.value = String(price);
          markDirty();
          repaint();
          // The button has just gone (the price is now in use): keep the focus in the box
          // that says so, not lost to the page.
          try { suggestion.focus({ preventScroll: true }); } catch (e) { /* best-effort */ }
        },
      }));
  }

  const targetInput = numberInput('fcTarget', t('fc.foodCostTargetAs'),
    working.foodCostTarget, v => { working.foodCostTarget = v; });

  function numberInput(id, label, value, set) {
    return el('input', {
      id, class: 'fc-input fc-number', type: 'number', min: '0', step: 'any',
      inputmode: 'decimal', placeholder: '0', 'aria-label': label,
      value: value === null || value === undefined ? '' : String(value),
      oninput: e => {
        e.target.classList.remove('fc-invalid');
        const raw = e.target.value;
        set(raw === '' ? null : Number(raw));
        markDirty();
        repaint();
      },
    });
  }

  function field(labelText, input, note) {
    return el('div', { class: 'fc-field' }, [
      el('label', { class: 'fc-label', for: input.id, text: labelText }),
      input,
      note ? el('p', { class: 'fc-note', text: note }) : null,
    ]);
  }

  function repaint() {
    // The pieces field exists for what is sold by the piece, or by a pack counted in
    // pieces; for anything else it is a number that would mean nothing and invite being
    // filled in.
    piecesField.hidden = !(working.sellingMode === 'piece'
      || (working.sellingMode === 'pack' && working.packUnit === 'pcs'));
    packField.hidden = working.sellingMode !== 'pack';
    addLineBtn.textContent = working.components.length ? t('fc.addRecipeOrIngredient') : t('fc.addRecipe');
    packagingQty.textContent = t('fc.packagingQtyFor', { per: t(PACKAGING_PER[working.sellingMode] || 'fc.packagingPer.unit') });
    packagingQty.hidden = !working.packaging.length;
    repaintLines();
    paintAnswer();
  }

  function validateUI() {
    nameInput.classList.toggle('fc-invalid', showErrors && !String(working.name || '').trim());
  }

  // ── Save / delete ──────────────────────────────────────────────────────────
  // Each number the rules range-check, with the box it is typed in and the words that name it.
  const NUMBER_BOXES = {
    piecesPerBatch: [piecesInput, 'fc.howManyPiecesCome'],
    packSize: [packSizeInput, 'fc.packHoldsAs'],
    labourMinutes: [labourMinutesInput, 'fc.labourMinutes'],
    labourPeople: [labourPeopleInput, 'fc.labourPeople'],
    sellingPrice: [priceInput, 'fc.sellingPriceIncludingVat'],
    vatRate: [vatOther, 'fc.anotherVatRateAs'],
    foodCostTarget: [targetInput, 'fc.foodCostTargetAs'],
  };

  async function onSave() {
    if (busy) return;
    // The ONE required field. Everything else may be missing — the answer panel
    // says what, and refusing the save would mean losing the work.
    if (!String(working.name || '').trim()) {
      showErrors = true;
      validateUI();
      nameInput.focus();
      app.toast(t('fc.pleaseEnterAProduct'));
      return;
    }
    // ⚠️⚠️ A NUMBER THE DATABASE WILL REFUSE STOPS THE SAVE HERE, WHILE THE WORK IS ON SCREEN
    // (js/foodcost/product-limits.js). Past this point the save is local-first: the editor
    // leaves, the refusal arrives later, and the rollback throws the product away.
    // A value in a box that is not shown (pieces on a product sold by weight) means nothing,
    // so it is cleared rather than asked about — nobody could find the box to correct it.
    let invalid = firstInvalidNumber(working);
    while (invalid && NUMBER_BOXES[invalid] && NUMBER_BOXES[invalid][0].closest('[hidden]')) {
      working[invalid] = null;
      invalid = firstInvalidNumber(working);
    }
    if (invalid) {
      const [box, labelKey] = NUMBER_BOXES[invalid] || [null, null];
      box?.classList.add('fc-invalid');
      try { box?.focus(); } catch (e) { /* focus is best-effort */ }
      app.toast(t('fc.checkNumber', { field: labelKey ? t(labelKey) : invalid }));
      return;
    }

    busy = true;
    const ok = await app.confirm({ title: t('fc.saveProduct'), message: t('fc.saveTheseChanges'), okLabel: t('ui.save'), cancelLabel: t('ui.cancel') });
    if (!ok) { busy = false; return; }

    const clean = { ...working, name: String(working.name).trim() };
    // The weighings typed on this product's recipe lines, which Save writes onto the
    // RECIPES — and the tables the answer is worked out from, with them in.
    const patches = weighingPatches(app.tables().recipes, weighings,
      clean.components.filter(c => c.recipeId).map(c => c.recipeId));
    const live = withWeighings(app.tables(), patches);
    // A margin is recorded only when the PRICE or the COMPOSITION changed, and only
    // when there is a real answer to record. Renaming a product records nothing —
    // a history of non-events cannot answer "when did this change?".
    // ⚠️ A WEIGHING COUNTS AS A CHANGE: it is typed on this very screen, on purpose,
    // and it moves what this product costs. The OTHER products using the same recipe
    // record no point — the same gap as an ingredient price drifting, and written down
    // in foodcost-model.js for the same reason.
    const result = costProduct(clean, live);
    const worthRecording = snapshotWorthTaking(product, clean) || Object.keys(patches).length > 0;
    const snapshot = result.foodCostPct !== null && worthRecording
      ? productSnapshot(clean, result, new Date().toISOString(), live)
      : null;

    dirty = false;
    app.saveProduct(clean, snapshot, patches);
    app.toast(product ? t('fc.productSaved') : t('fc.productAdded'));
    app.showList();
  }

  async function onDelete() {
    if (busy) return;
    busy = true;
    const ok = await app.confirm({
      title: t('fc.deleteProduct'),
      message: t('fc.deleteProductQ', { name: product.name || t('fc.thisProduct') }),
      okLabel: t('ui.delete'), danger: true,
      cancelLabel: t('ui.cancel'),
    });
    if (!ok) { busy = false; return; }
    dirty = false;
    app.deleteProduct(product.id);
    app.toast(t('fc.productDeleted'));
    app.showList();
  }

  app.setLeaveGuard(async () => {
    if (!dirty) return true;
    return app.confirm({
      title: t('fc.discardChanges'), message: t('fc.youHaveUnsavedChanges'),
      okLabel: t('ui.discard'), danger: true,
      cancelLabel: t('ui.cancel'),
    });
  });

  const historyBtn = product
    ? el('button', { class: 'fc-link', type: 'button', text: t('fc.marginHistory'),
      onclick: () => app.openHistory(product) })
    : null;

  repaint();

  const root = el('div', { class: 'fc-view fc-editor' }, [
    prodCost,
    answer,

    el('div', { class: 'fc-field' }, [
      el('label', { class: 'fc-label', for: 'fcName', text: t('fc.name') }),
      nameInput,
      nameSuggest.node,
      nameNote,
    ]),

    el('h2', { class: 'fc-section', text: t('fc.madeOf') }),
    madeOf,

    el('h2', { class: 'fc-section', text: t('fc.packaging') }),
    packagingQty,
    packagingRows,
    el('button', { class: 'fc-add-row', type: 'button', text: t('fc.addPackaging'), onclick: () => addPackaging() }),
    el('p', { class: 'fc-note', text: t('fc.packagingPerNote') }),

    el('h2', { class: 'fc-section', text: t('fc.labour') }),
    el('div', { class: 'fc-labour-pair' }, [
      field(t('fc.labourMinutes'), labourMinutesInput),
      field(t('fc.labourPeople'), labourPeopleInput),
    ]),
    el('p', { class: 'fc-note', text: t('fc.labourNote') }),
    labourNote,

    el('h2', { class: 'fc-section', text: t('fc.howItIsSold') }),
    field(t('fc.sold'), modeSelect),
    packField,
    piecesField,
    // ⚠️ IN THE ORDER THE SUM IS DONE: the VAT and the target first, then the price —
    // with, under it, the price those two suggest (13 Sep 2026).
    vatField,
    vatOther,
    field(t('fc.foodCostTarget'), targetInput,
      t('fc.theShareOfThe')),
    field(t('fc.sellingPriceVat', { currency: currentCurrency() }), priceInput,
      t('fc.thePriceOnThe')),
    suggestion,

    el('div', { class: 'fc-actions' }, [
      el('button', { class: 'fc-save', type: 'button', text: t('ui.save'), onclick: onSave }),
      historyBtn,
      // ⚠️ Owner only. Deleting a product takes its margin history with it, and
      // that history cannot be rebuilt — a snapshot exists only where somebody
      // changed something, on the day they changed it. The trash icons on the
      // component rows above are NOT this: they edit the working copy and touch
      // nothing until Save, so they stay available to everybody.
      product && canManageHere() ? el('button', { class: 'fc-delete', type: 'button', onclick: onDelete }, [
        el('span', { icon: TRASH_SVG, 'aria-hidden': 'true' }), t('fc.deleteProduct2'),
      ]) : null,
    ]),
  ]);

  return {
    root,
    // Still exactly as it arrived: nothing typed ever, and no Save under way.
    isUntouched: () => !touched && !busy,
    // ⚠️ WITHOUT THIS THE LINES ARE DRAWN ONCE, FROM WHATEVER HAD ARRIVED.
    // The recipe and ingredient listeners are still in flight while this screen is
    // being opened — on a cold start, offline, or a slow network — so a line could name
    // «this recipe no longer exists» for a recipe that is merely late, and it would STAY
    // that way for as long as the screen was open.
    //
    // The rows are left alone while somebody is typing in one of them: rebuilding
    // an input under the finger loses the focus and the half-typed number — and that
    // includes the weighings, which since 13 Sep 2026 sit in their own container at the
    // end of the card. The answer panel is always safe to repaint — it holds no input.
    refreshData() {
      const typing = componentRows.contains(document.activeElement)
        || weighRows.contains(document.activeElement)
        || packagingRows.contains(document.activeElement);
      if (!typing) {
        repaintLines();
        paintAnswer();
      } else {
        refreshLive();
      }
    },
  };
}
