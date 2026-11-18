import { useEffect, useId, useRef } from 'react';
import { Plus } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useT } from '../i18n/useT';
import type { MessageKey } from '../i18n/en';
import { Button } from '../ui/Button';
import { dayAfter, groupsFor, oldestKeptDay } from './bookingModel';
import type { Booking, BookingStatus, ListChoice } from './bookingModel';
import { linesSummary, spellDate } from './bookingWords';
import { useBookings } from './BookingsContext';
import { FROM_LIST, RESTORE_REFUSED, savedIdOf } from './bookingsNav';
import { bookingPath, editBookingPath, newBookingPath } from './bookingsPath';
import styles from './BookingsList.module.css';

export const STATUS_WORD: Readonly<Record<BookingStatus, MessageKey>> = {
  todo: 'bookings.status.todo',
  ready: 'bookings.status.ready',
  collected: 'bookings.status.collected',
  cancelled: 'bookings.status.cancelled',
};

const CHOICES: ReadonlyArray<{ kind: ListChoice['kind']; label: MessageKey }> = [
  { kind: 'today', label: 'bookings.choice.today' },
  { kind: 'tomorrow', label: 'bookings.choice.tomorrow' },
  { kind: 'later', label: 'bookings.choice.later' },
  { kind: 'past', label: 'bookings.choice.past' },
];

type Props = {
  readonly choice: ListChoice;
  readonly onChoice: (choice: ListChoice) => void;
  // The device's day, YYYY-MM-DD (moves at midnight by itself: shell/useTodayKey.ts).
  readonly today: string;
  // The booking open beside the list, drawn as current.
  readonly selectedId: string | null;
};

// The bookings by day (18 Nov 2026): Today, Tomorrow, Later (every day after tomorrow, a heading each) and a past day still
// kept (the last 30 days). «New booking» is the list's one primary action.
export function BookingsList({ choice, onChoice, today, selectedId }: Props) {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const { status, items, refused } = useBookings();
  const ids = useId();
  const yesterday = dayAfter(today, -1);
  const oldest = oldestKeptDay(today);
  const unitWord = (unit: 'pcs' | 'kg') => t(unit === 'kg' ? 'bookings.unit.kg' : 'bookings.unit.pcs');
  const groups = groupsFor(items, choice, today);

  // After a save the focus goes to the saved booking's row, once, as soon as the list shows it (the editor it came from is gone).
  const { state, key } = useLocation();
  const savedId = savedIdOf(state);
  const focusedFor = useRef<string | null>(null);
  const rowsBox = useRef<HTMLElement>(null);
  useEffect(() => {
    if (savedId === null || focusedFor.current === key) return;
    const row = [...(rowsBox.current?.querySelectorAll<HTMLElement>('[data-booking]') ?? [])].find(node => node.dataset.booking === savedId);
    if (!row) return;
    focusedFor.current = key;
    row.focus();
  });

  const pick = (kind: ListChoice['kind']) => {
    if (kind === choice.kind) return;
    onChoice(kind === 'past' ? { kind: 'past', date: yesterday } : { kind } as ListChoice);
  };

  return (
    <section ref={rowsBox} className={styles.list} aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`} className="visually-hidden">{t('section.bookings')}</h2>
      <Button variant="primary" className={styles.add} onPress={() => { void navigate(newBookingPath()); }}>
        <Plus aria-hidden="true" />
        <span>{t('bookings.new')}</span>
      </Button>

      <div role="group" aria-label={t('bookings.choice.label')} className={styles.choices}>
        {CHOICES.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            className={styles.choice}
            aria-pressed={choice.kind === kind}
            onClick={() => { pick(kind); }}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {choice.kind === 'past' ? (
        <div className={styles.past}>
          <label className={styles.pastLabel} htmlFor={`${ids}-past`}>{t('bookings.past.label')}</label>
          <input
            id={`${ids}-past`}
            className={styles.input}
            type="date"
            min={oldest}
            max={yesterday}
            value={choice.date}
            aria-describedby={`${ids}-past-hint`}
            onChange={event => {
              const value = event.currentTarget.value;
              // An emptied or out-of-range box keeps the day shown: the list never asks for a day it cannot hold.
              if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) && value >= oldest && value <= yesterday) onChoice({ kind: 'past', date: value });
            }}
          />
          <p id={`${ids}-past-hint`} className={styles.hint}>{t('bookings.past.hint')}</p>
        </div>
      ) : null}

      {refused !== null ? (
        <div className={styles.refused} role="alert">
          <span>{t('bookings.refused.text')}</span>
          <Button
            variant="secondary"
            onPress={() => { void navigate(refused.id === null ? newBookingPath() : editBookingPath(refused.id), { state: RESTORE_REFUSED }); }}
          >
            {t('bookings.refused.open')}
          </Button>
        </div>
      ) : null}

      {status === 'error' ? <p className={styles.broken} role="status">{t('bookings.streamError')}</p> : null}

      {status === 'loading' ? (
        <p className={styles.empty}>{t('bookings.loading')}</p>
      ) : (
        <>
          {groups.length === 0 ? <p className={styles.empty}>{t('bookings.empty.later')}</p> : null}
          {groups.map(group => (
            <section key={group.date} className={styles.day} aria-labelledby={`${ids}-${group.date}`}>
              <h3 id={`${ids}-${group.date}`} className={styles.dayTitle}>{spellDate(group.date, locale)}</h3>
              {group.bookings.length === 0 ? (
                <p className={styles.empty}>{t('bookings.empty.day')}</p>
              ) : (
                <ul className={styles.rows}>
                  {group.bookings.map(booking => (
                    <li key={booking.id}>
                      <Row booking={booking} current={booking.id === selectedId} locale={locale} unitWord={unitWord} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </>
      )}
    </section>
  );
}

function Row({ booking, current, locale, unitWord }: {
  booking: Booking;
  current: boolean;
  locale: string;
  unitWord: (unit: 'pcs' | 'kg') => string;
}) {
  const { t } = useT();
  const summary = linesSummary(booking.lines, locale, unitWord);
  return (
    <Link
      to={bookingPath(booking.id)}
      state={FROM_LIST}
      className={styles.row}
      data-status={booking.status}
      data-booking={booking.id}
      aria-current={current ? 'page' : undefined}
    >
      <span className={styles.time}>{booking.time}</span>
      <span className={styles.main}>
        <span className={styles.name}>{booking.customerName}</span>
        <span className={styles.summary}>
          {summary.text}
          {summary.more > 0 ? ` ${t('bookings.moreLines', { n: summary.more })}` : ''}
        </span>
      </span>
      <span className={styles.tags}>
        <span className={styles.mode} data-mode={booking.mode}>
          {t(booking.mode === 'delivery' ? 'bookings.mode.delivery' : 'bookings.mode.pickup')}
        </span>
        <span className={styles.status} data-status={booking.status}>{t(STATUS_WORD[booking.status])}</span>
      </span>
    </Link>
  );
}
