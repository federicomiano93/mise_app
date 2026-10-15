import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, recipe, renderRecipes, sourceWith, split } from '../testing/renderRecipes';

// Step 3d-6, slice A1: writing recipes — the button above the list, «Edit» on a recipe, the editor (a working copy, the
// rows, the total, the label fields, the checks, Save with its question, the leave guard). Deleting is in
// RecipesSection.delete.spec.tsx. The pure rules: editorModel.spec.ts.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const EMPLOYEE = { role: 'staff' as const, canManage: false, isOwner: false };
const FOCACCIA = recipe('r1', { name: 'Focaccia' });

const nameBox = (region: HTMLElement) => within(region).getByRole('textbox', { name: 'Recipe name' }) as HTMLInputElement;
const ingredientBoxes = (region: HTMLElement) => within(region).getAllByRole('combobox', { name: 'Ingredient name' }) as HTMLInputElement[];
const amountBoxes = (region: HTMLElement) => within(region).queryAllByRole('spinbutton', { name: 'Amount' }) as HTMLInputElement[];
const units = (region: HTMLElement) => within(region).getAllByRole('combobox', { name: 'Unit' }) as HTMLSelectElement[];
const saveButton = (region: HTMLElement) => within(region).getByRole('button', { name: 'Save' });
// The words land in the section's live region (the shell has a second one, for the connection).
const says = async (text: string) => {
  const node = await screen.findByText(text);
  expect(node.closest('[role="status"]')).not.toBeNull();
};
const totalLine = (region: HTMLElement) => within(region).getByText('Total').parentElement;

async function openEditor(path: string, options: Parameters<typeof renderRecipes>[1] = {}) {
  const view = renderRecipes(path, { source: sourceWith([FOCACCIA]), ...options });
  const name = path.endsWith('/new') ? 'New recipe' : 'Edit recipe';
  const region = await screen.findByRole('region', { name }, LOAD);
  return { ...view, region };
}

async function answerSave(user: { click: (el: Element) => Promise<void> }, name = 'Save') {
  const dialog = await screen.findByRole('alertdialog', { name: 'Save recipe?' });
  await user.click(within(dialog).getByRole('button', { name }));
}

describe('the button above the list', () => {
  it.each([
    ['an employee', EMPLOYEE],
    ['the owner', { role: 'owner' as const, canManage: true, isOwner: true }],
  ])('is there for %s, and opens the new recipe one level down', async (_who, session) => {
    const { router, user } = renderRecipes('/recipes', { source: sourceWith([FOCACCIA]), session });
    await screen.findByRole('button', { name: 'Focaccia' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'New recipe' }));
    expect(router.state.location.pathname).toBe('/recipes/new');
    expect(await screen.findByRole('heading', { level: 2, name: 'New recipe' })).toBeInTheDocument();
  });

  it('is there also over «No recipes yet»', async () => {
    renderRecipes('/recipes', { source: sourceWith([]) });
    expect(await screen.findByText('No recipes yet', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New recipe' })).toBeInTheDocument();
  });

  it('is the word «Nuova ricetta» in Italian', async () => {
    renderRecipes('/recipes', { source: sourceWith([FOCACCIA]), lang: 'it' });
    expect(await screen.findByRole('button', { name: 'Nuova ricetta' }, LOAD)).toBeInTheDocument();
  });

  it('puts the focus on the editor’s title, and Back hands it back to the button', async () => {
    const { router, user } = renderRecipes('/recipes', { source: sourceWith([FOCACCIA]) });
    await screen.findByRole('button', { name: 'Focaccia' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'New recipe' }));
    const region = await screen.findByRole('region', { name: 'New recipe' });
    await waitFor(() => { expect(within(region).getByRole('heading', { level: 2 })).toHaveFocus(); });
    await user.click(within(region).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'New recipe' })).toHaveFocus(); });
  });

  it('opens the editor in the right-hand pane on the split, the list staying beside it', async () => {
    split();
    const { user } = renderRecipes('/recipes', { source: sourceWith([FOCACCIA]) });
    await screen.findByRole('button', { name: 'Focaccia' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'New recipe' }));
    await screen.findByRole('region', { name: 'New recipe' });
    expect(screen.getByRole('button', { name: 'Focaccia' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New recipe' })).toHaveAttribute('aria-current', 'true');
  });
});

describe('«Edit» on a recipe', () => {
  it.each([
    ['an employee', EMPLOYEE],
    ['the owner', { role: 'owner' as const, canManage: true, isOwner: true }],
  ])('is on the bar for %s and opens the editor with the recipe’s copy', async (_who, session) => {
    const { router, user } = renderRecipes('/recipes/r1', { source: sourceWith([FOCACCIA]), session });
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(router.state.location.pathname).toBe('/recipes/r1/edit');
    const region = await screen.findByRole('region', { name: 'Edit recipe' });
    expect(nameBox(region).value).toBe('Focaccia');
    expect(ingredientBoxes(region).map(box => box.value)).toEqual(['Flour', 'Water', 'Salt']);
    expect(amountBoxes(region).map(box => box.value)).toEqual(['1000', '700', '20']);
    expect(units(region).map(select => select.value)).toEqual(['g', 'g', 'g']);
    expect(totalLine(region)).toHaveTextContent('Total1720g');
  });

  it('says «Modifica» in Italian', async () => {
    renderRecipes('/recipes/r1', { source: sourceWith([FOCACCIA]), lang: 'it' });
    expect(await screen.findByRole('button', { name: 'Modifica' }, LOAD)).toBeInTheDocument();
  });

  it('steps back to the recipe, the focus on «Edit»', async () => {
    const { router, user } = renderRecipes('/recipes/r1', { source: sourceWith([FOCACCIA]) });
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const region = await screen.findByRole('region', { name: 'Edit recipe' });
    await user.click(within(region).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/r1'); });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus(); });
  });

  it('replaces itself with the recipe when opened by its address, with nothing behind it', async () => {
    const { router, user, region } = await openEditor('/recipes/r1/edit');
    await user.click(within(region).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/r1'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('waits for the recipe: «Loading…» while the server has not answered, then the editor', async () => {
    const source = sourceWith([FOCACCIA]);
    source.hold();
    renderRecipes('/recipes/r1/edit', { source });
    expect((await screen.findAllByText('Loading…', undefined, LOAD)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('region', { name: 'Edit recipe' })).not.toBeInTheDocument();
    act(() => { source.release(); });
    expect(await screen.findByRole('region', { name: 'Edit recipe' })).toBeInTheDocument();
  });

  it('says the recipe no longer exists, on the server’s word', async () => {
    renderRecipes('/recipes/nothing/edit', { source: sourceWith([FOCACCIA]) });
    expect(await screen.findByRole('heading', { level: 2, name: 'This recipe no longer exists.' }, LOAD)).toBeInTheDocument();
  });

  it('⚠️ a recipe changed on another phone while it is open does NOT replace the copy being edited', async () => {
    const { user, region, source } = await openEditor('/recipes/r1/edit');
    await user.type(nameBox(region), ' integrale');
    source.recipes.set('r1', recipe('r1', { name: 'Elsewhere' }));
    act(() => { source.push(); });
    await act(async () => { await Promise.resolve(); });
    expect(nameBox(region).value).toBe('Focaccia integrale');
  });
});

describe('a new recipe', () => {
  it('starts EMPTY with placeholders: no name, one empty row in grams, a total of 0', async () => {
    const { region } = await openEditor('/recipes/new');
    expect(nameBox(region).value).toBe('');
    expect(nameBox(region)).toHaveAttribute('placeholder', 'Recipe name');
    expect(ingredientBoxes(region)).toHaveLength(1);
    expect(ingredientBoxes(region)[0]).toHaveAttribute('placeholder', 'Ingredient');
    expect(amountBoxes(region)[0]?.value).toBe('');
    expect(amountBoxes(region)[0]).toHaveAttribute('placeholder', '0');
    expect(units(region)[0]?.value).toBe('g');
    expect(totalLine(region)).toHaveTextContent('Total0g');
    expect(within(region).queryByRole('button', { name: 'Delete recipe' })).not.toBeInTheDocument();
  });

  it('caps the name at 199 characters, the most the rules accept', async () => {
    const { region } = await openEditor('/recipes/new');
    expect(nameBox(region)).toHaveAttribute('maxlength', '199');
  });

  it('offers the 12 units, the words in the interface language', async () => {
    const { region } = await openEditor('/recipes/new');
    expect([...units(region)[0]!.options].map(option => option.text)).toEqual([
      'g', 'kg', 'mg', 'ml', 'cl', 'dl', 'l', 'pcs', 'tsp', 'tbsp', 'pinch', 'to taste',
    ]);
  });

  it('adds a row, counts the rows and empties the last one instead of removing it', async () => {
    const { region, user } = await openEditor('/recipes/new');
    const count = () => within(region).getByRole('heading', { level: 3, name: 'Ingredients' }).nextElementSibling;
    expect(count()).toHaveTextContent('1');
    await user.click(within(region).getByRole('button', { name: '+ Add ingredient' }));
    expect(ingredientBoxes(region)).toHaveLength(2);
    expect(count()).toHaveTextContent('2');
    await user.type(ingredientBoxes(region)[1]!, 'Salt');
    await user.click(within(region).getAllByRole('button', { name: 'Remove ingredient' })[0]!);
    expect(ingredientBoxes(region).map(box => box.value)).toEqual(['Salt']);
    await user.click(within(region).getByRole('button', { name: 'Remove ingredient' }));
    expect(ingredientBoxes(region)).toHaveLength(1);
    expect(ingredientBoxes(region)[0]?.value).toBe('');
  });

  it('adds up the weighable rows live, in whole grams, and says how many are not weighed', async () => {
    const { region, user } = await openEditor('/recipes/new');
    await user.type(ingredientBoxes(region)[0]!, 'Flour');
    await user.type(amountBoxes(region)[0]!, '1.5');
    await user.selectOptions(units(region)[0]!, 'kg');
    expect(totalLine(region)).toHaveTextContent('Total1500g');
    await user.click(within(region).getByRole('button', { name: '+ Add ingredient' }));
    await user.type(ingredientBoxes(region)[1]!, 'Eggs');
    await user.type(amountBoxes(region)[1]!, '3');
    await user.selectOptions(units(region)[1]!, 'pcs');
    expect(totalLine(region)).toHaveTextContent('Total1500g');
    expect(within(region).getByText('1 ingredient is not weighed (pieces / to taste) — not in the total')).toBeInTheDocument();
  });

  it('⚠️ hides the amount of a «to taste» row but gives the number back when the unit changes again', async () => {
    const { region, user } = await openEditor('/recipes/new');
    await user.type(ingredientBoxes(region)[0]!, 'Salt');
    await user.type(amountBoxes(region)[0]!, '12');
    await user.selectOptions(units(region)[0]!, 'to taste');
    expect(amountBoxes(region)).toHaveLength(0);
    await user.selectOptions(units(region)[0]!, 'g');
    expect(amountBoxes(region)[0]?.value).toBe('12');
  });
});

describe('the checks before saving', () => {
  it('⚠️ says the name is missing, marks the box and puts the cursor in it', async () => {
    const { region, user } = await openEditor('/recipes/new');
    await user.click(saveButton(region));
    await says('Please enter a recipe name.');
    expect(nameBox(region)).toHaveAttribute('aria-invalid', 'true');
    expect(nameBox(region)).toHaveFocus();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // Re-checked as it is typed.
    await user.type(nameBox(region), 'P');
    expect(nameBox(region)).not.toHaveAttribute('aria-invalid');
  });

  it('⚠️ says an ingredient with a name is missing, marks the unnamed row and puts the cursor in its name box', async () => {
    const { region, user } = await openEditor('/recipes/new');
    await user.type(nameBox(region), 'Pane');
    await user.click(saveButton(region));
    await says('Add at least one ingredient with a name.');
    expect(ingredientBoxes(region)[0]).toHaveAttribute('aria-invalid', 'true');
    expect(ingredientBoxes(region)[0]).toHaveFocus();
    expect(nameBox(region)).not.toHaveAttribute('aria-invalid');
  });

  it('⚠️ says an amount is missing, marks the amount boxes of the named rows and puts the cursor in the first', async () => {
    const { region, user } = await openEditor('/recipes/new');
    await user.type(nameBox(region), 'Pane');
    await user.type(ingredientBoxes(region)[0]!, 'Flour');
    await user.click(saveButton(region));
    await says('Enter an amount for at least one ingredient.');
    expect(amountBoxes(region)[0]).toHaveAttribute('aria-invalid', 'true');
    expect(amountBoxes(region)[0]).toHaveFocus();
    await user.type(amountBoxes(region)[0]!, '5');
    expect(amountBoxes(region)[0]).not.toHaveAttribute('aria-invalid');
  });

  it('skips a «to taste» row (it has no amount box) and goes to the first row that has one', async () => {
    const { region, user } = await openEditor('/recipes/new');
    await user.type(nameBox(region), 'Pane');
    await user.type(ingredientBoxes(region)[0]!, 'Salt');
    await user.selectOptions(units(region)[0]!, 'to taste');
    await user.click(within(region).getByRole('button', { name: '+ Add ingredient' }));
    await user.type(ingredientBoxes(region)[1]!, 'Flour');
    await user.click(saveButton(region));
    expect(amountBoxes(region)).toHaveLength(1);
    expect(amountBoxes(region)[0]).toHaveFocus();
  });

  it('says the sentences in Italian', async () => {
    const { user } = renderRecipes('/recipes/new', { source: sourceWith([FOCACCIA]), lang: 'it' });
    const region = await screen.findByRole('region', { name: 'Nuova ricetta' }, LOAD);
    await user.click(within(region).getByRole('button', { name: 'Salva' }));
    await says('Inserisci il nome della ricetta.');
  });
});

describe('Save', () => {
  it('⚠️ asks, then writes exactly the hand-listed fields, says «Recipe added.» and goes back to the list on the new row', async () => {
    const { region, user, router, source } = await openEditor('/recipes/new');
    await user.type(nameBox(region), '  Pane  ');
    await user.type(ingredientBoxes(region)[0]!, 'Farina');
    await user.type(amountBoxes(region)[0]!, '500');
    await user.click(saveButton(region));
    await answerSave(user);

    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    const write = source.recipeWrites[0]!;
    expect(write.id).toBeTruthy();
    expect(Object.keys(write.data ?? {}).sort()).toEqual(['ingredients', 'name', 'netWeightG', 'shelfLifeDays']);
    expect(write.data?.name).toBe('Pane');
    expect(write.data?.ingredients).toEqual([{ label: 'Farina', grams: 500, unit: 'g', rid: expect.any(String) }]);
    await says('Recipe added.');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    const row = await screen.findByRole('button', { name: 'Pane' });
    await waitFor(() => { expect(row).toHaveFocus(); });
    // The blocker did not ask: it was saved.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('saves an existing recipe: «Recipe saved.», back on the LIST, and what the editor does not own stays as stored', async () => {
    const stored = recipe('r1', { name: 'Focaccia', lossPct: 12, steps: [{ text: 'Mix' }], endNote: 'Bake' });
    const { router, user, source } = renderRecipes('/recipes/r1', { source: sourceWith([stored]) });
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const region = await screen.findByRole('region', { name: 'Edit recipe' });
    await user.type(nameBox(region), ' integrale');
    await user.click(saveButton(region));
    await answerSave(user);

    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    const write = source.recipeWrites[0]!;
    expect(write.id).toBe('r1');
    expect(Object.keys(write.data ?? {}).sort()).toEqual(['ingredients', 'name', 'netWeightG', 'shelfLifeDays']);
    expect(write.data?.name).toBe('Focaccia integrale');
    await says('Recipe saved.');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    expect(source.recipes.get('r1')).toMatchObject({ lossPct: 12, steps: [{ text: 'Mix' }], endNote: 'Bake', name: 'Focaccia integrale' });
    const row = await screen.findByRole('button', { name: 'Focaccia integrale' });
    await waitFor(() => { expect(row).toHaveFocus(); });
  });

  it('⚠️ keeps a row’s ingredient link and row id through a save', async () => {
    const linked = recipe('r1', {
      name: 'Focaccia',
      ingredients: [{ label: 'Flour', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'ing-9', rid: 'row-keep' }],
    });
    const { user, source } = renderRecipes('/recipes/r1/edit', { source: sourceWith([linked]) });
    const region = await screen.findByRole('region', { name: 'Edit recipe' }, LOAD);
    await user.type(nameBox(region), '!');
    await user.click(saveButton(region));
    await answerSave(user);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites[0]?.data?.ingredients).toEqual([
      { label: 'Flour', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'ing-9', rid: 'row-keep' },
    ]);
  });

  it('changes nothing when the question is cancelled, and the editor stays', async () => {
    const { region, user, router, source } = await openEditor('/recipes/r1/edit');
    await user.type(nameBox(region), 'X');
    await user.click(saveButton(region));
    const dialog = await screen.findByRole('alertdialog', { name: 'Save recipe?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(source.recipeWrites).toEqual([]);
    expect(router.state.location.pathname).toBe('/recipes/r1/edit');
    expect(nameBox(region).value).toBe('FocacciaX');
  });

  it('ignores a second tap on Save while the question is open', async () => {
    const { region, user, source } = await openEditor('/recipes/r1/edit');
    await user.type(nameBox(region), 'X');
    const save = saveButton(region);
    await user.click(save);
    await screen.findByRole('alertdialog', { name: 'Save recipe?' });
    act(() => { save.click(); });
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    await answerSave(user);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
  });

  it('⚠️ puts a refused save back and says so: an edited recipe is as it was', async () => {
    const { region, user, source, router } = await openEditor('/recipes/r1/edit');
    source.refuseRecipeWrites.save = true;
    await user.clear(nameBox(region));
    await user.type(nameBox(region), 'Changed');
    await user.click(saveButton(region));
    await answerSave(user);
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    await says('Couldn’t save “Changed” — check your connection.');
    expect(await screen.findByRole('button', { name: 'Focaccia' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Changed' })).not.toBeInTheDocument();
    expect(source.recipeWrites).toEqual([]);
  });

  it('⚠️ a new recipe whose save is refused is not left in the list', async () => {
    const { region, user, source } = await openEditor('/recipes/new');
    source.refuseRecipeWrites.save = true;
    await user.type(nameBox(region), 'Pane');
    await user.type(ingredientBoxes(region)[0]!, 'Farina');
    await user.type(amountBoxes(region)[0]!, '5');
    await user.click(saveButton(region));
    await answerSave(user);
    await says('Couldn’t save “Pane” — check your connection.');
    expect(screen.queryByRole('button', { name: 'Pane' })).not.toBeInTheDocument();
  });

  it('records the usage action', async () => {
    const seen: string[] = [];
    const listener = (event: Event) => { seen.push(String((event as CustomEvent).detail)); };
    window.addEventListener('mise:action', listener);
    try {
      const { region, user } = await openEditor('/recipes/r1/edit');
      await user.type(nameBox(region), 'X');
      await user.click(saveButton(region));
      await answerSave(user);
      await waitFor(() => { expect(seen).toContain('recipe-saved'); });
    } finally {
      window.removeEventListener('mise:action', listener);
    }
  });
});

describe('the label fields', () => {
  it('are hidden when the venue prints neither', async () => {
    const { region } = await openEditor('/recipes/r1/edit');
    expect(within(region).queryByLabelText('Net weight of one pack')).not.toBeInTheDocument();
    expect(within(region).queryByLabelText('Keeps for')).not.toBeInTheDocument();
  });

  it('show only the box the profile prints', async () => {
    const source = fakeRecipesSource({ recipes: [FOCACCIA], labelConfig: { showWeight: true } });
    const { region } = await openEditor('/recipes/r1/edit', { source });
    expect(await within(region).findByLabelText('Net weight of one pack')).toBeInTheDocument();
    expect(within(region).queryByLabelText('Keeps for')).not.toBeInTheDocument();
    expect(within(region).getByText(/an empty box means «nobody has said»/)).toBeInTheDocument();
  });

  it('show both, with the stored values', async () => {
    const source = fakeRecipesSource({
      recipes: [recipe('r1', { name: 'Focaccia', netWeightG: 250, shelfLifeDays: 5 })],
      labelConfig: { showWeight: true, showDate: true },
    });
    const { region } = await openEditor('/recipes/r1/edit', { source });
    expect(((await within(region).findByLabelText('Net weight of one pack')) as HTMLInputElement).value).toBe('250');
    expect((within(region).getByLabelText('Keeps for') as HTMLInputElement).value).toBe('5');
  });

  it('⚠️ an emptied shelf life is saved as «nobody has said» — null, never 0', async () => {
    const source = fakeRecipesSource({
      recipes: [recipe('r1', { name: 'Focaccia', netWeightG: 250, shelfLifeDays: 5 })],
      labelConfig: { showWeight: true, showDate: true },
    });
    const { region, user } = await openEditor('/recipes/r1/edit', { source });
    await user.clear(await within(region).findByLabelText('Keeps for'));
    await user.click(saveButton(region));
    await answerSave(user);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites[0]?.data).toMatchObject({ shelfLifeDays: null, netWeightG: 250 });
    expect(source.recipes.get('r1')).not.toHaveProperty('shelfLifeDays');
  });

  it('save the typed days and grams', async () => {
    const source = fakeRecipesSource({ recipes: [FOCACCIA], labelConfig: { showWeight: true, showDate: true } });
    const { region, user } = await openEditor('/recipes/r1/edit', { source });
    await user.type(await within(region).findByLabelText('Keeps for'), '7');
    await user.type(within(region).getByLabelText('Net weight of one pack'), '300');
    await user.click(saveButton(region));
    await answerSave(user);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites[0]?.data).toMatchObject({ shelfLifeDays: 7, netWeightG: 300 });
  });

  it('⚠️ a stored net weight in a box that is not shown goes through unrounded', async () => {
    const source = sourceWith([recipe('r1', { name: 'Focaccia', netWeightG: 12.5 })]);
    const { region, user } = await openEditor('/recipes/r1/edit', { source });
    await user.type(nameBox(region), '!');
    await user.click(saveButton(region));
    await answerSave(user);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites[0]?.data?.netWeightG).toBe(12.5);
  });
});

describe('leaving with unsaved changes', () => {
  it('asks when something was typed, stays on Cancel and leaves on Discard', async () => {
    const { router, user } = renderRecipes('/recipes/r1', { source: sourceWith([FOCACCIA]) });
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const region = await screen.findByRole('region', { name: 'Edit recipe' });
    await user.type(nameBox(region), 'X');
    await user.click(within(region).getByRole('button', { name: 'Back' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
    expect(dialog).toHaveTextContent('You have unsaved changes. Discard them?');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/recipes/r1/edit');
    expect(nameBox(region).value).toBe('FocacciaX');

    await user.click(within(region).getByRole('button', { name: 'Back' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Discard changes?' })).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/r1'); });
  });

  it('asks nothing when nothing was typed', async () => {
    const { router, user, region } = await openEditor('/recipes/r1/edit');
    await user.click(within(region).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/r1'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('⚠️ asks on the browser’s Back too, not only on the Back button', async () => {
    const { router, user } = renderRecipes('/recipes/r1', { source: sourceWith([FOCACCIA]) });
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const region = await screen.findByRole('region', { name: 'Edit recipe' });
    await user.type(nameBox(region), 'X');
    act(() => { void router.navigate(-1); });
    expect(await screen.findByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/recipes/r1/edit');
  });

  it('asks on a new recipe too, and a new recipe with nothing typed leaves in silence', async () => {
    const { router, user } = renderRecipes('/recipes', { source: sourceWith([FOCACCIA]) });
    await screen.findByRole('button', { name: 'Focaccia' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'New recipe' }));
    const region = await screen.findByRole('region', { name: 'New recipe' });
    await user.click(within(region).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New recipe' }));
    const again = await screen.findByRole('region', { name: 'New recipe' });
    await user.type(nameBox(again), 'P');
    await user.click(within(again).getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument();
  });

  it('holds the app busy while something is unsaved', async () => {
    const { region, user } = await openEditor('/recipes/r1/edit');
    expect(isBusy()).toBe(false);
    await user.type(nameBox(region), 'X');
    expect(isBusy()).toBe(true);
  });
});
