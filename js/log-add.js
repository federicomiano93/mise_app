// log-add.js — manual log creation from inside the Log section ("+ Add log"). Lets
// the user pick a recipe, enter quantities (and/or a typed total, by the recipe's
// logic), choose Today/Tomorrow and save a brand-new log exactly like a calculator
// Confirm would (same generic buildSheet + createAndSave). Independent of the
// calculator screen — the recipe and the log stay separate.

import { t } from './i18n.js';
import { el } from './calculator-render.js';
import { getConfig } from './calculator-config-store.js';
import { getRecipes, getRecipeById, getTabProducts, getDivisorIncluded, usesOrders, usesTypedTotal, usesTrays, normalizeTrays, settledTraysText, traysGrams, formatGrams } from './calculator-config.js';
import { logTimestamp } from './log-time.js';
import { confirmDiscard } from './calculator-confirm.js';
import { buildSheet, buildLogText, recipeSnapshot } from './log-model.js';
import { createAndSave } from './log-store.js';
import { qtyRow } from './log-qty.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { recipeToSave } from './calculator-catalogue-link.js';
import { createSaveGuard } from './save-guard.js';
import { revealField } from './reveal-field.js';

// While the save is in flight the header Save is disabled and Back waits (js/save-guard.js).
const saveGuard = createSaveGuard(() => document.getElementById('logadd-save-btn'));

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

let state = null; // { recipeId, forDay, items[], totalInput, dayMissing } or null when closed

export function openLogAdd() {
  state = { recipeId: null, forDay: null, items: [], totalInput: 0, trays: 0, dayMissing: false };
  render();
  document.getElementById('logadd-overlay').classList.add('visible');
}

function isDirty() {
  if (!state) return false;
  return !!(state.recipeId || state.forDay || num(state.totalInput) > 0 || num(state.trays) > 0 || state.items.some(it => num(it.qty) > 0));
}

async function close(saved) {
  if (!saved && saveGuard.saving) return;
  if (!saved && !(await confirmDiscard(isDirty()))) return;
  document.getElementById('logadd-overlay').classList.remove('visible');
  state = null;
}

// Load the chosen recipe's products (quantities start at 0). 'total' recipes have no
// products — only a typed total.
function loadRecipe(id) {
  const recipe = getRecipeById(getConfig(), id);
  state.recipeId = id;
  state.totalInput = 0;
  state.trays = 0;
  const hasOrders = !!recipe && usesOrders(recipe.logic);
  state.items = hasOrders ? getTabProducts(getConfig(), id).map(p => ({
    id: p.id, name: p.name, clientName: p.clientName, weightG: p.weight, kind: p.kind,
    crate: p.crate || { show: false, perBox: 20 }, qty: 0,
  })) : [];
  render();
}

function render() {
  const c = document.getElementById('logadd-content');
  c.textContent = '';
  // The header Save appears only once a recipe is picked (turned on at the end).
  const saveBtn = document.getElementById('logadd-save-btn');
  saveBtn.hidden = true;

  // Recipe chooser (required, first).
  c.appendChild(el('div', { class: 'cp-label' }, t('ui.recipe')));
  const choices = el('div', { class: 'logday-choices' });
  const recipes = getRecipes(getConfig());
  if (!recipes.length) {
    c.appendChild(el('div', { class: 'cp-empty-hint' }, t('calc.noRecipesYetAdd')));
    return;
  }
  for (const r of recipes) {
    const btn = el('button', { class: 'logday-choice' + (state.recipeId === r.id ? ' selected' : ''), type: 'button' }, r.name);
    btn.addEventListener('click', () => loadRecipe(r.id));
    choices.appendChild(btn);
  }
  c.appendChild(choices);

  if (!state.recipeId) {
    c.appendChild(el('div', { class: 'cp-empty-hint' }, t('calc.pickARecipeTo')));
    return;
  }
  const recipe = getRecipeById(getConfig(), state.recipeId);
  const hasOrders = !!recipe && usesOrders(recipe.logic);
  const hasTotal = !!recipe && usesTypedTotal(recipe.logic);
  const hasTrays = !!recipe && usesTrays(recipe.logic);

  // Today / Tomorrow (required).
  c.appendChild(el('div', { class: 'cp-label' }, t('calc.whenIsThisDough')));
  // ⚠️ Save is in the header from the moment a recipe is picked, so it can be tapped with no
  // day chosen: commit() then says so HERE, above the two buttons, and they turn red.
  const dayMissing = state.dayMissing && !state.forDay;
  if (dayMissing) c.appendChild(el('div', { class: 'logday-hint', role: 'alert' }, t('calc.chooseDayFirst')));
  const dayChoices = el('div', { class: 'logday-choices' + (dayMissing ? ' logday-choices--missing' : '') });
  for (const d of ['today', 'tomorrow']) {
    const btn = el('button', { class: 'logday-choice' + (state.forDay === d ? ' selected' : ''), type: 'button' }, d === 'today' ? t('ui.today') : t('ui.tomorrow'));
    btn.addEventListener('click', () => { state.forDay = d; state.dayMissing = false; render(); });
    dayChoices.appendChild(btn);
  }
  c.appendChild(dayChoices);

  // Number of trays (trays/traysTotal logic): whole trays, the recipe's own tray weight.
  if (hasTrays) {
    const input = el('input', { type: 'number', id: 'logadd-trays', class: 'cp-prod-weight', min: '0', step: '1', value: String(num(state.trays)), inputmode: 'numeric', 'aria-describedby': 'logadd-trays-grams' });
    // «= 5,000 g» under the box, as on the Calculator; kept OUT of the label so the field's name stays put.
    const grams = el('span', { class: 'trays-grams', id: 'logadd-trays-grams', 'aria-live': 'polite' }, '');
    const paintGrams = () => { grams.textContent = t('calc.traysEquals', { g: formatGrams(traysGrams(recipe, state.trays)) }); };
    input.addEventListener('input', () => { state.trays = normalizeTrays(input.value); paintGrams(); });
    // Whole trays only: a fraction is replaced by the whole number that is computed.
    input.addEventListener('change', () => {
      const whole = settledTraysText(input.value);
      if (whole !== null) input.value = whole;
    });
    paintGrams();
    c.appendChild(el('div', { class: 'cp-field' }, [
      el('label', { class: 'cp-label', for: 'logadd-trays' }, t('calc.trayCount')),
      el('div', { class: 'cp-prod-card-row' }, [input]),
      grams,
    ]));
  }

  // Typed total (total/both/traysTotal logic).
  if (hasTotal) {
    const input = el('input', { type: 'number', class: 'cp-prod-weight', min: '0', step: '1', value: String(num(state.totalInput)), inputmode: 'numeric' });
    input.addEventListener('input', () => { state.totalInput = num(input.value); });
    c.appendChild(el('div', { class: 'cp-field' }, [
      el('label', { class: 'cp-label' }, t('calc.totalDoughG')),
      el('div', { class: 'cp-prod-card-row' }, [input, el('span', { class: 'cp-unit' }, 'g')]),
    ]));
  }

  // Quantities, grouped by client (orders/both).
  if (hasOrders) {
    c.appendChild(el('div', { class: 'cp-label' }, t('calc.productsQuantitiesOnly')));
    if (!state.items.length) c.appendChild(el('div', { class: 'cp-empty-hint' }, t('calc.noProductsForThis')));
    let lastClient = null;
    let card = null;
    for (const it of state.items) {
      if (it.clientName !== lastClient || card === null) {
        lastClient = it.clientName;
        card = el('div', { class: 'card' }, [el('div', { class: 'card-title' }, it.clientName || t('calc.clientFallback'))]);
        c.appendChild(card);
      }
      card.appendChild(qtyRow(it, (q) => { it.qty = q; }));
    }
  }

  saveBtn.hidden = false;
}

// Build and save a brand-new log — same generic math/shape as a calculator Confirm.
function commit() { return saveGuard.run(doCommit); }

async function doCommit() {
  if (!state || !state.recipeId) return;
  if (!state.forDay) {
    state.dayMissing = true;
    render();
    revealField(document.querySelector('#logadd-content .logday-choices--missing .logday-choice'));
    return;
  }
  if (!(await confirmDialog({ message: t('calc.saveThisLog'), okLabel: t('ui.save'), cancelLabel: t('ui.cancel') }))) return;
  const tabRecipe = getRecipeById(getConfig(), state.recipeId);
  if (!tabRecipe) return;
  const toSave = recipeToSave(tabRecipe);
  if (!toSave.recipe) { await alertDialog(toSave.problem); return; }
  const recipe = toSave.recipe;
  const items = state.items.map(it => ({
    id: it.id, name: it.name, clientName: it.clientName,
    qty: num(it.qty), weightG: num(it.weightG), kind: it.kind, crate: it.crate,
  }));
  const divisor = { includedIds: getDivisorIncluded(getConfig(), state.recipeId), n: 0 };
  const sheet = buildSheet({
    recipe, items, extraGrams: 0, totalInput: num(state.totalInput), trays: num(state.trays),
    leaveningPct: recipe.leaveningDefaultPct, divisor,
  });
  const text = buildLogText(items, [], { grams: 0, value: 0, unit: 'g' });
  const version = {
    calculatedBy: '', at: logTimestamp(), kind: 'create',
    items, occasional: [], sheet, text, recipe: recipeSnapshot(recipe),
  };
  createAndSave({ dough: recipe.name, recipeId: state.recipeId, forDay: state.forDay, version, createdAtMs: Date.now(), origin: 'manual' });
  globalThis.window?.dispatchEvent(new CustomEvent('mise:action', { detail: 'log-added' }));
  close(true);
}

// ── Wiring (elements exist in calculator.html) ────────────────────────────────
document.getElementById('logadd-save-btn').addEventListener('click', commit);
document.querySelector('.logadd-back-btn').addEventListener('click', () => close(false));
