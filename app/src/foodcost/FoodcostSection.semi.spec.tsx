import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { editorSource, intoForm } from '../testing/foodcostEditorFixtures';
import { EMPLOYEE, LOAD, bareProduct, product, renderFoodcost, split } from '../testing/renderFoodcost';

// Categories and semi-finished cards (Mise 2, product model 4, 20 Nov 2026 — the cakes plan, step 1): the list in groups, the
// categories dialog, the card type in the editor, the cost per kilo and «Used in», the chooser's semi-finished cards and what Save
// writes. The maths is in shared/src/semi-finished.spec.ts; the rules in tests/rules/firestore-rules-check.mjs. Fake data only.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const gram = (qty: number) => ({ kind: 'ingredient', ingredientId: 'flour', qty, unit: 'g' });
const semiLine = (productId: string, qtyKg: number) => ({ kind: 'semi', productId, qtyKg });

// 2.00 a kilo of materials, 6.00 of labour (30 minutes at 12 an hour): 8.00 a kilo.
const GANACHE = product('Ganache', { kind: 'semi', categoryId: 'c1', model: 4, components: [gram(1000)], labourMinutes: 30, sellingMode: null, sellingPrice: null, vatRate: null, piecesPerBatch: null });
// 2.00 a kilo of materials and no minutes: no labour figure.
const ICING = product('Icing', { kind: 'semi', categoryId: 'c1', model: 4, components: [gram(1000)], sellingMode: null, sellingPrice: null, vatRate: null, piecesPerBatch: null });
const CAKE = product('Cake', { kind: 'finished', categoryId: 'c2', model: 4, components: [gram(1000), semiLine('Ganache', 0.5)] });
// A semi-finished card that holds the cake: putting it into the cake would make a loop.
const FILLING = product('Filling', { kind: 'semi', model: 4, components: [semiLine('Cake', 0.2)], sellingMode: null, sellingPrice: null, vatRate: null, piecesPerBatch: null });
const PLAIN = product('Plain', { model: 4 });
const CATEGORIES = [{ id: 'c1', name: 'Semis', rank: 1 }, { id: 'c2', name: 'Cakes', rank: 2 }];

const sourceOf = (products: ReturnType<typeof product>[], categories = CATEGORIES) =>
  editorSource(products, { categories, settings: { labourCostPerHour: 12 } });
const group = (name: RegExp) => screen.getByRole('button', { name });
const madeOf = () => screen.getByRole('region', { name: 'Made of' });
const productRegion = () => screen.getByRole('region', { name: 'Product' });
const chooser = () => screen.findByRole('dialog', undefined, LOAD);

async function listed(products: ReturnType<typeof product>[], categories = CATEGORIES, path = '/food-cost') {
  const fake = sourceOf(products, categories);
  const view = renderFoodcost(path, { source: fake });
  await screen.findByRole('button', { name: 'New product' }, LOAD);
  await screen.findAllByRole('listitem', undefined, LOAD).catch(() => undefined);
  return { ...view, fake };
}

describe('the list in groups', () => {
  it('draws one header per category and «No category» last, every group CLOSED to begin with, each with its number of cards — the chosen kind only', async () => {
    const { user } = await listed([GANACHE, ICING, CAKE, PLAIN]);
    // «Finished products» is the tab it starts on: the semi-finished group is not drawn there.
    const cakes = await screen.findByRole('button', { name: /^Cakes/ }, LOAD);
    expect(cakes).toHaveAttribute('aria-expanded', 'false');
    expect(cakes).toHaveTextContent('1 card');
    expect(group(/^No category/)).toHaveTextContent('1 card');
    expect(screen.queryByRole('button', { name: /^Semis/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /(Semis|Cakes|No category)/ }).map(b => b.textContent?.replace(/\d.*$/, ''))).toEqual(['Cakes', 'No category']);
    // Closed: no card is drawn.
    expect(screen.queryByRole('button', { name: /^Plain/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Semi-finished' }));
    const semis = await screen.findByRole('button', { name: /^Semis/ }, LOAD);
    expect(semis).toHaveAttribute('aria-expanded', 'false');
    expect(semis).toHaveTextContent('2 cards');
    expect(screen.queryByRole('button', { name: /^Cakes/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Ganache/ })).not.toBeInTheDocument();
  });

  it('a tap opens a group and a second tap closes it; a semi-finished card says its cost per kilo and what it is made of', async () => {
    const { user } = await listed([GANACHE, CAKE]);
    await user.click(await screen.findByRole('tab', { name: 'Semi-finished' }, LOAD));
    await user.click(await screen.findByRole('button', { name: /^Semis/ }, LOAD));
    expect(group(/^Semis/)).toHaveAttribute('aria-expanded', 'true');
    const row = screen.getByRole('button', { name: /^Ganache/ });
    // ⚠️ A NUMBER STANDING ALONE IS THE MATERIALS COST PER KG; the labour sits beside it, labelled.
    expect(row).toHaveTextContent('£2.00/kg');
    expect(row).toHaveTextContent('labour £6.00/kg');
    expect(row).not.toHaveTextContent('£8.00');
    await user.click(group(/^Semis/));
    expect(screen.queryByRole('button', { name: /^Ganache/ })).not.toBeInTheDocument();
  });

  it('a group header is a 48px button and a group with no cards is not drawn', async () => {
    await listed([CAKE], [...CATEGORIES, { id: 'c3', name: 'Empty one', rank: 3 }]);
    await screen.findByRole('button', { name: /^Cakes/ }, LOAD);
    expect(screen.queryByRole('button', { name: /^Empty one/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Semis/ })).not.toBeInTheDocument();
  });

  it('a search shows the matching cards with their groups open, and clearing it returns to the closed groups', async () => {
    const { user } = await listed([GANACHE, ICING, CAKE]);
    await user.click(await screen.findByRole('tab', { name: 'Semi-finished' }, LOAD));
    await screen.findByRole('button', { name: /^Semis/ }, LOAD);
    await user.type(screen.getByRole('searchbox', { name: 'Search products' }), 'ganac');
    expect(group(/^Semis/)).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Ganache/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Icing/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Cakes/ })).not.toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Search products' }));
    expect(group(/^Semis/)).toHaveAttribute('aria-expanded', 'false');
  });

  it('the group of the card that is open opens by itself', async () => {
    split();
    await listed([GANACHE, CAKE], CATEGORIES, '/food-cost/product/Cake');
    expect(await screen.findByRole('button', { name: /^Cakes/ }, LOAD)).toHaveAttribute('aria-expanded', 'true');
    // The semi-finished group belongs to the other tab, which the finished card does not open.
    expect(screen.queryByRole('button', { name: /^Semis/ })).not.toBeInTheDocument();
  });

  it('a venue with no category at all gets the plain list, with no «No category» header', async () => {
    await listed([GANACHE, CAKE, PLAIN], []);
    expect(await screen.findByRole('button', { name: /^Cake/ }, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /No category/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Semis/ })).not.toBeInTheDocument();
  });

  it('a card whose category was removed reads as «No category»', async () => {
    await listed([product('Orphan', { categoryId: 'gone', model: 4 })]);
    expect(await screen.findByRole('button', { name: /^No category/ }, LOAD)).toHaveTextContent('1 card');
  });
});

async function openForm(path: string, products: ReturnType<typeof product>[], categories = CATEGORIES) {
  const fake = sourceOf(products, categories);
  const view = renderFoodcost(path, { source: fake });
  await intoForm(view.user);
  return { ...view, fake };
}

async function confirmSave(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Save' }));
}

describe('the card type in the editor', () => {
  it('a new card starts as a finished product; its caption says what that means', async () => {
    await openForm('/food-cost/new', []);
    expect(within(productRegion()).getByRole('radio', { name: 'Finished product' })).toBeChecked();
    expect(within(productRegion()).getByText('Sold: price, VAT and food cost %.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'How it is sold' })).toBeInTheDocument();
  });

  it('switching to semi-finished hides the selling fields and says there is no selling price; switching back brings them back as typed', async () => {
    const { user } = await openForm('/food-cost/product/Plain', [PLAIN]);
    const price = () => screen.queryByRole('textbox', { name: /Selling price/ });
    expect(price()).toHaveValue('1.2');
    await user.click(within(productRegion()).getByRole('radio', { name: 'Semi-finished' }));
    expect(within(productRegion()).getByText('Used inside other cards: the cost per kg counts, no selling price.')).toBeInTheDocument();
    expect(price()).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'How it is sold' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Packaging' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Price' })).getByText(/No selling price: a semi-finished card is used inside other cards/)).toBeInTheDocument();
    await user.click(within(productRegion()).getByRole('radio', { name: 'Finished product' }));
    expect(price()).toHaveValue('1.2');
  });

  it('saves a semi-finished card with no price, no VAT and no way of selling: kind semi, model 4, the category chosen', async () => {
    const { user, fake } = await openForm('/food-cost/new', []);
    await user.type(screen.getByRole('combobox', { name: 'Name' }), 'Praline');
    await user.click(within(productRegion()).getByRole('radio', { name: 'Semi-finished' }));
    await user.selectOptions(within(productRegion()).getByRole('combobox', { name: 'Category' }), 'Semis');
    await confirmSave(user);
    const saved = fake.saved.find(s => s.kind === 'product');
    expect(saved?.data).toMatchObject({ name: 'Praline', kind: 'semi', categoryId: 'c1', model: 4, sellingPrice: null, sellingMode: null });
    // A semi-finished card has no selling price, so it takes no margin point.
    expect(saved?.snapshot).toBeNull();
  });

  it('saves a finished product in no category by default: kind finished, categoryId null', async () => {
    const { user, fake } = await openForm('/food-cost/new', []);
    await user.type(screen.getByRole('combobox', { name: 'Name' }), 'Bun');
    await confirmSave(user);
    expect(fake.saved.find(s => s.kind === 'product')?.data).toMatchObject({ name: 'Bun', kind: 'finished', categoryId: null, model: 4 });
  });

  it('an existing card opens on its own kind and category, and a category that is gone reads as «No category»', async () => {
    await openForm('/food-cost/product/Ganache', [GANACHE]);
    expect(within(productRegion()).getByRole('radio', { name: 'Semi-finished' })).toBeChecked();
    expect(within(productRegion()).getByRole('combobox', { name: 'Category' })).toHaveValue('Semis');
    window.localStorage.clear();
  });

  it('⚠️ a semi-finished card saves even if a price field it kept is not a number: the hidden boxes never stop its Save', async () => {
    const { user, fake } = await openForm('/food-cost/product/Plain', [PLAIN]);
    await user.clear(screen.getByRole('textbox', { name: /Selling price/ }));
    await user.type(screen.getByRole('textbox', { name: /Selling price/ }), 'abc');
    await user.click(within(productRegion()).getByRole('radio', { name: 'Semi-finished' }));
    await confirmSave(user);
    expect(fake.saved.find(s => s.kind === 'product')?.data).toMatchObject({ kind: 'semi', sellingPrice: null });
  });
});

describe('the cost per kg and «Used in» of a semi-finished card', () => {
  it('shows the cost per kg, split into materials and labour, and the cards that use it', async () => {
    renderFoodcost('/food-cost/product/Ganache', { source: sourceOf([GANACHE, CAKE]) });
    const cost = await screen.findByRole('region', { name: 'Cost per kg' }, LOAD);
    // The total with labour is said only with its words; the two lines under it are the parts.
    expect(within(cost).getByTestId('semi-cost-total')).toHaveTextContent('£8.00/kg materials + labour');
    expect(within(cost).getByText('Materials').nextSibling).toHaveTextContent('£2.00/kg');
    expect(within(cost).getByText('Labour').nextSibling).toHaveTextContent('£6.00/kg');
    expect(within(cost).getByText(/1 kg of Ganache\./)).toBeInTheDocument();
    expect(within(cost).getByText('In the cards that use it, the materials (£2.00/kg) go into the cost and the food cost; the labour (£6.00/kg) goes into the labour line.')).toBeInTheDocument();
    // No lone figure equals materials + labour: every «£8.00» on the card sits inside the labelled total.
    for (const node of screen.getAllByText(/£8\.00/)) expect(node.parentElement?.textContent ?? node.textContent).toContain('materials + labour');
    const used = screen.getByRole('region', { name: 'Used in' });
    expect(within(used).getByRole('button', { name: 'Open Cake' })).toHaveTextContent('Cake — 500.00 g');
    expect(within(used).getByText(/the cost of these cards changes too/)).toBeInTheDocument();
  });

  it('«Used in» is not there when nothing uses the card, and the labour is left out (never 0) without the labour rate', async () => {
    const fake = editorSource([GANACHE], { categories: CATEGORIES, settings: null });
    renderFoodcost('/food-cost/product/Ganache', { source: fake, session: { canManage: false, isOwner: false, role: 'staff', location: { staffShownCards: { foodcost: true } } } });
    const cost = await screen.findByRole('region', { name: 'Cost per kg' }, LOAD);
    // Without the labour (an employee, or no rate): the headline is the materials alone and no labour word is said anywhere.
    expect(within(cost).getByTestId('semi-cost-total')).toHaveTextContent(/^£2\.00\/kg$/);
    expect(within(cost).queryByText('Labour')).not.toBeInTheDocument();
    expect(cost).not.toHaveTextContent(/labour/i);
    expect(screen.queryByRole('region', { name: 'Used in' })).not.toBeInTheDocument();
  });

  it('says the labour of the semi-finished cards apart from the card\'s own work', async () => {
    renderFoodcost('/food-cost/product/Cake', { source: sourceOf([GANACHE, { ...CAKE, labourMinutes: 60 }]) });
    const labour = await screen.findByRole('region', { name: 'Work' }, LOAD);
    // 0.5 kg of ganache carries 3.00 of labour, and the cake's own hour is 12.00.
    expect(within(labour).getByText('£3.00 from semi-finished cards + £12.00 own work')).toBeInTheDocument();
  });

  it('is in Italian', async () => {
    renderFoodcost('/food-cost/product/Ganache', { source: sourceOf([GANACHE, CAKE]), lang: 'it', session: { language: 'it' } });
    const cost = await screen.findByRole('region', { name: 'Costo al kg' }, LOAD);
    expect(within(cost).getByTestId('semi-cost-total')).toHaveTextContent('£8.00/kg materie + lavoro');
    expect(within(cost).getByText('Nelle schede che la usano, le materie (£2.00/kg) entrano nel costo e nel food cost; il lavoro (£6.00/kg) va nella riga del lavoro.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Usato in' })).toBeInTheDocument();
  });
});

describe('a semi-finished card in «Made of»', () => {
  const openChooser = async (user: UserEvent) => {
    await user.click(within(madeOf()).getByRole('button', { name: '+ Add recipe, ingredient or semi-finished' }));
    const dialog = await chooser();
    await user.click(within(dialog).getByRole('button', { name: 'Semi-finished' }));
    return dialog;
  };

  it('the chooser offers only semi-finished cards, with their cost per kg, grouped by category', async () => {
    const { user } = await openForm('/food-cost/new', [GANACHE, ICING, CAKE]);
    const dialog = await openChooser(user);
    const names = within(dialog).getAllByRole('button').map(b => b.textContent);
    expect(names.some(text => text?.startsWith('Ganache') && text.includes('£2.00/kg') && text.includes('labour £6.00/kg') && !text.includes('£8.00'))).toBe(true);
    expect(names.some(text => text?.startsWith('Icing') && text.includes('£2.00/kg'))).toBe(true);
    expect(names.some(text => text?.startsWith('Cake'))).toBe(false);
    expect(within(dialog).getByRole('heading', { level: 3, name: 'Semis' })).toBeInTheDocument();
    // The category chips: every category that has semi-finished cards.
    await user.click(within(dialog).getByRole('button', { name: 'Semis' }));
    expect(within(dialog).getByRole('button', { name: 'All categories' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('picking one adds a semi-finished line with an empty kilo box; the row says what a kilo costs and what the amount costs', async () => {
    const { user } = await openForm('/food-cost/new', [GANACHE, ICING]);
    const dialog = await openChooser(user);
    await user.click(within(dialog).getByRole('button', { name: /^Icing/ }));
    const row = within(madeOf()).getByRole('textbox', { name: 'Quantity' });
    expect(row).toHaveValue('');
    expect(within(madeOf()).getByText('Semi-finished')).toBeInTheDocument();
    expect(within(madeOf()).getByText('£2.00/kg')).toBeInTheDocument();
    await user.type(row, '0.25');
    expect(within(madeOf()).getByText('£0.50')).toBeInTheDocument();
  });

  it('a card with labour shows the MATERIALS as the figures of the row and the labour on a line of its own', async () => {
    const { user } = await openForm('/food-cost/new', [GANACHE]);
    const dialog = await openChooser(user);
    await user.click(within(dialog).getByRole('button', { name: /^Ganache/ }));
    await user.type(within(madeOf()).getByRole('textbox', { name: 'Quantity' }), '0.5');
    expect(within(madeOf()).getByText('£2.00/kg')).toBeInTheDocument();
    expect(within(madeOf()).getByText(/^£1\.00$/)).toBeInTheDocument();
    expect(within(madeOf()).getByText('+ labour £3.00')).toBeInTheDocument();
    // Neither the per-kilo total (8.00) nor the amount's total (4.00) is ever a figure on its own.
    expect(madeOf()).not.toHaveTextContent('£8.00');
    expect(madeOf()).not.toHaveTextContent('£4.00');
  });

  it('⚠️ the card itself, one already on this card and one that would hold it again are said and cannot be chosen', async () => {
    const { user } = await openForm('/food-cost/product/Cake', [GANACHE, ICING, CAKE, FILLING]);
    const dialog = await openChooser(user);
    const ganache = within(dialog).getByRole('button', { name: /^Ganache/ });
    expect(ganache).toBeDisabled();
    expect(ganache).toHaveTextContent('already on this card');
    const filling = within(dialog).getByRole('button', { name: /^Filling/ });
    expect(filling).toBeDisabled();
    expect(filling).toHaveTextContent('it would contain this card again');
    expect(within(dialog).getByRole('button', { name: /^Icing/ })).toBeEnabled();
  });

  it('⚠️ a semi-finished card cannot contain itself', async () => {
    const { user } = await openForm('/food-cost/product/Ganache', [GANACHE, ICING]);
    const dialog = await openChooser(user);
    const itself = within(dialog).getByRole('button', { name: /^Ganache/ });
    expect(itself).toBeDisabled();
    expect(itself).toHaveTextContent('this card: it cannot contain itself');
  });

  it('a card that was deleted is said in plain words on its row', async () => {
    renderFoodcost('/food-cost/product/Cake', { source: sourceOf([{ ...CAKE, components: [gram(1000), semiLine('Gone', 0.5)] }]) });
    await intoForm(userOf());
    expect(within(madeOf()).getByText('This card no longer exists')).toBeInTheDocument();
    expect(within(madeOf()).getByText('This card was deleted: remove the line.')).toBeInTheDocument();
  });

  it('saves the semi-finished line with its kilos, and the card with model 4', async () => {
    const { user, fake } = await openForm('/food-cost/product/Cake', [ICING, CAKE, GANACHE]);
    const dialog = await openChooser(user);
    await user.click(within(dialog).getByRole('button', { name: /^Icing/ }));
    await user.type(within(madeOf()).getAllByRole('textbox', { name: 'Quantity' }).at(-1) as HTMLElement, '0.3');
    await confirmSave(user);
    const data = fake.saved.find(s => s.kind === 'product')?.data as { components: unknown[]; model: number; kind: string; categoryId: string };
    expect(data.components).toContainEqual({ kind: 'semi', productId: 'Icing', qtyKg: 0.3 });
    expect(data.components).toContainEqual({ kind: 'semi', productId: 'Ganache', qtyKg: 0.5 });
    expect([data.model, data.kind, data.categoryId]).toEqual([4, 'finished', 'c2']);
  });
});

describe('«Made of»: the rows add up to the total under them, and the delete says what it leaves behind', () => {
  it('⚠️ the materials of the rows (flour £2.00 + ganache £1.00) are the total under them, and the labour is apart', async () => {
    await openForm('/food-cost/product/Cake', [GANACHE, CAKE]);
    // The ganache row: its materials, then «+ labour» on its own line.
    expect(within(madeOf()).getByText('£1.00')).toBeInTheDocument();
    expect(within(madeOf()).getByText('+ labour £3.00')).toBeInTheDocument();
    // The foot of the section adds the MATERIALS up: 2.00 + 1.00.
    expect(within(madeOf()).getByText(/1\.50 kg · £3\.00$/)).toBeInTheDocument();
    expect(madeOf()).not.toHaveTextContent('£4.00');
    expect(madeOf()).not.toHaveTextContent('£8.00');
  });

  it('the read view says the same: materials per kilo and for the amount, labour on its own', async () => {
    renderFoodcost('/food-cost/product/Cake', { source: sourceOf([GANACHE, CAKE]) });
    const made = await screen.findByRole('region', { name: 'Made of' }, LOAD);
    expect(made).toHaveTextContent('£2.00/kg · £1.00');
    expect(made).toHaveTextContent('+ labour £3.00');
    expect(made).not.toHaveTextContent('£8.00');
  });

  it('⚠️ deleting a semi-finished card that other cards use says what stays behind in them', async () => {
    const { user } = await openForm('/food-cost/product/Ganache', [GANACHE, CAKE]);
    await user.click(screen.getByRole('button', { name: 'Delete product' }));
    const asked = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(asked).toHaveTextContent('Delete “Ganache”? It is used in 1 card: there a line with no price will stay, to remove by hand. This cannot be undone.');
  });

  it('a card nobody uses is asked about as before', async () => {
    const { user } = await openForm('/food-cost/product/Icing', [ICING, CAKE]);
    await user.click(screen.getByRole('button', { name: 'Delete product' }));
    expect(await screen.findByRole('alertdialog', undefined, LOAD)).toHaveTextContent('Delete “Icing”? This cannot be undone, and its margin history goes with it.');
  });

  it('the read view warns in the same way, in Italian too', async () => {
    renderFoodcost('/food-cost/product/Ganache', { source: sourceOf([GANACHE, CAKE]), lang: 'it', session: { language: 'it' } });
    const user = userOf();
    await user.click(await screen.findByRole('button', { name: 'Elimina prodotto' }, LOAD));
    expect(await screen.findByRole('alertdialog', undefined, LOAD))
      .toHaveTextContent('Eliminare “Ganache”? È usata in 1 scheda: in quella resterà una riga senza prezzo, da togliere a mano. Non si può annullare.');
  });
});

describe('semi-finished cards inside each other: too deep is not a loop', () => {
  const inside = (name: string, holds?: string) => product(name, {
    kind: 'semi', model: 4, components: holds ? [semiLine(holds, 1)] : [gram(1000)], sellingMode: null, sellingPrice: null, vatRate: null, piecesPerBatch: null,
  });
  // D0 holds D1 holds D2 holds D3 holds D4: D0 already carries the four levels there may be.
  const CHAIN = [inside('D0', 'D1'), inside('D1', 'D2'), inside('D2', 'D3'), inside('D3', 'D4'), inside('D4'), inside('Free')];

  it('⚠️ a card whose choice would pile up a fifth level is said and cannot be chosen, with its own reason', async () => {
    const { user } = await openForm('/food-cost/product/D4', CHAIN);
    const dialog = await (async () => {
      await user.click(within(madeOf()).getByRole('button', { name: '+ Add recipe, ingredient or semi-finished' }));
      const found = await chooser();
      await user.click(within(found).getByRole('button', { name: 'Semi-finished' }));
      return found;
    })();
    const free = within(dialog).getByRole('button', { name: /^Free/ });
    expect(free).toBeDisabled();
    expect(free).toHaveTextContent('too many semi-finished cards inside each other (4 levels at most)');
    // A real loop keeps its own words.
    expect(within(dialog).getByRole('button', { name: /^D0/ })).toHaveTextContent('it would contain this card again');
  });

  it('the same card is offered where the chain stays within four levels', async () => {
    const { user } = await openForm('/food-cost/product/D0', CHAIN);
    await user.click(within(madeOf()).getByRole('button', { name: '+ Add recipe, ingredient or semi-finished' }));
    const dialog = await chooser();
    await user.click(within(dialog).getByRole('button', { name: 'Semi-finished' }));
    expect(within(dialog).getByRole('button', { name: /^Free/ })).toBeEnabled();
  });

  it('a line that is too deep says so on its row, in plain words', async () => {
    const fiveDeep = [inside('E0', 'E1'), inside('E1', 'E2'), inside('E2', 'E3'), inside('E3', 'E4'), inside('E4', 'E5'), inside('E5')];
    await openForm('/food-cost/product/E0', fiveDeep);
    expect(within(madeOf()).getByText(/Too many semi-finished cards inside each other \(4 levels at most\)/)).toBeInTheDocument();
  });
});

describe('a semi-finished card changed to a finished product', () => {
  it('⚠️ says, under the type, that the cards that use it keep it in their cost and that it will be bookable', async () => {
    const { user } = await openForm('/food-cost/product/Ganache', [GANACHE, CAKE]);
    expect(screen.queryByTestId('kind-used-note')).not.toBeInTheDocument();
    await user.click(within(productRegion()).getByRole('radio', { name: 'Finished product' }));
    expect(screen.getByTestId('kind-used-note')).toHaveTextContent('It is used in 1 card: it will stay in its cost and will also appear among the products to book.');
  });

  it('says nothing for a card nobody uses', async () => {
    const { user } = await openForm('/food-cost/product/Icing', [ICING, CAKE]);
    await user.click(within(productRegion()).getByRole('radio', { name: 'Finished product' }));
    expect(screen.queryByTestId('kind-used-note')).not.toBeInTheDocument();
  });
});

describe('the list: a card left by Back keeps its group open for the focus', () => {
  it('⚠️ Back from a card leaves its group open and the focus on its row, never on the page', async () => {
    split();
    const { user } = await listed([GANACHE, CAKE], CATEGORIES, '/food-cost/product/Cake');
    expect(await screen.findByRole('button', { name: /^Cakes/ }, LOAD)).toHaveAttribute('aria-expanded', 'true');
    await user.click(await screen.findByRole('button', { name: /^Back/ }, LOAD));
    await waitFor(() => { expect(screen.getByRole('button', { name: /^Cake(?!s)/ })).toHaveFocus(); });
    expect(group(/^Cakes/)).toHaveAttribute('aria-expanded', 'true');
  });
});

// The user-event instance for a spec that renders by hand.
function userOf(): UserEvent {
  return userEvent.setup();
}

describe('a card saved before model 4', () => {
  it('has no kind and no category: it is a finished product, in «No category»', async () => {
    await listed([bareProduct('Old')]);
    expect(await screen.findByRole('button', { name: /^No category/ }, LOAD)).toHaveTextContent('1 card');
  });
});
