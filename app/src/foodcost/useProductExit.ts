import { useCallback } from 'react';
import { FOODCOST_PATH, usingPath } from './foodcostPath';
import type { Origin } from './foodcostPath';
import { useBackToRecipe, useLeave } from './foodcostNav';
import { NEW_OPENER, productOpener, useHandBack } from './handBack';

// How a product's screen (the read view and the form alike) steps back up.
//
// `leave` goes to the list — the narrowed one when that is where the product was opened from — and is what Save, Delete and a
// product deleted elsewhere use. `goBack` is the Back button: it returns to the recipe instead, when the recipe opened this screen.
// Both say first which button opened the screen, so the focus is handed back to it once the list is on screen.
export function useProductExit(id: string | null, origin: Origin): { leave: () => void; goBack: () => void } {
  const handBack = useHandBack();
  const onLeaving = useCallback(() => {
    handBack.expect(id === null ? NEW_OPENER : productOpener(id));
  }, [handBack, id]);
  const leave = useLeave(origin.using === null ? FOODCOST_PATH : usingPath(origin.using), onLeaving, origin.using !== null);
  const backToRecipe = useBackToRecipe(origin.recipe);
  return { leave, goBack: origin.recipe === null ? leave : backToRecipe };
}
