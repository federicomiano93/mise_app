// inventory-usage.js — where the month's money went.
//
// One screen, most expensive first, because that is the only order in which the
// question gets answered: a list sorted by name tells you nothing you did not
// already know, and a total on its own tells you nothing you can act on.
//
// ⚠️ IT NEVER HIDES THE ROWS IT COULD NOT VALUE. They sit at the bottom, with the
// quantity that WAS counted and the reason there is no money beside it — because
// a total that silently leaves things out is a total somebody will believe.

import { t } from '../i18n.js';
import { el } from './dom.js';
import { formatTotal, NO_PRICE, NO_PACK } from './inventory-value.js';

const BLOCKER_TEXT = { [NO_PRICE]: 'inv.noPriceYet', [NO_PACK]: 'inv.noPackYet' };

function num(value, locale) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value);
}

export function renderUsage({ cost, locale, month }) {
  const { lines, total, counted, withoutValue } = cost;

  const head = el('div', { class: 'inv-summary' }, [
    el('p', { class: 'inv-summary-label', text: t('inv.costThisMonth') }),
    el('p', { class: 'inv-summary-value', text: formatTotal(total) }),
    el('p', {
      class: 'inv-summary-note',
      text: withoutValue
        ? t('inv.costBasisPartial', { counted, n: withoutValue })
        : t('inv.costBasis', { counted }),
    }),
  ]);

  const rows = el('div', { class: 'inv-list' });

  if (!lines.length) {
    rows.appendChild(el('p', { class: 'inv-empty', text: t('inv.costEmpty') }));
  }

  lines.forEach(({ ingredient, used, value, blocker }) => {
    const name = [ingredient.name, ingredient.weight].filter(Boolean).join(' ').trim()
      || (month.names || {})[ingredient.id]
      || t('inv.unnamedProduct');
    const unit = ingredient.unit || t('inv.packsShort');

    rows.appendChild(el('div', { class: 'inv-cost-row' + (value === null ? ' unvalued' : '') }, [
      el('div', { class: 'inv-cost-main' }, [
        el('span', { class: 'inv-row-name', text: name }),
        el('span', {
          class: 'inv-row-sub',
          text: blocker
            ? `${num(used, locale)} ${unit} · ${t(BLOCKER_TEXT[blocker])}`
            : `${num(used, locale)} ${unit}`,
        }),
      ]),
      el('span', {
        class: 'inv-cost-value' + (value === null ? ' none' : ''),
        text: value === null ? '—' : formatTotal(value),
      }),
    ]));
  });

  return {
    root: el('div', { class: 'inv-view' }, [
      head,
      rows,
      // ⚠️ SAID OUT LOUD, because nothing on the screen can show it. Every figure
      // here rests on prices somebody typed by hand, and on a count somebody made
      // standing in a storeroom. It is an estimate of a real quantity, not an
      // accounting record.
      el('p', { class: 'inv-note', text: t('inv.costCaveat') }),
    ]),
  };
}
