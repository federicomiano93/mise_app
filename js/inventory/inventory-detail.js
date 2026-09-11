// inventory-detail.js — one product's three numbers, and the answer they make.
//
// The list carries the only box that changes every month. This screen is for the
// two that normally do not: what was on the shelf when the month opened (written
// once, then carried over by itself) and what came in during it.
//
// ⚠️ THE ANSWER IS AT THE TOP, not under the fields. It is the reason the screen
// exists, and every box below changes it — the same placement, for the same
// reason, as the Food Cost panel.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { consumption } from './inventory-model.js';

const FIELDS = [
  { map: 'opening', label: 'inv.openingCount', hint: 'inv.openingHint' },
  { map: 'purchased', label: 'inv.purchasedCount', hint: 'inv.purchasedHint' },
  { map: 'closing', label: 'inv.closingCount', hint: 'inv.closingHint' },
];

function num(value, locale) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value);
}

export function renderDetail({ month, ingredient, locale, onCount, readOnly }) {
  const answer = el('div', { class: 'inv-answer' });
  const boxes = new Map();

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
      if (line.used < 0) {
        children.push(el('p', { class: 'inv-answer-warn', text: t('inv.moreThanPossible') }));
      }
    }

    answer.replaceChildren(...children);
  }

  const fields = FIELDS.map(({ map, label, hint }) => {
    const line = consumption(current, ingredient.id);
    const value = map === 'purchased'
      // Purchased is the one field whose absence means zero, so it is shown as an
      // empty box rather than a 0 nobody typed — but the answer above already
      // counts it as none, and says so.
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
    boxes.set(map, input);

    return el('div', { class: 'inv-field' }, [
      el('label', { class: 'inv-label', for: `inv-${map}`, text: t(label) }),
      input,
      el('p', { class: 'inv-hint', text: t(hint) }),
    ]);
  });

  const packLine = ingredient.weight
    ? el('p', { class: 'inv-note', text: t('inv.onePackIs', { pack: ingredient.weight }) })
    : null;

  const root = el('div', { class: 'inv-view' }, [
    answer,
    ...fields,
    packLine,
    el('p', { class: 'inv-note', text: t('inv.emptyIsNotZero') }),
  ]);

  paintAnswer();

  // The month changes underneath this screen whenever a save lands or another
  // phone writes. Only the answer is repainted: rewriting the boxes would take
  // the cursor out of the one being typed into.
  function refresh(nextMonth) {
    current = nextMonth;
    paintAnswer();
  }

  return { root, refresh };
}
