import { useCallback, useEffect, useRef } from 'react';
import { useAway, useAwayStore } from './AwayContext';

// «I am back» removes the thing that was pressed (the Home's band) or changes it into another (Settings' row): the focus must not fall to
// the page's body. When the holiday ends while the focus has nowhere to be, `target` says where it goes.
//
//   const armFocus = useFocusOnBack(() => row.current);
//   const [askComeBack, dialog] = useAskComeBack(armFocus);
//
// ⚠️ ONLY AFTER THIS SCREEN'S OWN «I AM BACK» (the returned `arm`, called as the person answers): the holiday also ends because the day
// changed or another phone ended it, and then nobody pressed anything — moving the focus would be announced out of nowhere (review,
// 8 Nov 2026). And only when the focus is homeless: somebody typing in a field keeps the focus they have.
export function useFocusOnBack(target: () => HTMLElement | null): () => void {
  const store = useAwayStore();
  const away = useAway().away;
  const was = useRef(away);
  const armed = useRef(false);
  const where = useRef(target);
  where.current = target;

  useEffect(() => {
    const ended = was.current && !away;
    was.current = away;
    if (!ended || !armed.current) return;
    armed.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body || active === document.documentElement) where.current()?.focus();
  }, [away]);

  // ⚠️ DISARMED BY A REFUSAL TOO: a refusal that lands before React draws the «back» state leaves `away` unchanged, the effect above never
  // runs, and an arm left on would move the focus the next time the holiday ends by itself (review, 8 Nov 2026).
  useEffect(() => store.onRefused(() => { armed.current = false; }), [store]);

  // Armed only while away: an «I am back» over a holiday already ended changes nothing to hand the focus for.
  return useCallback(() => { armed.current = store.getSnapshot().away; }, [store]);
}
