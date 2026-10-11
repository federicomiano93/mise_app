import { useMemo } from 'react';
import { moneyOf } from '@mise/shared/currency';
import type { Money } from '@mise/shared/currency';
import { currencyOf, moneyLayoutOf } from '@mise/shared/market';
import type { DocData } from './backend';
import { useSession } from './SessionContext';

// The money the open venue counts in: its symbol and how an amount is written.
//
// ⚠️⚠️ IT FOLLOWS THE VENUE'S COUNTRY, NOT THE INTERFACE LANGUAGE (his decision, 23 Aug 2026; the
// layout 4 Oct 2026): an English-speaking employee at an Italian bakery still reads «1.234,56 €».
// An unknown country falls back to the app's historical «£1234.56», like js/currency.js: a price
// under the wrong symbol is only mislabelled, while a bare number reads as a broken screen.
//
// ⚠️ NOTHING IS CONVERTED: only the text around the stored number changes.
//
// The current app keeps this in a module variable set when a venue opens (js/firebase.js
// setCurrency), and a value read at module load froze the fallback into fourteen places once
// (v1.57.0). Mise 2 reads it from the session every time a screen draws, so that cannot happen.
export function moneyForVenue(location: DocData | null): Money {
  return moneyOf(currencyOf(location), moneyLayoutOf(location));
}

export function useMoney(): Money {
  const { location } = useSession();
  return useMemo(() => moneyForVenue(location), [location]);
}
