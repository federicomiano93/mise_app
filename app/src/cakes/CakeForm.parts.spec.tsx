import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { BOX, PACKAGING_PRICES } from '../testing/foodcostEditorFixtures';
import { REFERENCE, SPONGE, cakeDoc, renderCakes, storedReference } from '../testing/renderCakes';
import { FLOUR, FLOUR_PRICES, LOAD, product } from '../testing/renderFoodcost';
import { fakeFoodcostSource } from '../testing/fakeFoodcostSource';
import type { StoredDoc } from '../foodcost/foodcostSource';

// The parts of a cake: the tiers, the cards in each part, the grams (the rule, or typed by hand), the packaging, and the bands about the
// reference grams. The measures and the cost are in CakeForm.cost.spec.tsx.

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const semi = (id: string, name: string, fields: Record<string, unknown> = {}) => ({ ...SPONGE, id, name, ...fields });
const CREAM = semi('CREAM', 'Cream');
const GANACHE = semi('GANACHE', 'Ganache');

const foodcost = (extra: StoredDoc[] = []) => fakeFoodcostSource({
  products: [SPONGE, CREAM, GANACHE, ...extra],
  ingredients: [FLOUR, BOX],
  prices: { ...FLOUR_PRICES, ...PACKAGING_PRICES },
});

// 22 cm, 3 discs, on the venue's reference (22 cm, 3 discs): the rule gives exactly the reference grams.
const PLAIN = cakeDoc('c1', 'Plain', { diameterCm: 22, discs: 3, ref: REFERENCE, lines: [{ tier: 0, part: 'base', productId: 'SPONGE', grams: null }] });

const open = async (path = '/cakes/c1', cake = PLAIN, options: Parameters<typeof renderCakes>[1] = {}) => {
  const view = renderCakes(path, { cakes: fakeCakesSource({ cakes: [cake], reference: storedReference() }), foodcost: foodcost(), ...options });
  await screen.findByRole('heading', { level: 2, name: String(cake.name) === '' ? 'Untitled cake' : String(cake.name) }, LOAD);
  return view;
};

describe('the cards in a part', () => {
  it('the grams box is empty and shows the rule’s figure while the rule decides; the line says «ready»', async () => {
    await open();
    const box = screen.getByRole('textbox', { name: 'Sponge: grams' });
    expect(box).toHaveValue('');
    expect(box).toHaveAttribute('placeholder', '900');
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.getByText('300 g per disc × 3 discs, scaled to Ø 22')).toBeInTheDocument();
  });

  it('typing grams is «adjusted by hand», with the rule’s figure beside it, and ↺ gives the rule back', async () => {
    const { user } = await open();
    const box = screen.getByRole('textbox', { name: 'Sponge: grams' });
    await user.type(box, '700');
    expect(box).toHaveValue('700');
    expect(screen.getByText('adjusted by hand · the rule says 900 g')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to the rule: Sponge' }));
    expect(box).toHaveValue('');
    expect(screen.queryByText(/adjusted by hand/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to the rule: Sponge' })).not.toBeInTheDocument();
  });

  it('adds a card from the chooser, which names the cards the part already holds and cannot pick them', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Base: add another card' }));
    const dialog = await screen.findByRole('dialog', undefined, LOAD);
    const sponge = within(dialog).getByRole('button', { name: /Sponge/ });
    expect(sponge).toBeDisabled();
    expect(within(dialog).getByText('already in this part')).toBeInTheDocument();
    expect(within(dialog).queryByText('already on this card')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /Cream/ }));
    // The new card's grams box takes the focus, and the rule is shared: 900 g between two cards.
    const box = await screen.findByRole('textbox', { name: 'Cream: grams' });
    expect(box).toHaveFocus();
    expect(box).toHaveAttribute('placeholder', '450');
    expect(screen.getByRole('textbox', { name: 'Sponge: grams' })).toHaveAttribute('placeholder', '450');
  });

  it('the same card may sit in another part', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Soak: add a card' }));
    const dialog = await screen.findByRole('dialog', undefined, LOAD);
    expect(within(dialog).getByRole('button', { name: /Sponge/ })).toBeEnabled();
  });

  it('never offers a whole cake, only semi-finished cards', async () => {
    const { user } = await open('/cakes/c1', PLAIN, { foodcost: foodcost([product('cake-other', { name: 'Another cake', kind: 'finished', model: 4 })]) });
    await user.click(screen.getByRole('button', { name: 'Soak: add a card' }));
    const dialog = await screen.findByRole('dialog', undefined, LOAD);
    expect(within(dialog).queryByText('Another cake')).not.toBeInTheDocument();
  });

  it('removes a card, and the part says so', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Remove Sponge' }));
    expect(screen.queryByRole('textbox', { name: 'Sponge: grams' })).not.toBeInTheDocument();
    expect(screen.getAllByText('No card').length).toBeGreaterThan(0);
    expect(screen.getByText('No soak')).toBeInTheDocument();
    expect(screen.getByText('No decoration')).toBeInTheDocument();
  });

  it('a part with six cards offers no «add» and says why', async () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F'].map(letter => semi(`S${letter}`, `Card ${letter}`));
    const six = cakeDoc('c1', 'Plain', {
      diameterCm: 22, discs: 3, ref: REFERENCE,
      lines: names.map(card => ({ tier: 0, part: 'filling', productId: card.id, grams: null })),
    });
    await open('/cakes/c1', six, { foodcost: foodcost(names) });
    expect(screen.queryByRole('button', { name: 'Filling: add a card' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Filling: add another card' })).not.toBeInTheDocument();
    expect(screen.getByText('A part holds 6 cards at most.')).toBeInTheDocument();
  });

  it('a filling with one disc says «No layer with a single disc» and offers no «add»', async () => {
    await open('/cakes/c1', cakeDoc('c1', 'Plain', { diameterCm: 22, discs: 1, ref: REFERENCE, lines: [] }));
    expect(screen.getByText('No layer with a single disc')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Filling: add a card' })).not.toBeInTheDocument();
  });

  it('a card that is not on the books is named as gone and counts 0 g until grams are typed', async () => {
    await open('/cakes/c1', cakeDoc('c1', 'Plain', { diameterCm: 22, discs: 3, ref: REFERENCE, lines: [{ tier: 0, part: 'base', productId: 'GHOST', grams: null }] }));
    expect(screen.getByText('This card no longer exists')).toBeInTheDocument();
  });
});

describe('the tiers', () => {
  const TWO = cakeDoc('c1', 'Two tiers', {
    diameterCm: 24, tiers: 2, discs: 3, ref: REFERENCE,
    lines: [{ tier: 0, part: 'base', productId: 'SPONGE', grams: null }, { tier: 1, part: 'base', productId: 'CREAM', grams: null }],
  });

  it('one tier has no tabs', async () => {
    await open('/cakes/c1', PLAIN);
    expect(screen.queryByRole('group', { name: 'Tier' })).not.toBeInTheDocument();
  });

  it('two tiers have «Bottom tier Ø 24» and «Top tier Ø 18», each with its own cards', async () => {
    const { user } = await open('/cakes/c1', TWO);
    const tabs = screen.getByRole('group', { name: 'Tier' });
    expect(within(tabs).getByRole('button', { name: 'Bottom tier Ø 24' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: 'Sponge: grams' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Cream: grams' })).not.toBeInTheDocument();
    await user.click(within(tabs).getByRole('button', { name: 'Top tier Ø 18' }));
    expect(screen.getByRole('textbox', { name: 'Cream: grams' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Sponge: grams' })).not.toBeInTheDocument();
  });

  it('three tiers name the middle one', async () => {
    await open('/cakes/c1', cakeDoc('c1', 'Three', { diameterCm: 26, tiers: 3, discs: 2, ref: REFERENCE, lines: [] }));
    expect(screen.getByRole('button', { name: 'Middle tier Ø 20' })).toBeInTheDocument();
  });

  it('choosing a part in the list marks it', async () => {
    const { user } = await open('/cakes/c1', TWO);
    const choose = screen.getByRole('button', { name: 'Base' });
    expect(choose).toHaveAttribute('aria-pressed', 'false');
    await user.click(choose);
    expect(choose).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('the focus is never dropped on the page', () => {
  const TWO = cakeDoc('c1', 'Plain', {
    diameterCm: 22, discs: 3, ref: REFERENCE,
    lines: [
      { tier: 0, part: 'base', productId: 'SPONGE', grams: 100 },
      { tier: 0, part: 'base', productId: 'CREAM', grams: 200 },
    ],
    packaging: [{ ingredientId: 'box', qtyPcs: 1 }],
  });

  it('removing a card hands the focus to the next row, or the one before, or the part’s «Add» button', async () => {
    const { user } = await open('/cakes/c1', TWO);
    await user.click(screen.getByRole('button', { name: 'Remove Sponge' }));
    expect(screen.getByRole('textbox', { name: 'Cream: grams' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Remove Cream' }));
    expect(screen.getByRole('button', { name: 'Base: add a card' })).toHaveFocus();
  });

  it('removing the last row of a part with others hands the focus to the row before', async () => {
    const { user } = await open('/cakes/c1', TWO);
    await user.click(screen.getByRole('button', { name: 'Remove Cream' }));
    expect(screen.getByRole('textbox', { name: 'Sponge: grams' })).toHaveFocus();
  });

  it('going back to the rule keeps the focus in the grams box of the same row', async () => {
    const { user } = await open('/cakes/c1', TWO);
    await user.click(screen.getByRole('button', { name: 'Back to the rule: Cream' }));
    expect(screen.getByRole('textbox', { name: 'Cream: grams' })).toHaveFocus();
  });

  it('removing the last piece of packaging hands the focus to «Add packaging»', async () => {
    const { user } = await open('/cakes/c1', TWO);
    await user.click(screen.getByRole('button', { name: 'Remove Box' }));
    expect(screen.getByRole('button', { name: 'Add packaging' })).toHaveFocus();
  });

  it('a stepper pressed up to its limit hands the focus to its other button', async () => {
    const { user } = await open('/cakes/c1', TWO);
    const more = screen.getByRole('button', { name: 'One disc more' });
    await user.click(more);
    await user.click(screen.getByRole('button', { name: 'One disc more' }));
    expect(screen.getByRole('button', { name: 'One disc more' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'One disc fewer' })).toHaveFocus();
  });
});

describe('the packaging', () => {
  it('adds a piece of packaging, counts it in pieces, and removes it', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Add packaging' }));
    const dialog = await screen.findByRole('dialog', undefined, LOAD);
    await user.click(within(dialog).getByRole('button', { name: /Box/ }));
    const box = await screen.findByRole('textbox', { name: 'Box: pieces' });
    expect(box).toHaveValue('1');
    await user.clear(box);
    await user.type(box, '3');
    expect(box).toHaveValue('3');
    await user.click(screen.getByRole('button', { name: 'Remove Box' }));
    expect(screen.queryByRole('textbox', { name: 'Box: pieces' })).not.toBeInTheDocument();
  });

  it('a packaging line with no pieces stops Save, names the box and takes the focus there', async () => {
    const withBox = cakeDoc('c1', 'Plain', { diameterCm: 22, discs: 3, ref: REFERENCE, packaging: [{ ingredientId: 'box', qtyPcs: 1 }] });
    const { user, foodcost: saved } = await open('/cakes/c1', withBox);
    const box = screen.getByRole('textbox', { name: 'Box: pieces' });
    await user.clear(box);
    await user.click(screen.getByRole('button', { name: 'Save to the price list' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(box).toHaveFocus();
    expect(await screen.findByText('Check the pieces of “Box”: they must be at least 1.')).toBeInTheDocument();
    expect(saved.saved).toHaveLength(0);
  });
});

describe('the reference grams', () => {
  it('a cake made with other grams offers to take the current ones, and the rule follows', async () => {
    const older = cakeDoc('c1', 'Plain', { diameterCm: 22, discs: 3, ref: { ...REFERENCE, baseG: 200 } });
    const { user } = await open('/cakes/c1', older);
    expect(screen.getByText('The reference grams have changed since this cake was made.')).toBeInTheDocument();
    expect(screen.getByText('200 g per disc × 3 discs, scaled to Ø 22')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Update this cake to the current reference grams' }));
    expect(screen.queryByText('The reference grams have changed since this cake was made.')).not.toBeInTheDocument();
    expect(screen.getByText('300 g per disc × 3 discs, scaled to Ø 22')).toBeInTheDocument();
    // …which is a change: leaving asks.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });

  it('with no reference grams anywhere, says every line needs its grams and links to the reference screen', async () => {
    const view = renderCakes('/cakes/c1', {
      cakes: fakeCakesSource({ cakes: [cakeDoc('c1', 'Plain', { ref: null })], reference: null }),
      foodcost: foodcost(),
    });
    await screen.findByRole('heading', { level: 2, name: 'Plain' }, LOAD);
    expect(screen.getByText('There are no reference grams yet, so every line needs its grams typed by hand.')).toBeInTheDocument();
    expect(screen.getAllByText('no reference grams yet: type the grams').length).toBeGreaterThan(0);
    const band = screen.getByText('There are no reference grams yet, so every line needs its grams typed by hand.').parentElement as HTMLElement;
    await view.user.click(within(band).getByRole('button', { name: 'Settings' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/cakes/reference'); });
  });

  it('a new cake with no reference grams anywhere starts with none', async () => {
    renderCakes('/cakes/new', { cakes: fakeCakesSource({ cakes: [], reference: null }), foodcost: foodcost() });
    await screen.findByRole('heading', { level: 2, name: 'New cake' }, LOAD);
    expect(screen.getByText('There are no reference grams yet, so every line needs its grams typed by hand.')).toBeInTheDocument();
  });
});
