import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { SectionId } from './sections';

// The sections that are built, each loaded only when somebody opens it (architecture rule 8: the
// first screen stays light). A section not listed here still shows the placeholder.
//
// ⚠️ A LISTED SECTION IS STILL BEHIND SectionRoute'S GATE: a section the venue did not buy, or
// keeps from this person, never renders its screen, so its code is never even fetched. A section
// listed here owns every address under its own path (routes.tsx gives it `<path>/*`) and works out
// what to show from the rest of the address itself.
export const SECTION_SCREENS: Readonly<Partial<Record<SectionId, LazyExoticComponent<ComponentType>>>> = {
  pastries: lazy(() => import('../pastries/PastriesSection')),
};

export function hasScreen(sectionId: SectionId): boolean {
  return sectionId in SECTION_SCREENS;
}
