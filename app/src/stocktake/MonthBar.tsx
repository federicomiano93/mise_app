import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { nextMonth, previousMonth } from '@mise/shared/inventory-model';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { monthName } from './stocktakeFormat';
import styles from './MonthBar.module.css';

type Props = {
  month: string;
  // The month of the clock: the one after it has not happened, so its arrow is shut.
  current: string;
  // Whether the month is closed; null while the store has not named this month yet (no badge then).
  closed: boolean | null;
  onMove: (month: string) => void;
};

// The month on screen, with the arrows to the month before and the month after, and whether it is
// open or closed. The top of the list column.
export function MonthBar({ month, current, closed, onMove }: Props) {
  const { t, locale } = useT();
  const previous = previousMonth(month);
  const next = nextMonth(month);
  const previousButton = useRef<HTMLButtonElement>(null);

  return (
    <div role="group" aria-label={t('stock.monthNav')} className={styles.bar}>
      <Button
        ref={previousButton}
        variant="bare"
        className={styles.arrow}
        aria-label={t('stock.previousMonth')}
        isDisabled={previous === null}
        onPress={() => { if (previous !== null) onMove(previous); }}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>

      <div className={styles.centre}>
        <h2 className={styles.month}>{monthName(month, locale)}</h2>
        {closed === null ? null : (
          <span className={styles.badge} data-closed={closed}>
            {closed ? t('stock.monthClosed') : t('stock.monthOpen')}
          </span>
        )}
      </div>

      {/* ⚠️ NOTHING AHEAD OF THE CURRENT MONTH: a month that has not happened has nothing on its
          shelves to count. Reaching the current month shuts this arrow under the finger that
          pressed it, so the focus is handed to the other one first (a shut button cannot keep it). */}
      <Button
        variant="bare"
        className={styles.arrow}
        aria-label={t('stock.nextMonth')}
        isDisabled={next === null || month >= current}
        onPress={() => {
          if (next === null) return;
          if (next >= current) previousButton.current?.focus();
          onMove(next);
        }}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
}
