import { useEffect, useState } from 'react';
import { todayISO } from '@mise/shared/day';

// The device's local day as «YYYY-MM-DD», correct after midnight on a tablet left open all day.
// (shell/useToday.ts gives the day as a SPELLED label, not a key the list can compare with.)
//
// ⚠️ A CHECK EVERY MINUTE, NOT ONE TIMER TO MIDNIGHT: a timer set for hours ahead is the one a sleeping
// tablet can lose. The state changes only when the DAY does, so nothing redraws at the other checks.
// Waking the tablet refreshes at once.
export function useTodayKey(): string {
  const [today, setToday] = useState(() => todayISO());

  useEffect(() => {
    const refresh = () => { setToday(todayISO()); };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return today;
}
