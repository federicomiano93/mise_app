import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import type { Booking } from '../bookings/bookingModel';
import { useDataServices } from '../data/DataContext';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { useTodayKey } from '../shell/useTodayKey';
import { useVisibleSections } from '../shell/useVisibleSections';
import styles from './OrdersDueCard.module.css';

// The Bookings section's address of one booking. Written here rather than imported: a feature never imports another's folder
// (bookings/bookingsPath.ts builds the same `/bookings/<id>`, the id encoded as one path segment). Only the TYPE of a booking is
// read from there, which carries no code.
const bookingAddress = (id: string): string => `/bookings/${encodeURIComponent(id)}`;

// Today's bookings still to hand over: not collected, not cancelled, by time (bookings/bookingModel.ts stillToHandOver says the same).
function stillToday(bookings: readonly Booking[], today: string): Booking[] {
  return bookings
    .filter(b => b.date === today && (b.status === 'todo' || b.status === 'ready'))
    .sort((a, b) => a.time.localeCompare(b.time) || a.number - b.number);
}

// «Prenotazioni di oggi» on the Home (18 Nov 2026): today's bookings still to hand over, one row each (time, name, ready or not);
// a tap opens the booking. With none left the card is not drawn, and it is never drawn for somebody the venue does not show
// Bookings to (nothing is read for them). Its one listener (today's bookings only, bounded) lives while the Home is on
// screen and moves to the new day at midnight. It tells the Home only WHETHER it is drawn (the Home lays out its columns by it).
export function BookingsTodayPart({ onShownChange }: { onShownChange: (shown: boolean) => void }) {
  const { t } = useT();
  const services = useDataServices();
  const { locationId } = useSession();
  const { visible } = useVisibleSections();
  const seesBookings = visible.has('bookings');
  const today = useTodayKey();
  const [items, setItems] = useState<readonly Booking[]>([]);

  useEffect(() => {
    if (!seesBookings || !locationId) return undefined;
    // A dead stream hides the card: it is a shortcut, never the only way to the bookings.
    const stop = services.bookings(locationId).watchDay(today, list => { setItems(stillToday(list, today)); }, () => { setItems([]); });
    return () => {
      stop();
      setItems([]);
    };
  }, [services, locationId, seesBookings, today]);

  const shown = items.length > 0;
  useEffect(() => {
    onShownChange(shown);
    return () => { onShownChange(false); };
  }, [shown, onShownChange]);

  // ⚠️ A ROW CAN GO UNDER A KEYBOARD'S FOCUS (collected on another device): the focus then goes to the card's title, or — when the
  // card went with it — to «Da fare»'s title, never to the top of the page (the «Ordini da fare» card's rule).
  const focusedId = useRef<string | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const focusLost = () => document.activeElement === null || document.activeElement === document.body;
  useLayoutEffect(() => {
    const id = focusedId.current;
    if (id === null || !shown || items.some(b => b.id === id)) return;
    focusedId.current = null;
    if (focusLost()) title.current?.focus();
  }, [items, shown]);
  useEffect(() => {
    if (shown || focusedId.current === null) return;
    focusedId.current = null;
    if (focusLost()) document.getElementById('home-todo-title')?.focus();
  }, [shown]);

  if (!shown) return null;
  return (
    <section className={styles.card} aria-labelledby="home-bookings-today-title">
      <h2 ref={title} id="home-bookings-today-title" tabIndex={-1} className={styles.title}>{t('home.bookingsToday.title')}</h2>
      <ul className={styles.rows}>
        {items.map(booking => (
          <li key={booking.id}>
            <Link
              to={bookingAddress(booking.id)}
              className={styles.row}
              data-ready={booking.status === 'ready' ? 'true' : undefined}
              onFocus={() => { focusedId.current = booking.id; }}
              onBlur={event => { if (event.currentTarget.isConnected) focusedId.current = null; }}
            >
              <span className={styles.name}>
                {booking.time} · {booking.customerName}
                {' — '}
                {t(booking.status === 'ready' ? 'bookings.status.ready' : 'bookings.status.todo')}
              </span>
              <ChevronRight aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
