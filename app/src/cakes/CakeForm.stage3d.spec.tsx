import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { BOX, PACKAGING_PRICES } from '../testing/foodcostEditorFixtures';
import { REFERENCE, SPONGE, cakeDoc, renderCakes, storedReference } from '../testing/renderCakes';
import { FLOUR, FLOUR_PRICES, LOAD } from '../testing/renderFoodcost';
import { fakeFoodcostSource } from '../testing/fakeFoodcostSource';
import { forgetStageChoice } from './CakeStage';

// The editor and the 3D view: a tap on a part chooses it in the parts list, and a second tap on the chosen part opens that part's
// «Add a card» chooser. The 3D view needs WebGL, so Cake3D is a stand-in with one button per tap; the real one is driven in a browser.

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
beforeEach(() => { window.localStorage.clear(); forgetStageChoice(); });
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
  it('a second tap on a part opens its chooser, and a card picked there lands in that part', async () => {
    const { user } = await open(3);
    await user.click(await screen.findByRole('button', { name: 'tap filling' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'second tap on filling' }));
    const dialog = await screen.findByRole('dialog', undefined, LOAD);
    await user.click(within(dialog).getByRole('button', { name: /Cream/ }));
    expect(await screen.findByRole('textbox', { name: 'Cream: grams' }, LOAD)).toBeInTheDocument();
  });

  it('opens the same chooser the part’s «add another card» button opens, for a part that already has cards', async () => {
    const { user } = await open(3);
    await user.click(await screen.findByRole('button', { name: 'second tap on base' }));
    const dialog = await screen.findByRole('dialog', undefined, LOAD);
    expect(within(dialog).getByText('already in this part')).toBeInTheDocument();
  });

  it('opens nothing for a part the list offers no «Add» for (filling with one disc has no layer)', async () => {
    const { user } = await open(1);
    await user.click(await screen.findByRole('button', { name: 'second tap on filling' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
