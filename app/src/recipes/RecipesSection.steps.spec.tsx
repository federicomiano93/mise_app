import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { LOAD, recipe, renderRecipes, sourceWith, split } from '../testing/renderRecipes';

// Step 3d-8, slice A: the mixing steps editor at /recipes/<id>/steps — the working copy (taken once), the check over the rows,
// the steps (text, ticks, minutes and seconds, speed, move, remove, add), the closing message, Save with its question and
// the leave guard. The pure rules: stepsEditorModel.spec.ts.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const ROWS = [
  { label: 'Flour', grams: 1000, unit: 'g', rid: 'rf' },
  { label: 'Water', grams: 700, unit: 'g', rid: 'rw' },
  { label: 'Salt', grams: 20, unit: 'g', rid: 'rs' },
];
const FOCACCIA = recipe('r1', {
  name: 'Focaccia',
  ingredients: ROWS,
  steps: [
    { text: 'Mix', rows: ['rf', 'rw'], seconds: 90, speed: '1' },
    { text: 'Rest', rows: [], seconds: 600, speed: '' },
  ],
  endNote: 'Check 24 degrees',
});
// No procedure and no row ids at all: a recipe written before the procedure existed.
const BARE = recipe('bare', { name: 'Bare' });
const OTHER = recipe('other', { name: 'Other' });

const SOURCE = () => sourceWith([FOCACCIA, BARE, OTHER]);
const region = () => screen.getByRole('region', { name: 'Mixing steps' });
const step = (n: number) => within(region()).getByRole('group', { name: `Step ${n}` });
const box = (name: string) => within(region()).getByRole('textbox', { name }) as HTMLInputElement;
const numberBox = (name: string) => within(region()).getByRole('spinbutton', { name }) as HTMLInputElement;
const tick = (n: number, name: string | RegExp) => within(step(n)).getByRole('checkbox', { name }) as HTMLInputElement;
const button = (name: string) => within(region()).getByRole('button', { name });
const instructions = () => within(region()).getAllByRole('textbox', { name: /^Step \d+ instruction$/ }).map(node => (node as HTMLInputElement).value);
const says = async (text: string) => {
  const node = await screen.findByText(text);
  expect(node.closest('[role="status"]')).not.toBeNull();
};

async function openEditor(path = '/recipes/r1/steps', options: Parameters<typeof renderRecipes>[1] = {}) {
  const view = renderRecipes(path, { source: SOURCE(), ...options });
  await screen.findByRole('region', { name: 'Mixing steps' }, LOAD);
  return view;
}

async function answer(user: { click: (el: Element) => Promise<void> }, dialogName: string, button: string) {
  const dialog = await screen.findByRole('alertdialog', { name: dialogName }, LOAD);
  await user.click(within(dialog).getByRole('button', { name: button }));
  // ⚠️ THE ROUTER TAKES A MOMENT TO LEARN THE ANSWER (a reset or a proceed), and the editor asks again only once it has: a
  // person is never that quick, a script is. Without this the next click of a busy machine's run finds nobody asking.
  await act(async () => { await new Promise<void>(resolve => { setTimeout(resolve, 60); }); });
}

describe('the working copy', () => {
  it('shows the recipe’s steps: text, ticks, minutes and seconds, speed, and the closing message', async () => {
    await openEditor();
    expect(box('Step 1 instruction').value).toBe('Mix');
    expect(tick(1, /Flour/).checked).toBe(true);
    expect(tick(1, /Water/).checked).toBe(true);
    expect(tick(1, /Salt/).checked).toBe(false);
    expect(numberBox('Step 1 minutes').value).toBe('1');
    expect(numberBox('Step 1 seconds').value).toBe('30');
    expect(box('Step 1 speed').value).toBe('1');
    expect(box('Step 2 instruction').value).toBe('Rest');
    expect(numberBox('Step 2 minutes').value).toBe('10');
    expect(numberBox('Step 2 seconds').value).toBe('');
    expect(within(region()).getByRole('textbox', { name: 'Closing message, shown when the dough is finished' })).toHaveValue('Check 24 degrees');
    expect(within(region()).getByText('2 steps · 11:30 of timers')).toBeInTheDocument();
  });

  it('writes each row with its amount as the recipe page does', async () => {
    const milk = recipe('milk', {
      name: 'Milk bun',
      ingredients: [{ label: 'Milk', grams: 1.5, unit: 'kg', rid: 'rm' }, { label: 'Flour', grams: 250, unit: 'g', rid: 'rf' }],
      steps: [{ text: 'Mix', rows: [], seconds: 0, speed: '' }],
    });
    renderRecipes('/recipes/milk/steps', { source: sourceWith([milk]) });
    await screen.findByRole('region', { name: 'Mixing steps' }, LOAD);
    expect(tick(1, 'Milk 1.5 kg')).toBeInTheDocument();
    expect(tick(1, 'Flour 250 g')).toBeInTheDocument();
  });

  it('⚠️ is taken once: a later snapshot of the recipe never replaces what is typed', async () => {
    const { user, source } = await openEditor();
    await user.type(box('Step 1 instruction'), ' well');
    source.recipes.set('r1', recipe('r1', { name: 'Focaccia', ingredients: ROWS, steps: [{ text: 'Changed elsewhere', rows: [], seconds: 5, speed: '' }] }));
    act(() => { source.push(); });
    await new Promise<void>(resolve => { setTimeout(resolve, 100); });
    expect(box('Step 1 instruction').value).toBe('Mix well');
    expect(instructions()).toEqual(['Mix well', 'Rest']);
  });

  it('waits for the recipe: «Loading…» while the server has not answered, then the editor', async () => {
    const source = SOURCE();
    source.hold();
    renderRecipes('/recipes/r1/steps', { source });
    expect((await screen.findAllByText('Loading…', undefined, LOAD)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('region', { name: 'Mixing steps' })).not.toBeInTheDocument();
    act(() => { source.release(); });
    expect(await screen.findByRole('region', { name: 'Mixing steps' })).toBeInTheDocument();
  });

  it('says «This recipe no longer exists.» for an unknown recipe, and Back goes to the list', async () => {
    const { user, router } = renderRecipes('/recipes/nope/steps', { source: SOURCE() });
    expect(await screen.findByRole('heading', { name: 'This recipe no longer exists.' }, LOAD)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
  });

  it('leaves out the ticks when no row of the recipe has a name', async () => {
    renderRecipes('/recipes/empty/steps', { source: sourceWith([recipe('empty', { name: 'Empty', ingredients: [], steps: [{ text: 'Wait', rows: [], seconds: 0, speed: '' }] })]) });
    await screen.findByRole('region', { name: 'Mixing steps' }, LOAD);
    expect(within(region()).queryByText('Ingredients to add')).not.toBeInTheDocument();
    expect(within(region()).queryAllByRole('checkbox')).toHaveLength(0);
  });
});

describe('the check over the rows', () => {
  it('names the rows no step adds, and follows the ticks as they are made', async () => {
    const { user } = await openEditor();
    expect(within(region()).getByText('Not in any step yet: Salt')).toBeInTheDocument();
    expect(within(region()).getByText('Whoever follows this will not be told to add them. It is fine if that is on purpose.')).toBeInTheDocument();
    await user.click(tick(2, /Salt/));
    expect(within(region()).getByText('Every ingredient is in a step.')).toBeInTheDocument();
    expect(within(region()).queryByText(/Not in any step yet/)).not.toBeInTheDocument();
    await user.click(tick(1, /Flour/));
    expect(within(region()).getByText('Not in any step yet: Flour')).toBeInTheDocument();
  });

  it('is a warning, not a block: Save still asks', async () => {
    const { user } = await openEditor();
    await user.click(button('Save'));
    expect(await screen.findByRole('alertdialog', { name: 'Save the procedure?' })).toBeInTheDocument();
  });

  it('says «No steps yet» and invites the first one when there are none', async () => {
    renderRecipes('/recipes/bare/steps', { source: SOURCE() });
    await screen.findByRole('region', { name: 'Mixing steps' }, LOAD);
    expect(within(region()).getByText('No steps yet')).toBeInTheDocument();
    expect(within(region()).getByText('Add the first step. Each one can carry ingredients, a timer, and a mixer speed.')).toBeInTheDocument();
    expect(within(region()).queryByRole('group', { name: 'Step 1' })).not.toBeInTheDocument();
  });
});

describe('the timer', () => {
  it('is minutes and seconds in two boxes, added up', async () => {
    const { user } = await openEditor();
    await user.clear(numberBox('Step 2 minutes'));
    await user.type(numberBox('Step 2 minutes'), '2');
    await user.type(numberBox('Step 2 seconds'), '15');
    expect(numberBox('Step 2 minutes').value).toBe('2');
    expect(numberBox('Step 2 seconds').value).toBe('15');
    expect(within(region()).getByText('2 steps · 03:45 of timers')).toBeInTheDocument();
  });

  it('shows empty for 0, and reads junk and a negative as 0', async () => {
    const { user } = await openEditor();
    await user.clear(numberBox('Step 1 minutes'));
    await user.clear(numberBox('Step 1 seconds'));
    expect(numberBox('Step 1 minutes').value).toBe('');
    await user.type(numberBox('Step 1 minutes'), '-5');
    expect(numberBox('Step 1 minutes').value).toBe('');
    expect(within(region()).getByText('2 steps · 10:00 of timers')).toBeInTheDocument();
  });

  it('caps minutes at 720 and the seconds box at 59', async () => {
    const { user } = await openEditor();
    await user.clear(numberBox('Step 1 minutes'));
    await user.type(numberBox('Step 1 minutes'), '9999');
    await user.clear(numberBox('Step 1 seconds'));
    expect(numberBox('Step 1 minutes').value).toBe('720');
    // Twelve hours is the most a step can time, so the seconds beside 720 minutes have no room.
    await user.type(numberBox('Step 1 seconds'), '30');
    expect(numberBox('Step 1 seconds').value).toBe('');
    await user.clear(numberBox('Step 1 minutes'));
    await user.type(numberBox('Step 1 minutes'), '1');
    await user.type(numberBox('Step 1 seconds'), '99');
    expect(numberBox('Step 1 seconds').value).toBe('59');
  });

  it('has visible unit words beside the boxes', async () => {
    await openEditor();
    expect(within(step(1)).getByText('min')).toBeInTheDocument();
    expect(within(step(1)).getByText('sec')).toBeInTheDocument();
  });
});

describe('moving, removing and adding steps', () => {
  it('moves a step up and down, the first having no Up and the last no Down', async () => {
    const { user } = await openEditor();
    expect(button('Move step 1 up')).toBeDisabled();
    expect(button('Move step 2 down')).toBeDisabled();
    await user.click(button('Move step 2 up'));
    expect(instructions()).toEqual(['Rest', 'Mix']);
    await user.click(button('Move step 1 down'));
    expect(instructions()).toEqual(['Mix', 'Rest']);
  });

  it('⚠️ keeps the ticks, the timer and the speed with the step that moves', async () => {
    const { user } = await openEditor();
    await user.click(button('Move step 1 down'));
    expect(tick(2, /Flour/).checked).toBe(true);
    expect(numberBox('Step 2 minutes').value).toBe('1');
    expect(box('Step 2 speed').value).toBe('1');
    expect(tick(1, /Flour/).checked).toBe(false);
  });

  it('keeps the focus on the same arrow of the moved step, or on the other one when it has reached an end', async () => {
    const { user } = await openEditor();
    await user.click(button('+ Add step'));
    await user.click(button('+ Add step'));
    // Four steps. Step 2 goes down to the third place: both arrows still work, the focus stays on «down».
    await user.click(button('Move step 2 down'));
    await waitFor(() => { expect(button('Move step 3 down')).toHaveFocus(); });
    // And down once more: it is last, Down is disabled, so the focus moves to «up».
    await user.click(button('Move step 3 down'));
    await waitFor(() => { expect(button('Move step 4 up')).toHaveFocus(); });
    // Up to the first place: Up is disabled there, the focus is on «down».
    await user.click(button('Move step 4 up'));
    await user.click(button('Move step 3 up'));
    await user.click(button('Move step 2 up'));
    await waitFor(() => { expect(button('Move step 1 down')).toHaveFocus(); });
  });

  it('asks before removing a step, and Cancel keeps it', async () => {
    const { user } = await openEditor();
    await user.click(button('Remove step 1'));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove this step?' });
    expect(within(dialog).getByText('Step 1 will be removed from the procedure.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(instructions()).toEqual(['Mix', 'Rest']);
  });

  it('removes the step on «Remove» and puts the focus on a control that is still there', async () => {
    const { user } = await openEditor();
    await user.click(button('Remove step 1'));
    await answer(user, 'Remove this step?', 'Remove');
    expect(instructions()).toEqual(['Rest']);
    await waitFor(() => { expect(button('Remove step 1')).toHaveFocus(); });
    expect(within(region()).getByText('1 step · 10:00 of timers')).toBeInTheDocument();
  });

  it('adds an empty step at the end and puts the focus in its instruction box', async () => {
    const { user } = await openEditor();
    await user.click(button('+ Add step'));
    expect(instructions()).toEqual(['Mix', 'Rest', '']);
    await waitFor(() => { expect(box('Step 3 instruction')).toHaveFocus(); });
    expect(box('Step 3 instruction')).toHaveAttribute('placeholder', 'What to do — e.g. Add the flour and the water');
  });

  it('⚠️ stops at 100 steps and says so, adding nothing', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ text: `Step ${i + 1}`, rows: [], seconds: 0, speed: '' }));
    const { user } = renderRecipes('/recipes/many/steps', { source: sourceWith([recipe('many', { name: 'Many', ingredients: [], steps: many })]) });
    await screen.findByRole('region', { name: 'Mixing steps' }, LOAD);
    await user.click(button('+ Add step'));
    await says('A procedure can hold 100 steps.');
    expect(instructions()).toHaveLength(100);
  });

  it('limits what a box takes in', async () => {
    await openEditor();
    expect(box('Step 1 instruction')).toHaveAttribute('maxlength', '300');
    expect(box('Step 1 speed')).toHaveAttribute('maxlength', '24');
    expect(within(region()).getByRole('textbox', { name: 'Closing message, shown when the dough is finished' })).toHaveAttribute('maxlength', '300');
  });
});

describe('Save', () => {
  it('asks with the number of steps and the recipe’s name', async () => {
    const { user } = await openEditor();
    await user.click(button('Save'));
    const dialog = await screen.findByRole('alertdialog', { name: 'Save the procedure?' });
    expect(within(dialog).getByText('Save 2 steps for “Focaccia”?')).toBeInTheDocument();
  });

  it('says «1 step» in the singular', async () => {
    const { user } = await openEditor();
    await user.click(button('Remove step 2'));
    await answer(user, 'Remove this step?', 'Remove');
    await user.click(button('Save'));
    expect(await screen.findByText('Save 1 step for “Focaccia”?')).toBeInTheDocument();
  });

  it('asks about an EMPTY procedure in its own words: it deletes the procedure', async () => {
    const { user } = renderRecipes('/recipes/bare/steps', { source: SOURCE() });
    await screen.findByRole('region', { name: 'Mixing steps' }, LOAD);
    await user.click(button('Save'));
    expect(await screen.findByText('“Bare” will have no guided procedure.')).toBeInTheDocument();
  });

  it('counts a step with nothing in it for nothing', async () => {
    const { user } = await openEditor();
    await user.click(button('+ Add step'));
    await user.click(button('Save'));
    expect(await screen.findByText('Save 2 steps for “Focaccia”?')).toBeInTheDocument();
  });

  it('writes nothing when the answer is no, and stays', async () => {
    const { user, source, router } = await openEditor();
    await user.type(box('Step 1 instruction'), '!');
    await user.click(button('Save'));
    await answer(user, 'Save the procedure?', 'Cancel');
    expect(source.recipeWrites).toHaveLength(0);
    expect(router.state.location.pathname).toBe('/recipes/r1/steps');
  });

  it('⚠️ saves what was typed — steps, ticks, time, speed, the closing message — and lands on the recipe', async () => {
    const { user, source, router } = await openEditor();
    await user.clear(box('Step 1 instruction'));
    await user.type(box('Step 1 instruction'), 'Knead');
    await user.click(tick(2, /Salt/));
    await user.clear(numberBox('Step 2 minutes'));
    await user.type(numberBox('Step 2 minutes'), '4');
    await user.type(numberBox('Step 2 seconds'), '30');
    await user.type(box('Step 2 speed'), '2');
    const note = within(region()).getByRole('textbox', { name: 'Closing message, shown when the dough is finished' });
    await user.clear(note);
    await user.type(note, 'Rest 5 min');
    await user.click(button('Save'));
    await answer(user, 'Save the procedure?', 'Save');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/r1'); });
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites[0]?.id).toBe('r1');
    expect(source.recipeWrites[0]?.data).toEqual({
      steps: [
        { text: 'Knead', rows: ['rf', 'rw'], seconds: 90, speed: '1' },
        { text: 'Rest', rows: ['rs'], seconds: 270, speed: '2' },
      ],
      endNote: 'Rest 5 min',
    });
    await says('Procedure saved.');
    expect(await screen.findByRole('heading', { level: 3, name: 'Procedure' })).toBeInTheDocument();
  });

  it('⚠️ stores the row ids it minted when the recipe had none, and the steps point at them', async () => {
    const { user, source } = renderRecipes('/recipes/bare/steps', { source: SOURCE() });
    await screen.findByRole('region', { name: 'Mixing steps' }, LOAD);
    await user.click(button('+ Add step'));
    await user.click(tick(1, /Flour/));
    await user.click(tick(1, /Salt/));
    await user.click(button('Save'));
    await answer(user, 'Save the procedure?', 'Save');
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    const data = source.recipeWrites[0]?.data as { ingredients: Array<{ label: string; rid: string }>; steps: Array<{ rows: string[] }> };
    expect(data.ingredients.map(row => row.label)).toEqual(['Flour', 'Water', 'Salt']);
    const rids = data.ingredients.map(row => row.rid);
    expect(new Set(rids).size).toBe(3);
    expect(rids.every(rid => /^r[a-z0-9]{8}$/.test(rid))).toBe(true);
    expect(data.steps).toHaveLength(1);
    expect(data.steps[0]?.rows).toEqual([rids[0], rids[2]]);
  });

  it('sends no ingredients when every row already had an id', async () => {
    const { user, source } = await openEditor();
    await user.click(button('Save'));
    await answer(user, 'Save the procedure?', 'Save');
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites[0]?.data).not.toHaveProperty('ingredients');
  });

  it('tells the usage record «procedure-saved»', async () => {
    const seen: string[] = [];
    const listen = (event: Event) => { seen.push(String((event as CustomEvent).detail)); };
    window.addEventListener('mise:action', listen);
    try {
      const { user } = await openEditor();
      await user.click(button('Save'));
      await answer(user, 'Save the procedure?', 'Save');
      await waitFor(() => { expect(seen).toContain('procedure-saved'); });
    } finally {
      window.removeEventListener('mise:action', listen);
    }
  });

  it('ignores a second tap while the question is open', async () => {
    const { user, source } = await openEditor();
    const saveButton = button('Save');
    await user.click(saveButton);
    await screen.findByRole('alertdialog', { name: 'Save the procedure?' });
    act(() => { saveButton.click(); });
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    await answer(user, 'Save the procedure?', 'Save');
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
  });

  it('says so, and keeps the typing, when the recipe was deleted meanwhile', async () => {
    const { user, source, router } = await openEditor();
    await user.type(box('Step 1 instruction'), '!');
    source.recipes.delete('r1');
    act(() => { source.push(); });
    expect(box('Step 1 instruction').value).toBe('Mix!');
    await user.click(button('Save'));
    await answer(user, 'Save the procedure?', 'Save');
    await says('This recipe no longer exists.');
    expect(source.recipeWrites).toHaveLength(0);
    expect(router.state.location.pathname).toBe('/recipes/r1/steps');
    expect(box('Step 1 instruction').value).toBe('Mix!');
  });
});

describe('where Back goes', () => {
  const START = '/nowhere';

  async function walk() {
    const view = renderRecipes(START, { source: SOURCE() });
    await screen.findByText('Page not found');
    await act(async () => { await view.router.navigate('/recipes'); });
    await view.user.click(await screen.findByRole('button', { name: 'Focaccia' }, LOAD));
    await screen.findByRole('heading', { level: 3, name: 'Procedure' }, LOAD);
    await view.user.click(screen.getByRole('button', { name: 'Edit the steps' }));
    await screen.findByRole('region', { name: 'Mixing steps' });
    return view;
  }

  it('steps back to the recipe, the focus on the button that opened the steps', async () => {
    const { router, user } = await walk();
    await user.click(button('Back'));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/r1'); });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Edit the steps' })).toHaveFocus(); });
  });

  it('⚠️ after Save lands on the recipe with no second entry for it: one Back more is the list', async () => {
    const { router, user } = await walk();
    await user.type(box('Step 1 instruction'), '!');
    await user.click(button('Save'));
    await answer(user, 'Save the procedure?', 'Save');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/r1'); });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Edit the steps' })).toHaveFocus(); });
    await act(async () => { await router.navigate(-1); });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
  });

  it('puts the focus on «Edit the steps» after the first steps are written, though the button was «Write…»', async () => {
    const view = renderRecipes(START, { source: SOURCE() });
    await screen.findByText('Page not found');
    await act(async () => { await view.router.navigate('/recipes/bare'); });
    await view.user.click(await screen.findByRole('button', { name: 'Write the mixing steps' }, LOAD));
    await screen.findByRole('region', { name: 'Mixing steps' });
    await view.user.click(button('+ Add step'));
    await view.user.type(box('Step 1 instruction'), 'Mix');
    await view.user.click(button('Save'));
    await answer(view.user, 'Save the procedure?', 'Save');
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/recipes/bare'); });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Edit the steps' })).toHaveFocus(); });
  });

  it('replaces itself with the recipe when opened by its address, with nothing behind it', async () => {
    const { user, router } = await openEditor();
    await user.click(button('Back'));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/r1'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('puts the focus on the title when opened from the recipe', async () => {
    await walk();
    await waitFor(() => { expect(within(region()).getByRole('heading', { level: 2, name: 'Mixing steps' })).toHaveFocus(); });
  });
});

describe('leaving with changes', () => {
  it('asks when the Back button is pressed, Cancel stays and Discard leaves', async () => {
    const { user, router } = await openEditor();
    await user.type(box('Step 1 instruction'), '!');
    await user.click(button('Back'));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
    expect(within(dialog).getByText('The steps you have written have not been saved.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/recipes/r1/steps');
    expect(box('Step 1 instruction').value).toBe('Mix!');
    await user.click(button('Back'));
    await answer(user, 'Discard changes?', 'Discard');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/r1'); });
  });

  it('asks on every other way out too: the router’s own navigation', async () => {
    const { user, router, source } = await openEditor();
    await user.click(tick(2, /Salt/));
    void act(() => { void router.navigate('/recipes'); });
    await answer(user, 'Discard changes?', 'Cancel');
    expect(router.state.location.pathname).toBe('/recipes/r1/steps');
    void act(() => { void router.navigate('/recipes'); });
    await answer(user, 'Discard changes?', 'Discard');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    expect(source.recipeWrites).toHaveLength(0);
  });

  it('does not ask when nothing was changed', async () => {
    const { user, router } = await openEditor();
    await user.click(button('Back'));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/r1'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('holds the app busy while something is unsaved (a self-started reload waits)', async () => {
    const { user } = await openEditor();
    expect(isBusy()).toBe(false);
    await user.type(box('Step 1 instruction'), '!');
    expect(isBusy()).toBe(true);
  });
});

describe('the keyboard', () => {
  it('reaches every control of a step in the order they are drawn', async () => {
    const { user } = await openEditor();
    const nameOf = (node: Element | null) => node?.getAttribute('aria-label') ?? node?.closest('label')?.textContent ?? node?.textContent ?? '';
    within(region()).getByRole('heading', { level: 2 }).focus();
    const order: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      await user.tab();
      order.push(nameOf(document.activeElement).trim());
    }
    expect(order).toEqual([
      'Save', 'Move step 1 down', 'Remove step 1', 'Step 1 instruction', 'Flour 1000 g', 'Water 700 g', 'Salt 20 g',
      'Step 1 minutes', 'Step 1 seconds', 'Step 1 speed', 'Move step 2 up', 'Remove step 2', 'Step 2 instruction', 'Flour 1000 g',
    ]);
  });

  it('ticks a row with the space bar', async () => {
    const { user } = await openEditor();
    tick(2, /Salt/).focus();
    await user.keyboard(' ');
    expect(tick(2, /Salt/).checked).toBe(true);
  });
});

describe('on the split', () => {
  beforeEach(() => { split(); });

  it('is drawn in the right-hand pane with the list beside it', async () => {
    const { user } = renderRecipes('/recipes', { source: SOURCE() });
    await user.click(await screen.findByRole('button', { name: 'Focaccia' }, LOAD));
    await user.click(await screen.findByRole('button', { name: 'Edit the steps' }));
    await screen.findByRole('region', { name: 'Mixing steps' });
    expect(screen.getByRole('button', { name: 'Focaccia' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Other' })).toBeInTheDocument();
  });

  it('asks before another recipe picked in the list replaces it', async () => {
    const { user, router } = renderRecipes('/recipes', { source: SOURCE() });
    await user.click(await screen.findByRole('button', { name: 'Focaccia' }, LOAD));
    await user.click(await screen.findByRole('button', { name: 'Edit the steps' }));
    await screen.findByRole('region', { name: 'Mixing steps' });
    await user.type(box('Step 1 instruction'), '!');
    await user.click(screen.getByRole('button', { name: 'Other' }));
    await answer(user, 'Discard changes?', 'Cancel');
    expect(router.state.location.pathname).toBe('/recipes/r1/steps');
    await user.click(screen.getByRole('button', { name: 'Other' }));
    await answer(user, 'Discard changes?', 'Discard');
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/other'); });
  });
});

describe('in Italian', () => {
  it('says the current app’s Italian words, and the new accessible names', async () => {
    renderRecipes('/recipes/r1/steps', { source: SOURCE(), lang: 'it', session: { language: 'it' } });
    const italian = await screen.findByRole('region', { name: 'Passaggi dell’impasto' }, LOAD);
    expect(within(italian).getByText('2 passi · 11:30 di timer')).toBeInTheDocument();
    expect(within(italian).getByText('Ancora in nessun passaggio: Salt')).toBeInTheDocument();
    expect(within(italian).getByRole('textbox', { name: 'Istruzione del passo 1' })).toBeInTheDocument();
    expect(within(italian).getByRole('spinbutton', { name: 'Minuti del passo 1' })).toBeInTheDocument();
    expect(within(italian).getByRole('spinbutton', { name: 'Secondi del passo 1' })).toBeInTheDocument();
    expect(within(italian).getByRole('textbox', { name: 'Velocità del passo 1' })).toHaveAttribute('placeholder', 'es. 1');
    expect(within(italian).getByRole('button', { name: 'Sposta giù il passaggio 1' })).toBeInTheDocument();
    expect(within(italian).getByRole('button', { name: 'Elimina il passo 1' })).toBeInTheDocument();
    expect(within(italian).getByRole('button', { name: '+ Aggiungi passaggio' })).toBeInTheDocument();
    expect(within(italian).getByText('Quando l’impasto è finito')).toBeInTheDocument();
    expect(within(italian).getByRole('button', { name: 'Salva' })).toBeInTheDocument();
  });

  it('asks in Italian before saving', async () => {
    const { user } = renderRecipes('/recipes/r1/steps', { source: SOURCE(), lang: 'it', session: { language: 'it' } });
    const italian = await screen.findByRole('region', { name: 'Passaggi dell’impasto' }, LOAD);
    await user.click(within(italian).getByRole('button', { name: 'Salva' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Vuoi salvare la procedura?' });
    expect(within(dialog).getByText('Salvare 2 passi per “Focaccia”?')).toBeInTheDocument();
  });
});
