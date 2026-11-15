import { createContext, useContext, useLayoutEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';

// The shell has ONE scroll area for every section (its `<main>`), and by default it puts it back
// at the top whenever the address changes — right between sections, wrong inside one whose list
// and detail are separate addresses (the Stocktake: a list, and a product opened from it).
//
// A section like that OWNS the scroll for the moves inside itself (`useOwnScrollArea`): the shell
// then resets it only when the section changes, and the section looks after every move within.
// The shell's half is `useScrollAreaState`; the section's half is the hook.

export interface ScrollArea {
  // The shell's scroll area; null before it is drawn, and outside the shell.
  element(): HTMLElement | null;
  // «The section on screen looks after its own scroll.» Returns the way to give it back.
  own(): () => void;
}

// Outside a shell (a spec that draws a section alone): there is no scroll area to look after.
const OUTSIDE: ScrollArea = {
  element: () => null,
  own: () => () => undefined,
};

export const ScrollAreaContext = createContext<ScrollArea>(OUTSIDE);

// For a section: takes the scroll over for as long as it is on screen, and gives back the area to
// read and move.
//
// ⚠️ OWNING IT MEANS HANDLING EVERY MOVE INSIDE THE SECTION. The shell stops resetting the scroll
// for those moves, so a screen the section opens must put the area where it wants it (usually the
// top) and one it comes back to must restore its place; forgetting a move leaves a new screen
// halfway down. A layout effect, so the claim is made before the shell's own effect decides.
export function useOwnScrollArea(): () => HTMLElement | null {
  const area = useContext(ScrollAreaContext);
  useLayoutEffect(() => area.own(), [area]);
  return area.element;
}

// For the shell: the object to put in the context, and whether any section owns the scroll now.
//
// A counter, not a flag: React's StrictMode (and a section that is replaced by another in one
// render) takes a claim before the previous one has been given back.
export function useScrollAreaState(element: RefObject<HTMLElement | null>): {
  area: ScrollArea;
  isOwned: () => boolean;
} {
  const claims = useRef(0);
  return useMemo(() => ({
    area: {
      element: () => element.current,
      own() {
        claims.current += 1;
        let given = false;
        return () => {
          if (given) return;
          given = true;
          claims.current -= 1;
        };
      },
    },
    isOwned: () => claims.current > 0,
  }), [element]);
}
