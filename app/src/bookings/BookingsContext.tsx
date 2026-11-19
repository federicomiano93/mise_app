import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { todayISO } from '@mise/shared/day';
import { useDataServices } from '../data/DataContext';
import { useSession } from '../session/SessionContext';
import { monthOf } from './bookingModel';
import { DEFAULT_SETTINGS } from './bookingSettings';
import type { BookingSettings } from './bookingSettings';
import { createBookingsStore } from './bookingsStore';
import type { BookingsSnapshot, BookingsStore } from './bookingsStore';

// One bookings store for as long as the section is on screen: made from the open venue's source, started on mount and stopped
// on unmount, so the listener exists only while somebody is in Bookings (P14).
//
// It reads ONE calendar month (bookings rebuild step 3): the month the section asks for with `store.watchMonth` — the calendar's,
// or the open form's day's — and this month until it asks. The venue cannot change under it: a venue switch reloads the whole app
// (session.ts).
const BookingsContext = createContext<BookingsStore | null>(null);

export function BookingsProvider({ children }: { children: ReactNode }) {
  const services = useDataServices();
  const { locationId } = useSession();
  // Drawn only for a ready session (SectionRoute), so a venue is always open here.
  if (!locationId) throw new Error('Bookings need an open venue.');
  const [store] = useState(() => createBookingsStore(services.bookings(locationId)));

  useEffect(() => {
    store.start(monthOf(todayISO()));
    return () => store.stop();
  }, [store]);

  return (
    <BookingsContext.Provider value={store}>
      <BookingSettingsProvider locationId={locationId}>{children}</BookingSettingsProvider>
    </BookingsContext.Provider>
  );
}

// ── The venue's bookings settings (config/bookings, bookings settings 18 Nov 2026) ──
//
// One listener for as long as the section is open, beside the bookings' own. `loading` until the first answer — this device's
// copy or the server's; then `ready`. ⚠️ A REFUSAL OR A BROKEN READ IS `ready` WITH THE DEFAULTS: the form then works as it did
// before the settings existed (the phone asked, both modes, the exact time), which is never worse than no form at all.
export type BookingSettingsState = {
  readonly status: 'loading' | 'ready';
  readonly settings: BookingSettings;
};

const SettingsContext = createContext<BookingSettingsState>({ status: 'ready', settings: DEFAULT_SETTINGS });

function BookingSettingsProvider({ locationId, children }: { locationId: string; children: ReactNode }) {
  const services = useDataServices();
  const [state, setState] = useState<BookingSettingsState>({ status: 'loading', settings: DEFAULT_SETTINGS });
  useEffect(() => services.bookings(locationId).watchSettings(
    settings => { setState({ status: 'ready', settings }); },
    () => { setState(current => (current.status === 'ready' ? current : { status: 'ready', settings: DEFAULT_SETTINGS })); },
  ), [services, locationId]);
  return <SettingsContext.Provider value={state}>{children}</SettingsContext.Provider>;
}

// The venue's bookings settings as the form and the booking page obey them. Outside the section (the Home's card): the defaults.
export function useBookingSettings(): BookingSettingsState {
  return useContext(SettingsContext);
}

export function useBookingsStore(): BookingsStore {
  const store = useContext(BookingsContext);
  if (!store) throw new Error('useBookingsStore must be used inside a <BookingsProvider>.');
  return store;
}

// The current data. The store hands back the SAME object until something changes.
export function useBookings(): BookingsSnapshot {
  const store = useBookingsStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

// ── The open form's day (bookings rebuild step 3) ──
//
// The bookings listener reads ONE month. While a form is open its day decides which (the free places of a slot, and the next short
// number, are counted on that month's bookings), so the editor reports its day here and the section moves the listener. Outside
// the section, or with no form, nobody listens.
export const FormDayContext = createContext<(day: string | null) => void>(() => undefined);

export function useReportFormDay(day: string): void {
  const report = useContext(FormDayContext);
  const valid = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day) ? day : null;
  useEffect(() => { report(valid); }, [report, valid]);
  useEffect(() => () => { report(null); }, [report]);
}
