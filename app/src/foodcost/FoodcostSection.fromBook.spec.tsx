import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import dialogCss from './FromBookDialog.module.css?raw';
import { PRODUCTS_KEY, RECIPES_KEY } from './foodcostStore';
import { EMPLOYEE, LOAD, MANAGER, product, renderFoodcost, sourceWith } from '../testing/renderFoodcost';

// Products made from the recipe book (item 29; current app b5cf999e, f8d54f35, f8e64a6a): the box on the list, the choice and the
// confirm, what is written, and what is refused. The model half is in shared/src/from-recipes.spec.ts, the transaction in
// foodcostSource.spec.ts and the store's counting in foodcostStore.spec.ts.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const recipe = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id, name, ingredients: [{ label: 'Flour', grams: 1000, unit: 'g' }], ...extra });

// Brioche weighs 1.53 kg once made (1 kg + 700 g, less 10% in the oven); Pizza has nothing weighable.
const BRIOCHE = recipe('r1', 'Brioche', { lossPct: 10, ingredients: [{ label: 'Flour', grams: 1, unit: 'kg' }, { label: 'Water', grams: 700, unit: 'g' }] });
const PIZZA = recipe('r2', 'Pizza', { ingredients: [{ label: 'Eggs', grams: 3, unit: 'pcs' }] });
const FOCACCIA = recipe('r3', 'Focaccia');
const CREAM = recipe('r4', 'Cream');

const box = () => screen.queryByRole('region', { name: /without a product/ });
const boxButton = () => screen.getByRole('button', { name: /^Create the missing product/ });
const choice = () => screen.getByRole('dialog', { name: 'Products from the recipe book' });
const tick = (name: RegExp) => within(choice()).getByRole('checkbox', { name });
const createButton = () => within(choice()).getByRole('button', { name: /^Create \d+ products?$|^Tick at least one recipe$|^Creating…$/ });
const newButton = () => screen.getByRole('button', { name: 'New product' });

async function listed(recipes: unknown[], products = [product('Green')], options: Parameters<typeof renderFoodcost>[1] = {}) {
  const fake = options.source ?? sourceWith(products, { recipes: recipes as never });
  const view = renderFoodcost('/food-cost', { ...options, source: fake });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return { ...view, fake };
}

async function opened(recipes: unknown[], products = [product('Green')], options: Parameters<typeof renderFoodcost>[1] = {}) {
  const view = await listed(recipes, products, options);
  await view.user.click(await screen.findByRole('button', { name: /^Create the missing product/ }, LOAD));
  await screen.findByRole('dialog', { name: 'Products from the recipe book' });
  return view;
}

describe('the box on the list', () => {
  it('says how many recipes have no product, for whoever runs the place', async () => {
    await listed([BRIOCHE, PIZZA]);
    await screen.findByRole('region', { name: '2 recipes without a product' }, LOAD);
    expect(screen.getByText('In the recipe book but not in Food cost yet.')).toBeInTheDocument();
    expect(boxButton()).toHaveAccessibleName('Create the missing products (2)');
  });

  it('says it in the singular for one', async () => {
    await listed([BRIOCHE]);
    expect(await screen.findByRole('region', { name: '1 recipe without a product' }, LOAD)).toBeInTheDocument();
    expect(boxButton()).toHaveAccessibleName('Create the missing product');
  });

  it.each([['the owner', {}], ['a manager', MANAGER]])('is shown to %s', async (_who, session) => {
    await listed([BRIOCHE], [product('Green')], { session });
    expect(await screen.findByRole('region', { name: /without a product/ }, LOAD)).toBeInTheDocument();
  });

  it('is NOT shown to an employee, who may still see Food cost', async () => {
    await listed([BRIOCHE], [product('Green')], { session: EMPLOYEE });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(box()).not.toBeInTheDocument();
  });

  it('is not shown when every recipe has its product — renamed, or emptied since', async () => {
    await listed([BRIOCHE], [product('Pagnotta', { id: 'recipe-r1', components: [] })].map(p => ({ ...p, id: 'recipe-r1' })));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(box()).not.toBeInTheDocument();
  });

  it('counts a recipe a hand-made product merely uses as NOT missing (it is only a «maybe»)', async () => {
    await listed([BRIOCHE, CREAM], [product('Cornetto', { components: [{ recipeId: 'r4', qtyKg: 1 }] })]);
    expect(await screen.findByRole('region', { name: '1 recipe without a product' }, LOAD)).toBeInTheDocument();
  });

  it('is not shown while the list is narrowed to a recipe', async () => {
    const fake = sourceWith([product('Green', { components: [{ recipeId: 'r4', qtyKg: 1 }] })], { recipes: [BRIOCHE, CREAM] as never });
    renderFoodcost('/food-cost?using=r4', { source: fake });
    await screen.findByRole('button', { name: /^Green/ }, LOAD);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(box()).not.toBeInTheDocument();
  });

  it('⚠️ waits for the products: a list that has not arrived would offer every recipe', async () => {
    const fake = sourceWith([product('Green')], { recipes: [BRIOCHE] as never });
    fake.hold();
    renderFoodcost('/food-cost', { source: fake });
    await screen.findByText('Loading…', undefined, LOAD);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(box()).not.toBeInTheDocument();
    fake.release();
    expect(await screen.findByRole('region', { name: /without a product/ }, LOAD)).toBeInTheDocument();
  });

  it('⚠️ waits for the SERVER: the phone’s own copy of the lists is not enough to offer the recipes', async () => {
    // A copy from an earlier visit: it makes the list «loaded» at start-up, before any listener has answered.
    window.localStorage.setItem(PRODUCTS_KEY, JSON.stringify([product('Green')]));
    window.localStorage.setItem(RECIPES_KEY, JSON.stringify([BRIOCHE]));
    const fake = sourceWith([product('Green')], { recipes: [BRIOCHE] as never });
    fake.hold();
    renderFoodcost('/food-cost', { source: fake });
    await screen.findAllByRole('listitem', undefined, LOAD);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(box()).not.toBeInTheDocument();
    fake.release();
    expect(await screen.findByRole('region', { name: /without a product/ }, LOAD)).toBeInTheDocument();
  });
});

describe('the choice', () => {
  it('lists the recipes to create, ticked, with what each would start as, and the maybes unticked', async () => {
    await opened([BRIOCHE, PIZZA, FOCACCIA, CREAM], [
      product('Green'),
      product('Cornetto', { components: [{ recipeId: 'r4', qtyKg: 1 }] }),
      product('  focàccia '),
    ]);
    const dialog = choice();
    expect(within(dialog).getByText(/^Each product takes the recipe’s name/)).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'To create · 2' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Maybe already in Food cost · 2' })).toBeInTheDocument();

    expect(tick(/^Brioche/)).toBeChecked();
    expect(tick(/^Brioche/)).toHaveAccessibleName('Brioche Whole recipe: 1.53 kg');
    expect(tick(/^Pizza/)).toBeChecked();
    expect(tick(/^Pizza/)).toHaveAccessibleName('Pizza Whole recipe: weight to fill in');
    expect(tick(/^Cream/)).not.toBeChecked();
    expect(tick(/^Cream/)).toHaveAccessibleName('Cream Already used in “Cornetto”');
    expect(tick(/^Focaccia/)).not.toBeChecked();
    expect(tick(/^Focaccia/)).toHaveAccessibleName('Focaccia There is already a product with this name');
    expect(createButton()).toHaveTextContent('Create 2 products');
  });

  it('keeps the heading levels in order: the dialog’s title above the groups, each group one level below', async () => {
    await opened([BRIOCHE, CREAM], [product('Cornetto', { components: [{ recipeId: 'r4', qtyKg: 1 }] })]);
    const dialog = choice();
    expect(within(dialog).getByRole('heading', { name: 'Products from the recipe book', level: 2 })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'To create · 1', level: 3 })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Maybe already in Food cost · 1', level: 3 })).toBeInTheDocument();
  });

  it('puts the recipes in alphabetical order', async () => {
    await opened([PIZZA, BRIOCHE, recipe('r9', 'apple tart')]);
    expect(within(choice()).getAllByRole('checkbox').map(box => box.closest('label')?.querySelector('span span')?.textContent))
      .toEqual(['apple tart', 'Brioche', 'Pizza']);
  });

  it('unticks and ticks them all with one button, and the Create button follows the count', async () => {
    const { user } = await opened([BRIOCHE, PIZZA, FOCACCIA]);
    expect(createButton()).toHaveTextContent('Create 3 products');
    await user.click(within(choice()).getByRole('button', { name: 'Untick all' }));
    expect(within(choice()).getAllByRole('checkbox').every(box => !(box as HTMLInputElement).checked)).toBe(true);
    expect(createButton()).toHaveTextContent('Tick at least one recipe');
    expect(createButton()).toBeDisabled();
    await user.click(within(choice()).getByRole('button', { name: 'Tick all' }));
    expect(createButton()).toHaveTextContent('Create 3 products');
    await user.click(tick(/^Pizza/));
    expect(createButton()).toHaveTextContent('Create 2 products');
    // One unticked: the button offers to tick them all again.
    expect(within(choice()).getByRole('button', { name: 'Tick all' })).toBeInTheDocument();
    await user.click(tick(/^Focaccia/));
    expect(createButton()).toHaveTextContent('Create 1 product');
  });

  it('⚠️ Back and Escape only close: nothing is written, nothing was asked', async () => {
    const { user, fake } = await opened([BRIOCHE]);
    await user.click(within(choice()).getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog', { name: 'Products from the recipe book' })).not.toBeInTheDocument();
    await user.click(boxButton());
    await screen.findByRole('dialog', { name: 'Products from the recipe book' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Products from the recipe book' })).not.toBeInTheDocument();
    expect(fake.createProductIfAbsent).not.toHaveBeenCalled();
    expect(fake.saved).toEqual([]);
  });

  it('gives the focus back to the box button when it closes unused', async () => {
    const { user } = await opened([BRIOCHE]);
    await user.keyboard('{Escape}');
    await waitFor(() => { expect(boxButton()).toHaveFocus(); });
  });

  it('works by keyboard: Tab to a tick, Space unticks it, Tab on to the buttons', async () => {
    const { user } = await opened([BRIOCHE, PIZZA]);
    const brioche = tick(/^Brioche/);
    brioche.focus();
    await user.keyboard(' ');
    expect(brioche).not.toBeChecked();
    expect(createButton()).toHaveTextContent('Create 1 product');
    await user.keyboard(' ');
    expect(brioche).toBeChecked();
    createButton().focus();
    expect(createButton()).toHaveFocus();
  });

  it('is a snapshot: a product arriving while he ticks does not move the rows', async () => {
    const { fake } = await opened([BRIOCHE, PIZZA]);
    fake.products.set('recipe-r1', { id: 'recipe-r1', name: 'Brioche', components: [], packaging: [], model: 2 });
    fake.push();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(tick(/^Brioche/)).toBeInTheDocument();
    expect(within(choice()).getAllByRole('checkbox')).toHaveLength(2);
  });

  it('gives each tick a 24px box and a 48px row to tap', () => {
    const body = (selector: string) => dialogCss.replace(/\/\*[\s\S]*?\*\//g, '').match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    expect(body('.tick input')).toMatch(/width:\s*24px/);
    expect(body('.tick input')).toMatch(/height:\s*24px/);
    expect(body('.tick')).toMatch(/min-height:\s*var\(--hit\)/);
  });
});

describe('creating', () => {
  it('⚠️ asks first, naming the count, and Cancel writes nothing and keeps the ticks', async () => {
    const { user, fake } = await opened([BRIOCHE, PIZZA]);
    await user.click(createButton());
    const ask = await screen.findByRole('alertdialog', { name: 'Create 2 products?' });
    expect(within(ask).getByText('You will find them in the Food cost list, to complete with price and pieces.')).toBeInTheDocument();
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fake.createProductIfAbsent).not.toHaveBeenCalled();
    expect(choice()).toBeInTheDocument();
    expect(tick(/^Brioche/)).toBeChecked();
  });

  it('⚠️ an Escape the confirm takes closes the confirm only, never the choice and its ticks', async () => {
    const { user } = await opened([BRIOCHE]);
    await user.click(createButton());
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(choice()).toBeInTheDocument();
    expect(tick(/^Brioche/)).toBeChecked();
  });

  it('creates the ticked ones whole — name, the recipe on the line, nothing anybody did not type — and lands on the list', async () => {
    const { user, fake } = await opened([BRIOCHE, PIZZA, FOCACCIA]);
    await user.click(tick(/^Focaccia/));
    await user.click(createButton());
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Create 2 products?' })).getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('2 products created')).toBeInTheDocument();
    expect(fake.saved.map(s => [s.kind, s.id])).toEqual([['create', 'recipe-r1'], ['create', 'recipe-r2']]);
    expect(fake.saved[0]!.data).toEqual({
      name: 'Brioche', components: [{ recipeId: 'r1', qtyKg: 1.53 }], packaging: [],
      sellingMode: null, piecesPerBatch: null, packSize: null, packUnit: null, sellingPrice: null, vatRate: null, foodCostTarget: null,
      labourMinutes: null, labourPeople: null, model: 2,
    });
    expect(fake.saved[1]!.data).toMatchObject({ name: 'Pizza', components: [{ recipeId: 'r2', qtyKg: 0 }] });
    // No margin point: nothing is priced yet.
    expect(fake.saved.every(s => s.snapshot === undefined)).toBe(true);

    expect(screen.queryByRole('dialog', { name: 'Products from the recipe book' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Brioche/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Pizza/ })).toBeInTheDocument();
    // Only Focaccia is still missing; the box follows.
    expect(await screen.findByRole('region', { name: '1 recipe without a product' })).toBeInTheDocument();
  });

  it('says «1 product created» for one, and the box goes when nothing is missing any more; the focus lands on New product', async () => {
    const { user } = await opened([BRIOCHE]);
    await user.click(createButton());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('1 product created')).toBeInTheDocument();
    await waitFor(() => { expect(box()).not.toBeInTheDocument(); });
    await waitFor(() => { expect(newButton()).toHaveFocus(); });
  });

  it('creates a «maybe» too, once he ticks it', async () => {
    const { user, fake } = await opened([BRIOCHE, CREAM], [product('Cornetto', { components: [{ recipeId: 'r4', qtyKg: 1 }] })]);
    await user.click(tick(/^Cream/));
    await user.click(createButton());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Create' }));
    await screen.findByText('2 products created');
    expect(fake.saved.map(s => s.id)).toEqual(['recipe-r1', 'recipe-r4']);
  });

  it('⚠️ never a duplicate: a product the server already has (this phone had not heard) is left as it is', async () => {
    const { user, fake } = await opened([BRIOCHE]);
    // Made on another phone and filled in there; this phone's list has not been told.
    fake.products.set('recipe-r1', { id: 'recipe-r1', name: 'Brioche', sellingPrice: 2.4, components: [{ recipeId: 'r1', qtyKg: 1.53 }], model: 2 });
    await user.click(createButton());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('They were already in Food cost')).toBeInTheDocument();
    expect(fake.saved).toEqual([]);
    expect(fake.products.get('recipe-r1')).toMatchObject({ sellingPrice: 2.4 });
    expect(screen.queryByRole('dialog', { name: 'Products from the recipe book' })).not.toBeInTheDocument();
  });

  it('⚠️ offline or refused: says how many were not created, writes nothing, and the choice stays open with its ticks', async () => {
    const { user, fake } = await opened([BRIOCHE, PIZZA]);
    fake.refuse.create = true;
    await user.click(tick(/^Pizza/));
    await user.click(createButton());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Create' }));

    const notice = await screen.findByRole('alertdialog', { name: /was not created/ });
    expect(notice).toHaveTextContent('1 product was not created: this needs an internet connection. Try again when you are online.');
    await user.click(within(notice).getByRole('button', { name: 'OK' }));

    expect(fake.saved).toEqual([]);
    expect(choice()).toBeInTheDocument();
    expect(tick(/^Brioche/)).toBeChecked();
    expect(tick(/^Pizza/)).not.toBeChecked();
    expect(createButton()).toHaveTextContent('Create 1 product');
    expect(createButton()).toBeEnabled();
    // The button was disabled while the server answered: the focus is put back on it, not left to the browser.
    await waitFor(() => { expect(createButton()).toHaveFocus(); });
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.queryByText(/products? created/)).not.toBeInTheDocument();

    // Online again: the same screen, the same ticks, another try.
    fake.refuse.create = false;
    await user.click(createButton());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('1 product created')).toBeInTheDocument();
    expect(fake.saved.map(s => s.id)).toEqual(['recipe-r1']);
  });

  it('says «2 products were not created» in the plural', async () => {
    const { user, fake } = await opened([BRIOCHE, PIZZA]);
    fake.refuse.create = true;
    await user.click(createButton());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alertdialog', { name: /were not created/ })).toHaveTextContent('2 products were not created');
  });

  it('holds still while the server answers: nothing to tap, Escape closes nothing', async () => {
    const { user, fake } = await opened([BRIOCHE]);
    let answer!: (created: boolean) => void;
    vi.mocked(fake.createProductIfAbsent).mockImplementationOnce(() => new Promise<boolean>(resolve => { answer = resolve; }));
    await user.click(createButton());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Create' }));

    await waitFor(() => { expect(createButton()).toHaveTextContent('Creating…'); });
    expect(createButton()).toBeDisabled();
    expect(within(choice()).getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(tick(/^Brioche/)).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(choice()).toBeInTheDocument();

    answer(true);
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Products from the recipe book' })).not.toBeInTheDocument(); });
  });
});

describe('in Italian', () => {
  const IT = { lang: 'it' as const, session: { language: 'it' as const, location: { country: 'IT' } } };

  it('is worded as the current app words it, with the Italian number for the weight', async () => {
    const { user, fake } = await listed([BRIOCHE, PIZZA], [product('Verde')], IT);
    expect(await screen.findByRole('region', { name: '2 ricette senza scheda' }, LOAD)).toBeInTheDocument();
    expect(screen.getByText('Sono nel Ricettario ma non ancora nel Food cost.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Crea le schede mancanti (2)' }));

    const dialog = await screen.findByRole('dialog', { name: 'Schede dal Ricettario' });
    expect(within(dialog).getByRole('heading', { name: 'Da creare · 2' })).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'Brioche Ricetta intera: 1,53 kg' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Pizza Ricetta intera: peso da scrivere' })).toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Togli tutte' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Crea 2 schede' }));

    const ask = await screen.findByRole('alertdialog', { name: 'Creare 2 schede?' });
    expect(within(ask).getByText('Le trovi nella lista del Food cost, da completare con prezzo e pezzi.')).toBeInTheDocument();
    await user.click(within(ask).getByRole('button', { name: 'Crea' }));
    expect(await screen.findByText('2 schede create')).toBeInTheDocument();
    expect(fake.saved.map(s => s.id)).toEqual(['recipe-r1', 'recipe-r2']);
  });

  it('says in Italian that nothing could be created without a connection', async () => {
    const { user, fake } = await listed([BRIOCHE], [product('Verde')], IT);
    fake.refuse.create = true;
    await user.click(await screen.findByRole('button', { name: 'Crea la scheda mancante' }, LOAD));
    await user.click(await screen.findByRole('button', { name: 'Crea 1 scheda' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Crea' }));
    expect(await screen.findByRole('alertdialog', { name: /non è stata creata/ })).toHaveTextContent('1 scheda non è stata creata: serve la connessione a internet. Riprova quando sei online.');
  });
});
