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
import { BookingsProvider, FormDayContext, useBookings, useBookingsStore } from './BookingsContext';
import { useDataServices } from '../data/DataContext';
import { useSession } from '../session/SessionContext';
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
// How long a failed read of a booking's day waits before it is tried again (it also tries when the connection comes back).
const LOOKUP_RETRY_MS = 5000;

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
  const [formDays, setFormDays] = useState<readonly string[]>([]);
  const reportFormDays = useCallback((value: readonly string[]) => { setFormDays(value); }, []);
  const formOpenNow = view.kind === 'new' || view.kind === 'edit';
  const months = (formOpenNow && formDays.length > 0 ? formDays : [day]).map(monthOf).sort();
  const first = months[0] ?? monthOf(day);
  const last = months[months.length - 1] ?? first;
  useEffect(() => { store.watchMonth(first, last); }, [store, first, last]);

  // ⚠️ A BOOKING OPENED BY ITS ADDRESS IN A MONTH THE LISTENER DOES NOT HOLD (a typed, bookmarked or shared link; a history entry
  // from before the calendar): once the server has answered for the month held without it, its day is read once and the section
  // opens that month. A booking that is gone stays «no longer here».
  const services = useDataServices();
  const { locationId } = useSession();
  const { status: heldStatus, confirmed, items } = useBookings();
  const openId = view.kind === 'booking' || view.kind === 'edit' ? view.id : null;
  const openNow = useRef(openId);
  openNow.current = openId;
  const missing = openId !== null && heldStatus === 'ready' && confirmed && !items.some(b => b.id === openId);
  // What the one-time day lookup has said about the booking open now: its day (null: it does not exist). A failed lookup (offline)
  // is tried again — after a few seconds, and when the connection comes back — never given up for good.
  const [answer, setAnswer] = useState<{ readonly id: string; readonly day: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!missing || openId === null || !locationId || answer?.id === openId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const retry = () => { if (live) setAttempt(n => n + 1); };
    services.bookings(locationId).dayOf(openId).then(found => {
      // Applied only while that booking is still the one open (the section unmounted, or another opened, drops it).
      if (!live || openNow.current !== openId) return;
      setAnswer({ id: openId, day: found });
      if (found !== null) setDay(found);
    }, () => {
      if (!live) return;
      timer = setTimeout(retry, LOOKUP_RETRY_MS);
      window.addEventListener('online', retry, { once: true });
    });
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener('online', retry);
    };
  }, [missing, openId, services, locationId, answer, attempt]);
  // ⚠️ The booking page says «no longer here» only once the lookup has answered that there is no such booking (or that its day is
  // the one already read): until then — also while it keeps failing offline — it keeps its loading line.
  const answered = answer !== null && answer.id === openId && (answer.day === null || answer.day === day);
  const lookingUp = missing && !answered;

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
      <FormDayContext.Provider value={reportFormDays}>
        <div className={formOpen ? `${styles.layout} ${styles.fullForm}` : styles.layout} data-view={view.kind}>
          <div className={styles.list}>
            <PartBoundary>
              <BookingsList day={day} onDay={setDay} today={today} selectedId={selectedId} shown={listShown} />
            </PartBoundary>
          </div>
          <div ref={detail} className={styles.detail}>
            {/* A booking's page has no h1 from the page: a broken one still gets one, through the boundary's own title. */}
            <PartBoundary resetKey={pathname} title={view.kind === 'booking' ? t('section.bookings') : undefined}>
              <Detail view={view} lookingUp={lookingUp} />
            </PartBoundary>
          </div>
        </div>
      </FormDayContext.Provider>
    </Page>
  );
}

function Detail({ view, lookingUp }: { view: Exclude<BookingsView, { kind: 'unknown' }>; lookingUp: boolean }) {
  const { t } = useT();
  switch (view.kind) {
    case 'list':
      // Only on the split: on a phone the list is the whole screen (BookingsSection.module.css).
      return <p className={styles.pick}>{t('bookings.pick')}</p>;
    case 'booking':
      return <BookingDetail key={view.id} id={view.id} lookingUp={lookingUp} />;
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
