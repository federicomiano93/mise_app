import { useEffect, useState } from 'react';
import { toISODate } from '@mise/shared/client-order-model';

// Today as 'YYYY-MM-DD' in the LOCAL calendar, and correct after midnight on a tablet left open all day: the orders
// stream is bounded by the day it STARTED, so the screens drop yesterday's orders themselves (`stillComing`).
//
// ⚠️ A CHECK EVERY MINUTE, NOT ONE TIMER TO MIDNIGHT (see shell/useToday.ts): a timer set hours ahead is the one a
// sleeping tablet loses. Waking the tablet refreshes at once.
export function useTodayISO(): string {
  const [today, setToday] = useState(() => toISODate(Date.now()));
  useEffect(() => {
    const refresh = () => { setToday(toISODate(Date.now())); };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return today;
}
