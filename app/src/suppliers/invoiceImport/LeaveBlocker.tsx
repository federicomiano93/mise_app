import { useEffect, useRef } from 'react';
import { useBlocker } from 'react-router';
import type { BlockerFunction } from 'react-router';

// The router's blocker for the import screen: when a move away is blocked it asks «Leave the import?» and lets the move go on or
// puts it back. A component of its own, as in the supplier card and the ingredient card (a copy: a feature never imports from
// another feature's folder, and these two live in other folders).
//
// ⚠️ EVERY WAY OUT GOES THROUGH IT, not through the Back button: the browser's Back, the rail and the tab bar all navigate. The
// Back button asks for itself, before it navigates (its navigate(-1) is a POP, and the router's blocker fails silently on a POP to
// an entry it did not create).
export function LeaveBlocker({ shouldBlock, ask, asking }: {
  shouldBlock: BlockerFunction;
  ask: () => Promise<boolean>;
  asking: { current: boolean };
}) {
  const blocker = useBlocker(shouldBlock);
  const latestBlocker = useRef(blocker);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    latestBlocker.current = blocker;
    if (blocker.state !== 'blocked') {
      asking.current = false;
      return;
    }
    if (asking.current) return;
    asking.current = true;
    void (async () => {
      try {
        const leave = await ask();
        // The screen went away while the question was open: the router has dropped its blocker.
        if (!mounted.current) return;
        const current = latestBlocker.current;
        if (current.state !== 'blocked') return;
        if (leave) current.proceed();
        else current.reset();
      } catch (error) {
        // Inside a fire-and-forget task a rethrow would be an unhandled rejection: say it, and let the next move ask again.
        asking.current = false;
        console.error('The leave question failed:', error);
        // The move is let go of, not held: nothing was decided, so the person stays where they are.
        if (mounted.current && latestBlocker.current.state === 'blocked') latestBlocker.current.reset();
      }
    })();
  });
  return null;
}
