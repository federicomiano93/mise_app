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
import { revealField } from '../reveal-field.js';
import { ingredientDisplayName } from '../ingredient-name.js';
import { canManageHere } from './firebase-foodcost.js';
import { el } from './dom.js';
import {
  vatRatesFor, vatSelection, costProduct, productionCost, blockerText,
  snapshotWorthTaking, productSnapshot, normalizeProduct, suggestedGrossPrice,
  ingredientLineCost, packagingLineCost, productsUsingRecipe, LINE_UNITS, PACK_UNITS, productPreview,
} from './foodcost-model.js';
import { lineCostView } from './line-cost.js';
import { previewPanel } from './preview-view.js';
import { fcMoney, fcNumber, weighingParams } from './fc-number.js';
import { openVatGuide } from './vat-guide-view.js';
import { firstInvalidNumber } from './product-limits.js';
// ⚠️ READ WHERE THE FIELD IS DRAWN, never at module load: the venue — and therefore
// its country, and therefore its currency — arrives with the session, after every
// module has been evaluated. See js/currency.js.
import { currentCurrency } from '../currency.js';
import { costPerKg } from './per-kg-model.js';
import { costRecipe } from '../catalogue/recipe-cost-model.js';
// Pure models only, like recipe-cost-model.js above: what a typed name matches, and how
// search text is compared. The screens that SHOW the choices are shared, in js/ root.
import { suggestLinks, normalizeSearchText } from '../catalogue/catalogue-model.js';
import { attachSuggestions } from '../pick-suggest.js';
import { openPickScreen } from '../pick-screen.js';
import {
  startWeighing, typeRaw, typeCooked, readWeighing, withWeighings, weighingPatches,
  weighingsChangeCost, otherProductsUsing,
} from './foodcost-weighing.js';
import { KILO_LINE_UNITS, kilosFromTyped, typedFromKilos, tooMuchOfRecipe } from './line-quantity.js';
import { wholeRecipeKg } from './from-recipes.js';
import {
  perKgWeightText, showsPiecesField, readProduct, readMadeOf, readWeighings, readPackaging,
  readLabour, readPrice, recipeQtyText,
} from './read-sections.js';

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

// Why a «Cost per 1 kg» row is shown but not counted — keys, resolved at draw time.
const PER_KG_REASON_TEXT = {
  'no-price': 'fc.perKg.noPrice',
  'not-weighed': 'fc.perKg.notWeighed',
  'no-recipe': 'fc.perKg.noRecipe',
  'no-piece-weight': 'fc.perKg.noPieceWeight',
  'no-piece-price': 'fc.perKg.noPiecePrice',
};

const CHEVRON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

// A count of pieces in one kilo, two decimals like every figure here; a box shared by many
// kilos reads «< 0,01», so a counted cost never sits beside «0,00 pz».
function perKgPiecesText(pcs) {
  return fcNumber(pcs);
}

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
//
// `mode` (7 Nov 2026): 'read' is the plain-text card, 'edit' the form, and 'auto' reads a stored
// product that has a summary to show and opens everything else — a new product, a draft, a
// product with nothing priced yet — straight in the form, because there is nothing to read.
export function renderEditor({ product, draft = null, app, mode: wanted = 'auto' }) {
  // A working COPY. Nothing reaches the stored product until Save.
  const working = product
    ? JSON.parse(JSON.stringify(normalizeProduct(product)))
    : draft && normalizeProduct(draft)
      ? JSON.parse(JSON.stringify({ ...normalizeProduct(draft), id: null }))
      : {
        id: null, name: '', components: [], packaging: [],
        sellingMode: null, piecesPerBatch: null, packSize: null, packUnit: null, sellingPrice: null,
        vatRate: null, foodCostTarget: null, noWeightLoss: false,
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
  // The unit each RECIPE line's amount is typed in — memory only, never saved. Keyed by the
  // line's own object, which survives every rebuild of the rows, and gone with the line.
  const lineUnits = new WeakMap();

  function weighingOf(recipeId) {
    // An untouched line is read again from the recipe every time, so a weighing saved
    // on another phone shows up here; only a line a person has typed on is kept.
    if (!weighings[recipeId] || !weighings[recipeId].touched) {
      weighings[recipeId] = startWeighing(app.tables().recipes[recipeId]);
    }
    return weighings[recipeId];
  }

  // What Save would write onto the recipes, right now.
  // ⚠️ NONE FOR A FINISHED PRODUCT: its boxes are not drawn, and a weighing typed before the
  // switch was turned on must not reach the recipe, nor the figures on this screen.
  function currentPatches() {
    if (working.noWeightLoss) return {};
    return weighingPatches(app.tables().recipes, weighings, recipeIdsOn(working.components));
  }

  // ⚠️ EVERY NUMBER ON THIS SCREEN COMES FROM HERE: the stored recipes with the weighings
  // typed on this product laid over them. Reading app.tables() directly would keep
  // showing the old cost per kilo until after Save.
  function liveTables() {
    return withWeighings(app.tables(), currentPatches());
  }

  // Read or edit. 'auto' decides on the summary: it shows once something is costed.
  const summaryShows = (() => {
    try { return productionCost(working, liveTables()).batchCost !== null; } catch (e) { return false; }
  })();
  const mode = wanted === 'read' || wanted === 'edit' ? wanted : (product && summaryShows ? 'read' : 'edit');
  const isRead = mode === 'read';

  // One recipe's two weighings. `titled` names the recipe, when the product has more than
  // one and the boxes would otherwise not say whose dough they are.
  function weighBlock(id, titled) {
    // ⚠️ NO BOXES WHERE THEIR SAVE WOULD BE REFUSED: a venue with the catalogue switched
    // off can read its recipes here but not write them (canWriteRecipes() says why).
    if (!id || !app.tables().recipes[id] || !app.canWeigh()) return null;
    // A finished product loses nothing in the oven: nothing to weigh.
    if (working.noWeightLoss) return null;
    const box = (label, onType) => el('input', {
      class: 'fc-input fc-number', type: 'number', min: '0', step: 'any',
      inputmode: 'decimal', placeholder: '0', 'aria-label': label,
      oninput: e => { weighings[id] = onType(weighingOf(id), e.target.value); markDirty(); refreshLive(); },
    });
    const rawInput = box(t('fc.rawDough'), typeRaw);
    const cookedInput = box(t('fc.cookedDough'), typeCooked);
    const out = el('p', { class: 'fc-weigh-out' });
    // A live region, hidden while empty: the sentence is heard the moment it appears.
    const warn = el('p', { class: 'fc-weigh-warn', 'aria-live': 'polite' });
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
      if (focused !== view.rawInput) view.rawInput.value = state.raw > 0 ? String(state.raw) : '';
      if (focused !== view.cookedInput) view.cookedInput.value = state.cooked > 0 ? String(state.cooked) : '';
      view.out.textContent = t(shown.message.key, weighingParams(shown.message.params));
      view.warn.textContent = shown.warning ? t(shown.warning.key, weighingParams(shown.warning.params)) : '';
      view.warn.hidden = !shown.warning;
      // ⚠️ THE COOKED BOX STAYS RED FOR AS LONG AS ITS WARNING STANDS (Federico, Nov 2026:
      // «deve restare rosso»): the sentence alone, under the pair, was easy to miss.
      view.cookedInput.classList.toggle('fc-invalid', !!shown.warning);
      // Said to a screen reader too: the red frame alone is only for the eyes.
      if (shown.warning) view.cookedInput.setAttribute('aria-invalid', 'true');
      else view.cookedInput.removeAttribute('aria-invalid');
      // ⚠️ SAID THE MOMENT IT BECOMES TRUE: the loss belongs to the recipe, so a
      // weighing typed on this product changes every other product built on it, and
      // nobody opening those would know why their cost moved.
      // (Not for a kept wrong pair: the loss stays what it was, so nobody else's cost moves.)
      const others = shown.patch && !shown.keepsOnly ? otherProductsUsing(app.products(), view.id, working.id) : 0;
      view.shared.textContent = others ? t('fc.lossSharedWith', { n: others }) : '';
      view.shared.hidden = !others;
    }
  }

  // The weighings on screen whose boxes carry a warning, with the box to point at. Both
  // warnings (cooked heavier than raw, a loss past the cap) are about the cooked weight.
  function weighWarnings() {
    const out = [];
    for (const view of weighViews) {
      const recipe = app.tables().recipes[view.id];
      if (!recipe) continue;
      const { warning } = readWeighing(recipe, weighingOf(view.id));
      if (warning) out.push({ box: view.cookedInput, name: String(recipe.name || '').trim(), warning });
    }
    return out;
  }

  // After a keystroke in a weighing: every figure that depends on it, and nothing that
  // holds an input — rebuilding the rows here would take the box from under the finger.
  function refreshLive() {
    const tables = liveTables();
    // The money under each line moves with the oven loss too (a recipe's rate per kilo).
    for (const { note, cost, entry, kind } of lineNotes) {
      cost.textContent = lineCost(entry, kind, tables).text;
      note.textContent = lineNote(entry, kind, tables);
    }
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
        el('span', { class: 'fc-prodcost-num', text: fcMoney(perUnit ? cost.unitCost : cost.batchCost) }),
        el('span', { class: 'fc-prodcost-unit', text: perUnit
          ? t(UNIT_TEXT[cost.unit])
          : t('fc.wholeBatchWord') }),
      ]),
    ]));
    if (perUnit) {
      prodCost.appendChild(el('p', { class: 'fc-answer-basis', text: t('fc.wholeBatch', { cost: fcMoney(cost.batchCost) }) }));
    }
    // The work, beside the materials — drawn only when there is a figure, which needs the
    // hourly rate, which only whoever runs the place is ever sent.
    if (cost.labourUnitCost !== null) {
      prodCost.appendChild(el('p', { class: 'fc-answer-basis', text: t('fc.costSplit', {
        materials: fcMoney(cost.unitCost), labour: fcMoney(cost.labourUnitCost),
      }) }));
      prodCost.appendChild(el('p', { class: 'fc-answer-basis', text: t('fc.costTotal', {
        total: fcMoney(cost.totalUnitCost), unit: t(UNIT_TEXT[cost.unit]),
      }) }));
    }
    // ⚠️ THE SAME RULE AS THE ANSWER BELOW: a partial cost is always too LOW, so it may
    // never be shown without saying so.
    if (cost.partial) prodCost.appendChild(el('p', { class: 'fc-answer-partial', text: t('fc.costPartial') }));
  }

  // ── Cost of one kilo of the finished product, line by line ─────────────────
  // ⚠️ Its own box, apart from «Composto da». It was «no money there» (13 Sep 2026) until
  // Federico reversed it on 7 Nov 2026 («il costo dell'ingrediente al kg e il costo della
  // quantità selezionata»: each line now shows its rate and cost, see line-cost.js); this box
  // stays as the whole product's cost per kilo. The
  // element is created ONCE so it keeps open/closed through every repaint; only its
  // inner content is replaced.
  // ⚠️ THE SUMMARY IS BUILT ONCE TOO, and only its figure is rewritten: a tapped summary
  // holds the focus, and the data listeners repaint this box at any moment (refreshData).
  const perKgNum = el('span', { class: 'fc-perkg-num' });
  const perKgBody = el('div', { class: 'fc-perkg-body' });
  const perKg = el('details', { class: 'fc-perkg' }, [
    el('summary', { class: 'fc-perkg-summary' }, [
      el('span', { text: t('fc.perKg.title') }),
      el('span', { class: 'fc-perkg-sum' }, [
        perKgNum,
        el('span', { class: 'fc-perkg-chevron', icon: CHEVRON_SVG }),
      ]),
    ]),
    perKgBody,
  ]);

  function paintPerKg(tables) {
    // ⚠️ A FAULT HERE MUST NOT TAKE THE CARD DOWN (P17): the box is a reading aid, and the
    // food cost answer and the editor are painted after it.
    let res;
    try { res = costPerKg(working, tables); } catch (e) { res = { total: null }; }
    perKg.hidden = res.total === null;
    perKgBody.replaceChildren();
    if (res.total === null) return;
    perKgNum.textContent = fcMoney(res.total);

    const list = el('ul', { class: 'fc-perkg-list' });
    res.rows.forEach(row => {
      const parts = [];
      const hasKg = row.kg !== null && row.kg !== undefined;
      const hasPcs = row.pcs !== null && row.pcs !== undefined;
      if (hasKg && !(row.kind === 'piece' && hasPcs)) parts.push(perKgWeightText(row.kg));
      else if (hasPcs) parts.push(t('fc.perKg.pieces', { n: perKgPiecesText(row.pcs) }));
      if (row.reason) parts.push(t(PER_KG_REASON_TEXT[row.reason]));
      else if (row.pricePerKg !== null && row.pricePerKg !== undefined) parts.push(`${fcMoney(row.pricePerKg)} / kg`);
      else if (row.priceEach !== null && row.priceEach !== undefined) parts.push(t('price.perEach', { rate: fcMoney(row.priceEach) }));
      list.appendChild(el('li', { class: 'fc-perkg-row' }, [
        el('span', { class: 'fc-perkg-name', text: row.name }),
        // Federico, 8 Nov 2026: rows and total are both shown in cents. The total is worked out from
        // the exact values, so the rows may differ from it by a cent; that is accepted.
        row.reason ? null : el('span', { class: 'fc-perkg-cost', text: fcMoney(row.cost) }),
        el('span', { class: 'fc-perkg-detail', text: parts.join(' · ') }),
      ]));
    });

    perKgBody.appendChild(list);
    perKgBody.appendChild(el('div', { class: 'fc-perkg-total' }, [
      el('span', { text: t('fc.perKg.total') }),
      el('span', { class: 'fc-perkg-num', text: fcMoney(res.total) }),
    ]));
    // ⚠️ NEUTRAL, NOT «IT COSTS MORE»: a row with no price adds neither cost nor weight in
    // the cost model, so the figure can be too high (water not linked) as well as too low.
    if (res.partial) perKgBody.appendChild(el('p', { class: 'fc-answer-partial', text: t('fc.perKg.partial') }));
    if (res.packagingLeftOut) perKgBody.appendChild(el('p', { class: 'fc-note', text: t('fc.perKg.packagingLeftOut') }));
    if (res.lossy) perKgBody.appendChild(el('p', { class: 'fc-note', text: t('fc.perKg.lossNote') }));
  }

  // ── The answer, live ───────────────────────────────────────────────────────
  const answer = el('div', { class: 'fc-answer' });

  // The preview at the top of the card (Federico, 7 Nov 2026): same numbers as the phone's
  // preview dialog. A fault here must not take the card down (P17).
  const summary = el('div', { class: 'fc-summary' });
  // Whether its «Dettagli» is open: the panel is rebuilt on every keystroke, this is not.
  let summaryMoreOpen = false;
  // …and whether its «Which?» list is.
  let summaryWhichOpen = false;

  function paintSummary(tables) {
    try {
      summary.hidden = productionCost(working, tables).batchCost === null;
      if (summary.hidden) { summary.replaceChildren(); return; }
      summary.replaceChildren(previewPanel(productPreview(working, tables), {
        caption: true, showMissing: false,
        moreOpen: summaryMoreOpen, onMoreToggle: (open) => { summaryMoreOpen = open; },
        whichOpen: summaryWhichOpen, onWhichToggle: (open) => { summaryWhichOpen = open; },
      }));
    } catch (e) {
      summary.hidden = true;
      summary.replaceChildren();
    }
  }

  function labourNoteText(tables) {
    return working.labourMinutes > 0 && app.mayManage() && !(Number(tables.labourCostPerHour) > 0)
      ? t('fc.labourSetRate') : '';
  }

  function paintAnswer() {
    const tables = liveTables();
    paintProductionCost();
    paintSuggestion(tables);
    paintPerKg(tables);
    paintSummary(tables);
    // Minutes typed but no rate to turn them into money: say where the rate is set — and
    // only to somebody who can set it; an employee is simply shown no labour money.
    labourNote.textContent = labourNoteText(tables);
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
      el('span', { class: 'fc-answer-value', text: `${fcNumber(result.foodCostPct)}%` }),
    ]));

    answer.appendChild(el('p', { class: 'fc-answer-basis', text: t('fc.answerBasis', {
      cost: fcMoney(result.unitCost),
      unit: unitWord(working.sellingMode),
      net: fcMoney(result.netUnitPrice),
      margin: fcMoney(result.margin),
    }) }));

    if (status) answer.appendChild(el('p', { class: 'fc-answer-status', text: t(STATUS_TEXT[status]) }));

    // ⚠️ BESIDE THE FOOD COST, NEVER INSIDE IT: the percentage above stays what the
    // ingredients and packaging take; this says what the work takes, and everything.
    if (result.labourPct !== null) {
      answer.appendChild(el('p', { class: 'fc-answer-basis', text: t('fc.labourPctLine', {
        labour: fcNumber(result.labourPct), total: fcNumber(result.totalCostPct),
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

  // «Finished product, no weight loss» (Federico, Nov 2026): a product that is bought in, or
  // finished some other way, loses nothing in the oven, so the loss of its recipes is laid
  // aside for THIS product's cost only. The same switch as every settings screen (tokens.css
  // .set-switch), drawn first in the weighings' container so it sits at the end of the card
  // and governs the boxes under it. It is part of the product: it edits the working copy and
  // Save commits it. Shown only while the product has a recipe line — an ingredient has no
  // oven loss to set aside.
  const noLossInput = el('input', {
    type: 'checkbox', role: 'switch', 'aria-label': t('fc.noWeightLoss'), 'aria-describedby': 'fcNoWeightLossHint',
  });
  noLossInput.checked = working.noWeightLoss === true;
  noLossInput.addEventListener('change', () => {
    working.noWeightLoss = noLossInput.checked;
    markDirty();
    repaint();
    // ⚠️ THE REPAINT TAKES THE SWITCH'S ROW OUT OF THE PAGE AND PUTS IT BACK, and the focus
    // falls to the body with it: a keyboard or screen-reader user toggling with Space would
    // lose their place (P18). Put it back on the switch.
    try { noLossInput.focus({ preventScroll: true }); } catch (e) { /* best-effort */ }
  });
  const noLossRow = el('div', { class: 'set-row fc-noloss' }, [
    el('span', { class: 'set-text' }, [
      el('span', { class: 'set-title', text: t('fc.noWeightLoss') }),
      el('span', { class: 'set-sub', id: 'fcNoWeightLossHint', text: t('fc.noWeightLossHint') }),
    ]),
    el('label', { class: 'set-switch' }, [noLossInput, el('span', { class: 'set-switch-track', 'aria-hidden': 'true' })]),
  ]);
  const addLineBtn = el('button', { class: 'fc-add-row', type: 'button', onclick: () => addLine() });
  // The weighings sit in the SAME card as the lines, under their own sub-heading (7 Nov 2026).
  const madeOf = el('div', { class: 'fc-madeof' }, [componentRows, addLineBtn]);
  const weighHead = el('h3', { class: 'fc-subsection', text: t('fc.section.weighing') });

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
            // ⚠️ NO PRICE IN THE CHOOSER (Federico, 13 Sep 2026). Since 7 Nov 2026 the LINES of
            // «Composto da» show their money (line-cost.js); the list a line is picked from does not.
            items: app.ingredientOptions().filter(o => matches(o.name) || matches(o.invoiceName))
              .map(o => ({ name: o.name, meta: o.meta, value: { kind: 'ingredient', id: o.id } })),
          });
        }
        if (mode === 'packaging') {
          out.push({
            heading: '',
            items: app.packagingOptions().filter(o => matches(o.name) || matches(o.invoiceName))
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
    return item ? { text: ingredientDisplayName(item).trim(), missing: false } : { text: t('fc.thisItemNoLonger'), missing: true };
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
    // ⚠️ A RECIPE LINE IS STORED IN KILOS, WHATEVER THE BOX SHOWS — but the box OPENS IN GRAMS,
    // every time, since 8 Nov 2026. Production showed 16 lines in 11 products 1000× too big:
    // staff typed grams (as in the ingredient lines right below) into a box that opened on kg;
    // and a correct 3.233 kg read as «3.233», which an Italian takes for three thousand.
    // The chosen unit is memory only; the stored value stays `qtyKg`.
    const shownUnit = () => (kind === 'recipe' ? lineUnits.get(entry) || 'g' : null);
    const qty = el('input', {
      class: 'fc-input fc-qty', type: 'number', min: '0', step: 'any',
      inputmode: 'decimal', placeholder: '0',
      value: kind === 'recipe' ? typedFromKilos(entry.qtyKg, shownUnit()) : entry[qtyKey] || '',
      'aria-label': kind === 'ingredient' || kind === 'recipe' ? t('fc.aria.quantity') : t('fc.aria.pieces'),
      // ⚠️ NOT repaint(). That rebuilds every row — THIS BOX INCLUDED — so the finger lost
      // the box after one digit and «1.7» could not be typed at all. Found driving the
      // screen on 13 Sep 2026. A quantity changes three things, and only those are
      // refreshed: this line's money (since 7 Nov 2026), its note and the answer at the top. (`note` is declared below;
      // the handler only ever runs after it exists.)
      oninput: e => {
        entry[qtyKey] = kind === 'recipe' ? kilosFromTyped(e.target.value, shownUnit()) : Number(e.target.value) || 0;
        markDirty();
        cost.textContent = lineCost(entry, kind).text;
        note.textContent = lineNote(entry, kind);
        paintAnswer();
      },
    });

    // An ingredient is added in grams, kilos or pieces, and a recipe in grams or kilos;
    // packaging is always pieces per unit sold.
    let unit;
    if (kind === 'ingredient') {
      unit = el('select', {
        class: 'fc-input fc-select fc-line-unit-select', 'aria-label': t('fc.aria.unit'),
        // ⚠️ Not repaint() either, for the same reason as the quantity box.
        onchange: e => {
          entry.unit = e.target.value; markDirty();
          cost.textContent = lineCost(entry, kind).text; note.textContent = lineNote(entry, kind);
          paintAnswer();
        },
      }, LINE_UNITS.map(u => el('option', { value: u }, u === 'pcs' ? t('fc.unit.pieces') : u)));
      unit.value = entry.unit;
    } else if (kind === 'recipe') {
      unit = el('select', {
        class: 'fc-input fc-select fc-line-unit-select', 'aria-label': t('fc.aria.unit'),
        // ⚠️ Not repaint() either. Switching the unit KEEPS THE TYPED NUMBER and changes what it
        // means (owner, 8 Nov 2026: «quando cambio da kg a g la quantità non deve cambiare»):
        // 522 in g → kg still shows 522 and stores 522 kg. So the stored kilos DO change, and
        // the money, the note and the answer are refreshed like the box's own oninput does.
        onchange: e => {
          const typed = qty.value;
          lineUnits.set(entry, e.target.value);
          const kilos = kilosFromTyped(typed, shownUnit());
          if (kilos === entry.qtyKg) return;
          entry.qtyKg = kilos;
          markDirty();
          cost.textContent = lineCost(entry, kind).text;
          note.textContent = lineNote(entry, kind);
          paintAnswer();
        },
      }, KILO_LINE_UNITS.map(u => el('option', { value: u }, u)));
      unit.value = shownUnit();
    } else {
      unit = el('span', { class: 'fc-line-unit', text: t('fc.unit.pieces') });
    }

    const remove = el('button', {
      class: 'fc-del-icon', type: 'button', icon: TRASH_SVG,
      'aria-label': kind === 'recipe' ? t('fc.removeRecipe') : kind === 'ingredient' ? t('fc.removeIngredient') : t('fc.removePackagingItem'),
      onclick: () => { list.splice(index, 1); markDirty(); repaint(); },
    });

    const cost = el('p', { class: 'fc-line-cost', text: lineCost(entry, kind).text });
    const note = el('p', { class: 'fc-line-note', text: lineNote(entry, kind) });
    lineNotes.push({ note, cost, entry, kind });

    return el('div', { class: 'fc-line' }, [
      el('div', { class: 'fc-line-row' }, [nameBtn, remove]),
      el('div', { class: 'fc-line-row fc-line-qtyrow' }, [qty, unit]),
      cost,
      note,
    ]);
  }

  // The money under a line: its rate and what the amount typed costs (line-cost.js). Its own
  // element above the note, drawn and refreshed wherever the note is.
  // ⚠️ A FAULT HERE MUST NOT TAKE THE LINES DOWN (P17): the money is a reading aid, drawn inside
  // every row; on a fault the line simply shows none, like paintPerKg and paintSummary.
  function lineCost(entry, kind, tables = liveTables()) {
    try {
      return lineCostView(entry, kind, tables, { noWeightLoss: working.noWeightLoss === true });
    } catch (e) {
      return { text: '', noPrice: false };
    }
  }

  // What a person must ACT on, under the money. Where the money line already says «No price»,
  // the note that said the same thing is left out: one sentence, not two.
  function lineNote(entry, kind, tables = liveTables()) {
    if (kind === 'recipe') {
      const recipe = tables.recipes[entry.recipeId];
      if (!recipe) return entry.recipeId ? t('fc.thisRecipeNoLonger') : '';
      // ⚠️ MONEY UNDER A RECIPE LINE SINCE 7 NOV 2026 (see line-cost.js) — it used to be none:
      // Federico, 13 Sep 2026, «nella sezione "composto da" non mostrare il prezzo»; reversed by
      // him on 7 Nov 2026, «il costo dell'ingrediente al kg e il costo della quantità
      // selezionata». The money is NOT drawn here: this is the note under it. What stays is a
      // recipe priced in part, because a silent gap is a cost too low.
      const costed = costRecipe(recipe, tables);
      const partly = costed.pricePerKg !== null && costed.partial ? t('fc.thisRecipePartlyPriced') : '';
      // A NOTE only, never a block: more than 20 whole batches is almost surely grams typed as kilos.
      const whole = wholeRecipeKg(recipe);
      const tooMuch = tooMuchOfRecipe(entry.qtyKg, whole)
        ? t('fc.line.tooMuchRecipe', {
          qty: recipeQtyText(entry.qtyKg), whole: recipeQtyText(whole), grams: recipeQtyText(entry.qtyKg / 1000),
        })
        : '';
      return [tooMuch, partly].filter(Boolean).join(' ');
    }
    const ingredient = tables.ingredients[entry.ingredientId];
    if (!ingredient) return entry.ingredientId ? t('fc.thisItemNoLonger') : '';
    if (kind === 'ingredient') {
      const line = ingredientLineCost(entry, ingredient);
      return line.reason && line.reason !== 'no-ingredient-price' ? t(LINE_REASON_TEXT[line.reason]) : '';
    }
    // Counted in pieces, so it has to be BOUGHT by the piece. Said plainly rather than silently
    // costing nothing; a packaging item with no price at all is «No price» above instead.
    return packagingLineCost(entry, ingredient).reason === 'no-piece-price' ? t('fc.pricedByWeightSet') : '';
  }

  // ── The plain-text view ────────────────────────────────────────────────────
  // One box per section, filled by paintRead(); the builders are read-sections.js's.
  const readBoxes = {
    product: el('div', { class: 'fc-read-box' }),
    madeOf: el('div', { class: 'fc-read-box' }),
    weighings: el('div', { class: 'fc-read-box' }),
    packaging: el('div', { class: 'fc-read-box' }),
    labour: el('div', { class: 'fc-read-box' }),
    price: el('div', { class: 'fc-read-box' }),
  };

  function paintRead() {
    const tables = liveTables();
    const recipeIds = [...new Set(recipeIdsOn(working.components))];
    readBoxes.product.replaceChildren(readProduct(working));
    readBoxes.madeOf.replaceChildren(readMadeOf({
      components: working.components, lineName, lineNote: (entry, kind) => lineNote(entry, kind, tables),
      lineCost: (entry, kind) => lineCost(entry, kind, tables).text,
    }));
    readBoxes.weighings.replaceChildren(readWeighings({
      noWeightLoss: working.noWeightLoss === true, recipes: app.tables().recipes, recipeIds,
    }));
    weighHead.hidden = !recipeIds.length;
    readBoxes.weighings.hidden = !recipeIds.length;
    readBoxes.packaging.replaceChildren(readPackaging({
      packaging: working.packaging, lineName, lineNote: (entry, kind) => lineNote(entry, kind, tables),
      lineCost: (entry, kind) => lineCost(entry, kind, tables).text,
    }));
    readBoxes.labour.replaceChildren(readLabour({
      minutes: working.labourMinutes, people: working.labourPeople, note: labourNoteText(tables),
    }));
    readBoxes.price.replaceChildren(readPrice({
      vatRate: working.vatRate, target: working.foodCostTarget, price: working.sellingPrice,
    }));
  }

  function repaintLines() {
    if (isRead) { paintRead(); return; }
    weighViews = [];
    lineNotes = [];
    componentRows.replaceChildren(...working.components.map((entry, index) =>
      lineRow({ list: working.components, index, entry, kind: entry.kind === 'ingredient' ? 'ingredient' : 'recipe' })));
    // One pair of weighings per RECIPE, however many lines carry it.
    const recipeIds = [...new Set(recipeIdsOn(working.components))];
    // The sub-heading only when there is something under it.
    weighHead.hidden = !recipeIds.length;
    weighRows.replaceChildren(
      ...(recipeIds.length ? [noLossRow] : []),
      ...recipeIds.map(id => weighBlock(id, recipeIds.length > 1)).filter(Boolean),
    );
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
        el('span', { class: 'fc-prodcost-num', text: fcMoney(price) }),
        el('span', { class: 'fc-prodcost-unit', text: t(UNIT_TEXT[cost.unit]) }),
      ]),
    ]));
    suggestion.appendChild(el('p', { class: 'fc-answer-basis', text: t('fc.suggestedPriceBasis', {
      vat: fcNumber(working.vatRate), target: fcNumber(working.foodCostTarget),
    }) }));
    // ⚠️ THE SAME RULE AS THE COST ABOVE: a partly priced product costs more than it says,
    // so the price that would hit the target is HIGHER than this one — say so.
    if (cost.partial) suggestion.appendChild(el('p', { class: 'fc-answer-partial', text: t('fc.suggestedPricePartial') }));

    const inUse = working.sellingPrice !== null && Math.abs(working.sellingPrice - price) < 0.005;
    // ⚠️ THE READ VIEW HAS NO «USE THIS PRICE»: nothing there can be changed.
    if (isRead) {
      if (inUse) suggestion.appendChild(el('p', { class: 'fc-note', text: t('fc.suggestedPriceInUse') }));
      return;
    }
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
    piecesField.hidden = !showsPiecesField(working);
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
      revealField(nameInput);
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
      revealField(box);
      app.toast(t('fc.checkNumber', { field: labelKey ? t(labelKey) : invalid }));
      return;
    }

    // ⚠️ A WRONG WEIGHING NEVER BLOCKS THE SAVE (Federico, Nov 2026: «in ogni caso posso salvare
    // lo stesso»). It is pointed at — scrolled to, framed in red, named — and then the usual
    // confirmation says so in its own words, so one tap on OK saves the numbers as typed.
    const weighIssues = weighWarnings();
    if (weighIssues.length) {
      weighIssues[0].box.classList.add('fc-invalid');
      revealField(weighIssues[0].box);
      app.toast(t('fc.checkWeighing', { name: weighIssues[0].name }));
    }
    const message = weighIssues.length
      ? t('fc.saveWithWeightWarnings', {
        lines: weighIssues.map(issue => t('fc.weightWarningLine', {
          name: issue.name, warning: t(issue.warning.key, weighingParams(issue.warning.params)),
        })).join('\n'),
      })
      : t('fc.saveTheseChanges');

    busy = true;
    const ok = await app.confirm({ title: t('fc.saveProduct'), message, okLabel: t('ui.save'), cancelLabel: t('ui.cancel') });
    if (!ok) { busy = false; return; }

    const clean = { ...working, name: String(working.name).trim() };
    // The weighings typed on this product's recipe lines, which Save writes onto the
    // RECIPES — and the tables the answer is worked out from, with them in.
    // ⚠️ NONE FOR A FINISHED PRODUCT, whatever was typed before the switch went on.
    const weighedIds = clean.noWeightLoss ? [] : clean.components.filter(c => c.recipeId).map(c => c.recipeId);
    const patches = weighingPatches(app.tables().recipes, weighings, weighedIds);
    const live = withWeighings(app.tables(), patches);
    // A margin is recorded only when the PRICE or the COMPOSITION changed, and only
    // when there is a real answer to record. Renaming a product records nothing —
    // a history of non-events cannot answer "when did this change?".
    // ⚠️ A WEIGHING COUNTS AS A CHANGE: it is typed on this very screen, on purpose,
    // and it moves what this product costs. The OTHER products using the same recipe
    // record no point — the same gap as an ingredient price drifting, and written down
    // in foodcost-model.js for the same reason.
    // ⚠️ …BUT NOT A KEPT WRONG PAIR: it writes two numbers and leaves the loss alone, so
    // nothing the product costs moved. And switching «no weight loss» DOES move the cost.
    const result = costProduct(clean, live);
    const worthRecording = snapshotWorthTaking(product, clean)
      || weighingsChangeCost(app.tables().recipes, weighings, weighedIds)
      || (!!product && !!product.noWeightLoss !== !!clean.noWeightLoss);
    const snapshot = result.foodCostPct !== null && worthRecording
      ? productSnapshot(clean, result, new Date().toISOString(), live)
      : null;

    dirty = false;
    // ⚠️ BACK TO THE READ VIEW OF THE SAVED PRODUCT, not the list (7 Nov 2026). saveProduct
    // returns the id — minted for a new product — so the page can find it again.
    const savedId = app.saveProduct(clean, snapshot, patches);
    globalThis.window?.dispatchEvent(new CustomEvent('mise:action', { detail: 'foodcost-saved' }));
    app.toast(product ? t('fc.productSaved') : t('fc.productAdded'));
    app.showSaved(savedId);
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

  // ── The page: the summary, then ONE box «Scheda completa» of framed cards ──────
  // Federico, 7 Nov 2026. Inputs in the order they are filled, results last. The summary is
  // NOT in the box. prodCost, answer, perKg and suggestion keep their classes: drivers outside
  // the repo read them.
  const card = (titleKey, children) => el('section', { class: 'fc-card' }, [
    el('h2', { class: 'fc-section', text: t(titleKey) }),
    ...children,
  ]);

  const cards = isRead ? [
    card('fc.section.product', [readBoxes.product]),
    card('fc.madeOf', [readBoxes.madeOf, weighHead, readBoxes.weighings]),
    card('fc.packaging', [readBoxes.packaging]),
    card('fc.labour', [readBoxes.labour]),
    // The same suggestion box as the form, minus its button (paintSuggestion knows).
    card('fc.section.price', [readBoxes.price, suggestion]),
    card('fc.section.results', [prodCost, answer, perKg]),
  ] : [
    card('fc.section.product', [
      el('div', { class: 'fc-field' }, [
        el('label', { class: 'fc-label', for: 'fcName', text: t('fc.name') }),
        nameInput,
        nameSuggest.node,
        nameNote,
      ]),
      field(t('fc.sold'), modeSelect),
      packField,
      piecesField,
    ]),
    card('fc.madeOf', [madeOf, weighHead, weighRows]),
    card('fc.packaging', [
      packagingQty,
      packagingRows,
      el('button', { class: 'fc-add-row', type: 'button', text: t('fc.addPackaging'), onclick: () => addPackaging() }),
      el('p', { class: 'fc-note', text: t('fc.packagingPerNote') }),
    ]),
    card('fc.labour', [
      el('div', { class: 'fc-labour-pair' }, [
        field(t('fc.labourMinutes'), labourMinutesInput),
        field(t('fc.labourPeople'), labourPeopleInput),
      ]),
      el('p', { class: 'fc-note', text: t('fc.labourNote') }),
      labourNote,
    ]),
    // ⚠️ IN THE ORDER THE SUM IS DONE: the VAT and the target first, then the price —
    // with, under it, the price those two suggest (13 Sep 2026).
    card('fc.section.price', [
      vatField,
      vatOther,
      field(t('fc.foodCostTarget'), targetInput,
        t('fc.theShareOfThe')),
      field(t('fc.sellingPriceVat', { currency: currentCurrency() }), priceInput,
        t('fc.thePriceOnThe')),
      suggestion,
    ]),
    card('fc.section.results', [prodCost, answer, perKg]),
  ];

  // Save (or the pencil) is in the header (foodcost-main.js). History and Delete stay at the
  // bottom of the box, small and low-key, in both views; a new product has neither, so no
  // empty row.
  const actions =
    historyBtn || (product && canManageHere()) ? el('div', { class: 'fc-actions' }, [
      historyBtn,
      // ⚠️ Owner only. Deleting a product takes its margin history with it, and
      // that history cannot be rebuilt — a snapshot exists only where somebody
      // changed something, on the day they changed it. The trash icons on the
      // component rows above are NOT this: they edit the working copy and touch
      // nothing until Save, so they stay available to everybody.
      product && canManageHere() ? el('button', { class: 'fc-delete', type: 'button', onclick: onDelete }, [
        el('span', { icon: TRASH_SVG, 'aria-hidden': 'true' }), t('fc.deleteProduct2'),
      ]) : null,
    ]) : null;

  const body = el('div', { class: 'fc-full-body' }, [...cards, actions]);
  // ⚠️ READ: a closed <details>, built ONCE so it keeps open/closed through every repaint —
  // open from the start only when there is no summary above it (nothing else to show).
  // ⚠️ EDIT: a plain section, never collapsible, so a field Save checks (the name, a number)
  // can never be hidden inside a closed box.
  const full = isRead
    ? el('details', { class: 'fc-full', open: summaryShows ? null : '' }, [
      el('summary', { class: 'fc-full-summary' }, [
        el('span', { text: t('fc.fullCard') }),
        el('span', { class: 'fc-perkg-chevron', icon: CHEVRON_SVG }),
      ]),
      body,
    ])
    : el('section', { class: 'fc-full fc-full--edit' }, [
      el('h2', { class: 'fc-full-summary', text: t('fc.fullCard') }),
      body,
    ]);

  const root = el('div', { class: 'fc-view fc-editor' }, [summary, full]);

  return {
    root,
    mode,
    save: onSave,
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
