import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import { WEEKDAYS } from '@mise/shared/pastries-model';
import type { Weekday } from '@mise/shared/pastries-model';
import { useT } from '../i18n/useT';
import { useMediaQuery } from '../ui/useMediaQuery';
import { usePastries } from './PastriesContext';
import { SPLIT_QUERY } from './split';
import { tabId, weekdayLabel, weekdayShortLabel } from './weekdays';
import styles from './DaysNav.module.css';

type Props = {
  // The day shown; null on Records, where no day is.
  selected: Weekday | null;
  // The day the section opened on (tomorrow): it keeps a marker, so it stays findable after
  // browsing away.
  opening: Weekday;
  onPick: (day: Weekday) => void;
  // The panel the selected day controls; undefined where there is none (the editor, Records).
  panelId: string | undefined;
};

// Where an arrow, Home or End key sends the selection. Both pairs, whichever way the days are
// laid out: Right and Down go on, Left and Up go back, and the week wraps.
function targetOf(key: string, index: number): number | null {
  const last = WEEKDAYS.length - 1;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return index === last ? 0 : index + 1;
    case 'ArrowLeft':
    case 'ArrowUp':
      return index === 0 ? last : index - 1;
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

// The seven days, Monday first: a strip of chips above the day on a phone, a list on the left of
// it from 1000px. ONE set of buttons — only CSS changes the layout — so what a keyboard or a
// screen reader meets is the same at every width, and a tablet turned sideways does not rebuild it.
//
// It is a tab list: only the selected day is in the Tab order, the arrows move the selection AND the
// focus, and a day's name for a screen reader is the full weekday («Tuesday»), never the three
// letters drawn. What is drawn (count, marker, tick) is hidden from assistive technology and said
// once, in words, as the tab's description.
//
// ⚠️ PICKING A DAY DOES NOT PULL THE FOCUS INTO THE PANEL. The focus belongs on the tab that was
// pressed: moved into the panel, there would be nothing in the list for the next arrow key to move
// from.
export function DaysNav({ selected, opening, onPick, panelId }: Props) {
  const { t } = useT();
  const { days, confirmed } = usePastries();
  const vertical = useMediaQuery(SPLIT_QUERY);
  const tabs = useRef(new Map<Weekday, HTMLButtonElement>());
  const base = useId();
  // With no day selected (Records) the list is still one stop of the keyboard: on the opening day.
  const stop = selected ?? opening;

  // On the narrowest phones the strip scrolls sideways: the chosen day must not wait off the edge
  // (an address that opens on Sunday). `nearest` leaves the page alone when it is already in view.
  // jsdom has no scrollIntoView.
  useEffect(() => {
    if (selected !== null) tabs.current.get(selected)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [selected]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = targetOf(event.key, index);
    const day = target === null ? undefined : WEEKDAYS[target];
    if (day === undefined) return;
    event.preventDefault();
    onPick(day);
    tabs.current.get(day)?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={t('past.daysLabel')}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      className={styles.list}
    >
      {WEEKDAYS.map((day, index) => {
        const count = days[day].items.length;
        const isSelected = day === selected;
        const isOpening = day === opening;
        const isConfirmed = confirmed.has(day);
        const countText = count > 0 ? t('past.count', { n: count }) : t('past.nothingYet');
        const description = [
          countText,
          isOpening ? t('day.tomorrow') : null,
          isConfirmed ? t('past.confirmedMark') : null,
        ].filter(part => part !== null).join(', ');
        const descriptionId = `${base}-${day}`;

        return (
          <button
            key={day}
            ref={node => {
              if (node) tabs.current.set(day, node);
              else tabs.current.delete(day);
            }}
            type="button"
            role="tab"
            id={tabId(day)}
            aria-selected={isSelected}
            aria-controls={isSelected ? panelId : undefined}
            aria-label={weekdayLabel(t, day)}
            aria-describedby={descriptionId}
            tabIndex={day === stop ? 0 : -1}
            data-empty={count === 0}
            className={styles.tab}
            onClick={() => onPick(day)}
            onKeyDown={event => onKeyDown(event, index)}
          >
            <span className={styles.short} aria-hidden="true">{weekdayShortLabel(t, day)}</span>
            <span className={styles.full} aria-hidden="true">{weekdayLabel(t, day)}</span>
            <span className={styles.number} aria-hidden="true">{count}</span>
            <span className={styles.sub} aria-hidden="true">{countText}</span>
            <span className={styles.marks} aria-hidden="true">
              {isOpening ? <span className={styles.dot} /> : null}
              {isOpening ? <span className={`${styles.chip} ${styles.chipTomorrow}`}>{t('day.tomorrow')}</span> : null}
              {isConfirmed ? (
                <span className={`${styles.chip} ${styles.chipOk}`}>
                  <Check />
                  <span className={styles.chipWord}>{t('past.confirmedMark')}</span>
                </span>
              ) : null}
            </span>
            <span id={descriptionId} className={styles.sr}>{description}</span>
          </button>
        );
      })}
    </div>
  );
}
