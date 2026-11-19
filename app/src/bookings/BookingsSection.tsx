import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { PrinterScreen } from './PrinterScreen';
import { BookingSettingsScreen } from './BookingSettingsScreen';
import { BookingsList } from './BookingsList';
import { monthOf } from './bookingModel';
import { BookingsProvider, FormDayContext, useBookingsStore } from './BookingsContext';
import { dayOfState, savedDateOf } from './bookingsNav';
import { BOOKINGS_PATH, parseBookingsPath } from './bookingsPath';
import type { BookingsView } from './bookingsPath';
import styles from './BookingsSection.module.css';

// «Bookings» / «Prenotazioni» (18 Nov 2026, NEW IN MISE 2, no original in the current app): the customers' orders taken at the
// counter, for pickup or delivery, with the two slips they print. Loaded only when somebody opens it (shell/sectionScreens.ts),
// and only for a person the venue shows it to (SectionRoute, session/visibility.ts).
//
// A phone shows the list OR one booking (its editor); from 1000px the list on the left and, on the right, the printer or the settings
// screen; a booking and its form take the whole width (bookings rebuild steps 2 and 3).
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
    // A one-tap Collected / Undo the server refused: the row is already back as it was, and the words say so.
    if (message.status) say(message.kind === 'no-access' ? t('bookings.err.statusNoAccess') : t('bookings.err.statusNotSaved'), 6000);
    else say(message.kind === 'no-access' ? t('bookings.err.noAccess') : t('bookings.err.notSaved'), 5000);
  }), [store, say, t]);
  return null;
}

function BookingsScreen() {
  const { t } = useT();
  const { pathname, state } = useLocation();
  const view = parseBookingsPath(useParams()['*']);
  const today = useTodayKey();
  // Which day the list shows (the day picked on the calendar, bookings rebuild step 3) is the section's own state, not the
  // address: picking a day is lateral, and Back must not walk through every day that was looked at. Kept while the section is
  // open, across a booking opened and closed. It opens on the day the move is about (a booking reloaded, one just saved), else today.
  const [day, setDay] = useState<string>(() => dayOfState(state) ?? today);
  // After a save the list opens on the booking's day (the editor hands it over in the navigation's state).
  const saved = savedDateOf(state);
  useEffect(() => {
    if (saved !== null) setDay(saved);
  }, [saved]);
  // ⚠️ A TABLET LEFT OPEN ACROSS MIDNIGHT: a list that was showing today moves to the new today; a day picked on purpose stays.
  const todayBefore = useRef(today);
  useEffect(() => {
    if (todayBefore.current === today) return;
    const was = todayBefore.current;
    todayBefore.current = today;
    setDay(current => (current === was ? today : current));
  }, [today]);

  // ⚠️ THE ONE LISTENER READS ONE MONTH (bookingsSource.ts): the picked day's — or, while a form is open, its own day's, so the
  // free places of a slot and the next short number are counted on the month the booking is for.
  const store = useBookingsStore();
  const [formDay, setFormDay] = useState<string | null>(null);
  const reportFormDay = useCallback((value: string | null) => { setFormDay(value); }, []);
  const formOpenNow = view.kind === 'new' || view.kind === 'edit';
  const watched = monthOf(formOpenNow && formDay !== null ? formDay : day);
  useEffect(() => { store.watchMonth(watched); }, [store, watched]);

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
  // The booking form (bookings rebuild step 2) and the booking itself (step 3) take the WHOLE width, on the split too (the owner's
  // design): the list is hidden while they are open, and Back brings it back where it was.
  const formOpen = kind === 'new' || kind === 'edit' || kind === 'booking';
  // Where the list is on screen: alone on a phone; on the split beside everything but the form.
  const listShown = split ? !formOpen : kind === 'list';
  // ⚠️ SET IN THE LAYOUT EFFECT BELOW, before any scroll the move causes: the reset to the top, and the browser clamping the area
  // when the list is hidden, fire `scroll` events that may land before the listener is removed (a slow tablet), and must not be
  // taken for the list's place (review).
  const listShownNow = useRef(listShown);
  useEffect(() => {
    const area = scrollArea();
    if (area === null || !listShown) return undefined;
    const note = () => { if (listShownNow.current) listTop.current = area.scrollTop; };
    area.addEventListener('scroll', note, { passive: true });
    return () => { area.removeEventListener('scroll', note); };
  }, [scrollArea, listShown]);
  const shown = useRef<{ pathname: string; kind: string } | null>(null);
  const detail = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = { pathname, kind };
    listShownNow.current = listShown;
    if (detail.current) detail.current.scrollTop = 0;
    const area = scrollArea();
    // The first render (the shell reset the area as the section opened) and StrictMode's second run are not moves.
    if (before === null || before.pathname === pathname || area === null) return;
    const wasForm = before.kind === 'new' || before.kind === 'edit' || before.kind === 'booking';
    // ⚠️ ON THE SPLIT the list keeps its place, except across the full-width form: hidden, the list let the area shrink to the
    // form's height (its place was lost), so it is put back as the form closes, and the form opens at the top.
    if (split) {
      if (formOpen && !wasForm) area.scrollTop = 0;
      else if (!formOpen && wasForm) area.scrollTop = listTop.current;
      return;
    }
    area.scrollTop = kind === 'list' && before.kind !== 'list' ? listTop.current : 0;
  }, [pathname]);

  if (view.kind === 'unknown') return <Navigate to={BOOKINGS_PATH} replace state={KEEP_FOCUS} />;
  const selectedId = view.kind === 'booking' || view.kind === 'edit' ? view.id : null;

  return (
    // A booking's page draws its own h1, the customer's name (bookings rebuild step 3); the tab keeps the section's name, never a
    // customer's.
    <Page title={t('section.bookings')} ownHeading={view.kind === 'booking'}>
      <FormDayContext.Provider value={reportFormDay}>
        <div className={formOpen ? `${styles.layout} ${styles.fullForm}` : styles.layout} data-view={view.kind}>
          <div className={styles.list}>
            <PartBoundary>
              <BookingsList day={day} onDay={setDay} today={today} selectedId={selectedId} />
            </PartBoundary>
          </div>
          <div ref={detail} className={styles.detail}>
            {/* A booking's page has no h1 from the page: a broken one still gets one, through the boundary's own title. */}
            <PartBoundary resetKey={pathname} title={view.kind === 'booking' ? t('section.bookings') : undefined}>
              <Detail view={view} />
            </PartBoundary>
          </div>
        </div>
      </FormDayContext.Provider>
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
    case 'printer':
      return <PrinterScreen />;
    case 'settings':
      return <BookingSettingsScreen />;
  }
}
