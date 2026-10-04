// log-edit.js — the dedicated log-edit screen (B) and the version history (C).
//
// EDIT (B): NOT the calculator. Shows all of the category's products with editable
// quantities only (weights/recipe stay as configured). A free "calculated by" name
// is recorded. Saving APPENDS a new version (append-only) — the previous version is
// never destroyed. Leaving with unsaved changes asks to confirm (the log stays
// exactly as before on cancel). Any "occasional clients" stored on older logs are
// carried forward unchanged on save (the feature to add new ones was removed).
//
// HISTORY (C): lists every version (append-only chain), opens any one read-only and
// can RESTORE it — restoring appends a copy on top as the new current version, so
// the history is never truncated.

import { t } from './i18n.js';
import { el } from './calculator-render.js';
import { icon } from './calculator-icons.js';
import { getConfig } from './calculator-config-store.js';
import { getTabProducts, getDivisorIncluded, getRecipes, getRecipeById, usesTrays, normalizeTrays, settledTraysText, traysGrams, formatGrams } from './calculator-config.js';
import { logTimestamp } from './log-time.js';
import { confirmDiscard } from './calculator-confirm.js';
import { buildSheet, buildLogText, typedTotalOf, latestVersion, recipeSnapshot, editRows, traysEditState, traysSheetRecipe } from './log-model.js';
import { getLogById, appendAndSave, restoreAndSave } from './log-store.js';
import { renderVersion } from './log-view.js';
import { qtyRow } from './log-qty.js';
import { confirmDialog } from './confirm-dialog.js';
import { createSaveGuard } from './save-guard.js';

// While the save is in flight the header Save is disabled and Back waits (js/save-guard.js).
const saveGuard = createSaveGuard(() => document.getElementById('logedit-save-btn'));

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// The recipe id a log belongs to: its stored recipeId, else a recipe matched by the
// log's dough name (older migrated logs), else the first recipe.
function resolveRecipeId(log) {
  if (log.recipeId && getRecipeById(getConfig(), log.recipeId)) return log.recipeId;
  const byName = getRecipes(getConfig()).find(r => r.name === log.dough);
  if (byName) return byName.id;
  const first = getRecipes(getConfig())[0];
  return first ? first.id : '';
}

// ── Edit screen state ─────────────────────────────────────────────────────────
let working = null; // { logId, dough, tab, items[], occasional[], calculatedBy }
let dirty = false;

export function openLogEdit(logId) {
  const log = getLogById(logId);
  if (!log) return;
  const v = latestVersion(log) || {};
  const tab = resolveRecipeId(log);

  // What the log SAVED comes first and verbatim; the products added to those clients
  // since then follow at zero, so a log can gain a row but never lose or rewrite one.
  const items = editRows(v.items, getTabProducts(getConfig(), tab).map(p => ({
    id: p.id, name: p.name, clientName: p.clientName, weightG: p.weight, kind: p.kind,
    crate: p.crate || { show: false, perBox: 20 },
  })));

  // The recipe this log was calculated with. Logs written before the freeze existed
  // have none, and fall back to today's — without that fallback they would stop being
  // editable altogether.
  const recipe = v.recipe || getRecipeById(getConfig(), tab);
  const occasional = (v.occasional || []).map(o => ({
    name: o.name || '',
    products: (o.products || []).map(p => ({
      name: p.name || '', qty: num(p.qty), weightG: num(p.weightG),
      unit: p.unit === 'kg' ? 'kg' : 'pz', productId: p.productId || '',
    })),
  }));

  // A trays dough is edited by its trays (and, for «trays + total», the grams typed on top):
  // the weight of a tray stays the one the dough was MADE with (the frozen recipe's).
  const sheet = v.sheet || {};
  const { trays, trayWeight, typedTotal } = traysEditState(sheet, recipe);

  working = { logId, dough: log.dough, recipeId: tab, tab, recipe, items, occasional, calculatedBy: v.calculatedBy || '', trays, typedTotal, trayWeight };
  dirty = false;
  render();
  document.getElementById('logedit-overlay').classList.add('visible');
}

// `dirty` does not drive the header Save (#logedit-save-btn) — it is always
// pressable — but it still raises the unsaved-changes question on the way out.
function markDirty() { dirty = true; }

function render() {
  const c = document.getElementById('logedit-content');
  c.textContent = '';
  c.appendChild(el('div', { class: 'logedit-dough' }, working.dough));

  const by = el('input', { class: 'cp-client-name', type: 'text', value: working.calculatedBy, placeholder: t('calc.nameOptional') });
  by.addEventListener('input', () => { working.calculatedBy = by.value; markDirty(); });
  c.appendChild(el('div', { class: 'cp-field' }, [el('label', { class: 'cp-label' }, t('calc.calculatedBy2')), by]));

  if (working.recipe && usesTrays(working.recipe.logic)) {
    const trays = el('input', { type: 'number', id: 'logedit-trays', class: 'cp-prod-weight', min: '0', step: '1', value: String(working.trays), inputmode: 'numeric', 'aria-describedby': 'logedit-trays-grams' });
    // «= 5,000 g» at the weight the dough was MADE with; outside the label so the field's name stays put.
    const grams = el('span', { class: 'trays-grams', id: 'logedit-trays-grams', 'aria-live': 'polite' }, '');
    const paintGrams = () => { grams.textContent = t('calc.traysEquals', { g: formatGrams(traysGrams({ trayWeight: working.trayWeight }, working.trays)) }); };
    trays.addEventListener('input', () => { working.trays = normalizeTrays(trays.value); paintGrams(); markDirty(); });
    // Whole trays only: a fraction is replaced by the whole number that is computed.
    trays.addEventListener('change', () => {
      const whole = settledTraysText(trays.value);
      if (whole !== null) trays.value = whole;
    });
    paintGrams();
    c.appendChild(el('div', { class: 'cp-field' }, [
      el('label', { class: 'cp-label', for: 'logedit-trays' }, t('calc.trayCount')),
      el('div', { class: 'cp-prod-card-row' }, [trays]),
      grams,
    ]));
    if (working.recipe.logic === 'traysTotal') {
      const typed = el('input', { type: 'number', id: 'logedit-total', class: 'cp-prod-weight', min: '0', step: '1', value: String(working.typedTotal), inputmode: 'numeric' });
      typed.addEventListener('input', () => { working.typedTotal = Math.max(0, num(typed.value)); markDirty(); });
      c.appendChild(el('div', { class: 'cp-field' }, [
        el('label', { class: 'cp-label', for: 'logedit-total' }, t('calc.totalDoughG')),
        el('div', { class: 'cp-prod-card-row' }, [typed, el('span', { class: 'cp-unit' }, 'g')]),
      ]));
    }
    // A trays dough has no products: say nothing about quantities that cannot exist.
    return;
  }

  c.appendChild(el('div', { class: 'cp-label' }, t('calc.productsQuantitiesOnly')));
  let lastClient = null;
  let card = null;
  if (!working.items.length) {
    c.appendChild(el('div', { class: 'cp-empty-hint' }, t('calc.noProductsInThis')));
  }
  for (const it of working.items) {
    if (it.clientName !== lastClient || card === null) {
      lastClient = it.clientName;
      card = el('div', { class: 'card' }, [el('div', { class: 'card-title' }, it.clientName || t('calc.clientFallback'))]);
      c.appendChild(card);
    }
    card.appendChild(qtyRow(it, (q) => { it.qty = q; markDirty(); }));
  }
}

// ── Save (append a new version) ───────────────────────────────────────────────

function save() { return saveGuard.run(doSave); }

async function doSave() {
  if (!(await confirmDialog({ message: t('calc.saveTheseChangesAs'), okLabel: t('ui.save'), cancelLabel: t('ui.cancel') }))) return;
  const tab = working.tab;

  const items = working.items.map(it => ({
    id: it.id, name: it.name, clientName: it.clientName,
    qty: num(it.qty), weightG: num(it.weightG), kind: it.kind, crate: it.crate,
  }));

  // Occasional clients → cleaned data + extra lines that feed the dough total.
  const occClean = [];
  const occLines = [];
  working.occasional.forEach((o, oi) => {
    const prods = (o.products || []).filter(p => (p.name || '').trim() !== '' && num(p.qty) > 0);
    if (!(o.name || '').trim() && !prods.length) return; // drop fully empty
    const name = (o.name || '').trim() || t('calc.occasionalClient');
    occClean.push({ name, products: prods.map(p => ({ name: p.name.trim(), qty: num(p.qty), weightG: num(p.weightG), unit: p.unit === 'kg' ? 'kg' : 'pz', productId: p.productId || '' })) });
    prods.forEach((p, pi) => occLines.push({
      id: 'occ-' + oi + '-' + pi, name: p.name.trim(), clientName: name,
      qty: num(p.qty), weightG: num(p.weightG), kind: p.unit === 'kg' ? 'kg' : 'number', crate: { show: false, perBox: 20 },
    }));
  });

  // Keep leavening / extra / total / divisor from the previous version (this screen
  // edits quantities only); recompute the sheet faithfully for the new quantities,
  // using the recipe the log was MADE with, not today's.
  const recipe = working.recipe;
  const prevVersion = latestVersion(getLogById(working.logId)) || {};
  const prevSheet = prevVersion.sheet;
  const leaveningPct = prevSheet && prevSheet.param ? prevSheet.param.value : (recipe ? recipe.leaveningDefaultPct : 0);
  const extraG = prevSheet ? num(prevSheet.extra_g) : 0;
  // «Trays + total» keeps the grams typed on top of the trays (traysEditState); «total» and
  // «both» read the typed part back from the saved sheet (typedTotalOf).
  const totalInput = recipe && recipe.logic === 'traysTotal' ? working.typedTotal : typedTotalOf(recipe, prevVersion);
  const trays = recipe && usesTrays(recipe.logic) ? working.trays : 0;
  const divisor = { includedIds: getDivisorIncluded(getConfig(), tab), n: prevSheet && prevSheet.divisor ? prevSheet.divisor.n : 0 };

  const sheet = buildSheet({ recipe: traysSheetRecipe(recipe, working.trayWeight), items: items.concat(occLines), extraGrams: extraG, totalInput, trays, leaveningPct, divisor });
  const extra = { grams: extraG, value: extraG, unit: 'g' };
  const text = buildLogText(items, occClean, extra);
  const version = {
    calculatedBy: (working.calculatedBy || '').trim(), at: logTimestamp(), kind: 'edit',
    items, occasional: occClean, sheet, text, recipe: recipeSnapshot(recipe),
  };

  appendAndSave(working.logId, version);
  dirty = false;
  closeEdit(true);
}

async function closeEdit(saved) {
  if (!saved && saveGuard.saving) return;
  if (!saved && !(await confirmDiscard(dirty))) return; // "continue editing" on cancel
  document.getElementById('logedit-overlay').classList.remove('visible');
  working = null;
  dirty = false;
}

// ── Version history (C) ───────────────────────────────────────────────────────
let historyLogId = null;

export function openLogHistory(logId) {
  historyLogId = logId;
  renderHistoryList();
  document.getElementById('loghistory-overlay').classList.add('visible');
}
function closeHistory() { document.getElementById('loghistory-overlay').classList.remove('visible'); }

function kindLabel(v, i, last) {
  if (v.kind === 'restore') return t('calc.restoredFromVersion', { v: (num(v.restoredFrom) || 0) + 1 });
  if (i === 0) return t('calc.versionCreated');
  return t('calc.versionEdited');
}

function renderHistoryList() {
  const log = getLogById(historyLogId);
  const c = document.getElementById('loghistory-content');
  c.textContent = '';
  if (!log) { c.appendChild(el('p', { class: 'log-empty' }, t('calc.logNotFound'))); return; }
  c.appendChild(el('div', { class: 'logedit-dough' }, t('calc.logEditHistory', { dough: log.dough })));
  const vs = log.versions || [];
  for (let i = vs.length - 1; i >= 0; i--) {
    const v = vs[i];
    const last = i === vs.length - 1;
    const at = v.at || {};
    const box = el('button', { class: 'drill-item', type: 'button' }, [
      el('div', { class: 'loghist-info' }, [
        el('span', { class: 'loghist-kind' }, 'v' + (i + 1) + ' · ' + kindLabel(v, i) + (last ? t('calc.current') : '')),
        el('span', { class: 'loghist-meta' }, (at.date ? at.date + ' — ' + at.time : '') + (v.calculatedBy ? ' · ' + v.calculatedBy : '')),
      ]),
      el('span', { class: 'drill-chevron' }, icon('chevronRight', 18)),
    ]);
    box.addEventListener('click', () => openHistoryVersion(i));
    c.appendChild(box);
  }
}

function openHistoryVersion(i) {
  const log = getLogById(historyLogId);
  if (!log) return;
  const vs = log.versions || [];
  const v = vs[i];
  if (!v) return;
  const c = document.getElementById('loghistory-content');
  c.textContent = '';
  const back = el('button', { class: 'loghist-tolist', type: 'button' }, [icon('chevronLeft', 16), t('calc.allVersions')]);
  back.addEventListener('click', renderHistoryList);
  c.appendChild(back);
  c.appendChild(renderVersion(v, log));
  if (i !== vs.length - 1) {
    const restore = el('button', { class: 'cp-save-bottom', type: 'button' }, t('calc.restoreThisVersion'));
    restore.addEventListener('click', async () => {
      if (!(await confirmDialog({ message: t('calc.restoreThisVersionIt'), okLabel: t('ui.restore'), cancelLabel: t('ui.cancel') }))) return;
      restoreAndSave(historyLogId, i, { calculatedBy: v.calculatedBy || '', at: logTimestamp() });
      renderHistoryList();
    });
    c.appendChild(restore);
  }
}

// ── Wiring ────────────────────────────────────────────────────────────────────
document.getElementById('logedit-save-btn').addEventListener('click', save);
document.querySelector('.logedit-back-btn').addEventListener('click', () => closeEdit(false));
document.querySelector('.loghistory-back-btn').addEventListener('click', closeHistory);
