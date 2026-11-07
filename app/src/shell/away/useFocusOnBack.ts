import { useEffect, useRef } from 'react';
import { useAway } from './AwayContext';

// «I am back» removes the thing that was pressed (the Home's band) or changes it into another (Settings' row): the focus must not fall to
// the page's body. When the holiday ends while the focus has nowhere to be, `target` says where it goes.
//
// ⚠️ ONLY WHEN THE FOCUS IS HOMELESS: the holiday can also end because the day changed or another phone ended it, and then somebody
// typing in a field must keep the focus they have.
export function useFocusOnBack(target: () => HTMLElement | null): void {
  const away = useAway().away;
  const was = useRef(away);
  const where = useRef(target);
  where.current = target;

  useEffect(() => {
    const ended = was.current && !away;
    was.current = away;
    if (!ended) return;
    const active = document.activeElement;
    if (active === null || active === document.body || active === document.documentElement) where.current()?.focus();
  }, [away]);
}
