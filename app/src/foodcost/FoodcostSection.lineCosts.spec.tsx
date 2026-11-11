import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { editorSource, intoForm, PACKAGING_PRICES, recipe, unpricedRecipe } from '../testing/foodcostEditorFixtures';
import { FLOUR_PRICES, LOAD, product, renderFoodcost } from '../testing/renderFoodcost';

// The money under every «Made of» and packaging line, and the «Which?» list of what has no price (current app PR #485;
// tests/foodcost-line-costs.test.mjs, item 26 of docs/mise2-port-owed.md). The figures are shared/src/foodcost-line-costs.spec.ts and
// lineCost.spec.ts; these pin what the SCREENS do with them: both the form and the read view draw the money, «No price» replaces the
// note that said the same thing, «Which?» is closed until pressed, opens by click and by keyboard, and survives the card redrawing.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const ITALY = { lang: 'it', session: { language: 'it', location: { country: 'IT' } } } as const;
const PRICES = { ...FLOUR_PRICES, ...PACKAGING_PRICES, salt: { priceUnit: 'kg', pricePerUnit: 1.5 } };

const FLOUR_LINE = { kind: 'ingredient', ingredientId: 'flour', qty: 1000, unit: 'g' };
const SALT_LINE = { kind: 'ingredient', ingredientId: 'salt', qty: 20, unit: 'g' };
const cardNamed = (name: string) => screen.getByRole('region', { name });
const which = () => screen.getByRole('button', { name: 'Which?' });

describe('the form', () => {
  async function form(fake = editorSource([product('Green')]), id = 'Green', options = {}) {
    const view = renderFoodcost(`/food-cost/product/${id}`, { source: fake, ...options });
    await intoForm(view.user);
    return view;
  }

  it('draws the rate and the amount under a line, above its note, and follows the quantity typed', async () => {
    const { user } = await form();
    const madeOf = cardNamed('Made of');
    expect(within(madeOf).getByText('£2.00/kg · this amount £2.00')).toBeInTheDocument();
    const box = within(madeOf).getByRole('textbox', { name: 'Quantity' });
    await user.clear(box);
    await user.type(box, '500');
    expect(within(madeOf).getByText('£2.00/kg · this amount £1.00')).toBeInTheDocument();
    // The same box all along: the money never rebuilds the row.
    expect(within(madeOf).getByRole('textbox', { name: 'Quantity' })).toBe(box);
    expect(box).toHaveFocus();
  });

  it('follows the unit, and a recipe line shows its RAW rate per kilo (model 3)', async () => {
    const fake = editorSource([product('Mixed', { components: [{ recipeId: 'Dough', qtyKg: 2 }, FLOUR_LINE] })],
      { recipes: [recipe('Dough', { lossPct: 20 })] });
    const { user } = await form(fake, 'Mixed');
    const madeOf = cardNamed('Made of');
    // Model 3: this is a LEGACY product (model 2), so its 2 finished kg open as 2 ÷ 0.8 = 2.5 raw kg, at the raw £2.00 a kilo: £5.00
    // (the very cost the current app showed).
    expect(within(madeOf).getByText('£2.00/kg · this amount £5.00')).toBeInTheDocument();
    const units = within(madeOf).getAllByRole('combobox', { name: 'Unit' });
    await user.selectOptions(units[1] as HTMLElement, 'kg');
    expect(within(madeOf).getByText(/^£2\.00\/kg · this amount £2,?000\.00$/)).toBeInTheDocument();
  });

  it('⚠️ says «— No price», never 0, ONCE: the note that said the same thing is gone', async () => {
    const fake = editorSource([product('Gaps', { components: [{ recipeId: 'Ghost', qtyKg: 1 }, { kind: 'ingredient', ingredientId: 'salt', qty: 10, unit: 'g' }] })],
      { recipes: [unpricedRecipe('Ghost')] });
    await form(fake, 'Gaps');
    const madeOf = cardNamed('Made of');
    expect(within(madeOf).getAllByText('— No price')).toHaveLength(2);
    expect(madeOf).not.toHaveTextContent('£0.00');
    expect(madeOf).not.toHaveTextContent('not priced yet');
    expect(madeOf).not.toHaveTextContent('has no price yet');
  });

  it('a 2 g pinch of salt reads «< £0.01», never «£0.00»', async () => {
    await form(editorSource([product('Pinch', { components: [{ kind: 'ingredient', ingredientId: 'salt', qty: 2, unit: 'g' }] })], { prices: PRICES }), 'Pinch');
    expect(within(cardNamed('Made of')).getByText('£1.50/kg · this amount < £0.01')).toBeInTheDocument();
    expect(cardNamed('Made of')).not.toHaveTextContent('£0.00');
  });

  it('a recipe priced in part says «not exact yet»', async () => {
    const half = recipe('Half', { ingredients: [
      { kind: 'ingredient', refId: 'flour', unit: 'g', grams: 1000, label: 'Flour' },
      { kind: 'ingredient', refId: 'salt', unit: 'g', grams: 20, label: 'Salt' },
    ] });
    await form(editorSource([product('Halved', { components: [{ recipeId: 'Half', qtyKg: 1 }] })], { recipes: [half] }), 'Halved');
    expect(within(cardNamed('Made of')).getByText('£2.00/kg · this amount £2.00 · not exact yet')).toBeInTheDocument();
    expect(within(cardNamed('Made of')).getByText('Only part of this recipe has a price')).toBeInTheDocument();
  });

  it('packaging: the rate each and the amount; priced by weight keeps its rate and the note says what to do', async () => {
    await form(editorSource([product('Boxed', { packaging: [{ ingredientId: 'box', qtyPcs: 2 }, { ingredientId: 'ribbon', qtyPcs: 1 }, { ingredientId: 'tissue', qtyPcs: 1 }] })]), 'Boxed');
    const packaging = cardNamed('Packaging');
    expect(within(packaging).getByText('£0.25 each · this amount £0.50')).toBeInTheDocument();
    expect(within(packaging).getByText('£4.00/kg')).toBeInTheDocument();
    expect(within(packaging).getByText(/^Priced by weight/)).toBeInTheDocument();
    expect(within(packaging).getAllByText('— No price')).toHaveLength(1);
  });

  it('lines in Italian read «al pezzo» and «questa quantità»', async () => {
    await form(editorSource([product('Boxed', { packaging: [{ ingredientId: 'box', qtyPcs: 2 }] })]), 'Boxed', ITALY);
    expect(cardNamed('Imballaggio').textContent?.replace(/ /g, ' ')).toContain('0,25 € al pezzo · questa quantità 0,50 €');
  });
});

describe('the read view', () => {
  async function read(fake: ReturnType<typeof editorSource>, id: string, options = {}) {
    const view = renderFoodcost(`/food-cost/product/${id}`, { source: fake, ...options });
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    return view;
  }

  it('draws the same money line under each row, in its own element above the note, and still no control', async () => {
    const half = recipe('Half', { ingredients: [
      { kind: 'ingredient', refId: 'flour', unit: 'g', grams: 1000, label: 'Flour' },
      { kind: 'ingredient', refId: 'salt', unit: 'g', grams: 20, label: 'Salt' },
    ] });
    await read(editorSource([product('Mixed', { components: [FLOUR_LINE, { recipeId: 'Half', qtyKg: 1 }, { kind: 'ingredient', ingredientId: 'salt', qty: 5, unit: 'g' }],
      packaging: [{ ingredientId: 'box', qtyPcs: 2 }] })], { recipes: [half] }), 'Mixed');
    const madeOf = cardNamed('Made of');
    expect(within(madeOf).getByText('£2.00/kg · this amount £2.00 · not exact yet')).toBeInTheDocument();
    expect(within(madeOf).getByText('— No price')).toBeInTheDocument();
    expect(within(madeOf).getByText('£2.00/kg · this amount £2.00', { exact: true })).toBeInTheDocument();
    expect(within(cardNamed('Packaging')).getByText('£0.25 each · this amount £0.50')).toBeInTheDocument();
    // The money line comes BEFORE the note under the same row.
    const row = within(madeOf).getByText('Only part of this recipe has a price').parentElement as HTMLElement;
    const lines = Array.from(row.querySelectorAll('dd')).map(node => node.textContent);
    expect(lines.indexOf('£2.00/kg · this amount £2.00 · not exact yet')).toBeLessThan(lines.indexOf('Only part of this recipe has a price'));
    expect(madeOf.querySelector('input, select, textarea')).toBeNull();
  });

  it('a line that no longer exists shows no money, only its note', async () => {
    await read(editorSource([product('Gone', { components: [FLOUR_LINE, { kind: 'ingredient', ingredientId: 'ghost', qty: 5, unit: 'g' }] })]), 'Gone');
    const madeOf = cardNamed('Made of');
    expect(within(madeOf).getByText('This item no longer exists', { selector: 'dd' })).toBeInTheDocument();
    expect(within(madeOf).getAllByText(/\/kg/)).toHaveLength(1);
  });
});

describe('«Which?» on the card', () => {
  const salty = () => editorSource([product('Salty', { components: [FLOUR_LINE, SALT_LINE] })]);

  async function read(fake: ReturnType<typeof editorSource>, id: string, options = {}) {
    const view = renderFoodcost(`/food-cost/product/${id}`, { source: fake, ...options });
    await screen.findByRole('button', { name: /^(Edit product|Modifica il prodotto)$/ }, LOAD);
    return view;
  }

  it('is a button under the partial-price warning, closed by default, with aria-expanded and aria-controls', async () => {
    await read(salty(), 'Salty');
    const summary = screen.getByRole('group', { name: 'Summary per piece' });
    const warning = within(summary).getByText('Part of this product is not priced yet, so it really costs more than this.');
    expect(warning.nextElementSibling).toContainElement(which());
    expect(which()).toHaveAttribute('aria-expanded', 'false');
    const list = document.getElementById(which().getAttribute('aria-controls') as string) as HTMLElement;
    expect(list).not.toBeVisible();
    expect(which().closest('details')).toBeNull();
  });

  it('opens by click and shuts again, naming what has no price and why', async () => {
    const { user } = await read(salty(), 'Salty');
    await user.click(which());
    expect(which()).toHaveAttribute('aria-expanded', 'true');
    const list = document.getElementById(which().getAttribute('aria-controls') as string) as HTMLElement;
    expect(list).toBeVisible();
    expect(list).toHaveTextContent('Salt· no price');
    await user.click(which());
    expect(which()).toHaveAttribute('aria-expanded', 'false');
    expect(list).not.toBeVisible();
  });

  it('opens and shuts from the keyboard', async () => {
    const { user } = await read(salty(), 'Salty');
    which().focus();
    await user.keyboard('{Enter}');
    expect(which()).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(' ');
    expect(which()).toHaveAttribute('aria-expanded', 'false');
  });

  it('is not there when nothing is missing, and not without a way of selling it a button for nothing', async () => {
    await read(editorSource([product('Whole', { components: [FLOUR_LINE] })]), 'Whole');
    expect(screen.queryByRole('button', { name: 'Which?' })).not.toBeInTheDocument();
  });

  it('names the lines that no longer exist', async () => {
    const { user } = await read(editorSource([product('Gone', { components: [FLOUR_LINE, { kind: 'ingredient', ingredientId: 'ghost', qty: 5, unit: 'g' }] })]), 'Gone');
    await user.click(which());
    expect(document.getElementById(which().getAttribute('aria-controls') as string)).toHaveTextContent('This item no longer exists· remove the line or choose another');
  });

  it('names a row of a recipe with the recipe it is in, and a labelled row in spoons', async () => {
    const odd = recipe('Odd', { ingredients: [
      { kind: 'ingredient', refId: 'flour', unit: 'g', grams: 1000, label: 'Flour' },
      { kind: 'ingredient', refId: 'salt', unit: 'tsp', grams: 2, label: 'Salt' },
      { label: 'Water', unit: 'g', grams: 100 },
    ] });
    const { user } = await read(editorSource([product('Spoons', { components: [{ recipeId: 'Odd', qtyKg: 1 }] })], { recipes: [odd] }), 'Spoons');
    await user.click(which());
    const list = document.getElementById(which().getAttribute('aria-controls') as string) as HTMLElement;
    expect(list).toHaveTextContent('Salt· not weighed (pieces / spoons / to taste) · in “Odd”');
    expect(list).toHaveTextContent('Water· not linked to an ingredient · in “Odd”');
  });

  it('gives packaging with no way of selling chosen its advice: choose how it is sold', async () => {
    const noMode = await read(editorSource([product('Plain', { sellingMode: null, piecesPerBatch: null, packaging: [{ ingredientId: 'box', qtyPcs: 1 }] })]), 'Plain');
    await noMode.user.click(which());
    expect(document.getElementById(which().getAttribute('aria-controls') as string)).toHaveTextContent('Packaging· choose how it is sold to count it');
  });

  it('gives packaging with a way of selling not finished its advice: finish how it is sold', async () => {
    const unfinished = await read(editorSource([product('Pieces', { piecesPerBatch: null, packaging: [{ ingredientId: 'box', qtyPcs: 1 }] })]), 'Pieces');
    await unfinished.user.click(which());
    expect(document.getElementById(which().getAttribute('aria-controls') as string)).toHaveTextContent('Packaging· cannot be counted yet: finish how it is sold');
  });

  it('says it in Italian: «Quali?»', async () => {
    const { user } = await read(salty(), 'Salty', ITALY);
    const button = screen.getByRole('button', { name: 'Quali?' });
    await user.click(button);
    expect(document.getElementById(button.getAttribute('aria-controls') as string)).toHaveTextContent('Salt· senza prezzo');
  });
});

describe('«Which?» keeps its state while the card is redrawn', () => {
  it('stays open while a quantity is typed in the form', async () => {
    const view = renderFoodcost('/food-cost/product/Salty', { source: editorSource([product('Salty', { components: [FLOUR_LINE, SALT_LINE] })]) });
    await intoForm(view.user);
    await view.user.click(which());
    const box = within(cardNamed('Made of')).getAllByRole('textbox', { name: 'Quantity' })[0] as HTMLElement;
    await view.user.type(box, '5');
    expect(which()).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('«Which?» in the phone dialog', () => {
  it('is in the preview dialog too', async () => {
    const view = renderFoodcost('/food-cost', { source: editorSource([product('Salty', { components: [FLOUR_LINE, SALT_LINE] })]) });
    await screen.findAllByRole('listitem', undefined, LOAD);
    await view.user.click(screen.getByRole('button', { name: /^Salty/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Salty' }, LOAD);
    const button = within(dialog).getByRole('button', { name: 'Which?' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await view.user.click(button);
    expect(document.getElementById(button.getAttribute('aria-controls') as string)).toHaveTextContent('Salt· no price');
  });
});
