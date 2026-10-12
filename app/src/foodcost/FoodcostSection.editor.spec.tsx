import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { costProduct } from '@mise/shared/foodcost-model';
import { editorSource } from '../testing/foodcostEditorFixtures';
import { bareProduct, EMPLOYEE, LOAD, MANAGER, product, renderFoodcost, split } from '../testing/renderFoodcost';

// The product editor: opening it, the answers at the top, saving, leaving, deleting. The chooser, the
// lines and the weighings are in FoodcostSection.editor.lines.spec.tsx; the VAT and the price in
// FoodcostSection.editor.vat.spec.tsx.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const saveBar = () => screen.getByRole('button', { name: 'Save' });
const question = () => screen.findByRole('alertdialog', undefined, LOAD);
const nameBox = () => screen.getByRole('combobox', { name: 'Product name' });
const priceBox = () => screen.getByRole('textbox', { name: 'Selling price including VAT' });
const productionCost = () => screen.queryByRole('group', { name: 'Production cost' });
const answer = () => screen.getByRole('group', { name: 'Food cost' });

async function confirmSave(user: UserEvent) {
  const asked = await question();
  expect(within(asked).getByText('Save product?')).toBeInTheDocument();
  await user.click(within(asked).getByRole('button', { name: 'Save' }));
}

async function openProduct(id = 'Green', fake = editorSource([product('Green')]), options = {}) {
  const view = renderFoodcost(`/food-cost/product/${id}`, { source: fake, ...options });
  await screen.findByRole('combobox', { name: 'Product name' }, LOAD);
  return { ...view, fake };
}

async function openNew(fake = editorSource([]), options = {}) {
  const view = renderFoodcost('/food-cost/new', { source: fake, ...options });
  await screen.findByRole('combobox', { name: 'Product name' }, LOAD);
  return { ...view, fake };
}

describe('a new product', () => {
  it('opens empty, with placeholders, and leaving it asks nothing', async () => {
    const { router, user } = await openNew();
    expect(nameBox()).toHaveValue('');
    expect(nameBox()).toHaveAttribute('placeholder', 'Product name');
    expect(screen.queryByRole('button', { name: 'Delete product' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Margin history' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/food-cost');
  });

  it('refuses a save with no name: highlighted, focused, said — and asks nothing', async () => {
    const { user } = await openNew();
    await user.click(saveBar());
    expect(await screen.findByText('Please enter a product name.')).toBeInTheDocument();
    expect(nameBox()).toHaveAttribute('aria-invalid', 'true');
    expect(nameBox()).toHaveFocus();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    // The highlight goes as soon as there is a name.
    await user.type(nameBox(), 'C');
    expect(nameBox()).not.toHaveAttribute('aria-invalid');
  });

  it('saves a named product after the question, says so and returns to the list', async () => {
    const actions: string[] = [];
    const listen = (event: Event) => { actions.push(String((event as CustomEvent).detail)); };
    window.addEventListener('mise:action', listen);
    try {
      const { router, user, fake } = await openNew();
      await user.type(nameBox(), '  Cornetto ');
      await user.click(saveBar());
      await confirmSave(user);

      expect(await screen.findByText('Product added.')).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/food-cost');
      expect(await screen.findByRole('button', { name: /^Cornetto/ }, LOAD)).toBeInTheDocument();
      expect(fake.saved).toHaveLength(1);
      expect(fake.saved[0]).toMatchObject({ kind: 'product', data: { name: 'Cornetto', model: 2 }, snapshot: null });
      expect(actions).toContain('foodcost-saved');
    } finally {
      window.removeEventListener('mise:action', listen);
    }
  });

  it('keeps everything when the question is answered no', async () => {
    const { router, user, fake } = await openNew();
    await user.type(nameBox(), 'Cornetto');
    await user.click(saveBar());
    await user.click(within(await question()).getByRole('button', { name: 'Cancel' }));
    expect(fake.saved).toEqual([]);
    expect(router.state.location.pathname).toBe('/food-cost/new');
    expect(nameBox()).toHaveValue('Cornetto');
  });
});

describe('the production cost', () => {
  it('is not drawn at all while nothing is priced, never «£0.00»', async () => {
    await openNew();
    expect(productionCost()).not.toBeInTheDocument();
    expect(screen.queryByText(/£0\.00/)).not.toBeInTheDocument();
  });

  it.each([
    ['per piece', {}, '£0.20per piece', 'Whole batch: £2.00'],
    ['per kg', { sellingMode: 'weight', piecesPerBatch: null }, '£2.00per kg', 'Whole batch: £2.00'],
    ['per pack', { sellingMode: 'pack', packSize: 500, packUnit: 'g', piecesPerBatch: null }, '£1.00per pack', 'Whole batch: £2.00'],
  ])('says it %s', async (_way, fields, value, batch) => {
    await openProduct('Green', editorSource([product('Green', fields)]));
    const box = productionCost();
    expect(box).toHaveTextContent(value);
    expect(box).toHaveTextContent(batch);
  });

  it('says the whole batch while the way of selling is not said', async () => {
    await openProduct('Green', editorSource([product('Green', { sellingMode: null, piecesPerBatch: null })]));
    expect(productionCost()).toHaveTextContent('£2.00whole batch');
  });

  it('says it is only part when a line has no price — the cost is then too low', async () => {
    const fake = editorSource([product('Green', { components: [
      { kind: 'ingredient', ingredientId: 'flour', qty: 1000, unit: 'g' },
      { kind: 'ingredient', ingredientId: 'salt', qty: 10, unit: 'g' },
    ] })]);
    await openProduct('Green', fake);
    expect(productionCost()).toHaveTextContent('Part of this product is not priced yet, so it really costs more than this.');
  });
});

describe('the food cost answer', () => {
  it('shows the percentage, the figures and the traffic light as a word', async () => {
    await openProduct();
    const box = answer();
    expect(box).toHaveTextContent('20%');
    expect(box).toHaveTextContent('£0.20 to make per piece · £1.00 net · £0.80 margin');
    expect(box).toHaveTextContent('On target');
    expect(box).toHaveAttribute('data-status', 'green');
  });

  it.each([
    ['slightly over target', 0.77, 'amber'],
    ['over target', 0.5, 'red'],
  ])('says %s', async (word, price, status) => {
    await openProduct('Green', editorSource([product('Green', { sellingPrice: price, vatRate: 0 })]));
    expect(answer()).toHaveAttribute('data-status', status);
    expect(answer()).toHaveTextContent(new RegExp(word, 'i'));
  });

  it('lists everything still missing, not just the first thing', async () => {
    await openNew();
    const box = answer();
    expect(box).toHaveTextContent('Not costed yet');
    const listed = within(box).getAllByRole('listitem').map(item => item.textContent);
    const expected = costProduct({ components: [], packaging: [] }, {}).blockers;
    expect(expected.length).toBeGreaterThan(2);
    expect(listed).toHaveLength(expected.length);
    expect(listed).toContain('Add at least one recipe or ingredient to this product');
    expect(listed).toContain('Choose the VAT rate');
    expect(listed).toContain('Enter the selling price');
  });

  it('follows what is typed, live', async () => {
    const { user } = await openProduct();
    await user.clear(priceBox());
    await user.type(priceBox(), '2,4');
    expect(answer()).toHaveTextContent('10%');
  });

  it('says a partly priced product is really higher than it looks', async () => {
    const fake = editorSource([product('Green', { components: [
      { kind: 'ingredient', ingredientId: 'flour', qty: 1000, unit: 'g' },
      { kind: 'ingredient', ingredientId: 'salt', qty: 10, unit: 'g' },
    ] })]);
    await openProduct('Green', fake);
    expect(answer()).toHaveTextContent('Part of this product is not priced yet, so the real food cost is higher than this.');
  });

  it('is in a live region that is on the page from the first render', async () => {
    await openNew();
    expect(answer().closest('[aria-live="polite"]')).not.toBeNull();
  });
});

describe('saving a product that exists', () => {
  it('writes a margin point in the same save when the price changes and there is an answer', async () => {
    const { user, fake } = await openProduct();
    await user.clear(priceBox());
    await user.type(priceBox(), '2.4');
    await user.click(saveBar());
    await confirmSave(user);

    expect(await screen.findByText('Product saved.')).toBeInTheDocument();
    expect(fake.saved[0]).toMatchObject({
      kind: 'product',
      id: 'Green',
      data: { sellingPrice: 2.4, model: 2 },
      snapshot: { foodCostPct: 10, sellingPrice: 2.4 },
    });
  });

  it('writes no margin point for a rename', async () => {
    const { user, fake } = await openProduct();
    await user.clear(nameBox());
    await user.type(nameBox(), 'Plain cornetto');
    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByText('Product saved.');
    expect(fake.saved[0]).toMatchObject({ kind: 'product', id: 'Green', data: { name: 'Plain cornetto' }, snapshot: null });
  });

  it('writes no margin point when there is no answer to record', async () => {
    const { user, fake } = await openProduct('Bare', editorSource([bareProduct('Bare')]));
    await user.type(priceBox(), '3');
    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByText('Product saved.');
    expect(fake.saved[0]).toMatchObject({ kind: 'product', id: 'Bare', data: { sellingPrice: 3 }, snapshot: null });
  });

  it('writes the lines without the ids that live only in the editor', async () => {
    const { user, fake } = await openProduct('Green', editorSource([product('Green', {
      packaging: [{ ingredientId: 'box', qtyPcs: 1 }],
    })]));
    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByText('Product saved.');
    const data = fake.saved[0]?.data as Record<string, unknown>;
    expect(data.components).toEqual([{ kind: 'ingredient', ingredientId: 'flour', qty: 1000, unit: 'g' }]);
    expect(data.packaging).toEqual([{ ingredientId: 'box', qtyPcs: 1 }]);
  });
});

describe('a number the database would refuse', () => {
  it('stops the save BEFORE the question, names the box and highlights it', async () => {
    const { user, fake } = await openProduct();
    const people = screen.getByRole('textbox', { name: 'People working on it' });
    await user.type(people, '0');
    await user.click(saveBar());

    expect(await screen.findByText(/^Check «People working on it»/)).toBeInTheDocument();
    expect(people).toHaveAttribute('aria-invalid', 'true');
    expect(people).toHaveFocus();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fake.saved).toEqual([]);

    await user.clear(people);
    await user.type(people, '2');
    expect(people).not.toHaveAttribute('aria-invalid');
  });

  it('refuses something that is not a number', async () => {
    const { user } = await openProduct();
    await user.type(screen.getByRole('textbox', { name: 'Minutes of work for one batch' }), 'ten');
    await user.click(saveBar());
    expect(await screen.findByText(/^Check «Minutes of work for one batch»/)).toBeInTheDocument();
  });

  it('clears, without asking, a value in a box that is not shown', async () => {
    const { user, fake } = await openProduct();
    // Pieces is shown for a product sold by the piece: type a number the rules refuse, then sell by
    // weight, which takes the box away.
    const pieces = screen.getByRole('textbox', { name: 'How many pieces come out of one batch' });
    await user.clear(pieces);
    await user.type(pieces, '0');
    await user.selectOptions(screen.getByRole('combobox', { name: 'How it is sold' }), 'weight');
    expect(screen.queryByRole('textbox', { name: 'How many pieces come out of one batch' })).not.toBeInTheDocument();

    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByText('Product saved.');
    expect(fake.saved[0]).toMatchObject({ data: { sellingMode: 'weight', piecesPerBatch: null } });
  });
});

describe('leaving with changes', () => {
  it('asks «Discard changes?» on Back, and keeps the typing when the answer is no', async () => {
    const { router, user } = await openProduct();
    await user.type(nameBox(), '!');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    const asked = await question();
    expect(within(asked).getByText('Discard changes?')).toBeInTheDocument();
    await user.click(within(asked).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/food-cost/product/Green');
    expect(nameBox()).toHaveValue('Green!');
  });

  it('leaves when the answer is yes', async () => {
    const { router, user } = await openProduct();
    await user.type(nameBox(), '!');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await question()).getByRole('button', { name: 'Discard' }));
    expect(router.state.location.pathname).toBe('/food-cost');
  });

  it('asks nothing for a product opened and left untouched', async () => {
    const { router, user } = await openProduct();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/food-cost');
  });

  it('asks on every other way out too — the browser\'s Back, a link, the rail', async () => {
    const { router, user } = await openProduct();
    await user.type(nameBox(), '!');
    act(() => { void router.navigate('/orders'); });
    const asked = await question();
    expect(within(asked).getByText('Discard changes?')).toBeInTheDocument();
    await user.click(within(asked).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/food-cost/product/Green');
  });

  it('asks nothing after a save', async () => {
    const { router, user } = await openProduct();
    await user.type(nameBox(), '!');
    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByText('Product saved.');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/food-cost');
  });
});

describe('on the tablet\'s split', () => {
  it('swaps the editor for another product, and asks first when there is typing', async () => {
    split();
    const fake = editorSource([product('Green', { name: 'Green' }), product('Red', { name: 'Red', sellingPrice: 0.5, vatRate: 0 })]);
    const { router, user } = renderFoodcost('/food-cost/product/Green', { source: fake });
    await screen.findByRole('combobox', { name: 'Product name' }, LOAD);
    expect(nameBox()).toHaveValue('Green');

    // Untouched: no question, the editor follows the address.
    await user.click(screen.getByRole('button', { name: /^Red/ }));
    await vi.waitFor(() => { expect(nameBox()).toHaveValue('Red'); });
    expect(router.state.location.pathname).toBe('/food-cost/product/Red');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    // With typing: the question first.
    await user.type(nameBox(), '!');
    await user.click(screen.getByRole('button', { name: /^Green/ }));
    const asked = await question();
    expect(within(asked).getByText('Discard changes?')).toBeInTheDocument();
    await user.click(within(asked).getByRole('button', { name: 'Cancel' }));
    expect(nameBox()).toHaveValue('Red!');

    await user.click(screen.getByRole('button', { name: /^Green/ }));
    await user.click(within(await question()).getByRole('button', { name: 'Discard' }));
    await vi.waitFor(() => { expect(nameBox()).toHaveValue('Green'); });
  });
});

describe('delete', () => {
  it('is for whoever runs the place only: confirmed, then said, then the list', async () => {
    const { router, user, fake } = await openProduct();
    await user.click(screen.getByRole('button', { name: 'Delete product' }));
    const asked = await question();
    expect(within(asked).getByText('Delete product?')).toBeInTheDocument();
    expect(within(asked).getByText(/^Delete “Green”\?/)).toBeInTheDocument();
    await user.click(within(asked).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Product deleted.')).toBeInTheDocument();
    expect(fake.saved).toEqual([{ kind: 'remove', id: 'Green' }]);
    expect(router.state.location.pathname).toBe('/food-cost');
  });

  it('keeps the product when the answer is no', async () => {
    const { user, fake } = await openProduct();
    await user.click(screen.getByRole('button', { name: 'Delete product' }));
    await user.click(within(await question()).getByRole('button', { name: 'Cancel' }));
    expect(fake.saved).toEqual([]);
    expect(nameBox()).toHaveValue('Green');
  });

  it('is offered to a manager', async () => {
    await openProduct('Green', editorSource([product('Green')]), { session: MANAGER });
    expect(screen.getByRole('button', { name: 'Delete product' })).toBeInTheDocument();
  });

  it('is not offered to an employee, who still edits and saves', async () => {
    const { user, fake } = await openProduct('Green', editorSource([product('Green')]), { session: EMPLOYEE });
    expect(screen.queryByRole('button', { name: 'Delete product' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Margin history' })).toBeInTheDocument();
    await user.type(nameBox(), '!');
    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByText('Product saved.');
    expect(fake.saved[0]).toMatchObject({ kind: 'product', data: { name: 'Green!' } });
  });
});

describe('a product changed or deleted elsewhere', () => {
  it('closes with «Product deleted.» when nobody has typed anything', async () => {
    const { router, fake } = await openProduct();
    fake.products.delete('Green');
    act(() => { fake.push(); });
    expect(await screen.findByText('Product deleted.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/food-cost');
  });

  it('is kept when there is typing on it', async () => {
    const { router, user, fake } = await openProduct();
    await user.type(nameBox(), '!');
    fake.products.delete('Green');
    act(() => { fake.push(); });
    await vi.waitFor(() => { expect(screen.queryByText('Product deleted.')).not.toBeInTheDocument(); });
    expect(router.state.location.pathname).toBe('/food-cost/product/Green');
    expect(nameBox()).toHaveValue('Green!');
  });

  it('never replaces the copy being typed on with the product as it changed elsewhere', async () => {
    const { user, fake } = await openProduct();
    await user.type(nameBox(), '!');
    fake.products.set('Green', { ...product('Green'), name: 'Renamed elsewhere', sellingPrice: 3 });
    act(() => { fake.push(); });
    expect(nameBox()).toHaveValue('Green!');
    expect(priceBox()).toHaveValue('1.2');
  });

  it('keeps asking the stored recipes: a recipe that arrives late stops being «no longer exists»', async () => {
    const fake = editorSource([product('Late', { components: [{ recipeId: 'dough', qtyKg: 1 }] })]);
    await openProduct('Late', fake);
    expect(screen.getByRole('button', { name: 'Change: This recipe no longer exists' })).toBeInTheDocument();
    fake.recipes.set('dough', { id: 'dough', name: 'Dough', ingredients: [], lossPct: 0 });
    act(() => { fake.push(); });
    expect(await screen.findByRole('button', { name: 'Change: Dough' })).toBeInTheDocument();
  });
});

describe('the work time', () => {
  const WORKED = product('Worked', { labourMinutes: 60, labourPeople: 1 });

  it('shows what the work costs to whoever runs the place, once the rate is known', async () => {
    await openProduct('Worked', editorSource([WORKED], { settings: { labourCostPerHour: 12 } }));
    const box = await screen.findByRole('group', { name: 'Production cost' });
    await vi.waitFor(() => { expect(box).toHaveTextContent('£0.20 ingredients and packaging · £1.20 labour'); });
    expect(box).toHaveTextContent('With labour: £1.40 per piece');
    expect(answer()).toHaveTextContent('Labour 120% · everything 140% of the net price');
    expect(screen.queryByText('Set the hourly labour cost in Settings to see what the work costs.')).not.toBeInTheDocument();
  });

  it('says where the rate is set when there are minutes and no rate — to whoever can set it', async () => {
    await openProduct('Worked', editorSource([WORKED], { settings: null }));
    expect(await screen.findByText('Set the hourly labour cost in Settings to see what the work costs.')).toBeInTheDocument();
    expect(productionCost()).not.toHaveTextContent('labour');
  });

  it('shows an employee the minutes and people but never any labour money, and never reads the rate', async () => {
    const fake = editorSource([WORKED], { settings: { labourCostPerHour: 12 } });
    await openProduct('Worked', fake, { session: EMPLOYEE });
    expect(screen.getByRole('textbox', { name: 'Minutes of work for one batch' })).toHaveValue('60');
    expect(screen.getByRole('textbox', { name: 'People working on it' })).toHaveValue('1');
    expect(productionCost()).not.toHaveTextContent(/labour/i);
    expect(answer()).not.toHaveTextContent(/labour/i);
    expect(screen.queryByText('Set the hourly labour cost in Settings to see what the work costs.')).not.toBeInTheDocument();
    expect(fake.watchSettings).not.toHaveBeenCalled();
  });
});

describe('the editor in Italian', () => {
  it('speaks Italian: the words, the question and the VAT menu of the country', async () => {
    const fake = editorSource([]);
    const { user } = renderFoodcost('/food-cost/new', {
      source: fake, lang: 'it', session: { language: 'it', location: { country: 'IT' } },
    });
    await screen.findByRole('combobox', { name: 'Nome del prodotto' }, LOAD);
    expect(screen.getByRole('heading', { level: 2, name: 'Nuovo prodotto' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Nome del prodotto' })).toHaveAttribute('placeholder', 'Nome del prodotto');
    expect(screen.getByRole('heading', { level: 3, name: 'Composto da' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '22% — ordinaria' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(await screen.findByText('Inserisci il nome del prodotto.')).toBeInTheDocument();

    await user.type(screen.getByRole('combobox', { name: 'Nome del prodotto' }), 'Cornetto');
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    const asked = await question();
    expect(within(asked).getByText('Vuoi salvare il prodotto?')).toBeInTheDocument();
    await user.click(within(asked).getByRole('button', { name: 'Salva' }));
    expect(await screen.findByText('Prodotto aggiunto.')).toBeInTheDocument();
    expect(fake.saved).toHaveLength(1);
  });
});

describe('the page', () => {
  it('has one h1, one main, and the product\'s name as its screen\'s title', async () => {
    await openProduct();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Green' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Green' })).toBeInTheDocument();
  });

  it('keeps the title the product has while its name is retyped', async () => {
    const { user } = await openProduct();
    await user.type(nameBox(), ' extra');
    expect(screen.getByRole('heading', { level: 2, name: 'Green' })).toBeInTheDocument();
  });
});
