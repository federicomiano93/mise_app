import { act } from '@testing-library/react';
import type { DataRouter } from 'react-router';

// Helpers for the specs of a recipe's link to Food cost (step 3d-7).

// The lines of a product made of one kilo of the recipe.
export const madeWith = (recipeId: string) => [{ recipeId, qtyKg: 1 }];

// How many history entries lie behind the current one. It goes Back until the location stops changing, so it LEAVES
// the router on the first entry: ask it last. A memory history cannot be read, only walked.
export async function entriesBehind(router: Pick<DataRouter, 'navigate' | 'state'>): Promise<number> {
  let behind = 0;
  for (;;) {
    const before = router.state.location.key;
    await act(async () => { await router.navigate(-1); });
    if (router.state.location.key === before || behind > 20) return behind;
    behind += 1;
  }
}
