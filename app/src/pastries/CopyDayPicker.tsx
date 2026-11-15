import { useId, useState } from 'react';
import type { RefObject } from 'react';
import { otherWeekdays } from '@mise/shared/pastries-model';
import type { Weekday } from '@mise/shared/pastries-model';
import { useT } from '../i18n/useT';
import { weekdayLabel } from './weekdays';
import styles from './CopyDayPicker.module.css';

type Props = {
  from: Weekday;
  // How many pastries each day holds when the question opens.
  counts: Readonly<Record<Weekday, number>>;
  // The day chosen, written here on every change: the dialog is closed by buttons that live outside
  // this body, so the caller reads the answer from the ref once OK is pressed.
  choice: RefObject<Weekday>;
};

// The body of the «Copy the list of {day}?» dialog: the six other days as radio rows, the next day
// first and already chosen (the usual target). Each row is one label, so the whole row is the
// target of a tap, with the day's count at its end (a day with nothing says so).
export function CopyDayPicker({ from, counts, choice }: Props) {
  const { t } = useT();
  const name = useId();
  const [chosen, setChosen] = useState<Weekday>(choice.current);

  return (
    <div role="radiogroup" aria-label={t('past.copyOnto')} className={styles.days}>
      {otherWeekdays(from).map(day => (
        <label key={day} className={styles.day} data-checked={day === chosen}>
          <input
            type="radio"
            name={name}
            value={day}
            checked={day === chosen}
            className={styles.radio}
            onChange={() => {
              choice.current = day;
              setChosen(day);
            }}
          />
          <span className={styles.name}>{weekdayLabel(t, day)}</span>
          <span className={styles.count}>
            {counts[day] > 0 ? t('past.count', { n: counts[day] }) : t('past.copyDayNothing')}
          </span>
        </label>
      ))}
    </div>
  );
}
