import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { parseISODate } from '@mise/shared/day';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { calendarWeeks, dayAfter, monthAfter, monthOf, monthRange } from './bookingModel';
import styles from './BookingsCalendar.module.css';

type Props = {
  // The day picked ('YYYY-MM-DD'); the calendar shows its month.
  readonly day: string;
  readonly today: string;
  // How many bookings each day holds, cancelled ones left out (bookingModel.ts dayCounts). Empty while the month is loading.
  readonly counts: ReadonlyMap<string, number>;
  readonly onDay: (day: string) => void;
  // ‹ › : the month before or after the one shown.
  readonly onMonth: (month: string) => void;
};

// The month calendar of the bookings list (bookings rebuild step 3, 19 Nov 2026: the owner's design on the tablet). It replaces
// the Today / Tomorrow / Later / Past day buttons: the month's name between ‹ and ›, the weekdays MONDAY FIRST (L M M G V S D), a
// day cell per day, today ringed, the picked day filled blue, and an orange badge with the day's bookings (cancelled ones not
// counted).
//
// ⚠️ ONE TAB STOP FOR THE WHOLE MONTH (roving tabindex): Tab reaches the picked day, the arrows move between days (← → a day,
// ↑ ↓ a week, Home / End the week's ends), Enter or Space picks. A table, so a screen reader names each day's weekday column.
// Each day's name is the full date and the count, in hidden text: no aria-label (a name that differs from the words drawn).
export function BookingsCalendar({ day, today, counts, onDay, onMonth }: Props) {
  const { t, locale } = useT();
  const ids = useId();
  const month = monthOf(day);
  const weeks = calendarWeeks(month);
  const grid = useRef<HTMLTableElement>(null);
  const monthName = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(parseISODate(monthRange(month).from));
  // 2 Nov 2026 was a Monday: its week gives the weekday names in the interface's language, Monday first.
  const weekdays = Array.from({ length: 7 }, (_, i) => parseISODate(dayAfter('2026-11-02', i)));
  const narrow = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });
  const long = new Intl.DateTimeFormat(locale, { weekday: 'long' });
  const spoken = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' });

  // The day the arrows moved to holds the single Tab stop (roving tabindex); picking a day, or another month, takes it back to the picked day.
  const [roving, setRoving] = useState<{ readonly day: string; readonly cell: string } | null>(null);
  const stop = roving !== null && roving.day === day && monthOf(roving.cell) === month ? roving.cell : day;

  const focusDay = (target: string) => {
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${target}"]`)?.focus();
  };
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, cell: string) => {
    const weekday = (parseISODate(cell).getDay() + 6) % 7;
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday };
    const by = step[event.key];
    if (by === undefined) return;
    event.preventDefault();
    const target = dayAfter(cell, by);
    // Within the month shown: the next month is ›, never a key that reloads the list under the finger.
    if (monthOf(target) === month) focusDay(target);
  };

  return (
    <div className={styles.calendar}>
      <div className={styles.head}>
        <Button variant="bare" className={styles.arrow} aria-label={t('bookings.calendar.previous')} onPress={() => { onMonth(monthAfter(month, -1)); }}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <h3 id={`${ids}-month`} className={styles.month} aria-live="polite">{monthName}</h3>
        <Button variant="bare" className={styles.arrow} aria-label={t('bookings.calendar.next')} onPress={() => { onMonth(monthAfter(month, 1)); }}>
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      <table ref={grid} className={styles.grid} aria-labelledby={`${ids}-month`}>
        <thead>
          <tr>
            {weekdays.map(date => (
              <th key={date.getDay()} scope="col" className={styles.weekday}>
                <span aria-hidden="true">{narrow.format(date)}</span>
                <span className="visually-hidden">{long.format(date)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map(week => (
            <tr key={week.find(cell => cell !== null) ?? ''}>
              {week.map((cell, index) => {
                if (cell === null) return <td key={`empty-${index}`} className={styles.blank} />;
                const count = counts.get(cell) ?? 0;
                return (
                  <td key={cell} className={styles.cell}>
                    <button
                      type="button"
                      className={styles.day}
                      data-day={cell}
                      tabIndex={cell === stop ? 0 : -1}
                      onFocus={() => { setRoving({ day, cell }); }}
                      aria-pressed={cell === day}
                      aria-current={cell === today ? 'date' : undefined}
                      onClick={() => { onDay(cell); }}
                      onKeyDown={event => { onKey(event, cell); }}
                    >
                      <span aria-hidden="true" className={styles.number}>{Number(cell.slice(8))}</span>
                      <span className="visually-hidden">{spoken.format(parseISODate(cell))}</span>
                      {count > 0 ? (
                        <span className={styles.badge}>
                          <span aria-hidden="true">{count}</span>
                          <span className="visually-hidden">{`, ${t('bookings.calendar.count', { n: count })}`}</span>
                        </span>
                      ) : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
