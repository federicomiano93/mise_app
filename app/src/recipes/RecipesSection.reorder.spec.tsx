import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { LOAD, recipe, renderRecipes, sourceWith } from '../testing/renderRecipes';

// Step 3d-6, slice B: reordering the rows of a recipe — a MODE («Reorder» / «Done») in which each row is a grip, its name and
// its amount. The pure moves: editorModel.spec.ts. The stylesheet: editorCss.spec.ts.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const LINKED = recipe('r1', {
  name: 'Focaccia',
  ingredients: [
    { label: 'Flour', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'ing-9', rid: 'row-flour' },
    { label: 'Water', grams: 700, unit: 'g', rid: 'row-water' },
    { label: 'Salt', grams: 20, unit: 'g', kind: 'recipe', refId: 'sub-1', rid: 'row-salt' },
  ],
});

type User = { click: (el: Element) => Promise<void> };

const ingredientBoxes = (region: HTMLElement) => within(region).queryAllByRole('combobox', { name: 'Ingredient name' }) as HTMLInputElement[];
const grips = (region: HTMLElement) => within(region).queryAllByRole('button', { name: /^(Move|Sposta) «/ });
const gripOf = (region: HTMLElement, name: string) => within(region).getByRole('button', { name: `Move «${name}»` });
const names = (region: HTMLElement) => grips(region).map(grip => /«(.*)»/.exec(grip.getAttribute('aria-label') ?? '')?.[1]);
const reorderButton = (region: HTMLElement, name = 'Reorder') => within(region).getByRole('button', { name });
const saveButton = (region: HTMLElement) => within(region).getByRole('button', { name: 'Save' });
const recipeNameBox = () => screen.getByRole('textbox', { name: 'Recipe name' });

async function openEditor(path = '/recipes/r1/edit', options: Parameters<typeof renderRecipes>[1] = {}) {
  const view = renderRecipes(path, { source: sourceWith([LINKED]), ...options });
  const region = await screen.findByRole('region', { name: /^(New recipe|Nuova ricetta|Edit recipe|Modifica ricetta)$/ }, LOAD);
  return { ...view, region };
}

async function enter(region: HTMLElement, user: User) {
  await user.click(reorderButton(region));
  await waitFor(() => { expect(grips(region)).not.toHaveLength(0); });
}

const later = (ms = 150) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });

async function answerSave(user: User) {
  const dialog = await screen.findByRole('alertdialog', { name: 'Save recipe?' });
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
}

describe('the button', () => {
  it('is absent with one row and present with two', async () => {
    const { region, user } = await openEditor('/recipes/new');
    expect(within(region).queryByRole('button', { name: 'Reorder' })).not.toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: '+ Add ingredient' }));
    expect(reorderButton(region)).toBeInTheDocument();
    await user.click(within(region).getAllByRole('button', { name: 'Remove ingredient' })[0]!);
    expect(within(region).queryByRole('button', { name: 'Reorder' })).not.toBeInTheDocument();
  });

  it('reads «Riordina» then «Fine» in Italian, and says whether the mode is on', async () => {
    const { region, user } = await openEditor('/recipes/r1/edit', { lang: 'it' });
    expect(reorderButton(region, 'Riordina')).toHaveAttribute('aria-pressed', 'false');
    await user.click(reorderButton(region, 'Riordina'));
    expect(reorderButton(region, 'Fine')).toHaveAttribute('aria-pressed', 'true');
    expect(await within(region).findByText('Tieni premuto un ingrediente e trascinalo al suo posto. Con la tastiera usa le frecce su e giù.')).toBeInTheDocument();
    expect(await within(region).findAllByRole('button', { name: /^Sposta «/ })).toHaveLength(3);
  });

  it('turning the mode on and off is not an edit: Back asks nothing', async () => {
    const { region, user, router } = await openEditor();
    await enter(region, user);
    await user.click(reorderButton(region, 'Done'));
    expect(isBusy()).toBe(false);
    await user.click(within(region).getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/r1'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('the rows in the mode', () => {
  it('are a grip, a name and an amount, with nothing to type in, no bin and no «Add ingredient»', async () => {
    const { region, user } = await openEditor();
    await enter(region, user);
    expect(names(region)).toEqual(['Flour', 'Water', 'Salt']);
    expect(ingredientBoxes(region)).toHaveLength(0);
    expect(within(region).queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(within(region).queryAllByRole('combobox')).toHaveLength(0);
    expect(within(region).queryByRole('button', { name: 'Remove ingredient' })).not.toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: '+ Add ingredient' })).not.toBeInTheDocument();
    const rows = within(region).getAllByRole('row');
    expect(rows[0]).toHaveTextContent('Flour1000g');
    expect(rows[2]).toHaveTextContent('Salt20g');
    // The total stays.
    expect(within(region).getByText('Total')).toBeInTheDocument();
  });

  it('tells how to move a row: the LIST is described by it, the grips keep React Aria’s own description', async () => {
    const { region, user } = await openEditor();
    expect(within(region).queryByText(/Hold an ingredient/)).not.toBeInTheDocument();
    await enter(region, user);
    const hint = within(region).getByText('Hold an ingredient and drag it to its place. With a keyboard, use the up and down arrows.');
    expect(within(region).getByRole('grid')).toHaveAttribute('aria-describedby', hint.id);
    // ⚠️ A grip described by the hint alone would hide «Press Enter to start dragging» from a screen reader.
    for (const grip of grips(region)) expect(grip.getAttribute('aria-describedby') ?? '').not.toBe(hint.id);
    await user.click(reorderButton(region, 'Done'));
    expect(within(region).queryByText(/Hold an ingredient/)).not.toBeInTheDocument();
    expect(ingredientBoxes(region)).toHaveLength(3);
  });

  it('says «(no name)» for a row with no name, and only the unit word for a «to taste» row', async () => {
    const { region, user } = await openEditor('/recipes/new');
    await user.type(ingredientBoxes(region)[0]!, 'Salt');
    await user.type(within(region).getAllByRole('spinbutton', { name: 'Amount' })[0]!, '12');
    await user.selectOptions(within(region).getAllByRole('combobox', { name: 'Unit' })[0]!, 'to taste');
    await user.click(within(region).getByRole('button', { name: '+ Add ingredient' }));
    await enter(region, user);
    const rows = within(region).getAllByRole('row');
    expect(rows[0]).toHaveTextContent(/^Salt\s*to taste$/);
    expect(rows[1]).toHaveTextContent('(no name)');
    expect(grips(region)[1]).toHaveAccessibleName('Move «(no name)»');
  });

  it('writes a row whose amount is empty with its unit alone', async () => {
    const { region, user } = await openEditor('/recipes/new');
    await user.type(ingredientBoxes(region)[0]!, 'Eggs');
    await user.selectOptions(within(region).getAllByRole('combobox', { name: 'Unit' })[0]!, 'pcs');
    await user.click(within(region).getByRole('button', { name: '+ Add ingredient' }));
    await enter(region, user);
    expect(within(region).getAllByRole('row')[0]).toHaveTextContent(/^Eggs\s*pcs$/);
  });

  it('puts the focus on the first grip on entering, and keeps it on the button on leaving', async () => {
    const { region, user } = await openEditor();
    await user.click(reorderButton(region));
    await waitFor(() => { expect(gripOf(region, 'Flour')).toHaveFocus(); });
    await user.click(reorderButton(region, 'Done'));
    expect(reorderButton(region)).toHaveFocus();
  });

  it('keeps the focus on the button when the mode is left with the keyboard', async () => {
    const { region, user } = await openEditor();
    reorderButton(region).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => { expect(gripOf(region, 'Flour')).toHaveFocus(); });
    reorderButton(region, 'Done').focus();
    await user.keyboard('{Enter}');
    expect(reorderButton(region)).toHaveFocus();
    expect(reorderButton(region)).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('the arrow keys on a grip', () => {
  it('ArrowDown and ArrowUp move the row one place, and the focus is on the moved grip', async () => {
    const { region, user } = await openEditor();
    await enter(region, user);
    gripOf(region, 'Flour').focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => { expect(names(region)).toEqual(['Water', 'Flour', 'Salt']); });
    await waitFor(() => { expect(gripOf(region, 'Flour')).toHaveFocus(); });
    await later();
    expect(names(region)).toEqual(['Water', 'Flour', 'Salt']);
    expect(gripOf(region, 'Flour')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => { expect(names(region)).toEqual(['Water', 'Salt', 'Flour']); });
    await waitFor(() => { expect(gripOf(region, 'Flour')).toHaveFocus(); });
    await user.keyboard('{ArrowUp}{ArrowUp}');
    await waitFor(() => { expect(names(region)).toEqual(['Flour', 'Water', 'Salt']); });
    await waitFor(() => { expect(gripOf(region, 'Flour')).toHaveFocus(); });
  });

  it('do nothing at the ends, and are no edit there', async () => {
    const { region, user } = await openEditor();
    await enter(region, user);
    gripOf(region, 'Flour').focus();
    await user.keyboard('{ArrowUp}');
    expect(names(region)).toEqual(['Flour', 'Water', 'Salt']);
    gripOf(region, 'Salt').focus();
    await user.keyboard('{ArrowDown}');
    expect(names(region)).toEqual(['Flour', 'Water', 'Salt']);
    expect(gripOf(region, 'Salt')).toHaveFocus();
    expect(isBusy()).toBe(false);
  });

  it('⚠️ leave React Aria’s own keyboard drag working (Enter, the arrows, Enter)', async () => {
    const { region, user } = await openEditor();
    await enter(region, user);
    // A direct move first, then a drag: the direct arrows must not have broken the drag.
    gripOf(region, 'Flour').focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => { expect(names(region)).toEqual(['Water', 'Flour', 'Salt']); });
    await waitFor(() => { expect(gripOf(region, 'Flour')).toHaveFocus(); });

    await user.keyboard('{Enter}');
    expect((await screen.findAllByRole('button', { name: /^Insert (before|after) /, hidden: true }, LOAD)).length).toBeGreaterThan(0);
    // From [Water, Flour, Salt] the two arrows walk the drop places to the one before Water: Flour is first again, once.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await waitFor(() => { expect(names(region)).toEqual(['Flour', 'Water', 'Salt']); });
    await waitFor(() => { expect(gripOf(region, 'Flour')).toHaveFocus(); });
    await later();
    expect(names(region)).toEqual(['Flour', 'Water', 'Salt']);
    expect(gripOf(region, 'Flour')).toHaveFocus();
  });
});

describe('keys that must NOT move a row', () => {
  it('ArrowDown and ArrowUp on a ROW (not its grip) move nothing and are no edit', async () => {
    const { region, user } = await openEditor();
    await enter(region, user);
    // The row hands its focus to its grip, so the key is sent to the row itself.
    const row = within(region).getAllByRole('row')[1]!;
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    await later();
    expect(names(region)).toEqual(['Flour', 'Water', 'Salt']);
    expect(isBusy()).toBe(false);
  });

  it.each([['Shift'], ['Alt'], ['Control']])('%s+Arrow on a grip moves nothing and is no edit', async modifier => {
    const { region, user } = await openEditor();
    await enter(region, user);
    gripOf(region, 'Water').focus();
    await user.keyboard(`{${modifier}>}{ArrowDown}{ArrowUp}{/${modifier}}`);
    await later();
    expect(names(region)).toEqual(['Flour', 'Water', 'Salt']);
    expect(isBusy()).toBe(false);
  });
});

describe('every grip is a Tab stop', () => {
  it('⚠️ reaches the third grip with keys only (Tab, Tab) and moves it up with ArrowUp', async () => {
    const { region, user } = await openEditor();
    await user.click(reorderButton(region));
    await waitFor(() => { expect(gripOf(region, 'Flour')).toHaveFocus(); });
    await user.tab();
    expect(gripOf(region, 'Water')).toHaveFocus();
    await user.tab();
    expect(gripOf(region, 'Salt')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    await waitFor(() => { expect(names(region)).toEqual(['Flour', 'Salt', 'Water']); });
    await waitFor(() => { expect(gripOf(region, 'Salt')).toHaveFocus(); });
    await later();
    expect(gripOf(region, 'Salt')).toHaveFocus();
  });

  it('goes back with Shift+Tab, and leaves the list from the first grip', async () => {
    const { region, user } = await openEditor();
    await enter(region, user);
    gripOf(region, 'Salt').focus();
    await user.tab({ shift: true });
    expect(gripOf(region, 'Water')).toHaveFocus();
    await user.tab({ shift: true });
    expect(gripOf(region, 'Flour')).toHaveFocus();
    await user.tab({ shift: true });
    expect(document.activeElement?.closest('[role="grid"]')).toBeNull();
    expect(document.activeElement).toBe(reorderButton(region, 'Done'));
  });

  it('leaves the list from the last grip, the focus going to the next control after it', async () => {
    const { region, user } = await openEditor();
    await enter(region, user);
    gripOf(region, 'Salt').focus();
    await user.tab();
    expect(document.activeElement?.closest('[role="grid"]')).toBeNull();
    expect(grips(region)).not.toContain(document.activeElement);
    expect(region.contains(document.activeElement)).toBe(true);
  });

  it('hands a focus put on a row to its grip', async () => {
    const { region, user } = await openEditor();
    await enter(region, user);
    const row = within(region).getAllByRole('row')[2]!;
    act(() => { row.focus(); });
    await waitFor(() => { expect(gripOf(region, 'Salt')).toHaveFocus(); });
  });
});

describe('a keyboard drag', () => {
  it('moves a row, marks the form as edited and puts the focus on the moved grip', async () => {
    const { region, user } = await openEditor();
    await enter(region, user);
    expect(isBusy()).toBe(false);
    gripOf(region, 'Flour').focus();
    await user.keyboard('{Enter}');
    await screen.findAllByRole('button', { name: /^Insert (before|after) /, hidden: true }, LOAD);
    // Two arrows from the first row walk the drop places to the end of the list: Flour goes last, once.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await waitFor(() => { expect(names(region)).toEqual(['Water', 'Salt', 'Flour']); });
    expect(isBusy()).toBe(true);
    await waitFor(() => { expect(gripOf(region, 'Flour')).toHaveFocus(); });
    await later();
    expect(names(region)).toEqual(['Water', 'Salt', 'Flour']);
    expect(gripOf(region, 'Flour')).toHaveFocus();
  });
});

describe('a move is an edit', () => {
  it('makes Back ask the discard question', async () => {
    const { region, user, router } = await openEditor();
    await enter(region, user);
    gripOf(region, 'Flour').focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => { expect(isBusy()).toBe(true); });
    await user.click(within(region).getByRole('button', { name: 'Back' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/recipes/r1/edit');
    // The mode is still on, with the new order.
    expect(names(region)).toEqual(['Water', 'Flour', 'Salt']);
  });
});

describe('Save', () => {
  it('⚠️ writes the new order, each row keeping its row id and its ingredient link', async () => {
    const { region, user, source } = await openEditor();
    await enter(region, user);
    gripOf(region, 'Flour').focus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    await waitFor(() => { expect(names(region)).toEqual(['Water', 'Salt', 'Flour']); });
    await user.click(saveButton(region));
    await answerSave(user);
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites[0]?.data?.ingredients).toEqual([
      { label: 'Water', grams: 700, unit: 'g', rid: 'row-water' },
      { label: 'Salt', grams: 20, unit: 'g', kind: 'recipe', refId: 'sub-1', rid: 'row-salt' },
      { label: 'Flour', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'ing-9', rid: 'row-flour' },
    ]);
  });

  it('⚠️ with a row to fix, leaves the mode, marks the bad box and puts the cursor in it', async () => {
    const { region, user } = await openEditor('/recipes/new');
    await user.type(recipeNameBox(), 'Pane');
    await user.type(ingredientBoxes(region)[0]!, 'Flour');
    await user.click(within(region).getByRole('button', { name: '+ Add ingredient' }));
    await user.type(ingredientBoxes(region)[1]!, 'Water');
    await enter(region, user);
    await user.click(saveButton(region));
    const boxes = await within(region).findAllByRole('spinbutton', { name: 'Amount' });
    expect(reorderButton(region)).toHaveAttribute('aria-pressed', 'false');
    expect(grips(region)).toHaveLength(0);
    await waitFor(() => { expect(boxes[0]).toHaveFocus(); });
    expect(boxes[0]).toHaveAttribute('aria-invalid', 'true');
    const said = await screen.findByText('Enter an amount for at least one ingredient.');
    expect(said.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('⚠️ a missing name is shown in the same way: the mode goes and the name box has the cursor', async () => {
    const { region, user } = await openEditor('/recipes/new');
    await user.click(within(region).getByRole('button', { name: '+ Add ingredient' }));
    await enter(region, user);
    await user.click(saveButton(region));
    await waitFor(() => { expect(recipeNameBox()).toHaveFocus(); });
    expect(recipeNameBox()).toHaveAttribute('aria-invalid', 'true');
    expect(reorderButton(region)).toHaveAttribute('aria-pressed', 'false');
  });
});
