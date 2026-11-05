import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, recipe, renderRecipes } from '../testing/renderRecipes';

// Step 3d-6, slice A2: linking a recipe row — the suggestion list under the name while it is typed, the link line under the
// row, and the full chooser. The matching itself (suggestLinks, linkOptions) is tested in shared/; the pure line texts in
// linkModel.spec.ts and the write in editorModel.spec.ts. This is the screen: what is drawn, what a tap does, where the focus goes.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const FOCACCIA = recipe('r1', { name: 'Focaccia', ingredients: [{ label: 'Flour', grams: 1000, unit: 'g' }] });
const FARINATA = recipe('r2', { name: 'Farinata', ingredients: [{ label: 'Chickpea flour', grams: 300, unit: 'g' }] });
const FLOUR = { id: 'ing-flour', name: 'Farina 00 Caputo', shortName: 'Caputo', weight: '25 kg', supplierId: 'sup-1', pricePerUnit: 1.23, priceUnit: 'kg' };
const SUPPLIERS = [{ id: 'sup-1', name: 'Molino Rossi Srl', shortName: 'Rossi' }];
// The text has two spaces round each dot; a button’s accessible name collapses them.
const LINE_CAPUTO = '→ Caputo  ·  25 kg  ·  Rossi';
const NAMED = (text: string) => text.replace(/\s+/g, ' ');

const ingredientBoxes = (region: HTMLElement) => within(region).getAllByRole('combobox', { name: 'Ingredient name' }) as HTMLInputElement[];
const amountBoxes = (region: HTMLElement) => within(region).queryAllByRole('spinbutton', { name: 'Amount' }) as HTMLInputElement[];
// The unit menus have options too: only the suggestion list's own.
const options = () => {
  const list = screen.queryByRole('listbox', { name: 'Catalogue ingredients to link' });
  return list ? within(list).getAllByRole('option') : [];
};
const optionTexts = () => options().map(node => node.textContent);

async function openEditor(path: string, seed: Parameters<typeof fakeRecipesSource>[0], lang: 'en' | 'it' = 'en') {
  const source = fakeRecipesSource(seed);
  const view = renderRecipes(path, { source, lang });
  const isNew = path.endsWith('/new');
  const name = isNew ? (lang === 'it' ? 'Nuova ricetta' : 'New recipe') : 'Edit recipe';
  const region = await screen.findByRole('region', { name }, LOAD);
  return { ...view, region };
}

const BUTTERS = Array.from({ length: 7 }, (_, index) => ({ id: `ing-b${index}`, name: `Burro ${index + 1}`, weight: '1 kg' }));

describe('the suggestion list under a row’s name', () => {
  it('offers nothing below two characters, then at most five, ingredients before recipes, and says so when there are more', async () => {
    const { region, user } = await openEditor('/recipes/new', { recipes: [FARINATA], ingredients: [FLOUR, ...BUTTERS], suppliers: SUPPLIERS });
    const name = ingredientBoxes(region)[0]!;
    await user.type(name, 'f');
    // Below two characters there is no matching; only the «+ Add …» door (T15, every record-writer sees it) is offered.
    expect(optionTexts()).toEqual(['+ Add «f» as an ingredient']);
    await user.type(name, 'ari');
    expect(screen.getByRole('listbox', { name: 'Catalogue ingredients to link' })).toBeInTheDocument();
    // Ingredient first (name, pack weight and supplier — no price), then the recipe.
    expect(optionTexts()).toEqual(['Caputo 25 kg  ·  Rossi', 'Farinata Recipe', '+ Add «fari» as an ingredient']);
    await user.clear(name);
    await user.type(name, 'bu');
    expect(options()).toHaveLength(7);
    expect(optionTexts().at(-2)).toBe('See all (7)');
  });

  it('⚠️ never offers the recipe itself, a switched-off ingredient or packaging', async () => {
    const off = { id: 'ing-off', name: 'Farina vecchia', active: false };
    const box = { id: 'ing-box', name: 'Farina sacco', kind: 'packaging' };
    const { region, user } = await openEditor('/recipes/r1/edit', { recipes: [FOCACCIA, FARINATA], ingredients: [FLOUR, off, box], suppliers: SUPPLIERS });
    await user.clear(ingredientBoxes(region)[0]!);
    await user.type(ingredientBoxes(region)[0]!, 'fa');
    expect(optionTexts()).toEqual(['Caputo 25 kg  ·  Rossi', 'Farinata Recipe', '+ Add «fa» as an ingredient']);
    await user.clear(ingredientBoxes(region)[0]!);
    await user.type(ingredientBoxes(region)[0]!, 'foc');
    expect(optionTexts()).toEqual(['+ Add «foc» as an ingredient']);
  });

  it('is a combobox with a listbox, and the name box leaves the browser’s own list out', async () => {
    const { region, user } = await openEditor('/recipes/new', { ingredients: [FLOUR], suppliers: SUPPLIERS });
    const name = ingredientBoxes(region)[0]!;
    expect(name).toHaveAttribute('autocomplete', 'off');
    expect(name).toHaveAttribute('aria-expanded', 'false');
    await user.type(name, 'cap');
    expect(name).toHaveAttribute('aria-expanded', 'true');
    expect(name).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
  });

  it('⚠️ a tap links the row, renames it after the item, moves on to the amount and writes kind, refId and the row id on save', async () => {
    const { region, user, source } = await openEditor('/recipes/r1/edit', { recipes: [FOCACCIA], ingredients: [FLOUR], suppliers: SUPPLIERS });
    const name = ingredientBoxes(region)[0]!;
    await user.clear(name);
    await user.type(name, 'farina');
    await user.click(options()[0]!);
    expect(name).toHaveValue('Caputo');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(within(region).getByRole('button', { name: NAMED(LINE_CAPUTO) })).toBeInTheDocument();
    await waitFor(() => { expect(amountBoxes(region)[0]).toHaveFocus(); });

    await user.click(within(region).getByRole('button', { name: 'Save' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Save recipe?' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites[0]?.data?.ingredients).toEqual([
      { label: 'Caputo', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'ing-flour', rid: expect.any(String) },
    ]);
  });

  it('does not move the focus to an amount that is not drawn («to taste»)', async () => {
    const { region, user } = await openEditor('/recipes/new', { ingredients: [FLOUR], suppliers: SUPPLIERS });
    await user.selectOptions(within(region).getByRole('combobox', { name: 'Unit' }), 'to taste');
    await user.type(ingredientBoxes(region)[0]!, 'cap');
    await user.click(options()[0]!);
    expect(ingredientBoxes(region)[0]).toHaveValue('Caputo');
    expect(amountBoxes(region)).toHaveLength(0);
  });

  it('picks with Enter on a row highlighted with the arrows, and never by itself', async () => {
    const { region, user } = await openEditor('/recipes/new', { recipes: [FARINATA], ingredients: [FLOUR], suppliers: SUPPLIERS });
    const name = ingredientBoxes(region)[0]!;
    await user.type(name, 'fari');
    await user.keyboard('{Enter}');
    // Nothing highlighted: Enter chooses nothing.
    expect(name).toHaveValue('fari');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(options()[1]).toHaveAttribute('aria-selected', 'true');
    expect(name).toHaveAttribute('aria-activedescendant', options()[1]!.id);
    await user.keyboard('{Enter}');
    expect(name).toHaveValue('Farinata');
    expect(within(region).getByRole('button', { name: '→ Farinata · Recipe' })).toBeInTheDocument();
  });

  it('closes on Escape without picking, and ticks the current link', async () => {
    const linked = recipe('r1', { name: 'Focaccia', ingredients: [{ label: 'Cap', grams: 10, unit: 'g', kind: 'ingredient', refId: 'ing-flour' }] });
    const { region, user } = await openEditor('/recipes/r1/edit', { recipes: [linked], ingredients: [FLOUR], suppliers: SUPPLIERS });
    const name = ingredientBoxes(region)[0]!;
    await user.type(name, 'u');
    expect(options()[0]).toHaveTextContent('linked');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(name).toHaveValue('Capu');
  });
});

describe('the full chooser', () => {
  it('«See all (n)» opens it already searching what was typed', async () => {
    const { region, user } = await openEditor('/recipes/new', { ingredients: BUTTERS });
    await user.type(ingredientBoxes(region)[0]!, 'bur');
    // «See all» is the second to last: the «+ Add …» door is the last row.
    await user.click(options().at(-2)!);
    const dialog = await screen.findByRole('dialog', { name: 'Link to' });
    expect(within(dialog).getByRole('searchbox', { name: 'Search an ingredient' })).toHaveValue('bur');
    expect(within(dialog).getAllByRole('button', { name: /^Burro/ })).toHaveLength(7);
  });

  it('lists ingredients (name · weight · supplier) then recipes, without «Remove the link» when the row has none, and picks', async () => {
    const { region, user } = await openEditor('/recipes/r1/edit', { recipes: [FOCACCIA, FARINATA], ingredients: [FLOUR], suppliers: SUPPLIERS });
    await user.click(within(region).getByRole('button', { name: '+ Link to an ingredient' }));
    const dialog = await screen.findByRole('dialog', { name: 'Link to' });
    expect(within(dialog).queryByRole('button', { name: 'Remove the link' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Ingredients' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Recipes' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Caputo 25 kg · Rossi' })).toBeInTheDocument();
    // The recipe itself is not offered.
    expect(within(dialog).queryByRole('button', { name: /^Focaccia/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Farinata Recipe' })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Farinata Recipe' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(ingredientBoxes(region)[0]).toHaveValue('Farinata');
    expect(within(region).getByRole('button', { name: '→ Farinata · Recipe' })).toBeInTheDocument();
    await waitFor(() => { expect(amountBoxes(region)[0]).toHaveFocus(); });
  });

  it('⚠️ removes the link (and keeps the name) only when asked, and dismissing changes NOTHING', async () => {
    const linked = recipe('r1', { name: 'Focaccia', ingredients: [{ label: 'My flour', grams: 10, unit: 'g', kind: 'ingredient', refId: 'ing-flour' }] });
    const { region, user } = await openEditor('/recipes/r1/edit', { recipes: [linked], ingredients: [FLOUR], suppliers: SUPPLIERS });
    const line = () => within(region).getByRole('button', { name: NAMED(LINE_CAPUTO) });

    // Escape: nothing changes, the focus goes back to the button that opened it.
    await user.click(line());
    await screen.findByRole('dialog', { name: 'Link to' });
    await user.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    await waitFor(() => { expect(line()).toHaveFocus(); });
    expect(ingredientBoxes(region)[0]).toHaveValue('My flour');

    // Back: the same.
    await user.click(line());
    await user.click(within(await screen.findByRole('dialog', { name: 'Link to' })).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(line()).toBeInTheDocument();
    expect(ingredientBoxes(region)[0]).toHaveValue('My flour');

    // Remove.
    await user.click(line());
    await user.click(within(await screen.findByRole('dialog', { name: 'Link to' })).getByRole('button', { name: 'Remove the link' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(within(region).getByRole('button', { name: '+ Link to an ingredient' })).toBeInTheDocument();
    expect(ingredientBoxes(region)[0]).toHaveValue('My flour');
  });

  it('⚠️ choosing the link the row already has never undoes a name typed since', async () => {
    const linked = recipe('r1', { name: 'Focaccia', ingredients: [{ label: 'My flour', grams: 10, unit: 'g', kind: 'ingredient', refId: 'ing-flour' }] });
    const { region, user } = await openEditor('/recipes/r1/edit', { recipes: [linked], ingredients: [FLOUR], suppliers: SUPPLIERS });
    await user.click(within(region).getByRole('button', { name: NAMED(LINE_CAPUTO) }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Link to' })).getByRole('button', { name: 'Caputo 25 kg · Rossi' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(ingredientBoxes(region)[0]).toHaveValue('My flour');
  });

  it('says why it is empty: nothing matches, or there are no ingredients yet', async () => {
    const { region, user } = await openEditor('/recipes/new', { ingredients: [] });
    await user.click(within(region).getByRole('button', { name: '+ Link to an ingredient' }));
    const dialog = await screen.findByRole('dialog', { name: 'Link to' });
    expect(within(dialog).getByText('No ingredients yet — add them in Orders, under Settings.')).toBeInTheDocument();
    await user.type(within(dialog).getByRole('searchbox'), 'zzz');
    expect(within(dialog).getByText('Nothing matches your search.')).toBeInTheDocument();
  });
});

describe('the link line', () => {
  it('says what a missing target is, and has no price even when the ingredient carries one', async () => {
    const rows = [
      { label: 'A', grams: 1, unit: 'g', kind: 'ingredient', refId: 'ing-flour' },
      { label: 'B', grams: 1, unit: 'g', kind: 'ingredient', refId: 'gone' },
      { label: 'C', grams: 1, unit: 'g', kind: 'recipe', refId: 'gone' },
      { label: 'D', grams: 1, unit: 'g', kind: 'recipe', refId: 'r2' },
      { label: 'E', grams: 1, unit: 'g' },
    ];
    const { region } = await openEditor('/recipes/r1/edit', {
      recipes: [recipe('r1', { name: 'Focaccia', ingredients: rows }), FARINATA], ingredients: [FLOUR], suppliers: SUPPLIERS,
    });
    const lines = () => within(region).getAllByRole('button', { name: /^(→|\+ Link)/ }).map(node => node.textContent);
    await waitFor(() => { expect(lines()).toContain(LINE_CAPUTO); });
    expect(lines()).toEqual([
      LINE_CAPUTO,
      '→ an ingredient that no longer exists',
      '→ a recipe that no longer exists',
      '→ Farinata  ·  Recipe',
      '+ Link to an ingredient',
    ]);
    expect(region.textContent).not.toMatch(/£|€|1\.23/);
  });

  it('is in Italian on an Italian screen', async () => {
    const { region } = await openEditor('/recipes/new', { ingredients: [FLOUR] }, 'it');
    expect(within(region).getByRole('button', { name: '+ Collega a un ingrediente' })).toBeInTheDocument();
  });
});
