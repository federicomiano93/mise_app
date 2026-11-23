import { createContext, useContext } from 'react';

// The level of the heading an open cake draws for itself. From 700px the open cake is a layer over the shell's top bar, and the page's h1
// («Cakes») sits in that covered, unreachable bar (shell/useCoverBar.ts): the cake's own title is then the ONE reachable h1 (CakesSection
// hands Page `ownHeading` for the same moment). On a phone, or with the list or the settings on screen, the page's h1 is reachable and the
// cake's title is the level below it.
export const CakeHeadingLevel = createContext<1 | 2>(2);

export function useCakeHeadingLevel(): 1 | 2 {
  return useContext(CakeHeadingLevel);
}
