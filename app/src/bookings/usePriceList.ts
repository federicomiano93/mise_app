import { useEffect, useState } from 'react';
import type { PriceList } from '@mise/shared/price-list';
import { useDataServices } from '../data/DataContext';
import { useSession } from '../session/SessionContext';

// The published price list (`price-list/bookings`), live while a screen that needs it is open: the editor (its products) and,
// since bookings rebuild step 4, the booking page (which products are «Chiedi per pezzo», for the lab slips). One document.
// `unavailable`: refused or broken — the editor still takes free text, the booking page prints «Tutto insieme».
export type PriceListState = { readonly list: PriceList; readonly unavailable: boolean; readonly loaded: boolean };

const EMPTY: PriceList = { items: [], publishedAtMs: null };

export function usePriceList(): PriceListState {
  const services = useDataServices();
  const { locationId } = useSession();
  const [state, setState] = useState<PriceListState>({ list: EMPTY, unavailable: false, loaded: false });
  useEffect(() => {
    if (!locationId) return undefined;
    return services.bookings(locationId).watchPriceList(
      list => { setState({ list, unavailable: false, loaded: true }); },
      () => { setState({ list: EMPTY, unavailable: true, loaded: true }); },
    );
  }, [services, locationId]);
  return state;
}
