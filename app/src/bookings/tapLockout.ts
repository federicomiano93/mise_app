import { useRef } from 'react';

// A status button toggles (Collected ↔ open), so a second tap a moment after the first would put the booking straight back. After a
// status is written, further taps on the same button (a key: the booking's id and the status pressed) are ignored for this long.
// The button is not disabled: it must not flicker.
export const TAP_LOCKOUT_MS = 800;

export type TapLockout = {
  // True while the last write of this key is recent: the tap is to be ignored.
  readonly locked: (key: string) => boolean;
  // Call when the write is made: it starts the lockout.
  readonly lock: (key: string) => void;
};

export function useTapLockout(ms: number = TAP_LOCKOUT_MS): TapLockout {
  const last = useRef(new Map<string, number>());
  return {
    locked: key => {
      const before = last.current.get(key);
      return before !== undefined && Date.now() - before < ms;
    },
    lock: key => { last.current.set(key, Date.now()); },
  };
}
