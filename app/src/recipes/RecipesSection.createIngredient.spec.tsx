import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { linkOf } from '@mise/shared/catalogue-model';
import { isBusy } from '../session/busy';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import type { FakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, recipe, renderRecipes } from '../testing/renderRecipes';
import { RECIPES_KEY } from './recipesStore';

// A switch the failing-card spec flips: the card's pack words are asked for while it is drawn.
const boom = vi.hoisted(() => ({ on: false }));
vi.mock('@mise/shared/record-choices', async importOriginal => {
  const original = await importOriginal<typeof import('@mise/shared/record-choices')>();
  return {
    ...original,
    packChoices: (...args: Parameters<typeof original.packChoices>) => {
      if (boom.on) throw new Error('the card cannot be drawn');
      return original.packChoices(...args);
    },
  };
});

// Step 3e, T15: «+ Add “…” as an ingredient» in the recipe editor — the doors (the suggestions' last row and the chooser's last
// button), the SAME ingredient card as «Ingredients & suppliers» above the editor, what Back does, what Save links, and that no
// money is read anywhere.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  boom.on = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const EMPLOYEE = { role: 'staff' as const, canManage: false, isOwner: false };
const MANAGER = { role: 'manager' as const, canManage: true, isOwner: false };
const FOCACCIA = recipe('r1', { name: 'Focaccia', ingredients: [{ label: 'Flour', grams: 1000, unit: 'g' }] });
const CAPUTO = { id: 'ing-caputo', name: 'Farina 00 Caputo', shortName: 'Caputo', weight: '25 kg' };
const BUTTERS = Array.from({ length: 7 }, (_, index) => ({ id: `ing-b${index}`, name: `Burro ${index + 1}`, weight: '1 kg' }));
const CREATE = '+ Add «Rye flour» as an ingredient';

const ingredientBoxes = (region: HTMLElement) => within(region).getAllByRole('combobox', { name: 'Ingredient name' }) as HTMLInputElement[];
const amountBoxes = (region: HTMLElement) => within(region).queryAllByRole('spinbutton', { name: 'Amount' }) as HTMLInputElement[];
const optionTexts = () => {
  const list = screen.queryByRole('listbox', { name: 'Catalogue ingredients to link' });
  return list ? within(list).getAllByRole('option').map(node => node.textContent) : [];
};
const card = () => screen.findByRole('dialog', { name: 'New ingredient' });
const cardRegion = async () => within(await screen.findByRole('region', { name: 'New ingredient' }));

type Seed = {
  ingredients?: Array<{ id: string } & Record<string, unknown>>;
  recipes?: ReturnType<typeof recipe>[];
  session?: Record<string, unknown>;
  entries?: string[];
  suppliers?: FakeSuppliersSource;
  lang?: 'en' | 'it';
};

// Opens the editor (a new recipe by default), the first row's name box and the spies on the suppliers source.
async function open(path: string, { ingredients = [], recipes = [], session, entries, suppliers = fakeSuppliersSource(), lang }: Seed = {}) {
  const source = fakeRecipesSource({ ingredients, recipes });
  // NO MONEY: every watch and every read of the suppliers source is a spy.
  const spies = (['watchSuppliers', 'watchIngredients', 'watchPrices', 'watchOrdersConfig', 'readPrice', 'readPriceHistory'] as const)
    .map(name => {
      const original = suppliers[name].bind(suppliers) as (...args: unknown[]) => unknown;
      const spy = vi.fn(original);
      Object.assign(suppliers, { [name]: spy });
      return spy;
    });
  const view = renderRecipes(path, {
    source,
    session,
    ...(lang ? { lang } : {}),
    data: { suppliers: () => suppliers },
    ...(entries ? { entries: entries.map(entry => ({ pathname: entry })) } : {}),
  });
  const region = await screen.findByRole('region', { name: path.endsWith('/new') ? (lang === 'it' ? 'Nuova ricetta' : 'New recipe') : 'Edit recipe' }, LOAD);
  return { ...view, source, suppliers, spies, region };
}

async function typeInto(view: Awaited<ReturnType<typeof open>>, text: string, index = 0) {
  await view.user.type(ingredientBoxes(view.region)[index]!, text);
}

async function openCard(view: Awaited<ReturnType<typeof open>>, text = 'Rye flour') {
  await typeInto(view, text);
  await view.user.click(screen.getByRole('option', { name: `+ Add «${text}» as an ingredient` }));
  return cardRegion();
}

const discardQuestion = () => screen.findByRole('alertdialog', { name: 'Discard changes?' });

describe('the door in the suggestions', () => {
  it('is the last row, after «See all», and can be the only row', async () => {
    const view = await open('/recipes/new', { ingredients: [CAPUTO, ...BUTTERS] });
    await typeInto(view, 'bu');
    expect(optionTexts()).toHaveLength(7);
    expect(optionTexts().at(-2)).toBe('See all (7)');
    expect(optionTexts().at(-1)).toBe('+ Add «bu» as an ingredient');
    await view.user.clear(ingredientBoxes(view.region)[0]!);
    await view.user.type(ingredientBoxes(view.region)[0]!, 'Rye flour');
    expect(optionTexts()).toEqual([CREATE]);
  });

  it('says it in Italian', async () => {
    const view = await open('/recipes/new', { lang: 'it' });
    await view.user.type(within(view.region).getAllByRole('combobox')[0]!, 'Farina di segale');
    expect(await screen.findByRole('option', { name: '+ Crea «Farina di segale» come ingrediente' })).toBeInTheDocument();
  });

  it('⚠️ is absent for an employee whose venue hides the suppliers card from staff', async () => {
    const view = await open('/recipes/new', { session: { ...EMPLOYEE, location: { staffHiddenCards: { suppliers: true } } } });
    await typeInto(view, 'Rye flour');
    expect(optionTexts()).toEqual([]);
  });

  it('⚠️ is present for an employee when the card is not hidden', async () => {
    const view = await open('/recipes/new', { session: EMPLOYEE });
    await typeInto(view, 'Rye flour');
    expect(optionTexts()).toEqual([CREATE]);
  });

  it('⚠️ is absent when the venue has the Orders section off', async () => {
    const view = await open('/recipes/new', { session: { location: { sections: { orders: false } } } });
    await typeInto(view, 'Rye flour');
    expect(optionTexts()).toEqual([]);
  });

  it('is absent for blank typing, and for a name the records already hold (name or name to show)', async () => {
    const view = await open('/recipes/new', { ingredients: [CAPUTO] });
    await typeInto(view, '   ');
    expect(optionTexts()).toEqual([]);
    for (const taken of ['caputo', 'Farina 00 Caputo']) {
      await view.user.clear(ingredientBoxes(view.region)[0]!);
      await view.user.type(ingredientBoxes(view.region)[0]!, taken);
      expect(optionTexts().filter(text => text?.startsWith('+ Add'))).toEqual([]);
    }
  });

  it('is present when the only match is switched off, or is packaging', async () => {
    const view = await open('/recipes/new', {
      ingredients: [{ id: 'off', name: 'Rye flour', active: false }, { id: 'box', name: 'Rye flour', kind: 'packaging' }],
    });
    await typeInto(view, 'Rye flour');
    expect(optionTexts()).toEqual([CREATE]);
  });
});

describe('the door in the chooser', () => {
  const chooser = async (view: Awaited<ReturnType<typeof open>>) => {
    await view.user.click(within(view.region).getByRole('button', { name: /Link to an ingredient/ }));
    return within(await screen.findByRole('dialog', { name: 'Link to' }));
  };

  it('is the last thing in the list, after the empty sentence', async () => {
    const view = await open('/recipes/new', { ingredients: [CAPUTO] });
    const dialog = await chooser(view);
    expect(dialog.queryByRole('button', { name: /^\+ Add/ })).not.toBeInTheDocument();
    await view.user.type(dialog.getByRole('searchbox'), 'Rye flour');
    const empty = dialog.getByText('Nothing matches your search.');
    const door = dialog.getByRole('button', { name: CREATE });
    expect(empty.compareDocumentPosition(door) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is absent for a name the records hold, and for blank typing', async () => {
    const view = await open('/recipes/new', { ingredients: [CAPUTO] });
    const dialog = await chooser(view);
    await view.user.type(dialog.getByRole('searchbox'), 'caputo');
    expect(dialog.queryByRole('button', { name: /^\+ Add/ })).not.toBeInTheDocument();
  });

  it('closes the chooser first and opens the card with the name filled in', async () => {
    const view = await open('/recipes/new', { ingredients: [CAPUTO] });
    const dialog = await chooser(view);
    await view.user.type(dialog.getByRole('searchbox'), 'Rye flour');
    await view.user.click(dialog.getByRole('button', { name: CREATE }));
    const region = await cardRegion();
    expect(screen.queryByRole('dialog', { name: 'Link to' })).not.toBeInTheDocument();
    expect(region.getByRole('textbox', { name: 'Name in the message' })).toHaveValue('Rye flour');
  });
});

describe('the card', () => {
  it('opens above the editor with the name filled in and no kind choice', async () => {
    const view = await open('/recipes/new');
    const region = await openCard(view);
    expect(await card()).toBeInTheDocument();
    expect(region.getByRole('textbox', { name: 'Name in the message' })).toHaveValue('Rye flour');
    expect(region.queryByRole('combobox', { name: /type|kind/i })).not.toBeInTheDocument();
    expect(region.queryByRole('button', { name: /photo/i })).not.toBeInTheDocument();
    // The cursor starts on the card's title, as when the same card opens on its own screen.
    await waitFor(() => { expect(region.getByRole('heading', { name: 'New ingredient' })).toHaveFocus(); });
  });

  it('⚠️ has no price section for an employee', async () => {
    const employee = await open('/recipes/new', { session: EMPLOYEE });
    expect((await openCard(employee)).queryByRole('combobox', { name: 'How it is bought' })).not.toBeInTheDocument();
  });

  it('⚠️ no price section for a manager with Food cost off', async () => {
    const view = await open('/recipes/new', { session: { ...MANAGER, location: { sections: { foodcost: false } } } });
    expect((await openCard(view)).queryByRole('combobox', { name: 'How it is bought' })).not.toBeInTheDocument();
  });

  it('draws the price section for a manager with Food cost on', async () => {
    const view = await open('/recipes/new', { session: { ...MANAGER, location: { sections: { foodcost: true } } } });
    expect((await openCard(view)).getByRole('combobox', { name: 'How it is bought' })).toBeInTheDocument();
  });
});

describe('Back with the card open', () => {
  async function typedRecipe() {
    const view = await open('/recipes/new', { ingredients: [CAPUTO] });
    await view.user.type(within(view.region).getByRole('textbox', { name: 'Recipe name' }), 'Rye bread');
    await view.user.type(amountBoxes(view.region)[0]!, '300');
    // The name last: the suggestions stay open only while the name box has the focus.
    await view.user.type(ingredientBoxes(view.region)[0]!, 'Rye flour');
    return view;
  }

  it('⚠️ with nothing typed in the card asks nothing, writes nothing, leaves the editor as it was and focuses the name box', async () => {
    const view = await typedRecipe();
    await view.user.click(screen.getByRole('option', { name: CREATE }));
    const region = await cardRegion();
    await view.user.click(region.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New ingredient' })).not.toBeInTheDocument(); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(view.suppliers.writes).toEqual([]);
    expect(view.source.recipeWrites).toEqual([]);
    expect(within(view.region).getByRole('textbox', { name: 'Recipe name' })).toHaveValue('Rye bread');
    expect(ingredientBoxes(view.region)[0]).toHaveValue('Rye flour');
    expect(amountBoxes(view.region)[0]).toHaveValue(300);
    expect(isBusy()).toBe(true);
    await waitFor(() => { expect(ingredientBoxes(view.region)[0]).toHaveFocus(); });
  });

  it('opened from the chooser, Back puts the focus on the row’s link line', async () => {
    const view = await open('/recipes/new', { ingredients: [CAPUTO] });
    const link = within(view.region).getByRole('button', { name: /Link to an ingredient/ });
    await view.user.click(link);
    const dialog = within(await screen.findByRole('dialog', { name: 'Link to' }));
    await view.user.type(dialog.getByRole('searchbox'), 'Rye flour');
    await view.user.click(dialog.getByRole('button', { name: CREATE }));
    await view.user.click((await cardRegion()).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New ingredient' })).not.toBeInTheDocument(); });
    await waitFor(() => { expect(within(view.region).getByRole('button', { name: /Link to an ingredient/ })).toHaveFocus(); });
  });

  it('⚠️ after typing in the card it asks: Cancel keeps the typing, Discard writes nothing', async () => {
    const view = await typedRecipe();
    await view.user.click(screen.getByRole('option', { name: CREATE }));
    const region = await cardRegion();
    await view.user.type(region.getByRole('textbox', { name: 'Brand' }), 'X');
    await view.user.click(region.getByRole('button', { name: 'Back' }));
    await view.user.click(within(await discardQuestion()).getByRole('button', { name: 'Cancel' }));
    expect(region.getByRole('textbox', { name: 'Brand' })).toHaveValue('X');
    await view.user.click(region.getByRole('button', { name: 'Back' }));
    await view.user.click(within(await discardQuestion()).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New ingredient' })).not.toBeInTheDocument(); });
    expect(view.suppliers.writes).toEqual([]);
    expect(view.source.recipeWrites).toEqual([]);
    expect(ingredientBoxes(view.region)[0]).toHaveValue('Rye flour');
  });

  it('⚠️ the browser’s Back with nothing typed in the card closes only the card, in silence', async () => {
    const view = await open('/recipes/new', { ingredients: [CAPUTO], entries: ['/recipes', '/recipes/new'] });
    await typeInto(view, 'Rye flour');
    await view.user.click(screen.getByRole('option', { name: CREATE }));
    await cardRegion();
    await act(async () => { await view.router.navigate(-1); });
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New ingredient' })).not.toBeInTheDocument(); });
    expect(view.router.state.location.pathname).toBe('/recipes/new');
    await waitFor(() => { expect(ingredientBoxes(view.region)[0]).toHaveValue('Rye flour'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('⚠️ the browser’s Back with typing in the card asks, and the editor stays', async () => {
    const view = await open('/recipes/new', { ingredients: [CAPUTO], entries: ['/recipes', '/recipes/new'] });
    const region = await openCard(view);
    await view.user.type(region.getByRole('textbox', { name: 'Brand' }), 'X');
    await act(async () => { await view.router.navigate(-1); });
    await view.user.click(within(await discardQuestion()).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New ingredient' })).not.toBeInTheDocument(); });
    expect(view.router.state.location.pathname).toBe('/recipes/new');
    expect(screen.getByRole('region', { name: 'New recipe' })).toBeInTheDocument();
  });
});

describe('Save in the card', () => {
  async function saveCard(view: Awaited<ReturnType<typeof open>>, region: ReturnType<typeof within>) {
    await view.user.click(region.getByRole('button', { name: 'Save' }));
    await view.user.click(within(await screen.findByRole('alertdialog', { name: 'Save ingredient?' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New ingredient' })).not.toBeInTheDocument(); });
  }

  async function startRecipe(options: Seed = {}) {
    const view = await open('/recipes/new', { ingredients: [CAPUTO], ...options });
    await view.user.type(within(view.region).getByRole('textbox', { name: 'Recipe name' }), 'Rye bread');
    return view;
  }

  it('⚠️ writes one ingredient, links the row to it when the recipe is saved, names the row, says so and focuses the amount', async () => {
    const view = await startRecipe();
    const region = await openCard(view);
    await view.user.type(region.getByRole('textbox', { name: 'Name in lists' }), 'Rye');
    await saveCard(view, region);
    const writes = view.suppliers.writes.filter(write => write.op === 'ingredient-save');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ data: { name: 'Rye flour', shortName: 'Rye' } });
    // Nothing has been written to the recipe yet.
    expect(view.source.recipeWrites).toEqual([]);
    expect(ingredientBoxes(view.region)[0]).toHaveValue('Rye');
    await waitFor(() => { expect(amountBoxes(view.region)[0]).toHaveFocus(); });
    expect(screen.getByText('Ingredient saved.').closest('[role="status"]')).not.toBeNull();

    await view.user.type(amountBoxes(view.region)[0]!, '300');
    await view.user.click(within(view.region).getByRole('button', { name: 'Save' }));
    await view.user.click(within(await screen.findByRole('alertdialog', { name: 'Save recipe?' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(view.source.recipeWrites).toHaveLength(1); });
    const row = (view.source.recipeWrites[0]!.data!.ingredients as Record<string, unknown>[])[0]!;
    expect(linkOf(row)).toMatchObject({ kind: 'ingredient', refId: writes[0]!.id });
    expect(row.label).toBe('Rye');
  });

  it('⚠️ for a price writer the price and its history go in the same batch', async () => {
    const view = await startRecipe({ session: { ...MANAGER, location: { sections: { foodcost: true } } } });
    const region = await openCard(view);
    await view.user.selectOptions(region.getByRole('combobox', { name: 'How it is bought' }), 'kg');
    await view.user.type(region.getByRole('textbox', { name: /^Price per kg/ }), '2.5');
    await saveCard(view, region);
    const write = view.suppliers.writes.find(entry => entry.op === 'ingredient-save');
    expect(write).toMatchObject({ price: { doc: { pricePerUnit: 2.5 }, history: { pricePerUnit: 2.5 } } });
  });

  it('⚠️ for an employee no price is written at all', async () => {
    const view = await startRecipe({ session: EMPLOYEE });
    const region = await openCard(view);
    await saveCard(view, region);
    const write = view.suppliers.writes.find(entry => entry.op === 'ingredient-save');
    expect(write).toMatchObject({ price: null });
    if (write?.op !== 'ingredient-save') throw new Error('no save');
    expect(Object.entries(write.data).filter(([key, value]) => /price|vat/i.test(key) && value !== null)).toEqual([]);
  });

  it('«+ New supplier…» inside the card writes one supplier, and the saved ingredient carries its id', async () => {
    const view = await startRecipe();
    const region = await openCard(view);
    await view.user.selectOptions(region.getByRole('combobox', { name: 'Supplier' }), '+ New supplier…');
    const dialog = within(await screen.findByRole('dialog', { name: 'New supplier' }));
    await view.user.type(dialog.getByRole('textbox', { name: 'Name on invoices' }), 'Latteria Rossi');
    await view.user.click(dialog.getByRole('button', { name: 'Save' }));
    await view.user.click(within(await screen.findByRole('alertdialog', { name: 'Save supplier?' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New supplier' })).not.toBeInTheDocument(); });
    expect(view.suppliers.writes.filter(write => write.op === 'save')).toHaveLength(1);
    const made = [...view.suppliers.suppliers.keys()][0];
    await saveCard(view, region);
    expect(view.suppliers.writes.find(write => write.op === 'ingredient-save')).toMatchObject({ data: { supplierId: made } });
  });

  it('⚠️ a save the database refuses later is said, and the row stays linked', async () => {
    const suppliers = fakeSuppliersSource();
    suppliers.refuseWrites.ingredientSave = true;
    const view = await startRecipe({ suppliers });
    const region = await openCard(view);
    await saveCard(view, region);
    await screen.findByText('Could not save “Rye flour”. Check your network and try again.');
    expect(ingredientBoxes(view.region)[0]).toHaveValue('Rye flour');
    // Still linked to the id it was saved under: Save recipe writes the link.
    const madeId = suppliers.writes.find(write => write.op === 'ingredient-save')!.id;
    await view.user.type(amountBoxes(view.region)[0]!, '300');
    await view.user.click(within(view.region).getByRole('button', { name: 'Save' }));
    await view.user.click(within(await screen.findByRole('alertdialog', { name: 'Save recipe?' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(view.source.recipeWrites).toHaveLength(1); });
    const row = (view.source.recipeWrites[0]!.data!.ingredients as Record<string, unknown>[])[0]!;
    expect(linkOf(row)).toMatchObject({ kind: 'ingredient', refId: madeId });
  });

  it('⚠️ a message said while the card is open is in the accessibility tree and above it', async () => {
    const view = await startRecipe();
    const region = await openCard(view);
    await view.user.selectOptions(region.getByRole('combobox', { name: 'Supplier' }), '+ New supplier…');
    const dialog = within(await screen.findByRole('dialog', { name: 'New supplier' }));
    await view.user.type(dialog.getByRole('textbox', { name: 'Name on invoices' }), 'Latteria Rossi');
    await view.user.click(dialog.getByRole('button', { name: 'Save' }));
    await view.user.click(within(await screen.findByRole('alertdialog', { name: 'Save supplier?' })).getByRole('button', { name: 'Save' }));
    const said = await screen.findByText('Supplier saved.');
    expect(said.closest('[aria-hidden="true"]')).toBeNull();
    expect(said.closest('[role="status"]')).toHaveAttribute('data-react-aria-top-layer');
  });
});

describe('a card that cannot be drawn', () => {
  it('⚠️ is closed and said, the editor keeps its typed rows, and moving on works afterwards', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = await open('/recipes/new', { entries: ['/recipes', '/recipes/new'] });
    await view.user.type(within(view.region).getByRole('textbox', { name: 'Recipe name' }), 'Rye bread');
    await view.user.type(amountBoxes(view.region)[0]!, '300');
    await view.user.type(ingredientBoxes(view.region)[0]!, 'Rye flour');
    boom.on = true;
    await view.user.click(screen.getByRole('option', { name: CREATE }));
    await screen.findByText('The ingredient card could not be opened. Please try again.');
    boom.on = false;
    errors.mockRestore();
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New ingredient' })).not.toBeInTheDocument(); });
    expect(screen.queryByText('This part didn’t load.')).not.toBeInTheDocument();
    expect(within(view.region).getByRole('textbox', { name: 'Recipe name' })).toHaveValue('Rye bread');
    expect(ingredientBoxes(view.region)[0]).toHaveValue('Rye flour');
    expect(amountBoxes(view.region)[0]).toHaveValue(300);
    // Nothing is blocked as «a card is open» any more: a move asks the editor's own question, as for any unsaved recipe.
    act(() => { void view.router.navigate(-1); });
    expect(await discardQuestion()).toBeInTheDocument();
  });

  it('the card can be opened and backed out of again and again', async () => {
    const view = await open('/recipes/new', { entries: ['/recipes', '/recipes/new'] });
    await typeInto(view, 'Rye flour');
    for (let round = 0; round < 2; round += 1) {
      await view.user.click(screen.getByRole('option', { name: /^[+] Add «Rye flou/ }));
      await cardRegion();
      await act(async () => { await view.router.navigate(-1); });
      await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New ingredient' })).not.toBeInTheDocument(); });
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      await waitFor(() => { expect(ingredientBoxes(view.region)[0]).toHaveFocus(); });
      await view.user.type(ingredientBoxes(view.region)[0]!, '{Backspace}x');
    }
  });
});

describe('an editor opened early', () => {
  it('⚠️ is not rebuilt by the server’s first answer while the card is open', async () => {
    window.localStorage.setItem(RECIPES_KEY, JSON.stringify([
      { id: 'r1', name: 'Focaccia', ingredients: [{ label: 'Rye flour', grams: 1000, unit: 'g' }], lossPct: 0 },
    ]));
    const source = fakeRecipesSource({ recipes: [recipe('r1', { name: 'Focaccia (server)', ingredients: [{ label: 'Rye flour', grams: 1000, unit: 'g' }] })] });
    source.hold();
    const { user } = renderRecipes('/recipes/r1/edit', { source });
    const region = await screen.findByRole('region', { name: 'Edit recipe' }, LOAD);
    // Opening the card through the chooser types nothing into the editor itself.
    await user.click(within(region).getByRole('button', { name: /Link to an ingredient/ }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Link to' }));
    await user.type(dialog.getByRole('searchbox'), 'Rye flour');
    await user.click(dialog.getByRole('button', { name: CREATE }));
    await cardRegion();
    act(() => { source.release(); });
    await new Promise<void>(resolve => { setTimeout(resolve, 150); });
    expect(screen.getByRole('dialog', { name: 'New ingredient' })).toBeInTheDocument();
    // The editor is under the modal, so out of the accessibility tree: asked for with `hidden`.
    expect(within(screen.getByRole('region', { name: 'Edit recipe', hidden: true })).getByRole('textbox', { name: 'Recipe name', hidden: true })).toHaveValue('Focaccia');
  });
});

describe('no money', () => {
  it('⚠️ opening the card and saving read no price, no history and watch nothing of the suppliers source', async () => {
    const view = await open('/recipes/new', { session: { ...MANAGER, location: { sections: { foodcost: true } } } });
    const region = await openCard(view);
    await view.user.click(region.getByRole('button', { name: 'Save' }));
    await view.user.click(within(await screen.findByRole('alertdialog', { name: 'Save ingredient?' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(view.suppliers.writes.some(write => write.op === 'ingredient-save')).toBe(true); });
    for (const spy of view.spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('the one import from suppliers/', () => {
  it('⚠️ no file under recipes/ imports ../suppliers/ except CreateIngredientOverlay', () => {
    const here = __dirname;
    const offenders: string[] = [];
    const allowed: string[] = [];
    // Every file under recipes/ (folders too): a static import, an import() and a bare '../suppliers', with either quote.
    for (const file of readdirSync(here, { recursive: true, encoding: 'utf8' })) {
      if (!/\.tsx?$/.test(file) || /\.spec\./.test(file)) continue;
      const source = readFileSync(join(here, file), 'utf8');
      for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"](\.\.\/suppliers[^'"]*)['"]/g)) {
        if (match[1] === '../suppliers/CreateIngredientOverlay') allowed.push(file);
        else offenders.push(`${file}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
    // The guard finds the two imports that exist (the editor's overlay, the section's provider), so it is not blind.
    expect(allowed.sort()).toEqual(['RecipeEditor.tsx', 'RecipesSection.tsx']);
  });
});
