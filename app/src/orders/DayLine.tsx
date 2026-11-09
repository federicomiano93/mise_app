import { useId, useState } from 'react';
import { spellLongDate, spellShortDate, todayISO } from '@mise/shared/day';
import { dayChoices, nextDeliveryAfter } from '@mise/shared/order-day';
import { hasOrderDays, weekChoices } from '@mise/shared/order-day-choices';
import { useT } from '../i18n/useT';
import { useOrders, useOrdersStore } from './OrdersContext';
import { dayTranslate } from './dayWords';
import type { OrdersLens } from './ordersLens';
import type { StoredDoc } from './ordersSource';
import styles from './DayLine.module.css';

type Kind = 'today' | 'tomorrow' | 'weekday' | 'past' | 'next' | 'later';
type Choice = { readonly value: string; readonly kind: Kind; readonly day: string };

// «Order: [Today ▾]» on a supplier's screen: which day these quantities are for (parity D6–D8, decision F2).
//
// A supplier WITH order days gets the current app's choices (today, its next order day, and a stored day that is neither),
// shown only when there are two or more. A supplier WITHOUT any — and the pseudo-supplier «No supplier» — gets a week, always
// shown, so next week's order can be started early. Choosing a day writes `days.<id>` through the store, LOCAL-FIRST; a
// refusal puts the stored day back (the select is drawn from the stored day, so it never shows a choice that was not saved)
// and the section says so.
//
// The result is announced politely in a live region that is on the page BEFORE it speaks; the focus stays on the select.
export function DayLine({ supplier, lens }: { supplier: StoredDoc; lens: OrdersLens }) {
  const { t } = useT();
  const store = useOrdersStore();
  const { draft } = useOrders();
  const selectId = useId();
  // The announcement is a node keyed on a counter: the SAME sentence said twice is a new node and is announced again.
  const [said, setSaid] = useState<{ id: number; text: string }>({ id: 0, text: '' });

  const today = todayISO();
  const stamp = draft.days[supplier.id];
  const hasItems = lens.filledFor(supplier.id) > 0;
  const dt = dayTranslate(t);

  let choices: readonly Choice[];
  let selected: string;
  let selectedDay: string;
  if (hasOrderDays(supplier)) {
    const found = dayChoices({ supplier, stamp, hasItems, today });
    choices = found.options.map(option => ({ value: option.value, kind: option.kind, day: option.day }));
    selected = found.selected;
    selectedDay = found.selectedDay;
  } else {
    const found = weekChoices({ stamp, hasItems, today });
    choices = found.options.map(option => ({ value: option.value, kind: option.kind, day: option.day }));
    selected = found.selected;
    selectedDay = found.selectedDay;
  }
  // As today: a supplier with order days and nothing but «Today» to choose has no day line.
  if (choices.length < 2) return null;

  const words = (choice: Choice): string => {
    const short = spellShortDate(choice.day, dt);
    switch (choice.kind) {
      case 'today': return t('day.today');
      case 'tomorrow': return t('day.tomorrow');
      case 'weekday': return spellLongDate(choice.day, dt);
      case 'past': return t('ord.day.optPast', { day: short });
      case 'next': return t('ord.day.optNext', { day: short });
      case 'later': return t('ord.day.optLater', { day: short });
    }
  };

  const announce = (choice: Choice): string => {
    const short = spellShortDate(choice.day, dt);
    if (choice.kind === 'today') return t('ord.day.announceToday');
    return choice.kind === 'next' ? t('ord.day.announceNext', { day: short }) : t('ord.day.announceLater', { day: short });
  };

  const delivery = nextDeliveryAfter(supplier, selectedDay);

  return (
    <div className={styles.line}>
      <div className={styles.row}>
        <label htmlFor={selectId} className={styles.label}>{t('ord.day.label')}</label>
        <select
          id={selectId}
          className={styles.select}
          value={selected}
          onChange={event => {
            const choice = choices.find(option => option.value === event.target.value);
            // Choosing «From …» is choosing what is already stored: nothing is written.
            if (!choice || choice.kind === 'past') return;
            void store.setDay(supplier, choice.day);
            setSaid(before => ({ id: before.id + 1, text: announce(choice) }));
          }}
        >
          {choices.map(choice => <option key={choice.value} value={choice.value}>{words(choice)}</option>)}
        </select>
      </div>
      {delivery !== '' ? <p className={styles.delivery}>{t('ord.day.delivery', { day: spellLongDate(delivery, dt) })}</p> : null}
      <div role="status" className="visually-hidden">
        {said.text === '' ? null : <p key={said.id}>{said.text}</p>}
      </div>
    </div>
  );
}
