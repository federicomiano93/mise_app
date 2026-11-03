import { useEffect, useMemo, useState } from 'react';

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Today's date as a person reads it («Saturday 10 October»), in the language's locale, and
// correct after midnight on a tablet left open all day.
//
// ⚠️ A CHECK EVERY MINUTE, NOT ONE TIMER TO MIDNIGHT: a timer set for hours ahead is the one
// a sleeping tablet can lose (browsers pause and throttle timers while the screen is off), and
// the date would then stay yesterday's until somebody reloaded. The minute check is cheap, and
// it only re-renders when the DAY actually changed. Waking the tablet refreshes at once.
export function useToday(locale: string): string {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const refresh = () => {
      const current = new Date();
      setNow(previous => (sameDay(previous, current) ? previous : current));
    };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(now),
    [locale, now],
  );
}
