// preview-view.js — the product preview panel: the figures of one product at a glance.
//
// Federico, 7 Nov 2026: on the phone a tap on a product shows this first, in a dialog; on
// the tablet and at the top of the card it is the same panel.
// Federico, 7 Nov 2026, on the tablet: «ci sono troppe voci, dovrebbero essere di meno». His
// choice: FOUR in sight — selling price, cost, food cost against its target, ideal price (with
// VAT, and without it underneath) — and the rest (raw materials, packaging, labour) in
// «Dettagli», closed until tapped. Same evening, his next look: «nel riepilogo aggiungi il
// margine» — the margin moved out of «Dettagli» into sight, right under the cost.
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
let seq = 0;   // unique ids for aria-controls
const CHEVRON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

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

// `moreOpen` / `onMoreToggle`: the card repaints this panel on every keystroke, so it keeps
// whether «Dettagli» is open and hands it back here — a box that snapped shut while typing
// would be one more thing to fight with.
export function previewPanel(preview, { caption = true, showMissing = true, moreOpen = false, onMoreToggle = null } = {}) {
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

  // In sight: price, cost, margin, food cost, ideal price.
  const list = el('dl', { class: 'fc-preview-list' }, [
    row(t('fc.preview.price'), shown(preview.sellingPrice, formatMoney)),
    // Materials and packaging, plus the work where there is a figure for it.
    row(t('fc.preview.cost'), shown(preview.totalUnitCost, formatRate)),
    // The app's margin: net price less materials and packaging — so, where a labour row exists
    // in «Dettagli», the label says the labour is left out of it.
    row(hasLabour ? t('fc.preview.marginNoLabour') : t('fc.preview.margin'),
      shown(preview.margin, formatMoney)),
    row(t('fc.preview.foodCost'), foodCost, ' fc-preview-fc'),
    row(t('fc.preview.ideal'), shown(preview.idealGross, formatMoney), ' fc-preview-ideal'),
  ]);
  // Under the ideal price: what it is without VAT, and for which food cost — or nothing,
  // while there is no net figure to give.
  const idealSub = preview.idealNet !== null && preview.targetPct !== null
    ? el('p', { class: 'fc-preview-sub', text: t('fc.preview.idealSub', {
      net: formatMoney(preview.idealNet), target: String(preview.targetPct),
    }) })
    : null;

  // The rest, closed. ⚠️ A BUTTON, NOT <details>: the phone shows this panel inside the app's
  // dialog, whose Tab trap walks buttons, fields and links only — a <summary> there could not be
  // reached from a keyboard. aria-expanded tells a screen reader whether it is open.
  let open = !!moreOpen;
  const moreList = el('dl', { class: 'fc-preview-list', id: `fc-preview-more-${++seq}` }, [
    row(t('fc.preview.materials'), shown(preview.materialsUnitCost, formatRate)),
    row(t('fc.preview.packaging'), preview.hasPackaging
      ? shown(preview.packagingUnitCost, formatRate) : t('fc.preview.noPackaging')),
    hasLabour ? row(t('fc.preview.labour'), formatRate(preview.labourUnitCost)) : null,
  ]);
  const moreBtn = el('button', {
    type: 'button', class: 'fc-preview-more-btn', 'aria-controls': moreList.id,
    onclick: () => { open = !open; paintMore(); onMoreToggle?.(open); },
  }, [
    el('span', { text: t('fc.preview.details') }),
    el('span', { class: 'fc-preview-more-chevron', icon: CHEVRON_SVG }),
  ]);
  function paintMore() {
    moreBtn.setAttribute('aria-expanded', String(open));
    moreList.hidden = !open;
  }
  paintMore();
  const more = el('div', { class: 'fc-preview-more' }, [moreBtn, moreList]);

  const missing = preview.missing || [];
  return el('div', { class: 'fc-preview' }, [
    caption ? el('p', { class: 'fc-preview-caption', text: previewCaption(preview) }) : null,
    list,
    idealSub,
    preview.partial ? el('p', { class: 'fc-answer-partial', text: t('fc.costPartial') }) : null,
    showMissing && missing.length ? el('p', { class: 'fc-preview-missing-title', text: t('fc.preview.missing') }) : null,
    showMissing && missing.length
      ? el('ul', { class: 'fc-blockers' }, missing.map((key) => el('li', { text: blockerText(key) })))
      : null,
    !showMissing && preview.idealNet === null && missing.includes('no-target') && preview.totalUnitCost !== null
      ? el('p', { class: 'fc-note', text: blockerText('no-target') })
      : null,
    more,
  ]);
}
