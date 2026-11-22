import { createContext, useContext } from 'react';

// «A Page is already mounted above this»: true inside a Page's content. A boundary that guards a PART of a screen and was given a `title` (the
// Bookings card in its list) draws its failure notice with its own Page when it stands alone; inside a Page that would be a SECOND Page — two
// h1s, and from 700px two titles in the one slot of the top bar — so it draws the notice alone (errors/PartBoundary.tsx).
export const PageMountedContext = createContext(false);

export function usePageMounted(): boolean {
  return useContext(PageMountedContext);
}
