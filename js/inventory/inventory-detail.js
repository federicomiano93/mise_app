// inventory-detail.js — one product's numbers, and the answer they make.
//
// The list carries the only box that changes every month. This screen is for the
// ones that normally do not: what was on the shelf when the month opened (written
// once, then carried over by itself), what came in during it, and how much one
// pack weighs — which is what turns a count into money.
//
// ⚠️ THE ANSWER IS AT THE TOP, not under the fields. It is the reason the screen
// exists, and every box below changes it — the same placement, for the same
// reason, as the Food Cost panel.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { consumption } from './inventory-model.js';
import {
  parsePackSize, packKgFor, packPrice, lineValue, formatTotal,
  NO_PRICE, NO_PACK, NO_FROZEN_PRICE,
} from './inventory-value.js';

const FIELDS = [
  { map: 'opening', label: 'inv.openingCount', hint: 'inv.openingHint' },
  { map: 'purchased', label: 'inv.purchasedCount', hint: 'inv.purchasedHint' },
  { map: 'closing', label: 'inv.closingCount', hint: 'inv.closingHint' },
];

const BLOCKER_TEXT = {
  [NO_PRICE]: 'inv.noPriceYet',
  [NO_PACK]: 'inv.noPackYet',
  [NO_FROZEN_PRICE]: 'inv.noFrozenPrice',
};

function num(value, locale) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value);
}

export function renderDetail({ month, ingredient, locale, onCount, readOnly, closed }) {
  const answer = el('div', { class: 'inv-answer' });
  const packNote = el('p', { class: 'inv-hint' });

  let current = month;

  function paintAnswer() {
    const line = consumption(current, ingredient.id);
    const unit = ingredient.unit || t('inv.packsShort');

    answer.classList.toggle('unknown', line.used === null);
    // ⚠️ A NEGATIVE ANSWER IS SHOWN, NOT HIDDEN. More left than could possibly be
    // there means a number is wrong somewhere, and that is worth saying on the
    // screen where it can be corrected.
    answer.classList.toggle('impossible', line.used !== null && line.used < 0);

    const children = [
      el('p', { class: 'inv-answer-label', text: t('inv.usedThisMonth') }),
      el('p', {
        class: 'inv-answer-value',
        text: line.used === null ? '—' : `${num(line.used, locale)} ${unit}`,
      }),
    ];

    if (line.used === null) {
      children.push(el('p', {
        class: 'inv-answer-why',
        text: !line.counted ? t('inv.answerNeedsCount') : t('inv.answerNeedsOpening'),
      }));
    } else {
      children.push(el('p', {
        class: 'inv-answer-basis',
        text: t('inv.hadBoughtLeft', {
          had: num(line.opening, locale),
          bought: num(line.purchased, locale),
          left: num(line.closing, locale),
        }),
      }));
      // What that consumption cost, when the app has both halves of the sum. A row
      // it cannot value says which of the two jobs would fix it, rather than
      // showing a blank nobody can act on.
      const { value, blocker } = lineValue(current, ingredient, line.used, closed);
      children.push(value === null
        ? el('p', { class: 'inv-answer-why', text: t(BLOCKER_TEXT[blocker] || 'inv.noPriceYet') })
        : el('p', { class: 'inv-answer-money', text: formatTotal(value) }));
      if (line.used < 0) {
        children.push(el('p', { class: 'inv-answer-warn', text: t('inv.moreThanPossible') }));
      }
    }

    answer.replaceChildren(...children);
  }

  function paintPackNote() {
    const kg = packKgFor(current, ingredient, closed);
    const price = packPrice(current, ingredient, closed);
    // ⚠️ A CLOSED MONTH IS NOT A JOB LIST. Its figures are frozen and its boxes are
    // disabled, so "write the kilos in and this product gets a cost" would be an
    // instruction nobody can follow. It says what was recorded at the time instead
    // — and if nothing was, it says that, because entering a price today cannot
    // change what September cost.
    if (closed) {
      packNote.textContent = price === null
        ? t('inv.packNotFrozen')
        : t('inv.packFrozen', { price: formatTotal(price) });
      return;
    }
    if (ingredient.priceUnit === 'pcs') {
      packNote.textContent = price === null ? t('inv.packByPieceNoPrice') : t('inv.packByPiece', { price: formatTotal(price) });
      return;
    }
    if (kg === null) {
      packNote.textContent = ingredient.weight
        ? t('inv.packUnreadable', { text: ingredient.weight })
        : t('inv.packUnknown');
      return;
    }
    packNote.textContent = price === null
      ? t('inv.packKnown', { kg: num(kg, locale) })
      : t('inv.packKnownPriced', { kg: num(kg, locale), price: formatTotal(price) });
  }

  const fields = FIELDS.map(({ map, label, hint }) => {
    const line = consumption(current, ingredient.id);
    const value = map === 'purchased'
      // Purchased is the one field whose absence means zero, so it is shown as an
      // empty box rather than a 0 nobody typed — the answer above already counts
      // it as none, and says so.
      ? (current[map] || {})[ingredient.id]
      : line[map];

    const input = el('input', {
      class: 'inv-input', type: 'text', inputmode: 'decimal',
      autocomplete: 'off',
      id: `inv-${map}`,
      value: value === null || value === undefined ? '' : num(value, locale),
      disabled: readOnly ? 'disabled' : null,
      onchange: (e) => { onCount(map, ingredient.id, e.target.value); },
    });

    return el('div', { class: 'inv-field' }, [
      el('label', { class: 'inv-label', for: `inv-${map}`, text: t(label) }),
      input,
      el('p', { class: 'inv-hint', text: t(hint) }),
    ]);
  });

  // ⚠️ THE ONE FIELD THAT IS NOT A COUNT, and the only place the app can be told
  // what a pack weighs. It travels with the month and is carried forward, so it
  // is typed once ever rather than once a month. Left empty, the app reads the
  // product's own pack text — and where it cannot, the row keeps its quantity and
  // simply has no money beside it.
  const parsed = parsePackSize(ingredient.weight);
  const stored = (current.packKg || {})[ingredient.id];
  const packInput = el('input', {
    class: 'inv-input', type: 'text', inputmode: 'decimal',
    autocomplete: 'off', id: 'inv-packKg',
    value: stored === null || stored === undefined ? '' : num(stored, locale),
    // No suggestion on a closed month: it would offer a weight the month will
    // never use, in a box that cannot be typed into.
    placeholder: closed || parsed === null ? '' : num(parsed, locale),
    disabled: readOnly ? 'disabled' : null,
    onchange: (e) => { onCount('packKg', ingredient.id, e.target.value); },
  });

  const packField = ingredient.priceUnit === 'pcs' ? null : el('div', { class: 'inv-field' }, [
    el('label', { class: 'inv-label', for: 'inv-packKg', text: t('inv.packKgLabel') }),
    packInput,
    packNote,
  ]);

  const root = el('div', { class: 'inv-view' }, [
    answer,
    ...fields,
    packField,
    ingredient.priceUnit === 'pcs' ? packNote : null,
    el('p', { class: 'inv-note', text: t('inv.emptyIsNotZero') }),
  ]);

  paintAnswer();
  paintPackNote();

  // The month changes underneath this screen whenever a save lands or another
  // phone writes. Only the answer and the pack note are repainted: rewriting the
  // boxes would take the cursor out of the one being typed into.
  function refresh(nextMonth) {
    current = nextMonth;
    paintAnswer();
    paintPackNote();
  }

  return { root, refresh };
}
