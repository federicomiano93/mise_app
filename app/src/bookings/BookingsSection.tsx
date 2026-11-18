import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useParams } from 'react-router';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { useOwnScrollArea } from '../shell/scrollArea';
import { useTodayKey } from '../shell/useTodayKey';
import { StatusMessageProvider, useStatusMessage } from '../ui/StatusMessage';
import { SPLIT_QUERY } from '../ui/split';
import { useMediaQuery } from '../ui/useMediaQuery';
import { BookingDetail } from './BookingDetail';
import { BookingEditor } from './BookingEditor';
import { BookingsList } from './BookingsList';
import { choiceForDate } from './bookingModel';
import type { ListChoice } from './bookingModel';
import { BookingsProvider, useBookingsStore } from './BookingsContext';
import { savedDateOf } from './bookingsNav';
import { BOOKINGS_PATH, parseBookingsPath } from './bookingsPath';
import type { BookingsView } from './bookingsPath';
import styles from './BookingsSection.module.css';

// «Bookings» / «Prenotazioni» (18 Nov 2026, NEW IN MISE 2, no original in the current app): the customers' orders taken at the
// counter, for pickup or delivery, with the two slips they print. Loaded only when somebody opens it (shell/sectionScreens.ts),
// and only for a person the venue shows it to (SectionRoute, session/visibility.ts).
//
// A phone shows the list OR one booking (its editor); from 1000px the list on the left and the booking on the right, as Pastries.
// Its data lives exactly as long as it is on screen: BookingsProvider starts the one listener on mount and stops it on unmount (P14).
export default function BookingsSection() {
  return (
    <BookingsProvider>
      <StatusMessageProvider>
        <StoreMessages />
        <BookingsScreen />
      </StatusMessageProvider>
    </BookingsProvider>
  );
}

// What the store reports (a refused or failed write) goes to the status message, seen wherever the person has gone since.
function StoreMessages() {
  const { t } = useT();
  const store = useBookingsStore();
  const say = useStatusMessage();
  useEffect(() => store.onMessage(message => {
    say(message.kind === 'no-access' ? t('bookings.err.noAccess') : t('bookings.err.notSaved'), 5000);
  }), [store, say, t]);
  return null;
}

function BookingsScreen() {
  const { t } = useT();
  const { pathname, state } = useLocation();
  const view = parseBookingsPath(useParams()['*']);
  const today = useTodayKey();
  // Which day the list shows is the section's own state, not the address: picking a day is lateral, and Back must not walk
  // through every day that was looked at. Kept while the section is open, across a booking opened and closed.
  const [choice, setChoice] = useState<ListChoice>(() => {
    const saved = savedDateOf(state);
    return saved === null ? { kind: 'today' } : choiceForDate(saved, today);
  });
  // After a save the list opens on the booking's day (the editor hands it over in the navigation's state).
  const saved = savedDateOf(state);
  useEffect(() => {
    if (saved !== null) setChoice(choiceForDate(saved, today));
  }, [saved, today]);

  // ⚠️ BOOKINGS OWN THE SCROLL for the moves inside the section (architecture rule 9, shell/scrollArea.tsx): the list and a booking
  // are separate addresses, and the shell's reset to the top at every address would throw the list back to its top at every booking
  // opened on the split, and bring Back on a phone to the top of the list.
  //  - On the split the list keeps its place; the right-hand side scrolls on its own and starts at its own top.
  //  - On a phone the list's place is noted while the list is on screen, and Back to the list restores it; every other move is a
  //    new screen and starts at the top.
  const split = useMediaQuery(SPLIT_QUERY);
  const scrollArea = useOwnScrollArea();
  const listTop = useRef(0);
  const kind = view.kind;
  useEffect(() => {
    const area = scrollArea();
    if (area === null || kind !== 'list') return undefined;
    const note = () => { listTop.current = area.scrollTop; };
    area.addEventListener('scroll', note, { passive: true });
    return () => { area.removeEventListener('scroll', note); };
  }, [scrollArea, kind]);
  const shown = useRef<{ pathname: string; kind: string } | null>(null);
  const detail = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = { pathname, kind };
    if (detail.current) detail.current.scrollTop = 0;
    const area = scrollArea();
    // The first render (the shell reset the area as the section opened) and StrictMode's second run are not moves.
    if (before === null || before.pathname === pathname || area === null || split) return;
    area.scrollTop = kind === 'list' && before.kind !== 'list' ? listTop.current : 0;
  }, [pathname]);

  if (view.kind === 'unknown') return <Navigate to={BOOKINGS_PATH} replace state={KEEP_FOCUS} />;
  const selectedId = view.kind === 'booking' || view.kind === 'edit' ? view.id : null;

  return (
    <Page title={t('section.bookings')}>
      <div className={styles.layout} data-view={view.kind}>
        <div className={styles.list}>
          <PartBoundary>
            <BookingsList choice={choice} onChoice={setChoice} today={today} selectedId={selectedId} />
          </PartBoundary>
        </div>
        <div ref={detail} className={styles.detail}>
          <PartBoundary resetKey={pathname}>
            <Detail view={view} />
          </PartBoundary>
        </div>
      </div>
    </Page>
  );
}

function Detail({ view }: { view: Exclude<BookingsView, { kind: 'unknown' }> }) {
  const { t } = useT();
  switch (view.kind) {
    case 'list':
      // Only on the split: on a phone the list is the whole screen (BookingsSection.module.css).
      return <p className={styles.pick}>{t('bookings.pick')}</p>;
    case 'booking':
      return <BookingDetail key={view.id} id={view.id} />;
    // Keyed: another booking's editor is a fresh working copy, never the old one renamed.
    case 'new':
      return <BookingEditor key="new" id={null} />;
    case 'edit':
      return <BookingEditor key={view.id} id={view.id} />;
  }
}
