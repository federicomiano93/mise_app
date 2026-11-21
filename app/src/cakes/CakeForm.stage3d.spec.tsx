import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { BOX, PACKAGING_PRICES } from '../testing/foodcostEditorFixtures';
import { REFERENCE, SPONGE, cakeDoc, renderCakes, storedReference } from '../testing/renderCakes';
import { FLOUR, FLOUR_PRICES, LOAD } from '../testing/renderFoodcost';
import { fakeFoodcostSource } from '../testing/fakeFoodcostSource';

// The editor and the 3D view: a tap on a part chooses it in the steps, and a second tap on the chosen part opens that part's
// step with the cursor in its search box. The 3D view needs WebGL, so Cake3D is a stand-in with one button per tap; the real one is driven in a browser.

type Pick = { tier: number; part: string };
vi.mock('./Cake3D', () => ({
  default: (props: { onSelect: (s: Pick) => void; onOpenPart?: (s: Pick) => void }) => (
    <div data-testid="three-d">
      <button type="button" onClick={() => { props.onSelect({ tier: 0, part: 'filling' }); }}>tap filling</button>
      <button type="button" onClick={() => { props.onOpenPart?.({ tier: 0, part: 'filling' }); }}>second tap on filling</button>
      <button type="button" onClick={() => { props.onOpenPart?.({ tier: 0, part: 'base' }); }}>second tap on base</button>
    </div>
  ),
}));

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

const CREAM = { ...SPONGE, id: 'CREAM', name: 'Cream' };
const foodcost = () => fakeFoodcostSource({ products: [SPONGE, CREAM], ingredients: [FLOUR, BOX], prices: { ...FLOUR_PRICES, ...PACKAGING_PRICES } });

const open = async (discs: number) => {
  const cake = cakeDoc('c1', 'Plain', { diameterCm: 22, discs, ref: REFERENCE, lines: [{ tier: 0, part: 'base', productId: 'SPONGE', grams: null }] });
  const view = renderCakes('/cakes/c1', { cakes: fakeCakesSource({ cakes: [cake], reference: storedReference() }), foodcost: foodcost() });
  await screen.findByRole('heading', { level: 2, name: 'Plain' }, LOAD);
  return view;
};

describe('the 3D view’s taps', () => {
  it('a tap on a part chooses it in the steps and opens nothing', async () => {
    const { user } = await open(3);
    await user.click(await screen.findByRole('button', { name: 'tap filling' }));
    const filling = screen.getByRole('button', { name: /^Filling/ });
    expect(filling.closest('li')).toHaveAttribute('data-selected', 'true');
    expect(filling).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('combobox', { name: 'Search a recipe for Filling' })).not.toBeInTheDocument();
  });

  it('a second tap on a part opens its step with the cursor in its search box, and a card picked there lands in that part', async () => {
    const { user } = await open(3);
    await user.click(await screen.findByRole('button', { name: 'second tap on filling' }));
    // The list opens with the cursor, and React Aria hides the rest of the page from a screen reader while it is open.
    expect(screen.getByRole('button', { name: /^Filling/, hidden: true })).toHaveAttribute('aria-expanded', 'true');
    const search = await screen.findByRole('combobox', { name: 'Search a recipe for Filling' });
    await waitFor(() => { expect(search).toHaveFocus(); });
    await user.click(await screen.findByRole('option', { name: /Cream/ }, LOAD));
    expect(await screen.findByRole('textbox', { name: 'Cream: grams' }, LOAD)).toBeInTheDocument();
  });

  it('the request is dropped once acted on: the same tap opens the step again after it was closed', async () => {
    const { user } = await open(3);
    await user.click(await screen.findByRole('button', { name: 'second tap on filling' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /^Filling/ }));
    expect(screen.getByRole('button', { name: /^Filling/ })).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'second tap on filling' }));
    expect(screen.getByRole('button', { name: /^Filling/, hidden: true })).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens one step at a time: the second tap on another part closes the first', async () => {
    const { user } = await open(3);
    await user.click(await screen.findByRole('button', { name: 'second tap on filling' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'second tap on base' }));
    expect(screen.getByRole('button', { name: /^Base/, hidden: true })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Filling/, hidden: true })).toHaveAttribute('aria-expanded', 'false');
    // The base already holds the sponge, which the search box lists as taken.
    expect(await screen.findByRole('option', { name: /Sponge/ }, LOAD)).toHaveAttribute('aria-disabled', 'true');
  });

  it('opens the step but no search box for a part with no layer to fill (filling with one disc)', async () => {
    const { user } = await open(1);
    await user.click(await screen.findByRole('button', { name: 'second tap on filling' }));
    expect(screen.getByRole('button', { name: /^Filling/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('No layer with a single disc')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Search a recipe for Filling' })).not.toBeInTheDocument();
  });
});
