import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { editorSource, recipe } from '../testing/foodcostEditorFixtures';
import { bareProduct, EMPLOYEE, LOAD, MANAGER, product, renderFoodcost, split } from '../testing/renderFoodcost';

// A product opens to READ; the pencil turns it into the form; Save returns to read (current app 18679a38, d491c7ca, f8770132, 08d00ba9;
// tests/foodcost-read-mode.test.mjs and tests/foodcost-read-sections.test.mjs, item 25 of docs/mise2-port-owed.md). What the SCREEN does:
// which view opens, how the two switch, what the read view says and what it never is (a control), and that it follows the stored product.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const ITALY = { lang: 'it', session: { language: 'it', location: { country: 'IT' } } } as const;

const pencil = () => screen.getByRole('button', { name: 'Edit product' });
const saveBar = () => screen.getByRole('button', { name: 'Save' });
const nameBox = () => screen.getByRole('combobox', { name: 'Name' });
const fullCard = () => document.querySelector('details[class*="full"]') as HTMLDetailsElement;
const cardTitles = () => screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent);
const cardNamed = (name: string) => screen.getByRole('region', { name });
const rowOf = (scope: HTMLElement, label: string): HTMLElement =>
  within(scope).getByText(label, { selector: 'dt' }).parentElement as HTMLElement;

async function read(id = 'Green', fake = editorSource([product('Green')]), options = {}) {
  const view = renderFoodcost(`/food-cost/product/${id}`, { source: fake, ...options });
  await screen.findByRole('button', { name: /^(Edit product|Modifica il prodotto)$/ }, LOAD);
  return { ...view, fake };
}

async function confirmSave(user: Awaited<ReturnType<typeof read>>['user']) {
  const asked = await screen.findByRole('alertdialog', undefined, LOAD);
  await user.click(within(asked).getByRole('button', { name: 'Save' }));
}

const SECTIONS = ['Product', 'Made of', 'Baking', 'Packaging', 'Work time', 'Price', 'Calculated costs'];

describe('which view a product opens in', () => {
  it('a product with something costed opens to READ: the summary, a closed «Full card», the pencil', async () => {
    await read();
    expect(screen.getByRole('heading', { level: 2, name: 'Green' })).toBeInTheDocument();
    expect(pencil()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Summary per piece' })).toBeInTheDocument();
    expect(fullCard().open).toBe(false);
    expect(within(fullCard()).getByText('Full card')).toBeInTheDocument();
  });

  it('a NEW product opens straight in the form (nothing to read), without a Full-card chevron or a pencil', async () => {
    renderFoodcost('/food-cost/new', { source: editorSource([]) });
    await screen.findByRole('combobox', { name: 'Name' }, LOAD);
    expect(screen.queryByRole('button', { name: 'Edit product' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(document.querySelector('details[class*="full"]')).toBeNull();
    expect(screen.getByText('Full card')).toBeInTheDocument();
  });

  it('a product with nothing costed opens straight in the form too, and Save brings it to READ with the box open', async () => {
    const { user, source: fake } = renderFoodcost('/food-cost/product/Bare', { source: editorSource([bareProduct('Bare')]) });
    await screen.findByRole('combobox', { name: 'Name' }, LOAD);
    expect(screen.queryByRole('button', { name: 'Edit product' })).not.toBeInTheDocument();
    await user.type(nameBox(), '!');
    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    expect(screen.getByRole('heading', { level: 2, name: 'Bare!' })).toBeInTheDocument();
    // No summary above it (nothing costed), so the box is the only thing to see: open.
    expect(screen.queryByRole('group', { name: /^Summary/ })).not.toBeInTheDocument();
    expect(fullCard().open).toBe(true);
    expect(fake.saved).toHaveLength(1);
  });
});

describe('the pencil and the way back', () => {
  it('turns the same product into the form on a copy, and puts the focus on its title', async () => {
    const { user } = await read();
    await user.click(pencil());
    expect(await screen.findByRole('combobox', { name: 'Name' })).toHaveValue('Green');
    expect(screen.queryByRole('button', { name: 'Edit product' })).not.toBeInTheDocument();
    expect(saveBar()).toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole('heading', { level: 2, name: 'Green' })).toHaveFocus(); }, LOAD);
  });

  it('Back from a form opened by the pencil returns to the read view, the focus on its title; the next Back leaves', async () => {
    const { router, user } = await read();
    await user.click(pencil());
    await screen.findByRole('combobox', { name: 'Name' });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('button', { name: 'Edit product' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/food-cost/product/Green');
    await waitFor(() => { expect(screen.getByRole('heading', { level: 2, name: 'Green' })).toHaveFocus(); }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/food-cost');
  });

  it('typed edits are asked about before the form goes back to read — and nothing typed ever reaches the read view', async () => {
    const { user, fake } = await read();
    await user.click(pencil());
    await user.type(await screen.findByRole('combobox', { name: 'Name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    const asked = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(within(asked).getByText('Discard changes?')).toBeInTheDocument();
    await user.click(within(asked).getByRole('button', { name: 'Cancel' }));
    expect(nameBox()).toHaveValue('Green!');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Discard' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Green' })).toBeInTheDocument();
    expect(fake.saved).toEqual([]);
  });

  it('Save, after its question, returns to the read view of the SAVED product, with the focus on its title', async () => {
    const { router, user, fake } = await read();
    await user.click(pencil());
    await user.type(await screen.findByRole('combobox', { name: 'Name' }), '!');
    await user.click(saveBar());
    await confirmSave(user);
    expect(await screen.findByText('Product saved.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Edit product' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Green!' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/food-cost/product/Green');
    expect(fake.saved[0]).toMatchObject({ kind: 'product', id: 'Green', data: { name: 'Green!' } });
    await waitFor(() => { expect(screen.getByRole('heading', { level: 2, name: 'Green!' })).toHaveFocus(); }, LOAD);
  });

  it('a Save the person says no to stays in the form with everything typed', async () => {
    const { user, fake } = await read();
    await user.click(pencil());
    await user.type(await screen.findByRole('combobox', { name: 'Name' }), '!');
    await user.click(saveBar());
    await user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Cancel' }));
    expect(nameBox()).toHaveValue('Green!');
    expect(fake.saved).toEqual([]);
  });

  it('works again after a round trip: pencil, Save, pencil, a form copied from what was saved', async () => {
    const { user } = await read();
    await user.click(pencil());
    await user.type(await screen.findByRole('combobox', { name: 'Name' }), '!');
    await user.click(saveBar());
    await confirmSave(user);
    await user.click(await screen.findByRole('button', { name: 'Edit product' }));
    expect(await screen.findByRole('combobox', { name: 'Name' })).toHaveValue('Green!');
  });

  it('a NEW product saved lands on the read view of its own address; Back from there goes to the list, not to an empty form', async () => {
    const { router, user } = renderFoodcost('/food-cost/new', { source: editorSource([]) });
    await user.type(await screen.findByRole('combobox', { name: 'Name' }, LOAD), 'Cornetto');
    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    expect(router.state.location.pathname).toBe('/food-cost/product/fake-1');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/food-cost');
  });
});

describe('the Full card', () => {
  it('holds the seven sections in the order they are filled in, results last, in the read view and in the form', async () => {
    const { user } = await read();
    expect(cardTitles()).toEqual(SECTIONS);
    await user.click(pencil());
    await screen.findByRole('combobox', { name: 'Name' });
    expect(cardTitles()).toEqual(SECTIONS);
    // The form's inputs come in the order they are filled: name, how it is sold, then the VAT before the target before the price.
    const order = [nameBox(), screen.getByRole('combobox', { name: 'Sold' }), screen.getByRole('combobox', { name: 'VAT rate' }),
      screen.getByRole('textbox', { name: 'Food cost target (%)' }), screen.getByRole('textbox', { name: 'Selling price, including VAT (£)' })];
    order.reduce((before, next) => {
      expect(before.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      return next;
    });
  });

  it('is a native details in the read view: it opens from its summary, by keyboard too', async () => {
    const { user } = await read();
    expect(fullCard().open).toBe(false);
    await user.click(within(fullCard()).getByText('Full card'));
    expect(fullCard().open).toBe(true);
    await user.click(within(fullCard()).getByText('Full card'));
    expect(fullCard().open).toBe(false);
  });

  it('keeps itself open while the stored product changes under it', async () => {
    const { user, fake } = await read();
    await user.click(within(fullCard()).getByText('Full card'));
    fake.products.set('Green', product('Green', { sellingPrice: 2.4 }));
    await act(async () => { fake.push(); });
    await waitFor(() => { expect(rowOf(cardNamed('Price'), 'Selling price, including VAT (£)')).toHaveTextContent('£2.40'); }, LOAD);
    expect(fullCard().open).toBe(true);
  });

  it('is never collapsible in the form (a field Save checks can never sit hidden): a label, no details', async () => {
    const { user } = await read();
    await user.click(pencil());
    await screen.findByRole('combobox', { name: 'Name' });
    expect(document.querySelector('details[class*="full"]')).toBeNull();
    expect(screen.getByText('Full card')).toBeInTheDocument();
  });
});

describe('the read view is text, not a form', () => {
  it('has no box to type in, no menu and no switch — only buttons', async () => {
    const lines = product('Rich', { components: [{ kind: 'ingredient', ingredientId: 'flour', qty: 1000, unit: 'g' }, { recipeId: 'Dough', qtyKg: 0.5 }] });
    await read('Rich', editorSource([lines], { recipes: [recipe('Dough')] }));
    const card = screen.getByRole('region', { name: 'Rich' });
    for (const role of ['textbox', 'combobox', 'spinbutton', 'switch', 'checkbox', 'radio', 'slider']) {
      expect(within(card).queryAllByRole(role), role).toHaveLength(0);
    }
    expect(within(card).queryByRole('button', { name: 'Use this price' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: '+ Add recipe' })).not.toBeInTheDocument();
  });

  it('says every missing value «Not set» — never 0 or a zero price — and a VAT of 0 as a real answer', async () => {
    const fake = editorSource([
      product('Blank', { sellingPrice: null, vatRate: null, foodCostTarget: null, labourMinutes: null, labourPeople: null }),
      product('Zero', { sellingPrice: 0, vatRate: 0, foodCostTarget: 30 }),
    ]);
    const { user } = await read('Blank', fake);
    const price = cardNamed('Price');
    for (const label of ['VAT rate', 'Food cost target (%)', 'Selling price, including VAT (£)']) {
      expect(rowOf(price, label)).toHaveTextContent('Not set');
    }
    expect(rowOf(cardNamed('Work time'), 'Minutes of work for one batch')).toHaveTextContent('Not set');
    expect(rowOf(cardNamed('Work time'), 'People working on it')).toHaveTextContent('Not set');
    expect(price).not.toHaveTextContent('£0.00');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('button', { name: /^Zero/ }, LOAD));
    await user.click(await screen.findByRole('button', { name: 'Open the card' }, LOAD));
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    expect(rowOf(cardNamed('Price'), 'VAT rate')).toHaveTextContent('0.00%');
    expect(rowOf(cardNamed('Price'), 'Selling price, including VAT (£)')).toHaveTextContent('Not set');
  });

  it('writes the figures in two decimals in the venue’s layout: kilos, grams, pieces, percentages and money', async () => {
    const rich = product('Rich', {
      sellingMode: 'pack', packSize: 0.5, packUnit: 'kg', piecesPerBatch: null, vatRate: 22, foodCostTarget: 32.5, sellingPrice: 6.5,
      components: [{ kind: 'ingredient', ingredientId: 'flour', qty: 2.5, unit: 'kg' }, { recipeId: 'Dough', qtyKg: 0.0125 }, { recipeId: 'Dough', qtyKg: 1.25 }],
      packaging: [{ ingredientId: 'box', qtyPcs: 3 }],
      labourMinutes: 7.5, labourPeople: 2,
    });
    await read('Rich', editorSource([rich], { recipes: [recipe('Dough')] }), ITALY);
    expect(rowOf(cardNamed('Prodotto'), 'Venduto')).toHaveTextContent('A confezione');
    expect(rowOf(cardNamed('Prodotto'), 'Una confezione contiene')).toHaveTextContent('0,50 kg');
    const made = cardNamed('Composto da');
    expect(within(made).getAllByText('Flour')[0]!.parentElement).toHaveTextContent('2,50 kg');
    const doughs = within(made).getAllByText('Dough', { selector: 'dt' }).map(label => label.parentElement?.textContent);
    expect(doughs).toEqual([expect.stringContaining('12,50 g'), expect.stringContaining('1,25 kg')]);
    expect(rowOf(cardNamed('Imballaggio'), 'Box')).toHaveTextContent('3,00 pz');
    expect(rowOf(cardNamed('Tempo di lavoro'), 'Minuti di lavoro per un’infornata')).toHaveTextContent('7,5');
    expect(rowOf(cardNamed('Tempo di lavoro'), 'Persone al lavoro')).toHaveTextContent('2');
    expect(rowOf(cardNamed('Prezzo'), 'Aliquota IVA')).toHaveTextContent('22,00%');
    expect(rowOf(cardNamed('Prezzo'), 'Obiettivo di food cost (%)')).toHaveTextContent('32,50%');
    expect(rowOf(cardNamed('Prezzo'), 'Prezzo di vendita, IVA inclusa (€)')).toHaveTextContent('6,50 €');
  });

  it('English pieces read «3.00 pcs», and an empty packaging and an empty list say «Nothing yet»', async () => {
    const boxed = product('Boxed', { packaging: [{ ingredientId: 'box', qtyPcs: 3 }] });
    const { user } = await read('Boxed', editorSource([boxed, product('Plain')]));
    expect(rowOf(cardNamed('Packaging'), 'Box')).toHaveTextContent('3.00 pcs');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('button', { name: /^Plain/ }, LOAD));
    await user.click(await screen.findByRole('button', { name: 'Open the card' }, LOAD));
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    expect(cardNamed('Packaging')).toHaveTextContent('Nothing yet');
  });

  it('Italian: the words of the sections, the pencil, «Non inserito» and «Ancora niente»', async () => {
    const fake = editorSource([product('Plain', { sellingPrice: null })]);
    renderFoodcost('/food-cost/product/Plain', { source: fake, ...ITALY });
    expect(await screen.findByRole('button', { name: 'Modifica il prodotto' }, LOAD)).toBeInTheDocument();
    expect(cardTitles()).toEqual(['Prodotto', 'Composto da', 'Cottura', 'Imballaggio', 'Tempo di lavoro', 'Prezzo', 'Costi calcolati']);
    expect(within(fullCard()).getByText('Scheda completa')).toBeInTheDocument();
    expect(cardNamed('Prezzo')).toHaveTextContent('Non inserito');
    expect(cardNamed('Imballaggio')).toHaveTextContent('Ancora niente');
  });

  // Model 3: the loss belongs to the PRODUCT (rawGrams / cookedGrams), not to the recipes on it.
  it('shows a product’s cooking, red and warned, with no loss row, when the cooked weight is above the raw one', async () => {
    const loaf = product('Loaf', { components: [{ recipeId: 'Dough', qtyKg: 1 }], cookedGrams: 1200, model: 3 });
    await read('Loaf', editorSource([loaf], { recipes: [recipe('Dough')] }));
    const made = cardNamed('Baking');
    expect(rowOf(made, 'Raw dough')).toHaveTextContent('1000.00 g');
    expect(rowOf(made, 'Cooked dough')).toHaveTextContent('1200.00 g');
    expect(within(made).getByText('The cooked dough cannot weigh more than the raw dough.')).toBeInTheDocument();
    expect(within(made).queryByText('Oven loss', { selector: 'dt' })).not.toBeInTheDocument();
  });

  it('shows a sound weighing with its loss and no warning; a product with recipe lines and no cooked weight says «No oven loss.»', async () => {
    const sound = product('Sound', { components: [{ recipeId: 'Dough', qtyKg: 1 }], cookedGrams: 900, model: 3 });
    const plain = product('Plain loaf', { components: [{ recipeId: 'Dough', qtyKg: 1 }], model: 3 });
    const { user } = await read('Sound', editorSource([sound, plain], { recipes: [recipe('Dough')] }));
    expect(within(cardNamed('Baking')).queryByText(/cannot weigh more/)).not.toBeInTheDocument();
    expect(rowOf(cardNamed('Baking'), 'Raw dough')).toHaveTextContent('1000.00 g');
    expect(rowOf(cardNamed('Baking'), 'Cooked dough')).toHaveTextContent('900.00 g');
    expect(rowOf(cardNamed('Baking'), 'Oven loss')).toHaveTextContent('10.00%');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('button', { name: /^Plain loaf/ }, LOAD));
    await user.click(await screen.findByRole('button', { name: 'Open the card' }, LOAD));
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    expect(cardNamed('Baking')).toHaveTextContent('No oven loss.');
    expect(within(cardNamed('Baking')).queryByText('Raw dough')).not.toBeInTheDocument();
  });

  it('draws the notes the form draws under a line: a recipe nobody priced says «No price», never a cost', async () => {
    const ghost = recipe('Ghost', { ingredients: [{ kind: 'ingredient', refId: 'nothing', unit: 'g', grams: 500, label: 'Nothing' }] });
    const odd = product('Odd', { components: [{ kind: 'ingredient', ingredientId: 'flour', qty: 1000, unit: 'g' }, { recipeId: 'Ghost', qtyKg: 1 }] });
    await read('Odd', editorSource([odd], { recipes: [ghost] }));
    // The money line says it («— No price»); the note that said the same thing is gone.
    expect(cardNamed('Made of')).toHaveTextContent('— No price');
    expect(cardNamed('Made of')).not.toHaveTextContent('This recipe is not priced yet');
  });

  it('says where to set the hourly cost, to whoever can set it — and only to them', async () => {
    const worked = product('Worked', { labourMinutes: 30, labourPeople: 1 });
    await read('Worked', editorSource([worked]), { session: MANAGER });
    await waitFor(() => { expect(cardNamed('Work time')).toHaveTextContent('Set the hourly labour cost in Settings'); }, LOAD);
  });

  it('shows «Cost per 1 kg» once, in the Calculated costs card, closed, as in the form', async () => {
    await read();
    const results = cardNamed('Calculated costs');
    expect(within(results).getAllByText('Cost per 1 kg')).toHaveLength(1);
    expect(within(results).getByRole('group', { name: 'Production cost' })).toBeInTheDocument();
    expect(within(results).getByRole('group', { name: 'Food cost' })).toBeInTheDocument();
    expect(results.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.getAllByText('Cost per 1 kg')).toHaveLength(1);
  });

  it('keeps the suggested price in the Price card but with no «Use this price» — and says when it is already the selling price', async () => {
    // £0.20 a piece, VAT 20%, target 25%: the suggestion is £0.96; a selling price of £0.96 is "in use".
    const fake = editorSource([product('Green'), product('InUse', { sellingPrice: 0.96 })]);
    const { user } = await read('Green', fake);
    const box = within(cardNamed('Price')).getByRole('group', { name: 'Suggested price' });
    expect(box).toHaveTextContent('£0.96');
    expect(within(box).queryByRole('button', { name: 'Use this price' })).not.toBeInTheDocument();
    await user.click(pencil());
    await screen.findByRole('combobox', { name: 'Name' });
    expect(within(screen.getByRole('group', { name: 'Suggested price' })).getByRole('button', { name: 'Use this price' })).toBeInTheDocument();
  });
});

describe('the read view follows the stored product', () => {
  it('redraws in place when a price, a recipe or the product itself changes elsewhere — no copy, no question', async () => {
    const { fake } = await read();
    expect(rowOf(screen.getByRole('group', { name: 'Summary per piece' }), 'Cost')).toHaveTextContent('£0.20');
    fake.prices.set('flour', { priceUnit: 'kg', pricePerUnit: 4 });
    await act(async () => { fake.push(); });
    await waitFor(() => { expect(rowOf(screen.getByRole('group', { name: 'Summary per piece' }), 'Cost')).toHaveTextContent('£0.40'); }, LOAD);
    fake.products.set('Green', product('Green', { name: 'Green again' }));
    await act(async () => { fake.push(); });
    expect(await screen.findByRole('heading', { level: 2, name: 'Green again' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('a product deleted elsewhere closes it to the list, saying so — on a phone', async () => {
    const { router, fake } = await read();
    fake.products.delete('Green');
    await act(async () => { fake.push(); });
    expect(await screen.findByText('Product deleted.')).toBeInTheDocument();
    await waitFor(() => { expect(router.state.location.pathname).toBe('/food-cost'); }, LOAD);
  });

  it('…and beside the list, on the split', async () => {
    split();
    const { router, fake } = await read();
    fake.products.delete('Green');
    await act(async () => { fake.push(); });
    expect(await screen.findByText('Product deleted.')).toBeInTheDocument();
    await waitFor(() => { expect(router.state.location.pathname).toBe('/food-cost'); }, LOAD);
  });

  it('a form with typing keeps its copy when the product changes elsewhere (never replaced)', async () => {
    const { user, fake } = await read();
    await user.click(pencil());
    await user.type(await screen.findByRole('combobox', { name: 'Name' }), '!');
    fake.products.set('Green', product('Green', { name: 'Elsewhere' }));
    await act(async () => { fake.push(); });
    expect(nameBox()).toHaveValue('Green!');
  });
});

describe('beside the list, on the tablet', () => {
  it('a row opens the product to READ next to the list; the pencil edits it there; Save returns to read there', async () => {
    split();
    const fake = editorSource([product('Green'), product('Red', { sellingPrice: 0.5, vatRate: 0 })]);
    const { router, user } = renderFoodcost('/food-cost', { source: fake });
    await user.click(await screen.findByRole('button', { name: /^Green/ }, LOAD));
    expect(await screen.findByRole('button', { name: 'Edit product' }, LOAD)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/food-cost/product/Green');
    expect(screen.getByRole('button', { name: /^Red/ })).toBeInTheDocument();
    await user.click(pencil());
    await user.type(await screen.findByRole('combobox', { name: 'Name' }), '!');
    await user.click(saveBar());
    await confirmSave(user);
    expect(await screen.findByRole('button', { name: 'Edit product' }, LOAD)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/food-cost/product/Green');
    expect(screen.getByRole('button', { name: /^Green!/ })).toBeInTheDocument();
  });

  it('picking another product while the first is in READ simply shows the other one', async () => {
    split();
    const fake = editorSource([product('Green'), product('Red', { name: 'Red', sellingPrice: 0.5, vatRate: 0 })]);
    const { router, user } = renderFoodcost('/food-cost/product/Green', { source: fake });
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    await user.click(screen.getByRole('button', { name: /^Red/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Red' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/food-cost/product/Red');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('the margin history and Delete, from the read view and from the form', () => {
  it('the read view opens the history with no question (nothing is typed)', async () => {
    const { router, user } = await read();
    await user.click(screen.getByRole('button', { name: 'Margin history' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/food-cost/product/Green/history'); }, LOAD);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  // ⚠️ #484 (08d00ba9): on a phone the history replaced the product and dropped what had been typed in silence. Mise 2's router
  // blocker asks before ANY move to another address — the history's included — so the question already comes.
  it('⚠️ on a phone the form asks «Discard changes?» before the history replaces it; No keeps the typing', async () => {
    const { router, user } = await read();
    await user.click(pencil());
    await user.type(await screen.findByRole('combobox', { name: 'Name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Margin history' }));
    const asked = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(within(asked).getByText('Discard changes?')).toBeInTheDocument();
    await user.click(within(asked).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/food-cost/product/Green');
    expect(nameBox()).toHaveValue('Green!');
  });

  it('…and Discard goes on to the history, the typing dropped on purpose', async () => {
    const { router, user, fake } = await read();
    await user.click(pencil());
    await user.type(await screen.findByRole('combobox', { name: 'Name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Margin history' }));
    await user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/food-cost/product/Green/history'); }, LOAD);
    expect(fake.saved).toEqual([]);
  });

  it('Delete in the read view is confirmed, then said, then the list; a product is never deleted by a wrong tap', async () => {
    const { router, user, fake } = await read();
    await user.click(screen.getByRole('button', { name: 'Delete product' }));
    const asked = await screen.findByRole('alertdialog', undefined, LOAD);
    await user.click(within(asked).getByRole('button', { name: 'Cancel' }));
    expect(fake.saved).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Delete product' }));
    await user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Product deleted.')).toBeInTheDocument();
    expect(fake.saved).toEqual([{ kind: 'remove', id: 'Green' }]);
    expect(router.state.location.pathname).toBe('/food-cost');
  });

  it('an employee’s read view has the history but no Delete', async () => {
    await read('Green', editorSource([product('Green')]), { session: EMPLOYEE });
    expect(screen.getByRole('button', { name: 'Margin history' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete product' })).not.toBeInTheDocument();
  });
});
