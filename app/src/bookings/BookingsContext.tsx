import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { todayISO } from '@mise/shared/day';
import { useDataServices } from '../data/DataContext';
import { useSession } from '../session/SessionContext';
import { oldestKeptDay } from './bookingModel';
import { createBookingsStore } from './bookingsStore';
import type { BookingsSnapshot, BookingsStore } from './bookingsStore';

// One bookings store for as long as the section is on screen: made from the open venue's source, started on mount and stopped
// on unmount, so the listener exists only while somebody is in Bookings (P14).
//
// It reads from the oldest day still kept (30 days back) as the section OPENS. A tablet left on the section across midnight
// keeps one day more than it needs, which costs nothing: the scheduled function deletes it on the server anyway.
// The venue cannot change under it: a venue switch reloads the whole app (session.ts).
const BookingsContext = createContext<BookingsStore | null>(null);

export function BookingsProvider({ children }: { children: ReactNode }) {
  const services = useDataServices();
  const { locationId } = useSession();
  // Drawn only for a ready session (SectionRoute), so a venue is always open here.
  if (!locationId) throw new Error('Bookings need an open venue.');
  const [store] = useState(() => createBookingsStore(services.bookings(locationId)));

  useEffect(() => {
    store.start(oldestKeptDay(todayISO()));
    return () => store.stop();
  }, [store]);

  return <BookingsContext.Provider value={store}>{children}</BookingsContext.Provider>;
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
