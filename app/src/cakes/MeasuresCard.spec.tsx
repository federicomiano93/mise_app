import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { openMeasures } from '../testing/openMeasures';
import { REFERENCE, cakeDoc, renderCakes, storedReference } from '../testing/renderCakes';
import { LOAD } from '../testing/renderFoodcost';

// The Measures card of a cake: the fourth box (the height of one disc), the fold and the summary line it leaves, and how Save finds the
// name when the card is folded. The model's maths is in cakeEditorModel.spec.ts and shared/cake-model.spec.ts.

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const SACHER = cakeDoc('c1', 'Sacher', { diameterCm: 20, tiers: 2, discs: 1, ref: REFERENCE });

const open = async (path: string, options: Parameters<typeof renderCakes>[1] = {}, cake = SACHER) => {
  const view = renderCakes(path, { cakes: fakeCakesSource({ cakes: [cake], reference: storedReference() }), ...options });
  await screen.findByRole('heading', { level: 2, name: path === '/cakes/new' ? 'New cake' : String(cake.name) || 'Untitled cake' }, LOAD);
  return view;
};

const fold = () => within(screen.getByRole('heading', { level: 3, name: /^(Measures|Misure)/ })).getByRole('button');
const box = (name: string) => screen.getByRole('textbox', { name });

describe('the fold', () => {
  it('a NEW cake opens with the card open, a SAVED cake with it folded', async () => {
    await open('/cakes/new');
    expect(fold()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
  });

  it('a saved cake shows one line under the title, and no body', async () => {
    await open('/cakes/c1');
    expect(fold()).toHaveAttribute('aria-expanded', 'false');
    expect(fold()).toHaveTextContent('Sacher · 20 cm · 2 tiers · 1 disc · discs of 3 cm');
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Height of one disc in centimetres' })).not.toBeInTheDocument();
  });

  it('the button opens and folds the body, and names it by aria-controls', async () => {
    const { user } = await open('/cakes/c1');
    const controls = fold().getAttribute('aria-controls');
    await user.click(fold());
    expect(fold()).toHaveAttribute('aria-expanded', 'true');
    expect(box('Name')).toHaveValue('Sacher');
    expect(document.getElementById(controls ?? '')).toContainElement(box('Name'));
    // Open, the one line is gone: the boxes say it.
    expect(fold()).not.toHaveTextContent('discs of');
    await user.click(fold());
    expect(fold()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
  });

  it('an unnamed cake is «Untitled» in the line', async () => {
    await open('/cakes/c1', {}, { ...SACHER, name: '' });
    expect(fold()).toHaveTextContent('Untitled · 20 cm');
  });

  it('the line says the figures as the venue writes them, in Italian too', async () => {
    await open('/cakes/c1', { lang: 'it', session: { location: { country: 'IT' } } }, { ...SACHER, discHeightCm: 4.5 });
    expect(fold()).toHaveTextContent('Sacher · 20 cm · 2 piani · 1 disco · dischi da 4,5 cm');
  });

  it('Save with an empty name while the card is folded opens it, and the name box is marked and has the focus', async () => {
    const { user, foodcost } = await open('/cakes/c1', {}, { ...SACHER, name: '' });
    expect(fold()).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Save to the price list' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => { expect(box('Name')).toHaveFocus(); });
    expect(box('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(fold()).toHaveAttribute('aria-expanded', 'true');
    expect(foodcost.saved).toHaveLength(0);
  });
});

describe('the disc height box', () => {
  it('shows the reference’s height for a cake with none of its own', async () => {
    const { user } = await open('/cakes/c1', {}, { ...SACHER, ref: { ...REFERENCE, discHeightCm: 4 } });
    await openMeasures(user);
    expect(box('Height of one disc in centimetres')).toHaveValue('4');
  });

  it('shows the cake’s own height when it has one', async () => {
    const { user } = await open('/cakes/c1', {}, { ...SACHER, discHeightCm: 5.5 });
    await openMeasures(user);
    expect(box('Height of one disc in centimetres')).toHaveValue('5.5');
  });

  it('takes «4,5» when the person leaves the box, and shows it with the venue’s separator', async () => {
    const { user } = await open('/cakes/c1', { lang: 'it', session: { location: { country: 'IT' } } });
    await openMeasures(user);
    const height = box('Altezza di un disco in centimetri');
    expect(height).toHaveValue('3');
    expect(height).toHaveAttribute('inputmode', 'decimal');
    await user.clear(height);
    await user.type(height, '4,5');
    await user.tab();
    expect(height).toHaveValue('4,5');
    // The other three keep the whole-number keyboard.
    expect(box('Piani')).toHaveAttribute('inputmode', 'numeric');
  });

  it('a value past the bounds is clamped, and junk goes back to what the cake has', async () => {
    const { user } = await open('/cakes/c1');
    await openMeasures(user);
    const height = box('Height of one disc in centimetres');
    await user.clear(height);
    await user.type(height, '99');
    await user.tab();
    expect(height).toHaveValue('20');
    await user.clear(height);
    await user.type(height, 'abc');
    await user.tab();
    expect(height).toHaveValue('20');
  });

  it('the four boxes are in one grid, the name keeps its own row', async () => {
    const { user } = await open('/cakes/c1');
    await openMeasures(user);
    const grid = box('Name').closest('div[class*="grid"]') as HTMLElement;
    for (const name of ['Diameter in centimetres', 'Tiers', 'Discs', 'Height of one disc in centimetres']) expect(grid).toContainElement(box(name));
  });
});
