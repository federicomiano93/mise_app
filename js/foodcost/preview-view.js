// preview-view.js — the product preview panel: the figures of one product at a glance.
//
// Federico, 7 Nov 2026: on the phone a tap on a product shows this first, in a dialog; on
// the tablet and at the top of the card it is the same panel.
//
// ⚠️ EVERY FIGURE COMES FROM productPreview() (foodcost-model.js) and nothing is added up
// here, so the preview can never disagree with the list or the card. This file only
// chooses the words and the format.
// ⚠️ UNKNOWN IS A DASH, NEVER 0: a product with no price or no cost shows «—», because a
// zero would read as «free» or «no margin». The labour row is the one exception: it is
// owner/manager-only data (null for everybody else) and the whole row is left out then.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { formatRate, formatMoney } from '../price-model.js';
import { blockerText } from './foodcost-model.js';

// Keys, resolved at draw time.
const UNIT_TEXT = { piece: 'fc.perPiece', kg: 'fc.perKg', pack: 'fc.perPack' };
const DASH = '—';

function shown(value, format) {
  return value === null || value === undefined ? DASH : format(value);
}

// «Per piece» / «per kg» / «per pack» — what every figure of the panel is per.
export function previewCaption(preview) {
  return preview.unit
    ? t('fc.preview.caption', { unit: t(UNIT_TEXT[preview.unit]) })
    : t('fc.preview.captionNoUnit');
}

function row(label, value, extraClass = '') {
  return el('div', { class: 'fc-preview-row' + extraClass }, [
    el('dt', { text: label }),
    value instanceof Node ? value : el('dd', { text: value }),
  ]);
}

export function previewPanel(preview, { caption = true, showMissing = true } = {}) {
  const hasLabour = preview.labourUnitCost !== null;

  const foodCost = el('dd', {}, [
    preview.foodCostPct === null ? null
      : el('span', { class: 'fc-dot ' + (preview.status || 'none'), 'aria-hidden': 'true' }),
    el('span', {
      text: preview.foodCostPct === null ? DASH
        : preview.targetPct === null
          ? t('fc.preview.noTarget', { pct: String(preview.foodCostPct) })
          : t('fc.preview.vsTarget', { pct: String(preview.foodCostPct), target: String(preview.targetPct) }),
    }),
  ]);
  foodCost.classList.add('fc-preview-wrap');

  const list = el('dl', { class: 'fc-preview-list' }, [
    row(t('fc.preview.price'), shown(preview.sellingPrice, formatMoney)),
    row(t('fc.preview.materials'), shown(preview.materialsUnitCost, formatRate)),
    row(t('fc.preview.packaging'), preview.hasPackaging
      ? shown(preview.packagingUnitCost, formatRate) : t('fc.preview.noPackaging')),
    hasLabour ? row(t('fc.preview.labour'), formatRate(preview.labourUnitCost)) : null,
    row(t('fc.preview.total'), shown(preview.totalUnitCost, formatRate)),
    row(t('fc.preview.foodCost'), foodCost, ' fc-preview-fc'),
    row(hasLabour ? t('fc.preview.marginNoLabour') : t('fc.preview.margin'),
      shown(preview.margin, formatMoney)),
    row(t('fc.preview.idealGross'), shown(preview.idealGross, formatMoney), ' fc-preview-ideal'),
    row(t('fc.preview.idealNet'), shown(preview.idealNet, formatMoney), ' fc-preview-ideal'),
  ]);

  const missing = preview.missing || [];
  return el('div', { class: 'fc-preview' }, [
    caption ? el('p', { class: 'fc-preview-caption', text: previewCaption(preview) }) : null,
    list,
    preview.idealNet !== null && preview.targetPct !== null
      ? el('p', { class: 'fc-note', text: t('fc.preview.idealBasis', { target: String(preview.targetPct) }) })
      : null,
    preview.partial ? el('p', { class: 'fc-answer-partial', text: t('fc.costPartial') }) : null,
    showMissing && missing.length ? el('p', { class: 'fc-preview-missing-title', text: t('fc.preview.missing') }) : null,
    showMissing && missing.length
      ? el('ul', { class: 'fc-blockers' }, missing.map((key) => el('li', { text: blockerText(key) })))
      : null,
    !showMissing && preview.idealNet === null && missing.includes('no-target') && preview.totalUnitCost !== null
      ? el('p', { class: 'fc-note', text: blockerText('no-target') })
      : null,
  ]);
}
