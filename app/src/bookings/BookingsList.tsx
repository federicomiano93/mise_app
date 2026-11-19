import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Plus, Printer, Search, Settings, Undo2 } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import type { MessageKey } from '../i18n/en';
import { Button } from '../ui/Button';
import { useStatusMessage } from '../ui/StatusMessage';
import { dayCounts, dayRows, dayToShow, monthMayBeCut, monthOf } from './bookingModel';
import type { Booking, BookingStatus } from './bookingModel';
import { BookingLines } from './BookingLines';
import { BookingsCalendar } from './BookingsCalendar';
import { READ_LIMIT } from './bookingsSource';
import { useTapLockout } from './tapLockout';
import { spellDate } from './bookingWords';
import type { UnitWords } from './bookingWords';
import { useBookings, useBookingsStore } from './BookingsContext';
import { FROM_LIST, RESTORE_REFUSED, newFromList, openedFromList, savedIdOf } from './bookingsNav';
import { bookingPath, editBookingPath, newBookingPath, printerPath, settingsPath } from './bookingsPath';
import styles from './BookingsList.module.css';

// What a person reads for a status (bookings rebuild step 3, the owner's choice): a booking is open, Collected or Cancelled. ⚠️ The
// stored `todo` and `ready` both read as open, and «To do» / «Ready» are said nowhere.
export const STATUS_WORD: Readonly<Record<BookingStatus, MessageKey>> = {
  todo: 'bookings.status.open',
  ready: 'bookings.status.open',
  collected: 'bookings.status.collected',
  cancelled: 'bookings.status.cancelled',
};

type Props = {
  // The day picked on the calendar ('YYYY-MM-DD').
  readonly day: string;
  readonly onDay: (day: string) => void;
  // The device's day, YYYY-MM-DD (moves at midnight by itself: shell/useTodayKey.ts).
  readonly today: string;
  // The booking open beside the list, drawn as current.
  readonly selectedId: string | null;
  // Whether the list is on screen (hidden on a phone behind any other screen, on the split behind a booking or its form).
  readonly shown: boolean;
  // The booking OPEN IN THE LIST (the tablet, 19 Nov 2026): its card, drawn in place of its row (or above the rows when its row is
  // not shown: another day's, filtered out by the search, not loaded yet). null on a phone and while none is open.
  readonly open?: ReactNode;
};

// The bookings of one day picked on a month calendar (bookings rebuild step 3, 19 Nov 2026: the owner's design on the tablet, for
// 24 December — many bookings, each picked up in a time slot, ticked off at the counter). «New booking» is the list's one primary
// action and starts on the picked day.
export function BookingsList({ day, onDay, today, selectedId, shown, open = null }: Props) {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const store = useBookingsStore();
  const say = useStatusMessage();
  const { status, month, through, items, refused } = useBookings();
  const { canManage } = useSession();
  const ids = useId();
  const words: UnitWords = {
    unit: unit => t(unit === 'kg' ? 'bookings.unit.kg' : 'bookings.unit.pcs'),
    packs: n => t('bookings.unit.packs', { n }),
  };
  // The month's bookings arrive with their own month: until then (a month just asked) nothing is counted or listed.
  const shownMonth = monthOf(day);
  const covered = month !== null && through !== null && month <= shownMonth && shownMonth <= through;
  const held = covered ? items : [];
  const loading = status === 'loading' || !covered;
  const counts = dayCounts(held);
  // «Cerca per nome»: the picked day's rows, kept to the names holding what is typed (case and accents folded). A new day starts
  // with an empty box: a name typed for one day would hide another day's rows without a word.
  const [query, setQuery] = useState('');
  const [queryDay, setQueryDay] = useState(day);
  if (queryDay !== day) {
    setQueryDay(day);
    setQuery('');
  }
  const rows = dayRows(held, day, query);
  const dayHasRows = held.some(b => b.date === day);
  const openInRows = open !== null && !loading && rows.some(b => b.id === selectedId);

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

  // ⚠️ BACK FROM A BOOKING HANDS THE FOCUS TO ITS ROW: the list was hidden while the booking took the screen (a phone), or the
  // card holding the focus was closed (the tablet), and the focus, left inside a screen that is gone, would fall to the page's top.
  // Only when nothing else holds it (a phone's gesture, Back, the card's X or Escape).
  const openedId = useRef<string | null>(null);
  useEffect(() => {
    if (!shown || selectedId !== null || openedId.current === null) return;
    const id = openedId.current;
    openedId.current = null;
    if (document.activeElement !== null && document.activeElement !== document.body) return;
    [...(rowsBox.current?.querySelectorAll<HTMLElement>('[data-booking]') ?? [])].find(node => node.dataset.booking === id)?.focus();
  }, [shown, selectedId]);

  // ⚠️ ONE TAP, NO QUESTION (the counter at pickup): Collected, and Undo puts it back to open. It shows at once (the store lays it
  // over the listener's copy); a refusal puts the row back and the section says so (BookingsSection.tsx StoreMessages).
  const taps = useTapLockout();
  const toggle = (booking: Booking) => {
    // A second tap a moment after the first (a double tap) must not put the booking straight back.
    if (taps.locked(booking.id)) return;
    const next: BookingStatus = booking.status === 'collected' ? 'todo' : 'collected';
    taps.lock(booking.id);
    store.setStatus(booking.id, next);
    say(next === 'collected'
      ? t('bookings.row.collectedSaid', { name: booking.customerName })
      : t('bookings.row.reopenedSaid', { name: booking.customerName }));
  };

  return (
    <section ref={rowsBox} className={styles.list} data-open={open !== null ? 'true' : undefined} aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`} className="visually-hidden">{t('section.bookings')}</h2>
      {/* The tablet's left column (it animates its own width, BookingsList.module.css); on a phone it adds no box. */}
      <div className={styles.side}>
        {/* The new booking starts on the day picked in the calendar; a day already gone gives none (it cannot be booked). */}
        <Button
          variant="primary"
          className={styles.add}
          onPress={() => { void navigate(newBookingPath(), { state: newFromList(day >= today ? day : null) }); }}
        >
          <Plus aria-hidden="true" />
          <span>{t('bookings.new')}</span>
        </Button>

        <div className={styles.calendar}>
          <BookingsCalendar
            day={day}
            today={today}
            counts={counts}
            onDay={onDay}
            onMonth={next => { onDay(dayToShow(next, today)); }}
          />
        </div>

        {/* ⚠️ THE LIVE REGIONS ARE ON THE PAGE EMPTY, AND ONLY WHAT IS INSIDE THEM COMES AND GOES: a region inserted already filled
            is not announced reliably (architecture, «Traps already paid for»). */}
        <div className={styles.notices}>
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
            {!loading && monthMayBeCut(held.length, READ_LIMIT) ? <p className={styles.broken}>{t('bookings.monthCut')}</p> : null}
          </div>
        </div>
        {/* This device's receipt printer (bookings step 3): at the foot, out of the way of the day's work. */}
        <Button variant="secondary" className={styles.printer} onPress={() => { void navigate(printerPath(), { state: FROM_LIST }); }}>
          <Printer aria-hidden="true" />
          <span>{t('bookings.printer.door')}</span>
        </Button>
        {/* The venue's bookings settings (bookings settings, 18 Nov 2026): only for whoever manages bookings (the rules' managesBookings). */}
        {canManage ? (
          <Button variant="secondary" className={`${styles.printer} ${styles.settings}`} onPress={() => { void navigate(settingsPath(), { state: FROM_LIST }); }}>
            <Settings aria-hidden="true" />
            <span>{t('bookings.settings.door')}</span>
          </Button>
        ) : null}
      </div>

      <section className={styles.day} aria-labelledby={`${ids}-day`}>
        <h3 id={`${ids}-day`} className={styles.dayTitle}>{spellDate(day, locale)}</h3>
        <div className={styles.search}>
          <label htmlFor={`${ids}-search`} className="visually-hidden">{t('bookings.search.label')}</label>
          <Search aria-hidden="true" className={styles.searchIcon} />
          <input
            id={`${ids}-search`}
            className={styles.searchBox}
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('bookings.search.label')}
            value={query}
            onChange={event => { setQuery(event.currentTarget.value); }}
          />
        </div>
        <div role="status" className={styles.searchSaid}>
          {!loading && dayHasRows && rows.length === 0 ? t('bookings.search.none', { query: query.trim() }) : ''}
        </div>
        {open !== null && !openInRows ? <div className={styles.expanded}>{open}</div> : null}
        {loading ? (
          <p className={styles.empty}>{t('bookings.loading')}</p>
        ) : !dayHasRows ? (
          <p className={styles.empty}>{t('bookings.empty.day')}</p>
        ) : (
          <ul className={styles.rows}>
            {rows.map(booking => (
              <li key={booking.id}>
                {open !== null && booking.id === selectedId ? <div className={styles.expanded}>{open}</div> : <Row booking={booking} current={booking.id === selectedId} locale={locale} words={words} onToggle={toggle} onOpen={() => { openedId.current = booking.id; }} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

// One booking: its slot on the left (the start big and blue, the end small under it; an exact time alone), the name — the link to
// the booking, stretched over the whole row — the products one per line, Pickup / Delivery, and at the bottom right «Mark collected»
// (once collected: a green «✓ Collected» and «Undo collection»). A cancelled one has no button: «Cancelled», crossed out.
// ⚠️ THE BUTTON IS NOT INSIDE THE LINK (a button cannot nest in a link): the link's ::after covers the row, the button sits above it.
function Row({ booking, current, locale, words, onToggle, onOpen }: {
  booking: Booking;
  current: boolean;
  locale: string;
  words: UnitWords;
  onToggle: (booking: Booking) => void;
  onOpen: () => void;
}) {
  const { t } = useT();
  const ids = useId();
  const collected = booking.status === 'collected';
  const cancelled = booking.status === 'cancelled';
  return (
    <div className={styles.row} data-status={booking.status} data-current={current ? 'true' : undefined}>
      <span className={styles.slot}>
        <span className={styles.start}>{booking.time}</span>
        {booking.slotEnd !== null ? <span className={styles.end}><span className="visually-hidden">–</span>{booking.slotEnd}</span> : null}
      </span>
      <div className={styles.main}>
        <Link
          id={`${ids}-name`}
          to={bookingPath(booking.id)}
          state={openedFromList(booking.date)}
          className={styles.name}
          data-booking={booking.id}
          aria-current={current ? 'page' : undefined}
          onClick={onOpen}
        >
          {booking.customerName}
        </Link>
        <div className={styles.products}>
          <BookingLines lines={booking.lines} locale={locale} words={words} />
        </div>
        <div className={styles.foot}>
          <span className={styles.mode} data-mode={booking.mode}>
            {t(booking.mode === 'delivery' ? 'bookings.mode.delivery' : 'bookings.mode.pickup')}
          </span>
          {cancelled ? <span className={styles.cancelled}>{t('bookings.status.cancelled')}</span> : null}
          {/* Collected: a green «✓ Collected» that is a STATE, not a button, then a plain «Undo collection» beside it. Before, the
              action itself was green with a tick and the owner read it as «already collected» (19 Nov 2026): the action now says
              «Mark collected» in blue, the tick and the green belong to the state alone. */}
          {cancelled ? null : (
            <div className={styles.actions}>
              {collected ? <span className={styles.done}><Check aria-hidden="true" />{t('bookings.status.collected')}</span> : null}
              <button
                type="button"
                className={styles.collect}
                data-collected={collected ? 'true' : undefined}
                aria-describedby={`${ids}-name`}
                onClick={() => { onToggle(booking); }}
              >
                {collected ? (
                  <>
                    <Undo2 aria-hidden="true" />
                    <span>{t('bookings.row.undo')}</span>
                  </>
                ) : (
                  <span>{t('bookings.row.collect')}</span>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
