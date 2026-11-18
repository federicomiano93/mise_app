import { useEffect, useId, useRef } from 'react';
import { Plus, Printer, Settings } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import type { MessageKey } from '../i18n/en';
import { Button } from '../ui/Button';
import { dayAfter, groupsFor, oldestKeptDay } from './bookingModel';
import type { Booking, BookingStatus, ListChoice } from './bookingModel';
import { linesSummary, spellDate } from './bookingWords';
import type { UnitWords } from './bookingWords';
import { useBookings } from './BookingsContext';
import { FROM_LIST, RESTORE_REFUSED, savedIdOf } from './bookingsNav';
import { bookingPath, editBookingPath, newBookingPath, printerPath, settingsPath } from './bookingsPath';
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
  const { canManage } = useSession();
  const ids = useId();
  const yesterday = dayAfter(today, -1);
  const oldest = oldestKeptDay(today);
  const words: UnitWords = {
    unit: unit => t(unit === 'kg' ? 'bookings.unit.kg' : 'bookings.unit.pcs'),
    packs: n => t('bookings.unit.packs', { n }),
  };
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
      <Button variant="primary" className={styles.add} onPress={() => { void navigate(newBookingPath(), { state: FROM_LIST }); }}>
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

      {/* ⚠️ THE LIVE REGIONS ARE ON THE PAGE EMPTY, AND ONLY WHAT IS INSIDE THEM COMES AND GOES: a region inserted already filled
          is not announced reliably (architecture, «Traps already paid for»). */}
      <div role="alert">
        {refused !== null ? (
          <div className={styles.refused}>
            <span>{t('bookings.refused.text')}</span>
            <Button
              variant="secondary"
              onPress={() => { void navigate(refused.id === null ? newBookingPath() : editBookingPath(refused.id), { state: RESTORE_REFUSED }); }}
            >
              {t('bookings.refused.open')}
            </Button>
          </div>
        ) : null}
      </div>

      <div role="status">
        {status === 'error' ? <p className={styles.broken}>{t('bookings.streamError')}</p> : null}
      </div>

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
                      <Row booking={booking} current={booking.id === selectedId} locale={locale} words={words} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </>
      )}
      {/* This device's receipt printer (bookings step 3): at the foot, out of the way of the day's work. */}
      <Button variant="secondary" className={styles.printer} onPress={() => { void navigate(printerPath(), { state: FROM_LIST }); }}>
        <Printer aria-hidden="true" />
        <span>{t('bookings.printer.door')}</span>
      </Button>
      {/* The venue's bookings settings (bookings settings, 18 Nov 2026): only for whoever manages bookings (the rules' managesBookings). */}
      {canManage ? (
        <Button variant="secondary" className={styles.printer} onPress={() => { void navigate(settingsPath(), { state: FROM_LIST }); }}>
          <Settings aria-hidden="true" />
          <span>{t('bookings.settings.door')}</span>
        </Button>
      ) : null}
    </section>
  );
}

function Row({ booking, current, locale, words }: {
  booking: Booking;
  current: boolean;
  locale: string;
  words: UnitWords;
}) {
  const { t } = useT();
  const summary = linesSummary(booking.lines, locale, words);
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
