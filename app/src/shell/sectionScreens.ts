import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import { ScreenLoadError } from '../errors/ScreenLoadError';
import type { SectionId } from './sections';

// A screen fetched on first use. A download that fails is marked as such (ScreenLoadError), so the
// boundary around it knows that «Reload» must reload the PAGE: React.lazy and the browser both
// remember the failure, and drawing the screen again would only rethrow it.
export function lazyScreen(load: () => Promise<{ default: ComponentType }>): LazyExoticComponent<ComponentType> {
  return lazy(() => load().catch((error: unknown) => { throw new ScreenLoadError(error); }));
}

// The sections that are built, each loaded only when somebody opens it (architecture rule 8: the
// first screen stays light). A section not listed here still shows the placeholder.
//
// ⚠️ A LISTED SECTION IS STILL BEHIND SectionRoute'S GATE: a section the venue did not buy, or
// keeps from this person, never renders its screen, so its code is never even fetched. A section
// listed here owns every address under its own path (routes.tsx gives it `<path>/*`) and works out
// what to show from the rest of the address itself.
export const SECTION_SCREENS: Readonly<Partial<Record<SectionId, LazyExoticComponent<ComponentType>>>> = {
  pastries: lazyScreen(() => import('../pastries/PastriesSection')),
  stocktake: lazyScreen(() => import('../stocktake/StocktakeSection')),
  foodcost: lazyScreen(() => import('../foodcost/FoodcostSection')),
};

export function hasScreen(sectionId: SectionId): boolean {
  return sectionId in SECTION_SCREENS;
}
