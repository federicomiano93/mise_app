import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { LabelShows } from '@mise/shared/recipe-label-model';

// Which of the label's three views («Allergens», «Nutrition», «Both») somebody last chose, for as long as the
// Recipe catalogue is open and never stored: the current app keeps it in a variable of its page
// (`labelShows` in catalogue-main.js). It is a property of the job being done this morning, not of a recipe, so
// opening another recipe's label keeps it; leaving the section forgets it, like closing the page did.
//
// (The value is only a code, never a word — what the buttons SAY follows the interface, `label.shows.*`.)
type Value = readonly [LabelShows, (next: LabelShows) => void];

const DEFAULT: Value = ['both', () => undefined];
const LabelShowsContext = createContext<Value>(DEFAULT);

export function LabelShowsProvider({ children }: { children: ReactNode }) {
  const [shows, setShows] = useState<LabelShows>('both');
  const value = useMemo<Value>(() => [shows, setShows], [shows]);
  return <LabelShowsContext.Provider value={value}>{children}</LabelShowsContext.Provider>;
}

export function useLabelShows(): Value {
  return useContext(LabelShowsContext);
}
