import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { Cake } from '@mise/shared/cake-model';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { renderCakes, storedReference } from '../testing/renderCakes';
import { LOAD, split } from '../testing/renderFoodcost';
import { parkCake, resetParkedCakes } from './cakeParking';

// «Resume» on a set-aside cake: with a new cake already open beside the list (the same address, /cakes/new) it still opens the copy; a
// recipe card taken off while the cake was away does not come back as a line.

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); split(); });
afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); resetParkedCakes(); });

const cake = (name: string, lines: Cake['lines'] = []): Cake => ({
  id: 'k1', name, diameterCm: 20, tiers: 1, discs: 2, slices: 8, lines, packaging: [], assemblyMinutes: null,
  sellingPrice: null, vatRate: null, foodCostTarget: null, categoryId: null, ref: null, model: 1,
});

function park(name: string, lines: Cake['lines'] = []) {
  parkCake({
    uid: 'u1', locationId: 'bakery', key: 'k1', savedId: null, working: cake(name, lines), initial: cake('', []),
    texts: { price: '', target: '', vatSelect: '', vatOther: '' }, tier: 0, openStepKey: 'base', selected: null, fromScratch: true,
  });
}
const open = (path: string) => renderCakes(path, { cakes: fakeCakesSource({ cakes: [], reference: storedReference() }) });
const nameBox = () => screen.getByRole('textbox', { name: 'Name' });

describe('«Resume» while a new cake is open', () => {
  it('opens the set-aside copy in place of the form (nothing dirty to ask about)', async () => {
    park('Parked one');
    const { user } = open('/cakes/new');
    await screen.findByRole('heading', { level: 2, name: 'New cake' }, LOAD);
    expect(nameBox()).toHaveValue('');
    await user.click(await screen.findByRole('button', { name: 'Resume “Parked one”' }));
    await waitFor(() => { expect(nameBox()).toHaveValue('Parked one'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('asks before throwing away what was typed in the open new cake', async () => {
    park('Parked one');
    const { user } = open('/cakes/new');
    await screen.findByRole('heading', { level: 2, name: 'New cake' }, LOAD);
    await user.type(nameBox(), 'Typed here');
    await user.click(await screen.findByRole('button', { name: 'Resume “Parked one”' }));
    const question = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(nameBox()).toHaveValue('Typed here');

    await user.click(screen.getByRole('button', { name: 'Resume “Parked one”' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Discard changes?' })).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(nameBox()).toHaveValue('Parked one'); });
  });
});

describe('a restored copy', () => {
  it('drops a line of a recipe card that is gone, and keeps the others', async () => {
    park('Parked one', [
      { tier: 0, part: 'base', productId: 'SPONGE', grams: 300 },
      { tier: 0, part: 'base', productId: 'recipe-gone', grams: 200 },
    ]);
    const { user } = open('/cakes');
    await user.click(await screen.findByRole('button', { name: 'Resume “Parked one”' }, LOAD));
    await screen.findByRole('textbox', { name: 'Sponge: grams' }, LOAD);
    expect(screen.getAllByRole('textbox', { name: /: grams$/ })).toHaveLength(1);
  });

  it('the line of a recipe- card that DOES exist stays', async () => {
    park('Parked one', [{ tier: 0, part: 'base', productId: 'SPONGE', grams: 300 }]);
    const { user } = open('/cakes');
    await user.click(await screen.findByRole('button', { name: 'Resume “Parked one”' }, LOAD));
    expect(await screen.findByRole('textbox', { name: 'Sponge: grams' }, LOAD)).toBeInTheDocument();
  });
});

describe('the line of a copy with no name yet', () => {
  it('says «Unsaved new cake», and its buttons still name it', async () => {
    park('   ');
    open('/cakes');
    const line = await screen.findByRole('group', { name: 'Unsaved new cake' }, LOAD);
    expect(within(line).getByRole('button', { name: 'Resume “new cake”' })).toBeInTheDocument();
    expect(within(line).getByRole('button', { name: 'Discard “new cake”' })).toBeInTheDocument();
  });
});
