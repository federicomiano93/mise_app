// read-sections.js — the sections of a product's «Scheda completa» as PLAIN TEXT.
//
// Federico, 7 Nov 2026: a product opens to READ, and only the pencil in the header turns it
// into the form. So every section has a second drawing here that shows the same facts with
// no box to type in. PURE DOM builders taking explicit arguments: they read nothing from the
// editor, and ⚠️ THEY NEVER CREATE AN input, select OR textarea — a test pins that, because a
// control sneaking into the read view would be a form that looks like text.
//
// ⚠️ A MISSING VALUE IS «Not set», IN MUTED TEXT — never «0» and never «€0.00», which read
// as «free» (the same rule as the dash in preview-view.js).

import { t } from '../i18n.js';
import { el } from './dom.js';
import { formatMoney } from '../price-model.js';
import { currentCurrency, localNumber } from '../currency.js';
import { startWeighing, readWeighing } from './foodcost-weighing.js';

// A weight for the «Cost per 1 kg» list and for a recipe line: under 1 kg in whole grams (one
// decimal under 10 g), from 1 kg in kilos with up to 3 decimals. localNumber() because the
// figure sits on the same line as a price.
// Decided on the ROUNDED grams, so 999.6 g reads «1 kg», never «1000 g».
export function perKgWeightText(kg) {
  const g = kg * 1000;
  const shown = g < 10 ? Number(g.toFixed(1)) : Math.round(g);
  if (shown < 1000) return `${localNumber(String(shown))} g`;
  return `${localNumber(String(Number(kg.toFixed(3))))} kg`;
}

// The pieces-per-batch box exists for what is sold by the piece, or by a pack counted in
// pieces; for anything else it would mean nothing. Shared by the form and the read view.
export function showsPiecesField(working) {
  return working.sellingMode === 'piece' || (working.sellingMode === 'pack' && working.packUnit === 'pcs');
}

const SOLD_TEXT = { piece: 'fc.byThePiece', weight: 'fc.byWeightPerKg', pack: 'fc.byThePack' };

const positive = n => Number.isFinite(Number(n)) && Number(n) > 0;
const unitWord = unit => (unit === 'pcs' ? t('fc.unit.pieces') : unit);

function notSet() {
  return el('span', { class: 'fc-read-empty', text: t('fc.notSet') });
}

// One row: the label on the left, the value on the right. `value` null → «Not set».
// `note` goes under the row (a warning about the line).
function readRow(label, value, { note = '', missing = false } = {}) {
  return el('div', { class: 'fc-read-row' }, [
    el('dt', { class: missing ? 'missing' : null, text: label }),
    el('dd', {}, [value === null || value === undefined || value === '' ? notSet() : value]),
    note ? el('dd', { class: 'fc-line-note fc-read-note', text: note }) : null,
  ]);
}

function readList(rows) {
  return el('dl', { class: 'fc-read' }, rows);
}

function nothingYet() {
  return el('p', { class: 'fc-read-empty', text: t('fc.read.nothingYet') });
}

// ── Prodotto ────────────────────────────────────────────────────────────────
export function readProduct(working) {
  const rows = [
    readRow(t('fc.name'), String(working.name || '').trim() || null),
    readRow(t('fc.sold'), SOLD_TEXT[working.sellingMode] ? t(SOLD_TEXT[working.sellingMode]) : null),
  ];
  if (working.sellingMode === 'pack') {
    rows.push(readRow(t('fc.packHolds'), positive(working.packSize) && working.packUnit
      ? `${localNumber(String(working.packSize))} ${unitWord(working.packUnit)}` : null));
  }
  if (showsPiecesField(working)) {
    rows.push(readRow(t('fc.piecesPerBatch'), positive(working.piecesPerBatch)
      ? localNumber(String(working.piecesPerBatch)) : null));
  }
  return readList(rows);
}

// ── Composto da ─────────────────────────────────────────────────────────────
// `lineName(entry, kind)` → { text, missing } and `lineNote(entry, kind)` → text are the
// editor's own, so the read view says exactly what the form says under each line.
export function readMadeOf({ components, lineName, lineNote }) {
  if (!components.length) return nothingYet();
  return readList(components.map(entry => {
    const kind = entry.kind === 'ingredient' ? 'ingredient' : 'recipe';
    const name = lineName(entry, kind);
    let qty = null;
    if (kind === 'recipe') {
      qty = positive(entry.qtyKg) ? perKgWeightText(Number(entry.qtyKg)) : null;
    } else {
      qty = positive(entry.qty) ? `${localNumber(String(entry.qty))} ${unitWord(entry.unit)}` : null;
    }
    return readRow(name.text, qty, { note: lineNote(entry, kind), missing: name.missing });
  }));
}

// ── Peso e calo in cottura ──────────────────────────────────────────────────
// What each recipe on the product carries today: raw and cooked weight, and the sentence the
// form shows under the boxes. `recipes` is the table by id; `recipeIds` the recipes on the
// product, once each.
export function readWeighings({ noWeightLoss, recipes, recipeIds }) {
  if (noWeightLoss) return el('p', { class: 'fc-read-line', text: t('fc.noWeightLoss') });
  const known = recipeIds.filter(id => recipes[id]);
  const blocks = known.map(id => {
    const recipe = recipes[id];
    const state = startWeighing(recipe);
    const shown = readWeighing(recipe, state);
    const grams = n => (positive(n) ? `${localNumber(String(n))} g` : null);
    return el('div', { class: 'fc-weigh' }, [
      known.length > 1 ? el('p', { class: 'fc-weigh-title', text: t('fc.weighFor', { name: recipe.name || '' }) }) : null,
      readList([
        readRow(t('fc.rawDough'), grams(state.raw)),
        readRow(t('fc.cookedDough'), grams(state.cooked)),
      ]),
      el('p', { class: 'fc-weigh-out', text: t(shown.message.key, shown.message.params) }),
    ]);
  });
  return el('div', { class: 'fc-weighs' }, blocks);
}

// ── Imballaggio ─────────────────────────────────────────────────────────────
export function readPackaging({ packaging, lineName, lineNote }) {
  if (!packaging.length) return nothingYet();
  return readList(packaging.map(entry => {
    const name = lineName(entry, 'packaging');
    const qty = positive(entry.qtyPcs) ? `${localNumber(String(entry.qtyPcs))} ${t('fc.unit.pieces')}` : null;
    return readRow(name.text, qty, { note: lineNote(entry, 'packaging'), missing: name.missing });
  }));
}

// ── Lavoro ──────────────────────────────────────────────────────────────────
// `note` is the labour-cost sentence the form decides (only for whoever may set the rate).
export function readLabour({ minutes, people, note }) {
  const hasMinutes = positive(minutes);
  const rows = [
    readRow(t('fc.labourMinutes'), hasMinutes ? localNumber(String(minutes)) : null),
    // People left empty means one person, as the form's placeholder says — but with no
    // minutes at all there is nothing for them to work on, so it is «Not set» too.
    readRow(t('fc.labourPeople'), positive(people) ? localNumber(String(people)) : (hasMinutes ? '1' : null)),
  ];
  return el('div', { class: 'fc-read-block' }, [
    readList(rows),
    note ? el('p', { class: 'fc-labour-note', text: note }) : null,
  ]);
}

// ── Prezzo ──────────────────────────────────────────────────────────────────
export function readPrice({ vatRate, target, price }) {
  return readList([
    readRow(t('fc.vatRate'), vatRate === null || vatRate === undefined ? null : `${vatRate}%`),
    readRow(t('fc.foodCostTarget'), positive(target) ? `${target}%` : null),
    readRow(t('fc.sellingPriceVat', { currency: currentCurrency() }), positive(price) ? formatMoney(price) : null),
  ]);
}
