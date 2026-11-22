import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { fakeFoodcostSource } from '../testing/fakeFoodcostSource';
import { REFERENCE, SPONGE, cakeDoc, renderCakes, storedReference } from '../testing/renderCakes';
import { FLOUR, FLOUR_PRICES, LOAD, product } from '../testing/renderFoodcost';

// A part's callout on the 3D view says «grams · cost»: for a card with NO cost (a recipe still empty, 0 kg) it says «cost incomplete», never a
// money figure. The 3D view needs WebGL, so Cake3D is a stand-in that writes the callout of the base; the real one is driven in a browser.
vi.mock('./Cake3D', () => ({
  default: (props: { labels: { callout: (tier: number, part: string) => string } }) => (
    <p data-testid="callout">{props.labels.callout(0, 'base')}</p>
  ),
}));

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

// What a new recipe's card is: one line of the recipe, with 0 kg of it (the recipe has no ingredients yet).
const EMPTY = product('recipe-r9', {
  name: 'Tiramisu', kind: 'semi', model: 4, sellingMode: null, sellingPrice: null, vatRate: null, piecesPerBatch: null,
  components: [{ recipeId: 'r9', qtyKg: 0 }],
});

async function openWith(card: ReturnType<typeof product>) {
  const cake = cakeDoc('c1', 'Plain', { diameterCm: 22, ref: REFERENCE, lines: [{ tier: 0, part: 'base', productId: card.id, grams: 400 }] });
  renderCakes('/cakes/c1', {
    cakes: fakeCakesSource({ cakes: [cake], reference: storedReference() }),
    foodcost: fakeFoodcostSource({ products: [SPONGE, card], recipes: [{ id: 'r9', name: 'Tiramisu', ingredients: [] }], ingredients: [FLOUR], prices: FLOUR_PRICES }),
  });
  await screen.findByRole('heading', { level: 2, name: 'Plain' }, LOAD);
  return screen.findByTestId('callout');
}

describe('the 3D callout of a part', () => {
  it('says «cost incomplete» for a card with no cost', async () => {
    expect(await openWith(EMPTY)).toHaveTextContent('400 g · cost incomplete');
  });

  it('keeps the money figure for a priced card', async () => {
    expect(await openWith(SPONGE)).toHaveTextContent(/^400 g · £0\.80$/);
  });
});
