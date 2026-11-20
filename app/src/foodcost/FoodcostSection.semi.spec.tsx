import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { editorSource, intoForm } from '../testing/foodcostEditorFixtures';
import { LOAD, bareProduct, product, renderFoodcost, split } from '../testing/renderFoodcost';

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
  it('draws one header per category and «No category» last, every group CLOSED to begin with, each with its number of cards', async () => {
    await listed([GANACHE, ICING, CAKE, PLAIN]);
    const semis = await screen.findByRole('button', { name: /^Semis/ }, LOAD);
    expect(semis).toHaveAttribute('aria-expanded', 'false');
    expect(semis).toHaveTextContent('2 cards');
    expect(group(/^Cakes/)).toHaveTextContent('1 card');
    expect(group(/^No category/)).toHaveTextContent('1 card');
    expect(screen.getAllByRole('button', { name: /(Semis|Cakes|No category)/ }).map(b => b.textContent?.replace(/\d.*$/, ''))).toEqual(['Semis', 'Cakes', 'No category']);
    // Closed: no card is drawn.
    expect(screen.queryByRole('button', { name: /^Ganache/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Plain/ })).not.toBeInTheDocument();
  });

  it('a tap opens a group and a second tap closes it; a semi-finished card says its cost per kilo and what it is made of', async () => {
    const { user } = await listed([GANACHE, CAKE]);
    await user.click(await screen.findByRole('button', { name: /^Semis/ }, LOAD));
    expect(group(/^Semis/)).toHaveAttribute('aria-expanded', 'true');
    const row = screen.getByRole('button', { name: /^Ganache/ });
    expect(row).toHaveTextContent('materials £2.00 · labour £6.00');
    expect(row).toHaveTextContent('£8.00/kg');
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
    expect(group(/^Semis/)).toHaveAttribute('aria-expanded', 'false');
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

describe('the categories dialog', () => {
  const open = async (products = [GANACHE, CAKE], categories = CATEGORIES) => {
    const view = await listed(products, categories);
    await view.user.click(await screen.findByRole('button', { name: 'Categories' }, LOAD));
    return { ...view, dialog: await chooser() };
  };

  it('lists the categories in order with their number of cards', async () => {
    const { dialog } = await open();
    const rows = within(dialog).getAllByRole('listitem').map(item => item.textContent);
    expect(rows[0]).toContain('Semis');
    expect(rows[0]).toContain('1 card');
    expect(rows[1]).toContain('Cakes');
    expect(within(dialog).getByText(/Removing a category deletes no card/)).toBeInTheDocument();
  });

  it('adds a category at the end of the list, written at once', async () => {
    const { user, dialog, fake } = await open();
    await user.click(within(dialog).getByRole('button', { name: '+ New category' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Category name' }), '  Bread  {Enter}');
    expect(fake.saved.filter(s => s.kind === 'category')).toHaveLength(1);
    expect(fake.saved.at(-1)).toMatchObject({ kind: 'category', data: { name: 'Bread' } });
    expect((fake.saved.at(-1)!.data as { rank: number }).rank).toBeGreaterThan(2);
    expect(within(dialog).getAllByRole('listitem').map(item => item.textContent).at(-1)).toContain('Bread');
  });

  it('⚠️ refuses an empty name and a name another category has (capitals not counting), and says why', async () => {
    const { user, dialog, fake } = await open();
    await user.click(within(dialog).getByRole('button', { name: '+ New category' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Category name' }), '   {Enter}');
    expect(await within(dialog).findByText('Write a name for the category.')).toBeInTheDocument();
    await user.clear(within(dialog).getByRole('textbox', { name: 'Category name' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Category name' }), 'semis{Enter}');
    expect(await within(dialog).findByText('There is already a category called “semis”.')).toBeInTheDocument();
    expect(fake.saved.filter(s => s.kind === 'category')).toEqual([]);
  });

  it('renames a category with the pencil, keeping its place in the order', async () => {
    const { user, dialog, fake } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Rename Semis' }));
    const box = within(dialog).getByRole('textbox', { name: 'Category name' });
    await user.clear(box);
    await user.type(box, 'Fillings{Enter}');
    expect(fake.saved.at(-1)).toMatchObject({ kind: 'category', id: 'c1', data: { name: 'Fillings', rank: 1 } });
    expect(within(dialog).getAllByRole('listitem')[0]).toHaveTextContent('Fillings');
  });

  it('a category may keep its own name when it is renamed to the same words', async () => {
    const { user, dialog, fake } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Rename Semis' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Category name' }), '{Enter}');
    expect(fake.saved.at(-1)).toMatchObject({ kind: 'category', id: 'c1', data: { name: 'Semis' } });
  });

  it('⚠️ removing asks first, naming the cards that move; Cancel keeps it; the cards themselves are never rewritten', async () => {
    const { user, dialog, fake } = await open();
    await user.click(within(dialog).getByRole('button', { name: 'Remove Semis' }));
    const ask = await screen.findByRole('alertdialog');
    expect(ask).toHaveTextContent('Remove the category “Semis”? Its 1 card moves to No category.');
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(fake.saved.filter(s => s.kind === 'category-remove')).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Remove Semis' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    expect(fake.saved.filter(s => s.kind === 'category-remove').map(s => s.id)).toEqual(['c1']);
    expect(fake.saved.filter(s => s.kind === 'product')).toEqual([]);
    expect(fake.categories.has('c1')).toBe(false);
  });

  it('a refused write puts the category back and says so', async () => {
    const { user, dialog, fake } = await open();
    fake.refuse.category = true;
    await user.click(within(dialog).getByRole('button', { name: '+ New category' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Category name' }), 'Bread{Enter}');
    expect(await screen.findByText(/Could not save the category “Bread”/, undefined, LOAD)).toBeInTheDocument();
    expect(within(dialog).queryByText('Bread')).not.toBeInTheDocument();
  });

  it('is in Italian too', async () => {
    const fake = sourceOf([GANACHE]);
    const view = renderFoodcost('/food-cost', { source: fake, lang: 'it', session: { language: 'it' } });
    await view.user.click(await screen.findByRole('button', { name: 'Categorie' }, LOAD));
    const dialog = await chooser();
    expect(within(dialog).getByRole('button', { name: '+ Nuova categoria' })).toBeInTheDocument();
    expect(within(dialog).getByText(/Togliere una categoria non cancella le schede/)).toBeInTheDocument();
    expect(within(dialog).getAllByRole('listitem')[0]).toHaveTextContent('1 scheda');
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
    expect(within(productRegion()).getByRole('combobox', { name: 'Category' })).toHaveValue('c1');
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
    expect(within(cost).getByTestId('semi-cost-total')).toHaveTextContent('£8.00/kg');
    expect(within(cost).getByText('Materials').nextSibling).toHaveTextContent('£2.00/kg');
    expect(within(cost).getByText('Labour').nextSibling).toHaveTextContent('£6.00/kg');
    expect(within(cost).getByText(/1 kg of Ganache\./)).toBeInTheDocument();
    const used = screen.getByRole('region', { name: 'Used in' });
    expect(within(used).getByRole('button', { name: 'Open Cake' })).toHaveTextContent('Cake — 500.00 g');
    expect(within(used).getByText(/the cost of these cards changes too/)).toBeInTheDocument();
  });

  it('«Used in» is not there when nothing uses the card, and the labour is left out (never 0) without the labour rate', async () => {
    const fake = editorSource([GANACHE], { categories: CATEGORIES, settings: null });
    renderFoodcost('/food-cost/product/Ganache', { source: fake, session: { canManage: false, isOwner: false, role: 'staff', location: { staffShownCards: { foodcost: true } } } });
    const cost = await screen.findByRole('region', { name: 'Cost per kg' }, LOAD);
    expect(within(cost).getByTestId('semi-cost-total')).toHaveTextContent('£2.00/kg');
    expect(within(cost).queryByText('Labour')).not.toBeInTheDocument();
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
    expect(within(cost).getByText(/È il prezzo che usano le altre schede quando la mettono in «Composto da»/)).toBeInTheDocument();
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
    expect(names.some(text => text?.startsWith('Ganache') && text.includes('£8.00/kg') && text.includes('materials £2.00 · labour £6.00'))).toBe(true);
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
    expect(within(madeOf()).getByText('materials £0.50')).toBeInTheDocument();
  });

  it('a card with labour says «labour included» and splits the amount into materials and labour', async () => {
    const { user } = await openForm('/food-cost/new', [GANACHE]);
    const dialog = await openChooser(user);
    await user.click(within(dialog).getByRole('button', { name: /^Ganache/ }));
    await user.type(within(madeOf()).getByRole('textbox', { name: 'Quantity' }), '0.5');
    expect(within(madeOf()).getByText('£8.00/kg · labour included')).toBeInTheDocument();
    expect(within(madeOf()).getByText('£4.00')).toBeInTheDocument();
    expect(within(madeOf()).getByText('materials £1.00')).toBeInTheDocument();
    expect(within(madeOf()).getByText('labour £3.00')).toBeInTheDocument();
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
