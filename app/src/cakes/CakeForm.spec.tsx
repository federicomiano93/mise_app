import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { REFERENCE, cakeDoc, renderCakes, storedReference } from '../testing/renderCakes';
import { EMPLOYEE, LOAD } from '../testing/renderFoodcost';

// One cake's editor: it opens a stored cake and a new one, saves the cake and its Food cost card in ONE write, asks before it saves,
// deletes and discards, and checks the name. The maths is in shared/src/cake-model.spec.ts and cakeEditorModel.spec.ts.

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const SACHER = cakeDoc('c1', 'Sacher', { diameterCm: 22, discs: 2, ref: REFERENCE });

// The keys the cakes rule lists (firestore.rules, match /cakes/{cakeId}), minus the stamp the data layer adds.
const RULE_KEYS = [
  'assemblyMinutes', 'categoryId', 'diameterCm', 'discs', 'foodCostTarget', 'lines', 'model', 'name', 'packaging', 'ref', 'sellingPrice',
  'slices', 'tiers', 'updatedAt', 'vatRate',
];

const open = async (path: string, options: Parameters<typeof renderCakes>[1] = {}) => {
  const view = renderCakes(path, { cakes: fakeCakesSource({ cakes: [SACHER], reference: storedReference() }), ...options });
  return view;
};

const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 2, name }, LOAD);

describe('a stored cake', () => {
  it('opens named, with the «On the price list» tag, its drawing, its parts, its measures and its cost', async () => {
    await open('/cakes/c1');
    expect(await heading('Sacher')).toBeInTheDocument();
    expect(screen.getByText('On the price list')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: /^Section drawing of the cake: 1 tier, 2 discs per tier/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /^Parts of the cake/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Measures' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Cost and price' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Sacher');
    // 1000 g of the sponge at £2.00 a kilo.
    expect(screen.getByRole('textbox', { name: 'Sponge: grams' })).toHaveValue('1000');
    expect(screen.getByText('adjusted by hand · the rule says 600 g')).toBeInTheDocument();
  });

  it('says «This cake no longer exists.» only once the server has answered', async () => {
    const cakes = fakeCakesSource({ cakes: [SACHER], reference: storedReference() });
    cakes.hold();
    await open('/cakes/nope', { cakes });
    expect((await screen.findAllByText('Loading…', undefined, LOAD)).length).toBeGreaterThan(0);
    expect(screen.queryByText('This cake no longer exists.')).not.toBeInTheDocument();
    cakes.release();
    expect(await heading('This cake no longer exists.')).toBeInTheDocument();
  });

  it('a name that is empty reads «Untitled cake»', async () => {
    await open('/cakes/c1', { cakes: fakeCakesSource({ cakes: [{ ...SACHER, name: '' }], reference: storedReference() }) });
    expect(await heading('Untitled cake')).toBeInTheDocument();
  });
});

describe('Save', () => {
  it('asks first, then writes the cake and its card in ONE call with exactly the keys the rules list', async () => {
    const { user, foodcost } = await open('/cakes/c1');
    await heading('Sacher');
    await user.click(screen.getByRole('button', { name: 'Save to the price list' }));
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText('Save to the price list?')).toBeInTheDocument();
    expect(within(question).getByText('The cake and its card in Food cost are saved together.')).toBeInTheDocument();
    expect(foodcost.saved).toHaveLength(0);
    await user.click(within(question).getByRole('button', { name: 'Save' }));

    await waitFor(() => { expect(foodcost.saved).toHaveLength(1); });
    const write = foodcost.saved[0];
    expect(write).toMatchObject({ kind: 'product', id: 'cake-c1', companion: { kind: 'cake', id: 'c1' } });
    const data = (write?.companion as { data: Record<string, unknown> }).data;
    expect(Object.keys(data).sort()).toEqual(RULE_KEYS);
    expect(data).toMatchObject({ name: 'Sacher', diameterCm: 22, tiers: 1, discs: 2, slices: 8, model: 1, ref: REFERENCE });
    expect(data.lines).toEqual([{ tier: 0, part: 'base', productId: 'SPONGE', grams: 1000 }]);
    // The product it travels with is the cake as one sold piece, made of the sponge.
    expect((write?.data as Record<string, unknown>).components).toEqual([{ kind: 'semi', productId: 'SPONGE', qtyKg: 1 }]);
    expect(await screen.findByText('Cake saved.', undefined, LOAD)).toBeInTheDocument();
    // It stays on the cake.
    expect(screen.getByRole('heading', { level: 2, name: 'Sacher' })).toBeInTheDocument();
  });

  it('cancelling the question writes nothing', async () => {
    const { user, foodcost } = await open('/cakes/c1');
    await heading('Sacher');
    await user.click(screen.getByRole('button', { name: 'Save to the price list' }));
    const question = await screen.findByRole('alertdialog');
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(foodcost.saved).toHaveLength(0);
  });

  it('a cake with no name is not saved: no question, the name box is marked and takes the focus', async () => {
    const { user, foodcost } = await open('/cakes/new');
    await heading('New cake');
    await user.click(screen.getByRole('button', { name: 'Save to the price list' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    const name = screen.getByRole('textbox', { name: 'Name' });
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(await screen.findByText('Please enter a cake name.')).toBeInTheDocument();
    expect(foodcost.saved).toHaveLength(0);
  });

  it('a new cake copies the venue’s reference grams, is saved under its own address and stays open, now «On the price list»', async () => {
    const { user, foodcost, router } = await open('/cakes/new');
    await heading('New cake');
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Torta di prova');
    await user.click(screen.getByRole('button', { name: 'Save to the price list' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(foodcost.saved).toHaveLength(1); });
    const write = foodcost.saved[0];
    const cakeId = (write?.companion as { id: string }).id;
    expect(write?.id).toBe(`cake-${cakeId}`);
    const data = (write?.companion as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ name: 'Torta di prova', tiers: 1, discs: 3, lines: [], ref: REFERENCE });
    await waitFor(() => { expect(router.state.location.pathname).toBe(`/cakes/${cakeId}`); });
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.getByRole('heading', { level: 2, name: 'New cake' })).toBeInTheDocument();
  });
});

describe('leaving', () => {
  it('with typing on it, Back asks «Discard changes?»; Cancel stays, Discard leaves', async () => {
    const { user, router } = await open('/cakes/c1');
    await heading('Sacher');
    await user.type(screen.getByRole('textbox', { name: 'Name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText('Discard changes?')).toBeInTheDocument();
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/cakes/c1');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Sacher!');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/cakes'); });
  });

  it('with nothing typed, Back just leaves', async () => {
    const { user, router } = await open('/cakes/c1');
    await heading('Sacher');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => { expect(router.state.location.pathname).toBe('/cakes'); });
  });

  it('a change that is undone is not a change', async () => {
    const { user, router } = await open('/cakes/c1');
    await heading('Sacher');
    await user.click(screen.getByRole('button', { name: 'One slice more' }));
    await user.click(screen.getByRole('button', { name: 'One slice fewer' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => { expect(router.state.location.pathname).toBe('/cakes'); });
  });
});

describe('Delete', () => {
  it('asks in red, then removes the cake and its card in one call and goes back to the list', async () => {
    const { user, foodcost, router } = await open('/cakes/c1');
    await heading('Sacher');
    await user.click(screen.getByRole('button', { name: 'Delete the cake' }));
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText('Delete the cake?')).toBeInTheDocument();
    expect(within(question).getByText('Its card in Food cost is deleted too, with its margin history.')).toBeInTheDocument();
    expect(foodcost.saved).toHaveLength(0);
    await user.click(within(question).getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(foodcost.saved).toHaveLength(1); });
    expect(foodcost.saved[0]).toMatchObject({ kind: 'remove', id: 'cake-c1', companion: { kind: 'cake', id: 'c1' } });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/cakes'); });
  });

  it('a new cake has no Delete', async () => {
    await open('/cakes/new');
    await heading('New cake');
    expect(screen.queryByRole('button', { name: 'Delete the cake' })).not.toBeInTheDocument();
  });

  it('an employee, who does not run the place, has no Delete', async () => {
    await open('/cakes/c1', { session: EMPLOYEE });
    await heading('Sacher');
    expect(screen.getByRole('button', { name: 'Save to the price list' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete the cake' })).not.toBeInTheDocument();
  });
});

describe('in Italian', () => {
  it('says the bar, the questions and the parts in Italian', async () => {
    const { user } = await open('/cakes/c1', { lang: 'it' });
    expect(await heading('Sacher')).toBeInTheDocument();
    expect(screen.getByText('A listino')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /^Parti della torta/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elimina la torta' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salva a listino' }));
    const question = await screen.findByRole('alertdialog');
    expect(within(question).getByText('Salvare a listino?')).toBeInTheDocument();
    expect(within(question).getByText('La torta e la sua scheda nel Food cost si salvano insieme.')).toBeInTheDocument();
  });
});
