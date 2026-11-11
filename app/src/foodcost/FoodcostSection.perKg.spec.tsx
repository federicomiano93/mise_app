import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { editorSource, intoForm, recipe } from '../testing/foodcostEditorFixtures';
import { bareProduct, LOAD, product, renderFoodcost } from '../testing/renderFoodcost';

// The «Cost breakdown» section of the product editor (it was the «Cost per 1 kg» block until 11 Nov 2026) (current app f0735d88, 9af66dd5; tests/foodcost-per-kg-screen.test.mjs,
// item 22 of docs/mise2-port-owed.md): one kilo of the product line by line, the recipes opened, every figure through fc-number
// (two decimals, the venue's layout). The arithmetic is shared/src/per-kg-model.spec.ts; these pin what the SCREEN does with it.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const ITALY = { lang: 'it', session: { language: 'it', location: { country: 'IT' } } } as const;
const block = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>('section[aria-label="Cost breakdown"], section[aria-label="Dettaglio costi"]');
  if (!found) throw new Error('no «Cost breakdown» section');
  return found;
};
// Its one button, and whether it is open.
const toggle = (): HTMLElement => within(block()).getByRole('button', { hidden: true });
const isOpen = (): boolean => toggle().getAttribute('aria-expanded') === 'true';
const rowOf = (name: string) => within(block()).getByText(name).closest('li') as HTMLElement;

async function open(path: string, fake: ReturnType<typeof editorSource>, options = {}) {
  const view = renderFoodcost(path, { source: fake, ...options });
  await intoForm(view.user);
  return { ...view, fake };
}

const FLOUR_LINE = { kind: 'ingredient', ingredientId: 'flour', qty: 1000, unit: 'g' };
const SALT_LINE = { kind: 'ingredient', ingredientId: 'salt', qty: 20, unit: 'g' };

describe('the block', () => {
  it('is the last section before the foot, closed, a real button with aria-expanded and aria-controls', async () => {
    await open('/food-cost/product/Green', editorSource([product('Green')]));
    expect(isOpen()).toBe(false);
    expect(toggle()).toHaveAccessibleName('Cost breakdown');
    const body = document.getElementById(toggle().getAttribute('aria-controls') ?? '');
    expect(body).not.toBeNull();
    expect(body).not.toBeVisible();
    // After the price, and never inside «Made of».
    const price = screen.getByRole('region', { name: 'Price' });
    expect(price.compareDocumentPosition(block()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Made of' })).not.toContainElement(block());
    // …and there is no «Calculated costs» box any more.
    expect(screen.queryByRole('region', { name: 'Calculated costs' })).not.toBeInTheDocument();
  });

  it('opens from its button and lists each ingredient with its weight, its price per kilo and its cost', async () => {
    const { user } = await open('/food-cost/product/Green', editorSource([product('Green')]));
    await user.click(toggle());
    expect(isOpen()).toBe(true);
    const flour = rowOf('Flour');
    expect(flour).toHaveTextContent('£2.00');
    expect(flour).toHaveTextContent('1.00 kg · £2.00 / kg');
    const total = within(block()).getByText('Total for 1 kg').parentElement as HTMLElement;
    expect(total).toHaveTextContent('£2.00');
    expect(within(block()).queryByText(/not exact yet/)).not.toBeInTheDocument();
  });

  it('is hidden, not removed, while nothing is costed', async () => {
    await open('/food-cost/product/Bare', editorSource([bareProduct('Bare')]));
    expect(block().hidden).toBe(true);
    expect(block()).not.toBeVisible();
  });

  it('is hidden on a new product and comes back, still closed, once the first line is priced', async () => {
    const { user } = await open('/food-cost/new', editorSource([], { recipes: [recipe('Dough')] }));
    expect(block().hidden).toBe(true);
    await user.click(within(screen.getByRole('region', { name: 'Made of' })).getByRole('button', { name: '+ Add recipe' }));
    await user.click(within(await screen.findByRole('dialog', undefined, LOAD)).getByRole('button', { name: /Dough/ }));
    await user.type(within(screen.getByRole('region', { name: 'Made of' })).getByRole('textbox', { name: 'Quantity' }), '500');
    expect(block().hidden).toBe(false);
    expect(isOpen()).toBe(false);
  });

  it('says a row has no price and that the figure is not exact yet, without ever saying «more»', async () => {
    const { user } = await open('/food-cost/product/Salty', editorSource([product('Salty', { components: [FLOUR_LINE, SALT_LINE] })]));
    await user.click(toggle());
    const salt = rowOf('Salt');
    // Model 3: the batch weighs every line with a known weight, the unpriced salt too (1.02 kg), so 20 g of it is 19.61 g in a kilo
    // (the current app left an unpriced line's kilos out). Shown but not counted: no cost of its own.
    expect(salt).toHaveTextContent('19.61 g · no price, not counted');
    expect(salt).not.toHaveTextContent('£');
    const note = within(block()).getByText('Some lines are not counted: the cost of 1 kg is not exact yet.');
    expect(note).toBeInTheDocument();
    expect(note.textContent).not.toMatch(/more|di più/i);
  });

  it('follows the boxes while they are typed and keeps its open state through every repaint', async () => {
    const { user } = await open('/food-cost/product/Salty', editorSource([product('Salty', { components: [FLOUR_LINE, SALT_LINE] })]));
    const button = toggle();
    await user.click(button);
    const flourBox = within(screen.getByRole('region', { name: 'Made of' })).getAllByRole('textbox', { name: 'Quantity' })[0] as HTMLElement;
    await user.clear(flourBox);
    await user.type(flourBox, '500');
    // 20 g beside a 520 g batch (the salt's weight counts, model 3): 38.46 g in a kilo.
    expect(rowOf('Salt')).toHaveTextContent('38.46 g');
    expect(isOpen()).toBe(true);
    expect(toggle()).toBe(button);
  });

  it('counts pieces of packaging by the kilo', async () => {
    const sold = await open('/food-cost/product/Boxed', editorSource([product('Boxed', { packaging: [{ ingredientId: 'box', qtyPcs: 1 }] })]));
    await sold.user.click(toggle());
    // Ten pieces from a kilo: ten boxes at £0.25.
    expect(rowOf('Box')).toHaveTextContent('£2.50');
    expect(rowOf('Box')).toHaveTextContent('10.00 pcs · £0.25 / each');
    expect(within(block()).getByText('Total for 1 kg').parentElement).toHaveTextContent('£4.50');
  });

  it('says when packaging is left out for want of a way of selling', async () => {
    await open('/food-cost/product/Loose', editorSource([product('Loose', { sellingMode: null, piecesPerBatch: null, packaging: [{ ingredientId: 'box', qtyPcs: 1 }] })]));
    expect(within(block()).getByText('Packaging not counted: choose how it is sold.')).toBeInTheDocument();
    expect(within(block()).queryByText('Box')).not.toBeInTheDocument();
  });

  it('opens a recipe that loses weight in the oven and says why the weights pass a kilo', async () => {
    const fake = editorSource(
      [product('Loaf', { components: [{ recipeId: 'Dough', qtyKg: 1 }] })],
      { recipes: [recipe('Dough', { lossPct: 20 })] },
    );
    const { user } = await open('/food-cost/product/Loaf', fake);
    await user.click(toggle());
    // A kilo out of an oven that takes 20% takes 1.25 kg in: £2.50.
    expect(rowOf('Flour')).toHaveTextContent('1.25 kg · £2.00 / kg');
    expect(rowOf('Flour')).toHaveTextContent('£2.50');
    expect(within(block()).getByText('The ingredients weigh more than 1 kg: it is the weight lost in the oven.')).toBeInTheDocument();
  });
});

describe('a venue in Italy', () => {
  it('writes every figure with two decimals and the comma, and the reasons in Italian', async () => {
    const { user } = await open('/food-cost/product/Salty', editorSource([product('Salty', { components: [FLOUR_LINE, SALT_LINE] })]), ITALY);
    expect(toggle()).toHaveTextContent('Dettaglio costi');
    // Model 3: the unpriced salt's 20 g weigh in the batch (1,02 kg), so a kilo costs 1,96 €.
    expect(within(screen.getByRole('group', { name: /^Riepilogo/ })).getByText('1 kg costa (nessun calo)').closest('div')).toHaveTextContent('più di 1,96 €');
    await user.click(toggle());
    expect(rowOf('Flour')).toHaveTextContent('980,39 g · 2,00 € / kg');
    expect(rowOf('Salt')).toHaveTextContent('19,61 g · nessun prezzo, non conteggiato');
    expect(within(block()).getByText('Totale per 1 kg').parentElement).toHaveTextContent('1,96 €');
    expect(within(block()).getByText('Alcune righe non sono conteggiate: il costo di 1 kg non è ancora esatto.')).toBeInTheDocument();
  });

  it('writes a piece count and a price each in the venue layout', async () => {
    const { user } = await open('/food-cost/product/Boxed', editorSource([product('Boxed', { packaging: [{ ingredientId: 'box', qtyPcs: 1 }] })]), ITALY);
    await user.click(toggle());
    expect(rowOf('Box')).toHaveTextContent('10,00 pz · 0,25 € al pezzo');
  });
});
